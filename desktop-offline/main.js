const { app, BrowserWindow } = require("electron");

let serverRef = null;

async function createWindow(port) {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "宽宽牌教室分配系统",
    backgroundColor: "#0b1220",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  serverRef = require("./server").start(app);
  await createWindow(serverRef.port);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow(serverRef.port);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
