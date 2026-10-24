// The lists web page. Served at "/" once you've entered your key.
export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Phone Notes</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--text:#1c1c1e;--muted:#8a8a8e;--line:#e6e4df;--accent:#2f6fde;--danger:#d64545}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--card:#1d1d1f;--text:#ededed;--muted:#8e8e93;--line:#2c2c2e;--accent:#5b8ff0;--danger:#ef6b6b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:22px;margin:4px 0 16px;display:flex;align-items:center;gap:8px}
form.cmd{display:flex;gap:8px;margin-bottom:6px}
form.cmd input{flex:1;font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text)}
form.cmd button{font:inherit;padding:0 18px;border-radius:12px;border:0;background:var(--accent);color:#fff;cursor:pointer}
.toast{min-height:22px;color:var(--muted);font-size:14px;margin:0 2px 14px;white-space:pre-line}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.tab{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:5px 12px;font:inherit;font-size:14px;cursor:pointer}
.tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
.tab .n{opacity:.7;margin-left:4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 0;margin-bottom:14px}
.card header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px 6px}
.card h2{font-size:17px;margin:0}
.card h2 span{color:var(--muted);font-weight:400;font-size:14px;margin-left:6px}
.item{display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-top:1px solid var(--line)}
.item input{width:20px;height:20px;margin:1px 0 0;accent-color:var(--accent);flex:none;cursor:pointer}
.item .t{flex:1;word-break:break-word;white-space:pre-wrap}
.item.done .t{color:var(--muted);text-decoration:line-through}
.item .when{color:var(--muted);font-size:12px;flex:none;margin-top:2px}
.x{border:0;background:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:0 2px;flex:none}
.x:hover{color:var(--danger)}
details{border-top:1px solid var(--line)}
details summary{padding:8px 14px;color:var(--muted);font-size:14px;cursor:pointer}
.empty{padding:10px 14px;color:var(--muted);border-top:1px solid var(--line)}
.none{color:var(--muted);text-align:center;padding:40px 0}
.link{border:0;background:none;color:var(--muted);font-size:13px;cursor:pointer}
.link:hover{color:var(--danger)}
</style>
</head>
<body>
<div class="wrap">
  <h1>📝 Phone Notes</h1>
  <form class="cmd" id="cmd">
    <input id="cmdText" placeholder="#todo buy milk" autocomplete="off" enterkeyhint="send">
    <button>Add</button>
  </form>
  <div class="toast" id="toast"></div>
  <div class="tabs" id="tabs"></div>
  <div id="lists"></div>
</div>
<script>
let data = [];
let filter = "all";
try { filter = localStorage.getItem("filter") || "all"; } catch (e) {}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function ago(ts) {
  const d = new Date(ts.replace(" ", "T") + "Z");
  const s = (Date.now() - d) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 86400 * 7) return Math.floor(s / 86400) + "d";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401) { location.href = "/"; throw new Error("signed out"); }
  return res.json();
}

async function load() {
  data = await api("/api/lists");
  render();
}

function render() {
  if (filter !== "all" && !data.some((l) => l.name === filter)) filter = "all";
  const open = (l) => l.items.filter((i) => !i.done).length;
  $("tabs").innerHTML = data.length < 2 ? "" :
    [\`<button class="tab \${filter === "all" ? "on" : ""}" data-f="all">All</button>\`]
      .concat(data.map((l) => \`<button class="tab \${filter === l.name ? "on" : ""}" data-f="\${esc(l.name)}">#\${esc(l.name)}<span class="n">\${open(l)}</span></button>\`))
      .join("");

  const shown = filter === "all" ? data : data.filter((l) => l.name === filter);
  if (!data.length) {
    $("lists").innerHTML = '<div class="none">No lists yet.<br>Text your bot "#todo buy milk" or type it above.</div>';
    return;
  }
  $("lists").innerHTML = shown.map((l) => {
    const todo = l.items.filter((i) => !i.done);
    const done = l.items.filter((i) => i.done);
    const row = (i) => \`<div class="item \${i.done ? "done" : ""}">
        <input type="checkbox" \${i.done ? "checked" : ""} data-toggle="\${i.id}" aria-label="Done">
        <span class="t">\${esc(i.text)}</span>
        <span class="when">\${ago(i.created_at)}</span>
        <button class="x" data-del="\${i.id}" title="Delete" aria-label="Delete">×</button>
      </div>\`;
    return \`<section class="card">
      <header><h2>#\${esc(l.name)}<span>\${todo.length}</span></h2>
        <button class="link" data-dellist="\${l.id}" data-name="\${esc(l.name)}">Delete list</button></header>
      \${todo.length ? todo.map(row).join("") : '<div class="empty">All done 🎉</div>'}
      \${done.length ? \`<details><summary>\${done.length} checked off</summary>\${done.map(row).join("")}</details>\` : ""}
    </section>\`;
  }).join("");
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset.f) { filter = t.dataset.f; try { localStorage.setItem("filter", filter); } catch (e) {} render(); }
  if (t.dataset.del) { await api("/api/items/" + t.dataset.del, { method: "DELETE" }); load(); }
  if (t.dataset.dellist && confirm("Delete #" + t.dataset.name + " and everything on it?")) {
    await api("/api/lists/" + t.dataset.dellist, { method: "DELETE" }); load();
  }
});
document.addEventListener("change", async (e) => {
  const id = e.target.dataset.toggle;
  if (id) { await api("/api/items/" + id, { method: "PATCH", body: JSON.stringify({ done: e.target.checked }) }); load(); }
});
$("cmd").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("cmdText").value.trim();
  if (!text) return;
  const { reply } = await api("/api/command", { method: "POST", body: JSON.stringify({ text }) });
  $("toast").textContent = reply;
  $("cmdText").value = "";
  load();
});

load();
setInterval(() => { if (!document.hidden) load(); }, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
</script>
</body>
</html>`;
