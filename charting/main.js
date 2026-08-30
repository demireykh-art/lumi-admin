/*
 * main.js — Electron 메인 프로세스
 * 웹 위젯(index.html)을 항상 위(always-on-top)·프레임 없는·드래그 이동 가능한
 * 작은 플로팅 창으로 띄웁니다. 데스크톱 구석에 상주하는 차팅 위젯 UX를 제공합니다.
 */
const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 360,
    height: 560,
    minWidth: 300,
    minHeight: 360,
    frame: false,            // 헤더를 CSS 드래그 영역으로 사용
    alwaysOnTop: true,       // 항상 위
    resizable: true,
    skipTaskbar: false,
    backgroundColor: "#faf9f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 다른 전체화면 앱(EMR 등) 위에도 떠 있도록
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  // 마이크 권한 자동 허용(로컬 위젯이므로)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === "media");
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 렌더러 → 메인 창 제어
ipcMain.on("win:minimize", () => { if (win) win.minimize(); });
ipcMain.on("win:close", () => { if (win) win.close(); });
