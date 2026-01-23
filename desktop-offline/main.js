const { app, BrowserWindow } = require("electron");
const path = require("path");

let server;
let splashWin;
let mainWin;

function createSplash() {
  splashWin = new BrowserWindow({
    width: 520,
    height: 320,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  splashWin.loadFile(path.join(__dirname, "public", "splash.html"));
}

async function createMain(port) {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "宽宽牌教室分配系统",
    backgroundColor: "#0b1220",
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  await mainWin.loadURL(`http://127.0.0.1:${port}/`);

  if (splashWin) {
    splashWin.close();
    splashWin = null;
  }
}

app.whenReady().then(async () => {
  createSplash();
  server = require("./server").start(app);
  await createMain(server.port);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
