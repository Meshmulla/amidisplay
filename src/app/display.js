// The projector screen. Shows whatever the console sends, fitted to the screen.

import { openChannel, readScreen, DEFAULT_LOOK } from "./channel.js";
import { escapeHtml, verseHtml } from "./render.js";

const stage = document.getElementById("stage");
const hint = document.getElementById("hint");
const preview = new URLSearchParams(location.search).has("preview");
document.documentElement.classList.toggle("is-preview", preview);

let current = null;

function key(slide) {
  return slide ? `${slide.ref}|${slide.text}` : "";
}

function render(screen, instant = false) {
  const look = { ...DEFAULT_LOOK, ...(screen?.look || {}) };
  document.body.dataset.theme = look.theme;
  document.body.style.setProperty("--scale", look.scale);
  const slide = screen?.slide || null;
  if (key(slide) === key(current) && stage.childElementCount) {
    fitAll();
    return;
  }
  current = slide;
  const old = [...stage.children];
  old.forEach((el) => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), instant ? 0 : 450);
  });
  if (!slide) return;
  const el = document.createElement("article");
  el.className = "slide";
  if (instant) el.classList.add("instant");
  el.innerHTML = `
    <div class="frame">
      <p class="verse">${verseHtml(slide.text)}</p>
      <p class="ref">${escapeHtml(slide.ref)}${look.showVersion ? '<span class="version">KJV</span>' : ""}</p>
    </div>`;
  stage.append(el);
  fit(el);
  requestAnimationFrame(() => el.classList.add("in"));
}

/** Largest font size at which the verse fits its frame. */
function fit(slide) {
  const verse = slide.querySelector(".verse");
  const frame = slide.querySelector(".frame");
  const scale = Number(getComputedStyle(document.body).getPropertyValue("--scale")) || 1;
  const lower = /lower-third|green/.test(document.body.dataset.theme);
  const vh = window.innerHeight, vw = window.innerWidth;
  let hi = (lower ? Math.min(vh * 0.075, vw * 0.04) : Math.min(vh * 0.095, vw * 0.056)) * scale;
  let lo = 10;
  const cs = getComputedStyle(slide);
  const maxH = lower ? vh * 0.3 : slide.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const fits = (size) => {
    verse.style.fontSize = `${size}px`;
    return frame.scrollHeight <= maxH + 1;
  };
  if (fits(hi)) return;
  for (let n = 0; n < 14; n++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  verse.style.fontSize = `${lo}px`;
}

function fitAll() {
  stage.querySelectorAll(".slide:not(.leaving)").forEach(fit);
}

const ch = openChannel((msg) => {
  if (msg.type === "screen") render(msg.screen);
});
render(readScreen(), true);
ch.hello();
window.addEventListener("resize", fitAll);
document.fonts?.ready.then(fitAll);

// Full screen and cursor handling for the real projector window.
if (!preview) {
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };
  document.addEventListener("dblclick", toggleFull);
  document.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") toggleFull();
  });
  hint.hidden = false;
  setTimeout(() => hint.classList.add("gone"), 4000);
  let idle;
  document.addEventListener("mousemove", () => {
    document.body.classList.remove("no-cursor");
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add("no-cursor"), 2500);
  });
}
