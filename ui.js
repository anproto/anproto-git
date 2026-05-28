const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (ch) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[ch]);

const repoHref = (repo) =>
  `/git/${encodeURIComponent(repo.author)}/${encodeURIComponent(repo.name)}/`;

export const homePage = ({ repos, serverPub, port }) => {
  const rows = repos.length
    ? repos.map((repo) =>
      `<a class="repo" href="${repoHref(repo.repo)}">
        <strong>${escapeHtml(repo.repo.name)}</strong>
        <code>${escapeHtml(repo.repo.author)}</code>
        <span>${repo.updateCount} update${
        repo.updateCount === 1 ? "" : "s"
      }</span>
      </a>`
    ).join("")
    : `<div class="empty">No repos have been pushed here yet.</div>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>anproto-git</title>
<style>
:root{color-scheme:light;--ink:#202124;--muted:#667085;--line:#d0d7de;--soft:#f6f8fa;--accent:#0f766e}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#fff}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}.wrap{max-width:980px;margin:0 auto;padding:28px 20px}
header{border-bottom:1px solid var(--line)}h1{font-size:28px;margin:0 0 6px;letter-spacing:0}p{color:var(--muted);margin:0 0 18px}.pub{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);word-break:break-all}
.panel{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff;margin-top:18px}.panel h2{font-size:15px;margin:0;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--soft)}
.repo{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;padding:12px;border-top:1px solid var(--line);align-items:center}.repo:first-of-type{border-top:0}.repo:hover{background:var(--soft);text-decoration:none}.repo code{grid-column:1;color:var(--muted);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.repo span{grid-column:2;grid-row:1 / span 2;color:var(--muted);font-size:12px}.empty{padding:28px;text-align:center;color:var(--muted)}
pre{overflow:auto;background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
@media(max-width:640px){.repo{grid-template-columns:1fr}.repo span{grid-column:1;grid-row:auto}}
</style>
</head>
<body>
<header><div class="wrap">
  <h1>anproto-git</h1>
  <p>Repos pushed to this local forge.</p>
  <div class="pub">${escapeHtml(serverPub)}</div>
</div></header>
<main class="wrap">
  <section class="panel"><h2>Repos</h2>${rows}</section>
  <h2>Push Here</h2>
  <pre>git remote add anproto http://127.0.0.1:${port}/git/${
    encodeURIComponent(serverPub)
  }/&lt;repo-name&gt;
git push anproto main</pre>
</main>
</body>
</html>`;
};

export const repoPage = ({ authorPub, name, port }) => {
  const repoBase = `/git/${encodeURIComponent(authorPub)}/${
    encodeURIComponent(name)
  }`;
  const cloneUrl = `http://127.0.0.1:${port}${repoBase}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} · anproto-git</title>
<style>
:root{color-scheme:light;--ink:#202124;--muted:#667085;--line:#d0d7de;--soft:#f6f8fa;--accent:#0f766e;--warn:#9a3412}
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#fff}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
button,select{font:inherit}
.top{border-bottom:1px solid var(--line);background:#fff}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px}
.repohead{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:end;padding:22px 0 16px}
.repohead h1{margin:0;font-size:24px;font-weight:650;letter-spacing:0}
.repohead code{display:block;margin-top:6px;color:var(--muted);font-size:12px;word-break:break-all}
.clone{display:flex;gap:8px;align-items:center;min-width:360px}
.clone input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--soft);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.btn{border:1px solid var(--line);border-radius:6px;background:#fff;padding:8px 10px;cursor:pointer;color:var(--ink)}
.btn:hover{background:var(--soft)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line)}
.tab{border:0;background:transparent;padding:12px 14px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted)}
.tab.active{border-bottom-color:var(--accent);color:var(--ink);font-weight:600}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 0}
.branch{display:flex;gap:8px;align-items:center;color:var(--muted)}
.branch select{border:1px solid var(--line);border-radius:6px;padding:6px 28px 6px 8px;background:#fff;color:var(--ink)}
.crumbs{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff}
.row{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:12px;padding:10px 12px;border-top:1px solid var(--line);align-items:center}
.row:first-child{border-top:0}.row:hover{background:var(--soft)}
.name{display:flex;gap:8px;align-items:center;min-width:0}.name span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--muted);font-size:12px;text-align:right}
.readme{margin-top:16px}.readme h2{font-size:15px;margin:0;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--soft)}
.md{padding:16px;max-width:940px}.md h1,.md h2,.md h3{line-height:1.25}.md pre,.file pre,.patch{overflow:auto;margin:0;padding:14px 16px;background:#f6f8fa;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.md table{border-collapse:collapse;width:100%;display:block;overflow:auto;margin:12px 0}.md th,.md td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}.md th{background:var(--soft);font-weight:600}.md code{background:var(--soft);border-radius:4px;padding:1px 4px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.md pre code{background:transparent;padding:0}.md blockquote{margin:12px 0;padding:0 12px;color:var(--muted);border-left:3px solid var(--line)}.md ul,.md ol{padding-left:24px}.patch{padding:0;background:#fff}.diffline{display:block;min-width:max-content;padding:0 14px;white-space:pre}.diff-add{background:#dafbe1;color:#116329}.diff-del{background:#ffebe9;color:#82071e}.diff-meta{background:#f6f8fa;color:#57606a}.diff-hunk{background:#ddf4ff;color:#0550ae}
.filebar{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--soft);color:var(--muted)}
.commits{display:grid;gap:0}.commit{display:grid;grid-template-columns:minmax(0,1fr) 140px 92px;gap:12px;padding:12px;border-top:1px solid var(--line)}
.commit:first-child{border-top:0}.commit-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.muted{color:var(--muted);font-size:12px}.sha{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.diffhead{padding:14px 16px;border-bottom:1px solid var(--line)}.diffhead h2{font-size:18px;margin:0 0 6px}
.empty,.error{padding:32px;text-align:center;color:var(--muted)}.error{color:var(--warn)}
@media(max-width:760px){.repohead{grid-template-columns:1fr}.clone{min-width:0}.commit{grid-template-columns:1fr}.row{grid-template-columns:minmax(0,1fr) auto}.meta{text-align:right}}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <div class="repohead">
      <div>
        <h1>${escapeHtml(name)}</h1>
        <code>${escapeHtml(authorPub)}</code>
      </div>
      <div class="clone">
        <input id="cloneUrl" readonly value="${escapeHtml(cloneUrl)}">
        <button class="btn" id="copyClone" title="Copy clone URL">Copy</button>
      </div>
    </div>
    <nav class="tabs">
      <button class="tab active" data-view="code">Code</button>
      <button class="tab" data-view="commits">Commits</button>
    </nav>
  </div>
</header>
<main class="wrap">
  <div class="toolbar">
    <div class="branch"><span>Branch</span><select id="branch"></select></div>
    <div class="crumbs" id="crumbs"></div>
  </div>
  <section id="app"></section>
</main>
<script>
const apiBase = ${JSON.stringify(repoBase + "/api")};
const state = { ref: "HEAD", refs: [], view: "code" };
const app = document.getElementById("app");
const branchSelect = document.getElementById("branch");
const crumbs = document.getElementById("crumbs");
const esc = ${escapeHtml.toString()};
const api = async (path) => {
  const res = await fetch(apiBase + path);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};
const short = (sha) => sha ? sha.slice(0, 7) : "";
const fmtDate = (iso) => iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";
const setError = (err) => { app.innerHTML = '<div class="panel error">' + esc(err.message || String(err)) + '</div>'; };
const md = (text, basePath = "") => {
  const raw = text.replace(/\\r\\n/g, "\\n").split("\\n");
  let out = "", inCode = false, list = null, para = [];
  const tick3 = String.fromCharCode(96).repeat(3);
  const localHref = (href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const clean = href.split("#")[0];
    const hash = href.includes("#") ? "#" + href.split("#").slice(1).join("#") : "";
    if (!clean) return hash || "#";
    const base = basePath.split("/").slice(0, -1).filter(Boolean);
    const parts = clean.split("/").filter(Boolean);
    const path = [];
    for (const part of [...base, ...parts]) {
      if (part === ".") continue;
      if (part === "..") path.pop();
      else path.push(part);
    }
    return "#/blob/" + encodeURIComponent(path.join("/")) + hash;
  };
  const inline = (s) => esc(s)
    .replace(/\\\`([^\\\`]+)\\\`/g, "<code>$1</code>")
    .replace(/\\[([^\\]]+)\\]\\(([^\\s)]+)\\)/g, (_, label, href) =>
      '<a href="' + esc(localHref(href)) + '">' + label + '</a>'
    );
  const closePara = () => { if (para.length) { out += "<p>" + inline(para.join(" ")) + "</p>"; para = []; } };
  const closeList = () => { if (list) { out += "</" + list + ">"; list = null; } };
  const cells = (line) => line.trim().replace(/^\\||\\|$/g, "").split("|").map(c => inline(c.trim()));
  const isTableSep = (line) => /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(line);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.startsWith(tick3)) { closePara(); closeList(); out += inCode ? "</code></pre>" : "<pre><code>"; inCode = !inCode; continue; }
    if (inCode) { out += esc(line) + "\\n"; continue; }
    if (line.includes("|") && raw[i + 1] && isTableSep(raw[i + 1])) {
      closePara(); closeList();
      const headers = cells(line);
      out += "<table><thead><tr>" + headers.map(h => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < raw.length && raw[i].includes("|") && raw[i].trim()) {
        out += "<tr>" + cells(raw[i]).map(c => "<td>" + c + "</td>").join("") + "</tr>";
        i++;
      }
      i--;
      out += "</tbody></table>";
      continue;
    }
    const heading = line.match(/^(#{1,6})\\s+(.+)$/);
    if (heading) { closePara(); closeList(); const level = heading[1].length; out += "<h" + level + ">" + inline(heading[2]) + "</h" + level + ">"; continue; }
    const bullet = line.match(/^\\s*[-*+]\\s+(.+)$/);
    const ordered = line.match(/^\\s*\\d+\\.\\s+(.+)$/);
    if (bullet || ordered) {
      closePara();
      const next = bullet ? "ul" : "ol";
      if (list !== next) { closeList(); out += "<" + next + ">"; list = next; }
      out += "<li>" + inline((bullet || ordered)[1]) + "</li>";
      continue;
    }
    const quote = line.match(/^>\\s?(.+)$/);
    if (quote) { closePara(); closeList(); out += "<blockquote>" + inline(quote[1]) + "</blockquote>"; continue; }
    if (!line.trim()) { closePara(); closeList(); continue; }
    para.push(line.trim());
  }
  closePara(); closeList();
  if (inCode) out += "</code></pre>";
  return out;
};
const route = () => {
  const hash = location.hash.replace(/^#\\/?/, "");
  const [view, ...parts] = hash.split("/");
  if (!view) return { view: "tree", path: "" };
  if (view === "blob") return { view, path: decodeURIComponent(parts.join("/")) };
  if (view === "tree") return { view, path: decodeURIComponent(parts.join("/")) };
  if (view === "commit") return { view, sha: parts[0] };
  if (view === "commits") return { view };
  return { view: "tree", path: "" };
};
const setTabs = (view) => {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === (view === "commits" ? "commits" : "code")));
};
const setCrumbs = (path) => {
  const parts = path ? path.split("/") : [];
  let acc = "";
  crumbs.innerHTML = '<a href="#">root</a>' + parts.map(p => {
    acc = acc ? acc + "/" + p : p;
    return ' / <a href="#/tree/' + encodeURIComponent(acc) + '">' + esc(p) + '</a>';
  }).join("");
};
const loadRefs = async () => {
  const data = await api("/refs");
  state.refs = data.refs.filter(r => r.kind === "branch");
  state.ref = data.head || state.refs[0]?.name || "HEAD";
  branchSelect.innerHTML = state.refs.map(r => '<option value="' + esc(r.name) + '">' + esc(r.short) + '</option>').join("");
  branchSelect.value = state.ref;
};
const renderTree = async (path = "") => {
  setTabs("code"); setCrumbs(path);
  const data = await api("/tree?ref=" + encodeURIComponent(state.ref) + "&path=" + encodeURIComponent(path));
  app.innerHTML = '<div class="panel">' + (path ? '<div class="row"><div class="name"><span>↰</span><a href="#/tree/' + encodeURIComponent(path.split("/").slice(0,-1).join("/")) + '">..</a></div><div></div></div>' : "") +
    data.entries.map(e => '<div class="row"><div class="name"><span>' + (e.isDir ? "▸" : "•") + '</span><a href="#/' + (e.isDir ? "tree" : "blob") + "/" + encodeURIComponent(e.path) + '">' + esc(e.name) + '</a></div><div class="meta">' + esc(e.type) + '</div></div>').join("") +
    (data.entries.length ? "" : '<div class="empty">Empty tree</div>') + '</div><div id="readme"></div>';
  if (!path) {
    const readme = data.entries.find(e => /^readme(\\.md)?$/i.test(e.name) && !e.isDir);
    if (readme) {
      try {
        const b = await api("/blob?ref=" + encodeURIComponent(state.ref) + "&path=" + encodeURIComponent(readme.path));
        document.getElementById("readme").innerHTML = '<section class="panel readme"><h2>' + esc(readme.name) + '</h2><div class="md">' + md(b.content, readme.path) + '</div></section>';
      } catch (_) {}
    }
  }
};
const renderBlob = async (path) => {
  setTabs("code"); setCrumbs(path);
  const data = await api("/blob?ref=" + encodeURIComponent(state.ref) + "&path=" + encodeURIComponent(path));
  const body = /\\.md$/i.test(path) && !data.truncated
    ? '<div class="md">' + md(data.content, path) + '</div>'
    : '<pre>' + esc(data.truncated ? "File too large to preview." : data.content) + '</pre>';
  app.innerHTML = '<section class="panel file"><div class="filebar"><span>' + esc(path) + '</span><span>' + data.size + ' bytes</span></div>' + body + '</section>';
};
const renderCommits = async () => {
  setTabs("commits"); crumbs.textContent = "";
  const data = await api("/log?ref=" + encodeURIComponent(state.ref));
  app.innerHTML = '<section class="panel commits">' + data.commits.map(c => '<div class="commit"><div><a class="commit-title" href="#/commit/' + c.sha + '">' + esc(c.title || c.sha) + '</a><div class="muted">' + esc(c.author.name || "") + ' · ' + fmtDate(c.author.date) + '</div></div><div class="sha">' + short(c.sha) + '</div><div><a href="#/commit/' + c.sha + '">diff</a></div></div>').join("") + (data.commits.length ? "" : '<div class="empty">No commits</div>') + '</section>';
};
const renderCommit = async (sha) => {
  setTabs("commits"); crumbs.textContent = short(sha);
  const data = await api("/diff/" + encodeURIComponent(sha));
  const patch = (data.patch || "").split("\\n").map(line => {
    const cls = line.startsWith("+") && !line.startsWith("+++") ? "diff-add"
      : line.startsWith("-") && !line.startsWith("---") ? "diff-del"
      : line.startsWith("@@") ? "diff-hunk"
      : /^(diff --git|index |--- |\\+\\+\\+ |[A-Za-z].*\\|)/.test(line) ? "diff-meta"
      : "";
    return '<span class="diffline ' + cls + '">' + esc(line || " ") + '</span>';
  }).join("");
  app.innerHTML = '<section class="panel"><div class="diffhead"><h2>' + esc(data.title || sha) + '</h2><div class="muted">' + esc(data.author.name || "") + ' · ' + fmtDate(data.author.date) + ' · <span class="sha">' + esc(data.sha) + '</span></div></div><pre class="patch">' + patch + '</pre></section>';
};
const render = async () => {
  try {
    const r = route();
    if (r.view === "commits") return renderCommits();
    if (r.view === "commit") return renderCommit(r.sha);
    if (r.view === "blob") return renderBlob(r.path);
    return renderTree(r.path || "");
  } catch (err) { setError(err); }
};
branchSelect.addEventListener("change", () => { state.ref = branchSelect.value; render(); });
document.querySelector('[data-view="code"]').addEventListener("click", () => { location.hash = ""; });
document.querySelector('[data-view="commits"]').addEventListener("click", () => { location.hash = "#/commits"; });
document.getElementById("copyClone").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.getElementById("cloneUrl").value);
});
addEventListener("hashchange", render);
loadRefs().then(render).catch(setError);
</script>
</body>
</html>`;
};
