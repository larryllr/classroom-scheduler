const { app, BrowserWindow, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

const server = require("./server");

function log(text) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "last.log"), String(text), "utf-8");
  } catch {}
}

async function waitPort() {
  for (let i = 0; i < 100; i++) {
    const p = server.getPort();
    if (p) return p;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("本地服务启动超时");
}

async function createWindow(port) {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "宽宽牌教室分配系统",
    backgroundColor: "#0b1220",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.once("ready-to-show", () => win.show());
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    server.start(app);
    const port = await waitPort();
    await createWindow(port);
  } catch (e) {
    log(e.stack || e);
    dialog.showErrorBox(
      "宽宽牌教室分配系统（离线版）启动失败",
      String(e)
    );
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
