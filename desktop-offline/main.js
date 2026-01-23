const { app, BrowserWindow, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

let serverRef = null;

function logToFile(text) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "last.log"), String(text), "utf-8");
  } catch (_) {}
}

function showFatal(err) {
  const msg =
    "程序启动失败。\n\n" +
    "请把这个错误截图发我，或者打开以下日志文件复制内容：\n" +
    path.join(app.getPath("userData"), "logs", "last.log") +
    "\n\n错误信息：\n" +
    (err && err.stack ? err.stack : String(err));

  logToFile(msg);
  try {
    dialog.showErrorBox("宽宽牌教室分配系统（离线版）启动失败", msg);
  } catch (_) {}
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

process.on("uncaughtException", (err) => showFatal(err));
process.on("unhandledRejection", (err) => showFatal(err));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    serverRef = require("./server").start(app);
    await createWindow(serverRef.port);
  } catch (err) {
    showFatal(err);
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        await createWindow(serverRef.port);
      } catch (err) {
        showFatal(err);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
