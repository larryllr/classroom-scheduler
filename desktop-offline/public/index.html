const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

function reply(res, data, code = 200) {
  res.status(code)
    .set("content-type", "application/json; charset=utf-8")
    .send(JSON.stringify(data));
}
function bad(res, msg, code = 400) {
  reply(res, { ok: false, message: msg }, code);
}

function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}
function overlap(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}
function isDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d || "");
}

function initDb(electronApp) {
  const dir = path.join(electronApp.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "classroom.db");
  const db = new Database(file);

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      allow_switch INTEGER NOT NULL DEFAULT 1,
      preferred_room_ids TEXT
    );

    CREATE TABLE IF NOT EXISTS course_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignments (
      course_instance_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL
    );
  `);

  return db;
}

const api = {
  /* rooms */
  getRooms(db, res) {
    const rows = db.prepare("SELECT * FROM rooms ORDER BY priority ASC, capacity ASC").all();
    reply(res, rows);
  },
  addRoom(db, req, res) {
    const name = String(req.body?.name || "").trim();
    const capacity = Number(req.body?.capacity);
    const priority = Number(req.body?.priority ?? 100);

    if (!name) return bad(res, "请填写教室名称");
    if (!Number.isFinite(capacity) || capacity <= 0) return bad(res, "容量必须是正数");
    if (!Number.isFinite(priority)) return bad(res, "优先级必须是数字");

    db.prepare("INSERT INTO rooms(name,capacity,priority) VALUES (?,?,?)").run(
      name,
      capacity,
      priority
    );
    reply(res, { ok: true });
  },
  delRoom(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "教室ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM assignments WHERE room_id=?").run(id);
      db.prepare("DELETE FROM rooms WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* classes */
  getClasses(db, res) {
    const rows = db
      .prepare(
        `
      SELECT c.*,
        (
          SELECT GROUP_CONCAT(r.name, ' > ')
          FROM rooms r
          WHERE ',' || IFNULL(c.preferred_room_ids,'') || ',' LIKE '%,' || r.id || ',%'
        ) AS preferred_rooms
      FROM classes c
      ORDER BY c.id DESC
    `
      )
      .all();
    reply(res, rows);
  },
  addClass(db, req, res) {
    const name = String(req.body?.name || "").trim();
    const size = Number(req.body?.size);
    const allow_switch = req.body?.allow_switch ? 1 : 0;
    const preferred_room_ids = String(req.body?.preferred_room_ids || "").trim();

    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");

    db.prepare("INSERT INTO classes(name,size,allow_switch,preferred_room_ids) VALUES (?,?,?,?)").run(
      name,
      size,
      allow_switch,
      preferred_room_ids
    );
    reply(res, { ok: true });
  },
  delClass(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "班级ID错误");

    const courseIds = db
      .prepare("SELECT id FROM course_instances WHERE class_id=?")
      .all(id)
      .map((x) => x.id);

    const delAssign = db.prepare("DELETE FROM assignments WHERE course_instance_id=?");
    const delCourse = db.prepare("DELETE FROM course_instances WHERE id=?");

    const tx = db.transaction(() => {
      for (const cid of courseIds) {
        delAssign.run(cid);
        delCourse.run(cid);
      }
      db.prepare("DELETE FROM classes WHERE id=?").run(id);
    });
    tx();

    reply(res, { ok: true });
  },

  /* courses */
  getCourses(db, req, res) {
    const class_id = Number(req.query.class_id || 0);
    let sql = `
      SELECT ci.*, c.name AS class_name
      FROM course_instances ci
      LEFT JOIN classes c ON c.id=ci.class_id
    `;
    const binds = [];
    if (class_id) {
      sql += " WHERE ci.class_id=? ";
      binds.push(class_id);
    }
    sql += " ORDER BY ci.date DESC, ci.start_time ASC ";
    const rows = binds.length ? db.prepare(sql).all(...binds) : db.prepare(sql).all();
    reply(res, rows);
  },

  addCourseDates(db, req, res) {
    const class_id = Number(req.body?.class_id);
    const title = String(req.body?.title || "").trim();
    const dates = Array.isArray(req.body?.dates) ? req.body.dates.map(String) : [];
    const start_time = String(req.body?.start_time || "").trim();
    const end_time = String(req.body?.end_time || "").trim();

    if (!class_id) return bad(res, "请选择班级");
    if (!title) return bad(res, "请填写课程名");
    if (!dates.length) return bad(res, "请从日历选择至少1个日期");
    if (dates.some((d) => !isDate(d))) return bad(res, "日期格式错误");

    const s = toMin(start_time),
      e = toMin(end_time);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s)
      return bad(res, "时间格式错误：HH:MM 且 结束>开始");

    const uniq = Array.from(new Set(dates)).sort();
    const ins = db.prepare(
      "INSERT INTO course_instances(class_id,title,date,start_time,end_time) VALUES(?,?,?,?,?)"
    );

    const tx = db.transaction(() => {
      for (const d of uniq) ins.run(class_id, title, d, start_time, end_time);
    });
    tx();

    reply(res, { ok: true, count: uniq.length });
  },

  delCourse(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "课程ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM assignments WHERE course_instance_id=?").run(id);
      db.prepare("DELETE FROM course_instances WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* timetable per class */
  getTimetable(db, req, res) {
    const classId = Number(req.params.id);
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(classId);
    if (!cls) return bad(res, "班级不存在", 404);

    let where = "WHERE ci.class_id=? ";
    const binds = [classId];

    if (from && isDate(from)) {
      where += " AND ci.date>=? ";
      binds.push(from);
    }
    if (to && isDate(to)) {
      where += " AND ci.date<=? ";
      binds.push(to);
    }

    const rows = db
      .prepare(
        `
      SELECT ci.id, ci.date, ci.start_time, ci.end_time, ci.title,
             r.name AS room_name
      FROM course_instances ci
      LEFT JOIN assignments a ON a.course_instance_id = ci.id
      LEFT JOIN rooms r ON r.id = a.room_id
      ${where}
      ORDER BY ci.date ASC, ci.start_time ASC
    `
      )
      .all(...binds);

    reply(res, { class_name: cls.name, items: rows });
  },

  /* timetable all */
  getAllTimetable(db, req, res) {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    let where = "WHERE 1=1 ";
    const binds = [];

    if (from && isDate(from)) {
      where += " AND ci.date>=? ";
      binds.push(from);
    }
    if (to && isDate(to)) {
      where += " AND ci.date<=? ";
      binds.push(to);
    }

    const rows = db
      .prepare(
        `
      SELECT ci.date, ci.start_time, ci.end_time, c.name AS class_name, ci.title,
             r.name AS room_name
      FROM course_instances ci
      LEFT JOIN classes c ON c.id=ci.class_id
      LEFT JOIN assignments a ON a.course_instance_id = ci.id
      LEFT JOIN rooms r ON r.id = a.room_id
      ${where}
      ORDER BY ci.date ASC, ci.start_time ASC, c.name ASC
    `
      )
      .all(...binds);

    reply(res, { items: rows });
  },

  /* solve */
  solve(db, req, res) {
    const rooms = db.prepare("SELECT * FROM rooms").all();
    const classes = db.prepare("SELECT * FROM classes").all();
    const courses = db.prepare("SELECT * FROM course_instances").all();

    if (!rooms.length) return bad(res, "还没有教室");
    if (!classes.length) return bad(res, "还没有班级");
    if (!courses.length) return bad(res, "还没有课程");

    rooms.sort((a, b) => a.priority - b.priority || a.capacity - b.capacity);
    const classById = new Map(classes.map((c) => [Number(c.id), c]));

    function orderedRoomsForClass(cls) {
      const pref = String(cls.preferred_room_ids || "").trim();
      if (!pref) return rooms;
      const ids = pref.split(",").map(Number).filter(Boolean);
      const prefRooms = ids.map((id) => rooms.find((r) => Number(r.id) === id)).filter(Boolean);
      const rest = rooms.filter((r) => !ids.includes(Number(r.id)));
      return [...prefRooms, ...rest];
    }

    const occupied = {}; // occupied[roomId][date] => [{s,e}]
    function isFree(roomId, date, s, e) {
      const rid = String(roomId);
      const list = occupied[rid]?.[date] || [];
      return !list.some((x) => overlap(s, e, x.s, x.e));
    }
    function occupy(roomId, date, s, e) {
      const rid = String(roomId);
      occupied[rid] ||= {};
      occupied[rid][date] ||= [];
      occupied[rid][date].push({ s, e });
    }

    const norm = courses.map((c) => {
      const cls = classById.get(Number(c.class_id));
      if (!cls) throw new Error("课程对应班级不存在");
      const date = String(c.date || "").trim();
      if (!isDate(date)) throw new Error(`课程「${c.title}」缺少日期`);
      const s = toMin(c.start_time),
        e = toMin(c.end_time);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s)
        throw new Error(`课程「${c.title}」时间格式错误`);
      return { ...c, _cls: cls, _date: date, _s: s, _e: e, _groupKey: `${c.class_id}-${date}` };
    });

    // 同一天固定教室：allow_switch=0
    const fixedGroups = new Map();
    const flex = [];
    for (const c of norm) {
      const allow = Number(c._cls.allow_switch);
      if (allow === 0) {
        if (!fixedGroups.has(c._groupKey)) fixedGroups.set(c._groupKey, []);
        fixedGroups.get(c._groupKey).push(c);
      } else {
        flex.push(c);
      }
    }
    const fixedList = Array.from(fixedGroups.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    const insAssign = db.prepare("INSERT INTO assignments(course_instance_id, room_id) VALUES (?,?)");
    const delAllAssign = db.prepare("DELETE FROM assignments");

    const tx = db.transaction(() => {
      delAllAssign.run();

      // 固定组先排
      for (const [, arr] of fixedList) {
        arr.sort((x, y) => x._s - y._s);
        const cls = arr[0]._cls;
        const size = Number(cls.size);
        const date = arr[0]._date;

        let chosen = null;
        for (const r of orderedRoomsForClass(cls)) {
          if (Number(r.capacity) < size) continue;
          let ok = true;
          for (const c of arr) {
            if (!isFree(Number(r.id), date, c._s, c._e)) { ok = false; break; }
          }
          if (ok) { chosen = r; break; }
        }
        if (!chosen) {
          throw new Error(`无可行解：班级「${cls.name}」在 ${date} 设置为“当天不换教室”，但没有任何教室能同时容纳且不冲突。`);
        }
        for (const c of arr) {
          occupy(Number(chosen.id), date, c._s, c._e);
          insAssign.run(Number(c.id), Number(chosen.id));
        }
      }

      // 可换教室逐条排
      flex.sort((a, b) => a._date.localeCompare(b._date) || a._s - b._s);
      for (const c of flex) {
        const cls = c._cls;
        const size = Number(cls.size);
        const date = c._date;

        let placed = false;
        for (const r of orderedRoomsForClass(cls)) {
          if (Number(r.capacity) < size) continue;
          if (!isFree(Number(r.id), date, c._s, c._e)) continue;
          occupy(Number(r.id), date, c._s, c._e);
          insAssign.run(Number(c.id), Number(r.id));
          placed = true;
          break;
        }
        if (!placed) {
          throw new Error(`无可行解：${date} ${c.start_time}-${c.end_time}（${cls.name} - ${c.title}）没有可用教室（容量/冲突）。`);
        }
      }
    });

    try {
      tx();
      reply(res, { ok: true, message: "排课完成（离线本地计算）" });
    } catch (e) {
      bad(res, e.message || "排课失败");
    }
  },

  /* export/import JSON */
  exportData(db, res) {
    const data = {
      rooms: db.prepare("SELECT * FROM rooms").all(),
      classes: db.prepare("SELECT * FROM classes").all(),
      courses: db.prepare("SELECT * FROM course_instances").all(),
      assignments: db.prepare("SELECT * FROM assignments").all()
    };
    reply(res, data);
  },
  importData(db, req, res) {
    const d = req.body;
    if (!d) return bad(res, "数据为空");

    const tx = db.transaction(() => {
      db.exec("DELETE FROM assignments;DELETE FROM course_instances;DELETE FROM classes;DELETE FROM rooms;");

      for (const r of d.rooms || []) {
        db.prepare("INSERT INTO rooms(id,name,capacity,priority) VALUES (?,?,?,?)")
          .run(r.id, r.name, r.capacity, r.priority);
      }
      for (const c of d.classes || []) {
        db.prepare("INSERT INTO classes(id,name,size,allow_switch,preferred_room_ids) VALUES (?,?,?,?,?)")
          .run(c.id, c.name, c.size, c.allow_switch, c.preferred_room_ids);
      }
      for (const ci of d.courses || []) {
        db.prepare("INSERT INTO course_instances(id,class_id,title,date,start_time,end_time) VALUES (?,?,?,?,?,?)")
          .run(ci.id, ci.class_id, ci.title, ci.date, ci.start_time, ci.end_time);
      }
      for (const a of d.assignments || []) {
        db.prepare("INSERT INTO assignments(course_instance_id,room_id) VALUES (?,?)")
          .run(a.course_instance_id, a.room_id);
      }
    });

    tx();
    reply(res, { ok: true });
  }
};

module.exports = { initDb, api };
