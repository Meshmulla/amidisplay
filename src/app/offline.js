// Offline listening for the desktop app. Captures the microphone here and hands the audio
// to the speech engine running on this laptop (see desktop/engine-worker.cjs).
// Same shape as Listener in speech.js, so the console can use either.

export const desktop = window.flashdisplayDesktop || null;

export class OfflineListener {
  constructor(handlers) {
    this.h = handlers;
    this.want = false;
    this.boosting = false;
    this.model = "accurate";
    this.micId = "";
    this.ctx = null;
    this.stream = null;
    desktop?.onEngine((msg) => {
      if (msg.type === "interim") this.h.onInterim(msg.text);
      else if (msg.type === "final") { this.h.onInterim(""); if (msg.text) this.h.onFinal(msg.text, []); }
      else if (msg.type === "error") this.h.onState("reconnecting", `Speech engine problem: ${msg.message}`);
    });
  }

  async start(_lang, opts = {}) {
    this.release();
    if (opts.model) this.model = opts.model;
    if (opts.micId !== undefined) this.micId = opts.micId;
    this.want = true;
    this.h.onState("loading");
    try {
      await desktop.startEngine(this.model);
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.micId ? { exact: this.micId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.want) return this.release();
      this.ctx = new AudioContext({ sampleRate: 16000 });
      await this.ctx.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url));
      const src = this.ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(this.ctx, "flashdisplay-capture");
      node.port.onmessage = (e) => {
        desktop.sendAudio(e.data.samples);
        this.h.onLevel?.(e.data.level);
      };
      src.connect(node);
      // The node has to reach the destination to keep running; it outputs silence.
      node.connect(this.ctx.destination);
      this.h.onState("listening");
    } catch (err) {
      this.want = false;
      this.release();
      const msg = String(err?.message || err);
      if (/Permission|NotAllowed/i.test(msg)) this.h.onState("blocked", "The microphone was blocked. Check Windows Settings, Privacy, Microphone, and allow desktop apps.");
      else if (/NotFound|Overconstrained|exact/i.test(msg)) this.h.onState("blocked", "That microphone isn't connected. Choose another one in Settings.");
      else this.h.onState("blocked", msg);
    }
  }

  stop() {
    this.want = false;
    this.release();
    desktop?.stopEngine();
    this.h.onState("off");
  }

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.h.onLevel?.(0);
  }
}

export async function listMicrophones() {
  try {
    // Labels are only available after the first permission grant; ask once quietly.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch { /* no permission yet; list without names */ }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications");
}
