const $ = (s) => document.querySelector(s);

const msg = (t, ok = false) => {
  const el = $("#msg");
  if (!el) return;
  el.textContent = t || "";
  el.className = ok ? "msg ok" : "msg";
};

async function jget(url) {
  const r = await fetch(url);
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function jdel(url) {
  const r = await fetch(url, { method: "DELETE" });
  return r.json();
}

let state = {
  rooms: null,
  classes: null,
  courses: null,
  pickedDates: [],
  cal: new Date(),
  currentTab: "rooms",
};

function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* 缓存加载（提速） */
async function ensureRooms(force = false) {
  if (!force && Array.isArray(state.rooms)) return state.rooms;
  state.rooms = await jget("/api/rooms");
  return state.rooms;
}
async function ensureClasses(force = false) {
  if (!force && Array.isArray(state.classes)) return state.classes;
  state.classes = await jget("/api/classes");
  return state.classes;
}
async function ensureCourses(force = false) {
  if (!force && Array.isArray(state.courses)) return state.courses;
  state.courses = await jget("/api/courses");
  return state.courses;
}

/* Tabs */
window.tab = async (t) => {
  state.currentTab = t;
  msg("");
  if (t === "rooms") return renderRooms();
  if (t === "classes") return renderClasses();
  if (t === "courses") return renderCourses();
  if (t === "timetable") return renderTimetable();
};

window.solve = async () => {
  const r = await jpost("/api/solve", {});
  if (r.ok === false) return msg("❌ " + r.message);
  msg("✅ " + r.message, true);
};

/* 日历 */
function calendarHTML() {
  const d = state.cal;
  const y = d.getFullYear(),
    m = d.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const dow = ["日", "一", "二", "三", "四", "五", "六"];

  let html = `
  <div class="cal">
    <div class="calhead">
      <button onclick="calMove(-1)">← 上月</button>
      <div style="font-weight:900">${y}年 ${m + 1}月</div>
      <button onclick="calMove(1)">下月 →</button>
    </div>

    <div class="calgrid" style="margin-top:10px">
      ${dow.map((x) => `<div class="dow">周${x}</div>`).join("")}
    </div>

    <div class="calgrid">
  `;

  for (let i = 0; i < startDow; i++) html += `<div class="day off"> </div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dd = new Date(y, m, day);
    const key = fmtDate(dd);
    const on = state.pickedDates.includes(key);
    html += `<div class="day ${on ? "on" : ""}" onclick="toggleDate('${key}')">${day}</div>`;
  }

  html += `</div>
    <div class="meta" style="margin-top:10px">
      已选日期：${state.pickedDates.length ? state.pickedDates.join(", ") : "（未选择）"}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button onclick="clearDates()">清空日期</button>
      <button onclick="pickToday()">选择今天</button>
    </div>
  </div>`;
  return html;
}
window.calMove = (delta) => {
  const d = state.cal;
  state.cal = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  $("#calBox").innerHTML = calendarHTML();
};
window.toggleDate = (key) => {
  const i = state.pickedDates.indexOf(key);
  if (i >= 0) state.pickedDates.splice(i, 1);
  else state.pickedDates.push(key);
  state.pickedDates.sort();
  $("#calBox").innerHTML = calendarHTML();
};
window.clearDates = () => {
  state.pickedDates = [];
  $("#calBox").innerHTML = calendarHTML();
};
window.pickToday = () => {
  state.pickedDates = [fmtDate(new Date())];
  $("#calBox").innerHTML = calendarHTML();
};

/* 页面：教室 */
async function renderRooms() {
  const rooms = await ensureRooms(false);

  $("#app").innerHTML = `
  <div class="grid">
    <div class="card">
      <h3>新增教室</h3>
      <div class="row">
        <input id="rname" placeholder="教室名称（如 A101）" />
        <input id="rcap" type="number" placeholder="容量（如 60）" />
      </div>
      <div class="row" style="margin-top:10px">
        <input id="rpri" type="number" placeholder="优先级（越小越优先，如 1）" />
        <button class="primary" onclick="addRoom()">新增教室</button>
      </div>
      <div class="meta" style="margin-top:10px">优先级越小越先分配；同优先级下容量更小者更优先。</div>
    </div>

    <div class="card">
      <h3>已建教室</h3>
      <div class="list">
        ${
          rooms.map(
            (r) => `
          <div class="item">
            <div>
              <div style="font-weight:900">${r.name}</div>
              <div class="meta">容量：${r.capacity}　优先级：${r.priority}　(ID:${r.id})</div>
            </div>
            <button class="danger" onclick="delRoom(${r.id}, '${String(r.name).replace(/'/g, "")}')">删除</button>
          </div>
        `
          ).join("") || `<div class="meta">暂无教室</div>`
        }
      </div>
    </div>
  </div>
  `;
}
window.addRoom = async () => {
  const name = $("#rname").value.trim();
  const capacity = Number($("#rcap").value);
  const priority = Number($("#rpri").value || 100);
  const r = await jpost("/api/rooms", { name, capacity, priority });
  if (r.ok === false) return msg("❌ " + r.message);
  msg("✅ 已新增教室", true);
  await ensureRooms(true);
  await ensureClasses(true);
  renderRooms();
};
window.delRoom = async (id, name) => {
  if (!confirm(`确定删除教室：${name}？`)) return;
  const r = await jdel(`/api/rooms/${id}`);
  if (r.ok === false) return msg("❌ " + r.message);
  msg("✅ 已删除教室", true);
  await ensureRooms(true);
  await ensureClasses(true);
  renderRooms();
};

/* 页面：班级 */
async function renderClasses() {
  const [rooms, classes] = await Promise.all([ensureRooms(false), ensureClasses(false)]);
  $("#app").innerHTML = `
  <div class="grid">
    <div class="card">
      <h3>新增班级</h3>
      <div class="row">
        <input id="cname" placeholder="班级名称（如 软件2301）" />
        <input id="csize" type="number" placeholder="人数（如 48）" />
      </div>

      <div style="margin-top:10px">
        <label class="pill">
          <input id="cswitch" type="checkbox" checked />
          当天允许换教室（不勾选=当天固定同一教室）
        </label>
      </div>

      <div style="margin-top:12px">
        <div style="font-weight:900;margin-bottom:8px">班级优先教室（勾选即可）</div>
        <div style="display:grid;gap:6px;max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:10px;background:rgba(255,255,255,.03)">
          ${
            rooms.map(
              (r) => `
            <label class="pill" style="justify-content:flex-start">
              <input type="checkbox" value="${r.id}"> ${r.name}（容量${r.capacity}，优先级${r.priority}）
            </label>
          `
            ).join("") || `<div class="meta">请先新增教室</div>`
          }
        </div>
        <div class="meta" style="margin-top:8px">规则：先尝试这些教室；不行才用其它教室。</div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="primary" onclick="addClass()">新增班级</button>
      </div>
    </div>

    <div class="card">
      <h3>已建班级</h3>
      <div class="list">
        ${
          classes.map(
            (c) => `
          <div class="item">
            <div>
              <div style="font-weight:900">${c.name}</div>
              <div class="meta">人数：${c.size}　当天可换教室：${c.allow_switch ? "是" : "否"}</div>
              <div class="meta">优先教室：${c.preferred_rooms || "无"}</div>
              <div class="meta">(ID:${c.id})</div>
            </div>
            <button class="danger" onclick="delClass(${c.id}, '${String(c.name).replace(/'/g, "")}')">删除</button>
          </div>
        `
          ).join("") || `<div class="meta">暂无班级</div>`
        }
      </div>
    </div>
  </div>
  `;
}
window.addClass = async () => {
  const name = $("#cname").value.trim();
  const size = Number($("#csize").value);
  const allow_switch = $("#cswitch").checked;
  const checks = Array.from(document.querySelectorAll('input[type="checkbox"][value]:checked'));
  const preferred_room_ids = checks.map((x) => x.value).join(",");

  const r = await jpost("/api/classes", { name, size, allow_switch, preferred_room_ids });
  if (r.ok === false) return msg("❌ " + r.message);
  msg("✅ 已新增班级", true);
  await ensureClasses(true);
  renderClasses();
};
window.delClass = async (id, name) => {
  if (!confirm(`确定删除班级：${name}？（课程与分配会一起删）`)) return;
  const r = await jdel(`/api/classes/${id}`);
  if (r.ok === false) return msg("❌ " + r.message);
  msg("✅ 已删除班级", true);
  await ensureClasses(true);
  await ensureCourses(true);
  renderClasses();
};

/* 页面：课程 */
async function renderCourses() {
  const [classes, courses] = await Promise.all([ensureClasses(false), ensureCourses(false)]);
  $("#app").innerHTML = `
  <div class="grid">
    <div class="card">
      <h3>新增课程（按日历选日期）</h3>

      <div class="row">
        <select id="cid">
          ${classes.map((c) => `<option value="${c.id}">${c.name}（${c.size}人）</option>`).join("")}
        </select>
        <input id="ctitle" placeholder="课程名（如 高数）" />
      </div>

      <div class="row" style="margin-top:10px">
        <input id="cstart" placeholder="开始时间 HH:MM（如 08:30）" />
        <input id="cend" placeholder="结束时间 HH:MM（如 10:05）" />
      </div>

      <div id="calBox">${calendarHTML()}</div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="primary" onclick="addCourseDates()">保存：这些日期都上这门课</button>
      </div>

      <div class="meta" style="margin-top:8px">
        一次可点多个日期；每个日期会生成一条课程记录。然后点“一键生成”分配教室。
      </div>
    </div>

    <div class="card">
      <h3>课程列表（可删除）</h3>
      <div class="list">
        ${
          courses.map(
            (ci) => `
          <div class="item">
            <div>
              <div style="font-weight:900">${ci.title}</div>
              <div class="meta">${ci.class_name || ""}　${ci.date}　${ci.start_time}-${ci.end_time}　(ID:${ci.id})</div>
            </div>
            <button class="danger" onclick="delCourse(${ci.id})">删除</button>
          </div>
        `
          ).join("") || `<div class="meta">暂无课程</div>`
        }
      </div>
    </div>
  </div>
  `;
}
window.addCourseDates = async () => {
  const class_id = Number($("#cid").value);
  const title = $("#ctitle").value.trim();
  const start_time = $("#cstart").value.trim();
  const end_time = $("#cend").value.trim();
  const dates = state.pickedDates.slice();

  const r = await jpost("/api/course/add_dates", { class_id, title, dates, start_time, end_time });
  if (r.ok === false) return msg("❌ " + r.message);

  msg(`✅ 已新增课程（${r.count || dates.length} 条）`, true);
  state.pickedDates = [];
  await ensureCourses(true);
  renderCourses();
};
window.delCourse = async (id) => {
  if (!confirm("确定删除这条课程？")) return;
  const r = await jdel(`/api/course/${id}`);
  if (r.ok === false) return msg("❌ " + r.message);
  msg("✅ 已删除课程", true);
  await ensureCourses(true);
  renderCourses();
};

/* 导入/导出 JSON */
async function exportJSON() {
  const d = await jget("/api/export");
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `宽宽牌教室分配数据_${fmtDate(new Date())}.json`;
  a.click();
}
async function importJSONFile(file) {
  const txt = await file.text();
  const data = JSON.parse(txt);
  const r = await jpost("/api/import", data);
  if (r.ok === false) return alert("导入失败：" + r.message);
  alert("导入成功，页面将刷新");
  state.rooms = state.classes = state.courses = null;
  location.reload();
}

/* 导出 CSV / Word */
function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
function csvEscape(s) {
  const t = String(s ?? "");
  if (/[,"\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}
async function exportClassCSV() {
  const cid = Number($("#ttcid").value);
  const from = $("#from").value;
  const to = $("#to").value;

  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const t = await jget(`/api/timetable/class/${cid}?` + q.toString());
  const rows = t.items || [];
  let csv = "日期,开始,结束,班级,课程,教室\n";
  for (const r of rows) {
    csv += [r.date, r.start_time, r.end_time, t.class_name, r.title, r.room_name || "未分配"]
      .map(csvEscape).join(",") + "\n";
  }
  downloadText(`宽宽牌_${t.class_name}_课表_${from || "起"}-${to || "止"}.csv`, csv, "text/csv");
}
async function exportClassWord() {
  const cid = Number($("#ttcid").value);
  const from = $("#from").value;
  const to = $("#to").value;

  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const t = await jget(`/api/timetable/class/${cid}?` + q.toString());
  const rows = t.items || [];

  const html = `
  <html><head><meta charset="utf-8"></head><body>
  <h2>宽宽牌教室分配系统 - ${t.class_name} 课表</h2>
  <p>范围：${from || "…"} ~ ${to || "…"}　生成时间：${new Date().toLocaleString()}</p>
  <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
    <tr><th>日期</th><th>时间</th><th>课程</th><th>教室</th></tr>
    ${rows.map(r => `
      <tr>
        <td>${r.date}</td><td>${r.start_time}-${r.end_time}</td><td>${r.title}</td><td>${r.room_name || "未分配"}</td>
      </tr>`).join("")}
  </table>
  </body></html>`;
  downloadText(`宽宽牌_${t.class_name}_课表_${from || "起"}-${to || "止"}.doc`, html, "application/msword");
}
async function exportAllCSV() {
  const from = $("#from").value;
  const to = $("#to").value;

  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const t = await jget(`/api/timetable/all?` + q.toString());
  const rows = t.items || [];
  let csv = "日期,开始,结束,班级,课程,教室\n";
  for (const r of rows) {
    csv += [r.date, r.start_time, r.end_time, r.class_name, r.title, r.room_name || "未分配"]
      .map(csvEscape).join(",") + "\n";
  }
  downloadText(`宽宽牌_全校总表_${from || "起"}-${to || "止"}.csv`, csv, "text/csv");
}
async function exportAllWord() {
  const from = $("#from").value;
  const to = $("#to").value;

  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const t = await jget(`/api/timetable/all?` + q.toString());
  const rows = t.items || [];

  const html = `
  <html><head><meta charset="utf-8"></head><body>
  <h2>宽宽牌教室分配系统 - 全校课表总表</h2>
  <p>范围：${from || "…"} ~ ${to || "…"}　生成时间：${new Date().toLocaleString()}</p>
  <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
    <tr><th>日期</th><th>时间</th><th>班级</th><th>课程</th><th>教室</th></tr>
    ${rows.map(r => `
      <tr>
        <td>${r.date}</td><td>${r.start_time}-${r.end_time}</td><td>${r.class_name}</td><td>${r.title}</td><td>${r.room_name || "未分配"}</td>
      </tr>`).join("")}
  </table>
  </body></html>`;
  downloadText(`宽宽牌_全校总表_${from || "起"}-${to || "止"}.doc`, html, "application/msword");
}

/* 页面：课表复制 */
async function renderTimetable() {
  const classes = await ensureClasses(false);

  $("#app").innerHTML = `
  <div class="card">
    <h3>课表复制（格式：日期 + 时间 + 教室）</h3>

    <div class="row" style="margin-top:10px">
      <select id="ttcid">
        ${classes.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}
      </select>
      <div class="row" style="gap:10px">
        <input id="from" type="date" />
        <input id="to" type="date" />
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="primary" onclick="loadTT()">加载课表</button>
      <button onclick="copyTT()">复制发群</button>
      <button onclick="exportClassCSV()">导出Excel(CSV)</button>
      <button onclick="exportClassWord()">导出Word(DOC)</button>
      <button onclick="exportAllCSV()">全校总表CSV</button>
      <button onclick="exportAllWord()">全校总表Word</button>
    </div>

    <pre id="tt" style="margin-top:12px"></pre>

    <h3 style="margin-top:16px">数据备份</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button onclick="exportJSON()">导出数据(JSON)</button>
      <label class="pill">
        导入数据(JSON)
        <input id="imp" type="file" accept="application/json" style="display:none" />
      </label>
    </div>

    <div class="meta" style="margin-top:8px">
      导入会覆盖本机数据；建议定期导出备份。
    </div>
  </div>
  `;

  $("#imp").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!confirm("确定导入？将覆盖当前数据")) {
      e.target.value = "";
      return;
    }
    try {
      await importJSONFile(f);
    } catch (err) {
      alert("导入失败：" + err.message);
    }
  });
}
window.loadTT = async () => {
  const cid = Number($("#ttcid").value);
  const from = $("#from").value;
  const to = $("#to").value;

  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const t = await jget(`/api/timetable/class/${cid}?` + q.toString());

  let txt = `【${t.class_name} 课表】\n`;
  if (from || to) txt += `范围：${from || "…"} ~ ${to || "…"}\n`;
  txt += `\n`;

  let cur = "";
  for (const i of t.items || []) {
    if (i.date !== cur) {
      cur = i.date;
      txt += `${cur}\n`;
    }
    txt += `${i.start_time}-${i.end_time}  ${i.title}  教室：${i.room_name || "未分配"}\n`;
  }

  $("#tt").textContent = (t.items || []).length ? txt.trim() : "（此范围内暂无课程）";
  msg("✅ 已加载课表", true);
};
window.copyTT = async () => {
  const text = ($("#tt").textContent || "").trim();
  if (!text) return alert("先加载课表");
  await navigator.clipboard.writeText(text);
  alert("已复制，可直接发群");
};

/* 启动预热 */
(async () => {
  try {
    await Promise.all([ensureRooms(false), ensureClasses(false)]);
  } catch (e) {}
  tab("rooms");
})();
