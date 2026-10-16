// The bridge between the AMIDisplay page and the desktop app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("amidisplayDesktop", {
  info: () => ipcRenderer.invoke("app:info"),

  // Speech models
  listModels: () => ipcRenderer.invoke("models:list"),
  downloadModel: (key) => ipcRenderer.invoke("models:download", key),
  importModel: () => ipcRenderer.invoke("models:import"),
  removeModel: (key) => ipcRenderer.invoke("models:remove", key),
  onModelProgress: (cb) => ipcRenderer.on("models:progress", (_e, p) => cb(p)),

  // Listening
  startEngine: (model) => ipcRenderer.invoke("engine:start", model),
  stopEngine: () => ipcRenderer.send("engine:stop"),
  sendAudio: (samples) => ipcRenderer.send("engine:audio", samples),
  onEngine: (cb) => ipcRenderer.on("engine:event", (_e, msg) => cb(msg)),

  // Projector
  listScreens: () => ipcRenderer.invoke("screens:list"),
  openProjector: (displayId) => ipcRenderer.invoke("screens:open", displayId),
  closeProjector: () => ipcRenderer.invoke("screens:close"),
});
