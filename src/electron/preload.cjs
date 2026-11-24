// Brücke ins Fenster. Läuft in der Sandbox, deshalb CommonJS und nur `electron`.
// Freigegeben sind genau die Kanäle aus src/shared/ipc.ts; ipc.test.ts prüft das.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const INVOKE = ["canvas:list", "canvas:get", "canvas:current", "canvas:add-images", "canvas:paste-image", "edit:native-paste", "canvas:apply-layout", "canvas:remove-items", "canvas:restore-items", "canvas:remove-versions", "canvas:restore-versions", "annotation:add", "annotation:update", "annotation:remove", "annotation:restore", "review:finish", "review:open-list", "voice:utterance", "voice:log", "settings:get", "settings:set", "usage:get", "voice:status", "settings:set-key", "canvas:open", "canvas:create", "canvas:thumbnail"];
const EVENTS = ["canvas:opened", "canvas:changed", "reviews:changed", "view:stage", "view:settings", "edit:undo", "edit:redo", "edit:paste", "view:canvases", "view:new-canvas"];

contextBridge.exposeInMainWorld("canvasBridge", {
  // Seit Electron 32 hat ein gezogenes File kein .path mehr; den Pfad gibt nur webUtils.
  pathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  invoke(channel, ...args) {
    if (!INVOKE.includes(channel)) return Promise.reject(new Error(`channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  // Kanäle von Erweiterungen (src/shared/extensions.ts): nur ext:<erweiterung>:<name>.
  invokeExtension(channel, ...args) {
    if (!/^ext:[a-z0-9-]+:[a-z0-9-]+$/.test(channel)) return Promise.reject(new Error(`channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENTS.includes(channel)) throw new Error(`channel not allowed: ${channel}`);
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
