const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { start, getPort } = require("./server");

function ensureLogs(appInstance) {
  try {
    const dir = appInstance.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, "last.log");
    const write = (line) => {
      try {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`, "utf8");
      } catch {}
    };

    write("==== App Start ====");
    write(`userData=${dir}`);
    write(`appPath=${appInstance.getAppPath()}`);
    write(`exe=${process.execPath}`);

    // mirror console to log
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => {
      origLog(...args);
      write(args.map(String).join(" "));
    };
    console.error = (...args) => {
      origErr(...args);
      write("[ERR] " + args.map(String).join(" "));
    };

    process.on("uncaughtException", (e) => {
      write("[uncaughtException] " + (e && e.stack ? e.stack : String(e)));
    });
    process.on("unhandledRejection", (e) => {
      write("[unhandledRejection] " + (e && e.stack ? e.stack : String(e)));
    });

    return { logFile, write };
  } catch {
    return { logFile: "", write: () => {} };
  }
}

let mainWindow = null;

function createWindow(port, logger) {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0b1220",
    title: "宽宽牌教室分配系统",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = `http://127.0.0.1:${port}/`;
  logger.write("Loading URL: " + url);
  win.loadURL(url);

  // 如果加载失败，弹提示并给出日志路径
  win.webContents.on("did-fail-load", async (_e, code, desc, validatedURL) => {
    logger.write(`did-fail-load code=${code} desc=${desc} url=${validatedURL}`);
    await dialog.showMessageBox(win, {
      type: "error",
      title: "启动失败",
      message: "程序页面加载失败。",
      detail:
        `可能原因：本地服务未启动或被安全软件拦截。\n\n` +
        `请把日志文件发给我排查：\n${logger.logFile}`,
    });
  });

  // 打开开发者工具（需要时可取消注释）
  // win.webContents.openDevTools({ mode: "detach" });

  return win;
}

app.setName("宽宽牌教室分配系统");

app.whenReady().then(() => {
  const logger = ensureLogs(app);

  try {
    // 启动本地服务（express + sqlite）
    start(app);

    // 等端口就绪再开窗口
    const tryOpen = () => {
      const port = getPort();
      if (!port) return setTimeout(tryOpen, 80);
      mainWindow = createWindow(port, logger);
    };
    tryOpen();
  } catch (e) {
    logger.write("Start failed: " + (e && e.stack ? e.stack : String(e)));
    dialog.showErrorBox(
      "启动失败",
      "程序启动失败，请把日志 last.log 发给我排查。\n\n路径：" + logger.logFile
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const port = getPort();
      if (port) mainWindow = createWindow(port, logger);
    }
  });
});

// Windows/Linux 关窗退出
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});