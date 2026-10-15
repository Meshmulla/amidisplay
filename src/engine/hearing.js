// Repairs what the speech engine mishears, before references are read out of it.
//
// Two layers:
//   1. A list of known mishearings ("Philippines 4" -> Philippians, "a fusions" -> Ephesians).
//   2. A sound-alike check for any other word sitting right before a chapter number,
//      comparing consonant skeletons ("Filipians" and "Philippians" sound the same).
// Both only fire when a number, "chapter" or "verse" follows, so ordinary speech
// ("the Philippines is beautiful") is left alone.

import { BOOK_NAMES } from "./books.js";

// heard (lowercase, space separated) -> canonical alias the parser knows
const MISHEARD = {
  philippines: "philippians", phillipines: "philippians", philipines: "philippians", filipians: "philippians", philippian: "philippians",
  "a fusions": "ephesians", "a fusion": "ephesians", effusions: "ephesians", "a feeds hands": "ephesians", "if easy ins": "ephesians", efesians: "ephesians",
  romance: "romans", roman: "romans", "rome ins": "romans",
  collisions: "colossians", "colossal": "colossians", "closings": "colossians", colosians: "colossians",
  galatia: "galatians", "gala shins": "galatians", galations: "galatians",
  "i say a": "isaiah", "i say yeah": "isaiah", "eyes say a": "isaiah", isaya: "isaiah", "isaiah s": "isaiah",
  "is equal": "ezekiel", "easy kill": "ezekiel", ezekial: "ezekiel", "is a kill": "ezekiel",
  "hose a": "hosea", "have a cook": "habakkuk", "have a kook": "habakkuk", habakuk: "habakkuk",
  stephania: "zephaniah", "zeph and i a": "zephaniah", "hag i": "haggai", "hag eye": "haggai",
  malaki: "malachi", "mala key": "malachi", mika: "micah", mica: "micah", "nay hum": "nahum",
  nehemia: "nehemiah", "knee him iah": "nehemiah", ester: "esther", "jonas": "jonah",
  jon: "john", "jhon": "john", "he brews": "hebrews", hebrew: "hebrews",
  "thessalonica": "thessalonians", tessalonians: "thessalonians", "thessaloniki": "thessalonians",
  "karen thians": "corinthians", corinthian: "corinthians", "colin thians": "corinthians",
  filemon: "philemon", "file a man": "philemon", salm: "psalm", sams: "psalms", "sam's": "psalms",
  "duty ronomy": "deuteronomy", "do you ronomy": "deuteronomy", levitikus: "leviticus", "levitic us": "leviticus",
  "lamb in tations": "lamentations", "proverb s": "proverbs", "jams": "james", "jew": "jude",
  revolution: "revelation", revolutions: "revelation", "revelation s": "revelation",
};

// Mishearings that are also ordinary words. Only accepted when a full chapter:verse follows.
const RISKY = new Set(["romance", "roman", "collisions", "colossal", "closings", "galatia", "is equal", "easy kill", "is a kill",
  "mika", "mica", "jon", "jew", "jams", "revolution", "revolutions", "hebrew", "ester", "salm", "sams"]);

const MAX_WORDS = Math.max(...Object.keys(MISHEARD).map((k) => k.split(" ").length));

/** Consonant skeleton: "Philippians" -> "flpns", "Filipians" -> "flpns". */
export function soundKey(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  w = w.replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k")
    .replace(/q/g, "k").replace(/x/g, "ks").replace(/z/g, "s").replace(/th/g, "t").replace(/v/g, "f")
    .replace(/[wh]/g, "").replace(/y/g, "");
  const body = w.slice(1).replace(/[aeiou]/g, "");
  const first = /[aeiou]/.test(w[0]) ? "" : w[0] || "";
  return (first + body).replace(/(.)\1+/g, "$1");
}

// Only whole book names take part in sound-alike matching; short ones collide too easily.
const SOUND_BOOKS = new Map();
BOOK_NAMES.forEach((name) => {
  const base = name.replace(/^\d /, "").toLowerCase();
  if (base.length < 6 || base.includes(" ")) return;
  const k = soundKey(base);
  if (k.length >= 3 && !SOUND_BOOKS.has(k)) SOUND_BOOKS.set(k, base);
});

const NUMBERISH = (t) => t && (typeof t.n === "number" || /^(chapter|chapters|chapta|verse|verses|tree)$/.test(t.t));

/** Whether a full chapter and verse follow position k ("4 6", "4:6", "chapter 4 verse 6"). */
function fullRefFollows(toks, k) {
  const a = toks[k], b = toks[k + 1], c = toks[k + 2];
  if (!a) return false;
  if (/^chapters?$/.test(a.t)) return true;
  if (typeof a.n !== "number") return false;
  if (a.n >= 100) return true; // "316"
  return Boolean(b && (b.t === ":" || typeof b.n === "number" || /^verses?$/.test(b.t) || (b.t === "verse" && c)));
}

/**
 * Replace misheard book names in a token list with the name the parser expects.
 * Tokens keep their original character offsets, so highlights still line up.
 */
export function repairBooks(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    let done = false;
    for (let len = Math.min(MAX_WORDS, toks.length - i); len >= 1 && !done; len--) {
      const span = toks.slice(i, i + len);
      const key = span.map((t) => t.t.replace(/'s$/, "")).join(" ");
      const fix = MISHEARD[key];
      if (!fix) continue;
      const after = i + len;
      if (!NUMBERISH(toks[after])) continue;
      if (RISKY.has(key) && !fullRefFollows(toks, after)) continue;
      // Book names are matched word by word, so split the fix back into words.
      fix.split(" ").forEach((w, n, all) => {
        out.push({ t: w, start: span[0].start, end: n === all.length - 1 ? span[span.length - 1].end : span[0].start, repaired: true });
      });
      i += len - 1;
      done = true;
    }
    if (done) continue;
    const t = toks[i];
    // Sound-alike: an unknown longish word directly before a chapter:verse.
    if (/^[a-z]{5,}$/.test(t.t) && fullRefFollows(toks, i + 1)) {
      const base = SOUND_BOOKS.get(soundKey(t.t));
      if (base && base !== t.t) {
        out.push({ ...t, t: base, repaired: true });
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

// Number words a speech engine produces for accented or quick speech, accepted only where
// a chapter or verse number is expected ("verse for" -> 4, "chapter tree" -> 3).
export const NUMBER_SOUNDS = { for: 4, fore: 4, to: 2, too: 2, ate: 8, won: 1, tree: 3, free: 3, nain: 9 };
