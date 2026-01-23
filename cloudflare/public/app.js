async function api(url, body){
  const r = await fetch(url,{
    method: body ? "POST" : "GET",
    headers:{ "content-type":"application/json" },
    body: body ? JSON.stringify(body) : null
  });
  return r.json();
}

async function load(){
  const t = await api("/api/timetable/class/1?week=1");
  let txt = `【${t.class_name} 第${t.week}周课表】\n\n`;
  t.items.forEach(i=>{
    txt += `周${i.weekday} ${i.start_time}-${i.end_time} ${i.title} 教室：${i.room_name}\n`;
  });
  document.getElementById("app").innerHTML =
    `<pre>${txt}</pre>
     <button onclick="copy()">复制课表发群</button>`;
}

function copy(){
  navigator.clipboard.writeText(document.querySelector("pre").innerText);
  alert("已复制，可直接发到微信群/QQ群");
}

load();
