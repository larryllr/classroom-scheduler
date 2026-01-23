const express = require("express");
const path = require("path");
const { initDb, api } = require("./db");

let currentPort = null;

function start(electronApp) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const db = initDb(electronApp);

  // API
  app.get("/api/rooms", (req, res) => api.getRooms(db, res));
  app.post("/api/rooms", (req, res) => api.addRoom(db, req, res));
  app.delete("/api/rooms/:id", (req, res) => api.delRoom(db, req, res));

  app.get("/api/classes", (req, res) => api.getClasses(db, res));
  app.post("/api/classes", (req, res) => api.addClass(db, req, res));
  app.delete("/api/classes/:id", (req, res) => api.delClass(db, req, res));

  app.get("/api/courses", (req, res) => api.getCourses(db, req, res));
  app.post("/api/course/add_dates", (req, res) => api.addCourseDates(db, req, res));
  app.delete("/api/course/:id", (req, res) => api.delCourse(db, req, res));

  app.get("/api/timetable/class/:id", (req, res) => api.getTimetable(db, req, res));
  app.get("/api/timetable/all", (req, res) => api.getAllTimetable(db, req, res));

  app.post("/api/solve", (req, res) => api.solve(db, req, res));

  app.get("/api/export", (req, res) => api.exportData(db, res));
  app.post("/api/import", (req, res) => api.importData(db, req, res));

  // 静态前端
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
