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
      if (path === "/api/solve" && req.method === "POST") {
        // 读取数据
        const rooms = (await env.DB.prepare("SELECT * FROM rooms").all()).results;
        const classes = (await env.DB.prepare("SELECT * FROM classes").all()).results;
        const courses = (await env.DB.prepare("SELECT * FROM course_instances").all()).results;

        if (!rooms.length) return bad("还没有教室");
        if (!classes.length) return bad("还没有班级");
        if (!courses.length) return bad("还没有课程");

        // 清空旧分配
        await env.DB.prepare("DELETE FROM assignments").run();

        // 记录教室占用情况
        const occupied: any = {};

        function isFree(roomId: number, key: string, s: number, e: number) {
          const list = occupied[roomId]?.[key] || [];
          return !list.some((x: any) => overlap(s, e, x.s, x.e));
        }

        function occupy(roomId: number, key: string, s: number, e: number) {
          occupied[roomId] ??= {};
          occupied[roomId][key] ??= [];
          occupied[roomId][key].push({ s, e });
        }

        // 教室按优先级排序
        rooms.sort((a: any, b: any) => a.priority - b.priority);

        for (const c of courses) {
          const cls = classes.find((x: any) => x.id === c.class_id);
          const s = toMin(c.start_time);
          const e = toMin(c.end_time);
          if (isNaN(s) || isNaN(e) || e <= s) {
            return bad(`课程 ${c.title} 时间格式错误`);
          }

          const key = `${c.week}-${c.weekday}`;
          let placed = false;

          for (const r of rooms) {
            if (r.capacity < cls.size) continue;
            if (!isFree(r.id, key, s, e)) continue;

            occupy(r.id, key, s, e);
            await env.DB.prepare(
              "INSERT INTO assignments(course_instance_id, room_id) VALUES (?,?)"
            ).bind(c.id, r.id).run();
            placed = true;
            break;
          }

          if (!placed) {
            return bad(`无法安排课程：${c.title}`);
          }
        }

        return json({ ok: true, message: "课表生成完成" });
      }

      return bad("接口不存在", 404);

    } catch (e: any) {
      return bad(e.message || "服务器错误", 500);
    }
  }
};
