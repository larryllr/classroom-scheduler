const express = require("express");
const path = require("path");
const { initDb, api } = require("./db");

let currentPort = null;

function start(electronApp) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const db = initDb(electronApp);

  /* -------- meta -------- */
  app.get("/api/meta", (req, res) => api.getMeta(db, res));

  /* -------- rooms -------- */
  app.get("/api/rooms", (req, res) => api.getRooms(db, res));
  app.post("/api/rooms", (req, res) => api.addRoom(db, req, res));
  app.delete("/api/rooms/:id", (req, res) => api.delRoom(db, req, res));

  /* -------- classes -------- */
  app.get("/api/classes", (req, res) => api.getClasses(db, res));
  app.post("/api/classes", (req, res) => api.addClass(db, req, res));
  app.put("/api/classes/:id", (req, res) => api.updateClass(db, req, res));
  app.delete("/api/classes/:id", (req, res) => api.delClass(db, req, res));

  /* -------- teachers -------- */
  app.get("/api/teachers", (req, res) => api.getTeachers(db, res));
  app.post("/api/teachers", (req, res) => api.addTeacher(db, req, res));
  app.put("/api/teachers/:id", (req, res) => api.updateTeacher(db, req, res));
  app.delete("/api/teachers/:id", (req, res) => api.delTeacher(db, req, res));

  /* -------- tasks (date + teacher + periods) -------- */
  app.get("/api/tasks", (req, res) => api.getTasks(db, req, res));
  app.post("/api/tasks/add_dates", (req, res) => api.addTaskDates(db, req, res));
  app.delete("/api/tasks/:id", (req, res) => api.delTask(db, req, res));

  /* -------- schedule solve & outputs -------- */
  app.post("/api/schedule/solve", (req, res) => api.solveSchedule(db, req, res));
  app.get("/api/schedule/room", (req, res) => api.getRoomSchedule(db, req, res));
  app.get("/api/schedule/teacher", (req, res) => api.getTeacherSchedule(db, req, res));

  /* -------- export / import -------- */
  app.get("/api/export", (req, res) => api.exportData(db, res));
  app.post("/api/import", (req, res) => api.importData(db, req, res));

  /* -------- static frontend -------- */
  const pub = path.join(__dirname, "public");
  app.use(express.static(pub));
  app.get("*", (_, res) => res.sendFile(path.join(pub, "index.html")));

  const server = app.listen(0, "127.0.0.1", () => {
    currentPort = server.address().port;
    console.log("Local server listening on", currentPort);
  });
}

function getPort() {
  return currentPort;
}

module.exports = { start, getPort };