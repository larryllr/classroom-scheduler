const $ = (s) => document.querySelector(s);
const msg = (t, ok=false) => { $("#msg").textContent = t || ""; $("#msg").className = ok ? "msg ok" : "msg"; };

async function jget(url){ const r = await fetch(url); return r.json(); }
async function jpost(url, body){
  const r = await fetch(url,{ method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function jdel(url){
  const r = await fetch(url,{ method:"DELETE" });
  return r.json();
}

let state = { rooms:[], classes:[], pickedDates:[], cal: new Date() };

window.tab = async (t)=>{
  msg("");
  if(t==="rooms") return renderRooms();
  if(t==="classes") return renderClasses();
  if(t==="courses") return renderCourses();
  if(t==="timetable") return renderTimetable();
};

window.solve = async ()=>{
  const r = await jpost("/api/solve", {});
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ "+r.message, true);
};

function pad(n){ return String(n).padStart(2,"0"); }
function fmtDate(d){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function calRender(){
  const d = state.cal;
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y,m,1);
  const startDow = first.getDay(); // 0 Sun
  const daysInMonth = new Date(y,m+1,0).getDate();

  const dow = ["日","一","二","三","四","五","六"];
  let html = `
  <div class="cal">
    <div class="calhead">
      <button onclick="calMove(-1)">← 上月</button>
      <div style="font-weight:800">${y}年 ${m+1}月</div>
      <button onclick="calMove(1)">下月 →</button>
    </div>
    <div class="calgrid" style="margin-top:10px">
      ${dow.map(x=>`<div class="dow">周${x}</div>`).join("")}
    </div>
    <div class="calgrid">
  `;

  // 前置空格
  for(let i=0;i<startDow;i++){
    html += `<div class="day off"> </div>`;
  }
  for(let day=1; day<=daysInMonth; day++){
    const dd = new Date(y,m,day);
    const key = fmtDate(dd);
    const on = state.pickedDates.includes(key);
    html += `<div class="day ${on?"on":""}" onclick="toggleDate('${key}')">${day}</div>`;
  }
  html += `</div>
    <div class="meta" style="margin-top:10px">
      已选日期：${state.pickedDates.length? state.pickedDates.join(", ") : "（未选择）"}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button onclick="clearDates()">清空日期</button>
      <button onclick="pickToday()">选择今天</button>
    </div>
  </div>`;
  return html;
}
window.calMove = (delta)=>{
  const d = state.cal;
  state.cal = new Date(d.getFullYear(), d.getMonth()+delta, 1);
  renderCourses();
};
window.toggleDate = (key)=>{
  const i = state.pickedDates.indexOf(key);
  if(i>=0) state.pickedDates.splice(i,1); else state.pickedDates.push(key);
  state.pickedDates.sort();
  renderCourses();
};
window.clearDates = ()=>{ state.pickedDates=[]; renderCourses(); };
window.pickToday = ()=>{ const k=fmtDate(new Date()); if(!state.pickedDates.includes(k)) state.pickedDates=[k]; renderCourses(); };

async function renderRooms(){
  state.rooms = await jget("/api/rooms");
  $("#app").innerHTML = `
    <div class="grid">
      <div>
        <h3>教室</h3>
        <div class="row">
          <input id="rname" placeholder="教室名称（如 A101）" />
          <input id="rcap" type="number" placeholder="容量（如 60）" />
        </div>
        <div class="row" style="margin-top:10px">
          <input id="rpri" type="number" placeholder="优先级（越小越优先，如 1）" />
          <button class="primary" onclick="addRoom()">新增教室</button>
        </div>
        <div class="meta" style="margin-top:10px">优先级越小越先分配；同优先级下容量更小者更优先（更省教室）。</div>
      </div>
      <div>
        <h3>已建教室</h3>
        <div class="list">
          ${state.rooms.map(r=>`
            <div class="item">
              <div>
                <div style="font-weight:800">${r.name}</div>
                <div class="meta">容量：${r.capacity}　优先级：${r.priority}　(ID:${r.id})</div>
              </div>
              <button class="danger" onclick="delRoom(${r.id}, '${r.name.replace(/'/g,"")}')">删除</button>
            </div>
          `).join("") || `<div class="meta">暂无教室</div>`}
        </div>
      </div>
    </div>
  `;
}
window.addRoom = async ()=>{
  const name = $("#rname").value.trim();
  const capacity = Number($("#rcap").value);
  const priority = Number($("#rpri").value || 100);
  const r = await jpost("/api/rooms", { name, capacity, priority });
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ 已新增教室", true);
  renderRooms();
};
window.delRoom = async (id, name)=>{
  if(!confirm(`确定删除教室：${name}？（相关分配会一起清理）`)) return;
  const r = await jdel(`/api/rooms/${id}`);
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ 已删除教室", true);
  renderRooms();
};

async function renderClasses(){
  state.rooms = await jget("/api/rooms");
  state.classes = await jget("/api/classes");

  $("#app").innerHTML = `
    <div class="grid">
      <div>
        <h3>班级</h3>
        <div class="row">
          <input id="cname" placeholder="班级名称（如 软件2301）" />
          <input id="csize" type="number" placeholder="人数（如 48）" />
        </div>

        <div style="margin-top:10px">
          <label style="display:flex;gap:8px;align-items:center">
            <input id="cswitch" type="checkbox" checked />
            当天允许换教室（不勾选=当天固定同一教室）
          </label>
        </div>

        <div style="margin-top:10px">
          <div style="font-weight:800;margin-bottom:6px">班级优先教室（勾选顺序=优先顺序）</div>
          <div id="prooms" style="display:grid;gap:6px;max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:10px;background:rgba(255,255,255,.03)"></div>
          <div class="meta" style="margin-top:8px">规则：先尝试这些教室；不行才自动用其它教室。</div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="primary" onclick="addClass()">新增班级</button>
        </div>
      </div>

      <div>
        <h3>已建班级</h3>
        <div class="list">
          ${state.classes.map(c=>`
            <div class="item">
              <div>
                <div style="font-weight:800">${c.name}</div>
                <div class="meta">人数：${c.size}　当天可换教室：${c.allow_switch? "是":"否"}</div>
                <div class="meta">优先教室：${c.preferred_rooms || "无"}</div>
                <div class="meta">(ID:${c.id})</div>
              </div>
              <button class="danger" onclick="delClass(${c.id}, '${String(c.name).replace(/'/g,"")}')">删除</button>
            </div>
          `).join("") || `<div class="meta">暂无班级</div>`}
        </div>
      </div>
    </div>
  `;

  const box = $("#prooms");
  box.innerHTML = state.rooms.map(r=>`
    <label style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" value="${r.id}"> ${r.name}（容量${r.capacity}，优先级${r.priority}）
    </label>
  `).join("") || `<div class="meta">请先新增教室</div>`;
}
window.addClass = async ()=>{
  const name = $("#cname").value.trim();
  const size = Number($("#csize").value);
  const allow_switch = $("#cswitch").checked;

  const checks = Array.from(document.querySelectorAll('#prooms input[type="checkbox"]:checked'));
  const preferred_room_ids = checks.map(x=>x.value).join(",");

  const r = await jpost("/api/classes", { name, size, allow_switch, preferred_room_ids });
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ 已新增班级", true);
  renderClasses();
};
window.delClass = async (id, name)=>{
  if(!confirm(`确定删除班级：${name}？（该班课程与分配会一起删除）`)) return;
  const r = await jdel(`/api/classes/${id}`);
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ 已删除班级", true);
  renderClasses();
};

async function renderCourses(){
  state.classes = await jget("/api/classes");
  const courses = await jget("/api/courses");

  $("#app").innerHTML = `
    <div class="grid">
      <div>
        <h3>课程（按日历选日期）</h3>
        <div class="row">
          <select id="cid">
            ${state.classes.map(c=>`<option value="${c.id}">${c.name}（${c.size}人）</option>`).join("")}
          </select>
          <input id="ctitle" placeholder="课程名（如 高数）" />
        </div>

        <div class="row" style="margin-top:10px">
          <input id="cstart" placeholder="开始时间 HH:MM（如 08:30）" />
          <input id="cend" placeholder="结束时间 HH:MM（如 10:05）" />
        </div>

        ${calRender()}

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="primary" onclick="addCourseDates()">保存：这些日期都上这门课</button>
        </div>
        <div class="meta" style="margin-top:8px">
          说明：一次可以点多个日期；每个日期会生成一条课程记录。然后点“一键生成”分配教室。
        </div>
      </div>

      <div>
        <h3>课程列表（可删除）</h3>
        <div class="list">
          ${courses.map(ci=>`
            <div class="item">
              <div>
                <div style="font-weight:800">${ci.title}</div>
                <div class="meta">${ci.class_name}　${ci.date}　${ci.start_time}-${ci.end_time}　(ID:${ci.id})</div>
              </div>
              <button class="danger" onclick="delCourse(${ci.id})">删除</button>
            </div>
          `).join("") || `<div class="meta">暂无课程</div>`}
        </div>
      </div>
    </div>
  `;
}
window.addCourseDates = async ()=>{
  const class_id = Number($("#cid").value);
  const title = $("#ctitle").value.trim();
  const start_time = $("#cstart").value.trim();
  const end_time = $("#cend").value.trim();
  const dates = state.pickedDates.slice();

  const r = await jpost("/api/course/add_dates", { class_id, title, dates, start_time, end_time });
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ 已新增课程（按日期）", true);
  // 清空日期选择
  state.pickedDates = [];
  renderCourses();
};
window.delCourse = async (id)=>{
  if(!confirm("确定删除这条课程？")) return;
  const r = await jdel(`/api/course/${id}`);
  if(r.ok===false) return msg("❌ "+r.message);
  msg("✅ 已删除课程", true);
  renderCourses();
};

async function renderTimetable(){
  state.classes = await jget("/api/classes");

  $("#app").innerHTML = `
    <div>
      <h3>课表复制（格式：日期 时间 + 教室）</h3>
      <div class="row" style="margin-top:10px">
        <select id="ttcid">
          ${state.classes.map(c=>`<option value="${c.id}">${c.name}</option>`).join("")}
        </select>
        <div class="row" style="gap:10px">
          <input id="from" type="date" />
          <input id="to" type="date" />
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="primary" onclick="loadTT()">加载课表</button>
        <button onclick="copyTT()">复制发群</button>
      </div>

      <pre id="tt" style="margin-top:12px"></pre>
    </div>
  `;
}
window.loadTT = async ()=>{
  const cid = Number($("#ttcid").value);
  const from = $("#from").value;
  const to = $("#to").value;

  const q = new URLSearchParams();
  if(from) q.set("from", from);
  if(to) q.set("to", to);

  const t = await jget(`/api/timetable/class/${cid}?`+q.toString());

  let txt = `【${t.class_name} 课表】\n`;
  if(from || to) txt += `范围：${from||"…"} ~ ${to||"…"}\n`;
  txt += `\n`;

  let cur = "";
  for(const i of t.items){
    if(i.date !== cur){
      cur = i.date;
      txt += `${cur}\n`;
    }
    txt += `${i.start_time}-${i.end_time}  ${i.title}  教室：${i.room_name || "未分配"}\n`;
  }

  $("#tt").textContent = txt.trim() || "（此范围内暂无课程）";
  msg("✅ 已加载课表", true);
};
window.copyTT = async ()=>{
  const text = ($("#tt").textContent || "").trim();
  if(!text) return alert("先加载课表");
  await navigator.clipboard.writeText(text);
  alert("已复制，可直接发群");
};

// 默认页
tab("rooms");
