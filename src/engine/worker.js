// Runs the verse index off the main thread so the console stays smooth while it builds and searches.

import { Bible } from "./bible.js";
import { Matcher } from "./matcher.js";

let bible = null;
let matcher = null;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      self.postMessage({ type: "progress", step: "download" });
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`Couldn't load the Bible data (${res.status}).`);
      const data = await res.json();
      bible = new Bible(data);
      // The console needs book info and KJV text for display; send it before the slow part.
      self.postMessage({ type: "bible", books: data.books, kjv: data.kjv, sources: data.sources });
      self.postMessage({ type: "progress", step: "index" });
      const t = performance.now();
      matcher = new Matcher(bible);
      self.postMessage({ type: "ready", ms: Math.round(performance.now() - t) });
    } else if (msg.type === "match") {
      if (!matcher) return;
      const results = matcher.match(msg.text, msg.limit || 3);
      self.postMessage({ type: "match", id: msg.id, results });
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err.message || err) });
  }
};
