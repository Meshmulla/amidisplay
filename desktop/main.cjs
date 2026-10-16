// AMIDisplay desktop app (Windows). Serves the same pages as the web version from this
// computer, and listens with a speech model that runs on this computer, so nothing needs
// the internet once a model is installed.

const { app, BrowserWindow, ipcMain, dialog, screen, session, net, Menu, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { Models } = require("./models.cjs");

// Native code can't read from inside the app archive, so these live in the unpacked folder.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const ROOT = path.join(__dirname, "..");
const VAD_MODEL = unpacked(path.join(__dirname, "assets", "silero_vad.onnx"));

let consoleWin = null;
let projectorWin = null;
let baseUrl = "";
let models = null;

// ---------------------------------------------------------------------------
// Local web server for the pages (module workers and fetch need http, not file://)

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}desktop${path.sep}`)) {
        res.writeHead(403).end();
        return;
      }
      if (url.pathname === "/") file = path.join(ROOT, "index.html");
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404).end("Not found"); return; }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
        res.end(body);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

// ---------------------------------------------------------------------------
// Windows

function createConsole() {
  consoleWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: "#13162a",
    title: "AMIDisplay",
    icon: path.join(ROOT, "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  consoleWin.loadURL(`${baseUrl}/index.html?desktop=1`);
  consoleWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes("display.html")) { openProjector(); return { action: "deny" }; }
    shell.openExternal(url);
    return { action: "deny" };
  });
  consoleWin.on("closed", () => {
    consoleWin = null;
    projectorWin?.close();
    app.quit();
  });
}

function displays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    name: d.label || `Screen ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primary,
  }));
}

/** Opens the projector screen, full screen on the projector if one is connected. */
function openProjector(displayId) {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = all.find((d) => d.id === displayId) || all.find((d) => d.id !== primary.id) || null;
  if (projectorWin) projectorWin.close();
  const onProjector = Boolean(target && target.id !== primary.id);
  const b = target ? target.bounds : { x: undefined, y: undefined, width: 1280, height: 720 };
  projectorWin = new BrowserWindow({
    x: b.x, y: b.y,
    width: onProjector ? b.width : 1280,
    height: onProjector ? b.height : 720,
    backgroundColor: "#12152a",
    title: "AMIDisplay screen",
    frame: !onProjector,
    autoHideMenuBar: true,
    fullscreen: onProjector,
    webPreferences: { contextIsolation: true },
  });
  projectorWin.loadURL(`${baseUrl}/display.html`);
  projectorWin.on("closed", () => { projectorWin = null; });
  return { onProjector, name: target ? displays().find((d) => d.id === target.id)?.name : null };
}

// ---------------------------------------------------------------------------
// Speech engine

let engine = null;
let engineModel = null;
let engineReady = null;

function send(channel, msg) {
  consoleWin?.webContents.send(channel, msg);
}

function startEngine(key) {
  if (!models.installed(key)) {
    return Promise.reject(new Error("That speech model isn't installed yet. Open Settings to install it."));
  }
  if (engine && engineModel === key) return engineReady;
  engine?.terminate();
  engine = new Worker(unpacked(path.join(__dirname, "engine-worker.cjs")));
  engineModel = key;
  const { CATALOG } = require("./models.cjs");
  engineReady = new Promise((resolve, reject) => {
    let ready = false;
    const fail = (err) => {
      engine?.terminate();
      engine = null;
      engineModel = null;
      reject(err);
    };
    engine.on("error", (err) => (ready ? send("engine:event", { type: "error", message: err.message }) : fail(err)));
    engine.on("message", (msg) => {
      if (msg.type === "ready") { ready = true; resolve({ ms: msg.ms }); return; }
      if (msg.type === "error" && !ready) { fail(new Error(msg.message)); return; }
      send("engine:event", msg);
    });
  });
  engine.postMessage({ type: "load", kind: CATALOG[key].kind, dir: models.dir(key), vadModel: VAD_MODEL });
  return engineReady;
}

// ---------------------------------------------------------------------------
// IPC

function wire() {
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, modelsFolder: models.root }));

  ipcMain.handle("models:list", () => models.list());
  ipcMain.handle("models:download", async (_e, key) => {
    await models.download(key, (url) => net.fetch(url), (p) => send("models:progress", p));
    return models.list();
  });
  ipcMain.handle("models:import", async () => {
    const pick = await dialog.showOpenDialog(consoleWin, {
      title: "Choose a AMIDisplay speech model",
      buttonLabel: "Install model",
      properties: ["openFile"],
      filters: [{ name: "Speech model", extensions: ["bz2"] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { list: models.list(), imported: null };
    const key = await models.importFrom(pick.filePaths[0], (p) => send("models:progress", p));
    return { list: models.list(), imported: key };
  });
  ipcMain.handle("models:remove", (_e, key) => {
    if (engineModel === key) { engine?.terminate(); engine = null; engineModel = null; }
    models.remove(key);
    return models.list();
  });

  ipcMain.handle("engine:start", async (_e, key) => startEngine(key));
  ipcMain.on("engine:audio", (_e, samples) => engine?.postMessage({ type: "audio", samples }));
  ipcMain.on("engine:stop", () => engine?.postMessage({ type: "flush" }));

  ipcMain.handle("screens:list", () => displays());
  ipcMain.handle("screens:open", (_e, id) => openProjector(id));
  ipcMain.handle("screens:close", () => { projectorWin?.close(); });
}

// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const modelsDir = path.join(app.getPath("userData"), "models");
  // The app used to be called FlashDisplay. Reuse a speech model it already downloaded.
  const oldModels = path.join(app.getPath("appData"), "FlashDisplay", "models");
  if (!fs.existsSync(modelsDir) && fs.existsSync(oldModels)) {
    try { fs.mkdirSync(path.dirname(modelsDir), { recursive: true }); fs.renameSync(oldModels, modelsDir); } catch { /* fall back to a fresh download */ }
  }
  models = new Models(modelsDir);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["media", "clipboard-sanitized-write", "fullscreen"].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ["media", "clipboard-sanitized-write", "fullscreen"].includes(permission));
  baseUrl = await startServer();
  wire();
  createConsole();
  // If the projector is plugged in or unplugged mid-service, let the console know.
  const notify = () => send("engine:event", { type: "screens", screens: displays() });
  screen.on("display-added", notify);
  screen.on("display-removed", notify);
});

app.on("window-all-closed", () => app.quit());
