// Offline speech models: which ones AMIDisplay can use, where they live, and how they get there.
// Models are downloaded once (or imported from a USB stick) into the app's data folder.

const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

const CATALOG = {
  accurate: {
    key: "accurate",
    name: "Accurate",
    note: "Best with accents and Bible names. Recommended for most laptops (uses about 1 GB of memory).",
    folder: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    file: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
    bytes: 482468385,
    kind: "parakeet",
    needs: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
  },
  light: {
    key: "light",
    name: "Light",
    note: "For older laptops with 4 GB of memory or less. Slightly less accurate.",
    folder: "sherpa-onnx-moonshine-base-en-int8",
    file: "sherpa-onnx-moonshine-base-en-int8.tar.bz2",
    bytes: 250807309,
    kind: "moonshine",
    needs: ["preprocess.onnx", "encode.int8.onnx", "uncached_decode.int8.onnx", "cached_decode.int8.onnx", "tokens.txt"],
  },
};

class Models {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.busy = null;
  }

  dir(key) {
    return path.join(this.root, CATALOG[key].folder);
  }

  installed(key) {
    const m = CATALOG[key];
    return m.needs.every((f) => fs.existsSync(path.join(this.dir(key), f)));
  }

  list() {
    return Object.values(CATALOG).map((m) => ({
      key: m.key, name: m.name, note: m.note, megabytes: Math.round(m.bytes / 1e6),
      installed: this.installed(m.key), busy: this.busy?.key === m.key ? this.busy : null,
    }));
  }

  /** Download over the internet (once). `fetchImpl` is Electron's net.fetch so system proxies work. */
  async download(key, fetchImpl, onProgress) {
    const m = CATALOG[key];
    if (!m) throw new Error("Unknown model");
    if (this.busy) throw new Error("Another model is already being set up.");
    const tmp = path.join(this.root, `${m.file}.part`);
    this.busy = { key, received: 0, total: m.bytes, step: "download" };
    try {
      const res = await fetchImpl(RELEASES + m.file);
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}). Check the internet connection and try again.`);
      const total = Number(res.headers.get("content-length")) || m.bytes;
      let received = 0, last = 0;
      const body = Readable.fromWeb(res.body);
      body.on("data", (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - last > 250) { last = now; this.busy.received = received; onProgress?.({ key, step: "download", received, total }); }
      });
      await pipeline(body, fs.createWriteStream(tmp));
      await this.extract(key, tmp, onProgress);
    } finally {
      fs.rmSync(tmp, { force: true });
      this.busy = null;
    }
  }

  /** Install from a file someone copied over, e.g. on a USB stick: the .tar.bz2 or an unpacked folder. */
  async importFrom(source, onProgress) {
    if (this.busy) throw new Error("Another model is already being set up.");
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      const key = Object.keys(CATALOG).find((k) => path.basename(source) === CATALOG[k].folder);
      if (!key) throw new Error(`That folder isn't a AMIDisplay speech model. Expected one named ${Object.values(CATALOG).map((m) => m.folder).join(" or ")}.`);
      this.busy = { key, step: "unpack" };
      try {
        fs.cpSync(source, this.dir(key), { recursive: true });
        if (!this.installed(key)) throw new Error("Some model files are missing from that folder.");
        return key;
      } finally { this.busy = null; }
    }
    const key = Object.keys(CATALOG).find((k) => path.basename(source) === CATALOG[k].file);
    if (!key) throw new Error(`That file isn't a AMIDisplay speech model. Expected ${Object.values(CATALOG).map((m) => m.file).join(" or ")}.`);
    this.busy = { key, step: "unpack" };
    try { await this.extract(key, source, onProgress); } finally { this.busy = null; }
    return key;
  }

  async extract(key, archive, onProgress) {
    onProgress?.({ key, step: "unpack" });
    if (this.busy) this.busy.step = "unpack";
    // Windows 10 and later ship tar.exe, which unpacks much faster than doing it in JavaScript.
    const viaSystemTar = await new Promise((resolve) => {
      const { spawn } = require("node:child_process");
      const p = spawn("tar", ["-xjf", archive, "-C", this.root], { windowsHide: true });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
    });
    if (!viaSystemTar || !this.installed(key)) {
      const tar = await import("tar");
      const bz2 = require("unbzip2-stream");
      await pipeline(fs.createReadStream(archive), bz2(), tar.x({ cwd: this.root, filter: (p) => !p.includes("test_wavs") }));
    }
    fs.rmSync(path.join(this.dir(key), "test_wavs"), { recursive: true, force: true });
    if (!this.installed(key)) throw new Error("The model didn't unpack completely. Try again.");
    onProgress?.({ key, step: "done" });
  }

  remove(key) {
    fs.rmSync(this.dir(key), { recursive: true, force: true });
  }
}

module.exports = { Models, CATALOG };
