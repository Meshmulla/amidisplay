// Runs on the audio thread: collects microphone samples (already resampled to the
// AudioContext's 16 kHz) into ~100 ms chunks and reports a level for the meter.

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1600);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      this.buf[this.n++] = v;
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
      if (this.n === this.buf.length) {
        this.port.postMessage({ samples: this.buf, level: this.peak }, [this.buf.buffer]);
        this.buf = new Float32Array(1600);
        this.n = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor("flashdisplay-capture", Capture);
