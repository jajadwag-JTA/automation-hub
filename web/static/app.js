"use strict";
// Three screens, no repeats: Projects, one Project, and Activity.
// Text from project files and run output is added as text, never as HTML.

const $ = (s) => document.querySelector(s);
const STATUSES = ["idea", "building", "live", "paused", "retired"];
const KINDS = ["managed", "external"];
const RUN_LABELS = { running: "running", succeeded: "succeeded", failed: "failed", timed_out: "timed out" };
const PTABS = [["workflow", "Workflow"], ["runs", "Runs"], ["notes", "Notes"]];

const state = {
  projects: [],
  filters: { q: "", status: "", kind: "", tag: "", system: "" },
  openSteps: new Set(),
  starting: new Set(),
};

let visit = 0;       // changes on every navigation, so late replies are ignored
let screen = null;   // { refresh() } for the screen on show
let timer = 0;
let lost = false;   // true while the hub cannot be reached

/* ---------- helpers ---------- */

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) {
    if (c !== undefined && c !== null && c !== false) e.append(c);
  }
  return e;
}

function button(cls, onClick, ...children) {
  const b = el("button", cls, ...children);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function link(href, cls, ...children) {
  const a = el("a", cls, ...children);
  a.href = href;
  return a;
}

function badge(text, status) {
  const b = el("span", "badge", text);
  if (status) b.dataset.status = status;
  return b;
}

const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
const isWeb = (url) => /^https?:\/\//i.test(url);
const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
const canRun = (p) => !!(p.run && p.run.command && p.run.command.length);
const stepsOf = (p) => (p.workflow && p.workflow.steps) || [];
const systemsOf = (p) => [...new Set(stepsOf(p).map((s) => s.system).filter(Boolean))];

function projectHref(slug, tab, runId) {
  let h = "#project/" + encodeURIComponent(slug) + "/" + (tab || "workflow");
  if (runId) h += "/" + encodeURIComponent(runId);
  return h;
}

function when(iso) {
  const d = new Date(iso);
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return plural(Math.floor(secs / 60), "minute") + " ago";
  if (secs < 86400) return plural(Math.floor(secs / 3600), "hour") + " ago";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function exact(iso) {
  return new Date(iso).toLocaleString();
}

function duration(run) {
  const end = run.finished_at ? new Date(run.finished_at) : new Date();
  const s = Math.max(0, (end - new Date(run.started_at)) / 1000);
  if (s < 60) return s.toFixed(1) + " s";
  return Math.floor(s / 60) + " min " + Math.round(s % 60) + " s";
}

const runBadge = (run) => badge(RUN_LABELS[run.status] || run.status, run.status);

async function getJSON(url, options) {
  const response = await fetch(url, Object.assign({ cache: "no-store" }, options));
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body && body.error) || response.statusText || "request failed");
  return body;
}

function showError(message) {
  const box = $("#error");
  box.textContent = message || "";
  box.hidden = !message;
}

async function loadProjects() {
  state.projects = (await getJSON("/api/projects?full=1")) || [];
}

/* ---------- running a project ---------- */

async function startRun(slug) {
  if (state.starting.has(slug)) return;
  state.starting.add(slug);
  showError("");
  try {
    const run = await getJSON("/api/projects/" + encodeURIComponent(slug) + "/run", {
      method: "POST",
      headers: { "X-Hub-Request": "1" },
    });
    const target = projectHref(slug, "runs", run.id);
    if (location.hash === target) route();
    else location.hash = target;
  } catch (e) {
    showError("Could not start the run: " + e.message);
  } finally {
    state.starting.delete(slug);
  }
}

function runControl(p) {
  if (!canRun(p)) {
    const note = el("span", "muted small", "Catalogue only");
    note.title = "Add a run: section to project.yaml so the hub can run it";
    return note;
  }
  const running = p.last_run && p.last_run.status === "running";
  const b = button("run-btn", () => { b.disabled = true; startRun(p.slug); }, running ? "Running…" : "Run now");
  b.disabled = !!running;
  return b;
}

/* ---------- Projects screen ---------- */

function matches(p) {
  const f = state.filters;
  if (f.status && p.status !== f.status) return false;
  if (f.kind && p.kind !== f.kind) return false;
  if (f.tag && !(p.tags || []).includes(f.tag)) return false;
  if (f.system && !systemsOf(p).includes(f.system)) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [p.title, p.about, p.slug, (p.tags || []).join(" "), systemsOf(p).join(" ")].join(" ").toLowerCase().includes(q);
}

function select(label, allText, options, key, onChange) {
  const s = el("select");
  s.setAttribute("aria-label", label);
  s.append(new Option(allText, ""));
  const all = options.slice();
  if (state.filters[key] && !all.includes(state.filters[key])) all.push(state.filters[key]);
  for (const o of all) s.append(new Option(o, o));
  s.value = state.filters[key];
  s.addEventListener("change", () => { state.filters[key] = s.value; onChange(); });
  return s;
}

function projectsScreen(view) {
  const rows = el("div");
  const found = el("div", "muted small found");
  const unique = (fn) => [...new Set(state.projects.flatMap(fn))].sort();

  function draw() {
    const shown = state.projects.filter(matches);
    found.textContent = shown.length + " of " + plural(state.projects.length, "project");
    rows.replaceChildren();
    if (!shown.length) {
      rows.append(el("p", "muted", "No projects match. ", button("link", () => {
        state.filters = { q: "", status: "", kind: "", tag: "", system: "" };
        route();
      }, "Clear filters")));
      return;
    }
    rows.append(el("div", "prow head", el("span", null, "Project"), el("span", null, "Status"), el("span", null, "Last run"), el("span")));
    for (const p of shown) {
      const last = el("span", "lastrun");
      if (p.last_run) {
        const a = link(projectHref(p.slug, "runs", p.last_run.id), "runlink", runBadge(p.last_run),
          el("span", "muted small", when(p.last_run.started_at)));
        a.title = exact(p.last_run.started_at);
        last.append(a);
      } else {
        last.append(el("span", "muted small", "Never run"));
      }
      const row = el("div", "prow clickable",
        el("span", "ptitle", link(projectHref(p.slug), null, el("strong", null, p.title)), el("span", "muted small", p.about || "")),
        el("span", null, badge(p.status, p.status)),
        last,
        el("span", "actions", runControl(p)));
      row.addEventListener("click", (e) => {
        if (!e.target.closest("a, button")) location.hash = projectHref(p.slug);
      });
      rows.append(row);
    }
  }

  const search = el("input");
  search.type = "search";
  search.placeholder = "Search projects";
  search.setAttribute("aria-label", "Search projects");
  search.value = state.filters.q;
  search.addEventListener("input", () => { state.filters.q = search.value; draw(); });

  const controls = el("div", "controls", search,
    select("Filter by status", "All statuses", STATUSES, "status", draw),
    select("Filter by kind", "All kinds", KINDS, "kind", draw),
    select("Filter by tag", "All tags", unique((p) => p.tags || []), "tag", draw),
    select("Filter by system", "All systems", unique(systemsOf), "system", draw));

  view.replaceChildren(el("div", "panel", controls, found, rows));
  draw();

  return {
    async refresh() {
      const mine = visit;
      await loadProjects();
      if (mine === visit) draw();
    },
    busy: () => state.projects.some((p) => p.last_run && p.last_run.status === "running"),
  };
}

/* ---------- Project screen ---------- */

function filterBy(key, value) {
  state.filters = { q: "", status: "", kind: "", tag: "", system: "" };
  state.filters[key] = value;
  location.hash = "#projects";
}

function details(p) {
  const meta = el("dl", "meta");
  const add = (name, value) => meta.append(el("dt", null, name), el("dd", null, value));
  const chipsFor = (key, values) => {
    if (!values.length) return "-";
    const box = el("div", "chips");
    for (const v of values) {
      const c = button("chip", () => filterBy(key, v), v);
      c.title = "Show projects with this " + key;
      box.append(c);
    }
    return box;
  };

  add("Owner", p.owner || "-");
  add("Tags", chipsFor("tag", p.tags || []));
  add("Systems", chipsFor("system", systemsOf(p)));

  const links = el("div", "links");
  for (const [name, url] of Object.entries(p.links || {})) {
    if (isWeb(url)) {
      const a = link(url, null, name + (isLocal(url) ? " (local)" : "") + " ↗");
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (isLocal(url)) a.title = "Opens only while it is running on this computer";
      links.append(a);
    } else {
      const label = "Copy " + name + " command";
      const b = button("copy", async () => {
        try { await navigator.clipboard.writeText(url); b.textContent = "Copied"; }
        catch (e) { b.textContent = "Copy failed"; }
        setTimeout(() => { b.textContent = label; }, 1500);
      }, label);
      b.title = url;
      links.append(b);
    }
  }
  add("Links", links.childNodes.length ? links : "-");
  if (canRun(p)) add("Runs", el("code", "cmd", p.run.command.join(" ")));
  return meta;
}

function workflowTab(p) {
  const w = p.workflow;
  if (!w) return el("p", "muted", "No workflow yet. Add workflow.yaml to this project's folder, then refresh.");
  const steps = stepsOf(p);
  const nodes = {};
  const names = Object.fromEntries(steps.map((s) => [s.id, s.name || s.id]));
  const key = (id) => p.slug + ":" + id;

  function setOpen(id, open) {
    const n = nodes[id];
    if (!n) return;
    n.body.hidden = !open;
    n.chev.textContent = open ? "▾" : "▸";
    n.head.setAttribute("aria-expanded", String(open));
    if (open) state.openSteps.add(key(id)); else state.openSteps.delete(key(id));
  }

  function jump(id) {
    if (!nodes[id]) return;
    setOpen(id, true);
    const box = nodes[id].box;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.classList.add("flash");
    setTimeout(() => box.classList.remove("flash"), 1200);
  }

  const flow = el("div", "flow", el("div", "node trigger",
    el("div", "small muted", "Trigger"),
    el("strong", null, w.trigger.type + (w.trigger.spec ? ": " + w.trigger.spec : "")),
    w.trigger.type === "schedule" && el("div", "small muted", "The hub does not start scheduled runs yet.")));

  for (const s of steps) {
    const next = el("div", "small muted");
    if (s.next && s.next.length) {
      next.append("Next: ");
      s.next.forEach((id, i) => {
        if (i) next.append(", ");
        next.append(button("link", () => jump(id), names[id] || id));
      });
    } else {
      next.append("End of flow");
    }
    const body = el("div", "step-body", el("div", "small", s.notes || "No notes for this step."), next);
    const chev = el("span", "chev");
    const head = button("step-head", () => setOpen(s.id, body.hidden), chev,
      el("span", "step-title", el("strong", null, s.name || s.id), el("span", "muted small", s.system || "")),
      badge(s.type || "step"));
    const box = el("div", "node", head, body);
    nodes[s.id] = { box, head, body, chev };
    setOpen(s.id, state.openSteps.has(key(s.id)));
    flow.append(el("div", "arrow", "↓"), box);
  }

  if (w.outputs && w.outputs.length) {
    const chips = el("div", "chips");
    for (const x of w.outputs) chips.append(el("span", "chip", x));
    flow.append(el("div", "arrow", "↓"), el("div", "node", el("div", "small muted", "Outputs"), chips));
  }

  return el("div", null,
    el("div", "toolbar",
      button("small-btn", () => steps.forEach((s) => setOpen(s.id, true)), "Expand all"),
      button("small-btn", () => steps.forEach((s) => setOpen(s.id, false)), "Collapse all")),
    flow);
}

// A list of runs where each one opens to show its output. Used by the Runs tab
// and by Activity (which also names the project).
function runList(showProject, openId, emptyText) {
  const box = el("div", "runs");
  const open = new Set(openId ? [openId] : []);
  const outputs = new Map();
  let runs = [];

  function draw() {
    const scrolls = new Map([...box.querySelectorAll("pre[data-run]")].map((x) =>
      [x.dataset.run, { top: x.scrollTop, end: x.scrollTop + x.clientHeight >= x.scrollHeight - 4 }]));
    box.replaceChildren();
    if (!runs.length) { box.append(el("p", "muted", emptyText)); return; }
    for (const r of runs) {
      const isOpen = open.has(r.id);
      const p = state.projects.find((x) => x.slug === r.project);
      const head = button("run-head", async () => {
        if (open.has(r.id)) open.delete(r.id); else open.add(r.id);
        draw();
        if (open.has(r.id)) { await fetchOutput(r.id); draw(); }
      },
        el("span", "chev", isOpen ? "▾" : "▸"),
        el("span", "run-when", showProject && el("strong", null, p ? p.title : r.project), el("span", showProject ? "muted small" : null, exact(r.started_at))),
        el("span", "muted small", duration(r)),
        runBadge(r));
      head.setAttribute("aria-expanded", String(isOpen));
      const item = el("div", "node run", head);
      let output = null;
      if (isOpen) {
        const detail = outputs.get(r.id);
        const facts = [r.trigger + " run", r.exit_code !== undefined ? "exit code " + r.exit_code : ""].filter(Boolean).join(", ");
        const body = el("div", "step-body", el("div", "small muted", facts));
        if (r.error) body.append(el("div", "small bad", r.error));
        output = el("pre", "output", !detail ? "Loading output…" : detail.output || (r.status === "running" ? "Waiting for output…" : "This run printed nothing."));
        output.dataset.run = r.id;
        body.append(output);
        if (showProject && p) body.append(el("div", null, link(projectHref(p.slug, "runs", r.id), null, "Open project")));
        item.append(body);
      }
      box.append(item);
      if (output) {
        const s = scrolls.get(r.id);
        output.scrollTop = !s || s.end ? output.scrollHeight : s.top;
      }
    }
  }

  async function fetchOutput(id) {
    try {
      outputs.set(id, await getJSON("/api/runs/" + encodeURIComponent(id)));
    } catch (e) {
      outputs.set(id, { output: "Could not read the output: " + e.message, status: "failed" });
    }
  }

  return {
    node: box,
    async update(list) {
      runs = list;
      await Promise.all(runs.filter((r) => open.has(r.id)).map((r) => {
        const have = outputs.get(r.id);
        return have && have.status !== "running" ? null : fetchOutput(r.id);
      }));
      draw();
    },
    busy: () => runs.some((r) => r.status === "running"),
  };
}

function projectScreen(view, slug, tab, runId) {
  const find = () => state.projects.find((x) => x.slug === slug);
  const p = find();
  const back = link("#projects", null, "← All projects");
  if (!p) {
    view.replaceChildren(el("div", "panel", back, el("p", "muted", "There is no project called " + slug + ".")));
    return { refresh: async () => {}, busy: () => false };
  }
  const current = PTABS.some(([id]) => id === tab) ? tab : "workflow";
  const action = el("span", "actions", runControl(p));

  const tabs = el("div", "tabs");
  tabs.setAttribute("role", "tablist");
  for (const [id, label] of PTABS) {
    const a = link(projectHref(p.slug, id), "tab" + (id === current ? " active" : ""), label);
    a.setAttribute("role", "tab");
    a.setAttribute("aria-selected", String(id === current));
    tabs.append(a);
  }

  let list = null;
  let body;
  if (current === "workflow") body = workflowTab(p);
  else if (current === "notes") body = p.readme ? markdown(p.readme) : el("p", "muted", "No notes yet. Add README.md to this project's folder, then refresh.");
  else {
    list = runList(false, runId, canRun(p)
      ? "No runs yet. Press Run now to start one."
      : "This project is catalogue only, so the hub has no runs for it.");
    body = list.node;
    list.node.append(el("p", "muted", "Loading runs…"));
  }

  view.replaceChildren(el("div", "panel", back,
    el("div", "row title", el("h2", null, p.title), el("div", "chips", badge(p.status, p.status), badge(p.kind), action)),
    el("p", "muted", p.about || ""),
    details(p), tabs, body));

  const screen = {
    async refresh() {
      const mine = visit;
      await loadProjects();
      const runs = list ? await getJSON("/api/runs?limit=50&project=" + encodeURIComponent(slug)) : null;
      if (mine !== visit) return;
      const fresh = find();
      if (fresh) action.replaceChildren(runControl(fresh));
      if (list) await list.update(runs);
    },
    busy: () => !!((list && list.busy()) || (find() && find().last_run && find().last_run.status === "running")),
  };
  return screen;
}

/* ---------- Activity screen ---------- */

function activityScreen(view) {
  const list = runList(true, "", "Nothing has run yet. Open Projects and press Run now.");
  list.node.append(el("p", "muted", "Loading runs…"));
  view.replaceChildren(el("div", "panel", el("h3", "section", "Latest runs"), list.node));
  return {
    async refresh() {
      const mine = visit;
      const runs = await getJSON("/api/runs?limit=50");
      if (mine === visit) await list.update(runs);
    },
    busy: list.busy,
  };
}

/* ---------- notes (a small, safe Markdown reader) ---------- */

function inline(parent, text) {
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) parent.append(el("code", null, part.slice(1, -1)));
    else if (part.length > 3 && part.startsWith("**") && part.endsWith("**")) parent.append(el("strong", null, part.slice(2, -2)));
    else parent.append(part);
  }
  return parent;
}

function markdown(source) {
  const root = el("div", "md");
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const item = /^\s*([-*]|\d+\.)\s+/;
  const indented = /^( {4}|\t)/;
  const special = (l) => /^(```|#{1,4}\s)/.test(l) || item.test(l);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      root.append(el("pre", null, code.join("\n")));
    } else if (indented.test(line) && !item.test(line)) {
      const code = [];
      while (i < lines.length && indented.test(lines[i])) code.push(lines[i++].replace(indented, ""));
      root.append(el("pre", null, code.join("\n")));
    } else if (/^#{1,4}\s/.test(line)) {
      root.append(inline(el(line.startsWith("# ") ? "h3" : "h4", "md-h"), line.replace(/^#+\s+/, "")));
      i++;
    } else if (item.test(line)) {
      const ul = el(/^\s*\d/.test(line) ? "ol" : "ul", "md-list");
      while (i < lines.length && item.test(lines[i])) ul.append(inline(el("li"), lines[i++].replace(item, "")));
      root.append(ul);
    } else {
      const para = [line.trim()];
      for (i++; i < lines.length && lines[i].trim() && !special(lines[i]); i++) para.push(lines[i].trim());
      root.append(inline(el("p"), para.join(" ")));
    }
  }
  return root;
}

/* ---------- routing and refresh ---------- */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map((x) => {
    try { return decodeURIComponent(x); } catch (e) { return ""; }
  });
  if (parts[0] === "project" && parts[1]) return { page: "project", slug: parts[1], tab: parts[2], run: parts[3] };
  return { page: parts[0] === "activity" ? "activity" : "projects" };
}

// While something is running, look again every 1.5 seconds. Otherwise check
// every 30 seconds so "last run" stays current.
function schedule() {
  clearTimeout(timer);
  const mine = visit;
  timer = setTimeout(async () => {
    try {
      if (!document.hidden) {
        await screen.refresh();
        if (lost) { lost = false; showError(""); }
      }
    } catch (e) {
      if (mine === visit) { lost = true; showError("Lost contact with the hub: " + e.message); }
    }
    if (mine === visit) schedule();
  }, screen.busy() ? 1500 : 30000);
}

async function route() {
  const mine = ++visit;
  clearTimeout(timer);
  const r = parseHash();
  document.querySelectorAll("nav a").forEach((a) => {
    const on = a.dataset.page === (r.page === "activity" ? "activity" : "projects");
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  try {
    await loadProjects();
    if (mine !== visit) return;
    showError("");
    $("#count").textContent = plural(state.projects.length, "project");
    const view = $("#view");
    if (r.page === "project") screen = projectScreen(view, r.slug, r.tab, r.run);
    else if (r.page === "activity") screen = activityScreen(view);
    else screen = projectsScreen(view);
    if (r.page !== "projects") await screen.refresh();
    if (mine === visit) schedule();
  } catch (e) {
    if (mine === visit) showError("Could not load from the hub: " + e.message);
  }
}

function init() {
  for (const [id, label] of [["projects", "Projects"], ["activity", "Activity"]]) {
    const a = link("#" + id, null, label);
    a.dataset.page = id;
    $("nav").append(a);
  }
  window.addEventListener("hashchange", route);
  route();
}

init();
