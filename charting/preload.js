/*
 * preload.js — 렌더러에 최소한의 창 제어 API만 안전하게 노출
 * (contextIsolation 사용, nodeIntegration 미사용)
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetAPI", {
  minimize: () => ipcRenderer.send("win:minimize"),
  close: () => ipcRenderer.send("win:close")
});
