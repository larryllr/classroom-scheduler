const $ = (s) => document.querySelector(s);

async function jget(url){
  const r = await fetch(url);
  return r.json();
}
async function jpost(url, body){
  const r = await fetch(url, {
    method:"POST",
    headers:{ "content-type":"application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

function ui(){
  $("#app").innerHTML = `
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
    <button onclick="tab('rooms')">① 教室</button>
    <button onclick="tab('classes')">② 班级</button>
    <button onclick="tab('courses')">③ 课程</button>
    <button onclick="solve()">④ 一键生成</button>
    <button onclick="tab('timetable')">⑤ 课表复制</button>
  </div>
  <div id="box"></div>
  <div id="msg" style="margin-top:10px;color:#b00020"></div>
  `;
}
ui();

let state = { rooms:[], classes:[] };

window.tab = async (t)=>{
  $("#msg").innerText="";
  if(t==="rooms") return renderRooms();
  if(t==="classes") return renderClasses();
  if(t==="courses") return renderCourses();
  if(t==="timetable") return renderTimetable();
};

async function renderRooms(){
  state.rooms = await jget("/api/rooms");
  $("#box").innerHTML = `
  <h3>教室</h3>
  <div style="display:grid;gap:6px;max-width:420px">
    <input id="rname" placeholder="教室名称，如 A101" />
    <input id="rcap" type="number" placeholder="容量，如 60" />
    <input id="rpri" type="number" placeholder="优先级(越小越优先)，如 1" />
    <button onclick="addRoom()">新增教室</button>
  </div>
  <pre style="background:#fff;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:10px;overflow:auto">
${state.rooms.map(r=>`${r.id}. ${r.name}  容量:${r.capacity}  优先级:${r.priority}`).join("\n") || "（暂无教室）"}
  </pre>
  `;
}

window.addRoom = async ()=>{
  const name = $("#rname").value.trim();
  const capacity = Number($("#rcap").value);
  const priority = Number($("#rpri").value || 100);
  const r = await jpost("/api/rooms", { name, capacity, priority });
  if(r.ok===false) return $("#msg").innerText = r.message;
  $("#msg").innerText="✅ 已新增教室";
  renderRooms();
};

async function renderClasses(){
  state.rooms = await jget("/api/rooms");
  state.classes = await jget("/api/classes");

  $("#box").innerHTML = `
  <h3>班级</h3>
  <div style="display:grid;gap:6px;max-width:520px">
    <input id="cname" placeholder="班级名称，如 软件2301" />
    <input id="csize" type="number" placeholder="人数，如 48" />

    <label style="display:flex;gap:6px;align-items:center">
      <input id="cswitch" type="checkbox" checked />
      当天允许换教室（不勾选=当天固定同一教室）
    </label>

    <div style="border:1px solid #ddd;border-radius:8px;padding:10px;background:#fff">
      <div style="margin-bottom:6px;font-weight:600">优先教室（可多选；页面顺序=优先顺序）</div>
      <div id="prooms" style="display:grid;gap:4px;max-height:160px;overflow:auto"></div>
      <div style="color:#666;margin-top:6px">提示：优先教室不够用时，会自动用其他教室补。</div>
    </div>

    <button onclick="addClass()">新增班级</button>
  </div>

  <pre id="clist" style="background:#fff;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:10px;overflow:auto"></pre>
  `;

  $("#clist").innerText = state.classes.map(c =>
    `${c.id}. ${c.name}  人数:${c.size}  当天可换教室:${c.allow_switch? "是":"否"}  优先教室:${c.preferred_rooms || "无"}`
  ).join("\n") || "（暂无班级）";

  const box = $("#prooms");
  box.innerHTML = state.rooms.map(r=>`
    <label style="display:flex;gap:6px;align-items:center">
      <input type="checkbox" value="${r.id}"> ${r.name}（容量${r.capacity}，优先级${r.priority}）
    </label>
  `).join("");
}

window.addClass = async ()=>{
  const name = $("#cname").value.trim();
  const size = Number($("#csize").value);
  const allow_switch = $("#cswitch").checked;

  const checks = Array.from(document.querySelectorAll('#prooms input[type="checkbox"]:checked'));
  const preferred_room_ids = checks.map(x=>x.value).join(",");

  const r = await jpost("/api/classes", { name, size, allow_switch, preferred_room_ids });
  if(r.ok===false) return $("#msg").innerText = r.message;
  $("#msg").innerText="✅ 已新增班级";
  renderClasses();
};

async function renderCourses(){
  state.classes = await jget("/api/classes");
  $("#box").innerHTML = `
  <h3>课程（按时间段，不需要设置第几节）</h3>
  <div style="display:grid;gap:6px;max-width:520px">
    <select id="cid">
      ${state.classes.map(c=>`<option value="${c.id}">${c.name}（${c.size}人）</option>`).join("")}
    </select>
    <input id="ctitle" placeholder="课程名，如 高等数学" />
    <input id="cweek" type="number" placeholder="周次，如 1" value="1" />
    <select id="cday">
      <option value="1">周一</option><option value="2">周二</option><option value="3">周三</option>
      <option value="4">周四</option><option value="5">周五</option><option value="6">周六</option><option value="7">周日</option>
    </select>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <input id="cstart" placeholder="开始 HH:MM 如 08:30" style="flex:1" />
      <input id="cend" placeholder="结束 HH:MM 如 10:05" style="flex:1" />
    </div>
    <button onclick="addCourse()">新增课程（单次/按周次）</button>
  </div>
  <div style="margin-top:10px;color:#666">提示：先录课程 → 点“一键生成” → 去“课表复制”。</div>
  `;
}

window.addCourse = async ()=>{
  const class_id = Number($("#cid").value);
  const title = $("#ctitle").value.trim();
  const week = Number($("#cweek").value || 1);
  const weekday = Number($("#cday").value);
  const start_time = $("#cstart").value.trim();
  const end_time = $("#cend").value.trim();

  const r = await jpost("/api/course/add_once", { class_id, title, week, weekday, start_time, end_time });
  if(r.ok===false) return $("#msg").innerText = r.message;
  $("#msg").innerText="✅ 已新增课程";
};

window.solve = async ()=>{
  const r = await jpost("/api/solve", {});
  $("#msg").innerText = r.ok===false ? ("❌ "+r.message) : "✅ 生成成功！去“课表复制”复制发群";
};

async function renderTimetable(){
  state.classes = await jget("/api/classes");
  $("#box").innerHTML = `
  <h3>课表复制（时间 + 教室）</h3>
  <div style="display:grid;gap:6px;max-width:520px">
    <select id="ttcid">
      ${state.classes.map(c=>`<option value="${c.id}">${c.name}</option>`).join("")}
    </select>
    <input id="ttweek" type="number" value="1" placeholder="周次" />
    <button onclick="loadTT()">加载课表</button>
    <button onclick="copyTT()">复制发群</button>
  </div>
  <pre id="tt" style="background:#fff;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:10px;white-space:pre-wrap"></pre>
  `;
}

window.loadTT = async ()=>{
  const cid = Number($("#ttcid").value);
  const week = Number($("#ttweek").value || 1);
  const t = await jget(`/api/timetable/class/${cid}?week=${week}`);

  let txt = `【${t.class_name} 第${t.week}周课表】\n\n`;
  const dayName = ["","周一","周二","周三","周四","周五","周六","周日"];
  let curDay = -1;

  t.items.forEach(i=>{
    if(i.weekday !== curDay){
      curDay = i.weekday;
      txt += `${dayName[curDay]}\n`;
    }
    txt += `${i.start_time}-${i.end_time}  ${i.title}  教室：${i.room_name || "未分配"}\n`;
  });

  $("#tt").innerText = txt;
};

window.copyTT = async ()=>{
  const text = $("#tt").innerText || "";
  if(!text.trim()) return alert("先点“加载课表”");
  await navigator.clipboard.writeText(text);
  alert("已复制，可直接发群");
};

// 默认进入教室页
tab("rooms");
