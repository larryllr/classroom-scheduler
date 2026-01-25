/* 宽宽牌教室分配系统（离线版）
   - 启动自检：/api/ping + /api/meta
   - fetch 超时 + 可视化报错（不再“加载中”无限转）
   - 深色现代UI（配合 style.css），修复白底白字
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

/* ✅ 修复点：#status 不存在时不崩溃（启动页阶段就是不存在） */
function setStatus(kind, msg) {
  const box = $("#status");
  if (!box) {
    try {
      console.warn("[STATUS]", kind, msg);
    } catch {}
    return;
  }
  box.className = `status ${kind}`;
  box.textContent = msg;
  box.style.display = "block";
}
function clearStatus() {
  const box = $("#status");
  if (!box) return;
  box.style.display = "none";
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

function render() {
  $("#app").innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo">宽</div>
        <div>
          <div class="title">宽宽牌教室分配系统</div>
          <div class="sub">流程：教室 → 班级 → 教师 → 排课任务（日历） → 一键排课 → 复制发群</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" id="btnExport">导出备份</button>
        <label class="btn ghost file">
          导入备份<input type="file" id="fileImport" accept="application/json" />
        </label>
      </div>
    </header>

    <div id="status" class="status" style="display:none"></div>

    <nav class="tabs">
      ${tabBtn("rooms", "教室")}
      ${tabBtn("classes", "班级")}
      ${tabBtn("teachers", "教师")}
      ${tabBtn("tasks", "排课任务")}
      ${tabBtn("schedule", "课表")}
    </nav>

    <main class="main">
      ${renderTab()}
    </main>

    <footer class="footer">
      <div class="hint">时间段：08:00–23:00，90分钟/节，无间隔；排课结果可按“教室课表/教师课表”分别生成。</div>
    </footer>

    <div id="toast" class="toast"></div>
  </div>
  `;

  bindCommon();
  bindTab();
}

function tabBtn(key, text) {
  const active = state.activeTab === key ? "active" : "";
  return `<button class="tab ${active}" data-tab="${key}">${text}</button>`;
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
    chips.push(`<span class="chip ${on ? "on" : ""}" data-slot="${i}">${slots[i].start}</span>`);
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

        <label>最少连续节数<input id="classMinCont" type="number" min="1" max="10" value="1"/></label>

        <button class="btn primary" id="btnAddClass">添加班级</button>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">班级列表</div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>班级</th><th>人数</th><th>同日固定教室</th><th>优先教室</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">暂无班级</td></tr>`}</tbody>
        </table>
      </div>
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
      <td>${t.min_continuous || 1}</td>
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
        <label>教师可上时间段（点亮为可上）</label>
        <div class="chips" id="teacherAvail">${maskBadges(state.meta?.full_mask ?? 1023)}</div>
        <label>最少连续节数<input id="teacherMinCont" type="number" min="1" max="10" value="1"/></label>
        <button class="btn primary" id="btnAddTeacher">添加教师</button>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">教师列表</div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>教师</th><th>最少连续节</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3" class="muted">暂无教师</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </section>`;
}

/* ---------------- Tasks ---------------- */
function renderTasks() {
  const classOpt = state.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const teacherOpt = state.teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  const roomOpt = state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");

  const rows = state.tasks
    .map((t) => {
      return `
      <tr>
        <td>${t.date}</td>
        <td>${esc(t.class_name || "")}</td>
        <td>${esc(t.course_name || "")}</td>
        <td>${esc(t.teacher_name || "")}</td>
        <td>${t.periods}</td>
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
        <label>教师<select id="taskTeacher">${teacherOpt}</select></label>
        <label>课程名称<input id="taskCourse" placeholder="如：数学" /></label>

        <label>连续节数（必须相邻）<input id="taskPeriods" type="number" min="1" max="10" value="1"/></label>

        <label>任务优先教室（可选，多选按顺序）</label>
        <select id="taskPreferRooms" multiple size="6">${roomOpt}</select>

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
          <thead><tr><th>日期</th><th>班级</th><th>课程</th><th>教师</th><th>连续节</th><th class="right">操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted">暂无任务</td></tr>`}</tbody>
        </table>
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
    </div>

    <pre class="output" id="schedOut">点击上面的按钮生成课表（格式：时间 + 教室 / 班级 / 教师 / 课程）</pre>
  </section>`;
}

/* ---------------- Binding ---------------- */
function bindCommon() {
  $("#btnExport")?.addEventListener("click", async () => {
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
  });

  $("#fileImport")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
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
    } finally {
      ev.target.value = "";
    }
  });
}

function bindTab() {
  $$(".tab").forEach((b) => {
    b.addEventListener("click", async () => {
      state.activeTab = b.dataset.tab;
      clearStatus();
      render();
    });
  });

  if (state.activeTab === "rooms") bindRooms();
  if (state.activeTab === "classes") bindClasses();
  if (state.activeTab === "teachers") bindTeachers();
  if (state.activeTab === "tasks") bindTasks();
  if (state.activeTab === "schedule") bindSchedule();
}

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

/* Chips helper */
function bindChips(containerId, initialMask) {
  const el = $(containerId);
  if (!el) return { getMask: () => initialMask ?? 1023, setMask: () => {} };

  let mask = initialMask ?? 1023;

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
    if (mask === 0) mask = 1 << i;
    sync();
  });

  sync();
  return { getMask: () => mask, setMask: (m) => ((mask = m), sync()) };
}

/* Classes binds */
function bindClasses() {
  const classAvail = bindChips("#classAvail", state.meta?.full_mask ?? 1023);

  $("#btnAddClass")?.addEventListener("click", async () => {
    try {
      const name = $("#className").value.trim();
      const size = Number($("#classSize").value);
      const allow_switch = !$("#classFixed").checked;
      const pref = Array.from($("#classPrefRooms").selectedOptions).map((o) => o.value).join(",");
      const avail_mask = classAvail.getMask();
      const min_continuous = Number($("#classMinCont").value || 1);

      await apiFetch("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name, size, allow_switch, preferred_room_ids: pref, avail_mask, min_continuous }),
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
      <label>最少连续节数<input id="mClassMin" type="number" min="1" max="10" value="${c.min_continuous || 1}"/></label>
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
      const min_continuous = Number(overlay.querySelector("#mClassMin").value || 1);
      await apiFetch(`/api/classes/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          size,
          allow_switch,
          preferred_room_ids: c.preferred_room_ids || "",
          avail_mask: c.avail_mask ?? (state.meta?.full_mask ?? 1023),
          min_continuous,
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
      const avail_mask = teacherAvail.getMask();
      const min_continuous = Number($("#teacherMinCont").value || 1);
      await apiFetch("/api/teachers", { method: "POST", body: JSON.stringify({ name, avail_mask, min_continuous }) });
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
      <label>最少连续节数<input id="mTMin" type="number" min="1" max="10" value="${t.min_continuous || 1}"/></label>
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
      const min_continuous = Number(overlay.querySelector("#mTMin").value || 1);
      await apiFetch(`/api/teachers/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          avail_mask: t.avail_mask ?? (state.meta?.full_mask ?? 1023),
          min_continuous,
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

  $("#btnClearDates")?.addEventListener("click", () => {
    state.selectedDates.clear();
    $("#pickedDates").innerHTML = renderPickedDates();
    buildCalendar("#calendar");
  });

  $("#btnAddTaskDates")?.addEventListener("click", async () => {
    try {
      const class_id = Number($("#taskClass").value);
      const teacher_id = Number($("#taskTeacher").value);
      const course_name = $("#taskCourse").value.trim();
      const periods = Number($("#taskPeriods").value || 1);
      const dates = Array.from(state.selectedDates);
      const prefer_room_ids = Array.from($("#taskPreferRooms").selectedOptions).map((o) => o.value).join(",");

      await apiFetch("/api/tasks/add-dates", {
        method: "POST",
        body: JSON.stringify({ class_id, teacher_id, course_name, periods, dates, prefer_room_ids }),
        timeout: 12000,
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
      const r = await apiFetch("/api/solve", { method: "POST", body: JSON.stringify({}), timeout: 20000 });
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
function bindSchedule() {
  $("#btnLoadRoomSched")?.addEventListener("click", async () => {
    try {
      clearStatus();
      const date = $("#schedDate").value.trim();
      const room_id = $("#schedRoom").value;
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      if (room_id) qs.set("room_id", room_id);
      const r = await apiFetch(`/api/schedule/rooms?${qs.toString()}`, { timeout: 12000 });
      lastScheduleText = formatSchedule(r.items, "room");
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
      const r = await apiFetch(`/api/schedule/teachers?${qs.toString()}`, { timeout: 12000 });
      lastScheduleText = formatSchedule(r.items, "teacher");
      $("#schedOut").textContent = lastScheduleText;
      toast("已生成教师课表");
    } catch (e) {
      setStatus("err", "生成失败：" + fmtErr(e));
    }
  });

  $("#btnCopySched")?.addEventListener("click", async () => {
    try {
      if (!lastScheduleText) return toast("先生成课表再复制");
      await navigator.clipboard.writeText(lastScheduleText);
      toast("已复制，可直接发群");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = lastScheduleText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("已复制，可直接发群");
    }
  });
}

/* --------- Calendar --------- */
function buildCalendar(containerSel) {
  const el = $(containerSel);
  if (!el) return;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const first = new Date(y, m, 1);
  const startDay = first.getDay();
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

/* --------- Schedule format --------- */
function formatSchedule(items, mode) {
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
      ) j++;

      const start = state.meta?.slots?.[arr[i].time_index]?.start || "";
      const end = state.meta?.slots?.[arr[j].time_index]?.end || "";
      const time = `${cur.date} ${start}-${end}`;
      lines.push(`${time}  教室：${cur.room_name || "?"}`);
      lines.push(`  班级：${cur.class_name || "?"}  教师：${cur.teacher_name || "?"}  课程：${cur.course_name || "?"}`);
      i = j + 1;
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/* ---------------- Loaders ---------------- */
async function loadRooms() { state.rooms = await apiFetch("/api/rooms"); }
async function loadClasses() { state.classes = await apiFetch("/api/classes"); }
async function loadTeachers() { state.teachers = await apiFetch("/api/teachers"); }
async function loadTasks() {
  const r = await apiFetch("/api/tasks");
  state.tasks = r.items || [];
}
async function loadMeta() { state.meta = await apiFetch("/api/meta"); }
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
  document.body.innerHTML = `
  <div class="boot">
    <div class="spinner"></div>
    <div class="bootText">加载中…</div>
    <div class="bootSub">如果超过10秒，请把启动失败原因发我。</div>
  </div>`;

  try {
    await apiFetch("/api/ping", { timeout: 2500 });
    await loadAll();
    document.body.innerHTML = `<div id="app"></div>`;
    render();
  } catch (e) {
    const msg = fmtErr(e);
    document.body.innerHTML = `
    <div class="boot err">
      <div class="bootText">启动失败</div>
      <div class="bootSub">原因：${esc(msg)}</div>
      <div class="bootSub">你可以在地址栏打开：<code>/api/ping</code>、<code>/api/meta</code> 测试。</div>
    </div>`;
  }
}

boot();
