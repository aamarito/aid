// The side panel used to create, view and edit records, user access and roles.
import {
  S, U, EXP_STATUS, TASK_STATUS, PRIOS, PROD_STATUS, PEOPLE_STATUS, COMPANY_COLORS,
  NOUN, TITLE_KEY, session, can, myId, role, roleLabel, companyById, activeCompanies,
  expenseCats, productCats, projects, wsList, computePerms,
} from "./state.js";
import { $, $$, esc, icon, toast, compact, num, qty, avatar, chip, opt, today, daysFrom, monthKey, relTime } from "./util.js";
import { personById, openTasks, taskSort, margin, spend, activityLine, actorName, coChip } from "./views.js";
import * as data from "./data.js";
import { sb } from "./lib/supabase.js";

export let ctx = null; // { mod, id }

const defaultCompany = () => U.company || (activeCompanies().length === 1 ? activeCompanies()[0].id : "");

const FIELDS = {
  expenses: () => [
    { k: "company_id", label: "Company", type: "company", req: true },
    { k: "title", label: "What was it for", type: "text", req: true, ph: "Courier charges for Dhaka orders" },
    { k: "amount", label: `Amount (${S.ws.currency || "৳"})`, type: "number", req: true, half: true, min: 0 },
    { k: "spent_on", label: "Date", type: "date", req: true, half: true },
    { k: "category", label: "Category", type: "select", dep: "expense", half: true },
    { k: "method", label: "Paid with", type: "select", opts: wsList("payment_methods"), half: true },
    { k: "vendor", label: "Vendor or payee", type: "text", half: true, ph: "Shop or company" },
    { k: "person_id", label: "Spent by", type: "person", half: true },
    can.approve() && { k: "status", label: "Status", type: "select", opts: EXP_STATUS, half: true },
    { k: "reference", label: "Receipt or reference no.", type: "text", half: can.approve(), ph: "INV-1042" },
    { k: "notes", label: "Notes", type: "textarea" },
  ].filter(Boolean),
  tasks: () => [
    { k: "company_id", label: "Company", type: "company", req: true },
    { k: "title", label: "Task", type: "text", req: true, ph: "Photograph the new wallet range" },
    { k: "status", label: "Status", type: "select", opts: TASK_STATUS, half: true },
    { k: "priority", label: "Priority", type: "select", opts: PRIOS, half: true },
    { k: "assignee_id", label: "Owner", type: "person", half: true },
    { k: "due", label: "Due date", type: "date", half: true },
    { k: "project", label: "Project", type: "select", dep: "project" },
    { k: "description", label: "Details", type: "textarea" },
    { k: "checklist", label: "Checklist", type: "checklist" },
  ],
  products: () => [
    { k: "company_id", label: "Company", type: "company", req: true },
    { k: "name", label: "Product name", type: "text", req: true },
    { k: "sku", label: "SKU", type: "text", half: true, ph: "AMR-0001" },
    { k: "category", label: "Category", type: "select", dep: "product", half: true },
    { k: "price", label: `Selling price (${S.ws.currency || "৳"})`, type: "number", half: true, min: 0 },
    { k: "cost", label: `Unit cost (${S.ws.currency || "৳"})`, type: "number", half: true, min: 0 },
    { k: "stock", label: "Opening stock", type: "number", half: true, min: 0, newOnly: true },
    { k: "reorder_level", label: "Reorder at", type: "number", half: true, min: 0 },
    { k: "unit", label: "Unit", type: "select", opts: wsList("units"), half: true },
    { k: "status", label: "Status", type: "select", opts: PROD_STATUS, half: true },
    { k: "supplier", label: "Supplier", type: "text" },
    { k: "description", label: "Description", type: "textarea" },
  ],
  people: () => [
    { k: "company_id", label: "Company", type: "company", group: true },
    { k: "name", label: "Full name", type: "text", req: true },
    { k: "role_title", label: "Role or title", type: "text", half: true, ph: "Production supervisor" },
    { k: "department", label: "Department", type: "select", opts: wsList("departments"), half: true, blank: true },
    { k: "employment_type", label: "Employment type", type: "select", opts: wsList("employment_types"), half: true },
    { k: "status", label: "Status", type: "select", opts: PEOPLE_STATUS, half: true },
    { k: "phone", label: "Phone", type: "tel", half: true, ph: "01XXXXXXXXX" },
    { k: "email", label: "Email", type: "email", half: true },
    { k: "joined", label: "Joined on", type: "date", half: true },
    { k: "manager_id", label: "Reports to", type: "person", half: true },
    { k: "location", label: "Location", type: "text", ph: "Dhaka office" },
    can.users() && { k: "profile_id", label: "Login account", type: "profile", hint: "Link this person to the account they sign in with" },
    { k: "notes", label: "Notes", type: "textarea" },
  ].filter(Boolean),
  companies: () => [
    { k: "name", label: "Company name", type: "text", req: true, half: true },
    { k: "industry", label: "Industry", type: "text", half: true, ph: "Leather goods" },
    { k: "description", label: "Description", type: "text", ph: "What this company sells" },
    { k: "color", label: "Colour", type: "color", half: true },
    { k: "sort", label: "Order in lists", type: "number", half: true, min: 0 },
    { k: "active", label: "Active (untick to archive)", type: "check", half: true },
    { k: "is_parent", label: "Mother company", type: "check", half: true },
    { k: "expense_categories", label: "Expense categories", type: "lines", hint: "One per line" },
    { k: "budgets", label: "Monthly budget per expense category", type: "budgets" },
    { k: "product_categories", label: "Product categories", type: "lines", hint: "One per line" },
    { k: "projects", label: "Projects", type: "lines", hint: "One per line; used to group tasks" },
  ],
};
const PRIVATE_FIELDS = () => [
  { k: "salary", label: `Monthly salary (${S.ws.currency || "৳"})`, type: "number", half: true, min: 0 },
  { k: "national_id", label: "National ID (NID)", type: "text", half: true },
  { k: "bank_account", label: "Bank or bKash account", type: "text" },
  { k: "private_notes", label: "Private HR notes", type: "textarea" },
];
const DEFAULTS = {
  expenses: () => ({ company_id: defaultCompany(), spent_on: today(), status: "pending", method: wsList("payment_methods")[0], person_id: myPersonId() || "" }),
  tasks: () => ({ company_id: defaultCompany(), status: "todo", priority: "medium", checklist: [] }),
  products: () => ({ company_id: defaultCompany(), status: "active", unit: wsList("units")[0], stock: 0, reorder_level: 5 }),
  people: () => ({ company_id: U.company || null, status: "active", employment_type: wsList("employment_types")[0], department: "" }),
  companies: () => ({ color: COMPANY_COLORS[S.companies.length % COMPANY_COLORS.length], active: true, sort: S.companies.length + 1, expense_categories: ["Office & rent", "Marketing", "Salaries", "Utilities", "Other"], product_categories: ["General"], projects: ["General"], budgets: {} }),
};
export const myPersonId = () => S.people.find((p) => p.profile_id === myId())?.id || null;

// ---------- field rendering ----------
let clSeq = 0;
function clItem(c, ro) {
  const n = ++clSeq;
  return `<div class="ci"><input type="checkbox" class="cb" id="clc_${n}" ${c.done ? "checked" : ""} ${ro ? "disabled" : ""} aria-label="Done"><input class="inp" id="clt_${n}" value="${esc(c.t || "")}" placeholder="Step" ${ro ? "disabled" : ""}>${ro ? "" : `<button type="button" class="btn ghost sm" data-act="clDel" aria-label="Remove step">${icon("i-x")}</button>`}</div>`;
}
export const addChecklistItem = (btn) => { btn.insertAdjacentHTML("beforebegin", clItem({ t: "", done: false }, false)); btn.previousElementSibling.querySelector(".inp").focus(); };

function depOptions(dep, cid) {
  return dep === "expense" ? expenseCats(cid) : dep === "product" ? productCats(cid) : projects(cid);
}
function optionsHTML(list, v, blank) {
  const opts = list.map((o) => (typeof o === "string" ? { v: o, l: o } : o));
  const has = opts.some((o) => o.v === v);
  return `${blank ? `<option value="">${esc(blank)}</option>` : ""}${!has && v ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : ""}${opts.map((o) => `<option value="${esc(o.v)}" ${o.v === v ? "selected" : ""}>${esc(o.l)}</option>`).join("")}`;
}
function budgetsHTML(cats, budgets, ro) {
  if (!cats.length) return `<span style="color:var(--faint)">Add expense categories first</span>`;
  return `<div class="ws-cats">${cats.map((c, i) => `<div class="ws-cat"><span style="font-weight:600;overflow:hidden;text-overflow:ellipsis">${esc(c)}</span><input class="inp num" id="bud_${i}" data-cat="${esc(c)}" inputmode="numeric" placeholder="No budget" value="${budgets?.[c] ? esc(budgets[c]) : ""}" aria-label="Monthly budget for ${esc(c)}" ${ro ? "disabled" : ""}><span></span></div>`).join("")}</div>`;
}

function fieldHTML(f, v, ro, values) {
  const id = "f_" + f.k; const dis = ro ? "disabled" : "";
  let ctl;
  if (f.type === "textarea") ctl = `<textarea class="inp" id="${id}" ${dis} placeholder="${esc(f.ph || "")}">${esc(v || "")}</textarea>`;
  else if (f.type === "lines") ctl = `<textarea class="inp" id="${id}" ${dis} rows="5">${esc((v || []).join("\n"))}</textarea>`;
  else if (f.type === "budgets") ctl = `<div id="${id}">${budgetsHTML(values.expense_categories || [], v || {}, ro)}</div>`;
  else if (f.type === "check") ctl = `<label class="switch"><input type="checkbox" id="${id}" ${v ? "checked" : ""} ${dis}><span>${v ? "Yes" : "No"}</span></label>`;
  else if (f.type === "color") ctl = `<input class="inp" type="color" id="${id}" value="${esc(v || "#0A7670")}" ${dis} style="height:40px;padding:4px">`;
  else if (f.type === "select" && f.dep) ctl = `<select class="sel" id="${id}" data-dep="${f.dep}" ${dis}>${optionsHTML(depOptions(f.dep, values.company_id), v, "Not set")}</select>`;
  else if (f.type === "select") ctl = `<select class="sel" id="${id}" ${dis}>${optionsHTML(f.opts, v, f.blank ? "Not set" : "")}</select>`;
  else if (f.type === "company") {
    const list = activeCompanies().map((c) => ({ v: c.id, l: c.name }));
    if (v && !list.some((o) => o.v === v) && companyById(v)) list.push({ v, l: companyById(v).name + " (archived)" });
    ctl = `<select class="sel" id="${id}" ${dis}>${f.group ? `<option value="">Whole group</option>` : !v ? `<option value="" selected disabled>Choose a company</option>` : ""}${list.map((o) => `<option value="${esc(o.v)}" ${o.v === v ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  } else if (f.type === "person") {
    const self = ctx?.mod === "people" ? ctx.id : null;
    const list = S.people.filter((p) => p.id !== self && (p.status !== "inactive" || p.id === v)).sort((a, b) => String(a.name).localeCompare(b.name));
    ctl = `<select class="sel" id="${id}" ${dis}><option value="">${S.people.length ? "Not set" : "No people added yet"}</option>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === v ? "selected" : ""}>${esc(p.name)}${p.company_id && p.company_id !== values.company_id ? ` · ${esc(companyById(p.company_id)?.name || "")}` : ""}</option>`).join("")}</select>`;
  } else if (f.type === "profile") {
    const taken = new Set(S.people.filter((p) => p.profile_id && p.id !== ctx?.id).map((p) => p.profile_id));
    const list = S.profiles.filter((p) => !taken.has(p.id) || p.id === v);
    ctl = `<select class="sel" id="${id}" ${dis}><option value="">Not linked</option>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === v ? "selected" : ""}>${esc(p.full_name || p.email)}${p.email ? ` (${esc(p.email)})` : ""}</option>`).join("")}</select>`;
  } else if (f.type === "checklist") {
    const items = Array.isArray(v) ? v : [];
    ctl = `<div class="checklist" id="${id}">${items.map((c) => clItem(c, ro)).join("")}${ro ? (items.length ? "" : `<span style="color:var(--faint)">No steps</span>`) : `<button type="button" class="btn sm ghost" data-act="clAdd" style="align-self:flex-start">${icon("i-plus")}Add step</button>`}</div>`;
  } else {
    ctl = `<input class="inp${f.type === "number" ? " num" : ""}" id="${id}" type="${f.type}" ${f.type === "number" ? `step="any" inputmode="decimal"${f.min != null ? ` min="${f.min}"` : ""}` : ""} value="${esc(v ?? "")}" placeholder="${esc(f.ph || "")}" ${dis}>`;
  }
  return `<div class="fld${f.half ? " half" : ""}"><label for="${id}">${esc(f.label)}${f.req ? " *" : ""}</label>${ctl}${f.hint ? `<span style="font-size:12px;color:var(--muted)">${esc(f.hint)}</span>` : ""}<span class="err" id="${id}_err" hidden></span></div>`;
}

/** company changed in a form: refresh category / project choices */
export function companyChanged() {
  const cid = $("#f_company_id")?.value || "";
  $$("#drawer select[data-dep]").forEach((s) => { const v = s.value; s.innerHTML = optionsHTML(depOptions(s.dataset.dep, cid), v, "Not set"); });
}
/** company form: expense categories edited → rebuild the budget grid */
export function categoriesChanged() {
  const box = $("#f_budgets"); if (!box) return;
  const cur = {}; $$("#f_budgets [data-cat]").forEach((i) => { if (i.value) cur[i.dataset.cat] = i.value; });
  const rec = ctx?.id ? S.companies.find((c) => c.id === ctx.id) : null;
  box.innerHTML = budgetsHTML(lines($("#f_expense_categories").value), { ...(rec?.budgets || {}), ...cur }, false);
}
const lines = (t) => [...new Set(String(t || "").split(/\n|,/).map((x) => x.trim()).filter(Boolean))];

function openShell(title, bodyHTML, footHTML, sub) {
  const d = $("#drawer");
  d.innerHTML = `<header><div style="flex:1;min-width:0"><h2 id="drawerTitle">${esc(title)}</h2>${sub ? `<div style="margin-top:4px">${sub}</div>` : ""}</div><button class="btn ghost sm" data-act="closeDrawer" aria-label="Close">${icon("i-x")}</button></header>
  <form class="dbody" id="dform" novalidate>${bodyHTML}<div id="confirmBox"></div></form><footer>${footHTML}</footer>`;
  d.classList.add("open"); d.setAttribute("aria-hidden", "false"); $("#scrim").classList.add("open");
}
export function closeDrawer() {
  $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true");
  if (!$("#palette").classList.contains("open")) $("#scrim").classList.remove("open");
  ctx = null;
}
const footer = (ro, rec, mod, label) => ro
  ? `<span style="color:var(--muted)">View only</span><span class="grow"></span><button type="button" class="btn" data-act="closeDrawer">Close</button>`
  : `${rec && can.remove(mod, rec) ? `<button type="button" class="btn danger" data-act="askDelete">Delete</button>` : ""}<span class="grow"></span><button type="button" class="btn" data-act="closeDrawer">Cancel</button><button type="submit" form="dform" class="btn pri" id="saveBtn">${esc(label)}</button>`;

// ---------- records ----------
export function openRecord(mod, id, preset) {
  const rec = id ? S[mod].find((x) => x.id === id) : null;
  if (id && !rec) { toast("That record was removed", true); return; }
  if (!id && !can.create(mod)) { toast("You don't have permission to add that", true); return; }
  if (!id && mod !== "people" && mod !== "companies" && !activeCompanies().length) { toast("Add a company first under Companies", true); return; }
  ctx = { mod, id: id || null };
  const ro = !can.edit(mod, rec);
  const values = rec ? { ...rec } : { ...DEFAULTS[mod](), ...(preset || {}) };
  const fields = FIELDS[mod]().filter((f) => !(f.newOnly && rec));
  let top = "";
  if (rec && mod === "people") top = personTop(rec);
  if (rec && mod === "products") top = productTop(rec);
  if (mod === "expenses") top = expenseTop(rec);
  let priv = "";
  if (mod === "people" && can.hr()) {
    const pv = rec ? S.salaries[rec.id] || {} : {};
    priv = `<div class="section-t">${icon("i-shield")} Private HR details</div><div class="form">${PRIVATE_FIELDS().map((f) => fieldHTML(f, f.k === "private_notes" ? pv.notes : pv[f.k], false, values)).join("")}</div>`;
  }
  const receipt = mod === "expenses" ? receiptBlock(rec, ro) : "";
  const meta = rec && mod !== "companies" ? `<p style="color:var(--faint);font-size:12px;margin:0">Added by ${esc(actorName(rec.created_by))} ${esc(rec.created_at ? relTime(rec.created_at) : "")}${rec.updated_at && rec.updated_at !== rec.created_at ? ` · last changed ${esc(relTime(rec.updated_at))}` : ""}${rec.approved_by ? ` · approved by ${esc(actorName(rec.approved_by))}` : ""}</p>` : "";
  let lockNote = "";
  if (rec && ro) {
    lockNote = mod === "expenses"
      ? `<div class="lock">${icon("i-shield")}${can.approve() ? "You can change this claim's status. Only its owner (while pending) or someone with full expense rights can edit the details." : rec.status !== "pending" ? "This expense has been reviewed, so only someone with full expense rights can change it." : "Only the person who logged this expense can change it."}</div>`
      : `<div class="lock">${icon("i-shield")}You can view this but not change it.</div>`;
  }
  const hist = rec ? `<div id="histBox"></div>` : "";
  const title = rec ? rec[TITLE_KEY[mod]] || "Untitled" : `New ${NOUN[mod]}`;
  const sub = rec && mod !== "companies" ? coChip(rec.company_id, true) : "";
  openShell(title, `${top}${lockNote}<div class="form">${fields.map((f) => fieldHTML(f, values[f.k], ro, values)).join("")}</div>${receipt}${priv}${meta}${hist}`, footer(ro, rec, mod, rec ? "Save changes" : `Add ${NOUN[mod]}`), sub);
  if (rec && mod !== "companies") loadHistory(mod, rec);
  setTimeout(() => { const first = $("#drawer .inp:not([disabled]),#drawer .sel:not([disabled])"); if (first && !rec) first.focus(); else $("#drawer [data-act=closeDrawer]").focus(); }, 60);
}

async function loadHistory(mod, rec) {
  const [h, moves] = await Promise.all([data.history(mod, rec.id), mod === "products" ? data.stockMoves(rec.id) : Promise.resolve([])]);
  const box = $("#histBox"); if (!box || ctx?.id !== rec.id) return;
  let html = "";
  if (moves.length) html += `<div class="section-t">Stock movements</div><div class="history">${moves.map((m) => `<div class="h"><span class="mono" style="color:${num(m.delta) < 0 ? "var(--bad)" : "var(--good)"};min-width:64px">${num(m.delta) > 0 ? "+" : ""}${esc(qty(m.delta))}</span><span style="flex:1">${esc(m.reason || (num(m.delta) > 0 ? "Received" : "Used"))} · balance ${esc(qty(m.balance))} · ${esc(actorName(m.created_by))}</span><time>${esc(relTime(m.created_at))}</time></div>`).join("")}</div>`;
  if (h.length) html += `<div class="section-t">${icon("i-history")} History</div><div class="history">${h.map((a) => `<div class="h"><span style="flex:1">${esc(activityLine(a))} · <span style="color:var(--muted)">${esc(actorName(a.actor))}</span></span><time>${esc(relTime(a.at))}</time></div>`).join("")}</div>`;
  box.innerHTML = html;
}

function personTop(p) {
  const tasks = openTasks().filter((t) => t.assignee_id === p.id).sort(taskSort);
  const mk = monthKey(new Date()); const ex = S.expenses.filter((e) => e.person_id === p.id);
  const mgr = personById(p.manager_id); const reports = S.people.filter((x) => x.manager_id === p.id);
  const tenure = p.joined ? Math.max(0, -daysFrom(p.joined)) : null;
  const acct = p.profile_id ? S.profiles.find((x) => x.id === p.profile_id) : null;
  return `<div class="prof">${avatar(p, "lg")}<div style="min-width:0"><h3>${esc(p.name)}</h3><div style="color:var(--muted)">${esc([p.role_title, p.department].filter(Boolean).join(" · ") || "No role set")}</div><div class="toolbar" style="margin-top:6px">${chip(PEOPLE_STATUS, p.status || "active")}${p.employment_type ? `<span class="chip nodot">${esc(p.employment_type)}</span>` : ""}${acct ? `<span class="chip nodot role-chip">${esc(roleLabel(acct.role))} account</span>` : ""}</div></div></div>
  <div class="facts"><div><b>${tasks.length}</b><span>open tasks</span></div><div><b>${esc(compact(spend(ex.filter((e) => String(e.spent_on || "").startsWith(mk)))))}</b><span>spent this month</span></div><div><b>${tenure == null ? "—" : tenure >= 365 ? (tenure / 365).toFixed(1) + " yr" : Math.round(tenure / 30) + " mo"}</b><span>with the team</span></div></div>
  ${mgr || reports.length ? `<div class="toolbar" style="font-size:13px;color:var(--muted)">${mgr ? `<span>Reports to <b style="color:var(--fg)">${esc(mgr.name)}</b></span>` : ""}${reports.length ? `<span>${reports.length} direct report${reports.length > 1 ? "s" : ""}</span>` : ""}</div>` : ""}
  ${tasks.length ? `<div><div class="section-t">Open tasks</div><div class="list">${tasks.slice(0, 6).map((t) => `<div class="li" data-act="open" data-mod="tasks" data-id="${esc(t.id)}"><div class="grow"><div>${esc(t.title)}</div></div>${chip(TASK_STATUS, t.status || "todo")}</div>`).join("")}</div></div>` : ""}
  <div class="section-t">Details</div>`;
}
function productTop(p) {
  return `<div class="facts"><div><b>${Math.round(margin(p) * 100)}%</b><span>margin</span></div><div><b>${esc(compact(num(p.price) - num(p.cost)))}</b><span>profit per ${esc(p.unit || "unit")}</span></div><div><b>${esc(qty(p.stock))}</b><span>${esc(p.unit || "pcs")} in stock</span></div></div>
  ${can.has("products.edit") ? `<div class="toolbar"><span class="section-t" style="margin-right:auto">Adjust stock</span><input class="inp num" id="adjQty" inputmode="decimal" placeholder="Qty" style="width:80px" aria-label="Quantity"><input class="inp" id="adjReason" placeholder="Reason (optional)" style="width:150px" aria-label="Reason"><button type="button" class="btn sm" data-act="adjStock" data-d="1">Receive</button><button type="button" class="btn sm" data-act="adjStock" data-d="-1">Sell or use</button></div>` : ""}
  <div class="section-t">Details</div>`;
}
function expenseTop(e) {
  if (!e) return can.approve() ? "" : `<div class="lock">${icon("i-shield")}New claims start as pending until someone with approval rights reviews them.</div>`;
  if (!can.approve()) return `<div class="toolbar"><span>${chip(EXP_STATUS, e.status)}</span></div>`;
  const nexts = e.status === "pending" ? [["approved", "Approve"], ["rejected", "Reject"]] : e.status === "approved" ? [["reimbursed", "Mark paid out"], ["pending", "Back to pending"]] : [["pending", "Reopen"]];
  return `<div class="toolbar"><span>${chip(EXP_STATUS, e.status)}</span><span class="grow"></span>${nexts.map(([s, l]) => `<button type="button" class="btn sm ${s === "rejected" ? "danger" : s === "approved" || s === "reimbursed" ? "pri" : ""}" data-act="expStatus" data-s="${s}">${esc(l)}</button>`).join("")}</div>`;
}
function receiptBlock(rec, ro) {
  const has = rec?.receipt_path;
  const name = has ? rec.receipt_path.split("/").pop().replace(/^\d+-/, "") : "";
  return `<div class="fld"><label for="f_receipt">Receipt</label>
    ${has ? `<div class="receipt">${icon("i-clip")}<span class="grow">${esc(name)}</span><button type="button" class="btn sm" data-act="viewReceipt">Open</button>${ro ? "" : `<button type="button" class="btn sm ghost" data-act="dropReceipt" aria-label="Remove receipt">${icon("i-x")}</button>`}</div>` : ""}
    ${ro ? (has ? "" : `<span style="color:var(--faint)">No receipt attached</span>`) : `<input class="inp" type="file" id="f_receipt" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"><span style="font-size:12px;color:var(--muted)">Photo or PDF, up to 10 MB. ${has ? "Choosing a file replaces the current one." : ""}</span>`}
    <span class="err" id="f_receipt_err" hidden></span></div>`;
}

function collect(fields) {
  const out = {}; let ok = true;
  for (const f of fields) {
    const el = document.getElementById("f_" + f.k); const err = document.getElementById("f_" + f.k + "_err");
    if (err) { err.hidden = true; err.textContent = ""; }
    if (!el) continue;
    const fail = (m) => { ok = false; if (err) { err.textContent = m; err.hidden = false; } };
    if (f.type === "checklist") { out[f.k] = $$(".ci", el).map((r) => ({ t: r.querySelector(".inp").value.trim(), done: r.querySelector(".cb").checked })).filter((c) => c.t); continue; }
    if (f.type === "check") { out[f.k] = el.checked; continue; }
    if (f.type === "lines") { out[f.k] = lines(el.value); continue; }
    if (f.type === "budgets") {
      const b = {}; let bad = false;
      $$("[data-cat]", el).forEach((i) => { const raw = i.value.replace(/[,\s]/g, ""); if (!raw) return; const n = parseFloat(raw); if (!isFinite(n) || n < 0) bad = true; else b[i.dataset.cat] = n; });
      if (bad) { fail("Budgets must be positive numbers"); continue; }
      out[f.k] = b; continue;
    }
    let v = el.value;
    if (f.type === "number") {
      if (String(v).trim() === "") v = f.req ? null : (f.k === "salary" ? null : 0);
      else { v = parseFloat(v); if (!isFinite(v)) { fail("Enter a number"); continue; } }
    } else v = String(v).trim();
    if (f.req && (v === null || v === "")) { fail(f.type === "company" ? "Choose a company" : `Enter ${f.label.toLowerCase().replace(/\s*\(.*\)/, "")}`); continue; }
    if (f.type === "number" && v !== null && f.min != null && v < f.min) { fail("Can't be negative"); continue; }
    if (f.k === "amount" && !(v > 0)) { fail("Amount must be more than zero"); continue; }
    if (f.type === "email" && v && !/^\S+@\S+\.\S+$/.test(v)) { fail("Check the email address"); continue; }
    out[f.k] = (["date", "person", "profile", "email", "tel", "company"].includes(f.type) || (f.type === "select" && (f.blank || f.dep))) && v === "" ? null : v;
  }
  return ok ? out : null;
}

export async function submit() {
  if (!ctx) return;
  if (ctx.mod === "account") return submitAccount();
  if (ctx.mod === "user") return submitUser();
  if (ctx.mod === "role") return submitRole();
  const { mod, id } = ctx;
  const rec = id ? S[mod].find((x) => x.id === id) : null;
  const fields = FIELDS[mod]().filter((f) => !(f.newOnly && rec));
  const body = collect(fields);
  const privVals = mod === "people" && can.hr() ? collect(PRIVATE_FIELDS()) : {};
  const file = $("#f_receipt")?.files?.[0];
  if (file && file.size > 10 * 1024 * 1024) { const e = $("#f_receipt_err"); e.textContent = "That file is over 10 MB."; e.hidden = false; return; }
  if (!body || !privVals) { const e = $("#drawer .err:not([hidden])"); if (e) e.previousElementSibling?.focus?.(); return; }
  if (mod === "companies" && body.budgets) {
    const keep = new Set(body.expense_categories || []);
    Object.keys(body.budgets).forEach((k) => { if (!keep.has(k)) delete body.budgets[k]; });
  }
  const btn = $("#saveBtn"); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const row = await data.saveRow(mod, id, body);
    if (mod === "people" && can.hr()) {
      const { salary = null, national_id = "", bank_account = "", private_notes = "" } = privVals;
      const before = S.salaries[row.id];
      if (before || salary != null || national_id || bank_account || private_notes)
        await data.saveSalary(row.id, { salary, national_id: national_id || null, bank_account: bank_account || null, notes: private_notes || null });
    }
    if (mod === "expenses" && file) {
      const oldPath = row.receipt_path;
      const path = await data.uploadReceipt(row.id, file);
      await data.saveRow("expenses", row.id, { receipt_path: path });
      if (oldPath) data.removeReceipt(oldPath).catch(() => {});
    }
    toast(rec ? "Saved" : `${NOUN[mod][0].toUpperCase() + NOUN[mod].slice(1)} added`);
    closeDrawer();
  } catch (e) {
    toast(data.errText(e), true);
    if (btn) { btn.disabled = false; btn.textContent = rec ? "Save changes" : `Add ${NOUN[mod]}`; }
  }
}

export async function setExpenseStatus(s) {
  try { await data.saveRow("expenses", ctx.id, { status: s }); toast(opt(EXP_STATUS, s).l); closeDrawer(); }
  catch (e) { toast(data.errText(e), true); }
}
export async function adjustFromDrawer(dir) {
  const q = parseFloat($("#adjQty").value);
  if (!(q > 0)) { $("#adjQty").focus(); toast("Enter a quantity above zero", true); return; }
  const id = ctx.id;
  try {
    const r = await data.adjustStock(id, q * dir, $("#adjReason").value.trim() || (dir > 0 ? "Received" : "Sold or used"));
    toast(`Stock now ${qty(r.stock)}`);
    openRecord("products", id);
  } catch (e) { toast(data.errText(e), true); }
}
export async function viewReceipt() {
  const rec = S.expenses.find((x) => x.id === ctx?.id); if (!rec?.receipt_path) return;
  try { const url = await data.receiptLink(rec.receipt_path); window.open(url, "_blank", "noopener"); }
  catch (e) { toast("Couldn't open the receipt. " + data.errText(e), true); }
}
export async function dropReceipt() {
  const rec = S.expenses.find((x) => x.id === ctx?.id); if (!rec?.receipt_path) return;
  try { await data.saveRow("expenses", rec.id, { receipt_path: null }); data.removeReceipt(rec.receipt_path).catch(() => {}); toast("Receipt removed"); openRecord("expenses", rec.id); }
  catch (e) { toast(data.errText(e), true); }
}
export function askDelete() {
  const what = ctx.mod === "role" ? "role" : NOUN[ctx.mod];
  const extra = ctx.mod === "companies" ? " Companies with expenses, tasks or products can't be deleted; untick Active to archive them instead." : "";
  $("#confirmBox").innerHTML = `<div class="confirm"><span style="flex:1">Delete this ${what} for everyone? This can't be undone.${extra}</span><button type="button" class="btn sm" data-act="cancelDelete">Keep it</button><button type="button" class="btn sm danger solid" data-act="doDelete">Delete</button></div>`;
  $("#confirmBox [data-act=doDelete]").focus();
}
export async function doDelete() {
  const { mod, id } = ctx;
  try {
    if (mod === "role") { await data.deleteRole(id); toast("Role deleted"); closeDrawer(); return; }
    const rec = S[mod].find((x) => x.id === id);
    await data.deleteRow(mod, id);
    if (mod === "expenses" && rec?.receipt_path) data.removeReceipt(rec.receipt_path).catch(() => {});
    if (mod === "companies" && U.company === id) U.company = "";
    toast("Deleted"); closeDrawer();
  } catch (e) { toast(data.errText(e), true); }
}

// ---------- user access (users.manage) ----------
export function openUser(id) {
  const p = S.profiles.find((x) => x.id === id); if (!p) return;
  const self = id === myId(); const iAdmin = can.admin();
  const ro = (!iAdmin && (self || p.role === "admin")) || !can.users();
  ctx = { mod: "user", id };
  const roles = S.roles.slice().sort((a, b) => a.sort - b.sort);
  const ids = p.company_ids || [];
  const allCo = !ids.length;
  const note = self && !iAdmin ? "You can't change your own access." : !iAdmin && p.role === "admin" ? "Only admins can change another admin." : self ? "Careful: you are editing your own access." : "";
  openShell(p.full_name || p.email, `
    <div class="prof">${avatar({ id: p.id, name: p.full_name || p.email }, "lg")}<div style="min-width:0"><h3>${esc(p.full_name || "No name")}</h3><div style="color:var(--muted)">${esc(p.email || "")}</div><div style="color:var(--faint);font-size:12px">Signed up ${esc(relTime(p.created_at))}</div></div></div>
    ${note ? `<div class="lock">${icon("i-shield")}${esc(note)}</div>` : ""}
    <div class="fld"><label>Role</label><div class="role-pick">${roles.map((r) => `<label class="role-opt"><input type="radio" name="uRole" value="${esc(r.key)}" ${r.key === (p.role === "pending" ? "member" : p.role) ? "checked" : ""} ${ro || (r.key === "admin" && !iAdmin) ? "disabled" : ""}><span><b>${esc(r.label)}</b><small>${esc(r.description || "")}</small></span></label>`).join("")}</div></div>
    <div class="fld"><label>Companies</label>
      <label class="switch"><input type="checkbox" id="uAllCo" ${allCo ? "checked" : ""} ${ro ? "disabled" : ""}><span>All companies, including ones added later</span></label>
      <div class="co-pick" id="uCoPick" ${allCo ? "hidden" : ""}>${activeCompanies().map((c) => `<label class="co-opt" style="--co:${esc(c.color)}"><input type="checkbox" value="${esc(c.id)}" ${ids.includes(c.id) ? "checked" : ""} ${ro ? "disabled" : ""}>${esc(c.name)}</label>`).join("")}</div>
      <span style="font-size:12px;color:var(--muted)">Admins always see every company.</span>
      <span class="err" id="uCo_err" hidden></span></div>
    <div class="fld"><label class="switch"><input type="checkbox" id="uActive" ${p.active ? "checked" : ""} ${ro || self ? "disabled" : ""}><span>Access on</span></label><span style="font-size:12px;color:var(--muted)">Turning access off signs them out of the workspace straight away.</span></div>`,
    ro ? `<span class="grow"></span><button type="button" class="btn" data-act="closeDrawer">Close</button>`
       : `<span class="grow"></span><button type="button" class="btn" data-act="closeDrawer">Cancel</button><button type="submit" form="dform" class="btn pri" id="saveBtn">${p.role === "pending" ? "Approve" : "Save access"}</button>`);
}
export function toggleAllCompanies() { $("#uCoPick").hidden = $("#uAllCo").checked; }
async function submitUser() {
  const id = ctx.id; const p = S.profiles.find((x) => x.id === id);
  const roleKey = $("input[name=uRole]:checked")?.value || p.role;
  const company_ids = $("#uAllCo").checked ? [] : $$("#uCoPick input:checked").map((i) => i.value);
  if (!$("#uAllCo").checked && !company_ids.length) { const e = $("#uCo_err"); e.textContent = "Pick at least one company, or choose All companies"; e.hidden = false; return; }
  const patch = { role: roleKey, company_ids };
  if (!$("#uActive").disabled) patch.active = $("#uActive").checked;
  try { await data.updateProfile(id, patch); toast(p.role === "pending" ? `Approved as ${roleLabel(roleKey)}` : "Access saved"); closeDrawer(); }
  catch (e) { toast(data.errText(e), true); }
}

// ---------- roles (admins) ----------
export function openRole(key) {
  const r = key ? S.roles.find((x) => x.key === key) : null;
  ctx = { mod: "role", id: key || null };
  const roles = S.roles.filter((x) => x.key !== "pending").sort((a, b) => a.sort - b.sort);
  openShell(r ? `Edit ${r.label}` : "New role", `
    <div class="form">
      <div class="fld"><label for="rLabel">Role name *</label><input class="inp" id="rLabel" value="${esc(r?.label || "")}" placeholder="Accountant"><span class="err" id="rLabel_err" hidden></span></div>
      <div class="fld"><label for="rDesc">What this role is for</label><input class="inp" id="rDesc" value="${esc(r?.description || "")}" placeholder="Checks and approves expense claims"></div>
      ${r ? "" : `<div class="fld"><label for="rCopy">Start with the permissions of</label><select class="sel" id="rCopy"><option value="">Nothing (tick them yourself)</option>${roles.filter((x) => x.key !== "admin").map((x) => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join("")}</select></div>`}
    </div>
    <p style="margin:0;color:var(--muted);font-size:13px">${r ? "Tick and untick this role's permissions in the table on the Roles & permissions page." : "After creating the role, adjust its permissions in the table."}</p>`,
    `${r ? `<button type="button" class="btn danger" data-act="askDelete">Delete</button>` : ""}<span class="grow"></span><button type="button" class="btn" data-act="closeDrawer">Cancel</button><button type="submit" form="dform" class="btn pri" id="saveBtn">${r ? "Save role" : "Create role"}</button>`);
  setTimeout(() => $("#rLabel").focus(), 60);
}
const slug = (s) => { let k = String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28); if (!/^[a-z]/.test(k)) k = "r_" + k; return k.length < 2 ? "role_" + Date.now().toString(36) : k; };
async function submitRole() {
  const label = $("#rLabel").value.trim(); const description = $("#rDesc").value.trim();
  const err = $("#rLabel_err"); err.hidden = true;
  if (!label) { err.textContent = "Enter a role name"; err.hidden = false; return; }
  const key = ctx.id || (() => { let k = slug(label), n = 2; while (S.roles.some((r) => r.key === k)) k = slug(label) + "_" + n++; return k; })();
  try {
    const isNew = !ctx.id;
    await data.saveRole(key, isNew ? { label, description, sort: 10 + S.roles.length } : { label, description }, isNew);
    const from = isNew ? $("#rCopy")?.value : "";
    if (from) for (const pr of S.rolePerms.filter((x) => x.role_key === from).map((x) => x.perm)) await data.setPermission(key, pr, true);
    toast(isNew ? `Role ${label} created` : "Role saved"); closeDrawer();
  } catch (e) { toast(data.errText(e), true); }
}

// ---------- your account ----------
export function openAccount() {
  ctx = { mod: "account" };
  const p = session.profile || {};
  openShell("Your account", `
    <div class="prof">${avatar({ id: myId(), name: p.full_name || session.user?.email }, "lg")}<div><h3>${esc(p.full_name || "You")}</h3><div style="color:var(--muted)">${esc(session.user?.email || "")}</div><div class="toolbar" style="margin-top:6px"><span class="chip nodot role-chip">${esc(roleLabel(role()))}</span></div></div></div>
    <div class="form">
      <div class="fld"><label for="acName">Your name</label><input class="inp" id="acName" value="${esc(p.full_name || "")}" autocomplete="name"><span class="err" id="acName_err" hidden></span></div>
      <div class="fld"><label for="acPass">New password</label><input class="inp" id="acPass" type="password" autocomplete="new-password" placeholder="Leave blank to keep your password"><span class="err" id="acPass_err" hidden></span></div>
    </div>`,
    `<button type="button" class="btn" data-act="signOut">${icon("i-out")}Sign out</button><span class="grow"></span><button type="button" class="btn" data-act="closeDrawer">Cancel</button><button type="submit" form="dform" class="btn pri" id="saveBtn">Save</button>`);
}
async function submitAccount() {
  const name = $("#acName").value.trim(), pass = $("#acPass").value;
  const ne = $("#acName_err"), pe = $("#acPass_err"); ne.hidden = pe.hidden = true;
  if (!name) { ne.textContent = "Enter your name"; ne.hidden = false; return; }
  if (pass && pass.length < 8) { pe.textContent = "Use at least 8 characters"; pe.hidden = false; return; }
  try {
    if (name !== session.profile?.full_name) await data.updateProfile(myId(), { full_name: name });
    if (pass) { const { error } = await sb.auth.updateUser({ password: pass }); if (error) throw error; }
    toast("Account saved"); closeDrawer();
  } catch (e) { toast(data.errText(e), true); }
}
export { computePerms };
