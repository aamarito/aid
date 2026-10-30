// Everything that talks to Supabase: loading, live updates, writes.
import { sb } from "./lib/supabase.js";
import { S, session, DEFAULT_WS, myId, computePerms } from "./state.js";

const RECORDS = ["expenses", "tasks", "products", "people", "companies"];
// Columns the database manages itself; never sent from the browser
const SERVER_FIELDS = ["id", "created_by", "created_at", "updated_at", "approved_by", "approved_at", "done_at"];
const LIVE_TABLES = ["workspace", "companies", "roles", "role_permissions", "profiles", "people", "people_private", "expenses", "tasks", "products", "activity"];
const POLL_MS = 45e3;

let channel = null;
let onChange = () => {};
let lastLoad = 0;
let pollTimer = 0, liveTimer = 0;

/** Turn a Supabase/Postgres error into a sentence a person can act on. */
export function errText(e) {
  if (!e) return "Something went wrong. Try again.";
  const code = e.code || "";
  const msg = e.message || "";
  if (code === "42501" && msg && !/row-level security|permission denied/i.test(msg)) return msg;
  if (code === "42501" || /row-level security|permission denied/i.test(msg) || code === "PGRST116")
    return "You don't have permission to do that. Ask an admin if you need access.";
  if (code === "23505" && /sku/i.test(msg)) return "Another product already uses that SKU.";
  if (code === "23505" && /companies/i.test(msg)) return "A company with that name already exists.";
  if (code === "23505" && /roles/i.test(msg)) return "A role with that name already exists.";
  if (code === "23505") return "That already exists.";
  if (code === "23503" && /role/i.test(msg)) return "Someone still has this role. Move them to another role first.";
  if (code === "23503") return "Other records still use this. Remove or move them first.";
  if (code === "23514" && /stock/i.test(msg)) return "Stock can't go below zero.";
  if (code === "23514" && /amount/i.test(msg)) return "Amount must be more than zero.";
  if (code === "23514" && /color/i.test(msg)) return "Pick a colour from the colour picker.";
  if (code === "23514") return "One of the values isn't allowed. Check the form and try again.";
  if (code === "P0002") return "That record no longer exists.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "You seem to be offline. Check your connection and try again.";
  if (/Invalid login credentials/i.test(msg)) return "That email and password don't match an account.";
  if (/Email not confirmed/i.test(msg)) return "Confirm your email first: open the link we sent you.";
  if (/User already registered/i.test(msg)) return "An account with that email already exists. Sign in instead.";
  if (/Password should be/i.test(msg)) return msg;
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  return msg || "Something went wrong. Try again.";
}

function throwIf(res) { if (res.error) throw res.error; return res.data; }

export async function loadProfile() {
  const uid = session.user?.id;
  if (!uid) { session.profile = null; return null; }
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error) throw error;
  session.profile = data;
  return data;
}

export async function loadAll() {
  const q = (t, build = (x) => x) => build(sb.from(t).select("*"));
  const res = await Promise.all([
    q("workspace", (x) => x.eq("id", 1).maybeSingle()),
    q("roles", (x) => x.order("sort")),
    q("role_permissions"),
    q("profiles", (x) => x.order("created_at")),
    q("companies", (x) => x.order("sort")),
    q("people", (x) => x.order("name")),
    q("expenses", (x) => x.order("spent_on", { ascending: false }).limit(5000)),
    q("tasks", (x) => x.order("created_at", { ascending: false }).limit(5000)),
    q("products", (x) => x.order("name").limit(5000)),
    q("activity", (x) => x.order("at", { ascending: false }).limit(80)),
    q("people_private"),
  ]);
  const [ws, roles, rolePerms, profiles, companies, people, expenses, tasks, products, activity, priv] = res.map(throwIf);
  S.ws = { ...DEFAULT_WS, ...(ws || {}) };
  S.roles = roles || [];
  S.rolePerms = rolePerms || [];
  S.profiles = profiles || [];
  S.companies = companies || [];
  S.people = people || [];
  S.expenses = expenses || [];
  S.tasks = tasks || [];
  S.products = products || [];
  S.activity = activity || [];
  S.salaries = {};
  (priv || []).forEach((r) => { S.salaries[r.person_id] = r; });
  const me = S.profiles.find((p) => p.id === myId());
  if (me) session.profile = me;
  computePerms();
  S.loaded = true;
  lastLoad = Date.now();
}

/** Re-load if the tab was asleep for a while (live events can be missed). */
export async function refreshIfStale(ms = 5 * 60e3) {
  if (Date.now() - lastLoad > ms) { await loadAll(); onChange("all"); }
}

function upsert(list, row, key = "id") {
  const i = list.findIndex((x) => x[key] === row[key]);
  if (i >= 0) list[i] = { ...list[i], ...row }; else list.unshift(row);
}
function drop(list, id, key = "id") {
  const i = list.findIndex((x) => x[key] === id);
  if (i >= 0) list.splice(i, 1);
}

// Changes to roles, permissions or company access change what this person
// may see, so those trigger a full reload instead of a patch
let reloadT = 0;
function reloadSoon(reason) {
  clearTimeout(reloadT);
  reloadT = setTimeout(() => { loadAll().then(() => onChange(reason)).catch(() => {}); }, 250);
}

function applyEvent(table, ev) {
  const type = ev.eventType;
  const row = ev.new || {};
  const old = ev.old || {};
  if (table === "roles" || table === "role_permissions") return reloadSoon("access");
  if (table === "profiles") {
    if ((row.id || old.id) === myId()) return reloadSoon("access");
    if (type === "DELETE") drop(S.profiles, old.id); else upsert(S.profiles, row);
  } else if (table === "workspace") {
    if (type !== "DELETE") S.ws = { ...DEFAULT_WS, ...row };
  } else if (table === "activity") {
    if (type === "INSERT") S.activity = [row, ...S.activity.filter((a) => a.id !== row.id)].slice(0, 80);
  } else if (table === "people_private") {
    if (type === "DELETE") delete S.salaries[old.person_id]; else S.salaries[row.person_id] = row;
  } else if (RECORDS.includes(table)) {
    if (type === "DELETE") drop(S[table], old.id); else upsert(S[table], row);
  }
  onChange(table);
}

function startPolling() {
  if (pollTimer) return;
  S.live = "polling"; onChange("live");
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") loadAll().then(() => onChange("all")).catch(() => {});
  }, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = 0; }

export async function subscribe(cb) {
  onChange = cb;
  unsubscribe();
  try {
    const { data } = await sb.auth.getSession();
    if (data.session && sb.realtime?.setAuth) await sb.realtime.setAuth(data.session.access_token);
  } catch (e) { /* older clients set auth themselves */ }
  channel = sb.channel("aamaritoaid-db");
  for (const t of LIVE_TABLES) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: t }, (ev) => applyEvent(t, ev));
  }
  // If live updates can't connect within 12 s, refresh on a timer instead
  liveTimer = setTimeout(() => { if (S.live !== "live") startPolling(); }, 12e3);
  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(liveTimer); stopPolling();
      S.live = "live"; onChange("live");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      console.warn("[aamaritoaid] live updates unavailable:", status, err?.message || err || "");
      startPolling();
    }
  });
}
export function unsubscribe() {
  clearTimeout(liveTimer); stopPolling();
  if (channel) { sb.removeChannel(channel); channel = null; }
}

function clean(body) {
  const out = { ...body };
  SERVER_FIELDS.forEach((k) => delete out[k]);
  return out;
}

/** Insert or update a row; returns the saved row as the database stored it. */
export async function saveRow(table, id, body) {
  const data = clean(body);
  const res = id
    ? await sb.from(table).update(data).eq("id", id).select().single()
    : await sb.from(table).insert(data).select().single();
  const row = throwIf(res);
  upsert(S[table], row);
  return row;
}

export async function deleteRow(table, id) {
  const { error, count } = await sb.from(table).delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (count === 0) throw { code: "42501", message: "" };
  drop(S[table], id);
}

export async function saveSalary(personId, fields) {
  const row = throwIf(await sb.from("people_private").upsert({ person_id: personId, ...fields }).select().single());
  S.salaries[personId] = row;
  return row;
}

export async function adjustStock(productId, delta, reason) {
  const row = throwIf(await sb.rpc("adjust_stock", { p_product: productId, p_delta: delta, p_reason: reason || null }));
  const r = Array.isArray(row) ? row[0] : row;
  if (r) upsert(S.products, r);
  return r;
}

export async function saveWorkspace(patch) {
  const row = throwIf(await sb.from("workspace").update(patch).eq("id", 1).select().single());
  S.ws = { ...DEFAULT_WS, ...row };
  return row;
}

export async function updateProfile(id, patch) {
  const row = throwIf(await sb.from("profiles").update(patch).eq("id", id).select().single());
  upsert(S.profiles, row);
  if (id === myId()) session.profile = { ...session.profile, ...row };
  return row;
}

// ---------- roles & permissions (admins) ----------
export async function setPermission(roleKey, perm, on) {
  if (on) {
    throwIf(await sb.from("role_permissions").insert({ role_key: roleKey, perm }));
    S.rolePerms.push({ role_key: roleKey, perm });
  } else {
    throwIf(await sb.from("role_permissions").delete().eq("role_key", roleKey).eq("perm", perm));
    S.rolePerms = S.rolePerms.filter((x) => !(x.role_key === roleKey && x.perm === perm));
  }
  computePerms();
}
export async function saveRole(key, fields, isNew) {
  const row = throwIf(isNew
    ? await sb.from("roles").insert({ key, ...fields }).select().single()
    : await sb.from("roles").update(fields).eq("key", key).select().single());
  upsert(S.roles, row, "key");
  return row;
}
export async function deleteRole(key) {
  const { error, count } = await sb.from("roles").delete({ count: "exact" }).eq("key", key);
  if (error) throw error;
  if (count === 0) throw { code: "42501", message: "" };
  drop(S.roles, key, "key");
  S.rolePerms = S.rolePerms.filter((x) => x.role_key !== key);
}

export async function history(entity, id, limit = 15) {
  const { data, error } = await sb.from("activity").select("*").eq("entity", entity).eq("entity_id", id)
    .order("at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

export async function stockMoves(productId, limit = 8) {
  const { data, error } = await sb.from("stock_movements").select("*").eq("product_id", productId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

// ---------- receipts (private storage bucket) ----------
const BUCKET = "receipts";
export async function uploadReceipt(expenseId, file) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${myId()}/${expenseId}/${Date.now()}-${safe}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}
export async function receiptLink(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
export async function removeReceipt(path) {
  await sb.storage.from(BUCKET).remove([path]);
}
