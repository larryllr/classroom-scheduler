const express = require("express");
const path = require("path");
const { initDb, api } = require("./db");

function start(electronApp) {
  const app = express();
  app.use(express.json({ limit: "20mb" })); // 备份文件可能大一点

  const db = initDb(electronApp);

  // 简单 token（离线单机够用）
  const auth = api.makeAuth(db);

  function needAuth(req, res, next) {
    // 未设置密码 => 直接放行
    if (!auth.hasPassword()) return next();
    const token = String(req.headers["x-auth"] || "");
    if (!auth.verifyToken(token)) return res.status(401).json({ ok: false, message: "未登录或登录已失效" });
    next();
  }

  // Auth
  app.get("/api/auth/status", (req,res)=> api.authStatus(db,res));
  app.post("/api/auth/set_password", (req,res)=> api.setPassword(db,req,res));     // 第一次设置或重置（需旧密码）
  app.post("/api/auth/login", (req,res)=> api.login(db,req,res));                 // 返回 token
  app.post("/api/auth/logout", (req,res)=> api.logout(db,req,res));               // 让 token 失效

  // 基础数据（可不强制登录，你也可以改成 needAuth 全部保护）
  app.get("/api/rooms", (req,res)=>api.getRooms(db,res));
  app.post("/api/rooms", needAuth, (req,res)=>api.addRoom(db,req,res));
  app.delete("/api/rooms/:id", needAuth, (req,res)=>api.delRoom(db,req,res));

  app.get("/api/classes", (req,res)=>api.getClasses(db,res));
  app.post("/api/classes", needAuth, (req,res)=>api.addClass(db,req,res));
  app.delete("/api/classes/:id", needAuth, (req,res)=>api.delClass(db,req,res));

  app.get("/api/courses", (req,res)=>api.getCourses(db,res));
  app.post("/api/course/add_dates", needAuth, (req,res)=>api.addCourseDates(db,req,res));
  app.delete("/api/course/:id", needAuth, (req,res)=>api.delCourse(db,req,res));

  app.get("/api/timetable/class/:id", (req,res)=>api.getTimetable(db,req,res));
  app.post("/api/solve", needAuth, (req,res)=>api.solve(db,req,res));

  // 备份/恢复（JSON）
  app.get("/api/backup", needAuth, (req,res)=>api.backup(db,res));
  app.post("/api/restore", needAuth, (req,res)=>api.restore(db,req,res));

  // 导出 Excel / Word（按班级+范围）
  app.get("/api/export/excel/class/:id", needAuth, (req,res)=>api.exportExcel(db,req,res));
  app.get("/api/export/word/class/:id", needAuth, (req,res)=>api.exportWord(db,req,res));

  // 静态页面
  const pub = path.join(__dirname, "public");
  app.use(express.static(pub));
  app.get("*", (_,res)=>res.sendFile(path.join(pub, "index.html")));

  const server = app.listen(0, "127.0.0.1");
  return { port: server.address().port };
}

module.exports = { start };
