/* -------------------- tiny ui helpers -------------------- */
const $ = (sel) => document.querySelector(sel);

function setMsg(text, type = "") {
  const el = $("#msg");
  el.className = "msg" + (type ? " " + type : "");
  el.textContent = text;
}
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
async function apiGet(url) {
  const r = await fetch(url);
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error("接口返回非JSON：" + t.slice(0, 200));
  }
}
async function apiSend(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error("接口返回非JSON：" + t.slice(0, 200));
  }
  if (j && j.ok === false) throw new Error(j.message || "操作失败");
  return j;
}
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setMsg("已复制到剪贴板，可直接发群 ✅", "ok");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setMsg("已复制到剪贴板（兼容模式）✅", "ok");
  }
}

/* -------------------- global state -------------------- */
let state = {
  tab: "schedules",
  meta: null,
  rooms: [],
  classes: [],
  teachers: [],
  tasks: [],
  selectedDates: new Set(),
  calYear: 0,
  calMonth: 0, // 0-11
};

/* -------------------- calendar -------------------- */
function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymd(y, m, d) {
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}
function renderCalendar() {
  const y = state.calYear;
  const m = state.calMonth;
  const first = new Date(y, m, 1);
  const startDow = first.getDay(); // 0 Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const app = $("#calBox");
  if (!app) return;

  const monthName = `${y}-${String(m + 1).padStart(2, "0")}`;
  const dows = ["日", "一", "二", "三", "四", "五", "六"];

  let html = `
    <div class="cal">
      <div class="calhead">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="small" onclick="calPrev()">◀</button>
          <div style="font-weight:900">${monthName}</div>
          <button class="small" onclick="calNext()">▶</button>
        </div>
        <div class="tools">
          <button class="small" onclick="calSelectAllMonth()">本月全选</button>
          <button class="small" onclick="calClear()">清空</button>
        </div>
      </div>
      <div class="calgrid" style="margin-top:10px">
        ${dows.map((x) => `<div class="dow">${x}</div>`).join("")}
      </div>
      <div class="calgrid">
  `;

  // leading blanks
  for (let i = 0; i < startDow; i++) {
    html += `<div class="day off"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = ymd(y, m, d);
    const on = state.selectedDates.has(key);
    html += `<div class="day ${on ? "on" : ""}" onclick="toggleDate('${key}')">${d}</div>`;
  }

  html += `</div>
    <div class="meta" style="margin-top:10px">已选日期：${Array.from(state.selectedDates).sort().join("、") || "（未选择）"}</div>
    </div>
  `;
  app.innerHTML = html;
}
window.toggleDate = (key) => {
  if (state.selectedDates.has(key)) state.selectedDates.delete(key);
  else state.selectedDates.add(key);
  renderCalendar();
};
window.calPrev = () => {
  state.calMonth--;
  if (state.calMonth < 0) {
    state.calMonth = 11;
    state.calYear--;
  }
  renderCalendar();
};
window.calNext = () => {
  state.calMonth++;
  if (state.calMonth > 11) {
    state.calMonth = 0;
    state.calYear++;
  }
  renderCalendar();
};
window.calClear = () => {
  state.selectedDates.clear();
  renderCalendar();
};
window.calSelectAllMonth = () => {
  const y = state.calYear;
  const m = state.calMonth;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    state.selectedDates.add(ymd(y, m, d));
  }
  renderCalendar();
};

/* -------------------- slots mask UI -------------------- */
function renderMaskCheckboxes(mask, namePrefix) {
  const slots = state.meta?.slots || [];
  const v = Number(mask) >>> 0;
  const items = slots
    .map((s) => {
      const bit = 1 << s.index;
      const checked = (v & bit) !== 0;
      return `
        <label class="pill" style="user-select:none">
          <input type="checkbox" data-mask="${bit}" data-name="${namePrefix}" ${checked ? "checked" : ""} onchange="onMaskChange('${namePrefix}')">
          <span>${esc(s.start)}–${esc(s.end)}</span>
        </label>
      `;
    })
    .join("");
  return `<div style="display:flex;gap:8px;flex-wrap:wrap">${items}</div>`;
}
window.onMaskChange = (namePrefix) => {
  const checks = document.querySelectorAll(`input[type=checkbox][data-name="${namePrefix}"]`);
  let mask = 0;
  checks.forEach((c) => {
    if (c.checked) mask |= Number(c.getAttribute("data-mask"));
  });
  const out = document.querySelector(`input[data-mask-out="${namePrefix}"]`);
  if (out) out.value = mask;
};

/* -------------------- tabs & render -------------------- */
window.tab = (t) => {
  state.tab = t;
  render();
};

function render() {
  const app = $("#app");
  if (!state.meta) {
    app.innerHTML = `<div class="card"><div class="meta">加载中…</div></div>`;
    return;
  }
  if (state.tab === "rooms") return renderRooms();
  if (state.tab === "classes") return renderClasses();
  if (state.tab === "teachers") return renderTeachers();
  if (state.tab === "tasks") return renderTasks();
  return renderSchedules();
}

/* -------------------- rooms -------------------- */
function renderRooms() {
  const app = $("#app");
  app.innerHTML = `
    <div class="grid">
      <div class="card">
        <h3>新增教室</h3>
        <div class="row">
          <input id="roomName" placeholder="教室名称，例如 A101" />
          <input id="roomCap" placeholder="容纳人数，例如 60" inputmode="numeric" />
        </div>
        <div class="row" style="margin-top:10px">
          <input id="roomPri" placeholder="优先级（数字越小越优先），例如 1" inputmode="numeric" />
          <button class="primary" onclick="addRoom()">添加</button>
        </div>
        <div class="meta" style="margin-top:10px">提示：优先级越小越先分配；容量不足的教室不会被分配。</div>
      </div>
      <div class="card">
        <h3>教室列表</h3>
        <div class="list">
          ${state.rooms
            .map(
              (r) => `
            <div class="item">
              <div class="left">
                <div class="t">${esc(r.name)}</div>
                <div class="s">容量：${esc(r.capacity)}　优先级：${esc(r.priority)}</div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="danger small" onclick="delRoom(${r.id})">删除</button>
              </div>
            </div>
          `
            )
            .join("") || `<div class="meta">暂无教室</div>`}
        </div>
      </div>
    </div>
  `;
}
window.addRoom = async () => {
  try {
    const name = $("#roomName").value.trim();
    const capacity = Number($("#roomCap").value);
    const priority = Number($("#roomPri").value || 100);
    await apiSend("/api/rooms", "POST", { name, capacity, priority });
    setMsg("已添加教室 ✅", "ok");
    await refreshAll();
    render();
  } catch (e) {
    setMsg(e.message, "bad");
  }
};
window.delRoom = async (id) => {
  if (!confirm("确定删除该教室？（已排好的课表也会清理该教室占用）")) return;
  try {
    await apiSend(`/api/rooms/${id}`, "DELETE");
    setMsg("已删除教室 ✅", "ok");
    await refreshAll();
    render();
  } catch (e) {
    setMsg(e.message, "bad");
  }
};

/* -------------------- classes -------------------- */
function renderClasses() {
  const app = $("#app");
  app.innerHTML = `
    <div class="grid">
      <div class="card">
        <h3>新增班级</h3>
        <div class="row">
          <input id="clsName" placeholder="班级名称，例如 软件2301" />
          <input id="clsSize" placeholder="人数，例如 45" inputmode="numeric" />
        </div>
        <div class="row" style="margin-top:10px">
          <select id="clsAllow">
            <option value="1">当天允许换教室（可窜教室）</option>
            <option value="0">当天不允许换教室（同一天尽量固定）</option>
          </select>
          <input id="clsMinCont" placeholder="班级最少连续节数（默认1）" inputmode="numeric" />
        </div>
        <div style="margin-top:10px" class="meta">班级可上时间段（打勾=允许上课）：</div>
        ${renderMaskCheckboxes(state.meta.full_mask, "clsMask")}
        <input data-mask-out="clsMask" id="clsMaskOut" value="${state.meta.full_mask}" style="display:none">

        <div style="margin-top:10px" class="meta">班级偏好教室（可选，填教室ID，用英文逗号隔开，例如 1,3,2；不填则按教室优先级）</div>
        <input id="clsPreferRooms" placeholder="例如 1,3,2（可不填）" />

        <div class="row" style="margin-top:10px">
          <button class="primary" onclick="addClass()">添加班级</button>
          <div class="meta">时间规则：08:00–23:00，90分钟/节，共10段</div>
        </div>
      </div>

      <div class="card">
        <h3>班级列表</h3>
        <div class="list">
          ${state.classes
            .map(
              (c) => `
              <div class="item">
                <div class="left">
                  <div class="t">${esc(c.name)}</div>
                  <div class="s">
                   