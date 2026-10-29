// Shared app state, constants and permission rules (UI side).
// The database enforces the same rules with row-level security;
// these checks only decide which buttons to show.

export const ROUTES = [
  { id: "overview",  label: "Overview",  icon: "i-home" },
  { id: "expenses",  label: "Expenses",  icon: "i-wallet" },
  { id: "tasks",     label: "Tasks",     icon: "i-check" },
  { id: "products",  label: "Products",  icon: "i-box" },
  { id: "people",    label: "People",    icon: "i-users" },
  { id: "members",   label: "Users & access", short: "Access", icon: "i-shield", sep: true, admin: true },
  { id: "workspace", label: "Workspace", short: "Setup", icon: "i-cog" },
];

export const EXP_STATUS = [
  { v: "pending",    l: "Pending",  c: "c-warn" },
  { v: "approved",   l: "Approved", c: "c-info" },
  { v: "reimbursed", l: "Paid out", c: "c-good" },
  { v: "rejected",   l: "Rejected", c: "c-bad" },
];
export const METHODS = ["Cash", "bKash", "Nagad", "Rocket", "Bank transfer", "Card", "Cheque"];
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
export const UNITS = ["pcs", "box", "pack", "kg", "g", "litre", "metre", "set", "dozen", "hour"];
export const PEOPLE_STATUS = [
  { v: "active",   l: "Active",   c: "c-good" },
  { v: "leave",    l: "On leave", c: "c-warn" },
  { v: "inactive", l: "Left",     c: "" },
];
export const EMP_TYPES = ["Full-time", "Part-time", "Contract", "Intern", "Freelance"];
export const ROLES = [
  { v: "admin",   l: "Admin",   d: "Everything, including approvals, HR, salaries and access" },
  { v: "member",  l: "Member",  d: "Logs expenses, runs tasks, manages products and stock" },
  { v: "viewer",  l: "Viewer",  d: "Can see the workspace but not change it" },
  { v: "pending", l: "Waiting", d: "Signed up, not approved yet: sees nothing" },
];

export const DEFAULT_WS = {
  company: "aamaritoaid",
  currency: "৳",
  expense_categories: ["Office & rent", "Travel & transport", "Meals", "Software", "Marketing", "Utilities", "Salaries", "Equipment", "Other"],
  budgets: {},
  product_categories: ["General"],
  departments: ["Operations", "Sales", "Marketing", "Finance", "Engineering", "HR"],
  projects: ["General"],
  members_see_all_expenses: false,
};

export const NOUN = { expenses: "expense", tasks: "task", products: "product", people: "person" };
export const TITLE_KEY = { expenses: "title", tasks: "title", products: "name", people: "name" };

// Data loaded from Supabase
export const S = {
  expenses: [], tasks: [], products: [], people: [],
  salaries: {},          // person_id -> people_private row (admins only)
  profiles: [],          // login accounts
  activity: [],
  ws: { ...DEFAULT_WS },
  loaded: false,
  live: "connecting",    // connecting | live | offline
};

// UI state (filters, views)
export const U = {
  route: "overview",
  exp:  { q: "", month: "", cat: "", status: "", person: "", mine: false, sort: "spent_on", dir: -1, sel: new Set() },
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

export const can = {
  read:    () => ["admin", "member", "viewer"].includes(role()),
  write:   () => ["admin", "member"].includes(role()),
  admin:   () => role() === "admin",
  approve: () => role() === "admin",
  create(mod) {
    if (mod === "people") return can.admin();
    return can.write();
  },
  edit(mod, rec) {
    if (!rec) return can.create(mod);
    if (can.admin()) return true;
    if (!can.write()) return false;
    if (mod === "people") return false;
    if (mod === "expenses") return rec.created_by === myId() && rec.status === "pending";
    return true;
  },
  remove(mod, rec) {
    if (!rec) return false;
    if (can.admin()) return true;
    if (!can.write()) return false;
    if (mod === "expenses") return rec.created_by === myId() && rec.status === "pending";
    if (mod === "tasks") return rec.created_by === myId();
    return false;
  },
  seeAllExpenses: () => ["admin", "viewer"].includes(role()) || (role() === "member" && !!S.ws.members_see_all_expenses),
};
