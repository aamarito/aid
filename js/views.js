// Page renderers. Each returns an HTML string for #view.
import {
  S, U, ROUTES, EXP_STATUS, TASK_STATUS, PRIOS, PROD_STATUS, PEOPLE_STATUS, PERMS, NOUN,
  session, role, can, myId, roleLabel, companyById, activeCompanies, scopeCompanies, scoped,
  expenseCats, productCats, projects, budgetFor, budgetTotal, wsList,
} from "./state.js";
import {
  esc, icon, money, compact, num, NF, qty, avatar, chip, opt, fdate, daysFrom, relTime,
  monthKey, monthLabel, addMonths,
} from "./util.js";

// ---------- derived figures (always within the selected company) ----------
export const personById = (id) => S.people.find((p) => p.id === id);
export const profileById = (id) => S.profiles.find((p) => p.id === id);
const inMonth = (list, k) => list.filter((e) => String(e.spent_on || "").startsWith(k));
export const expInMonth = (k) => inMonth(scoped("expenses"), k);
export const spend = (list) => list.filter((e) => e.status !== "rejected").reduce((a, e) => a + num(e.amount), 0);
export const openTasks = () => scoped("tasks").filter((t) => t.status !== "done");
export const overdue = () => openTasks().filter((t) => t.due && daysFrom(t.due) < 0);
const live = (p) => p.status !== "discontinued";
export const lowStock = () => scoped("products").filter((p) => live(p) && num(p.stock) <= num(p.reorder_level));
export const invValue = (list = scoped("products")) => list.filter(live).reduce((a, p) => a + num(p.stock) * num(p.cost), 0);
export const retailValue = () => scoped("products").filter(live).reduce((a, p) => a + num(p.stock) * num(p.price), 0);
export const margin = (p) => { const pr = num(p.price), c = num(p.cost); return pr > 0 ? (pr - c) / pr : 0; };
export const pendingUsers = () => S.profiles.filter((p) => p.role === "pending" && p.active);
export const actorName = (id) => {
  if (!id) return "System";
  if (id === myId()) return "You";
  const p = profileById(id);
  return p?.full_name || p?.email || "A teammate";
};

export function taskSort(a, b) {
  const pa = opt(PRIOS, a.priority).w, pb = opt(PRIOS, b.priority).w;
  if (pa !== pb) return pb - pa;
  return (a.due || "9999").localeCompare(b.due || "9999");
}

/** small coloured company tag, shown when viewing all companies */
export function coChip(cid, force) {
  if (U.company && !force) return "";
  if (!cid) return `<span class="co-chip" style="--co:var(--muted)">Group</span>`;
  const c = companyById(cid);
  return c ? `<span class="co-chip" style="--co:${esc(c.color)}">${esc(c.name)}</span>` : "";
}

export function activityLine(a) {
  const d = a.detail || {};
  const L = `“${a.label || "untitled"}”`;
  const st = (list, v) => opt(list, v).l;
  switch (a.entity) {
    case "expenses":
      if (a.action === "created") return `Logged ${money(d.amount)} for ${L}`;
      if (a.action === "status") return `${st(EXP_STATUS, d.to)}: ${L} (${money(d.amount)})`;
      if (a.action === "deleted") return `Deleted expense ${L}`;
      return `Edited expense ${L}`;
    case "tasks":
      if (a.action === "created") return `Created task ${L}`;
      if (a.action === "status") return `Moved ${L} to ${st(TASK_STATUS, d.to)}`;
      if (a.action === "deleted") return `Deleted task ${L}`;
      return `Updated task ${L}`;
    case "products":
      if (a.action === "created") return `Added product ${L}`;
      if (a.action === "stock") return `Stock of ${L}: ${qty(d.from)} → ${qty(d.to)}`;
      if (a.action === "status") return `${L} is now ${st(PROD_STATUS, d.to).toLowerCase()}`;
      if (a.action === "deleted") return `Deleted product ${L}`;
      return `Updated product ${L}`;
    case "people":
      if (a.action === "created") return `Added ${a.label} to the team`;
      if (a.action === "status") return `${a.label} is now ${st(PEOPLE_STATUS, d.to).toLowerCase()}`;
      if (a.action === "deleted") return `Removed ${a.label} from the team`;
      return `Updated ${a.label}'s details`;
    case "companies":
      if (a.action === "created") return `Added company ${L}`;
      if (a.action === "deleted") return `Deleted company ${L}`;
      return `Updated company ${L}`;
    case "workspace": return "Updated group settings";
    case "roles":
      if (a.action === "created") return `Created role ${L}`;
      if (a.action === "deleted") return `Deleted role ${L}`;
      return `Edited role ${L}`;
    case "role_permissions": {
      const [rk, perm] = String(a.label || "").split(": ");
      const pl = PERMS.flatMap((g) => g.items).find((i) => i.k === perm)?.l || perm;
      return `${a.action === "created" ? "Gave" : "Removed from"} ${roleLabel(rk)}: ${pl.toLowerCase()}`;
    }
    case "profiles":
      if (a.action === "created") return `${a.label} signed up`;
      if (d.active === false) return `Turned off access for ${a.label}`;
      if (d.from === "pending") return `Approved ${a.label} as ${roleLabel(d.to).toLowerCase()}`;
      if (d.from === d.to) return `Changed ${a.label}'s company access`;
      return `Changed ${a.label}'s role to ${roleLabel(d.to).toLowerCase()}`;
    default: return `${a.action} ${a.entity}`;
  }
}

// ---------- shared pieces ----------
export function emptyHTML(ic, title, text, mod, cta) {
  return `<div class="empty"><div class="glyph">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${mod && can.create(mod) ? `<button class="btn pri" data-act="new" data-mod="${mod}">${icon("i-plus")}${esc(cta)}</button>` : ""}</div>`;
}
function niceMax(m) { const p = Math.pow(10, Math.floor(Math.log10(m))); const n = m / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 8 ? 8 : 10) * p; }
function barChart(data, { h = 170, fmt = compact, curIdx = -1 } = {}) {
  const W = 560, pl = 70, pr = 8, pt = 22, pb = 24, ch = h - pt - pb;
  const nice = niceMax(Math.max(1, ...data.map((d) => d.v)));
  const bw = (W - pl - pr) / data.length;
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const y = pt + ch - (ch * i) / 4;
    g += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 8}" y="${y + 3.5}" text-anchor="end">${esc(i ? fmt((nice * i) / 4) : "0")}</text>`;
  }
  data.forEach((d, i) => {
    const bh = ch * (d.v / nice); const x = pl + i * bw + bw * 0.2, w = bw * 0.6, y = pt + ch - bh;
    g += `<rect class="bar${i === curIdx ? " cur" : ""}${d.v === 0 ? " ghost" : ""}" x="${x}" y="${d.v === 0 ? pt + ch - 2 : y}" width="${w}" height="${d.v === 0 ? 2 : Math.max(bh, 2)}" rx="3"><title>${esc(d.l)}: ${esc(money(d.v))}</title></rect>`;
    g += `<text x="${x + w / 2}" y="${h - 6}" text-anchor="middle">${esc(d.l)}</text>`;
    if (i === curIdx && d.v > 0) g += `<text x="${x + w / 2}" y="${y - 5}" text-anchor="middle" style="fill:var(--fg);font-weight:600">${esc(compact(d.v))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Spending by month">${g}</svg>`;
}
function hbars(rows, { fmt = money, max } = {}) {
  if (!rows.length) return `<p style="color:var(--muted);margin:0">Nothing to show yet.</p>`;
  const mx = max || Math.max(1, ...rows.map((r) => r.v));
  return `<div class="hbar">${rows.map((r) => `<span class="nm" title="${esc(r.l)}">${r.dot ? `<i class="dot-c" style="background:${esc(r.dot)}"></i>` : ""}${esc(r.l)}</span><span class="tr"><i class="${r.cls || ""}" style="width:${Math.min(100, (r.v / mx) * 100)}%;${r.dot ? `background:${esc(r.dot)}` : ""}"></i></span><span class="v">${esc(fmt(r.v))}${r.extra ? ` <span style="color:var(--faint)">${esc(r.extra)}</span>` : ""}</span>`).join("")}</div>`;
}
const sel = (id, label, cur, options, all) =>
  `<select class="sel" id="${id}" aria-label="${esc(label)}"><option value="">${esc(all)}</option>${options.map((o) => { const v = typeof o === "string" ? o : o.v; const l = typeof o === "string" ? o : o.l; return `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
const seg = (act, cur, items) =>
  `<div class="seg" role="group" aria-label="View">${items.map(([v, ic, l]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${icon(ic)}<span class="sr">${l}</span></button>`).join("")}</div>`;
const sortTh = (act, f, k, l, cls = "") =>
  `<th class="sortable ${cls}" data-act="${act}" data-k="${k}" aria-sort="${f.sort === k ? (f.dir > 0 ? "ascending" : "descending") : "none"}">${esc(l)}${f.sort === k ? (f.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
const kpi = (lab, val, note, color) =>
  `<div class="kpi"><span class="lab">${esc(lab)}</span><span class="val"${color ? ` style="color:${color}"` : ""}>${val}</span><span class="note">${note}</span></div>`;
const exportBtn = (mod, n) => (n && can.exportCsv() ? `<button class="btn" data-act="csv" data-mod="${mod}">${icon("i-down")}<span class="hide-m">Export CSV</span></button>` : "");
const scopeName = () => (U.company ? companyById(U.company)?.name || "This company" : "All companies");

// ---------- Overview ----------
export function vOverview() {
  const mk = monthKey(new Date()); const cur = expInMonth(mk); const spent = spend(cur); const bud = budgetTotal();
  const prev = spend(expInMonth(addMonths(mk, -1)));
  const pend = scoped("expenses").filter((e) => e.status === "pending");
  const op = openTasks(), od = overdue(), ls = lowStock();
  const ppl = scoped("people"); const act = ppl.filter((p) => p.status === "active").length; const lv = ppl.filter((p) => p.status === "leave").length;
  const delta = prev ? (spent - prev) / prev : null;
  const budPct = bud ? spent / bud : 0;
  const scope = can.seeAllExpenses() ? "" : " (yours)";
  const hello = session.profile?.full_name ? `Hello, ${session.profile.full_name.split(" ")[0]}` : "Hello";
  const pu = can.users() ? pendingUsers() : [];
  const showExp = can.any(["expenses.view", "expenses.view_all", "expenses.approve", "expenses.manage"]);
  const c = U.company ? companyById(U.company) : null;

  let html = `<div class="toolbar"><div style="min-width:0"><h2 style="font-size:22px">${esc(hello)}</h2><div style="color:var(--muted)">${c ? `${esc(c.name)} · ${esc(c.industry || "")}` : `${esc(S.ws.company || "aamarito group")} · ${activeCompanies().length} companies`}</div></div><span class="grow"></span><span class="chip nodot role-chip">${esc(roleLabel(role()))}</span></div>`;
  if (pu.length) html += `<div class="banner info">${icon("i-shield")}<span style="flex:1">${pu.length} ${pu.length === 1 ? "person is" : "people are"} waiting for approval.</span><a class="btn sm" href="#members">Review</a></div>`;
  html += `<div class="grid g-kpi">
    ${showExp ? `<div class="kpi"><span class="lab">Spent in ${esc(monthLabel(mk, true))}${scope}</span><span class="val">${esc(money(spent))}</span>
      ${bud && can.seeAllExpenses() ? `<div class="meter"><i class="${budPct > 1 ? "bad" : budPct > 0.85 ? "warn" : ""}" style="width:${Math.min(100, budPct * 100)}%"></i></div><span class="note"><b>${Math.round(budPct * 100)}%</b> of ${esc(money(bud))} budget</span>` : `<span class="note">${delta == null ? "No spending last month" : `${delta >= 0 ? "Up" : "Down"} <b>${Math.abs(Math.round(delta * 100))}%</b> on last month`}</span>`}</div>
    ${kpi("Waiting for approval", pend.length, pend.length ? `<b>${esc(money(spend(pend)))}</b> in claims` : "Nothing pending")}` : ""}
    ${can.has("tasks.view") ? kpi("Open tasks", op.length, `${od.length ? `<b style="color:var(--bad)">${od.length} overdue</b>` : "None overdue"} · ${scoped("tasks").filter((t) => t.status === "done").length} done`) : ""}
    ${can.has("products.view") ? kpi("Stock at cost", esc(compact(invValue())), `${ls.length ? `<b style="color:var(--warn)">${ls.length} low on stock</b>` : "Stock levels healthy"} · ${scoped("products").length} products`) : ""}
    ${can.has("people.view") ? kpi("Team", act, `active${lv ? ` · <b>${lv} on leave</b>` : ""}`) : ""}
  </div>`;

  // companies at a glance (all-companies view)
  if (!U.company && activeCompanies().length > 1) {
    html += `<section class="panel"><header><h2>Companies</h2><span class="sub">${esc(monthLabel(mk))}</span><span class="grow"></span>${can.settings() ? `<a class="btn sm ghost" href="#companies">Manage</a>` : ""}</header><div class="body"><div class="co-grid">${activeCompanies().map((co) => {
      const ex = S.expenses.filter((e) => e.company_id === co.id); const pr = S.products.filter((p) => p.company_id === co.id);
      const tk = S.tasks.filter((t) => t.company_id === co.id && t.status !== "done");
      const b = Object.values(co.budgets || {}).reduce((a, v) => a + num(v), 0); const s = spend(inMonth(ex, mk));
      return `<button class="co-card" data-act="pickCompany" data-id="${esc(co.id)}" style="--co:${esc(co.color)}"><span class="co-name">${esc(co.name)}${co.is_parent ? ` <span class="chip nodot">Mother company</span>` : ""}</span><span class="co-ind">${esc(co.industry || "")}</span>
        <span class="co-stats">${showExp ? `<span><b>${esc(compact(s))}</b>spent${b ? ` of ${esc(compact(b))}` : ""}</span>` : ""}${can.has("tasks.view") ? `<span><b>${tk.length}</b>open tasks</span>` : ""}${can.has("products.view") ? `<span><b>${esc(compact(invValue(pr)))}</b>stock</span>` : ""}</span>${b && showExp ? `<span class="meter"><i class="${s > b ? "bad" : s > b * 0.85 ? "warn" : ""}" style="width:${Math.min(100, (s / b) * 100)}%;${s <= b * 0.85 ? "background:var(--co)" : ""}"></i></span>` : ""}</button>`;
    }).join("")}</div></div></section>`;
  }

  const anything = scoped("expenses").length + scoped("tasks").length + scoped("products").length + scoped("people").length;
  if (!anything) {
    const btns = [
      can.create("people") && `<button class="btn pri" data-act="new" data-mod="people">${icon("i-users")}Add a person</button>`,
      can.create("expenses") && `<button class="btn" data-act="new" data-mod="expenses">${icon("i-wallet")}Log an expense</button>`,
      can.create("tasks") && `<button class="btn" data-act="new" data-mod="tasks">${icon("i-check")}Create a task</button>`,
      can.create("products") && `<button class="btn" data-act="new" data-mod="products">${icon("i-box")}Add a product</button>`,
    ].filter(Boolean).join("");
    return html + `<section class="panel"><div class="empty"><div class="glyph">${icon("i-home")}</div><h3>${U.company ? `Nothing here yet for ${esc(scopeName())}` : "Welcome to aamaritoaid"}</h3><p>${can.settings() ? "Add your team, products and first expenses. Set each company's categories and budgets under Companies, and approve teammates under Users & access." : "Records your team adds will show up here."}</p>${btns ? `<div class="toolbar" style="justify-content:center">${btns}</div>` : ""}</div></section>`;
  }

  const months = []; for (let i = 5; i >= 0; i--) { const k = addMonths(mk, -i); months.push({ l: monthLabel(k, true), v: spend(expInMonth(k)) }); }
  const byCat = {}; cur.filter((e) => e.status !== "rejected").forEach((e) => { const k = e.category || "Other"; byCat[k] = (byCat[k] || 0) + num(e.amount); });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([l, v]) => { const b = budgetFor(l); return { l, v, cls: b && v > b ? "bad" : b && v > b * 0.85 ? "warn" : "", extra: b ? `/ ${compact(b)}` : "" }; });
  const tl = scoped("tasks");
  const tc = TASK_STATUS.map((s) => ({ ...s, n: tl.filter((t) => t.status === s.v).length })); const tt = Math.max(1, tl.length);
  const tcol = { todo: "var(--line-2)", doing: "var(--info)", review: "var(--gold)", done: "var(--good)" };
  const upcoming = op.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);
  const feed = S.activity.filter((a) => !U.company || !a.company_id || a.company_id === U.company).slice(0, 10);

  return html + `
  ${showExp ? `<div class="grid g-2">
    <section class="panel"><header><h2>Spending, last 6 months</h2><span class="sub hide-m">excludes rejected claims</span><span class="grow"></span><a class="btn sm ghost" href="#expenses">Open expenses</a></header><div class="body">${barChart(months, { curIdx: 5 })}</div></section>
    <section class="panel"><header><h2>${esc(monthLabel(mk))} by category</h2></header><div class="body">${hbars(catRows)}</div></section>
  </div>` : ""}
  <div class="grid g-3">
    ${can.has("tasks.view") ? `<section class="panel"><header><h2>Task progress</h2><span class="grow"></span><a class="btn sm ghost" href="#tasks">Board</a></header><div class="body" style="display:flex;flex-direction:column;gap:12px">
      <div class="stack">${tc.map((s) => (s.n ? `<i style="width:${(s.n / tt) * 100}%;background:${tcol[s.v]}" title="${esc(s.l)}: ${s.n}"></i>` : "")).join("")}</div>
      <div class="legend">${tc.map((s) => `<span><i style="background:${tcol[s.v]}"></i>${esc(s.l)} ${s.n}</span>`).join("")}</div>
      <div class="section-t" style="margin-top:4px">Coming up</div>
      <div class="list">${upcoming.length ? upcoming.map((t) => { const p = personById(t.assignee_id); const d = daysFrom(t.due); return `<div class="li" data-act="open" data-mod="tasks" data-id="${esc(t.id)}">${avatar(p)}<div class="grow"><div>${esc(t.title)}</div><div class="t2">${esc(p ? p.name : "Unassigned")} ${coChip(t.company_id)}</div></div><span class="due ${d < 0 ? "late" : d <= 2 ? "soon" : ""}">${d < 0 ? `${-d}d late` : d === 0 ? "Today" : esc(fdate(t.due))}</span></div>`; }).join("") : `<p style="color:var(--muted);margin:0">No open tasks with due dates.</p>`}</div>
    </div></section>` : ""}
    ${can.has("products.view") ? `<section class="panel"><header><h2>Needs restocking</h2><span class="grow"></span><a class="btn sm ghost" href="#products">Products</a></header><div class="body"><div class="list">${ls.length ? ls.slice(0, 7).map((p) => `<div class="li" data-act="open" data-mod="products" data-id="${esc(p.id)}"><div class="grow"><div>${esc(p.name)}</div><div class="t2"><span class="mono">${esc(p.sku || "No SKU")}</span> ${coChip(p.company_id)}</div></div><span class="chip ${num(p.stock) <= 0 ? "c-bad" : "c-warn"}">${esc(qty(p.stock))} ${esc(p.unit || "pcs")} left</span></div>`).join("") : `<p style="color:var(--muted);margin:0">Every product is above its reorder level.</p>`}</div></div></section>` : ""}
    <section class="panel"><header><h2>Recent activity</h2></header><div class="body"><div class="list feed">${feed.length ? feed.map((a) => `<div class="li"><div class="grow"><div style="white-space:normal">${esc(activityLine(a))}</div><div class="t2">${esc(actorName(a.actor))} ${coChip(a.company_id)}</div></div><time datetime="${esc(a.at)}">${esc(relTime(a.at))}</time></div>`).join("") : `<p style="color:var(--muted);margin:0">Changes your team makes will show up here.</p>`}</div></div></section>
  </div>`;
}

// ---------- Expenses ----------
export function filteredExpenses() {
  const f = U.exp;
  let rows = scoped("expenses").filter((e) => (!f.month || String(e.spent_on || "").startsWith(f.month)) && (!f.cat || e.category === f.cat) && (!f.status || e.status === f.status) && (!f.person || e.person_id === f.person));
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((e) => [e.title, e.vendor, e.category, e.reference, e.notes, personById(e.person_id)?.name, companyById(e.company_id)?.name].some((x) => String(x || "").toLowerCase().includes(q))); }
  const key = f.sort;
  rows.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === "amount") { x = num(x); y = num(y); }
    else if (key === "person") { x = personById(a.person_id)?.name || ""; y = personById(b.person_id)?.name || ""; }
    else if (key === "company") { x = companyById(a.company_id)?.name || ""; y = companyById(b.company_id)?.name || ""; }
    else { x = String(x || ""); y = String(y || ""); }
    return (x > y ? 1 : x < y ? -1 : 0) * f.dir;
  });
  return rows;
}
export function vExpenses() {
  const f = U.exp; const rows = filteredExpenses(); const all = !U.company;
  const total = spend(rows);
  const sum = (s) => rows.filter((e) => e.status === s).reduce((a, e) => a + num(e.amount), 0);
  const ms = new Set(scoped("expenses").map((e) => String(e.spent_on || "").slice(0, 7)).filter(Boolean)); ms.add(monthKey(new Date())); if (f.month) ms.add(f.month);
  const monthOpts = [...ms].sort().reverse().map((m) => ({ v: m, l: monthLabel(m) }));
  const selIds = [...f.sel].filter((id) => rows.some((r) => r.id === id));
  const bulk = can.approve();
  const scopeNote = can.seeAllExpenses() ? "" : `<div class="banner info">${icon("i-shield")}<span>You're seeing the expenses you logged. People with approval rights see everyone's.</span></div>`;

  const mkey = f.month || monthKey(new Date()); const inM = expInMonth(mkey);
  const cats = expenseCats(U.company);
  const brows = cats.map((c) => ({ l: c, v: spend(inM.filter((e) => (e.category || "Other") === c)), b: budgetFor(c) })).filter((r) => r.v || r.b);
  const budPanel = `<section class="panel"><header><h2>Budgets · ${esc(monthLabel(mkey))}</h2><span class="sub">${esc(scopeName())}</span><span class="grow"></span>${can.settings() ? `<a class="btn sm ghost" href="#companies">Edit budgets</a>` : ""}</header><div class="body">${brows.length ? hbars(brows.map((r) => ({ l: r.l, v: r.v, cls: r.b && r.v > r.b ? "bad" : r.b && r.v > r.b * 0.85 ? "warn" : "", extra: r.b ? `of ${compact(r.b)}` : "no budget" })), { max: Math.max(1, ...brows.map((r) => Math.max(r.v, r.b))) }) : `<p style="color:var(--muted);margin:0">No spending or budgets for this month yet.</p>`}</div></section>`;
  let sidePanel;
  if (all && activeCompanies().length > 1) {
    sidePanel = `<section class="panel"><header><h2>By company</h2><span class="sub">${esc(monthLabel(mkey))}</span></header><div class="body">${hbars(activeCompanies().map((c) => ({ l: c.name, v: spend(inMonth(S.expenses.filter((e) => e.company_id === c.id), mkey)), dot: c.color })))}</div></section>`;
  } else {
    const byPerson = {}; inM.filter((e) => e.status !== "rejected").forEach((e) => { const n = personById(e.person_id)?.name || "Not set"; byPerson[n] = (byPerson[n] || 0) + num(e.amount); });
    sidePanel = `<section class="panel"><header><h2>Who spent it</h2></header><div class="body">${hbars(Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, v]) => ({ l, v })))}</div></section>`;
  }

  const table = !scoped("expenses").length
    ? emptyHTML("i-wallet", "No expenses yet", "Log every claim, bill and purchase against the right company. Approvers review claims and mark them paid out, and spending is tracked against each company's monthly budgets.", "expenses", "Log the first expense")
    : !rows.length
      ? `<div class="empty"><h3>No expenses match</h3><p>Try another month or clear the filters.</p><button class="btn" data-act="clearExp">Clear filters</button></div>`
      : `${selIds.length && bulk ? `<div class="bulk"><b>${selIds.length} selected</b><span class="grow"></span><button class="btn sm" data-act="bulkExp" data-s="approved">Approve</button><button class="btn sm" data-act="bulkExp" data-s="reimbursed">Mark paid out</button><button class="btn sm danger" data-act="bulkExp" data-s="rejected">Reject</button><button class="btn sm ghost" data-act="clearSel">Clear</button></div>` : ""}
  <div class="tablewrap"><table><thead><tr>${bulk ? `<th style="width:34px"><input type="checkbox" class="cb" data-act="selAll" aria-label="Select all" ${selIds.length && selIds.length === rows.length ? "checked" : ""}></th>` : ""}${sortTh("sort", f, "spent_on", "Date")}${sortTh("sort", f, "title", "Expense")}${all ? sortTh("sort", f, "company", "Company", "hide-m") : ""}${sortTh("sort", f, "category", "Category", "hide-m")}${sortTh("sort", f, "person", "Spent by", "hide-m")}<th class="hide-m">Paid with</th>${sortTh("sort", f, "status", "Status")}${sortTh("sort", f, "amount", "Amount", "r")}</tr></thead><tbody>
  ${rows.map((e) => { const p = personById(e.person_id); return `<tr data-act="open" data-mod="expenses" data-id="${esc(e.id)}" class="${f.sel.has(e.id) ? "sel" : ""}">${bulk ? `<td data-stop="1"><input type="checkbox" class="cb" data-act="selOne" data-id="${esc(e.id)}" aria-label="Select" ${f.sel.has(e.id) ? "checked" : ""}></td>` : ""}<td class="mono" style="white-space:nowrap">${esc(fdate(e.spent_on))}</td><td><div class="t1">${esc(e.title)}${e.receipt_path ? ` <span title="Receipt attached" style="color:var(--muted)">${icon("i-clip")}</span>` : ""}</div><div class="t2">${esc(e.vendor || "")}${e.reference ? ` · <span class="mono">${esc(e.reference)}</span>` : ""}</div></td>${all ? `<td class="hide-m">${coChip(e.company_id)}</td>` : ""}<td class="hide-m">${esc(e.category || "—")}</td><td class="hide-m"><div class="who">${avatar(p)}<span>${esc(p ? p.name : "—")}</span></div></td><td class="hide-m">${esc(e.method || "—")}</td><td>${chip(EXP_STATUS, e.status)}</td><td class="r num" style="font-weight:600;${e.status === "rejected" ? "text-decoration:line-through;color:var(--faint)" : ""}">${esc(money(e.amount))}</td></tr>`; }).join("")}
  </tbody></table></div>`;

  return `${scopeNote}
  <div class="grid g-kpi">
    ${kpi(`Total (${rows.length})`, esc(money(total)), `${esc(f.month ? monthLabel(f.month) : "All time")}, excluding rejected`)}
    ${kpi("Pending", esc(money(sum("pending"))), "waiting for approval", "var(--warn)")}
    ${kpi("Approved", esc(money(sum("approved"))), "approved, not yet paid out", "var(--info)")}
    ${kpi("Paid out", esc(money(sum("reimbursed"))), "reimbursed or settled", "var(--good)")}
  </div>
  <div class="toolbar">
    <input class="inp search" id="expQ" placeholder="Search title, vendor, receipt no." value="${esc(f.q)}" aria-label="Search expenses">
    ${sel("expMonth", "Month", f.month, monthOpts, "All months")}
    ${sel("expCat", "Category", f.cat, cats, "All categories")}
    ${sel("expStatus", "Status", f.status, EXP_STATUS, "Any status")}
    ${can.seeAllExpenses() ? sel("expPerson", "Person", f.person, scoped("people").map((p) => ({ v: p.id, l: p.name })), "Everyone") : ""}
    <span class="grow"></span>
    ${exportBtn("expenses", rows.length)}
    ${can.create("expenses") ? `<button class="btn pri" data-act="new" data-mod="expenses">${icon("i-plus")}Log expense</button>` : ""}
  </div>
  <section class="panel">${table}</section>
  ${scoped("expenses").length ? `<div class="grid g-2">${budPanel}${sidePanel}</div>` : ""}`;
}

// ---------- Tasks ----------
function taskMatches(t) {
  const f = U.task;
  if (f.person && t.assignee_id !== f.person) return false;
  if (f.project && (t.project || "") !== f.project) return false;
  if (f.prio && t.priority !== f.prio) return false;
  if (f.q) { const q = f.q.toLowerCase(); if (![t.title, t.description, t.project, personById(t.assignee_id)?.name].some((x) => String(x || "").toLowerCase().includes(q))) return false; }
  return true;
}
function taskCard(t) {
  const p = personById(t.assignee_id); const pr = opt(PRIOS, t.priority); const d = daysFrom(t.due);
  const cl = Array.isArray(t.checklist) ? t.checklist : []; const done = cl.filter((c) => c.done).length;
  const late = t.status !== "done" && d != null && d < 0, soon = t.status !== "done" && d != null && d <= 2;
  return `<article class="card" draggable="${can.has("tasks.edit")}" data-act="open" data-mod="tasks" data-id="${esc(t.id)}" style="flex-direction:row;gap:9px"><span class="prio" style="background:${pr.col}" title="${esc(pr.l)} priority"></span><div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px">
    <div class="ttl">${esc(t.title)}</div>
    <div class="meta">${coChip(t.company_id)}${t.project && t.project !== "General" ? `<span class="chip nodot c-acc">${esc(t.project)}</span>` : ""}${pr.w >= 3 ? `<span class="chip ${pr.c}">${esc(pr.l)}</span>` : ""}${cl.length ? `<span class="mono" title="Checklist">☑ ${done}/${cl.length}</span>` : ""}</div>
    <div class="meta">${p ? `<span class="who">${avatar(p)}<span>${esc(p.name)}</span></span>` : `<span>Unassigned</span>`}<span class="grow"></span>${t.due ? `<span class="due ${late ? "late" : soon ? "soon" : ""}">${late ? `${-d}d late` : d === 0 ? "Today" : esc(fdate(t.due))}</span>` : ""}</div>
  </div></article>`;
}
export function vTasks() {
  const f = U.task; const all = scoped("tasks"); const rows = all.filter(taskMatches);
  const projs = [...new Set([...projects(U.company), ...all.map((t) => t.project).filter(Boolean)])];
  const op = openTasks(), od = overdue();
  const doneWeek = all.filter((t) => t.status === "done" && t.done_at && Date.now() - new Date(t.done_at) < 7 * 864e5).length;
  const head = `<div class="grid g-kpi">
    ${kpi("Open", op.length, `${all.filter((t) => t.status === "doing").length} in progress · ${all.filter((t) => t.status === "review").length} in review`)}
    ${kpi("Overdue", od.length, od.length ? "past their due date" : "everything on time", od.length ? "var(--bad)" : "")}
    ${kpi("Done this week", doneWeek, `${all.filter((t) => t.status === "done").length} done in total`, "var(--good)")}
    ${kpi("Urgent", op.filter((t) => t.priority === "urgent").length, `${op.filter((t) => t.priority === "high").length} high priority`)}
  </div>
  <div class="toolbar">
    <input class="inp search" id="taskQ" placeholder="Search tasks" value="${esc(f.q)}" aria-label="Search tasks">
    ${sel("taskPerson", "Owner", f.person, scoped("people").map((p) => ({ v: p.id, l: p.name })), "Everyone")}
    ${sel("taskProject", "Project", f.project, projs, "All projects")}
    ${sel("taskPrio", "Priority", f.prio, PRIOS, "Any priority")}
    <span class="grow"></span>
    ${seg("taskView", f.view, [["board", "i-board", "Board"], ["list", "i-list", "List"]])}
    ${can.create("tasks") ? `<button class="btn pri" data-act="new" data-mod="tasks">${icon("i-plus")}New task</button>` : ""}
  </div>`;
  if (!all.length) return head + `<section class="panel">${emptyHTML("i-check", "No tasks yet", "Plan each company's work on a board. Give every task an owner, a due date and a checklist, then drag it from To do to Done.", "tasks", "Create the first task")}</section>`;
  if (f.view === "board") {
    return head + `<div class="board" id="board">${TASK_STATUS.map((s) => {
      const list = rows.filter((t) => (t.status || "todo") === s.v).sort(taskSort);
      return `<section class="col" data-col="${s.v}" aria-label="${esc(s.l)}"><header><span class="chip ${s.c || ""}">${esc(s.l)}</span><span class="n">${list.length}</span><span class="grow"></span>${can.create("tasks") ? `<button class="btn ghost sm" data-act="new" data-mod="tasks" data-status="${s.v}" aria-label="Add to ${esc(s.l)}">${icon("i-plus")}</button>` : ""}</header>${list.map(taskCard).join("") || `<div style="color:var(--faint);font-size:12px;padding:8px 4px">${can.has("tasks.edit") ? "Drop tasks here" : "Nothing here"}</div>`}</section>`;
    }).join("")}</div>`;
  }
  const list = rows.slice().sort((a, b) => TASK_STATUS.findIndex((s) => s.v === a.status) - TASK_STATUS.findIndex((s) => s.v === b.status) || taskSort(a, b));
  return head + `<section class="panel">${list.length ? `<div class="tablewrap"><table><thead><tr><th>Task</th><th>Status</th><th class="hide-m">Priority</th><th class="hide-m">Owner</th><th>Due</th></tr></thead><tbody>${list.map((t) => { const p = personById(t.assignee_id); const d = daysFrom(t.due); const cl = Array.isArray(t.checklist) ? t.checklist : []; return `<tr data-act="open" data-mod="tasks" data-id="${esc(t.id)}"><td><div class="t1" style="${t.status === "done" ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(t.title)}</div><div class="t2">${coChip(t.company_id)} ${esc(t.project || "")}${cl.length ? ` · ${cl.filter((c) => c.done).length}/${cl.length} steps` : ""}</div></td><td>${chip(TASK_STATUS, t.status || "todo")}</td><td class="hide-m">${chip(PRIOS, t.priority || "medium")}</td><td class="hide-m"><div class="who">${avatar(p)}<span>${esc(p ? p.name : "Unassigned")}</span></div></td><td class="mono"><span class="due ${t.status !== "done" && d != null && d < 0 ? "late" : ""}">${t.due ? esc(fdate(t.due)) : "—"}</span></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty"><h3>No tasks match</h3><p>Clear the filters to see everything.</p><button class="btn" data-act="clearTask">Clear filters</button></div>`}</section>`;
}

// ---------- Products ----------
export function vProducts() {
  const f = U.prod; const allP = scoped("products"); const all = !U.company;
  let rows = allP.filter((p) => (!f.cat || p.category === f.cat) && (!f.status || p.status === f.status) && (!f.low || (num(p.stock) <= num(p.reorder_level) && live(p))));
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((p) => [p.name, p.sku, p.category, p.supplier, p.description, companyById(p.company_id)?.name].some((x) => String(x || "").toLowerCase().includes(q))); }
  const k = f.sort;
  rows.sort((a, b) => {
    let x, y;
    if (k === "margin") { x = margin(a); y = margin(b); }
    else if (["price", "cost", "stock"].includes(k)) { x = num(a[k]); y = num(b[k]); }
    else if (k === "value") { x = num(a.stock) * num(a.cost); y = num(b.stock) * num(b.cost); }
    else if (k === "company") { x = companyById(a.company_id)?.name || ""; y = companyById(b.company_id)?.name || ""; }
    else { x = String(a[k] || "").toLowerCase(); y = String(b[k] || "").toLowerCase(); }
    return (x > y ? 1 : x < y ? -1 : 0) * f.dir;
  });
  const pcats = [...new Set([...productCats(U.company), ...allP.map((p) => p.category).filter(Boolean)])];
  const act = allP.filter((p) => p.status === "active"); const avgM = act.length ? act.reduce((a, p) => a + margin(p), 0) / act.length : 0;
  const ls = lowStock();
  const head = `<div class="grid g-kpi">
    ${kpi("Products", allP.length, `${act.length} active · ${allP.filter((p) => p.status === "draft").length} draft`)}
    ${kpi("Stock at cost", esc(compact(invValue())), `${esc(compact(retailValue()))} at selling price`)}
    ${kpi("Average margin", `${Math.round(avgM * 100)}%`, "across active products")}
    ${kpi("Low on stock", ls.length, `${ls.filter((p) => num(p.stock) <= 0).length} out of stock`, ls.length ? "var(--warn)" : "")}
  </div>
  <div class="toolbar">
    <input class="inp search" id="prodQ" placeholder="Search name, SKU, supplier" value="${esc(f.q)}" aria-label="Search products">
    ${sel("prodCat", "Category", f.cat, pcats, "All categories")}
    ${sel("prodStatus", "Status", f.status, PROD_STATUS, "Any status")}
    <button class="btn ${f.low ? "pri" : ""}" data-act="prodLow" aria-pressed="${f.low}">${icon("i-alert")}Low stock</button>
    <span class="grow"></span>
    ${seg("prodView", f.view, [["table", "i-list", "Table"], ["grid", "i-grid", "Cards"]])}
    ${exportBtn("products", rows.length)}
    ${can.create("products") ? `<button class="btn pri" data-act="new" data-mod="products">${icon("i-plus")}Add product</button>` : ""}
  </div>`;
  if (!allP.length) return head + `<section class="panel">${emptyHTML("i-box", "No products yet", `Keep ${U.company ? esc(scopeName()) + "'s" : "each company's"} catalogue here with SKU, selling price, cost and stock. aamaritoaid works out margins and stock value, records every stock movement, and flags anything at its reorder level.`, "products", "Add the first product")}</section>`;
  if (!rows.length) return head + `<section class="panel"><div class="empty"><h3>No products match</h3><p>Clear the filters to see the full catalogue.</p><button class="btn" data-act="clearProd">Clear filters</button></div></section>`;
  const stepper = (p) => can.has("products.edit")
    ? `<span class="stepper" data-stop="1"><button data-act="stock" data-id="${esc(p.id)}" data-d="-1" aria-label="Remove one">−</button><span>${esc(qty(p.stock))}</span><button data-act="stock" data-id="${esc(p.id)}" data-d="1" aria-label="Add one">+</button></span>`
    : `<span class="mono">${esc(qty(p.stock))}</span>`;
  const stockChip = (p) => !live(p) ? "" : num(p.stock) <= 0 ? `<span class="chip c-bad">Out</span>` : num(p.stock) <= num(p.reorder_level) ? `<span class="chip c-warn">Low</span>` : "";
  if (f.view === "grid") {
    return head + `<div class="pgrid">${rows.map((p) => `<article class="tile" data-act="open" data-mod="products" data-id="${esc(p.id)}"><div class="row"><div class="grow"><h3>${esc(p.name)}</h3><div class="mono" style="color:var(--muted);font-size:12px">${esc(p.sku || "No SKU")}</div></div>${chip(PROD_STATUS, p.status || "active")}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${coChip(p.company_id)}${p.category ? `<span class="chip nodot">${esc(p.category)}</span>` : ""}</div>
      <dl class="kv"><dt>Price</dt><dd>${esc(money(p.price))}</dd><dt>Cost</dt><dd>${esc(money(p.cost))}</dd><dt>Margin</dt><dd>${Math.round(margin(p) * 100)}%</dd><dt>Value</dt><dd>${esc(compact(num(p.stock) * num(p.cost)))}</dd></dl>
      <div class="row"><span style="color:var(--muted);font-size:12px">Stock (${esc(p.unit || "pcs")})</span>${stockChip(p)}<span class="grow"></span>${stepper(p)}</div></article>`).join("")}</div>`;
  }
  return head + `<section class="panel"><div class="tablewrap"><table><thead><tr>${sortTh("psort", f, "name", "Product")}${all ? sortTh("psort", f, "company", "Company", "hide-m") : ""}${sortTh("psort", f, "category", "Category", "hide-m")}${sortTh("psort", f, "price", "Price", "r")}${sortTh("psort", f, "cost", "Cost", "r hide-m")}${sortTh("psort", f, "margin", "Margin", "r hide-m")}${sortTh("psort", f, "stock", "Stock", "r")}${sortTh("psort", f, "value", "Stock value", "r hide-m")}<th class="hide-m">Status</th></tr></thead><tbody>
  ${rows.map((p) => `<tr data-act="open" data-mod="products" data-id="${esc(p.id)}"><td><div class="t1">${esc(p.name)}</div><div class="t2 mono">${esc(p.sku || "No SKU")}${p.supplier ? ` · <span style="font-family:var(--f-body)">${esc(p.supplier)}</span>` : ""}</div></td>${all ? `<td class="hide-m">${coChip(p.company_id)}</td>` : ""}<td class="hide-m">${esc(p.category || "—")}</td><td class="r num">${esc(money(p.price))}</td><td class="r num hide-m">${esc(money(p.cost))}</td><td class="r num hide-m" style="color:${margin(p) < 0.1 ? "var(--bad)" : margin(p) < 0.25 ? "var(--warn)" : "inherit"}">${Math.round(margin(p) * 100)}%</td><td class="r"><div style="display:inline-flex;gap:6px;align-items:center">${stockChip(p)}${stepper(p)}</div></td><td class="r num hide-m">${esc(money(num(p.stock) * num(p.cost)))}</td><td class="hide-m">${chip(PROD_STATUS, p.status || "active")}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}

// ---------- People ----------
export function vPeople() {
  const f = U.ppl; const allP = scoped("people");
  let rows = allP.filter((p) => (!f.dept || p.department === f.dept) && (!f.status || p.status === f.status));
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((p) => [p.name, p.role_title, p.department, p.email, p.phone, p.location].some((x) => String(x || "").toLowerCase().includes(q))); }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const depts = [...new Set([...wsList("departments"), ...allP.map((p) => p.department).filter(Boolean)])];
  const act = allP.filter((p) => p.status === "active");
  const payroll = act.reduce((a, p) => a + num(S.salaries[p.id]?.salary), 0);
  const newest = allP.filter((p) => p.joined && daysFrom(p.joined) > -90 && daysFrom(p.joined) <= 0).length;
  const load = (p) => openTasks().filter((t) => t.assignee_id === p.id).length;
  const head = `<div class="grid g-kpi">
    ${kpi("Active", act.length, `${allP.filter((p) => p.status === "leave").length} on leave · ${allP.filter((p) => p.status === "inactive").length} left`)}
    ${kpi("Departments", new Set(act.map((p) => p.department).filter(Boolean)).size, "with active people")}
    ${kpi("Joined in 90 days", newest, "recent joiners")}
    ${can.hr() ? kpi("Monthly payroll", payroll ? esc(compact(payroll)) : "—", payroll ? "active people with a salary set" : "add salaries to see payroll") : kpi("Open tasks", openTasks().length, "across the team")}
  </div>
  <div class="toolbar">
    <input class="inp search" id="pplQ" placeholder="Search name, role, phone" value="${esc(f.q)}" aria-label="Search people">
    ${sel("pplDept", "Department", f.dept, depts, "All departments")}
    ${sel("pplStatus", "Status", f.status, PEOPLE_STATUS, "Any status")}
    <span class="grow"></span>
    ${seg("pplView", f.view, [["cards", "i-grid", "Cards"], ["table", "i-list", "Table"]])}
    ${exportBtn("people", rows.length)}
    ${can.create("people") ? `<button class="btn pri" data-act="new" data-mod="people">${icon("i-plus")}Add person</button>` : ""}
  </div>`;
  if (!allP.length) return head + `<section class="panel">${emptyHTML("i-users", "No people yet", can.create("people") ? "Add the people across the group with their company, role, department, contact details and status. They become the owners of tasks and the names on expense claims." : "No one has been added to the team directory yet.", "people", "Add the first person")}</section>`;
  if (!rows.length) return head + `<section class="panel"><div class="empty"><h3>No one matches</h3><p>Clear the filters to see everyone.</p><button class="btn" data-act="clearPpl">Clear filters</button></div></section>`;
  const deptPanel = `<section class="panel"><header><h2>Team by department</h2></header><div class="body">${hbars(depts.map((d) => ({ l: d, v: act.filter((p) => p.department === d).length })).filter((r) => r.v).sort((a, b) => b.v - a.v), { fmt: String })}</div></section>`;
  const sidePanel = !U.company && activeCompanies().length > 1
    ? `<section class="panel"><header><h2>Team by company</h2></header><div class="body">${hbars([...activeCompanies().map((c) => ({ l: c.name, v: act.filter((p) => p.company_id === c.id).length, dot: c.color })), { l: "Whole group", v: act.filter((p) => !p.company_id).length }].filter((r) => r.v), { fmt: String })}</div></section>`
    : `<section class="panel"><header><h2>Open tasks per person</h2></header><div class="body">${hbars(act.map((p) => ({ l: p.name, v: load(p) })).filter((r) => r.v).sort((a, b) => b.v - a.v).slice(0, 8), { fmt: String })}</div></section>`;
  const body = f.view === "cards"
    ? `<div class="pgrid">${rows.map((p) => `<article class="tile" data-act="open" data-mod="people" data-id="${esc(p.id)}"><div class="row">${avatar(p, "lg")}<div class="grow"><h3>${esc(p.name)}</h3><div style="color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.role_title || "No role set")}</div></div></div>
      <div class="row" style="flex-wrap:wrap">${coChip(p.company_id, true)}${p.department ? `<span class="chip nodot c-acc">${esc(p.department)}</span>` : ""}${chip(PEOPLE_STATUS, p.status || "active")}</div>
      <dl class="kv"><dt>Open tasks</dt><dd>${load(p)}</dd><dt>Joined</dt><dd>${esc(p.joined ? fdate(p.joined) : "—")}</dd></dl>
      ${p.phone || p.email ? `<div style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="mono">${esc(p.phone || p.email)}</div>` : ""}</article>`).join("")}</div>`
    : `<section class="panel"><div class="tablewrap"><table><thead><tr><th>Name</th><th class="hide-m">Company</th><th class="hide-m">Department</th><th>Status</th><th class="hide-m">Phone</th><th class="r">Open tasks</th></tr></thead><tbody>${rows.map((p) => `<tr data-act="open" data-mod="people" data-id="${esc(p.id)}"><td><div class="who">${avatar(p)}<div style="min-width:0"><div class="t1">${esc(p.name)}</div><div class="t2">${esc(p.role_title || "")}</div></div></div></td><td class="hide-m">${coChip(p.company_id, true)}</td><td class="hide-m">${esc(p.department || "—")}</td><td>${chip(PEOPLE_STATUS, p.status || "active")}</td><td class="hide-m mono">${esc(p.phone || "—")}</td><td class="r num">${load(p)}</td></tr>`).join("")}</tbody></table></div></section>`;
  return head + body + `<div class="grid g-2">${deptPanel}${sidePanel}</div>`;
}

// ---------- Companies ----------
export function vCompanies() {
  if (!can.settings()) return noAccess();
  const list = S.companies.slice().sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(b.name));
  const mk = monthKey(new Date());
  return `<div class="toolbar"><p style="margin:0;color:var(--muted);max-width:70ch">Each company keeps its own expense categories, monthly budgets, product categories and projects. Click a company to edit it.</p><span class="grow"></span>${can.create("companies") ? `<button class="btn pri" data-act="new" data-mod="companies">${icon("i-plus")}Add company</button>` : ""}</div>
  <div class="co-grid lg">${list.map((c) => {
    const ex = S.expenses.filter((e) => e.company_id === c.id); const pr = S.products.filter((p) => p.company_id === c.id);
    const ppl = S.people.filter((p) => p.company_id === c.id && p.status === "active");
    const b = Object.values(c.budgets || {}).reduce((a, v) => a + num(v), 0);
    return `<button class="co-card" data-act="open" data-mod="companies" data-id="${esc(c.id)}" style="--co:${esc(c.color)}">
      <span class="co-name">${esc(c.name)}${c.is_parent ? ` <span class="chip nodot">Mother company</span>` : ""}${!c.active ? ` <span class="chip nodot c-bad">Archived</span>` : ""}</span>
      <span class="co-ind">${esc(c.industry || "No industry set")}</span>
      <span class="co-stats"><span><b>${esc(compact(spend(inMonth(ex, mk))))}</b>spent this month</span><span><b>${b ? esc(compact(b)) : "—"}</b>monthly budget</span><span><b>${pr.length}</b>products</span><span><b>${ppl.length}</b>people</span></span>
      <span class="co-tags"><b>Expense categories</b> ${(c.expense_categories || []).map((x) => `<span class="chip nodot">${esc(x)}</span>`).join("")}</span>
      <span class="co-tags"><b>Product categories</b> ${(c.product_categories || []).map((x) => `<span class="chip nodot">${esc(x)}</span>`).join("")}</span>
    </button>`;
  }).join("")}</div>`;
}

// ---------- Users & access ----------
const accessSummary = (p) => {
  if (p.role === "admin") return "All companies";
  const ids = p.company_ids || [];
  if (!ids.length) return "All companies";
  return ids.map((id) => companyById(id)?.name).filter(Boolean).join(", ") || "No companies";
};
export function vMembers() {
  if (!can.users()) return noAccess();
  const q = U.mem.q.toLowerCase();
  const all = S.profiles.filter((p) => !q || [p.full_name, p.email].some((x) => String(x || "").toLowerCase().includes(q)));
  const waiting = all.filter((p) => p.role === "pending" && p.active);
  const rest = all.filter((p) => !(p.role === "pending" && p.active)).sort((a, b) => (b.active - a.active) || String(a.full_name).localeCompare(String(b.full_name)));
  const linked = (id) => S.people.find((x) => x.profile_id === id);
  const counts = S.roles.filter((r) => r.key !== "pending").map((r) => ({ r, n: S.profiles.filter((p) => p.active && p.role === r.key).length }));
  return `<div class="grid g-kpi">${counts.map(({ r, n }) => kpi(r.label, n, esc(r.description || ""))).join("")}${kpi("Waiting", waiting.length, waiting.length ? "need approval" : "no one waiting", waiting.length ? "var(--warn)" : "")}</div>
  ${waiting.length ? `<section class="panel"><header><h2>Waiting for approval</h2><span class="sub">people who signed up</span></header><div class="body"><div class="list">${waiting.map((p) => `<div class="li" style="cursor:default">${avatar({ id: p.id, name: p.full_name || p.email })}<div class="grow"><div>${esc(p.full_name || "No name")}</div><div class="t2">${esc(p.email || "")} · signed up ${esc(relTime(p.created_at))}</div></div><div class="toolbar"><button class="btn sm pri" data-act="openUser" data-id="${esc(p.id)}">Approve…</button><button class="btn sm danger" data-act="declineUser" data-id="${esc(p.id)}">Decline</button></div></div>`).join("")}</div></div></section>` : ""}
  <div class="toolbar"><input class="inp search" id="memQ" placeholder="Search name or email" value="${esc(U.mem.q)}" aria-label="Search users"><span class="grow"></span><span class="lock">${icon("i-shield")}New people sign up at this site's address, then appear here for approval.</span></div>
  <section class="panel"><div class="tablewrap"><table><thead><tr><th>Account</th><th>Role</th><th class="hide-m">Companies</th><th>Access</th><th class="hide-m">Team profile</th></tr></thead><tbody>${rest.map((p) => `<tr data-act="openUser" data-id="${esc(p.id)}"><td><div class="who">${avatar({ id: p.id, name: p.full_name || p.email })}<div style="min-width:0"><div class="t1">${esc(p.full_name || "No name")}${p.id === myId() ? ` <span class="chip nodot c-acc">You</span>` : ""}</div><div class="t2">${esc(p.email || "")}</div></div></div></td><td><span class="chip nodot role-chip">${esc(roleLabel(p.role))}</span></td><td class="hide-m">${esc(accessSummary(p))}</td><td>${p.active ? `<span class="chip c-good">On</span>` : `<span class="chip c-bad">Off</span>`}</td><td class="hide-m">${linked(p.id) ? esc(linked(p.id).name) : `<span style="color:var(--faint)">Not linked</span>`}</td></tr>`).join("") || `<tr><td colspan="5" style="color:var(--muted)">No accounts match.</td></tr>`}</tbody></table></div></section>`;
}

// ---------- Roles & permissions ----------
export function vRoles() {
  if (!can.users()) return noAccess();
  const ed = can.admin();
  const roles = S.roles.slice().sort((a, b) => a.sort - b.sort);
  const holds = (k, p) => k === "admin" || (k !== "pending" && S.rolePerms.some((x) => x.role_key === k && x.perm === p));
  const users = (k) => S.profiles.filter((p) => p.role === k && p.active).length;
  return `${ed ? "" : `<div class="banner info">${icon("i-shield")}<span>Only admins can change roles and permissions. You can see them here.</span></div>`}
  <div class="role-grid">${roles.map((r) => `<div class="role-card${r.system ? " sys" : ""}"><div class="row"><b>${esc(r.label)}</b>${r.system ? `<span class="chip nodot">Built in</span>` : ""}<span class="grow"></span><span class="mono" style="color:var(--muted);font-size:12px">${users(r.key)} ${users(r.key) === 1 ? "person" : "people"}</span></div><p>${esc(r.description || "")}</p>${ed && !r.system ? `<div class="toolbar"><button class="btn sm" data-act="editRole" data-k="${esc(r.key)}">Edit</button><button class="btn sm danger" data-act="delRole" data-k="${esc(r.key)}">Delete</button></div>` : ""}</div>`).join("")}
    ${ed ? `<button class="role-card add" data-act="newRole">${icon("i-plus")}<b>Add a role</b><span>For example Accountant, Store manager or Sales</span></button>` : ""}
  </div>
  <section class="panel"><header><h2>What each role can do</h2><span class="sub">${ed ? "tick a box to give a permission; changes apply straight away" : "read only"}</span></header>
  <div class="tablewrap"><table class="matrix"><thead><tr><th>Permission</th>${roles.map((r) => `<th class="c">${esc(r.label)}</th>`).join("")}</tr></thead><tbody>
  ${PERMS.map((g) => `<tr class="grp"><td colspan="${roles.length + 1}">${esc(g.group)}</td></tr>${g.items.map((it) => `<tr><td>${esc(it.l)}</td>${roles.map((r) => {
    const locked = !ed || r.system;
    const on = holds(r.key, it.k);
    return `<td class="c"><input type="checkbox" class="cb" data-act="perm" data-r="${esc(r.key)}" data-p="${esc(it.k)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="${esc(r.label)}: ${esc(it.l)}"></td>`;
  }).join("")}</tr>`).join("")}`).join("")}
  </tbody></table></div>
  <div class="body" style="padding-top:0"><p style="margin:12px 0 0;color:var(--muted);font-size:12px">Admin always has every permission and Waiting has none; those two can't be changed. Only admins can give someone the Admin role. Company limits are set per person under Users & access.</p></div></section>`;
}

// ---------- Settings (group-wide options) ----------
function listEditor(key, label, hint) {
  const items = S.ws[key] || []; const ed = can.settings();
  return `<section class="panel"><header><h2>${esc(label)}</h2><span class="sub">${esc(hint)}</span></header><div class="body" style="display:flex;flex-direction:column;gap:10px">
    <div class="tags">${items.map((c, i) => `<span class="tag">${esc(c)}${ed ? `<button data-act="wsDel" data-k="${key}" data-i="${i}" aria-label="Remove ${esc(c)}">${icon("i-x")}</button>` : ""}</span>`).join("") || `<span style="color:var(--muted)">None yet</span>`}</div>
    ${ed ? `<form class="toolbar" data-form="wsAdd" data-k="${key}"><input class="inp" id="wsAdd_${key}" placeholder="Add to ${esc(label.toLowerCase())}" aria-label="New item for ${esc(label)}" style="flex:1;min-width:0"><button class="btn" type="submit">${icon("i-plus")}Add</button></form>` : ""}
  </div></section>`;
}
export function vWorkspace() {
  const ed = can.settings(); const dis = ed ? "" : "disabled";
  return `<div class="grid g-2">
    <section class="panel"><header><h2>Group</h2><span class="sub">shared by every company</span></header><div class="body"><form class="form" data-form="wsBasics">
      <div class="fld half"><label for="wsCompany">Group name</label><input class="inp" id="wsCompany" value="${esc(S.ws.company || "")}" ${dis}></div>
      <div class="fld half"><label for="wsCurrency">Currency symbol</label><input class="inp" id="wsCurrency" value="${esc(S.ws.currency || "৳")}" maxlength="4" ${dis}></div>
      ${ed ? `<div class="fld"><button class="btn pri" type="submit" style="align-self:flex-start">Save</button></div>` : ""}
    </form>${ed ? `<p style="margin:12px 0 0;color:var(--muted);font-size:13px">Company-specific options (expense and product categories, budgets, projects) are under <a href="#companies">Companies</a>.</p>` : ""}</div></section>
    <section class="panel"><header><h2>Your account</h2></header><div class="body" style="display:flex;flex-direction:column;gap:10px">
      <div class="who">${avatar({ id: myId(), name: session.profile?.full_name || session.user?.email })}<div style="min-width:0"><div class="t1">${esc(session.profile?.full_name || "You")}</div><div style="color:var(--muted);font-size:12px">${esc(session.user?.email || "")}</div></div><span class="grow"></span><span class="chip nodot role-chip">${esc(roleLabel(role()))}</span></div>
      <div style="color:var(--muted);font-size:13px">Companies: ${esc(accessSummary(session.profile || {}))}</div>
      <div class="toolbar"><button class="btn" data-act="account">Edit name or password</button><button class="btn" data-act="signOut">${icon("i-out")}Sign out</button></div>
    </div></section>
  </div>
  ${adminLinks()}
  <div class="grid g-2">
    ${listEditor("departments", "Departments", "used in People")}
    ${listEditor("payment_methods", "Payment methods", "used in Expenses")}
    ${listEditor("units", "Units", "used in Products")}
    ${listEditor("employment_types", "Employment types", "used in People")}
  </div>`;
}

function adminLinks() {
  const links = [
    can.settings() && ["companies", "i-building", "Companies", "Categories, budgets and projects"],
    can.users() && ["members", "i-shield", "Users & access", "Approve sign-ups, roles and companies"],
    can.users() && ["roles", "i-key", "Roles & permissions", "What each role can do"],
  ].filter(Boolean);
  return links.length ? `<section class="panel"><header><h2>Administration</h2></header><div class="body"><div class="admin-links">${links.map(([h, ic, t, d]) => `<a href="#${h}">${icon(ic)}<span>${esc(t)}<small>${esc(d)}</small></span></a>`).join("")}</div></div></section>` : "";
}
function noAccess() {
  return `<section class="panel"><div class="empty"><div class="glyph">${icon("i-shield")}</div><h3>You don't have access to this page</h3><p>Ask an admin if you need it.</p></div></section>`;
}

export const VIEWS = { overview: vOverview, expenses: vExpenses, tasks: vTasks, products: vProducts, people: vPeople, companies: vCompanies, members: vMembers, roles: vRoles, workspace: vWorkspace };
export { ROUTES, NOUN };
