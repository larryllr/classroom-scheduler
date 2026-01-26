/* 宽宽牌教室分配系统（离线版）
   - 启动自检：/api/ping + /api/meta
   - fetch 超时 + 可视化报错（不再“加载中”无限转）
   - 深色现代UI，修复白底白字
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  meta: null,
  rooms: [],
  classes: [],
  teachers: [],
  tasks: [],
  activeTab: "rooms",
  selectedDates: new Set(),
};

function fmtErr(e) {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.message || String(e);
}

async function apiFetch(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeout ?? 8000);

  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(opts.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // 非JSON也可能是404文本
      json = null;
    }

    if (!res.ok) {
      const msg =
        (json && (json.message || json.error)) ||
        `HTTP ${res.status} ${res.statusText}: ${text?.slice(0, 200)}`;
      throw new Error(msg);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function setMsg(text, type = "") {
  const el = $("#msg");
  if (!el) return;
  el.className = "msg" + (type ? " " + type : "");
  el.textContent = text;
}
function setStatus(kind, msg) {
  const type = kind === "ok" ? "ok" : kind === "err" ? "bad" : "";
  setMsg(msg, type);
}
function clearStatus() {
  setMsg("");
}
function toast(msg) {
  setMsg(msg, "ok");
}

window.solveSchedule = async () => {
  try {
    clearStatus();
    toast("开始排课…");
    const r = await apiFetch("/api/solve", { method: "POST", body: JSON.stringify({}), timeout: 20000 });
    toast(r.message || "排课完成");
  } catch (e) {
    setStatus("err", "排课失败：" + fmtErr(e));
  }
};

window.exportData = async () => {
  try {
    const data = await apiFetch("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `宽宽牌教室分配系统备份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast("已导出备份");
  } catch (e) {
    setStatus("err", "导出失败：" + fmtErr(e));
  }
};

window.importData = async (file) => {
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    await apiFetch("/api/import", { method: "POST", body: JSON.stringify(json) });
    toast("导入成功");
    await loadAll();
    render();
  } catch (e) {
    setStatus("err", "导入失败：" + fmtErr(e));
  }
};

function render() {
  const app = $("#app");
  if (!state.meta) {
    app.innerHTML = `<div class="card"><div class="meta">加载中…</div></div>`;
    return;
  }
  app.innerHTML = renderTab();
  if (state.activeTab === "rooms") bindRooms();
  if (state.activeTab === "classes") bindClasses();
  if (state.activeTab === "teachers") bindTeachers();
  if (state.activeTab === "tasks") bindTasks();
  if (state.activeTab === "schedule") bindSchedule();
}

function renderTab() {
  switch (state.activeTab) {
    case "rooms":
      return renderRooms();
    case "classes":
      return renderClasses();
    case "teachers":
      return renderTeachers();
    case "tasks":
      return renderTasks();
    case "schedule":
      return renderSchedule();
    default:
      return `<div class="card">未知页面</div>`;
  }
}

/* ---------------- Rooms ---------------- */
function renderRooms() {
  const rows = state.rooms
    .map(
      (r) => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${r.capacity}</td>
      <td>${r.priority}</td>
      <td class="right">
        <button class="btn danger sm" data-del-room="${r.id}">删除</button>
      </td>
    </tr>`
    )
    .join("");

  return `
  <section class="grid2">
    <div class="card">
      <div class="cardTitle">新建教室</div>
      <div class="form">
        <label>教室名称<input id="roomName" placeholder="如：A101" /></label>
        <label>容纳人数<input id="roomCap" type="number" min="1" placeholder="如：60" /></label>
        <label>优先级（越小越优先）<input id="roomPri" type="number" placeholder="如：1" /></label>
        <button class="btn primary" id="btnAddRoom">添加教室</button>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">教室列表</div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>名称</th><th>容量</th><th>优先级</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="muted">暂无教室</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </section>`;
}

/* ---------------- Classes ---------------- */
function maskBadges(mask) {
  const slots = state.meta?.slots || [];
  const chips = [];
  for (let i = 0; i < slots.length; i++) {
    const on = (mask & (1 << i)) !== 0;
    const label = `${slots[i].start}-${slots[i].end}`;
    chips.push(`<span class="chip ${on ? "on" : ""}" data-slot="${i}">${label}</span>`);
  }
  return chips.join("");
}

function renderClasses() {
  const roomOptions = state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}（${r.capacity}）</option>`).join("");
  const rows = state.classes
    .map((c) => {
      return `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${c.size}</td>
        <td>${c.allow_switch ? "可" : "不可"}</td>
        <td>${esc(c.preferred_rooms || "")}</td>
        <td class="right">
          <button class="btn ghost sm" data-edit-class="${c.id}">编辑</button>
          <button class="btn danger sm" data-del-class="${c.id}">删除</button>
        </td>
      </tr>`;
    })
    .join("");

  return `
  <section class="grid2">
    <div class="card">
      <div class="cardTitle">新建班级</div>
      <div class="form">
        <label>班级名称<input id="className" placeholder="如：高一(3)班" /></label>
        <label>人数<input id="classSize" type="number" min="1" placeholder="如：45" /></label>

        <label class="row">
          <span>同一天不换教室</span>
          <input id="classFixed" type="checkbox" />
        </label>

        <label>班级优先教室（可选，多选按顺序）</label>
        <select id="classPrefRooms" multiple size="6">${roomOptions}</select>

        <label>班级可上时间段（点亮为可上）</label>
        <div class="chips" id="classAvail">${maskBadges(state.meta?.full_mask ?? 1023)}</div>

        <button class="btn primary" id="btnAddClass">添加班级</button>
      </div>
      <div class="muted small">提示：可上时间段从第一节开始后需要连续勾选。</div>
    </div>

    <div class="card">
      <div class="cardTitle">班级列表</div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>班级</th><th>人数</th><th>同日固定教室</th><th>优先教室</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">暂无班级</td></tr>`}</tbody>
        </table>
      </div>
      <div class="muted small">编辑功能会在弹窗里完成（为了让不会的人更简单）。</div>
    </div>
  </section>`;
}

/* ---------------- Teachers ---------------- */
function renderTeachers() {
  const rows = state.teachers
    .map(
      (t) => `
    <tr>
      <td>${esc(t.name)}</td>
      <td>${esc(t.subject || "")}</td>
      <td class="right">
        <button class="btn ghost sm" data-edit-teacher="${t.id}">编辑</button>
        <button class="btn danger sm" data-del-teacher="${t.id}">删除</button>
      </td>
    </tr>`
    )
    .join("");

  return `
  <section class="grid2">
    <div class="card">
      <div class="cardTitle">新建教师</div>
      <div class="form">
        <label>教师姓名<input id="teacherName" placeholder="如：张老师" /></label>
        <label>授课科目<input id="teacherSubject" placeholder="如：数学" /></label>
        <label>教师可上时间段（点亮为可上）</label>
        <div class="chips" id="teacherAvail">${maskBadges(state.meta?.full_mask ?? 1023)}</div>
        <button class="btn primary" id="btnAddTeacher">添加教师</button>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">教师列表</div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>教师</th><th>授课科目</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3" class="muted">暂无教师</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </section>`;
}

/* ---------------- Tasks ---------------- */
function renderTasks() {
  const classOpt = state.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const teacherOpt = state.teachers
    .map((t) => `<option value="${t.id}">${esc(t.name)}（${esc(t.subject || "未设置科目")}）</option>`)
    .join("");

  const rows = state.tasks
    .map((t) => {
      const time = typeof t.time_index === "number" ? slotText(t.time_index) : "";
      return `
      <tr>
        <td>${t.date}</td>
        <td>${esc(t.class_name || "")}</td>
        <td>${esc(time || "")}</td>
        <td>${esc(t.teacher_name || "")}</td>
        <td>${esc(t.course_name || "")}</td>
        <td class="right"><button class="btn danger sm" data-del-task="${t.id}">删除</button></td>
      </tr>`;
    })
    .join("");

  return `
  <section class="grid2">
    <div class="card">
      <div class="cardTitle">添加排课任务（用日历批量选日期）</div>
      <div class="form">
        <label>班级<select id="taskClass">${classOpt}</select></label>
        <label>授课老师（可多选）<select id="taskTeacher" multiple size="6">${teacherOpt}</select></label>
        <label>选择时间段（可多选）</label>
        <div class="chips" id="taskSlots">${maskBadges(0)}</div>

        <div class="calendarWrap">
          <div class="calTitle">选择上课日期（点日期可多选）</div>
          <div class="calendar" id="calendar"></div>
          <div class="rowBtns">
            <button class="btn ghost sm" id="btnClearDates">清空日期</button>
            <button class="btn primary" id="btnAddTaskDates">按选中日期批量添加</button>
          </div>
          <div class="muted small">已选日期：<span id="pickedDates">${renderPickedDates()}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">任务列表</div>
      <div class="rowBtns">
        <button class="btn primary" id="btnSolve">一键排课</button>
        <button class="btn ghost" id="btnReloadTasks">刷新</button>
      </div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>日期</th><th>班级</th><th>时间段</th><th>教师</th><th>科目</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted">暂无任务</td></tr>`}</tbody>
        </table>
      </div>
      <div class="muted small">
        说明：排课时间段为 08:00–23:00，90分钟/节；班级/教师可限制可上时间段；教室/教师/班级同一时间段不能冲突；班级勾选“同日不换教室”会强制当天固定教室。
      </div>
    </div>
  </section>`;
}

function renderPickedDates() {
  const arr = Array.from(state.selectedDates).sort();
  if (!arr.length) return `<span class="muted">未选择</span>`;
  return arr.map((d) => `<span class="pill">${d}</span>`).join(" ");
}

function renderSchedule() {
  const date = $("#schedDate")?.value || "";
  const roomOpt = state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  const teacherOpt = state.teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");

  return `
  <section class="card">
    <div class="cardTitle">生成课表（可复制发群）</div>

    <div class="form inline">
      <label>日期（可空=全部）<input id="schedDate" placeholder="YYYY-MM-DD" value="${esc(date)}"/></label>
      <label>按教室<select id="schedRoom"><option value="">全部教室</option>${roomOpt}</select></label>
      <button class="btn primary" id="btnLoadRoomSched">生成教室课表</button>

      <label>按教师<select id="schedTeacher"><option value="">全部教师</option>${teacherOpt}</select></label>
      <button class="btn primary" id="btnLoadTeacherSched">生成教师课表</button>

      <button class="btn ghost" id="btnCopySched">复制发群</button>
      <button class="btn ghost" id="btnExportXlsx">导出xlsx</button>
    </div>

    <pre class="output" id="schedOut">点击上面的按钮生成课表（格式：时间 + 教室 / 班级 / 教师 / 课程）</pre>
  </section>`;
}

/* ---------------- Binding ---------------- */

/* Rooms binds */
function bindRooms() {
  $("#btnAddRoom")?.addEventListener("click", async () => {
    try {
      const name = $("#roomName").value.trim();
      const capacity = Number($("#roomCap").value);
      const priority = Number($("#roomPri").value || 100);
      await apiFetch("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name, capacity, priority }),
      });
      toast("教室已添加");
      await loadRooms();
      render();
    } catch (e) {
      setStatus("err", "添加教室失败：" + fmtErr(e));
    }
  });

  $$("[data-del-room]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除这个教室？")) return;
      try {
        await apiFetch(`/api/rooms/${btn.dataset.delRoom}`, { method: "DELETE" });
        toast("已删除");
        await loadRooms();
        render();
      } catch (e) {
        setStatus("err", "删除失败：" + fmtErr(e));
      }
    });
  });
}

/* Chips helpers: build mask from clicked chips */
function bindChips(containerId, initialMask = FULL_MASK) {
  const el = $(containerId);
  if (!el) return { getMask: () => initialMask, setMask: () => {} };

  let mask = initialMask;
  const sync = () => {
    $$("#" + el.id + " .chip").forEach((c) => {
      const i = Number(c.dataset.slot);
      const on = (mask & (1 << i)) !== 0;
      c.classList.toggle("on", on);
    });
  };

  el.addEventListener("click", (ev) => {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    const i = Number(chip.dataset.slot);
    mask ^= 1 << i;
    // 不允许全关（至少开一个）
    if (mask === 0) mask = 1 << i;
    sync();
  });

  sync();
  return {
    getMask: () => mask,
    setMask: (m) => {
      mask = m;
      sync();
    },
  };
}

function maskToIndexes(mask) {
  const idx = [];
  for (let i = 0; i < (state.meta?.slots?.length || 0); i++) {
    if ((mask & (1 << i)) !== 0) idx.push(i);
  }
  return idx;
}

/* Classes binds */
function bindClasses() {
  const classAvail = bindChips("#classAvail", state.meta?.full_mask ?? 1023);

  $("#btnAddClass")?.addEventListener("click", async () => {
    try {
      const name = $("#className").value.trim();
      const size = Number($("#classSize").value);
      const allow_switch = !$("#classFixed").checked; // 选中=同日不换 => allow_switch=0
      const pref = Array.from($("#classPrefRooms").selectedOptions).map((o) => o.value).join(",");
      const avail_mask = classAvail.getMask();
      await apiFetch("/api/classes", {
        method: "POST",
        body: JSON.stringify({
          name,
          size,
          allow_switch,
          preferred_room_ids: pref,
          avail_mask,
        }),
      });
      toast("班级已添加");
      await loadClasses();
      render();
    } catch (e) {
      setStatus("err", "添加班级失败：" + fmtErr(e));
    }
  });

  $$("[data-del-class]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除这个班级？（会同时删除该班级的任务与排课结果）")) return;
      try {
        await apiFetch(`/api/classes/${btn.dataset.delClass}`, { method: "DELETE" });
        toast("已删除");
        await loadClasses();
        await loadTasks();
        render();
      } catch (e) {
        setStatus("err", "删除失败：" + fmtErr(e));
      }
    });
  });

  $$("[data-edit-class]").forEach((btn) => {
    btn.addEventListener("click", () => openEditClass(btn.dataset.editClass));
  });
}

function openEditClass(id) {
  const c = state.classes.find((x) => String(x.id) === String(id));
  if (!c) return;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
  <div class="modal">
    <div class="modalTitle">编辑班级</div>
    <div class="form">
      <label>班级名称<input id="mClassName" value="${esc(c.name)}"/></label>
      <label>人数<input id="mClassSize" type="number" min="1" value="${c.size}"/></label>

      <label class="row"><span>同一天不换教室</span><input id="mClassFixed" type="checkbox" ${c.allow_switch ? "" : "checked"} /></label>

      <div class="rowBtns">
        <button class="btn primary" id="mSave">保存</button>
        <button class="btn ghost" id="mClose">取消</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#mClose").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#mSave").addEventListener("click", async () => {
    try {
      const name = overlay.querySelector("#mClassName").value.trim();
      const size = Number(overlay.querySelector("#mClassSize").value);
      const allow_switch = !overlay.querySelector("#mClassFixed").checked;
      await apiFetch(`/api/classes/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          size,
          allow_switch,
          preferred_room_ids: c.preferred_room_ids || "",
          avail_mask: c.avail_mask ?? (state.meta?.full_mask ?? 1023),
        }),
      });
      toast("已保存");
      overlay.remove();
      await loadClasses();
      render();
    } catch (e) {
      setStatus("err", "保存失败：" + fmtErr(e));
    }
  });
}

/* Teachers binds */
function bindTeachers() {
  const teacherAvail = bindChips("#teacherAvail", state.meta?.full_mask ?? 1023);

  $("#btnAddTeacher")?.addEventListener("click", async () => {
    try {
      const name = $("#teacherName").value.trim();
      const subject = $("#teacherSubject").value.trim();
      const avail_mask = teacherAvail.getMask();
      await apiFetch("/api/teachers", { method: "POST", body: JSON.stringify({ name, subject, avail_mask }) });
      toast("教师已添加");
      await loadTeachers();
      render();
    } catch (e) {
      setStatus("err", "添加教师失败：" + fmtErr(e));
    }
  });

  $$("[data-del-teacher]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除该教师？（会删除该教师的任务与排课结果）")) return;
      try {
        await apiFetch(`/api/teachers/${btn.dataset.delTeacher}`, { method: "DELETE" });
        toast("已删除");
        await loadTeachers();
        await loadTasks();
        render();
      } catch (e) {
        setStatus("err", "删除失败：" + fmtErr(e));
      }
    });
  });

  $$("[data-edit-teacher]").forEach((btn) => {
    btn.addEventListener("click", () => openEditTeacher(btn.dataset.editTeacher));
  });
}

function openEditTeacher(id) {
  const t = state.teachers.find((x) => String(x.id) === String(id));
  if (!t) return;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
  <div class="modal">
    <div class="modalTitle">编辑教师</div>
    <div class="form">
      <label>教师姓名<input id="mTName" value="${esc(t.name)}"/></label>
      <label>授课科目<input id="mTSubject" value="${esc(t.subject || "")}"/></label>
      <div class="rowBtns">
        <button class="btn primary" id="mSave">保存</button>
        <button class="btn ghost" id="mClose">取消</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#mClose").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#mSave").addEventListener("click", async () => {
    try {
      const name = overlay.querySelector("#mTName").value.trim();
      const subject = overlay.querySelector("#mTSubject").value.trim();
      await apiFetch(`/api/teachers/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          subject,
          avail_mask: t.avail_mask ?? (state.meta?.full_mask ?? 1023),
        }),
      });
      toast("已保存");
      overlay.remove();
      await loadTeachers();
      render();
    } catch (e) {
      setStatus("err", "保存失败：" + fmtErr(e));
    }
  });
}

/* Tasks binds */
function bindTasks() {
  buildCalendar("#calendar");
  const taskSlots = bindChips("#taskSlots", 0);

  $("#btnClearDates")?.addEventListener("click", () => {
    state.selectedDates.clear();
    $("#pickedDates").innerHTML = renderPickedDates();
    buildCalendar("#calendar");
  });

  $("#btnAddTaskDates")?.addEventListener("click", async () => {
    try {
      const class_id = Number($("#taskClass").value);
      const teacher_ids = Array.from($("#taskTeacher").selectedOptions)
        .map((o) => Number(o.value))
        .filter(Boolean);
      const time_indexes = maskToIndexes(taskSlots.getMask());
      const dates = Array.from(state.selectedDates);

      await apiFetch("/api/tasks/add-dates", {
        method: "POST",
        body: JSON.stringify({ class_id, teacher_ids, time_indexes, dates }),
      });

      toast("任务已添加");
      state.selectedDates.clear();
      await loadTasks();
      render();
    } catch (e) {
      setStatus("err", "添加任务失败：" + fmtErr(e));
    }
  });

  $("#btnSolve")?.addEventListener("click", async () => {
    try {
      clearStatus();
      toast("开始排课…");
      const r = await apiFetch("/api/solve", { method: "POST", body: JSON.stringify({}) , timeout: 20000});
      toast(r.message || "排课完成");
    } catch (e) {
      setStatus("err", "排课失败：" + fmtErr(e));
    }
  });

  $("#btnReloadTasks")?.addEventListener("click", async () => {
    await loadTasks();
    render();
  });

  $$("[data-del-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除该任务？")) return;
      try {
        await apiFetch(`/api/tasks/${btn.dataset.delTask}`, { method: "DELETE" });
        toast("已删除");
        await loadTasks();
        render();
      } catch (e) {
        setStatus("err", "删除失败：" + fmtErr(e));
      }
    });
  });
}

/* Schedule binds */
let lastScheduleText = "";
let lastScheduleItems = [];
function bindSchedule() {
  $("#btnLoadRoomSched")?.addEventListener("click", async () => {
    try {
      clearStatus();
      const date = $("#schedDate").value.trim();
      const room_id = $("#schedRoom").value;
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      if (room_id) qs.set("room_id", room_id);
      const r = await apiFetch(`/api/schedule/rooms?${qs.toString()}`);
      lastScheduleItems = r.items || [];
      lastScheduleText = formatSchedule(lastScheduleItems, "room");
      $("#schedOut").textContent = lastScheduleText;
      toast("已生成教室课表");
    } catch (e) {
      setStatus("err", "生成失败：" + fmtErr(e));
    }
  });

  $("#btnLoadTeacherSched")?.addEventListener("click", async () => {
    try {
      clearStatus();
      const date = $("#schedDate").value.trim();
      const teacher_id = $("#schedTeacher").value;
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      if (teacher_id) qs.set("teacher_id", teacher_id);
      const r = await apiFetch(`/api/schedule/teachers?${qs.toString()}`);
      lastScheduleItems = r.items || [];
      lastScheduleText = formatSchedule(lastScheduleItems, "teacher");
      $("#schedOut").textContent = lastScheduleText;
      toast("已生成教师课表");
    } catch (e) {
      setStatus("err", "生成失败：" + fmtErr(e));
    }
  });

  $("#btnCopySched")?.addEventListener("click", async () => {
    try {
      if (!lastScheduleText) {
        toast("先生成课表再复制");
        return;
      }
      await navigator.clipboard.writeText(lastScheduleText);
      toast("已复制，可直接发群");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = lastScheduleText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("已复制，可直接发群");
    }
  });

  $("#btnExportXlsx")?.addEventListener("click", () => {
    if (!lastScheduleItems.length) {
      toast("请先生成课表再导出");
      return;
    }
    const rows = [
      ["日期", "时间段", "教室", "班级", "教师", "科目"],
      ...lastScheduleItems.map((i) => [
        i.date || "",
        slotText(i.time_index) || "",
        i.room_name || "",
        i.class_name || "",
        i.teacher_name || "",
        i.course_name || "",
      ]),
    ];
    const html = `\n      <html><head><meta charset=\"utf-8\"/></head><body>\n      <table border=\"1\">\n        ${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join(\"\")}</tr>`).join(\"\")}\n      </table>\n      </body></html>\n    `;\n    const blob = new Blob([html], { type: \"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\" });\n    const a = document.createElement(\"a\");\n    a.href = URL.createObjectURL(blob);\n    a.download = `课表_${new Date().toISOString().slice(0, 10)}.xlsx`;\n    a.click();\n    toast(\"已导出xlsx\");\n  });
}

/* --------- Calendar --------- */
function buildCalendar(containerSel) {
  const el = $(containerSel);
  if (!el) return;
  el.style.display = "grid";
  el.style.gridTemplateColumns = "repeat(7, minmax(0, 1fr))";
  el.style.gap = "8px";

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  const first = new Date(y, m, 1);
  const startDay = first.getDay(); // 0 Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const cells = [];
  const weekHeader = ["日", "一", "二", "三", "四", "五", "六"].map((d) => `<div class="calH">${d}</div>`).join("");
  cells.push(weekHeader);

  for (let i = 0; i < startDay; i++) cells.push(`<div class="calCell muted"></div>`);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const picked = state.selectedDates.has(dateStr) ? "picked" : "";
    cells.push(`<button class="calCell ${picked}" data-date="${dateStr}">${d}</button>`);
  }

  el.innerHTML = cells.join("");

  $$("#calendar .calCell[data-date]").forEach((b) => {
    b.addEventListener("click", () => {
      const d = b.dataset.date;
      if (state.selectedDates.has(d)) state.selectedDates.delete(d);
      else state.selectedDates.add(d);
      $("#pickedDates").innerHTML = renderPickedDates();
      buildCalendar(containerSel);
    });
  });
}

/* --------- Formatting --------- */
function slotText(i) {
  const s = state.meta?.slots?.[i];
  if (!s) return "";
  return `${s.start}-${s.end}`;
}

function formatSchedule(items, mode) {
  // mode room/teacher: 都输出 “时间 + 教室” 重点，再带班级/老师/课程
  const byKey = new Map();
  for (const it of items || []) {
    const key = mode === "room" ? (it.room_name || "未知教室") : (it.teacher_name || "未知教师");
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(it);
  }

  const keys = Array.from(byKey.keys()).sort((a, b) => a.localeCompare(b, "zh"));
  const lines = [];
  for (const k of keys) {
    lines.push(`【${k}】`);
    const arr = byKey.get(k).slice().sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time_index - b.time_index;
    });

    // 合并连续时间段（同一天同一任务同一教室/教师）
    let i = 0;
    while (i < arr.length) {
      const cur = arr[i];
      let j = i;
      while (
        j + 1 < arr.length &&
        arr[j + 1].date === cur.date &&
        arr[j + 1].task_id === cur.task_id &&
        arr[j + 1].room_id === cur.room_id &&
        arr[j + 1].teacher_id === cur.teacher_id &&
        arr[j + 1].class_id === cur.class_id &&
        arr[j + 1].time_index === arr[j].time_index + 1
      ) {
        j++;
      }

      const startSlot = arr[i].time_index;
      const endSlot = arr[j].time_index;

      const start = state.meta?.slots?.[startSlot]?.start || "";
      const end = state.meta?.slots?.[endSlot]?.end || "";

      const time = `${cur.date} ${start}-${end}`;
      const place = `教室：${cur.room_name || "?"}`;
      const cls = `班级：${cur.class_name || "?"}`;
      const te = `教师：${cur.teacher_name || "?"}`;
      const course = `课程：${cur.course_name || "?"}`;

      lines.push(`${time}  ${place}`);
      lines.push(`  ${cls}  ${te}  ${course}`);
      i = j + 1;
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/* ---------------- Loaders ---------------- */
async function loadRooms() {
  state.rooms = await apiFetch("/api/rooms");
}
async function loadClasses() {
  state.classes = await apiFetch("/api/classes");
}
async function loadTeachers() {
  state.teachers = await apiFetch("/api/teachers");
}
async function loadTasks() {
  const r = await apiFetch("/api/tasks");
  state.tasks = r.items || [];
}
async function loadMeta() {
  state.meta = await apiFetch("/api/meta");
}
async function loadAll() {
  await loadMeta();
  await Promise.all([loadRooms(), loadClasses(), loadTeachers(), loadTasks()]);
}

/* ---------------- Boot ---------------- */
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function boot() {
  setMsg("加载中…");
  render();
  try {
    // 先 ping，确认 API 活着
    await apiFetch("/api/ping", { timeout: 2500 });

    await loadAll();
    clearStatus();
    render();
  } catch (e) {
    const msg = fmtErr(e);
    setStatus("err", "启动失败：" + msg);
    const app = $("#app");
    if (app) {
      app.innerHTML = `
      <div class="card">
        <div class="cardTitle">启动失败</div>
        <div class="meta">原因：${esc(msg)}</div>
        <div class="meta">请把 <b>last.log</b> 最后 30 行发给我，我能直接定位。</div>
        <div class="meta">你也可以在浏览器地址栏打开：<code>/api/ping</code>、<code>/api/meta</code> 测试。</div>
      </div>`;
    }
  }
}

boot();
