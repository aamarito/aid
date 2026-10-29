// aamaritoaid — app entry point
import { initClient, sb } from "./lib/supabase.js";
import { S, U, ROUTES, NOUN, TASK_STATUS, EXP_STATUS, PROD_STATUS, PEOPLE_STATUS, ROLES, session, role, can, myId } from "./state.js";
import { $, $$, esc, icon, toast, num, opt, money, qty, today, downloadFile } from "./util.js";
import * as data from "./data.js";
import * as auth from "./auth.js";
import { VIEWS, personById, openTasks, lowStock, pendingUsers, filteredExpenses, margin } from "./views.js";
import * as drawer from "./drawer.js";

// ---------------------------------------------------------------- render
function visibleRoutes() { return ROUTES.filter((r) => !r.admin || can.admin()); }

function navHTML(mobile) {
  const counts = {
    expenses: can.approve() ? S.expenses.filter((e) => e.status === "pending").length : 0,
    tasks: openTasks().length,
    products: lowStock().length,
    people: S.people.filter((p) => p.status !== "inactive").length,
    members: pendingUsers().length,
  };
  const hot = { expenses: 1, products: 1, members: 1 };
  const tips = { expenses: "Waiting for your approval", tasks: "Open tasks", products: "Low on stock", people: "Active people", members: "Waiting for access" };
  return visibleRoutes().map((r) => {
    const c = counts[r.id]; const cur = U.route === r.id ? ' aria-current="page"' : "";
    if (mobile) return `<a href="#${r.id}"${cur}>${icon(r.icon)}<span>${esc(r.short || r.label)}</span></a>`;
    return `${r.sep ? '<div class="sep"></div>' : ""}<a href="#${r.id}"${cur}>${icon(r.icon)}<span>${esc(r.label)}</span>${c ? `<span class="cnt${hot[r.id] ? " hot" : ""}" title="${tips[r.id]}">${c}</span>` : ""}</a>`;
  }).join("");
}

function renderChrome() {
  $("#nav").innerHTML = navHTML(false);
  $("#bnav").innerHTML = navHTML(true);
  $("#coName").textContent = S.ws.company && S.ws.company !== "aamaritoaid" ? S.ws.company : "Team workspace";
  $("#crumb").textContent = S.ws.company || "aamaritoaid";
  const r = ROUTES.find((x) => x.id === U.route) || ROUTES[0];
  $("#pageTitle").textContent = r.label;
  document.title = `${r.label} · ${S.ws.company || "aamaritoaid"}`;
  const creatable = ["expenses", "tasks", "products", "people"].filter((m) => can.create(m));
  $("#newBtn").parentElement.hidden = !creatable.length;
  $("#newMenu").innerHTML = creatable.map((m) => `<button role="menuitem" data-act="new" data-mod="${m}">${icon({ expenses: "i-wallet", tasks: "i-check", products: "i-box", people: "i-users" }[m])}${esc(NOUN[m][0].toUpperCase() + NOUN[m].slice(1))}</button>`).join("");
  const p = session.profile || {};
  $("#meBox").innerHTML = `<span class="av" style="background:#2FB4A9" aria-hidden="true">${esc((p.full_name || session.user?.email || "?").trim().slice(0, 1).toUpperCase())}</span><span class="nm"><b>${esc(p.full_name || session.user?.email || "You")}</b><small>${esc(opt(ROLES, role()).l)}</small></span>`;
  const dot = $("#connDot"), txt = $("#connTxt");
  dot.className = "dot " + (S.live === "live" ? "on" : S.live === "offline" ? "off" : "");
  txt.textContent = S.live === "live" ? "Live · synced" : S.live === "offline" ? "Reconnecting…" : "Connecting…";
}

function render() {
  if (!S.loaded) return;
  const active = document.activeElement;
  const aid = active && active.id && $("#view").contains(active) ? active.id : null;
  const caret = aid && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  renderChrome();
  if (!visibleRoutes().some((r) => r.id === U.route)) U.route = "overview";
  $("#view").innerHTML = (VIEWS[U.route] || VIEWS.overview)();
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); if (caret && el.setSelectionRange) try { el.setSelectionRange(caret[0], caret[1]); } catch (e) {} } }
}
let rq = 0;
const schedule = () => { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; render(); }); };

// ---------------------------------------------------------------- boot & auth
let started = false;
let recovering = false;

async function enter() {
  try {
    await data.loadProfile();
  } catch (e) {
    auth.showLoading("Couldn't reach the database. " + data.errText(e));
    return;
  }
  if (!session.profile) {
    // profile row is created by a trigger right after sign-up; give it a moment
    await new Promise((r) => setTimeout(r, 900));
    try { await data.loadProfile(); } catch (e) {}
  }
  if (!can.read()) {
    data.subscribe(onData); // hear when an admin approves us
    auth.showPending(async () => { await data.loadProfile().catch(() => {}); if (can.read()) enter(); else toast("Still waiting for an admin"); });
    return;
  }
  auth.showLoading();
  try {
    await data.loadAll();
  } catch (e) {
    auth.showLoading("Couldn't load your workspace. " + data.errText(e));
    return;
  }
  $("#gate").hidden = true; $("#gate").innerHTML = "";
  $("#app").hidden = false; $("#bnav").hidden = false;
  data.subscribe(onData);
  route();
}

function onData(what) {
  if (what === "access") {
    // our own role or access changed
    if (!can.read()) { S.loaded = false; drawer.closeDrawer(); enter(); return; }
    data.loadAll().then(() => { toast(`Your role is now ${opt(ROLES, role()).l}`); schedule(); }).catch(() => schedule());
    return;
  }
  if (!S.loaded) { if (what === "profiles" && can.read()) enter(); return; }
  schedule();
}

async function boot() {
  const ok = await initClient();
  if (!ok.ok) { auth.showSetup(ok.reason); return; }
  const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
  sb.auth.onAuthStateChange((event, sess) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true; session.user = sess?.user || null;
      auth.showNewPassword(() => { recovering = false; toast("Password updated"); enter(); });
      return;
    }
    if (recovering) return;
    const uid = sess?.user?.id || null;
    if (event === "SIGNED_OUT" || !uid) {
      session.user = null; session.profile = null; S.loaded = false; started = false;
      data.unsubscribe(); drawer.closeDrawer();
      auth.showSignIn();
      return;
    }
    const changed = session.user?.id !== uid;
    session.user = sess.user;
    if (changed || !started) { started = true; setTimeout(enter, 0); }
  });
  const { data: got } = await sb.auth.getSession();
  if (!got.session && !recovering) auth.showSignIn(hashErr ? hashErr.replace(/\+/g, " ") : undefined);
}

// ---------------------------------------------------------------- routing
function route() {
  const h = location.hash.replace("#", "");
  if (/access_token|error_description|type=/.test(h)) return; // auth redirect, handled by Supabase
  if (drawer.ctx) drawer.closeDrawer();
  closePalette();
  U.route = visibleRoutes().some((r) => r.id === h) ? h : "overview";
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- search palette
let palHits = [], palIdx = 0;
function openPalette() { if (!S.loaded) return; $("#palette").classList.add("open"); $("#scrim").classList.add("open"); $("#pq").value = ""; runPalette(); setTimeout(() => $("#pq").focus(), 30); }
function closePalette() { $("#palette").classList.remove("open"); if (!$("#drawer").classList.contains("open")) $("#scrim").classList.remove("open"); }
function runPalette() {
  const q = $("#pq").value.trim().toLowerCase();
  const has = (vals) => vals.some((x) => String(x || "").toLowerCase().includes(q));
  const groups = [
    ["Go to", visibleRoutes().filter((r) => !q || r.label.toLowerCase().includes(q)).map((r) => ({ go: r.id, t: r.label, s: "Page" }))],
    ["Expenses", q ? S.expenses.filter((e) => has([e.title, e.vendor, e.reference, e.category])).slice(0, 5).map((e) => ({ mod: "expenses", id: e.id, t: e.title, s: money(e.amount) })) : []],
    ["Tasks", q ? S.tasks.filter((t) => has([t.title, t.project, t.description])).slice(0, 5).map((t) => ({ mod: "tasks", id: t.id, t: t.title, s: opt(TASK_STATUS, t.status).l })) : []],
    ["Products", q ? S.products.filter((p) => has([p.name, p.sku, p.supplier])).slice(0, 5).map((p) => ({ mod: "products", id: p.id, t: p.name, s: p.sku || "" })) : []],
    ["People", q ? S.people.filter((p) => has([p.name, p.role_title, p.phone, p.email])).slice(0, 5).map((p) => ({ mod: "people", id: p.id, t: p.name, s: p.role_title || "" })) : []],
  ];
  if (!q) groups.push(["Create", ["expenses", "tasks", "products", "people"].filter((m) => can.create(m)).map((m) => ({ newMod: m, t: `New ${NOUN[m]}`, s: "Create" }))]);
  palHits = []; let html = "";
  for (const [g, items] of groups) {
    if (!items.length) continue;
    html += `<div class="grp">${esc(g)}</div>`;
    for (const it of items) { const i = palHits.length; palHits.push(it); html += `<div class="hit" role="option" data-act="palGo" data-i="${i}" aria-selected="${i === 0}">${esc(it.t)}<span class="t2">${esc(it.s)}</span></div>`; }
  }
  if (!palHits.length) html = `<div class="empty" style="padding:20px"><p>Nothing matches “${esc(q)}”.</p></div>`;
  palIdx = 0; $("#pres").innerHTML = html;
}
function palGo(i) {
  const it = palHits[i]; if (!it) return; closePalette();
  if (it.go) location.hash = it.go;
  else if (it.newMod) drawer.openRecord(it.newMod);
  else { if (location.hash !== "#" + it.mod) location.hash = it.mod; setTimeout(() => drawer.openRecord(it.mod, it.id), 40); }
}

// ---------------------------------------------------------------- CSV export
const csvCell = (v) => { v = v == null ? "" : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function exportCSV(mod) {
  let head, rows;
  if (mod === "expenses") {
    head = ["Date", "Expense", "Category", "Vendor", "Spent by", "Paid with", "Status", "Reference", "Amount", "Notes"];
    rows = filteredExpenses().map((e) => [e.spent_on, e.title, e.category, e.vendor, personById(e.person_id)?.name, e.method, opt(EXP_STATUS, e.status).l, e.reference, num(e.amount), e.notes]);
  } else if (mod === "products") {
    head = ["Name", "SKU", "Category", "Price", "Cost", "Margin %", "Stock", "Unit", "Reorder at", "Stock value", "Supplier", "Status"];
    rows = S.products.map((p) => [p.name, p.sku, p.category, num(p.price), num(p.cost), Math.round(margin(p) * 100), num(p.stock), p.unit, num(p.reorder_level), num(p.stock) * num(p.cost), p.supplier, opt(PROD_STATUS, p.status).l]);
  } else {
    head = ["Name", "Role", "Department", "Type", "Status", "Phone", "Email", "Joined", "Reports to", "Location"];
    if (can.admin()) head.push("Monthly salary");
    rows = S.people.map((p) => { const r = [p.name, p.role_title, p.department, p.employment_type, opt(PEOPLE_STATUS, p.status).l, p.phone, p.email, p.joined, personById(p.manager_id)?.name, p.location]; if (can.admin()) r.push(S.salaries[p.id]?.salary ?? ""); return r; });
  }
  downloadFile(`aamaritoaid-${mod}-${today()}.csv`, "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n"));
  toast("CSV downloaded");
}

// ---------------------------------------------------------------- stock stepper (debounced, atomic on the server)
const pendingStock = {};
function stepStock(id, d) {
  const p = S.products.find((x) => x.id === id); if (!p) return;
  const q = pendingStock[id] || (pendingStock[id] = { delta: 0, t: 0 });
  if (num(p.stock) + q.delta + d < 0) { toast("Stock can't go below zero", true); return; }
  q.delta += d;
  const el = document.querySelector(`[data-act=stock][data-id="${CSS.escape(id)}"]`)?.parentElement?.querySelector("span");
  if (el) el.textContent = qty(num(p.stock) + q.delta);
  clearTimeout(q.t);
  q.t = setTimeout(async () => {
    const delta = q.delta; delete pendingStock[id];
    if (!delta) return;
    try { await data.adjustStock(id, delta, delta > 0 ? "Quick add" : "Quick remove"); schedule(); }
    catch (e) { toast(data.errText(e), true); schedule(); }
  }, 700);
}

// ---------------------------------------------------------------- admin: users
async function setUser(id, patch, msg) {
  try { await data.updateProfile(id, patch); toast(msg); schedule(); }
  catch (e) { toast(data.errText(e), true); schedule(); }
}

// ---------------------------------------------------------------- workspace settings
async function saveWs(patch, msg) {
  try { await data.saveWorkspace(patch); toast(msg); schedule(); }
  catch (e) { toast(data.errText(e), true); }
}

// ---------------------------------------------------------------- events
document.addEventListener("click", async (ev) => {
  const menu = $("#newMenu");
  if (!ev.target.closest("#newBtn") && !ev.target.closest("#newMenu")) { menu.hidden = true; $("#newBtn").setAttribute("aria-expanded", "false"); }
  const t = ev.target.closest("[data-act]"); if (!t) return;
  const a = t.dataset.act;
  if (a === "open") { if (ev.target.closest("[data-stop]")) return; drawer.openRecord(t.dataset.mod, t.dataset.id); }
  else if (a === "new") { menu.hidden = true; drawer.openRecord(t.dataset.mod, null, t.dataset.status ? { status: t.dataset.status } : null); }
  else if (a === "closeDrawer") { ev.preventDefault(); drawer.closeDrawer(); }
  else if (a === "askDelete") drawer.askDelete();
  else if (a === "cancelDelete") $("#confirmBox").innerHTML = "";
  else if (a === "doDelete") drawer.doDelete();
  else if (a === "clAdd") drawer.addChecklistItem(t);
  else if (a === "clDel") t.closest(".ci").remove();
  else if (a === "expStatus") drawer.setExpenseStatus(t.dataset.s);
  else if (a === "adjStock") drawer.adjustFromDrawer(Number(t.dataset.d));
  else if (a === "viewReceipt") drawer.viewReceipt();
  else if (a === "dropReceipt") drawer.dropReceipt();
  else if (a === "account") drawer.openAccount();
  else if (a === "signOut") { drawer.closeDrawer(); await sb.auth.signOut(); }
  else if (a === "stock") { ev.stopPropagation(); stepStock(t.dataset.id, Number(t.dataset.d)); }
  else if (a === "sort") { const k = t.dataset.k; if (U.exp.sort === k) U.exp.dir *= -1; else { U.exp.sort = k; U.exp.dir = k === "spent_on" || k === "amount" ? -1 : 1; } render(); }
  else if (a === "psort") { const k = t.dataset.k; if (U.prod.sort === k) U.prod.dir *= -1; else { U.prod.sort = k; U.prod.dir = ["name", "category"].includes(k) ? 1 : -1; } render(); }
  else if (a === "selOne") { ev.stopPropagation(); t.checked ? U.exp.sel.add(t.dataset.id) : U.exp.sel.delete(t.dataset.id); render(); }
  else if (a === "selAll") { const ids = $$("[data-act=selOne]").map((x) => x.dataset.id); if (t.checked) ids.forEach((id) => U.exp.sel.add(id)); else U.exp.sel.clear(); render(); }
  else if (a === "clearSel") { U.exp.sel.clear(); render(); }
  else if (a === "bulkExp") {
    const s = t.dataset.s; let n = 0, fail = 0;
    for (const id of [...U.exp.sel]) {
      const e = S.expenses.find((x) => x.id === id);
      if (!e || e.status === s) continue;
      try { await data.saveRow("expenses", id, { status: s }); n++; } catch (err) { fail++; }
    }
    U.exp.sel.clear(); render();
    toast(`${n} expense${n === 1 ? "" : "s"} marked ${opt(EXP_STATUS, s).l.toLowerCase()}${fail ? `, ${fail} failed` : ""}`, !!fail);
  }
  else if (a === "clearExp") { Object.assign(U.exp, { q: "", month: "", cat: "", status: "", person: "" }); render(); }
  else if (a === "clearTask") { Object.assign(U.task, { q: "", person: "", project: "", prio: "" }); render(); }
  else if (a === "clearProd") { Object.assign(U.prod, { q: "", cat: "", status: "", low: false }); render(); }
  else if (a === "clearPpl") { Object.assign(U.ppl, { q: "", dept: "", status: "" }); render(); }
  else if (a === "taskView") { U.task.view = t.dataset.v; remember(); render(); }
  else if (a === "prodView") { U.prod.view = t.dataset.v; remember(); render(); }
  else if (a === "pplView") { U.ppl.view = t.dataset.v; remember(); render(); }
  else if (a === "prodLow") { U.prod.low = !U.prod.low; render(); }
  else if (a === "csv") exportCSV(t.dataset.mod);
  else if (a === "approveUser") setUser(t.dataset.id, { role: t.dataset.r, active: true }, `Approved as ${t.dataset.r}`);
  else if (a === "declineUser") setUser(t.dataset.id, { active: false }, "Access declined");
  else if (a === "wsDel") {
    const k = t.dataset.k; const arr = [...(S.ws[k] || [])]; const [gone] = arr.splice(Number(t.dataset.i), 1);
    const patch = { [k]: arr };
    if (k === "expense_categories") { const b = { ...(S.ws.budgets || {}) }; delete b[gone]; patch.budgets = b; }
    saveWs(patch, `Removed ${gone}`);
  }
  else if (a === "addCat") {
    const v = $("#newCat").value.trim(); if (!v) return;
    const list = S.ws.expense_categories || [];
    if (list.includes(v)) { toast("That category exists already", true); return; }
    saveWs({ expense_categories: [...list, v] }, `Added ${v}`);
  }
  else if (a === "closePalette") closePalette();
  else if (a === "palGo") palGo(Number(t.dataset.i));
});

document.addEventListener("input", (ev) => {
  const map = { expQ: ["exp", "q"], taskQ: ["task", "q"], prodQ: ["prod", "q"], pplQ: ["ppl", "q"], memQ: ["mem", "q"] };
  const m = map[ev.target.id];
  if (m) { U[m[0]][m[1]] = ev.target.value; schedule(); }
  if (ev.target.id === "pq") runPalette();
});
document.addEventListener("change", (ev) => {
  const t = ev.target; const id = t.id;
  const map = { expMonth: ["exp", "month"], expCat: ["exp", "cat"], expStatus: ["exp", "status"], expPerson: ["exp", "person"], taskPerson: ["task", "person"], taskProject: ["task", "project"], taskPrio: ["task", "prio"], prodCat: ["prod", "cat"], prodStatus: ["prod", "status"], pplDept: ["ppl", "dept"], pplStatus: ["ppl", "status"] };
  if (map[id]) { U[map[id][0]][map[id][1]] = t.value; if (id.startsWith("exp")) U.exp.sel.clear(); render(); return; }
  if (t.dataset.act === "setRole") {
    const p = S.profiles.find((x) => x.id === t.dataset.id);
    setUser(t.dataset.id, { role: t.value }, `${p?.full_name || "User"} is now ${opt(ROLES, t.value).l.toLowerCase()}`);
  } else if (t.dataset.act === "setActive") {
    const p = S.profiles.find((x) => x.id === t.dataset.id);
    setUser(t.dataset.id, { active: t.checked }, `${t.checked ? "Turned on" : "Turned off"} access for ${p?.full_name || "user"}`);
  }
});
document.addEventListener("submit", (ev) => {
  const f = ev.target;
  if (f.closest("#gate")) return; // auth forms handle themselves
  ev.preventDefault();
  if (f.id === "dform") { drawer.submit(); return; }
  const kind = f.dataset.form;
  if (kind === "wsBasics") saveWs({ company: $("#wsCompany").value.trim() || "aamaritoaid", currency: $("#wsCurrency").value.trim() || "৳", members_see_all_expenses: $("#wsSeeAll").checked }, "Workspace saved");
  else if (kind === "wsBudgets") {
    const b = {}; let bad = false;
    (S.ws.expense_categories || []).forEach((c, i) => {
      const raw = $("#bud_" + i).value.replace(/[,\s]/g, ""); if (raw === "") return;
      const n = parseFloat(raw); if (!isFinite(n) || n < 0) { bad = true; return; } b[c] = n;
    });
    if (bad) { toast("Budgets must be positive numbers", true); return; }
    saveWs({ budgets: b }, "Budgets saved");
  } else if (kind === "wsAdd") {
    const k = f.dataset.k; const inp = $("#wsAdd_" + k); const v = inp.value.trim(); if (!v) return;
    const arr = S.ws[k] || []; if (arr.includes(v)) { toast("Already in the list", true); return; }
    saveWs({ [k]: [...arr, v] }, `Added ${v}`);
  }
});

// drag & drop on the task board
let dragId = null;
document.addEventListener("dragstart", (ev) => { const c = ev.target.closest?.(".card"); if (!c || !can.write()) return; dragId = c.dataset.id; c.classList.add("dragging"); ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", dragId); } catch (e) {} });
document.addEventListener("dragend", () => { $$(".card.dragging").forEach((c) => c.classList.remove("dragging")); $$(".col.over").forEach((c) => c.classList.remove("over")); dragId = null; });
document.addEventListener("dragover", (ev) => { const col = ev.target.closest?.(".col"); if (!col || !dragId) return; ev.preventDefault(); $$(".col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); });
document.addEventListener("drop", async (ev) => {
  const col = ev.target.closest?.(".col"); if (!col || !dragId) return; ev.preventDefault(); col.classList.remove("over");
  const id = dragId; dragId = null; const task = S.tasks.find((t) => t.id === id); const s = col.dataset.col;
  if (!task || task.status === s) return;
  const prev = task.status; task.status = s; render(); // optimistic
  try { await data.saveRow("tasks", id, { status: s }); toast(`Moved to ${opt(TASK_STATUS, s).l}`); }
  catch (e) { task.status = prev; render(); toast(data.errText(e), true); }
});

document.addEventListener("keydown", (ev) => {
  if (!S.loaded) return;
  if ((ev.key === "k" || ev.key === "K") && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); openPalette(); return; }
  if (ev.key === "/" && !ev.target.closest("input,textarea,select")) { ev.preventDefault(); openPalette(); return; }
  if (ev.key === "Escape") { if ($("#palette").classList.contains("open")) closePalette(); else if (drawer.ctx) drawer.closeDrawer(); $("#newMenu").hidden = true; return; }
  if ($("#palette").classList.contains("open")) {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault(); palIdx = Math.max(0, Math.min(palHits.length - 1, palIdx + (ev.key === "ArrowDown" ? 1 : -1)));
      $$("#pres .hit").forEach((h, i) => h.setAttribute("aria-selected", i === palIdx)); $$("#pres .hit")[palIdx]?.scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter") { ev.preventDefault(); palGo(palIdx); }
  }
  if (ev.key === "Enter" && ev.target.closest?.(".ci .inp")) { ev.preventDefault(); $("[data-act=clAdd]")?.click(); }
});
$("#scrim").addEventListener("click", () => { closePalette(); drawer.closeDrawer(); });
$("#openSearch").addEventListener("click", openPalette);
$("#newBtn").addEventListener("click", (ev) => { ev.stopPropagation(); const m = $("#newMenu"); m.hidden = !m.hidden; $("#newBtn").setAttribute("aria-expanded", String(!m.hidden)); });
$("#themeBtn").addEventListener("click", () => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("aa-theme", r.dataset.theme); } catch (e) {}
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.loaded) data.refreshIfStale().catch(() => {}); });

function remember() { try { localStorage.setItem("aa-views", JSON.stringify({ t: U.task.view, p: U.prod.view, pp: U.ppl.view })); } catch (e) {} }
try { const v = JSON.parse(localStorage.getItem("aa-views") || "{}"); if (v.t) U.task.view = v.t; if (v.p) U.prod.view = v.p; if (v.pp) U.ppl.view = v.pp; } catch (e) {}

boot();
