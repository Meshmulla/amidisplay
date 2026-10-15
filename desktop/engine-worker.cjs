// Offline listening, on its own thread.
//
// Audio arrives as 16 kHz mono Float32 chunks. A voice-activity detector cuts it into
// sentences; each finished sentence is transcribed and sent back as "final". While someone
// is still mid-sentence, the words so far are transcribed every ~0.8 s and sent as "interim",
// so the console can react before the sentence ends.

const { parentPort } = require("node:worker_threads");
const os = require("node:os");
const so = require("sherpa-onnx-node");

const RATE = 16000;
const WINDOW = 512;            // VAD frame size (32 ms)
const PREROLL = 0.45 * RATE;   // keep a little audio from before speech was detected
const POSTROLL = 0.3 * RATE;   // and a little after it ended, so last words aren't clipped
const KEEP = 40 * RATE;        // rolling history
const INTERIM_EVERY = 800;     // ms
const INTERIM_MAX = 8 * RATE;  // only re-read the last 8 s for interim text

let recognizer = null;
let vad = null;
let pending = new Float32Array(0);
let history = new Float32Array(KEEP);
let historyEnd = 0;            // absolute sample index just past the newest sample
let speechStart = -1;          // absolute index where the current sentence began
let lastInterim = 0;
let level = 0;
let lastDecodeMs = 0;          // how long the last transcription took
let clockStart = 0;            // wall-clock time of the first audio after a reset

function recognizerConfig(kind, dir, threads) {
  const base = { featConfig: { sampleRate: RATE, featureDim: 80 }, decodingMethod: "greedy_search" };
  const common = { numThreads: threads, provider: "cpu", debug: 0 };
  if (kind === "parakeet") {
    return { ...base, modelConfig: { ...common, modelType: "nemo_transducer", tokens: `${dir}/tokens.txt`,
      transducer: { encoder: `${dir}/encoder.int8.onnx`, decoder: `${dir}/decoder.int8.onnx`, joiner: `${dir}/joiner.int8.onnx` } } };
  }
  if (kind === "moonshine") {
    return { ...base, modelConfig: { ...common, tokens: `${dir}/tokens.txt`,
      moonshine: { preprocessor: `${dir}/preprocess.onnx`, encoder: `${dir}/encode.int8.onnx`,
        uncachedDecoder: `${dir}/uncached_decode.int8.onnx`, cachedDecoder: `${dir}/cached_decode.int8.onnx` } } };
  }
  throw new Error(`Unknown model kind ${kind}`);
}

function load({ kind, dir, vadModel }) {
  const threads = Math.max(1, Math.min(4, os.cpus().length - 1));
  recognizer = new so.OfflineRecognizer(recognizerConfig(kind, dir, threads));
  vad = new so.Vad({
    sileroVad: { model: vadModel, threshold: 0.45, minSpeechDuration: 0.25, minSilenceDuration: 0.45, maxSpeechDuration: 12, windowSize: WINDOW },
    sampleRate: RATE, numThreads: 1, debug: 0,
  }, 60);
  reset();
}

function reset() {
  pending = new Float32Array(0);
  history = new Float32Array(KEEP);
  historyEnd = 0;
  speechStart = -1;
  clockStart = 0;
  if (vad) vad.reset();
}

function remember(chunk) {
  // history is a ring buffer indexed by absolute sample position
  for (let i = 0; i < chunk.length; i++) history[(historyEnd + i) % KEEP] = chunk[i];
  historyEnd += chunk.length;
}

function slice(from, to) {
  from = Math.max(from, historyEnd - KEEP, 0);
  const out = new Float32Array(Math.max(0, to - from));
  for (let i = 0; i < out.length; i++) out[i] = history[(from + i) % KEEP];
  return out;
}

function transcribe(samples) {
  if (samples.length < RATE * 0.3) return "";
  const t0 = Date.now();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: RATE, samples });
  recognizer.decode(stream);
  lastDecodeMs = Date.now() - t0;
  // Small models sometimes start with a stray "1." from the silence before speech.
  return recognizer.getResult(stream).text.trim().replace(/^(\d\.\s+)+(?=[A-Za-z])/, "");
}

function feed(chunk) {
  let peak = 0;
  for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]));
  level = Math.max(peak, level * 0.85);

  const merged = new Float32Array(pending.length + chunk.length);
  merged.set(pending);
  merged.set(chunk, pending.length);
  let off = 0;
  for (; off + WINDOW <= merged.length; off += WINDOW) {
    const win = merged.subarray(off, off + WINDOW);
    remember(win);
    vad.acceptWaveform(win);
    if (vad.isDetected() && speechStart < 0) speechStart = Math.max(0, historyEnd - WINDOW * 4 - PREROLL);
    while (!vad.isEmpty()) {
      const seg = vad.front(false); // Electron forbids external buffers
      vad.pop();
      // seg.start is where the detector thinks speech began; reach back a little so first words aren't clipped
      const start = Math.max(0, Math.min(seg.start - PREROLL, speechStart >= 0 ? speechStart : seg.start));
      const end = Math.min(historyEnd, seg.start + seg.samples.length + POSTROLL);
      const t0 = Date.now();
      const text = transcribe(slice(start, end));
      parentPort.postMessage({ type: "final", text, ms: Date.now() - t0, seconds: (end - start) / RATE, debug: process.env.FD_DEBUG ? `seg ${(seg.start / RATE).toFixed(2)}-${(end / RATE).toFixed(2)} from ${(start / RATE).toFixed(2)}` : undefined });
      speechStart = vad.isDetected() ? end : -1;
      lastInterim = Date.now();
    }
  }
  pending = merged.slice(off);

  // Interim text is a nice-to-have. On a slow laptop, skip it rather than fall behind the preacher:
  // if audio is arriving faster than we process it, the audio clock lags the wall clock.
  const now = Date.now();
  if (!clockStart) clockStart = now - (historyEnd / RATE) * 1000;
  const behind = now - clockStart - (historyEnd / RATE) * 1000;
  const every = Math.max(INTERIM_EVERY, lastDecodeMs * 2.5);
  if (speechStart >= 0 && behind < 400 && now - lastInterim > every && historyEnd - speechStart > RATE * 0.6) {
    lastInterim = now;
    const text = transcribe(slice(Math.max(speechStart, historyEnd - INTERIM_MAX), historyEnd));
    if (text) parentPort.postMessage({ type: "interim", text });
  }
}

parentPort.on("message", (msg) => {
  try {
    if (msg.type === "load") {
      const t0 = Date.now();
      load(msg);
      parentPort.postMessage({ type: "ready", ms: Date.now() - t0 });
    } else if (msg.type === "audio") {
      if (recognizer) feed(msg.samples);
    } else if (msg.type === "flush") {
      if (vad) {
        vad.flush();
        while (!vad.isEmpty()) {
          const seg = vad.front(false); // Electron forbids external buffers
          vad.pop();
          const text = transcribe(seg.samples);
          if (text) parentPort.postMessage({ type: "final", text });
        }
      }
      reset();
    } else if (msg.type === "level") {
      parentPort.postMessage({ type: "level", level });
    }
  } catch (err) {
    parentPort.postMessage({ type: "error", message: String(err.message || err) });
  }
});
