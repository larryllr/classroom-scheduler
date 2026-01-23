export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "*",
    },
  });
}
function bad(message: string, status = 400) {
  return json({ ok: false, message }, status);
}

function toMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}
function overlap(a1: number, a2: number, b1: number, b2: number) {
  return a1 < b2 && b1 < a2;
}
function isDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return json({ ok: true });

    const url = new URL(req.url);
    const path = url.pathname;

    // 非 /api 走静态资源
    if (!path.startsWith("/api")) return env.ASSETS.fetch(req);

    try {
      /* ---------------- 教室 ---------------- */
      if (path === "/api/rooms" && req.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM rooms ORDER BY priority ASC, capacity ASC"
        ).all();
        return json(results);
      }

      if (path === "/api/rooms" && req.method === "POST") {
        const body = await req.json();
        const name = String(body.name || "").trim();
        const capacity = Number(body.capacity);
        const priority = Number(body.priority ?? 100);

        if (!name) return bad("请填写教室名称");
        if (!Number.isFinite(capacity) || capacity <= 0) return bad("容量必须是正数");
        if (!Number.isFinite(priority)) return bad("优先级必须是数字");

        await env.DB.prepare(
          "INSERT INTO rooms(name,capacity,priority) VALUES (?,?,?)"
        ).bind(name, capacity, priority).run();

        return json({ ok: true });
      }

      if (path.startsWith("/api/rooms/") && req.method === "DELETE") {
        const id = Number(path.split("/").pop());
        if (!id) return bad("教室ID错误");

        await env.DB.prepare("DELETE FROM assignments WHERE room_id=?").bind(id).run();
        await env.DB.prepare("DELETE FROM rooms WHERE id=?").bind(id).run();
        return json({ ok: true });
      }

      /* ---------------- 班级 ---------------- */
      if (path === "/api/classes" && req.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT c.*,
            (
              SELECT GROUP_CONCAT(r.name, ' > ')
              FROM rooms r
              WHERE ',' || IFNULL(c.preferred_room_ids,'') || ',' LIKE '%,' || r.id || ',%'
            ) AS preferred_rooms
          FROM classes c
          ORDER BY c.id DESC
        `).all();
        return json(results);
      }

      if (path === "/api/classes" && req.method === "POST") {
        const body = await req.json();
        const name = String(body.name || "").trim();
        const size = Number(body.size);
        const allow_switch = body.allow_switch ? 1 : 0;
        const preferred_room_ids = String(body.preferred_room_ids || "").trim(); // "1,3,5"

        if (!name) return bad("请填写班级名称");
        if (!Number.isFinite(size) || size <= 0) return bad("人数必须是正数");

        await env.DB.prepare(
          "INSERT INTO classes(name,size,allow_switch,preferred_room_ids) VALUES (?,?,?,?)"
        ).bind(name, size, allow_switch, preferred_room_ids).run();

        return json({ ok: true });
      }

      if (path.startsWith("/api/classes/") && req.method === "DELETE") {
        const id = Number(path.split("/").pop());
        if (!id) return bad("班级ID错误");

        const { results: courseIds } = await env.DB.prepare(
          "SELECT id FROM course_instances WHERE class_id=?"
        ).bind(id).all();

        // 批量删 assignments
        const delAssignStmts = (courseIds as any[]).map((c) =>
          env.DB.prepare("DELETE FROM assignments WHERE course_instance_id=?").bind(c.id)
        );
        if (delAssignStmts.length) await env.DB.batch(delAssignStmts);

        await env.DB.prepare("DELETE FROM course_instances WHERE class_id=?").bind(id).run();
        await env.DB.prepare("DELETE FROM classes WHERE id=?").bind(id).run();

        return json({ ok: true });
      }

      /* ---------------- 课程（按日期） ---------------- */
      if (path === "/api/courses" && req.method === "GET") {
        const class_id = Number(url.searchParams.get("class_id") || 0);
        let sql = `
          SELECT ci.*, c.name AS class_name
          FROM course_instances ci
          LEFT JOIN classes c ON c.id=ci.class_id
        `;
        const binds: any[] = [];
        if (class_id) {
          sql += " WHERE ci.class_id=? ";
          binds.push(class_id);
        }
        sql += " ORDER BY ci.date DESC, ci.start_time ASC ";

        const stmt = env.DB.prepare(sql);
        const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
        return json(res.results);
      }

      /**
       * ✅ 新增课程：一次选多个日期 —— 批量写入提速
       * body: { class_id, title, dates:[YYYY-MM-DD...], start_time, end_time }
       */
      if (path === "/api/course/add_dates" && req.method === "POST") {
        const body = await req.json();
        const class_id = Number(body.class_id);
        const title = String(body.title || "").trim();
        const dates = Array.isArray(body.dates) ? body.dates.map(String) : [];
        const start_time = String(body.start_time || "").trim();
        const end_time = String(body.end_time || "").trim();

        if (!class_id) return bad("请选择班级");
        if (!title) return bad("请填写课程名");
        if (!dates.length) return bad("请从日历选择至少1个日期");
        if (dates.some((d) => !isDate(d))) return bad("日期格式错误");
        const s = toMin(start_time), e = toMin(end_time);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
          return bad("时间格式错误：HH:MM 且 结束>开始");
        }

        // 去重 + 排序，避免重复点日期导致多条相同记录
        const uniq = Array.from(new Set(dates)).sort();

        // ✅ 批量写入（一次 batch）
        const stmts = uniq.map((d) =>
          env.DB.prepare(
            "INSERT INTO course_instances(class_id,title,date,start_time,end_time) VALUES(?,?,?,?,?)"
          ).bind(class_id, title, d, start_time, end_time)
        );

        await env.DB.batch(stmts);

        return json({ ok: true, count: uniq.length });
      }

      if (path.startsWith("/api/course/") && req.method === "DELETE") {
        const id = Number(path.split("/").pop());
        if (!id) return bad("课程ID错误");

        await env.DB.prepare("DELETE FROM assignments WHERE course_instance_id=?").bind(id).run();
        await env.DB.prepare("DELETE FROM course_instances WHERE id=?").bind(id).run();
        return json({ ok: true });
      }

      /* ---------------- 课表查询（按日期范围） ---------------- */
      if (path.startsWith("/api/timetable/class/") && req.method === "GET") {
        const classId = Number(path.split("/").pop());
        const from = String(url.searchParams.get("from") || "");
        const to = String(url.searchParams.get("to") || "");

        const cls = await env.DB.prepare("SELECT * FROM classes WHERE id=?")
          .bind(classId).first();
        if (!cls) return bad("班级不存在", 404);

        let where = "WHERE ci.class_id=? ";
        const binds: any[] = [classId];
        if (from && isDate(from)) { where += " AND ci.date>=? "; binds.push(from); }
        if (to && isDate(to)) { where += " AND ci.date<=? "; binds.push(to); }

        const { results } = await env.DB.prepare(`
          SELECT ci.id, ci.date, ci.start_time, ci.end_time, ci.title,
                 r.name AS room_name
          FROM course_instances ci
          LEFT JOIN assignments a ON a.course_instance_id = ci.id
          LEFT JOIN rooms r ON r.id = a.room_id
          ${where}
          ORDER BY ci.date ASC, ci.start_time ASC
        `).bind(...binds).all();

        return json({ class_name: (cls as any).name, items: results });
      }

      /* ---------------- 一键排教室（写入 assignments 批量提速） ---------------- */
      if (path === "/api/solve" && req.method === "POST") {
        const rooms = (await env.DB.prepare("SELECT * FROM rooms").all()).results as any[];
        const classes = (await env.DB.prepare("SELECT * FROM classes").all()).results as any[];
        const courses = (await env.DB.prepare("SELECT * FROM course_instances").all()).results as any[];

        if (!rooms.length) return bad("还没有教室");
        if (!classes.length) return bad("还没有班级");
        if (!courses.length) return bad("还没有课程");

        await env.DB.prepare("DELETE FROM assignments").run();

        rooms.sort((a, b) => (a.priority - b.priority) || (a.capacity - b.capacity));

        const classById = new Map<number, any>();
        for (const c of classes) classById.set(Number(c.id), c);

        function orderedRoomsForClass(cls: any) {
          const pref = String(cls.preferred_room_ids || "").trim();
          if (!pref) return rooms;
          const ids = pref.split(",").map((x: string) => Number(x)).filter(Boolean);
          const prefRooms = ids.map((id: number) => rooms.find(r => Number(r.id) === id)).filter(Boolean) as any[];
          const rest = rooms.filter((r: any) => !ids.includes(Number(r.id)));
          return [...prefRooms, ...rest];
        }

        // occupied[roomId][date] = [{s,e}]
        const occupied: Record<string, Record<string, Array<{ s: number; e: number }>>> = {};
        function isFree(roomId: number, date: string, s: number, e: number) {
          const rid = String(roomId);
          const list = occupied[rid]?.[date] || [];
          return !list.some(x => overlap(s, e, x.s, x.e));
        }
        function occupy(roomId: number, date: string, s: number, e: number) {
          const rid = String(roomId);
          occupied[rid] ??= {};
          occupied[rid][date] ??= [];
          occupied[rid][date].push({ s, e });
        }

        // 规范化课程
        const norm = courses.map((c) => {
          const cls = classById.get(Number(c.class_id));
          const date = String(c.date || "").trim();
          if (!cls) throw new Error("课程对应班级不存在");
          if (!isDate(date)) throw new Error(`课程「${c.title}」缺少日期（请用日历方式新增课程）`);
          const s = toMin(String(c.start_time));
          const e = toMin(String(c.end_time));
          if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
            throw new Error(`课程「${c.title}」时间格式错误（HH:MM 且结束>开始）`);
          }
          return {
            ...c,
            _cls: cls,
            _date: date,
            _s: s,
            _e: e,
            _groupKey: `${c.class_id}-${date}` // 班级当天
          };
        });

        // 分组：allow_switch=0 -> 同一天同教室
        const fixedGroups = new Map<string, any[]>();
        const flex: any[] = [];

        for (const c of norm) {
          const allow = Number(c._cls.allow_switch);
          if (allow === 0) {
            if (!fixedGroups.has(c._groupKey)) fixedGroups.set(c._groupKey, []);
            fixedGroups.get(c._groupKey)!.push(c);
          } else {
            flex.push(c);
          }
        }

        const fixedList = Array.from(fixedGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

        // ✅ 收集 assignments 批量插入
        const assignmentRows: Array<{ course_instance_id: number; room_id: number }> = [];

        // 1) 固定组先排
        for (const [, arr] of fixedList) {
          arr.sort((x, y) => x._s - y._s);
          const cls = arr[0]._cls;
          const size = Number(cls.size);
          const date = arr[0]._date;

          let chosen: any = null;
          for (const r of orderedRoomsForClass(cls)) {
            if (Number(r.capacity) < size) continue;
            let ok = true;
            for (const c of arr) {
              if (!isFree(Number(r.id), date, c._s, c._e)) { ok = false; break; }
            }
            if (ok) { chosen = r; break; }
          }

          if (!chosen) {
            return bad(`无可行解：班级「${cls.name}」在 ${date} 设置为“当天不换教室”，但没有任何教室能同时容纳且不冲突。`);
          }

          for (const c of arr) {
            occupy(Number(chosen.id), date, c._s, c._e);
            assignmentRows.push({ course_instance_id: Number(c.id), room_id: Number(chosen.id) });
          }
        }

        // 2) 允许换教室逐条排
        flex.sort((a, b) => (a._date.localeCompare(b._date)) || (a._s - b._s));

        for (const c of flex) {
          const cls = c._cls;
          const size = Number(cls.size);
          const date = c._date;

          let placed = false;
          for (const r of orderedRoomsForClass(cls)) {
            if (Number(r.capacity) < size) continue;
            if (!isFree(Number(r.id), date, c._s, c._e)) continue;

            occupy(Number(r.id), date, c._s, c._e);
            assignmentRows.push({ course_instance_id: Number(c.id), room_id: Number(r.id) });
            placed = true;
            break;
          }

          if (!placed) {
            return bad(`无可行解：${date} ${c.start_time}-${c.end_time}（${cls.name} - ${c.title}）没有可用教室（容量/冲突）。`);
          }
        }

        // ✅ 一次 batch 写入所有分配
        if (assignmentRows.length) {
          const stmts = assignmentRows.map((x) =>
            env.DB.prepare("INSERT INTO assignments(course_instance_id, room_id) VALUES (?,?)")
              .bind(x.course_instance_id, x.room_id)
          );
          await env.DB.batch(stmts);
        }

        return json({ ok: true, message: "排课完成（已提速批量写入）" });
      }

      return bad("接口不存在", 404);

    } catch (e: any) {
      return bad(e?.message || "服务器错误", 500);
    }
  },
};
