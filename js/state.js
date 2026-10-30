// Shared app state, constants and permission checks (UI side).
// The database enforces the same permissions with row-level security;
// these checks only decide which buttons and pages to show.

export const ROUTES = [
  { id: "overview",  label: "Overview",  icon: "i-home" },
  { id: "expenses",  label: "Expenses",  icon: "i-wallet", need: ["expenses.view", "expenses.view_all", "expenses.approve", "expenses.manage", "expenses.create"] },
  { id: "tasks",     label: "Tasks",     icon: "i-check",  need: ["tasks.view"] },
  { id: "products",  label: "Products",  icon: "i-box",    need: ["products.view"] },
  { id: "people",    label: "People",    icon: "i-users",  need: ["people.view"] },
  { id: "companies", label: "Companies", icon: "i-building", sep: true, need: ["settings.manage"] },
  { id: "members",   label: "Users & access", short: "Users", icon: "i-shield", need: ["users.manage"] },
  { id: "roles",     label: "Roles & permissions", short: "Roles", icon: "i-key", need: ["users.manage"] },
  { id: "workspace", label: "Settings", short: "Settings", icon: "i-cog" },
];

// Every permission an admin can tick for a role. Keys must match supabase/schema.sql
export const PERMS = [
  { group: "Expenses", items: [
    { k: "expenses.view",     l: "Open Expenses and see own claims" },
    { k: "expenses.create",   l: "Log new expenses" },
    { k: "expenses.view_all", l: "See everyone's expenses" },
    { k: "expenses.approve",  l: "Approve, reject and pay out" },
    { k: "expenses.manage",   l: "Edit or delete anyone's expenses" },
  ]},
  { group: "Tasks", items: [
    { k: "tasks.view",   l: "See tasks" },
    { k: "tasks.edit",   l: "Create, edit and move tasks" },
    { k: "tasks.delete", l: "Delete any task" },
  ]},
  { group: "Products & stock", items: [
    { k: "products.view",   l: "See products and stock" },
    { k: "products.edit",   l: "Add and edit products, adjust stock" },
    { k: "products.delete", l: "Delete products" },
  ]},
  { group: "People", items: [
    { k: "people.view",   l: "See the team directory" },
    { k: "people.manage", l: "Add and edit people" },
    { k: "people.hr",     l: "See and edit salary, NID and bank details" },
  ]},
  { group: "Administration", items: [
    { k: "reports.export",  l: "Download CSV exports" },
    { k: "users.manage",    l: "Approve sign-ups, change roles and company access (not Admin)" },
    { k: "settings.manage", l: "Manage companies, categories, budgets and options" },
  ]},
];
export const ALL_PERMS = PERMS.flatMap((g) => g.items.map((i) => i.k));

export const EXP_STATUS = [
  { v: "pending",    l: "Pending",  c: "c-warn" },
  { v: "approved",   l: "Approved", c: "c-info" },
  { v: "reimbursed", l: "Paid out", c: "c-good" },
  { v: "rejected",   l: "Rejected", c: "c-bad" },
];
export const TASK_STATUS = [
  { v: "todo",   l: "To do",       c: "" },
  { v: "doing",  l: "In progress", c: "c-info" },
  { v: "review", l: "In review",   c: "c-gold" },
  { v: "done",   l: "Done",        c: "c-good" },
];
export const PRIOS = [
  { v: "urgent", l: "Urgent", c: "c-bad",  col: "var(--bad)",    w: 4 },
  { v: "high",   l: "High",   c: "c-warn", col: "var(--warn)",   w: 3 },
  { v: "medium", l: "Medium", c: "c-info", col: "var(--info)",   w: 2 },
  { v: "low",    l: "Low",    c: "",       col: "var(--line-2)", w: 1 },
];
export const PROD_STATUS = [
  { v: "active",       l: "Active",       c: "c-good" },
  { v: "draft",        l: "Draft",        c: "" },
  { v: "discontinued", l: "Discontinued", c: "c-bad" },
];
export const PEOPLE_STATUS = [
  { v: "active",   l: "Active",   c: "c-good" },
  { v: "leave",    l: "On leave", c: "c-warn" },
  { v: "inactive", l: "Left",     c: "" },
];

export const DEFAULT_WS = {
  company: "aamarito group",
  currency: "৳",
  departments: ["Management", "Operations", "Sales", "Marketing", "Finance", "Production", "Warehouse", "HR"],
  payment_methods: ["Cash", "bKash", "Nagad", "Rocket", "Bank transfer", "Card", "Cheque"],
  units: ["pcs", "pair", "set", "box", "pack", "kg", "g", "litre", "ml", "metre", "dozen"],
  employment_types: ["Full-time", "Part-time", "Contract", "Intern", "Freelance"],
};
export const COMPANY_COLORS = ["#8A5A2B", "#2E7D5B", "#C2571A", "#2F5FB3", "#8C3FA8", "#BC3328", "#0A7670", "#5B6B1F"];

export const NOUN = { expenses: "expense", tasks: "task", products: "product", people: "person", companies: "company" };
export const TITLE_KEY = { expenses: "title", tasks: "title", products: "name", people: "name", companies: "name" };

// Data loaded from Supabase
export const S = {
  expenses: [], tasks: [], products: [], people: [], companies: [],
  salaries: {},            // person_id -> people_private row
  profiles: [], roles: [], rolePerms: [], activity: [],
  myPerms: new Set(),
  ws: { ...DEFAULT_WS },
  loaded: false,
  live: "connecting",      // connecting | live | polling
};

// UI state (filters, views)
export const U = {
  route: "overview",
  company: "",             // "" = all companies
  exp:  { q: "", month: "", cat: "", status: "", person: "", sort: "spent_on", dir: -1, sel: new Set() },
  task: { q: "", view: "board", person: "", project: "", prio: "" },
  prod: { q: "", view: "table", cat: "", status: "", low: false, sort: "name", dir: 1 },
  ppl:  { q: "", dept: "", status: "", view: "cards" },
  mem:  { q: "" },
};

// The signed-in account
export const session = { user: null, profile: null };

export function role() {
  const p = session.profile;
  if (!p || !p.active) return "pending";
  return p.role;
}
export const myId = () => session.user?.id || null;
export const roleLabel = (key) => S.roles.find((r) => r.key === key)?.label || (key === "pending" ? "Waiting" : key);

export function computePerms() {
  const r = role();
  S.myPerms = new Set(r === "admin" ? ALL_PERMS : r === "pending" ? [] : S.rolePerms.filter((x) => x.role_key === r).map((x) => x.perm));
}

const has = (p) => role() === "admin" || S.myPerms.has(p);
const CREATE_PERM = { expenses: "expenses.create", tasks: "tasks.edit", products: "products.edit", people: "people.manage", companies: "settings.manage" };
export const can = {
  has,
  any: (list) => list.some(has),
  read:   () => role() !== "pending",
  admin:  () => role() === "admin",
  approve: () => has("expenses.approve"),
  seeAllExpenses: () => has("expenses.view_all") || has("expenses.approve") || has("expenses.manage"),
  hr: () => has("people.hr"),
  exportCsv: () => has("reports.export"),
  users: () => has("users.manage"),
  settings: () => has("settings.manage"),
  route: (r) => !r.need || r.need.some(has),
  create(mod) {
    const p = CREATE_PERM[mod];
    return p ? has(p) : false;
  },
  /** may change the record's fields (not just its status) */
  edit(mod, rec) {
    if (!rec) return can.create(mod);
    if (mod === "expenses") return has("expenses.manage") || (rec.created_by === myId() && rec.status === "pending" && has("expenses.create"));
    if (mod === "tasks") return has("tasks.edit");
    if (mod === "products") return has("products.edit");
    if (mod === "people") return has("people.manage");
    if (mod === "companies") return has("settings.manage");
    return false;
  },
  remove(mod, rec) {
    if (!rec) return false;
    if (mod === "expenses") return has("expenses.manage") || (rec.created_by === myId() && rec.status === "pending" && has("expenses.create"));
    if (mod === "tasks") return has("tasks.delete") || (rec.created_by === myId() && has("tasks.edit"));
    if (mod === "products") return has("products.delete");
    if (mod === "people") return has("people.manage");
    if (mod === "companies") return role() === "admin";
    return false;
  },
};

// ---------- companies ----------
export const companyById = (id) => S.companies.find((c) => c.id === id);
/** companies this person may work in (admins and people with no limit: all) */
export const myCompanyIds = () => (role() === "admin" ? [] : session.profile?.company_ids || []);
export const activeCompanies = () => S.companies.filter((c) => c.active && (!myCompanyIds().length || myCompanyIds().includes(c.id))).sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(b.name));
export const scopeCompanies = () => (U.company ? S.companies.filter((c) => c.id === U.company) : activeCompanies());
/** Is a record in the currently selected company? (people with no company belong to the whole group) */
export const inScope = (r) => !U.company || r.company_id === U.company || (r.company_id == null && "role_title" in r);
export const scoped = (table) => S[table].filter(inScope);
function union(key) {
  const out = []; for (const c of scopeCompanies()) for (const v of c[key] || []) if (!out.includes(v)) out.push(v);
  return out;
}
export const expenseCats = (cid) => (cid ? companyById(cid)?.expense_categories || [] : union("expense_categories"));
export const productCats = (cid) => (cid ? companyById(cid)?.product_categories || [] : union("product_categories"));
export const projects = (cid) => (cid ? companyById(cid)?.projects || [] : union("projects"));
export function budgetFor(category) {
  return scopeCompanies().reduce((a, c) => a + (Number((c.budgets || {})[category]) || 0), 0);
}
export const budgetTotal = () => scopeCompanies().reduce((a, c) => a + Object.values(c.budgets || {}).reduce((x, v) => x + (Number(v) || 0), 0), 0);
export const wsList = (k) => (S.ws[k]?.length ? S.ws[k] : DEFAULT_WS[k]);
