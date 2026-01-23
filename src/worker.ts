export interface Env {
  DB: D1Database;
}

/* ========== 工具函数 ========== */

// 返回 JSON
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "*",
    },
  });
}

// 错误返回
function bad(msg: string, status = 400) {
  return json({ ok: false, message: msg }, status);
}

// "08:30" → 分钟
function toMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 判断时间是否重叠
function overlap(a1: number, a2: number, b1: number, b2: number) {
  return a1 < b2 && b1 < a2;
}

/* ========== Worker 主体 ========== */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return json({ ok: true });

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      /* ---------- 查询教室 ---------- */
      if (path === "/api/rooms" && req.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM rooms ORDER BY priority ASC"
        ).all();
        return json(results);
      }

      /* ---------- 查询班级 ---------- */
      if (path === "/api/classes" && req.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM classes ORDER BY id DESC"
        ).all();
        return json(results);
      }

      /* ---------- 查询课表 ---------- */
      if (path.startsWith("/api/timetable/class/") && req.method === "GET") {
        const classId = Number(path.split("/").pop());
        const week = Number(url.searchParams.get("week") || 1);

        const cls = await env.DB.prepare(
          "SELECT * FROM classes WHERE id=?"
        ).bind(classId).first();

        if (!cls) return bad("班级不存在", 404);

        const { results } = await env.DB.prepare(`
          SELECT ci.weekday, ci.start_time, ci.end_time,
                 ci.title, r.name AS room_name
          FROM course_instances ci
          LEFT JOIN assignments a ON a.course_instance_id = ci.id
          LEFT JOIN rooms r ON r.id = a.room_id
          WHERE ci.class_id=? AND ci.week=?
          ORDER BY ci.weekday, ci.start_time
        `).bind(classId, week).all();

        return json({
          class_name: cls.name,
          week,
          items: results
        });
      }
// 新增单次课程（第几周一次）
if (path === "/api/course/add_once" && req.method === "POST") {
  const body = await req.json();
  const class_id = Number(body.class_id);
  const title = String(body.title || "").trim();
  const week = Number(body.week || 1);
  const weekday = Number(body.weekday);
  const start_time = String(body.start_time || "").trim();
  const end_time = String(body.end_time || "").trim();

  if (!class_id || !title) return bad("请填写：班级、课程名");
  if (!(weekday >= 1 && weekday <= 7)) return bad("周几必须是 1-7");
  const s = toMin(start_time), e = toMin(end_time);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return bad("时间格式错误：HH:MM 且结束>开始");
  if (!week || week < 1) return bad("周次必须≥1");

  await env.DB.prepare(
    "INSERT INTO course_instances(class_id,title,week,weekday,start_time,end_time) VALUES(?,?,?,?,?,?)"
  ).bind(class_id, title, week, weekday, start_time, end_time).run();

  return json({ ok: true });
}

      /* ---------- 一键生成课表 ---------- */
/* ---------- 一键生成课表（强制当天不窜教室） ---------- */
if (path === "/api/solve" && req.method === "POST") {
  // 读取数据
  const rooms = (await env.DB.prepare("SELECT * FROM rooms").all()).results as any[];
  const classes = (await env.DB.prepare("SELECT * FROM classes").all()).results as any[];
  const courses = (await env.DB.prepare("SELECT * FROM course_instances").all()).results as any[];

  if (!rooms.length) return bad("还没有教室");
  if (!classes.length) return bad("还没有班级");
  if (!courses.length) return bad("还没有课程");

  // 清空旧分配
  await env.DB.prepare("DELETE FROM assignments").run();

  // 教室按优先级排序（越小越优先），同优先级下容量小的优先（更省）
  rooms.sort((a, b) => (a.priority - b.priority) || (a.capacity - b.capacity));

  // 班级索引
  const classById = new Map<number, any>();
  for (const c of classes) classById.set(Number(c.id), c);

  // 占用情况：occupied[roomId][week-day] = [{s,e},...]
  const occupied: Record<string, Record<string, Array<{ s: number; e: number }>>> = {};

  function isFree(roomId: number, key: string, s: number, e: number) {
    const rid = String(roomId);
    const list = occupied[rid]?.[key] || [];
    return !list.some((x) => overlap(s, e, x.s, x.e));
  }
  function occupy(roomId: number, key: string, s: number, e: number) {
    const rid = String(roomId);
    occupied[rid] ??= {};
    occupied[rid][key] ??= [];
    occupied[rid][key].push({ s, e });
  }

  // 校验时间并预处理
  const normCourses = courses.map((c) => {
    const cls = classById.get(Number(c.class_id));
    const s = toMin(String(c.start_time));
    const e = toMin(String(c.end_time));
    if (!cls) throw new Error(`课程(${c.id}) 的班级不存在`);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      throw new Error(`课程「${c.title}」时间格式错误（HH:MM 且结束>开始）`);
    }
    return {
      ...c,
      _s: s,
      _e: e,
      _cls: cls,
      _key: `${c.week}-${c.weekday}`,              // 同一天 key
      _groupKey: `${c.class_id}-${c.week}-${c.weekday}`, // 班级当天 key
    };
  });

  // 分组：allow_switch=0 的班级要“当天固定同一教室”
  const fixedGroups = new Map<string, any[]>(); // groupKey -> courses[]
  const flexCourses: any[] = [];

  for (const c of normCourses) {
    const allow = Number(c._cls.allow_switch);
    if (allow === 0) {
      if (!fixedGroups.has(c._groupKey)) fixedGroups.set(c._groupKey, []);
      fixedGroups.get(c._groupKey)!.push(c);
    } else {
      flexCourses.push(c);
    }
  }

  // 固定组排序：按周次、星期、班级排序（更稳定）
  const fixedGroupList = Array.from(fixedGroups.entries()).sort((a, b) => {
    const [ac, aw, ad] = a[0].split("-").map(Number);
    const [bc, bw, bd] = b[0].split("-").map(Number);
    return aw - bw || ad - bd || ac - bc;
  });

  // 1) 先排“固定当天同教室”的组
  for (const [gk, arr] of fixedGroupList) {
    // arr 里都是同一个班同一天
    arr.sort((x, y) => x._s - y._s);
    const cls = arr[0]._cls;
    const size = Number(cls.size);

    // 找一个教室，能容纳人数，并且当天所有课都不冲突
    let chosenRoom: any = null;

    for (const r of rooms) {
      if (Number(r.capacity) < size) continue;

      let ok = true;
      for (const c of arr) {
        if (!isFree(Number(r.id), c._key, c._s, c._e)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        chosenRoom = r;
        break;
      }
    }

    if (!chosenRoom) {
      const anyC = arr[0];
      return bad(
        `无可行解：班级「${cls.name}」第${anyC.week}周 周${anyC.weekday} 设置为“当天不换教室”，但没有任何教室可同时容纳且不冲突。`
      );
    }

    // 占用 + 写入 assignments
    for (const c of arr) {
      occupy(Number(chosenRoom.id), c._key, c._s, c._e);
      await env.DB.prepare(
        "INSERT INTO assignments(course_instance_id, room_id) VALUES (?,?)"
      ).bind(c.id, chosenRoom.id).run();
    }
  }

  // 2) 再排允许换教室的课程（逐条按优先级找可用教室）
  // 排序：周次→星期→开始时间
  flexCourses.sort((a, b) => a.week - b.week || a.weekday - b.weekday || a._s - b._s);

  for (const c of flexCourses) {
    const cls = c._cls;
    const size = Number(cls.size);

    let placed = false;
    for (const r of rooms) {
      if (Number(r.capacity) < size) continue;
      if (!isFree(Number(r.id), c._key, c._s, c._e)) continue;

      occupy(Number(r.id), c._key, c._s, c._e);
      await env.DB.prepare(
        "INSERT INTO assignments(course_instance_id, room_id) VALUES (?,?)"
      ).bind(c.id, r.id).run();

      placed = true;
      break;
    }

    if (!placed) {
      return bad(
        `无可行解：第${c.week}周 周${c.weekday} ${c.start_time}-${c.end_time}（${cls.name} - ${c.title}）没有可用教室（容量/冲突）。`
      );
    }
  }

  return json({ ok: true, message: "课表生成完成（已强制：当天不换教室）" });
}

      return bad("接口不存在", 404);

    } catch (e: any) {
      return bad(e.message || "服务器错误", 500);
    }
  }
};
