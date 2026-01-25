const path = require("path");
const fs = require("fs");
const express = require("express");
const { initDb, api } = require("./db");

let _server = null;
let _port = null;

function getPort() {
  return _port;
}

function safeSendFile(res, filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      res.status(404).send("Not Found: " + filePath);
      return;
    }
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).send(String(e && e.stack ? e.stack : e));
  }
}

function start(electronApp) {
  if (_server) return;

  const app = express();
  app.disable("x-powered-by");

  // 记录请求（定位“加载中”卡在哪）
  app.use((req, _res, next) => {
    try {
      console.log(`[REQ] ${req.method} ${req.url}`);
    } catch {}
    next();
  });

  app.use(express.json({ limit: "2mb" }));

  const db = initDb(electronApp);

  // --- API health check
  app.get("/api/ping", (_req, res) => res.json({ ok: true, time: Date.now() }));
  app.get("/api/meta", (_req, res) => api.getMeta(db, res));

  // --- rooms
  app.get("/api/rooms", (_req, res) => api.getRooms(db, res));
  app.post("/api/rooms", (req, res) => api.addRoom(db, req, res));
  app.delete("/api/rooms/:id", (req, res) => api.delRoom(db, req, res));

  // --- classes
  app.get("/api/classes", (_req, res) => api.getClasses(db, res));
  app.post("/api/classes", (req, res) => api.addClass(db, req, res));
  app.put("/api/classes/:id", (req, res) => api.updateClass(db, req, res));
  app.delete("/api/classes/:id", (req, res) => api.delClass(db, req, res));

  // --- teachers
  app.get("/api/teachers", (_req, res) => api.getTeachers(db, res));
  app.post("/api/teachers", (req, res) => api.addTeacher(db, req, res));
  app.put("/api/teachers/:id", (req, res) => api.updateTeacher(db, req, res));
  app.delete("/api/teachers/:id", (req, res) => api.delTeacher(db, req, res));

  // --- tasks
  app.get("/api/tasks", (req, res) => api.getTasks(db, req, res));
  app.post("/api/tasks/add-dates", (req, res) => api.addTaskDates(db, req, res));
  app.delete("/api/tasks/:id", (req, res) => api.delTask(db, req, res));

  // --- solve
  app.post("/api/solve", (req, res) => api.solveSchedule(db, req, res));

  // --- schedules
  app.get("/api/schedule/rooms", (req, res) => api.getRoomSchedule(db, req, res));
  app.get("/api/schedule/teachers", (req, res) => api.getTeacherSchedule(db, req, res));

  // --- export/import
  app.get("/api/export", (_req, res) => api.exportData(db, res));
  app.post("/api/import", (req, res) => api.importData(db, req, res));

  // ---------- Static (important) ----------
  // app.asar 内 public 路径
  const publicDir = path.join(__dirname, "public");
  const indexHtml = path.join(publicDir, "index.html");

  // 静态文件（app.js / css / 图标等）
  app.use(express.static(publicDir, { maxAge: "1d", etag: true }));

  // SPA/主页兜底：任何非 /api 的路径都返回 index.html
  app.get("/", (_req, res) => safeSendFile(res, indexHtml));
  app.get(/^\/(?!api\/).*/, (_req, res) => safeSendFile(res, indexHtml));

  // 错误处理
  app.use((err, _req, res, _next) => {
    console.error("[EXPRESS_ERR]", err && err.stack ? err.stack : err);
    res.status(500).json({ ok: false, message: "Server error", detail: String(err) });
  });

  // 监听随机端口（避免被占用）
  _server = app.listen(0, "127.0.0.1", () => {
    _port = _server.address().port;
    console.log("Local server listening on", _port);
    console.log("Try:", `http://127.0.0.1:${_port}/api/ping`);
  });
}

module.exports = { start, getPort };
