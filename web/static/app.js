"use strict";
const $ = (s) => document.querySelector(s);
const STATUSES = ["idea", "building", "live", "paused", "retired"];
const KINDS = ["managed", "external"];
const TABS = [["overview", "Overview"], ["projects", "Projects"], ["systems", "Systems"], ["triggers", "Triggers"]];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const state = {
  data: [],
  tab: "",
  slug: "",
  dtab: "overview",
  filters: { q: "", status: "", kind: "", tag: "" },
  sys: "",
  trig: "all",
  open: new Set(),
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function btn(text, cls, onclick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onclick);
  return b;
}

function badge(text, status) {
  const b = el("span", "badge", text);
  if (status) b.dataset.status = status;
  return b;
}

async function getJSON(url) {
  const r = await fetch(url);
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((body && body.error) || r.statusText);
  return body;
}

const pad = (n) => String(n).padStart(2, "0");

function humanTrigger(t) {
  if (!t) return "";
  const spec = (t.spec || "").trim();
  if (t.type === "schedule") {
    let m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(spec);
    if (m) return "Daily at " + pad(m[2]) + ":" + pad(m[1]);
    m = /^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/.exec(spec);
    if (m) return DAYS[Number(m[3]) % 7] + "s at " + pad(m[2]) + ":" + pad(m[1]);
  }
  return spec;
}

function sectionTitle(text) { return el("h3", "section", text); }

/* ---------- markdown (small, safe: builds DOM, never innerHTML) ---------- */

function inline(parent, text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) {
      parent.append(el("code", null, part.slice(1, -1)));
    } else if (part.length > 3 && part.startsWith("**") && part.endsWith("**")) {
      parent.append(el("strong", null, part.slice(2, -2)));
    } else {
      parent.append(document.createTextNode(part));
    }
  }
}

function renderMarkdown(src) {
  const root = el("div", "md");
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const isList = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isIndented = (l) => /^( {4}|\t)/.test(l);
  const special = (l) => /^```/.test(l) || /^#{1,4}\s/.test(l) || isList(l) || isIndented(l);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      root.append(el("pre", null, buf.join("\n")));
      continue;
    }
    if (isIndented(line)) {
      const buf = [];
      while (i < lines.length && (isIndented(lines[i]) || (!lines[i].trim() && i + 1 < lines.length && isIndented(lines[i + 1])))) {
        buf.push(lines[i].replace(/^( {4}|\t)/, ""));
        i++;
      }
      root.append(el("pre", null, buf.join("\n")));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const e = el(h[1].length === 1 ? "h3" : "h4", "md-h");
      inline(e, h[2]);
      root.append(e);
      i++;
      continue;
    }
    if (isList(line)) {
      const list = el(/^\s*\d+\./.test(line) ? "ol" : "ul", "md-list");
      while (i < lines.length && isList(lines[i])) {
        const li = el("li");
        inline(li, lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        list.append(li);
        i++;
      }
      root.append(list);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !special(lines[i])) { buf.push(lines[i].trim()); i++; }
    if (!buf.length) { buf.push(lines[i].trim()); i++; }
    const p = el("p");
    inline(p, buf.join(" "));
    root.append(p);
  }
  return root;
}

/* ---------- data helpers ---------- */

function applyFilters() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return state.data.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.tag && !(p.tags || []).includes(f.tag)) return false;
    if (!q) return true;
    return [p.title, p.about, p.slug, (p.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
  });
}

function stepsOf(p) { return (p.workflow && p.workflow.steps) || []; }

function systemsOf(p) {
  const set = new Set();
  for (const s of stepsOf(p)) if (s.system) set.add(s.system);
  return [...set];
}

function systemIndex() {
  const m = new Map();
  for (const p of state.data) {
    for (const s of stepsOf(p)) {
      const name = s.system || "(unspecified)";
      const e = m.get(name) || { name: name, steps: 0, projects: new Map() };
      e.steps++;
      e.projects.set(p.slug, p.title);
      m.set(name, e);
    }
  }
  return [...m.values()].sort((a, b) => b.projects.size - a.projects.size || a.name.localeCompare(b.name));
}

function triggerType(p) { return p.workflow ? p.workflow.trigger.type : "none"; }

/* ---------- routing ---------- */

function parseHash() {
  let h = "";
  try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
  const parts = h.split("/");
  const tab = TABS.some((t) => t[0] === parts[0]) ? parts[0] : "overview";
  return { tab: tab, slug: parts[1] || "" };
}

function go(hash) {
  if (location.hash.slice(1) === hash) route();
  else location.hash = hash;
}

function openProjects(extra) {
  state.filters = Object.assign({ q: "", status: "", kind: "", tag: "" }, extra || {});
  go("projects");
}

function route() {
  const r = parseHash();
  const view = $("#view");
  const changed = r.tab !== state.tab || !view.firstChild;
  state.tab = r.tab;
  state.slug = r.slug;
  if (changed) render();
  else if (state.tab === "projects") { renderList(); renderDetail(); }
}

function render() {
  const view = $("#view");
  view.replaceChildren();
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === state.tab));
  $("#count").textContent = state.data.length + " projects";
  const views = { overview: renderOverview, projects: renderProjects, systems: renderSystems, triggers: renderTriggers };
  views[state.tab](view);
}
/* ---------- Overview tab ---------- */

function statCard(label, value, onclick) {
  const b = el("button", "card");
  b.type = "button";
  b.append(el("div", "num", String(value)), el("div", "muted small", label));
  b.addEventListener("click", onclick);
  return b;
}

function renderOverview(view) {
  const d = state.data;
  const wrap = el("div", "panel stack");
  const count = (fn) => d.filter(fn).length;

  wrap.append(sectionTitle("Projects by status"));
  const g1 = el("div", "cards");
  g1.append(statCard("All projects", d.length, () => openProjects()));
  for (const s of STATUSES) g1.append(statCard(s, count((p) => p.status === s), () => openProjects({ status: s })));
  wrap.append(g1);

  wrap.append(sectionTitle("Where they run"));
  const g2 = el("div", "cards");
  for (const k of KINDS) {
    const label = k === "managed" ? "Managed (runs in the hub)" : "External (catalogued)";
    g2.append(statCard(label, count((p) => p.kind === k), () => openProjects({ kind: k })));
  }
  wrap.append(g2);

  wrap.append(sectionTitle("How they start"));
  const tc = {};
  for (const p of d) { const t = triggerType(p); tc[t] = (tc[t] || 0) + 1; }
  const g3 = el("div", "cards");
  for (const [t, n] of Object.entries(tc)) {
    g3.append(statCard(t === "none" ? "No workflow yet" : t, n, () => { state.trig = t; go("triggers"); }));
  }
  wrap.append(g3);

  wrap.append(sectionTitle("Tags"));
  const tags = {};
  for (const p of d) for (const t of p.tags || []) tags[t] = (tags[t] || 0) + 1;
  const tagBox = el("div", "chips");
  const tagKeys = Object.keys(tags).sort();
  if (!tagKeys.length) tagBox.append(el("span", "muted small", "No tags yet."));
  for (const t of tagKeys) tagBox.append(btn(t + " (" + tags[t] + ")", "chip", () => openProjects({ tag: t })));
  wrap.append(tagBox);

  wrap.append(sectionTitle("Systems used"));
  const sysBox = el("div", "chips");
  const sys = systemIndex();
  if (!sys.length) sysBox.append(el("span", "muted small", "No workflows yet."));
  for (const s of sys.slice(0, 14)) sysBox.append(btn(s.name, "chip", () => { state.sys = s.name; go("systems"); }));
  wrap.append(sysBox);

  view.append(wrap);
}

/* ---------- Projects tab ---------- */

function renderProjects(view) {
  const cols = el("div", "cols");
  const aside = el("aside", "panel");
  const controls = el("div", "controls");

  const q = el("input");
  q.id = "q";
  q.type = "search";
  q.placeholder = "Search projects";
  q.setAttribute("aria-label", "Search projects");
  q.addEventListener("input", () => { state.filters.q = q.value; renderList(); });

  const st = el("select");
  st.id = "status";
  st.setAttribute("aria-label", "Filter by status");
  st.append(new Option("All statuses", ""));
  for (const s of STATUSES) st.append(new Option(s, s));
  st.addEventListener("change", () => { state.filters.status = st.value; renderList(); });

  const kd = el("select");
  kd.id = "kind";
  kd.setAttribute("aria-label", "Filter by kind");
  kd.append(new Option("All kinds", ""));
  for (const k of KINDS) kd.append(new Option(k, k));
  kd.addEventListener("change", () => { state.filters.kind = kd.value; renderList(); });

  controls.append(q, st, kd);
  const active = el("div", "chips");
  active.id = "activefilter";
  const ul = el("ul");
  ul.id = "list";
  aside.append(controls, active, ul);

  const detail = el("section", "panel");
  detail.id = "detail";
  cols.append(aside, detail);
  view.append(cols);
  renderList();
  renderDetail();
}

function renderList() {
  const ul = $("#list");
  if (!ul) return;
  const f = state.filters;
  const q = $("#q");
  if (q.value !== f.q) q.value = f.q;
  $("#status").value = f.status;
  $("#kind").value = f.kind;

  const af = $("#activefilter");
  af.replaceChildren();
  if (f.tag) {
    const c = btn("tag: " + f.tag + "  \u00d7", "chip", () => { state.filters.tag = ""; renderList(); });
    c.setAttribute("aria-label", "Clear tag filter " + f.tag);
    af.append(c);
  }

  const shown = applyFilters();
  $("#count").textContent = shown.length + " of " + state.data.length + " projects";
  ul.replaceChildren();
  if (!shown.length) { ul.append(el("li", "muted empty", "No projects match.")); return; }
  for (const p of shown) {
    const li = el("li");
    const a = el("a", "item" + (p.slug === state.slug ? " active" : ""));
    a.href = "#projects/" + encodeURIComponent(p.slug);
    const top = el("div", "row");
    top.append(el("strong", null, p.title), badge(p.status, p.status));
    a.append(top, el("div", "muted small", p.about));
    li.append(a);
    ul.append(li);
  }
}

function renderDetail() {
  const d = $("#detail");
  if (!d) return;
  d.replaceChildren();
  if (!state.slug) { d.append(el("p", "muted", "Select a project from the list.")); return; }
  const p = state.data.find((x) => x.slug === state.slug);
  if (!p) { d.append(el("p", "muted", "No project with slug \u201c" + state.slug + "\u201d.")); return; }

  const head = el("div", "row");
  head.append(el("h2", null, p.title));
  const bs = el("div", "chips");
  bs.append(badge(p.status, p.status), badge(p.kind));
  head.append(bs);
  d.append(head, el("p", "muted", p.about));

  const defs = [
    ["overview", "Overview", true],
    ["workflow", "Workflow" + (p.workflow ? " (" + stepsOf(p).length + ")" : ""), !!p.workflow],
    ["notes", "Notes", !!p.readme],
  ];
  if (!defs.some((x) => x[0] === state.dtab && x[2])) state.dtab = "overview";
  const tabs = el("div", "tabs");
  tabs.setAttribute("role", "tablist");
  for (const [id, label, enabled] of defs) {
    const b = btn(label, "tab" + (state.dtab === id ? " active" : ""), () => { state.dtab = id; renderDetail(); });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(state.dtab === id));
    b.disabled = !enabled;
    tabs.append(b);
  }
  d.append(tabs);

  const body = el("div");
  d.append(body);
  if (state.dtab === "overview") renderProjectOverview(body, p);
  else if (state.dtab === "workflow") renderWorkflow(body, p);
  else body.append(renderMarkdown(p.readme));
}

function copyBtn(name, value) {
  const label = "Copy " + name;
  const b = btn(label, "copy", async () => {
    try { await navigator.clipboard.writeText(value); b.textContent = "Copied"; }
    catch (e) { b.textContent = "Copy failed"; }
    setTimeout(() => { b.textContent = label; }, 1500);
  });
  b.title = value;
  return b;
}

function renderProjectOverview(body, p) {
  const meta = el("dl", "meta");
  const row = (k, node) => {
    const dd = el("dd");
    dd.append(node);
    meta.append(el("dt", null, k), dd);
  };

  row("Owner", document.createTextNode(p.owner || "-"));
  row("Kind", document.createTextNode(p.kind === "managed" ? "Managed: runs inside the hub" : "External: catalogued here, runs elsewhere"));

  const tags = el("div", "chips");
  for (const t of p.tags || []) {
    const c = btn(t, "chip", () => { state.filters.tag = t; renderList(); });
    c.title = "Filter the list by this tag";
    tags.append(c);
  }
  if (!tags.childNodes.length) tags.append(el("span", "muted", "-"));
  row("Tags", tags);

  const links = el("div", "links");
  for (const [name, url] of Object.entries(p.links || {})) {
    if (/^https?:\/\//i.test(url)) {
      const a = el("a", null, name);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      links.append(a);
    } else {
      links.append(copyBtn(name, url));
    }
  }
  if (!links.childNodes.length) links.append(el("span", "muted", "-"));
  row("Links", links);

  if (p.workflow) {
    const trig = el("div");
    trig.append(badge(p.workflow.trigger.type), document.createTextNode("  " + humanTrigger(p.workflow.trigger)));
    row("Trigger", trig);

    const sys = el("div", "chips");
    for (const s of systemsOf(p)) {
      const c = btn(s, "chip", () => { state.sys = s; go("systems"); });
      c.title = "See where this system is used";
      sys.append(c);
    }
    row("Systems", sys);

    const steps = el("div");
    steps.append(document.createTextNode(stepsOf(p).length + " steps  "));
    steps.append(btn("View workflow", "link", () => { state.dtab = "workflow"; renderDetail(); }));
    row("Steps", steps);
  } else {
    row("Workflow", el("span", "muted", "No workflow.yaml yet."));
  }
  body.append(meta);
}
function renderWorkflow(body, p) {
  const w = p.workflow;
  const steps = stepsOf(p);
  const nodes = {};
  const key = (id) => p.slug + ":" + id;

  const setOpen = (id, open) => {
    const n = nodes[id];
    if (!n) return;
    n.body.hidden = !open;
    n.chev.textContent = open ? "\u25be" : "\u25b8";
    n.head.setAttribute("aria-expanded", String(open));
    if (open) state.open.add(key(id)); else state.open.delete(key(id));
  };

  const bar = el("div", "toolbar");
  bar.append(
    btn("Expand all", "small-btn", () => steps.forEach((s) => setOpen(s.id, true))),
    btn("Collapse all", "small-btn", () => steps.forEach((s) => setOpen(s.id, false)))
  );
  body.append(bar);

  const flow = el("div", "flow");
  const t = el("div", "node trigger");
  const human = humanTrigger(w.trigger);
  t.append(el("div", "small muted", "Trigger"), el("strong", null, w.trigger.type + (human ? " - " + human : "")));
  if (w.trigger.type === "schedule" && human !== w.trigger.spec) t.append(el("div", "small muted", "cron: " + w.trigger.spec));
  flow.append(t);

  const names = {};
  steps.forEach((s) => { names[s.id] = s.name; });

  for (const s of steps) {
    flow.append(el("div", "arrow", "\u2193"));
    const node = el("div", "node");
    const head = el("button", "step-head");
    head.type = "button";
    const chev = el("span", "chev", "\u25b8");
    const title = el("span", "step-title");
    title.append(el("strong", null, s.name), el("span", "muted small", s.system || ""));
    head.append(chev, title, badge(s.type));

    const bd = el("div", "step-body");
    bd.hidden = true;
    bd.append(el("div", "small", s.notes || "No notes for this step."));
    const nx = el("div", "small muted");
    if (s.next && s.next.length) {
      nx.append(document.createTextNode("Next: "));
      s.next.forEach((id, i) => {
        if (i) nx.append(document.createTextNode(", "));
        nx.append(btn(names[id] || id, "link", () => {
          setOpen(id, true);
          const target = nodes[id];
          if (!target) return;
          target.node.scrollIntoView({ behavior: "smooth", block: "center" });
          target.node.classList.add("flash");
          setTimeout(() => target.node.classList.remove("flash"), 1200);
        }));
      });
    } else {
      nx.append(document.createTextNode("End of flow"));
    }
    bd.append(nx);

    head.addEventListener("click", () => setOpen(s.id, bd.hidden));
    node.append(head, bd);
    flow.append(node);
    nodes[s.id] = { node: node, head: head, body: bd, chev: chev };
  }

  if (w.outputs && w.outputs.length) {
    flow.append(el("div", "arrow", "\u2193"));
    const o = el("div", "node");
    o.append(el("div", "small muted", "Outputs"));
    const chips = el("div", "chips");
    for (const x of w.outputs) chips.append(el("span", "chip", x));
    o.append(chips);
    flow.append(o);
  }
  body.append(flow);
  steps.forEach((s) => { if (state.open.has(key(s.id))) setOpen(s.id, true); });
}

/* ---------- Systems tab ---------- */

function renderSystems(view) {
  const wrap = el("div", "panel");
  const q = el("input");
  q.type = "search";
  q.placeholder = "Filter systems";
  q.value = state.sys;
  q.setAttribute("aria-label", "Filter systems");
  const grid = el("div", "cards wide");

  const draw = () => {
    grid.replaceChildren();
    const f = state.sys.trim().toLowerCase();
    const list = systemIndex().filter((s) => !f || s.name.toLowerCase().includes(f));
    if (!list.length) { grid.append(el("p", "muted", "No systems match.")); return; }
    for (const s of list) {
      const c = el("div", "card static");
      c.append(el("strong", null, s.name));
      c.append(el("div", "muted small", s.steps + (s.steps === 1 ? " step in " : " steps in ") + s.projects.size + (s.projects.size === 1 ? " project" : " projects")));
      const chips = el("div", "chips");
      for (const [slug, title] of s.projects) {
        chips.append(btn(title, "chip", () => { state.dtab = "workflow"; go("projects/" + encodeURIComponent(slug)); }));
      }
      c.append(chips);
      grid.append(c);
    }
  };
  q.addEventListener("input", () => { state.sys = q.value; draw(); });

  wrap.append(el("p", "muted small", "Every tool or service named in a workflow step, and the projects that use it."), q, grid);
  view.append(wrap);
  draw();
}

/* ---------- Triggers tab ---------- */

function renderTriggers(view) {
  const wrap = el("div", "panel");
  const types = ["all"];
  for (const p of state.data) { const t = triggerType(p); if (!types.includes(t)) types.push(t); }
  if (!types.includes(state.trig)) state.trig = "all";
  const chips = el("div", "chips");
  const rows = el("div");

  const draw = () => {
    chips.replaceChildren();
    for (const t of types) chips.append(btn(t, "chip" + (state.trig === t ? " on" : ""), () => { state.trig = t; draw(); }));
    rows.replaceChildren();
    const list = state.data.filter((p) => state.trig === "all" || triggerType(p) === state.trig);
    if (!list.length) { rows.append(el("p", "muted", "No projects match.")); return; }
    for (const p of list) {
      const row = el("div", "trow");
      row.append(btn(p.title, "link", () => { state.dtab = "workflow"; go("projects/" + encodeURIComponent(p.slug)); }));
      row.append(badge(triggerType(p)));
      row.append(el("span", "muted", p.workflow ? humanTrigger(p.workflow.trigger) : "No workflow.yaml yet"));
      row.append(badge(p.status, p.status));
      rows.append(row);
    }
  };

  wrap.append(el("p", "muted small", "When each project starts, taken from its workflow file. The hub records this but does not run anything yet."), chips, rows);
  view.append(wrap);
  draw();
}

/* ---------- start ---------- */

async function init() {
  const nav = $("nav");
  for (const [id, label] of TABS) {
    const a = el("a", null, label);
    a.href = "#" + id;
    a.dataset.tab = id;
    nav.append(a);
  }
  try {
    state.data = await getJSON("/api/projects?full=1");
  } catch (e) {
    const b = $("#error");
    b.textContent = "Could not load projects: " + e.message;
    b.hidden = false;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

init();