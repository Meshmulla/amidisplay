// Keeps the projector window(s) in step with the console.
// Uses BroadcastChannel (same browser, same computer) and remembers the last state
// so a display window opened later picks up what is on screen right now.

const NAME = "flashdisplay";
const KEY = "flashdisplay:screen";

export const DEFAULT_LOOK = {
  theme: "vespers", // vespers | black | daylight | lower-third | green
  scale: 1, // text size multiplier
  showVersion: true,
};

export function readScreen() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function openChannel(onMessage) {
  const ch = new BroadcastChannel(NAME);
  if (onMessage) ch.onmessage = (e) => onMessage(e.data);
  return {
    /** screen = { slide: {ref, text, version} | null, look } */
    send(screen) {
      try { localStorage.setItem(KEY, JSON.stringify(screen)); } catch { /* storage full or blocked */ }
      ch.postMessage({ type: "screen", screen });
    },
    hello() {
      ch.postMessage({ type: "hello" });
    },
    close() {
      ch.close();
    },
  };
}
