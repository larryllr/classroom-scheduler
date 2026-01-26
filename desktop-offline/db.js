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
      avail_mask INTEGER NOT NULL DEFAULT ${FULL_MASK},    -- 可上时间段mask
      min_continuous INTEGER NOT NULL DEFAULT 1            -- 最少连续节数（对每个任务要求）
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avail_mask INTEGER NOT NULL DEFAULT ${FULL_MASK},
      min_continuous INTEGER NOT NULL DEFAULT 1
    );

    -- 排课任务：某班某日上一门课，由某老师上，连续若干节（90分钟/节）
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      course_name TEXT NOT NULL,
      periods INTEGER NOT NULL DEFAULT 1,
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
    const min_continuous = Math.max(1, toInt(req.body?.min_continuous, 1));
    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "班级可上时间段设置错误");
    db.prepare(
      "INSERT INTO classes(name,size,allow_switch,preferred_room_ids,avail_mask,min_continuous) VALUES (?,?,?,?,?,?)"
    ).run(name, size, allow_switch, preferred_room_ids, avail_mask, min_continuous);
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
    const min_continuous = Math.max(1, toInt(req.body?.min_continuous, 1));
    if (!name) return bad(res, "请填写班级名称");
    if (!Number.isFinite(size) || size <= 0) return bad(res, "人数必须是正数");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "班级可上时间段设置错误");

    db.prepare(
      "UPDATE classes SET name=?, size=?, allow_switch=?, preferred_room_ids=?, avail_mask=?, min_continuous=? WHERE id=?"
    ).run(name, size, allow_switch, preferred_room_ids, avail_mask, min_continuous, id);

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
    const avail_mask = toInt(req.body?.avail_mask, FULL_MASK);
    const min_continuous = Math.max(1, toInt(req.body?.min_continuous, 1));
    if (!name) return bad(res, "请填写教师姓名");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "教师可上时间段设置错误");
    db.prepare("INSERT INTO teachers(name,avail_mask,min_continuous) VALUES (?,?,?)").run(
      name,
      avail_mask,
      min_continuous
    );
    reply(res, { ok: true });
  },
  updateTeacher(db, req, res) {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "教师ID错误");
    const name = String(req.body?.name || "").trim();
    const avail_mask = toInt(req.body?.avail_mask, FULL_MASK);
    const min_continuous = Math.max(1, toInt(req.body?.min_continuous, 1));
    if (!name) return bad(res, "请填写教师姓名");
    if (avail_mask < 0 || avail_mask > FULL_MASK) return bad(res, "教师可上时间段设置错误");
    db.prepare("UPDATE teachers SET name=?, avail_mask=?, min_continuous=? WHERE id=?").run(
      name,
      avail_mask,
      min_continuous,
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
          te.name AS teacher_name
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
    const teacher_id = toInt(req.body?.teacher_id);
    const course_name = String(req.body?.course_name || "").trim();
    const periods = Math.max(1, toInt(req.body?.periods, 1));
    const prefer_room_ids = cleanCsvIds(req.body?.prefer_room_ids);

    const dates = Array.isArray(req.body?.dates) ? req.body.dates.map(String) : [];

    if (!class_id) return bad(res, "请选择班级");
    if (!teacher_id) return bad(res, "请选择教师");
    if (!course_name) return bad(res, "请填写课程名称");
    if (!dates.length) return bad(res, "请从日历选择至少1个日期");
    if (dates.some((d) => !isDate(d))) return bad(res, "日期格式错误（应为 YYYY-MM-DD）");
    if (periods < 1 || periods > SLOTS.length) return bad(res, "连续节数不合法");

    const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(class_id);
    if (!cls) return bad(res, "班级不存在");
    const te = db.prepare("SELECT * FROM teachers WHERE id=?").get(teacher_id);
    if (!te) return bad(res, "教师不存在");

    // 连续节约束：任务的连续节必须 >= 班级最少连续、教师最少连续
    const cMin = Math.max(1, toInt(cls.min_continuous, 1));
    const tMin = Math.max(1, toInt(te.min_continuous, 1));
    if (periods < cMin) return bad(res, `连续节数不足：班级「${cls.name}」最少连续 ${cMin} 节`);
    if (periods < tMin) return bad(res, `连续节数不足：教师「${te.name}」最少连续 ${tMin} 节`);

    const uniq = Array.from(new Set(dates)).sort();
    const ins = db.prepare(
      "INSERT INTO tasks(class_id,teacher_id,date,course_name,periods,prefer_room_ids) VALUES (?,?,?,?,?,?)"
    );

    const tx = db.transaction(() => {
      for (const d of uniq) ins.run(class_id, teacher_id, d, course_name, periods, prefer_room_ids);
    });
    tx();
    reply(res, { ok: true, count: uniq.length });
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
               c.name AS class_name, c.size AS class_size, c.allow_switch, c.preferred_room_ids, c.avail_mask AS class_avail_mask, c.min_continuous AS class_min_cont,
               te.name AS teacher_name, te.avail_mask AS teacher_avail_mask, te.min_continuous AS teacher_min_cont
        FROM tasks t
        LEFT JOIN classes c ON c.id=t.class_id
        LEFT JOIN teachers te ON te.id=t.teacher_id
        ORDER BY t.date ASC, t.id ASC
      `
      )
      .all();

    if (!rooms.length) return bad(res, "还没有教室");
    if (!classes.length) return bad(res, "还没有班级");
    if (!teachers.length) return bad(res, "还没有教师");
    if (!tasks.length) return bad(res, "还没有排课任务（先去“排课任务”里用日历批量添加）");

    // 基本校验：班级/教师存在
    for (const t of tasks) {
      if (!t.class_name) return bad(res, `存在任务引用了不存在的班级（task_id=${t.id}）`);
      if (!t.teacher_name) return bad(res, `存在任务引用了不存在的教师（task_id=${t.id}）`);
      const p = toInt(t.periods, 1);
      if (p < 1 || p > SLOTS.length) return bad(res, `任务连续节数非法（task_id=${t.id}）`);
      const cMin = Math.max(1, toInt(t.class_min_cont, 1));
      const teMin = Math.max(1, toInt(t.teacher_min_cont, 1));
      if (p < cMin) return bad(res, `任务连续节数不足：班级「${t.class_name}」最少连续 ${cMin} 节（task_id=${t.id}）`);
      if (p < teMin) return bad(res, `任务连续节数不足：教师「${t.teacher_name}」最少连续 ${teMin} 节（task_id=${t.id}）`);
    }

    const roomsById = new Map(rooms.map((r) => [Number(r.id), r]));
    const roomsSorted = orderedRoomsGlobal(rooms);

    // 按日期分组
    const byDate = new Map();
    for (const t of tasks) {
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push(t);
    }

    // 占用表：使用bitmask表示某天的10个时间段占用情况
    const roomOcc = {};    // roomOcc[date][roomId] = mask
    const teacherOcc = {}; // teacherOcc[date][teacherId] = mask
    const classOcc = {};   // classOcc[date][classId] = mask
    const classFixedRoom = {}; // classFixedRoom[date][classId] = roomId

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

    const tx = db.transaction(() => {
      delAll.run();

      // 每天单独排（互不影响）
      const dates = Array.from(byDate.keys()).sort();
      for (const date of dates) {
        const dayTasks = byDate.get(date);

        // 难度排序：先排“连续节数多/班级人数多”的
        dayTasks.sort(
          (a, b) =>
            toInt(b.periods) - toInt(a.periods) ||
            toInt(b.class_size) - toInt(a.class_size) ||
            String(a.class_name).localeCompare(String(b.class_name)) ||
            a.id - b.id
        );

        for (const t of dayTasks) {
          const periods = toInt(t.periods, 1);
          const classId = Number(t.class_id);
          const teacherId = Number(t.teacher_id);
          const clsSize = toInt(t.class_size);

          const cAvail = toInt(t.class_avail_mask, FULL_MASK);
          const teAvail = toInt(t.teacher_avail_mask, FULL_MASK);

          // 允许的时间段=班级可上 & 教师可上
          const allowMask = cAvail & teAvail;

          // 若 allowMask 本身太少，直接报错更友好
          // （但仍要考虑连续 periods 的情况）
          let anyContinuousPossible = false;
          for (let start = 0; start + periods <= SLOTS.length; start++) {
            const m = blockMask(start, periods);
            if (hasAll(allowMask, m)) {
              anyContinuousPossible = true;
              break;
            }
          }
          if (!anyContinuousPossible) {
            throw new Error(
              `无可行解：${date}（${t.class_name} - ${t.course_name} - ${t.teacher_name}）连续 ${periods} 节在可上时间段内放不下（班级/教师限制太紧）。`
            );
          }

          // 同日固定教室：若班级 allow_switch=0，一旦选定当天教室后必须一致
          const fixed = (Number(t.allow_switch) === 0);
          classFixedRoom[date] ||= {};
          const fixedRoomId = classFixedRoom[date][String(classId)] || 0;

          // 教室候选顺序：任务偏好 > 班级偏好 > 教室优先级
          const roomOrder = orderedRoomsFor(
            t, // 用 t 里带的 preferred_room_ids
            t.prefer_room_ids,
            roomsSorted
          );

          let placed = false;

          // 遍历候选教室
          for (const room of roomOrder) {
            if (toInt(room.capacity) < clsSize) continue;

            // 固定教室限制
            if (fixed && fixedRoomId && Number(room.id) !== Number(fixedRoomId)) continue;

            // 房间占用mask
            const rOcc = getOcc(roomOcc, date, room.id);
            const teOcc = getOcc(teacherOcc, date, teacherId);
            const clOcc = getOcc(classOcc, date, classId);

            // 遍历所有可能连续块
            for (let start = 0; start + periods <= SLOTS.length; start++) {
              const m = blockMask(start, periods);

              // 1) 必须处于 allowMask
              if (!hasAll(allowMask, m)) continue;

              // 2) 房间/教师/班级不冲突
              if (overlapMask(rOcc, m)) continue;
              if (overlapMask(teOcc, m)) continue;
              if (overlapMask(clOcc, m)) continue;

              // OK，落位
              setOcc(roomOcc, date, room.id, rOcc | m);
              setOcc(teacherOcc, date, teacherId, teOcc | m);
              setOcc(classOcc, date, classId, clOcc | m);

              if (fixed && !fixedRoomId) {
                classFixedRoom[date][String(classId)] = Number(room.id);
              }

              for (let k = 0; k < periods; k++) {
                insSlot.run(date, start + k, room.id, classId, teacherId, t.id);
              }

              placed = true;
              break;
            }

            if (placed) break;
          }

          if (!placed) {
            throw new Error(
              `无可行解：${date}（${t.class_name} - ${t.course_name} - ${t.teacher_name}）无法安排连续 ${periods} 节：可能是教室容量不足/同日固定教室/时间段冲突。`
            );
          }
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
          s.task_id, t.course_name
        FROM schedule_slots s
        LEFT JOIN rooms r ON r.id=s.room_id
        LEFT JOIN classes c ON c.id=s.class_id
        LEFT JOIN teachers te ON te.id=s.teacher_id
        LEFT JOIN tasks t ON t.id=s.task_id
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
          s.task_id, t.course_name
        FROM schedule_slots s
        LEFT JOIN rooms r ON r.id=s.room_id
        LEFT JOIN classes c ON c.id=s.class_id
        LEFT JOIN teachers te ON te.id=s.teacher_id
        LEFT JOIN tasks t ON t.id=s.task_id
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
          "INSERT INTO classes(id,name,size,allow_switch,preferred_room_ids,avail_mask,min_continuous) VALUES (?,?,?,?,?,?,?)"
        ).run(
          c.id,
          c.name,
          c.size,
          c.allow_switch,
          c.preferred_room_ids,
          c.avail_mask ?? FULL_MASK,
          c.min_continuous ?? 1
        );
      }
      for (const t of d.teachers || []) {
        db.prepare("INSERT INTO teachers(id,name,avail_mask,min_continuous) VALUES (?,?,?,?)").run(
          t.id,
          t.name,
          t.avail_mask ?? FULL_MASK,
          t.min_continuous ?? 1
        );
      }
      for (const t of d.tasks || []) {
        db.prepare("INSERT INTO tasks(id,class_id,teacher_id,date,course_name,periods,prefer_room_ids) VALUES (?,?,?,?,?,?,?)").run(
          t.id,
          t.class_id,
          t.teacher_id,
          t.date,
          t.course_name,
          t.periods,
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

    tx();
    reply(res, { ok: true });
  },
};

module.exports = { initDb, api };
