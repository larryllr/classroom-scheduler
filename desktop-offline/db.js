const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { cleanCsvIds, isDate, toInt } = require("./utils");

/* -------------------- response helpers -------------------- */
function reply(res, data, code = 200) {
  res.status(code).set("content-type", "application/json; charset=utf-8").send(JSON.stringify(data));
}
function bad(res, msg, code = 400) {
  reply(res, { ok: false, message: msg }, code);
}

/* -------------------- slot meta (08:00-23:00, 90min, no gap) -------------------- */
const SLOTS = [
  { index: 0, start: "08:00", end: "09:30" },
  { index: 1, start: "09:30", end: "11:00" },
  { index: 2, start: "11:00", end: "12:30" },
  { index: 3, start: "12:30", end: "14:00" },
  { index: 4, start: "14:00", end: "15:30" },
  { index: 5, start: "15:30", end: "17:00" },
  { index: 6, start: "17:00", end: "18:30" },
  { index: 7, start: "18:30", end: "20:00" },
  { index: 8, start: "20:00", end: "21:30" },
  { index: 9, start: "21:30", end: "23:00" },
];
const FULL_MASK = (1 << SLOTS.length) - 1; // 1023

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
      allow_switch INTEGER NOT NULL DEFAULT 1,            -- 1可换教室 0同日固定教室
      preferred_room_ids TEXT,                            -- "1,2,3"
      avail_mask INTEGER NOT NULL DEFAULT ${FULL_MASK}     -- 可上时间段mask
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT,
      avail_mask INTEGER NOT NULL DEFAULT ${FULL_MASK}
    );

    -- 排课任务：某班某日由老师在指定时间段授课（90分钟/节）
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time_index INTEGER,
      prefer_room_ids TEXT
    );

    -- 具体排课结果：按“每个时间段一条”落表（查询快，输出简单）
    CREATE TABLE IF NOT EXISTS schedule_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      time_index INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
    CREATE INDEX IF NOT EXISTS idx_sched_date ON schedule_slots(date);
    CREATE INDEX IF NOT EXISTS idx_sched_room ON schedule_slots(date, room_id, time_index);
    CREATE INDEX IF NOT EXISTS idx_sched_teacher ON schedule_slots(date, teacher_id, time_index);
    CREATE INDEX IF NOT EXISTS idx_sched_class ON schedule_slots(date, class_id, time_index);
  `);

  const ensureColumn = (table, column, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.find((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  };
  ensureColumn("teachers", "subject", "TEXT");
  ensureColumn("tasks", "time_index", "INTEGER");

  return db;
}

/* -------------------- solver helpers -------------------- */
function bit(i) {
  return 1 << i;
}
function blockMask(start, len) {
  let m = 0;
  for (let k = 0; k < len; k++) m |= bit(start + k);
  return m;
}
function hasAll(mask, need) {
  return (mask & need) === need;
}
function overlapMask(a, b) {
  return (a & b) !== 0;
}
function isPrefixMask(mask) {
  let sawZero = false;
  for (let i = 0; i < SLOTS.length; i++) {
    const on = (mask & (1 << i)) !== 0;
    if (!on) sawZero = true;
    if (on && sawZero) return false;
  }
  return true;
}
function orderedRoomsGlobal(rooms) {
  const r = [...rooms];
  r.sort((a, b) => a.priority - b.priority || a.capacity - b.capacity || a.id - b.id);
  return r;
}
function orderedRoomsFor(cls, taskPrefer, rooms) {
  // 合并：任务偏好优先 > 班级偏好 > 全局优先级
  const base = orderedRoomsGlobal(rooms);

  const taskIds = cleanCsvIds(taskPrefer).split(",").map(Number).filter(Boolean);
  const clsIds = cleanCsvIds(cls.preferred_room_ids).split(",").map(Number).filter(Boolean);

  const pickBy = (ids) => ids.map((id) => base.find((r) => Number(r.id) === id)).filter(Boolean);
  const taskFirst = pickBy(taskIds);
  const clsNext = pickBy(clsIds.filter((id) => !taskIds.includes(id)));

  const used = new Set([...taskFirst, ...clsNext].map((x) => Number(x.id)));
  const rest = base.filter((r) => !used.has(Number(r.id)));

  return [...taskFirst, ...clsNext, ...rest];
}

/* -------------------- API -------------------- */
const api = {
  /* meta */
  getMeta(db, res) {
    reply(res, { ok: true, slots: SLOTS, full_mask: FULL_MASK });
  },

  /* rooms */
  getRooms(db, res) {
    const rows = db.prepare("SELECT * FROM rooms ORDER BY priority ASC, capacity ASC, id ASC").all();
    reply(res, rows);
  },
  addRoom(db, req, res) {
    const name = String(req.body?.name || "").trim();
    const capacity = toInt(req.body?.capacity);
    const priority = toInt(req.body?.priority, 100);
    if (!name) return bad(res, "请填写教室名称");
    if (!Number.isFinite(capacity) || capacity <= 0) return bad(res, "容量必须是正数");
    if (!Number.isFinite(priority)) return bad(res, "优先级必须是数字");
    db.prepare("INSERT INTO rooms(name,capacity,priority) VALUES (?,?,?)").run(name, capacity, priority);
    reply(res, { ok: true });
  },
  delRoom(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "教室ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM schedule_slots WHERE room_id=?").run(id);
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
        SELECT
          c.*,
          (SELECT GROUP_CONCAT(r.name, ' > ')
             FROM rooms r
            WHERE ',' || IFNULL(c.preferred_room_ids,'') || ','
              LIKE '%,' || r.id || ',%') AS preferred_rooms
        FROM classes c
        ORDER BY c.id DESC
      `
      )
      .all();
    reply(res, rows);
  },
  addClass(db, req, res) {
    const name = String(req.body?.name || "").trim();
    const size = toInt(req.body?.size);
    const allow_switch = req.body?.allow_switch ? 1 : 0;
    const preferred_room_ids = cleanCsvIds(req.body?.preferred_room_ids);
    const avail_mask = toInt(req.body?.avail_mask, FULL_MASK);
    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "班级可上时间段设置错误");
    if (!isPrefixMask(avail_mask)) return bad(res, "班级可上时间段需从第一节开始连续勾选");
    db.prepare(
      "INSERT INTO classes(name,size,allow_switch,preferred_room_ids,avail_mask) VALUES (?,?,?,?,?)"
    ).run(name, size, allow_switch, preferred_room_ids, avail_mask);
    reply(res, { ok: true });
  },
  updateClass(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "班级ID错误");
    const name = String(req.body?.name || "").trim();
    const size = toInt(req.body?.size);
    const allow_switch = req.body?.allow_switch ? 1 : 0;
    const preferred_room_ids = cleanCsvIds(req.body?.preferred_room_ids);
    const avail_mask = toInt(req.body?.avail_mask, FULL_MASK);
    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "班级可上时间段设置错误");
    if (!isPrefixMask(avail_mask)) return bad(res, "班级可上时间段需从第一节开始连续勾选");

    db.prepare(
      "UPDATE classes SET name=?, size=?, allow_switch=?, preferred_room_ids=?, avail_mask=? WHERE id=?"
    ).run(name, size, allow_switch, preferred_room_ids, avail_mask, id);

    reply(res, { ok: true });
  },
  delClass(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "班级ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM schedule_slots WHERE class_id=?").run(id);
      db.prepare("DELETE FROM tasks WHERE class_id=?").run(id);
      db.prepare("DELETE FROM classes WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* teachers */
  getTeachers(db, res) {
    const rows = db.prepare("SELECT * FROM teachers ORDER BY id DESC").all();
    reply(res, rows);
  },
  addTeacher(db, req, res) {
    const name = String(req.body?.name || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const avail_mask = toInt(req.body?.avail_mask, FULL_MASK);
    if (!name) return bad(res, "请填写教师姓名");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "教师可上时间段设置错误");
    if (!isPrefixMask(avail_mask)) return bad(res, "教师可上时间段需从第一节开始连续勾选");
    db.prepare("INSERT INTO teachers(name,subject,avail_mask) VALUES (?,?,?)").run(name, subject, avail_mask);
    reply(res, { ok: true });
  },
  updateTeacher(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "教师ID错误");
    const name = String(req.body?.name || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const avail_mask = toInt(req.body?.avail_mask, FULL_MASK);
    if (!name) return bad(res, "请填写教师姓名");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "教师可上时间段设置错误");
    if (!isPrefixMask(avail_mask)) return bad(res, "教师可上时间段需从第一节开始连续勾选");
    db.prepare("UPDATE teachers SET name=?, subject=?, avail_mask=? WHERE id=?").run(
      name,
      subject,
      avail_mask,
      id
    );
    reply(res, { ok: true });
  },
  delTeacher(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "教师ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM schedule_slots WHERE teacher_id=?").run(id);
      db.prepare("DELETE FROM tasks WHERE teacher_id=?").run(id);
      db.prepare("DELETE FROM teachers WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* tasks */
  getTasks(db, req, res) {
    const class_id = toInt(req.query.class_id || 0);
    const date = String(req.query.date || "").trim();
    let where = "WHERE 1=1 ";
    const binds = [];
    if (class_id) {
      where += " AND t.class_id=? ";
      binds.push(class_id);
    }
    if (date) {
      if (!isDate(date)) return bad(res, "日期格式错误，应为 YYYY-MM-DD");
      where += " AND t.date=? ";
      binds.push(date);
    }

    const rows = db
      .prepare(
        `
        SELECT
          t.*,
          c.name AS class_name,
          te.name AS teacher_name,
          COALESCE(te.subject, "") AS course_name
        FROM tasks t
        LEFT JOIN classes c ON c.id=t.class_id
        LEFT JOIN teachers te ON te.id=t.teacher_id
        ${where}
        ORDER BY t.date DESC, t.id DESC
      `
      )
      .all(...binds);

    reply(res, { items: rows });
  },

  addTaskDates(db, req, res) {
    const class_id = toInt(req.body?.class_id);
    const teacher_ids = Array.isArray(req.body?.teacher_ids)
      ? req.body.teacher_ids.map((t) => toInt(t)).filter(Boolean)
      : [toInt(req.body?.teacher_id)].filter(Boolean);
    const time_indexes = Array.isArray(req.body?.time_indexes)
      ? req.body.time_indexes.map((t) => toInt(t)).filter((t) => Number.isFinite(t))
      : [toInt(req.body?.time_index)].filter((t) => Number.isFinite(t));
    const prefer_room_ids = cleanCsvIds(req.body?.prefer_room_ids);

    const dates = Array.isArray(req.body?.dates) ? req.body.dates.map(String) : [];

    if (!class_id) return bad(res, "请选择班级");
    if (!teacher_ids.length) return bad(res, "请选择教师");
    if (!time_indexes.length) return bad(res, "请选择时间段");
    if (!dates.length) return bad(res, "请从日历选择至少1个日期");
    if (dates.some((d) => !isDate(d))) return bad(res, "日期格式错误（应为 YYYY-MM-DD）");
    if (time_indexes.some((t) => t < 0 || t >= SLOTS.length)) return bad(res, "时间段不合法");

    const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(class_id);
    if (!cls) return bad(res, "班级不存在");
    const classAvail = toInt(cls.avail_mask, FULL_MASK);

    const uniq = Array.from(new Set(dates)).sort();
    const ins = db.prepare(
      "INSERT INTO tasks(class_id,teacher_id,date,time_index,prefer_room_ids) VALUES (?,?,?,?,?)"
    );

    const tx = db.transaction(() => {
      for (const d of uniq) {
        for (const teacher_id of teacher_ids) {
          const te = db.prepare("SELECT * FROM teachers WHERE id=?").get(teacher_id);
          if (!te) throw new Error("教师不存在");
          const teacherAvail = toInt(te.avail_mask, FULL_MASK);
          for (const idx of time_indexes) {
            if ((classAvail & (1 << idx)) === 0) {
              throw new Error(`班级「${cls.name}」不可上 ${SLOTS[idx]?.start}-${SLOTS[idx]?.end}`);
            }
            if ((teacherAvail & (1 << idx)) === 0) {
              throw new Error(`教师「${te.name}」不可上 ${SLOTS[idx]?.start}-${SLOTS[idx]?.end}`);
            }
            ins.run(class_id, teacher_id, d, idx, prefer_room_ids);
          }
        }
      }
    });
    try {
      tx();
      reply(res, { ok: true, count: uniq.length });
    } catch (e) {
      bad(res, e && e.message ? e.message : "添加任务失败");
    }
  },

  delTask(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "任务ID错误");
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM schedule_slots WHERE task_id=?").run(id);
      db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    });
    tx();
    reply(res, { ok: true });
  },

  /* solve schedule */
  solveSchedule(db, _req, res) {
    const rooms = db.prepare("SELECT * FROM rooms").all();
    const classes = db.prepare("SELECT * FROM classes").all();
    const teachers = db.prepare("SELECT * FROM teachers").all();
    const tasks = db
      .prepare(
        `
        SELECT t.*,
               c.name AS class_name, c.size AS class_size, c.allow_switch, c.preferred_room_ids, c.avail_mask AS class_avail_mask,
               te.name AS teacher_name, te.avail_mask AS teacher_avail_mask, te.subject AS teacher_subject
        FROM tasks t
        LEFT JOIN classes c ON c.id=t.class_id
        LEFT JOIN teachers te ON te.id=t.teacher_id
        ORDER BY t.date ASC, t.time_index ASC, t.id ASC
      `
      )
      .all();

    if (!rooms.length) return bad(res, "还没有教室");
    if (!classes.length) return bad(res, "还没有班级");
    if (!teachers.length) return bad(res, "还没有教师");
    if (!tasks.length) return bad(res, "还没有排课任务（先去“排课任务”里用日历批量添加）");

    for (const t of tasks) {
      if (!t.class_name) return bad(res, `存在任务引用了不存在的班级（task_id=${t.id}）`);
      if (!t.teacher_name) return bad(res, `存在任务引用了不存在的教师（task_id=${t.id}）`);
      if (t.time_index == null || t.time_index < 0 || t.time_index >= SLOTS.length) {
        return bad(res, `任务缺少时间段（task_id=${t.id}）`);
      }
    }

    const roomOcc = {};    // roomOcc[date][roomId] = mask
    const teacherOcc = {}; // teacherOcc[date][teacherId] = mask
    const classOcc = {};   // classOcc[date][classId] = mask

    function getOcc(map, date, id) {
      map[date] ||= {};
      const k = String(id);
      map[date][k] ||= 0;
      return map[date][k];
    }
    function setOcc(map, date, id, mask) {
      map[date] ||= {};
      map[date][String(id)] = mask;
    }

    const delAll = db.prepare("DELETE FROM schedule_slots");
    const insSlot = db.prepare(
      "INSERT INTO schedule_slots(date,time_index,room_id,class_id,teacher_id,task_id) VALUES (?,?,?,?,?,?)"
    );
    const roomsSorted = orderedRoomsGlobal(rooms);
    const orderedRoomsForClass = (cls) => orderedRoomsFor(cls, null, roomsSorted);

    const fixedGroups = new Map();
    const flexTasks = [];
    for (const t of tasks) {
      const key = `${t.class_id}-${t.date}`;
      if (Number(t.allow_switch) === 0) {
        if (!fixedGroups.has(key)) fixedGroups.set(key, []);
        fixedGroups.get(key).push(t);
      } else {
        flexTasks.push(t);
      }
    }

    const tx = db.transaction(() => {
      delAll.run();

      for (const list of fixedGroups.values()) {
        list.sort((a, b) => a.time_index - b.time_index);
        const cls = list[0];
        const classId = Number(cls.class_id);
        const size = Number(cls.class_size);
        const date = cls.date;

        let chosenRoom = null;
        for (const room of orderedRoomsForClass(cls)) {
          if (room.capacity < size) continue;
          let ok = true;
          for (const t of list) {
            const slot = Number(t.time_index);
            const classOccMask = getOcc(classOcc, date, classId);
            const roomOccMask = getOcc(roomOcc, date, room.id);
            const teacherOccMask = getOcc(teacherOcc, date, t.teacher_id);
            if (overlapMask(classOccMask, 1 << slot)) { ok = false; break; }
            if (overlapMask(roomOccMask, 1 << slot)) { ok = false; break; }
            if (overlapMask(teacherOccMask, 1 << slot)) { ok = false; break; }
          }
          if (ok) { chosenRoom = room; break; }
        }

        if (!chosenRoom) {
          throw new Error(`无可行解：${date}（${cls.class_name}）设置为“同日固定教室”，但无法找到满足容量/冲突的教室。`);
        }

        for (const t of list) {
          const slot = Number(t.time_index);
          const teacherId = Number(t.teacher_id);
          const classOccMask = getOcc(classOcc, date, classId);
          const roomOccMask = getOcc(roomOcc, date, chosenRoom.id);
          const teacherOccMask = getOcc(teacherOcc, date, teacherId);
          if (overlapMask(classOccMask, 1 << slot) || overlapMask(roomOccMask, 1 << slot) || overlapMask(teacherOccMask, 1 << slot)) {
            throw new Error(`无可行解：${date}（${t.class_name} - ${t.teacher_name}）时间段冲突。`);
          }
          setOcc(classOcc, date, classId, classOccMask | (1 << slot));
          setOcc(roomOcc, date, chosenRoom.id, roomOccMask | (1 << slot));
          setOcc(teacherOcc, date, teacherId, teacherOccMask | (1 << slot));
          insSlot.run(date, slot, chosenRoom.id, classId, teacherId, t.id);
        }
      }

      for (const t of flexTasks) {
        const slot = Number(t.time_index);
        const date = t.date;
        const classId = Number(t.class_id);
        const teacherId = Number(t.teacher_id);
        const classOccMask = getOcc(classOcc, date, classId);
        const teacherOccMask = getOcc(teacherOcc, date, teacherId);
        if (overlapMask(classOccMask, 1 << slot) || overlapMask(teacherOccMask, 1 << slot)) {
          throw new Error(`无可行解：${date}（${t.class_name} - ${t.teacher_name}）时间段冲突。`);
        }

        let placed = false;
        for (const room of orderedRoomsForClass(t)) {
          if (room.capacity < t.class_size) continue;
          const roomOccMask = getOcc(roomOcc, date, room.id);
          if (overlapMask(roomOccMask, 1 << slot)) continue;
          setOcc(classOcc, date, classId, classOccMask | (1 << slot));
          setOcc(roomOcc, date, room.id, roomOccMask | (1 << slot));
          setOcc(teacherOcc, date, teacherId, teacherOccMask | (1 << slot));
          insSlot.run(date, slot, room.id, classId, teacherId, t.id);
          placed = true;
          break;
        }

        if (!placed) {
          throw new Error(`无可行解：${date}（${t.class_name} - ${t.teacher_name}）无法安排该时间段：可能是教室容量不足/时间段冲突。`);
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

  /* schedule: room */
  getRoomSchedule(db, req, res) {
    const date = String(req.query.date || "").trim();
    const room_id = toInt(req.query.room_id || 0);

    let where = "WHERE 1=1 ";
    const binds = [];

    if (date) {
      if (!isDate(date)) return bad(res, "日期格式错误，应为 YYYY-MM-DD");
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
        SELECT
          s.date, s.time_index, s.room_id, r.name AS room_name,
          s.class_id, c.name AS class_name,
          s.teacher_id, te.name AS teacher_name,
          s.task_id, COALESCE(te.subject, "") AS course_name
        FROM schedule_slots s
        LEFT JOIN rooms r ON r.id=s.room_id
        LEFT JOIN classes c ON c.id=s.class_id
        LEFT JOIN teachers te ON te.id=s.teacher_id
        ${where}
        ORDER BY r.name ASC, s.date ASC, s.time_index ASC, c.name ASC
      `
      )
      .all(...binds);

    reply(res, { ok: true, items: rows });
  },

  /* schedule: teacher */
  getTeacherSchedule(db, req, res) {
    const date = String(req.query.date || "").trim();
    const teacher_id = toInt(req.query.teacher_id || 0);

    let where = "WHERE 1=1 ";
    const binds = [];

    if (date) {
      if (!isDate(date)) return bad(res, "日期格式错误，应为 YYYY-MM-DD");
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
        SELECT
          s.date, s.time_index, s.room_id, r.name AS room_name,
          s.class_id, c.name AS class_name,
          s.teacher_id, te.name AS teacher_name,
          s.task_id, COALESCE(te.subject, "") AS course_name
        FROM schedule_slots s
        LEFT JOIN rooms r ON r.id=s.room_id
        LEFT JOIN classes c ON c.id=s.class_id
        LEFT JOIN teachers te ON te.id=s.teacher_id
        ${where}
        ORDER BY te.name ASC, s.date ASC, s.time_index ASC, c.name ASC
      `
      )
      .all(...binds);

    reply(res, { ok: true, items: rows });
  },

  /* export/import */
  exportData(db, res) {
    const data = {
      meta: { slots: SLOTS, full_mask: FULL_MASK },
      rooms: db.prepare("SELECT * FROM rooms").all(),
      classes: db.prepare("SELECT * FROM classes").all(),
      teachers: db.prepare("SELECT * FROM teachers").all(),
      tasks: db.prepare("SELECT * FROM tasks").all(),
      schedule_slots: db.prepare("SELECT * FROM schedule_slots").all(),
    };
    reply(res, data);
  },

  importData(db, req, res) {
    const d = req.body;
    if (!d) return bad(res, "数据为空");

    const tx = db.transaction(() => {
      db.exec("DELETE FROM schedule_slots;DELETE FROM tasks;DELETE FROM teachers;DELETE FROM classes;DELETE FROM rooms;");

      for (const r of d.rooms || []) {
        db.prepare("INSERT INTO rooms(id,name,capacity,priority) VALUES (?,?,?,?)").run(
          r.id,
          r.name,
          r.capacity,
          r.priority
        );
      }
      for (const c of d.classes || []) {
        db.prepare(
          "INSERT INTO classes(id,name,size,allow_switch,preferred_room_ids,avail_mask) VALUES (?,?,?,?,?,?)"
        ).run(
          c.id,
          c.name,
          c.size,
          c.allow_switch,
          c.preferred_room_ids,
          c.avail_mask ?? FULL_MASK
        );
      }
      for (const t of d.teachers || []) {
        db.prepare("INSERT INTO teachers(id,name,subject,avail_mask) VALUES (?,?,?,?)").run(
          t.id,
          t.name,
          t.subject ?? "",
          t.avail_mask ?? FULL_MASK
        );
      }
      for (const t of d.tasks || []) {
        db.prepare("INSERT INTO tasks(id,class_id,teacher_id,date,time_index,prefer_room_ids) VALUES (?,?,?,?,?,?)").run(
          t.id,
          t.class_id,
          t.teacher_id,
          t.date,
          t.time_index ?? null,
          t.prefer_room_ids
        );
      }
      for (const s of d.schedule_slots || []) {
        db.prepare("INSERT INTO schedule_slots(id,date,time_index,room_id,class_id,teacher_id,task_id) VALUES (?,?,?,?,?,?,?)").run(
          s.id,
          s.date,
          s.time_index,
          s.room_id,
          s.class_id,
          s.teacher_id,
          s.task_id
        );
      }
    });

    try {
      tx();
      reply(res, { ok: true });
    } catch (e) {
      bad(res, e && e.message ? e.message : "导入失败");
    }
  },
};

module.exports = { initDb, api };
