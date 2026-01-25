const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

/* -------------------- helpers -------------------- */
function reply(res, data, code = 200) {
  res.status(code).set("content-type", "application/json; charset=utf-8").send(JSON.stringify(data));
}
function bad(res, msg, code = 400) {
  reply(res, { ok: false, message: msg }, code);
}
function isDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d || "");
}
function hhmmToMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!m) return NaN;
  const h = Number(m[1]), mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return NaN;
  return h * 60 + mm;
}
function minToHHMM(m) {
  const h = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${h}:${mm}`;
}
function buildSlots() {
  // 08:00 -> 23:00, 90min, no gaps => 10 slots
  const slots = [];
  let cur = 8 * 60;
  const end = 23 * 60;
  const len = 90;
  let idx = 0;
  while (cur + len <= end) {
    slots.push({ index: idx++, start: cur, end: cur + len });
    cur += len;
  }
  return slots; // len=10
}
const SLOTS = buildSlots();
const SLOT_COUNT = SLOTS.length; // 10
const FULL_MASK = (1 << SLOT_COUNT) - 1; // 1023

function normalizeMask(mask) {
  const n = Number(mask);
  if (!Number.isFinite(n)) return FULL_MASK;
  // limit to 10 bits
  return n & FULL_MASK;
}
function bitCount(x) {
  x = x >>> 0;
  let c = 0;
  while (x) {
    x &= (x - 1) >>> 0;
    c++;
  }
  return c;
}
function blockMask(startIndex, periods) {
  return (((1 << periods) - 1) << startIndex) & FULL_MASK;
}
function parsePreferIds(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
}

/* -------------------- DB init -------------------- */
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
      preferred_room_ids TEXT,
      avail_mask INTEGER NOT NULL DEFAULT ${FULL_MASK},
      min_continuous INTEGER NOT NULL DEFAULT 1
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

    /* --- New: teachers --- */
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avail_mask INTEGER NOT NULL DEFAULT ${FULL_MASK},
      min_continuous INTEGER NOT NULL DEFAULT 1
    );

    /* --- New: class course tasks (date-based) --- */
    CREATE TABLE IF NOT EXISTS class_course_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      course_name TEXT NOT NULL,
      teacher_id INTEGER NOT NULL,
      periods INTEGER NOT NULL,
      prefer_room_ids TEXT
    );

    /* --- New: schedule result slots (one row per time_index) --- */
    CREATE TABLE IF NOT EXISTS schedule_slots (
      date TEXT NOT NULL,
      time_index INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      course_name TEXT NOT NULL
    );
  `);

  return db;
}

/* -------------------- API -------------------- */
const api = {
  /* ---------- meta ---------- */
  getMeta(db, res) {
    reply(res, {
      ok: true,
      slot_count: SLOT_COUNT,
      slots: SLOTS.map((s) => ({
        index: s.index,
        start: minToHHMM(s.start),
        end: minToHHMM(s.end),
      })),
      full_mask: FULL_MASK,
    });
  },

  /* ---------- rooms ---------- */
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
    db.prepare("INSERT INTO rooms(name,capacity,priority) VALUES (?,?,?)").run(name, capacity, priority);
    reply(res, { ok: true });
  },
  delRoom(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "教室ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM assignments WHERE room_id=?").run(id);
      db.prepare("DELETE FROM schedule_slots WHERE room_id=?").run(id);
      db.prepare("DELETE FROM rooms WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* ---------- classes ---------- */
  getClasses(db, res) {
    const rows = db
      .prepare(
        `
        SELECT c.*,
        (SELECT GROUP_CONCAT(r.name, ' > ') FROM rooms r
          WHERE ',' || IFNULL(c.preferred_room_ids,'') || ',' LIKE '%,' || r.id || ',%') AS preferred_rooms
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
    const avail_mask = normalizeMask(req.body?.avail_mask ?? FULL_MASK);
    const min_continuous = Number(req.body?.min_continuous ?? 1);

    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");
    if (!Number.isFinite(min_continuous) || min_continuous <= 0 || min_continuous > SLOT_COUNT)
      return bad(res, `班级连续节数必须是 1-${SLOT_COUNT}`);

    db.prepare(
      "INSERT INTO classes(name,size,allow_switch,preferred_room_ids,avail_mask,min_continuous) VALUES (?,?,?,?,?,?)"
    ).run(name, size, allow_switch, preferred_room_ids, avail_mask, Math.floor(min_continuous));
    reply(res, { ok: true });
  },
  updateClass(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "班级ID错误");

    const name = String(req.body?.name || "").trim();
    const size = Number(req.body?.size);
    const allow_switch = req.body?.allow_switch ? 1 : 0;
    const preferred_room_ids = String(req.body?.preferred_room_ids || "").trim();
    const avail_mask = normalizeMask(req.body?.avail_mask ?? FULL_MASK);
    const min_continuous = Number(req.body?.min_continuous ?? 1);

    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");
    if (!Number.isFinite(min_continuous) || min_continuous <= 0 || min_continuous > SLOT_COUNT)
      return bad(res, `班级连续节数必须是 1-${SLOT_COUNT}`);

    db.prepare(
      "UPDATE classes SET name=?, size=?, allow_switch=?, preferred_room_ids=?, avail_mask=?, min_continuous=? WHERE id=?"
    ).run(name, size, allow_switch, preferred_room_ids, avail_mask, Math.floor(min_continuous), id);

    reply(res, { ok: true });
  },
  delClass(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "班级ID错误");

    const tx = db.transaction(() => {
      // old courses
      const courseIds = db.prepare("SELECT id FROM course_instances WHERE class_id=?").all(id).map((x) => x.id);
      const delAssign = db.prepare("DELETE FROM assignments WHERE course_instance_id=?");
      const delCourse = db.prepare("DELETE FROM course_instances WHERE id=?");
      for (const cid of courseIds) {
        delAssign.run(cid);
        delCourse.run(cid);
      }
      // new tasks + schedule
      db.prepare("DELETE FROM class_course_tasks WHERE class_id=?").run(id);
      db.prepare("DELETE FROM schedule_slots WHERE class_id=?").run(id);

      db.prepare("DELETE FROM classes WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* ---------- teachers ---------- */
  getTeachers(db, res) {
    const rows = db.prepare("SELECT * FROM teachers ORDER BY id DESC").all();
    reply(res, rows);
  },
  addTeacher(db, req, res) {
    const name = String(req.body?.name || "").trim();
    const avail_mask = normalizeMask(req.body?.avail_mask ?? FULL_MASK);
    const min_continuous = Number(req.body?.min_continuous ?? 1);

    if (!name) return bad(res, "请填写教师姓名");
    if (!Number.isFinite(min_continuous) || min_continuous <= 0 || min_continuous > SLOT_COUNT)
      return bad(res, `教师连续节数必须是 1-${SLOT_COUNT}`);

    db.prepare("INSERT INTO teachers(name,avail_mask,min_continuous) VALUES (?,?,?)").run(
      name,
      avail_mask,
      Math.floor(min_continuous)
    );
    reply(res, { ok: true });
  },
  updateTeacher(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "教师ID错误");
    const name = String(req.body?.name || "").trim();
    const avail_mask = normalizeMask(req.body?.avail_mask ?? FULL_MASK);
    const min_continuous = Number(req.body?.min_continuous ?? 1);

    if (!name) return bad(res, "请填写教师姓名");
    if (!Number.isFinite(min_continuous) || min_continuous <= 0 || min_continuous > SLOT_COUNT)
      return bad(res, `教师连续节数必须是 1-${SLOT_COUNT}`);

    db.prepare("UPDATE teachers SET name=?, avail_mask=?, min_continuous=? WHERE id=?").run(
      name,
      avail_mask,
      Math.floor(min_continuous),
      id
    );
    reply(res, { ok: true });
  },
  delTeacher(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "教师ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM class_course_tasks WHERE teacher_id=?").run(id);
      db.prepare("DELETE FROM schedule_slots WHERE teacher_id=?").run(id);
      db.prepare("DELETE FROM teachers WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* ---------- tasks (date + teacher + periods) ---------- */
  getTasks(db, req, res) {
    const class_id = Number(req.query.class_id || 0);
    const date = String(req.query.date || "").trim();
    let where = "WHERE 1=1 ";
    const binds = [];
    if (class_id) {
      where += " AND t.class_id=? ";
      binds.push(class_id);
    }
    if (date && isDate(date)) {
      where += " AND t.date=? ";
      binds.push(date);
    }
    const rows = db
      .prepare(
        `
        SELECT t.*, c.name AS class_name, te.name AS teacher_name
        FROM class_course_tasks t
        LEFT JOIN classes c ON c.id=t.class_id
        LEFT JOIN teachers te ON te.id=t.teacher_id
        ${where}
        ORDER BY t.date DESC, t.id DESC
      `
      )
      .all(...binds);
    reply(res, rows);
  },
  addTaskDates(db, req, res) {
    const class_id = Number(req.body?.class_id);
    const course_name = String(req.body?.course_name || "").trim();
    const teacher_id = Number(req.body?.teacher_id);
    const periods = Number(req.body?.periods);
    const dates = Array.isArray(req.body?.dates) ? req.body.dates.map(String) : [];
    const prefer_room_ids = String(req.body?.prefer_room_ids || "").trim();

    if (!class_id) return bad(res, "请选择班级");
    if (!course_name) return bad(res, "请填写课程名");
    if (!teacher_id) return bad(res, "请选择教师");
    if (!Number.isFinite(periods) || periods <= 0 || periods > SLOT_COUNT) return bad(res, `连续节数必须是 1-${SLOT_COUNT}`);
    if (!dates.length) return bad(res, "请从日历选择至少1个日期");
    if (dates.some((d) => !isDate(d))) return bad(res, "日期格式错误");

    const uniq = Array.from(new Set(dates)).sort();
    const ins = db.prepare(
      "INSERT INTO class_course_tasks(class_id,date,course_name,teacher_id,periods,prefer_room_ids) VALUES(?,?,?,?,?,?)"
    );

    const tx = db.transaction(() => {
      for (const d of uniq) ins.run(class_id, d, course_name, teacher_id, Math.floor(periods), prefer_room_ids);
    });
    tx();

    reply(res, { ok: true, count: uniq.length });
  },
  delTask(db, req, res) {
    const id = Number(req.params.id);
    if (!id) return bad(res, "任务ID错误");
    db.prepare("DELETE FROM class_course_tasks WHERE id=?").run(id);
    reply(res, { ok: true });
  },

  /* ---------- schedule solve ---------- */
  solveSchedule(db, req, res) {
    // Clear previous schedule then compute new one
    const rooms = db.prepare("SELECT * FROM rooms").all();
    const classes = db.prepare("SELECT * FROM classes").all();
    const teachers = db.prepare("SELECT * FROM teachers").all();
    const tasks = db.prepare("SELECT * FROM class_course_tasks").all();

    if (!rooms.length) return bad(res, "还没有教室");
    if (!classes.length) return bad(res, "还没有班级");
    if (!teachers.length) return bad(res, "还没有教师");
    if (!tasks.length) return bad(res, "还没有排课任务（请选择日期+课程+教师+连续节数）");

    const classById = new Map(classes.map((c) => [Number(c.id), c]));
    const teacherById = new Map(teachers.map((t) => [Number(t.id), t]));

    // room ordering base: priority asc, capacity asc
    const roomsBase = [...rooms].sort((a, b) => a.priority - b.priority || a.capacity - b.capacity);

    // occupancy bitmasks: date -> id -> mask
    const classOcc = Object.create(null);
    const teacherOcc = Object.create(null);
    const roomOcc = Object.create(null);

    function getOcc(map, date, id) {
      map[date] ||= Object.create(null);
      return map[date][id] || 0;
    }
    function setOcc(map, date, id, mask) {
      map[date] ||= Object.create(null);
      map[date][id] = mask;
    }

    function orderedRoomsForTask(cls, taskPreferRoomIds) {
      // class preferred first, then task preferred, then rest
      const classPref = parsePreferIds(cls.preferred_room_ids);
      const taskPref = parsePreferIds(taskPreferRoomIds);

      const merged = [];
      const seen = new Set();

      const pushId = (id) => {
        if (!id || seen.has(id)) return;
        const r = roomsBase.find((x) => Number(x.id) === Number(id));
        if (r) {
          merged.push(r);
          seen.add(Number(id));
        }
      };

      for (const id of classPref) pushId(id);
      for (const id of taskPref) pushId(id);

      for (const r of roomsBase) {
        if (!seen.has(Number(r.id))) merged.push(r);
      }
      return merged;
    }

    // normalize tasks + validate
    const normTasks = tasks.map((t) => {
      const cls = classById.get(Number(t.class_id));
      const te = teacherById.get(Number(t.teacher_id));
      if (!cls) throw new Error("存在任务对应的班级不存在");
      if (!te) throw new Error("存在任务对应的教师不存在");
      const date = String(t.date || "").trim();
      if (!isDate(date)) throw new Error("存在任务日期格式错误");
      const periods = Number(t.periods);
      if (!Number.isFinite(periods) || periods <= 0 || periods > SLOT_COUNT) throw new Error("存在任务连续节数错误");
      return {
        id: Number(t.id),
        date,
        class_id: Number(t.class_id),
        teacher_id: Number(t.teacher_id),
        course_name: String(t.course_name || "").trim(),
        periods: Math.floor(periods),
        prefer_room_ids: String(t.prefer_room_ids || "").trim(),
        _class: cls,
        _teacher: te,
      };
    });

    // sort hardest first
    normTasks.sort((a, b) => {
      if (b.periods !== a.periods) return b.periods - a.periods;

      const ac = bitCount(normalizeMask(a._class.avail_mask));
      const bc = bitCount(normalizeMask(b._class.avail_mask));
      if (ac !== bc) return ac - bc;

      const at = bitCount(normalizeMask(a._teacher.avail_mask));
      const bt = bitCount(normalizeMask(b._teacher.avail_mask));
      if (at !== bt) return at - bt;

      // stable: date desc
      return b.date.localeCompare(a.date);
    });

    const inserts = []; // rows for schedule_slots

    function tryPlaceOne(task) {
      const cls = task._class;
      const te = task._teacher;

      const classAvail = normalizeMask(cls.avail_mask);
      const teacherAvail = normalizeMask(te.avail_mask);

      const classMinCont = Math.max(1, Math.min(SLOT_COUNT, Number(cls.min_continuous || 1)));
      const teacherMinCont = Math.max(1, Math.min(SLOT_COUNT, Number(te.min_continuous || 1)));

      // rule: this task's periods must satisfy both min_continuous limits
      if (task.periods < classMinCont) {
        throw new Error(`任务「${cls.name} - ${task.course_name}」连续节数(${task.periods}) < 班级最少连续节数(${classMinCont})`);
      }
      if (task.periods < teacherMinCont) {
        throw new Error(`任务「${cls.name} - ${task.course_name}」连续节数(${task.periods}) < 教师最少连续节数(${teacherMinCont})`);
      }

      const maxStart = SLOT_COUNT - task.periods;
      for (let start = 0; start <= maxStart; start++) {
        const mask = blockMask(start, task.periods);

        // class free + available
        const co = getOcc(classOcc, task.date, task.class_id);
        if ((co & mask) !== 0) continue;
        if ((classAvail & mask) !== mask) continue;

        // teacher free + available
        const to = getOcc(teacherOcc, task.date, task.teacher_id);
        if ((to & mask) !== 0) continue;
        if ((teacherAvail & mask) !== mask) continue;

        // find room
        const orderedRooms = orderedRoomsForTask(cls, task.prefer_room_ids);
        let chosen = null;

        for (const r of orderedRooms) {
          if (Number(r.capacity) < Number(cls.size)) continue;
          const ro = getOcc(roomOcc, task.date, Number(r.id));
          if ((ro & mask) !== 0) continue;

          chosen = r;
          break;
        }
        if (!chosen) continue;

        // occupy
        setOcc(classOcc, task.date, task.class_id, co | mask);
        setOcc(teacherOcc, task.date, task.teacher_id, to | mask);

        const rid = Number(chosen.id);
        const ro2 = getOcc(roomOcc, task.date, rid);
        setOcc(roomOcc, task.date, rid, ro2 | mask);

        // store slots
        for (let i = start; i < start + task.periods; i++) {
          inserts.push({
            date: task.date,
            time_index: i,
            class_id: task.class_id,
            teacher_id: task.teacher_id,
            room_id: rid,
            course_name: task.course_name,
          });
        }
        return true;
      }
      return false;
    }

    try {
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM schedule_slots").run();

        for (const task of normTasks) {
          const ok = tryPlaceOne(task);
          if (!ok) {
            throw new Error(`无可行解：${task.date} 「${task._class.name}」上「${task.course_name}」（教师：${task._teacher.name}，连续${task.periods}节）找不到可用时间段/教室（冲突或容量不足）。`);
          }
        }

        const ins = db.prepare(
          "INSERT INTO schedule_slots(date,time_index,class_id,teacher_id,room_id,course_name) VALUES(?,?,?,?,?,?)"
        );
        for (const row of inserts) {
          ins.run(row.date, row.time_index, row.class_id, row.teacher_id, row.room_id, row.course_name);
        }
      });
      tx();
      reply(res, { ok: true, message: "排课完成（08:00-23:00，90分钟/节）", count: inserts.length });
    } catch (e) {
      bad(res, e.message || "排课失败");
    }
  },

  /* ---------- schedule outputs ---------- */
  getRoomSchedule(db, req, res) {
    const date = String(req.query.date || "").trim();
    const room_id = Number(req.query.room_id || 0);
    let where = "WHERE 1=1 ";
    const binds = [];
    if (date && isDate(date)) {
      where += " AND s.date=? ";
      binds.push(date);
    }
    if (room_id) {
      where += " AND s.room_id=? ";
      binds.push(room_id);
    }

    const rows = db
      .prepare(
        `
        SELECT s.*, r.name AS room_name, c.name AS class_name, te.name AS teacher_name
        FROM schedule_slots s
        LEFT JOIN rooms r ON r.id=s.room_id
        LEFT JOIN classes c ON c.id=s.class_id
        LEFT JOIN teachers te ON te.id=s.teacher_id
        ${where}
        ORDER BY s.date ASC, s.room_id ASC, s.time_index ASC
      `
      )
      .all(...binds);

    reply(res, { ok: true, slots: SLOTS.map((x) => ({ ...x, start: minToHHMM(x.start), end: minToHHMM(x.end) })), items: rows });
  },

  getTeacherSchedule(db, req, res) {
    const date = String(req.query.date || "").trim();
    const teacher_id = Number(req.query.teacher_id || 0);
    let where = "WHERE 1=1 ";
    const binds = [];
    if (date && isDate(date)) {
      where += " AND s.date=? ";
      binds.push(date);
    }
    if (teacher_id) {
      where += " AND s.teacher_id=? ";
      binds.push(teacher_id);
    }

    const rows = db
      .prepare(
        `
        SELECT s.*, r.name AS room_name, c.name AS class_name, te.name AS teacher_name
        FROM schedule_slots s
        LEFT JOIN rooms r ON r.id=s.room_id
        LEFT JOIN classes c ON c.id=s.class_id
        LEFT JOIN teachers te ON te.id=s.teacher_id
        ${where}
        ORDER BY s.date ASC, s.teacher_id ASC, s.time_index ASC
      `
      )
      .all(...binds);

    reply(res, { ok: true, slots: SLOTS.map((x) => ({ ...x, start: minToHHMM(x.start), end: minToHHMM(x.end) })), items: rows });
  },

  /* ---------- export/import ---------- */
  exportData(db, res) {
    const data = {
      rooms: db.prepare("SELECT * FROM rooms").all(),
      classes: db.prepare("SELECT * FROM classes").all(),
      teachers: db.prepare("SELECT * FROM teachers").all(),
      tasks: db.prepare("SELECT * FROM class_course_tasks").all(),
      schedule: db.prepare("SELECT * FROM schedule_slots").all(),
      // keep old tables too
      courses: db.prepare("SELECT * FROM course_instances").all(),
      assignments: db.prepare("SELECT * FROM assignments").all(),
    };
    reply(res, data);
  },

  importData(db, req, res) {
    const d = req.body;
    if (!d) return bad(res, "数据为空");

    const tx = db.transaction(() => {
      db.exec(
        "DELETE FROM schedule_slots;DELETE FROM class_course_tasks;DELETE FROM teachers;DELETE FROM assignments;DELETE FROM course_instances;DELETE FROM classes;DELETE FROM rooms;"
      );

      for (const r of d.rooms || []) {
        db.prepare("INSERT INTO rooms(id,name,capacity,priority) VALUES (?,?,?,?)").run(r.id, r.name, r.capacity, r.priority);
      }
      for (const c of d.classes || []) {
        db.prepare(
          "INSERT INTO classes(id,name,size,allow_switch,preferred_room_ids,avail_mask,min_continuous) VALUES (?,?,?,?,?,?,?)"
        ).run(
          c.id,
          c.name,
          c.size,
          c.allow_switch ?? 1,
          c.preferred_room_ids ?? "",
          normalizeMask(c.avail_mask ?? FULL_MASK),
          Math.max(1, Math.min(SLOT_COUNT, Number(c.min_continuous ?? 1)))
        );
      }
      for (const t of d.teachers || []) {
        db.prepare("INSERT INTO teachers(id,name,avail_mask,min_continuous) VALUES (?,?,?,?)").run(
          t.id,
          t.name,
          normalizeMask(t.avail_mask ?? FULL_MASK),
          Math.max(1, Math.min(SLOT_COUNT, Number(t.min_continuous ?? 1)))
        );
      }
      for (const task of d.tasks || []) {
        db.prepare(
          "INSERT INTO class_course_tasks(id,class_id,date,course_name,teacher_id,periods,prefer_room_ids) VALUES (?,?,?,?,?,?,?)"
        ).run(
          task.id,
          task.class_id,
          task.date,
          task.course_name,
          task.teacher_id,
          task.periods,
          task.prefer_room_ids ?? ""
        );
      }
      for (const s of d.schedule || []) {
        db.prepare(
          "INSERT INTO schedule_slots(date,time_index,class_id,teacher_id,room_id,course_name) VALUES (?,?,?,?,?,?)"
        ).run(s.date, s.time_index, s.class_id, s.teacher_id, s.room_id, s.course_name);
      }

      // old
      for (const ci of d.courses || []) {
        db.prepare("INSERT INTO course_instances(id,class_id,title,date,start_time,end_time) VALUES (?,?,?,?,?,?)").run(
          ci.id,
          ci.class_id,
          ci.title,
          ci.date,
          ci.start_time,
          ci.end_time
        );
      }
      for (const a of d.assignments || []) {
        db.prepare("INSERT INTO assignments(course_instance_id,room_id) VALUES (?,?)").run(a.course_instance_id, a.room_id);
      }
    });

    tx();
    reply(res, { ok: true });
  },
};

module.exports = { initDb, api };