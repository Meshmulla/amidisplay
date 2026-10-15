// Live speech-to-text using the browser's built-in recogniser (Chrome / Edge).
// Chrome stops listening after silence or about a minute, so this restarts it quietly.

export function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export class Listener {
  /**
   * @param {{onInterim:(t:string)=>void, onFinal:(t:string)=>void, onState:(s:string, detail?:string)=>void}} handlers
   */
  constructor(handlers) {
    this.h = handlers;
    this.want = false;
    this.lang = "en-NG";
    this.rec = null;
    this.restarts = 0;
  }

  start(lang) {
    if (lang) this.lang = lang;
    this.want = true;
    this.restarts = 0;
    this.spawn();
  }

  stop() {
    this.want = false;
    if (this.rec) {
      try { this.rec.stop(); } catch { /* already stopped */ }
    }
    this.h.onState("off");
  }

  spawn() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.h.onState("listening");
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.h.onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      this.h.onInterim(interim.trim());
      this.restarts = 0;
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.want = false;
        this.h.onState("blocked", "Microphone access was refused. Allow the microphone for this page in Chrome's address bar, then press Listen again.");
        return;
      }
      if (e.error === "network") {
        this.h.onState("reconnecting", "Speech service unreachable. Check the internet connection; retrying.");
        return;
      }
      this.h.onState("reconnecting", `Speech error: ${e.error}. Retrying.`);
    };
    rec.onend = () => {
      this.h.onInterim("");
      if (!this.want) return;
      this.restarts++;
      const delay = Math.min(4000, 150 * this.restarts);
      setTimeout(() => this.want && this.spawn(), delay);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.h.onState("reconnecting", String(err.message || err));
    }
  }
}

/** Plays a script as if someone were speaking it — for trying the app without a microphone. */
export class Rehearsal {
  constructor(handlers) {
    this.h = handlers;
    this.timer = null;
  }

  play(script, wordsPerMinute = 150) {
    this.stop();
    const sentences = script.split(/(?<=[.?!])\s+/).filter(Boolean);
    let s = 0, w = 0;
    const msPerWord = 60000 / wordsPerMinute;
    this.h.onState("rehearsal");
    const tick = () => {
      if (s >= sentences.length) { this.h.onInterim(""); this.stop(); return; }
      const words = sentences[s].split(/\s+/);
      w++;
      if (w >= words.length) {
        this.h.onInterim("");
        this.h.onFinal(sentences[s]);
        s++; w = 0;
        this.timer = setTimeout(tick, msPerWord * 2.5);
      } else {
        this.h.onInterim(words.slice(0, w).join(" "));
        this.timer = setTimeout(tick, msPerWord * (0.7 + Math.random() * 0.6));
      }
    };
    tick();
  }

  get playing() {
    return this.timer !== null;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    const was = this.timer !== null;
    this.timer = null;
    if (was) this.h.onState("off");
  }
}

// A short sample sermon mixing spoken references, KJV quotes and modern paraphrase.
export const SAMPLE_SERMON = `Good morning church, please be seated. This morning I want us to talk about peace in a troubled season. Turn with me to Philippians chapter four verse six. Paul writes from a prison cell, and he says do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. Look at verse seven. Somebody say peace. Many of us are carrying heavy loads this week. But Jesus said come to me, all you who are weary and burdened, and I will give you rest. You don't have to carry it alone. The prophet Isaiah puts it this way: those who hope in the Lord will renew their strength, they will soar on wings like eagles. And when the enemy rises against you, remember that no weapon formed against you shall prosper. Let me take you to Romans eight twenty eight. We know that all things work together for good to them that love God. So I can do all things through Christ which strengtheneth me. Amen.`;
