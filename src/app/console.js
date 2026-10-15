// Operator console: listens, finds verses, and controls what the projector shows.

import { Bible } from "../engine/bible.js";
import { findReferences, formatRef, parseTypedReference } from "../engine/references.js";
import { SUGGEST_AT, STRONG_AT } from "../engine/thresholds.js";
import { Listener, Rehearsal, speechSupported, SAMPLE_SERMON } from "./speech.js";
import { openChannel, DEFAULT_LOOK } from "./channel.js";
import { escapeHtml, verseHtml } from "./render.js";

const $ = (id) => document.getElementById(id);
const els = {
  listen: $("listen"), status: $("status"), sample: $("sample"), openScreen: $("open-screen"),
  openSettings: $("open-settings"), settings: $("settings"),
  transcript: $("transcript"), transcriptEmpty: $("transcript-empty"), clearTranscript: $("clear-transcript"),
  suggestions: $("suggestions"), loading: $("loading"), loadingText: $("loading-text"),
  tally: $("tally"), tallyText: $("tally-text"), monitor: $("monitor"), monitorFrame: $("monitor-frame"),
  prev: $("prev-verse"), next: $("next-verse"), clearScreen: $("clear-screen"), copyLive: $("copy-live"),
  copyTranscript: $("copy-transcript"), saveSession: $("save-session"),
  search: $("search"), results: $("results"), toast: $("toast"), tpl: $("tpl-suggestion"),
  setLang: $("set-lang"), setAuto: $("set-auto"), setTheme: $("set-theme"), setScale: $("set-scale"), setVersion: $("set-version"),
};

// ---------------------------------------------------------------------------
// Settings

const SETTINGS_KEY = "flashdisplay:settings";
const settings = {
  lang: "en-NG",
  auto: "off",
  look: { ...DEFAULT_LOOK },
  ...loadSettings(),
};
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// State

let bible = null;          // KJV + verse grid, on this thread
let ready = false;         // matcher built in the worker
let refContext = null;     // last spoken reference, for "verse 17"
const segments = [];       // finished transcript sentences
let interim = "";
const suggestions = [];    // newest first
let selectedId = null;
let live = null;           // { index, sid }
let nextId = 1;

// Everything that happened this service, for "Save session". Shared back to tune the matcher.
const session = { started: Date.now(), events: [] };
function log(type, data = {}) {
  session.events.push({ t: Date.now(), type, ...data });
}

const channel = openChannel((msg) => {
  if (msg.type === "hello") pushScreen();
});

// ---------------------------------------------------------------------------
// Worker: loads the Bible and builds the verse index

const worker = new Worker(new URL("../engine/worker.js", import.meta.url), { type: "module" });
const pending = new Map();
worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "progress") {
    els.loadingText.textContent = msg.step === "download"
      ? "Loading 31,102 verses in three translations…"
      : "Learning modern wordings so paraphrases can be matched…";
  } else if (msg.type === "bible") {
    bible = new Bible({ books: msg.books, kjv: msg.kjv });
    els.search.disabled = false;
    els.listen.disabled = !speechSupported();
    setStatus(speechSupported() ? "Spoken references ready. Matching quotes in a moment." : "This browser can't listen. Open FlashDisplay in Google Chrome.", speechSupported() ? "" : "warn");
    pushScreen();
  } else if (msg.type === "ready") {
    ready = true;
    els.sample.disabled = false;
    els.loading.remove();
    if (!listener.want && !rehearsal.playing) setStatus(speechSupported() ? "Ready when the preacher is." : "This browser can't listen. Open FlashDisplay in Google Chrome.", speechSupported() ? "" : "warn");
    renderSuggestions();
  } else if (msg.type === "match") {
    pending.get(msg.id)?.(msg.results);
    pending.delete(msg.id);
  } else if (msg.type === "error") {
    els.loadingText.textContent = msg.message;
    setStatus(msg.message, "warn");
  }
};
worker.postMessage({ type: "init", url: new URL("../../data/bible.json", import.meta.url).href });

let matchSeq = 0;
function match(text, limit = 3) {
  return new Promise((resolve) => {
    if (!ready) return resolve([]);
    const id = ++matchSeq;
    pending.set(id, resolve);
    worker.postMessage({ type: "match", id, text, limit });
  });
}

// ---------------------------------------------------------------------------
// Listening

const handlers = {
  onInterim: (text) => { interim = text; renderInterim(); scanInterim(); },
  onFinal: (text, alts = []) => { if (text) addSegment(text, alts); },
  onState: (state, detail) => setListenState(state, detail),
};
const listener = new Listener(handlers);
const rehearsal = new Rehearsal(handlers);

function setListenState(state, detail) {
  const on = state === "listening" || state === "reconnecting" || state === "rehearsal";
  els.listen.setAttribute("aria-pressed", String(on));
  els.listen.querySelector(".listen-label").textContent = on ? "Stop listening" : "Start listening";
  els.sample.textContent = state === "rehearsal" ? "Stop sample" : "Play sample sermon";
  const lang = els.setLang.selectedOptions[0]?.textContent || settings.lang;
  const text = {
    listening: `Listening for ${lang}`,
    rehearsal: "Playing the sample sermon",
    reconnecting: detail || "Reconnecting…",
    blocked: detail,
    off: ready ? "Ready when the preacher is." : "Not listening",
  }[state];
  setStatus(text, state === "blocked" || state === "reconnecting" ? "warn" : "");
}

function setStatus(text, tone = "") {
  els.status.textContent = text;
  els.status.dataset.tone = tone;
}

els.listen.addEventListener("click", () => {
  els.listen.blur(); // keep Enter and the arrow keys for the verse list
  if (els.listen.getAttribute("aria-pressed") === "true") {
    listener.stop();
    rehearsal.stop();
  } else {
    rehearsal.stop();
    listener.start(settings.lang);
  }
});

els.sample.addEventListener("click", () => {
  els.sample.blur();
  if (rehearsal.playing) { rehearsal.stop(); return; }
  listener.stop();
  rehearsal.play(SAMPLE_SERMON, 170);
});

// ---------------------------------------------------------------------------
// Transcript

function addSegment(text, alts = []) {
  const seg = { id: nextId++, text, alts, time: Date.now(), marks: [], found: [] };
  segments.push(seg);
  log("heard", { text, alts });
  interim = "";
  for (const s of unplaced) if (!s.placed) { s.placed = true; seg.found.push(s.id); }
  unplaced = [];
  // Spoken references ("John 3:16", "verse 17")
  if (bible) {
    const { refs, context } = findReferences(text, bible, refContext);
    refContext = context;
    for (const r of refs) {
      const s = suggestFromRef(r, text.slice(r.start, r.end));
      if (s) { s.placed = true; seg.marks.push({ start: r.start, end: r.end, sid: s.id }); }
    }
    // Chrome's top guess had no reference: its backup guesses sometimes heard one.
    if (!refs.some((r) => r.kind === "explicit")) {
      for (const alt of alts) {
        const found = findReferences(alt, bible, context).refs.filter((r) => r.kind === "explicit");
        if (!found.length) continue;
        for (const r of found) {
          const s = suggestFromRef(r, alt.slice(r.start, r.end));
          if (s && !seg.found.includes(s.id)) { s.placed = true; seg.found.push(s.id); }
        }
        refContext = { book: found.at(-1).book, chapter: found.at(-1).chapter };
        break;
      }
    }
  }
  renderTranscript();
  scheduleMatch(seg);
}

function recentWords(n, extra = "") {
  const words = [];
  for (let i = segments.length - 1; i >= 0 && words.length < n; i--) {
    words.unshift(...segments[i].text.split(/\s+/));
  }
  if (extra) words.push(...extra.split(/\s+/));
  return words.slice(-n).join(" ");
}

let interimTimer = null;
function scanInterim() {
  if (!bible || !interim) return;
  // Catch "John 3:16" while it's still being spoken. Only full references, so a half-heard
  // chapter number doesn't jump the gun.
  const { refs } = findReferences(interim, bible, refContext);
  // A reference still being spoken may grow ("Romans 8:20…" becomes "8:28"), so wait for a word after it.
  for (const r of refs) {
    if (r.kind === "explicit" && interim.slice(r.end).trim()) suggestFromRef(r, interim.slice(r.start, r.end));
  }
  clearTimeout(interimTimer);
  interimTimer = setTimeout(() => {
    runMatch(recentWords(14, interim), null);
    runMatch(recentWords(36, interim), null);
  }, 700);
}

// Quotes are looked for in a short and a long stretch of recent speech: the short one catches a
// quick quote right after another verse, the long one catches a verse spread over sentences.
function scheduleMatch(seg) {
  if (seg.text.split(/\s+/).length >= 4) runMatch(seg.text, seg);
  if (seg.alts[0] && seg.alts[0].split(/\s+/).length >= 4) runMatch(seg.alts[0], seg);
  runMatch(recentWords(14), seg);
  runMatch(recentWords(36), seg);
}

const recentWindows = new Set();
let unplaced = []; // matches found while a sentence was still being spoken

async function runMatch(window, seg) {
  if (!ready || recentWindows.has(window)) return;
  recentWindows.add(window);
  if (recentWindows.size > 30) recentWindows.delete(recentWindows.values().next().value);
  const results = await match(window, 3);
  const top = results[0];
  if (!top || top.confidence < SUGGEST_AT) return;
  const alts = results.slice(1).filter((r) => r.confidence >= SUGGEST_AT - 0.12).map((r) => r.index);
  const s = addSuggestion({
    kind: "match",
    index: top.index,
    confidence: top.confidence,
    version: top.version,
    heard: window.split(/\s+/).slice(-18).join(" "),
    alts,
  });
  if (!s || s.placed) return;
  // Mark the sentence where the verse was heard, once.
  const at = seg || null;
  if (at) { s.placed = true; at.found.push(s.id); renderTranscript(); }
  else if (!unplaced.includes(s)) unplaced.push(s);
}

function renderTranscript() {
  els.transcriptEmpty.hidden = segments.length > 0 || Boolean(interim);
  const box = els.transcript;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.querySelectorAll(".seg, .interim").forEach((n) => n.remove());
  const recentFrom = segments.length - 3;
  const shown = segments.slice(-60);
  const frag = document.createDocumentFragment();
  shown.forEach((seg) => {
    const p = document.createElement("p");
    p.className = "seg";
    if (segments.indexOf(seg) >= recentFrom) p.classList.add("recent");
    let html = "", at = 0;
    for (const m of seg.marks) {
      html += escapeHtml(seg.text.slice(at, m.start));
      html += `<button class="mark" data-sid="${m.sid}" type="button">${escapeHtml(seg.text.slice(m.start, m.end))}</button>`;
      at = m.end;
    }
    html += escapeHtml(seg.text.slice(at));
    for (const sid of seg.found) {
      const s = suggestions.find((x) => x.id === sid);
      if (s) html += ` <button class="found" data-sid="${sid}" type="button">${escapeHtml(s.label)}</button>`;
    }
    p.innerHTML = html;
    frag.append(p);
  });
  const ip = document.createElement("p");
  ip.className = "interim";
  ip.textContent = interim;
  frag.append(ip);
  box.append(frag);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function renderInterim() {
  const ip = els.transcript.querySelector(".interim");
  if (!ip) return renderTranscript();
  ip.textContent = interim;
  els.transcriptEmpty.hidden = segments.length > 0 || Boolean(interim);
  const box = els.transcript;
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
}

els.transcript.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sid]");
  if (!b) return;
  select(Number(b.dataset.sid), true);
});

// ---------------------------------------------------------------------------
// Copy and save

function clock(t) {
  const s = Math.max(0, Math.round((t - session.started) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}

function transcriptText() {
  return segments.map((seg) => {
    const verses = [...seg.marks.map((m) => m.sid), ...seg.found]
      .map((id) => suggestions.find((s) => s.id === id)?.label).filter(Boolean);
    return `[${clock(seg.time)}] ${seg.text}${verses.length ? `  (${[...new Set(verses)].join(", ")})` : ""}`;
  }).join("\n");
}

function sessionText() {
  const date = new Date(session.started);
  const lines = [
    `FlashDisplay session, ${date.toLocaleString()}`,
    `Accent setting: ${settings.lang}. Book-name boosting: ${listener.boosting ? "on" : "not supported in this browser"}.`,
    "",
    "VERSES",
    "Shown from search means FlashDisplay missed it. Those are the most useful lines for tuning.",
    "",
  ];
  for (const e of session.events) {
    if (e.type === "found") lines.push(`[${clock(e.t)}] Found ${e.label} (${e.kind === "match" ? `${Math.round(e.confidence * 100)}% match via ${e.version}` : e.kind}). Heard: "${e.heard}"`);
    if (e.type === "shown") lines.push(`[${clock(e.t)}] Shown ${e.label}${e.via === "search" ? ` from search "${e.query}"` : ""}`);
    if (e.type === "dismissed") lines.push(`[${clock(e.t)}] Dismissed ${e.label}`);
  }
  lines.push("", "TRANSCRIPT", "Lines starting with 'or:' are Chrome's backup guesses for the line above.", "");
  for (const seg of segments) {
    lines.push(`[${clock(seg.time)}] ${seg.text}`);
    for (const a of seg.alts || []) lines.push(`        or: ${a}`);
  }
  return lines.join("\n");
}

els.copyTranscript.addEventListener("click", async () => {
  if (!segments.length) { toast("Nothing to copy yet"); return; }
  try {
    await navigator.clipboard.writeText(transcriptText());
    toast("Transcript copied");
  } catch {
    toast("Couldn't copy. Use Save session instead.");
  }
});

els.saveSession.addEventListener("click", () => {
  if (!segments.length && !session.events.length) { toast("Nothing to save yet"); return; }
  const d = new Date(session.started);
  const name = `FlashDisplay ${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}.txt`;
  const url = URL.createObjectURL(new Blob([sessionText()], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Session saved to your downloads");
});

els.clearTranscript.addEventListener("click", () => {
  segments.length = 0;
  interim = "";
  refContext = null;
  renderTranscript();
});

// ---------------------------------------------------------------------------
// Suggestions

function suggestFromRef(r, heard) {
  const index = bible.index(r.book, r.chapter, r.verse);
  if (index < 0) return null;
  const end = r.endVerse > r.verse ? bible.index(r.book, r.chapter, r.endVerse) : index;
  return addSuggestion({ kind: r.kind === "chapter" ? "chapter" : "spoken", index, end, heard });
}

/** Adds a suggestion, or refreshes it if the same verse came up in the last two minutes. */
function addSuggestion(input) {
  const now = Date.now();
  const end = input.end ?? input.index;
  const existing = suggestions.find((s) => s.index === input.index && s.end === end && now - s.time < 120000);
  if (existing) {
    const stronger = input.kind !== "match" && existing.kind === "match";
    if (stronger) Object.assign(existing, { kind: input.kind, heard: input.heard || existing.heard });
    if (input.confidence) existing.confidence = Math.max(existing.confidence || 0, input.confidence);
    if (existing.status === "dismissed") return existing;
    // A quote that is still inside the listening window gets found again; only a fresh
    // spoken mention brings an older verse back to the top.
    if (suggestions[0] !== existing && input.kind !== "match") {
      suggestions.splice(suggestions.indexOf(existing), 1);
      suggestions.unshift(existing);
      existing.time = now;
      existing.fresh = true;
      if (!isPinned()) selectedId = existing.id;
      renderSuggestions();
    } else if (stronger || (input.confidence || 0) > (existing.shownConfidence || 0)) {
      renderSuggestions();
    }
    existing.shownConfidence = existing.confidence;
    return existing;
  }
  const s = {
    id: nextId++,
    kind: input.kind,
    index: input.index,
    end,
    confidence: input.confidence ?? 1,
    version: input.version || "kjv",
    heard: input.heard || "",
    alts: input.alts || [],
    time: now,
    status: "new",
    fresh: true,
  };
  s.label = labelFor(s);
  suggestions.unshift(s);
  log("found", { label: s.label, kind: s.kind, confidence: s.confidence, version: s.version, heard: s.heard });
  if (suggestions.length > 60) suggestions.pop();
  if (!isPinned()) selectedId = s.id;
  renderSuggestions();
  maybeAutoShow(s);
  return s;
}

function labelFor(s) {
  const r = bible.ref(s.index);
  if (s.kind === "chapter") return formatRef({ ...r, kind: "chapter" });
  const end = bible.ref(s.end);
  return formatRef({ ...r, endVerse: end.verse, kind: "explicit" });
}

// If the operator has just clicked or keyed to a suggestion, don't yank the selection away.
let pinnedUntil = 0;
function isPinned() {
  return Date.now() < pinnedUntil;
}

function strengthOf(s) {
  if (s.kind !== "match") return "spoken";
  return s.confidence >= STRONG_AT ? "strong" : "possible";
}

function kindText(s) {
  if (s.kind === "spoken") return "Spoken reference";
  if (s.kind === "chapter") return "Chapter mentioned, starts at verse 1";
  const via = { kjv: "KJV wording", bsb: "modern wording", nheb: "modern wording" }[s.version];
  return s.confidence >= STRONG_AT ? `Strong match, ${via}` : `Possible match, ${via}`;
}

function timeAgo(t) {
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

function renderSuggestions() {
  if (!bible) return;
  const box = els.suggestions;
  if (!suggestions.length) {
    if (!ready) return;
    box.innerHTML = `
      <div class="empty-state">
        <h3>Verses will gather here as the sermon goes on.</h3>
        <p>Press Start listening when the preacher begins. Spoken references and quoted verses, in any translation, show up in KJV, ready to put on screen.</p>
        <button class="btn" type="button" data-action="sample">Play a sample sermon to see it work</button>
      </div>`;
    return;
  }
  box.querySelector(".empty-state")?.remove();
  const existing = new Map([...box.querySelectorAll(".sugg")].map((n) => [Number(n.dataset.id), n]));
  const frag = document.createDocumentFragment();
  for (const s of suggestions) {
    let node = existing.get(s.id);
    if (!node) {
      node = els.tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = s.id;
      node.id = `sugg-${s.id}`;
    }
    existing.delete(s.id);
    fillSuggestion(node, s);
    frag.append(node);
  }
  existing.forEach((n) => n.remove());
  box.append(frag);
  box.setAttribute("aria-activedescendant", selectedId ? `sugg-${selectedId}` : "");
}

function fillSuggestion(node, s) {
  const selected = s.id === selectedId;
  node.setAttribute("aria-selected", String(selected));
  node.classList.toggle("is-live", live?.sid === s.id);
  node.classList.toggle("is-dismissed", s.status === "dismissed");
  if (s.fresh) {
    node.classList.remove("arrived");
    void node.offsetWidth;
    node.classList.add("arrived");
    s.fresh = false;
  }
  node.querySelector(".sugg-ref").textContent = s.label;
  const kind = node.querySelector(".sugg-kind");
  kind.textContent = kindText(s);
  kind.dataset.strength = strengthOf(s);
  node.querySelector(".sugg-time").textContent = timeAgo(s.time);
  node.querySelector(".sugg-text").innerHTML = verseHtml(bible.text(s.index));
  node.querySelector(".sugg-heard").textContent = s.heard ? `Heard: “…${s.heard}”` : "";
  const alts = node.querySelector(".sugg-alts");
  alts.innerHTML = s.alts.length
    ? `<span>Or did they mean</span>${s.alts.map((i) => `<button class="alt" type="button" data-alt="${i}">${escapeHtml(formatRef({ ...bible.ref(i), kind: "explicit" }))}</button>`).join("")}`
    : "";
}

setInterval(() => {
  els.suggestions.querySelectorAll(".sugg").forEach((n) => {
    const s = suggestions.find((x) => x.id === Number(n.dataset.id));
    if (s) n.querySelector(".sugg-time").textContent = timeAgo(s.time);
  });
}, 10000);

function select(id, pin = false) {
  if (!suggestions.some((s) => s.id === id)) return;
  selectedId = id;
  if (pin) pinnedUntil = Date.now() + 6000;
  renderSuggestions();
  document.getElementById(`sugg-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

els.suggestions.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='sample']")) { els.sample.click(); return; }
  const node = e.target.closest(".sugg");
  if (!node) return;
  const s = suggestions.find((x) => x.id === Number(node.dataset.id));
  if (!s) return;
  const alt = e.target.closest("[data-alt]");
  if (alt) {
    // Swap the suggestion for the alternative the operator picked.
    const i = Number(alt.dataset.alt);
    s.alts = [s.index, ...s.alts.filter((x) => x !== i)];
    s.index = i; s.end = i;
    s.label = labelFor(s);
    selectedId = s.id;
    pinnedUntil = Date.now() + 6000;
    renderSuggestions();
    return;
  }
  if (e.target.closest(".sugg-show")) { show(s); return; }
  if (e.target.closest(".sugg-copy")) { copyRef(s.label); return; }
  if (e.target.closest(".sugg-dismiss")) {
    s.status = "dismissed";
    log("dismissed", { label: s.label });
    moveSelection(1);
    renderSuggestions();
    return;
  }
  if (s.id === selectedId && !e.target.closest("button")) { show(s); return; }
  select(s.id, true);
});

function moveSelection(dir) {
  const visible = suggestions.filter((s) => s.status !== "dismissed" || s.id === selectedId);
  if (!visible.length) return;
  const at = visible.findIndex((s) => s.id === selectedId);
  const next = visible[Math.max(0, Math.min(visible.length - 1, at + dir))];
  select(next.id, true);
}

function maybeAutoShow(s) {
  if (settings.auto === "off") return;
  if (s.kind === "spoken") return show(s);
  if (settings.auto === "strong" && s.kind === "match" && s.confidence >= STRONG_AT) show(s);
}

// ---------------------------------------------------------------------------
// The projector

function show(s) {
  log("shown", { label: s.label, via: s.kind });
  s.status = "shown";
  live = { index: s.index, end: s.end, start: s.index, sid: s.id };
  selectedId = s.id;
  pushScreen();
  renderSuggestions();
}

function showIndex(index, query = "") {
  log("shown", { label: formatRef({ ...bible.ref(index), kind: "explicit" }), via: "search", query });
  live = { index, start: index, end: index, sid: null };
  pushScreen();
  renderSuggestions();
}

function step(dir) {
  if (!live || !bible) return;
  const j = bible.step(live.index, dir);
  if (j < 0) return;
  live.index = j;
  pushScreen();
}

function clearScreen() {
  live = null;
  pushScreen();
  renderSuggestions();
}

function pushScreen() {
  const slide = live && bible
    ? { ref: formatRef({ ...bible.ref(live.index), kind: "explicit" }), text: bible.text(live.index) }
    : null;
  channel.send({ slide, look: settings.look });
  const on = Boolean(slide);
  els.tally.dataset.on = String(on);
  els.monitor.dataset.on = String(on);
  els.tallyText.textContent = on ? `On screen: ${slide.ref}` : "Screen is clear";
  els.prev.disabled = !on || bible.step(live.index, -1) < 0;
  els.next.disabled = !on || bible.step(live.index, 1) < 0;
  els.clearScreen.disabled = !on;
  els.copyLive.hidden = !on;
}

els.prev.addEventListener("click", () => step(-1));
els.next.addEventListener("click", () => step(1));
els.clearScreen.addEventListener("click", clearScreen);
els.copyLive.addEventListener("click", () => live && copyRef(formatRef({ ...bible.ref(live.index), kind: "explicit" })));

els.openScreen.addEventListener("click", () => {
  const w = window.open("display.html", "flashdisplay-screen", "popup,width=1280,height=720");
  if (!w) toast("Your browser blocked the window. Allow pop-ups for this page and try again.");
  else toast("Drag the new window to the projector, then double-click it for full screen.");
});

// Scale the 1920×1080 preview to fit the monitor box.
new ResizeObserver(([entry]) => {
  els.monitorFrame.style.transform = `scale(${entry.contentRect.width / 1920})`;
}).observe(els.monitor);

async function copyRef(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text}`);
  } catch {
    toast(`Couldn't copy. The reference is ${text}`);
  }
}

let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------------------
// Find a verse

let searchSeq = 0;
let searchResults = [];
let searchSel = 0;
let searchTimer;

els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 160);
});

async function runSearch() {
  const q = els.search.value.trim();
  const seq = ++searchSeq;
  if (!q || !bible) { searchResults = []; return renderResults(); }
  const r = parseTypedReference(q, bible);
  let list = [];
  if (r) {
    const start = bible.index(r.book, r.chapter, r.verse);
    const end = r.endVerse > r.verse ? bible.index(r.book, r.chapter, r.endVerse) : start;
    for (let i = start; i <= Math.min(end, start + 7); i++) list.push(i);
  } else if (q.split(/\s+/).length >= 2) {
    const found = await match(q, 6);
    if (seq !== searchSeq) return;
    list = found.filter((f) => f.confidence > 0.15).map((f) => f.index);
  }
  searchResults = list;
  searchSel = 0;
  renderResults(q);
}

function renderResults(q = "") {
  if (!q) { els.results.innerHTML = ""; return; }
  if (!searchResults.length) {
    els.results.innerHTML = `<li class="r-note">${ready ? "No verse found. Try a reference like Romans 8:28, or a few more words." : "Still preparing word search. References like John 3:16 work now."}</li>`;
    return;
  }
  els.results.innerHTML = searchResults.map((i, n) => `
    <li role="option" data-i="${i}" aria-selected="${n === searchSel}">
      <span class="r-ref">${escapeHtml(formatRef({ ...bible.ref(i), kind: "explicit" }))}</span>
      <span class="r-text">${verseHtml(bible.text(i))}</span>
    </li>`).join("");
}

els.results.addEventListener("click", (e) => {
  const li = e.target.closest("[data-i]");
  if (li) showIndex(Number(li.dataset.i), els.search.value.trim());
});

els.search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    searchSel = Math.max(0, Math.min(searchResults.length - 1, searchSel + (e.key === "ArrowDown" ? 1 : -1)));
    renderResults(els.search.value.trim());
  } else if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch().then(() => {
      if (searchResults.length) showIndex(searchResults[searchSel], els.search.value.trim());
    });
  } else if (e.key === "Escape") {
    els.search.value = "";
    searchResults = [];
    renderResults();
    els.search.blur();
    e.stopPropagation();
  }
});

// ---------------------------------------------------------------------------
// Keyboard

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea, dialog")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const sel = suggestions.find((s) => s.id === selectedId);
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); moveSelection(1); break;
    case "ArrowUp": e.preventDefault(); moveSelection(-1); break;
    case "Enter": if (sel && !e.target.closest("button")) { e.preventDefault(); show(sel); } break;
    case "ArrowRight": e.preventDefault(); step(1); break;
    case "ArrowLeft": e.preventDefault(); step(-1); break;
    case "Escape": clearScreen(); break;
    case "/": e.preventDefault(); els.search.focus(); els.search.select(); break;
  }
});

// ---------------------------------------------------------------------------
// Settings dialog

function syncSettingsForm() {
  els.setLang.value = settings.lang;
  els.setAuto.value = settings.auto;
  els.setScale.value = settings.look.scale;
  els.setVersion.checked = settings.look.showVersion;
  const radio = els.setTheme.querySelector(`input[value="${settings.look.theme}"]`);
  if (radio) radio.checked = true;
}

els.openSettings.addEventListener("click", () => {
  syncSettingsForm();
  els.settings.showModal();
});

els.settings.addEventListener("input", (e) => {
  const t = e.target;
  if (t === els.setLang) {
    settings.lang = t.value;
    if (listener.want) listener.start(settings.lang);
  }
  if (t === els.setAuto) settings.auto = t.value;
  if (t === els.setScale) settings.look.scale = Number(t.value);
  if (t === els.setVersion) settings.look.showVersion = t.checked;
  if (t.name === "theme") settings.look.theme = t.value;
  saveSettings();
  pushScreen();
});
els.settings.addEventListener("click", (e) => {
  if (e.target === els.settings) els.settings.close(); // click on backdrop
});

syncSettingsForm();
setListenState("off");
setStatus("Preparing the Bible…");
