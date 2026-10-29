// Everything that talks to Supabase: loading, live updates, writes.
import { sb } from "./lib/supabase.js";
import { S, session, DEFAULT_WS, can, myId } from "./state.js";

const TABLES = ["expenses", "tasks", "products", "people"];
// Columns the database manages itself; never sent from the browser
const SERVER_FIELDS = ["id", "created_by", "created_at", "updated_at", "approved_by", "approved_at", "done_at"];

let channel = null;
let onChange = () => {};
let lastLoad = 0;

/** Turn a Supabase/Postgres error into a sentence a person can act on. */
export function errText(e) {
  if (!e) return "Something went wrong. Try again.";
  const code = e.code || "";
  const msg = e.message || "";
  if (code === "42501" && msg && !/row-level security|permission denied/i.test(msg)) return msg;
  if (code === "42501" || /row-level security|permission denied/i.test(msg) || code === "PGRST116")
    return "You don't have permission to do that. Ask an admin if you need access.";
  if (code === "23505" && /sku/i.test(msg)) return "Another product already uses that SKU.";
  if (code === "23505") return "That already exists.";
  if (code === "23514" && /stock/i.test(msg)) return "Stock can't go below zero.";
  if (code === "23514" && /amount/i.test(msg)) return "Amount must be more than zero.";
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
  const jobs = [
    q("workspace", (x) => x.eq("id", 1).maybeSingle()),
    q("profiles", (x) => x.order("created_at")),
    q("people", (x) => x.order("name")),
    q("expenses", (x) => x.order("spent_on", { ascending: false }).limit(5000)),
    q("tasks", (x) => x.order("created_at", { ascending: false }).limit(5000)),
    q("products", (x) => x.order("name").limit(5000)),
    q("activity", (x) => x.order("at", { ascending: false }).limit(80)),
  ];
  if (can.admin()) jobs.push(q("people_private"));
  const res = await Promise.all(jobs);
  const [ws, profiles, people, expenses, tasks, products, activity, priv] = res.map(throwIf);
  S.ws = { ...DEFAULT_WS, ...(ws || {}) };
  S.profiles = profiles || [];
  S.people = people || [];
  S.expenses = expenses || [];
  S.tasks = tasks || [];
  S.products = products || [];
  S.activity = activity || [];
  S.salaries = {};
  (priv || []).forEach((r) => { S.salaries[r.person_id] = r; });
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

function applyEvent(table, ev) {
  const type = ev.eventType;
  const row = ev.new || {};
  const old = ev.old || {};
  if (table === "workspace") {
    if (type !== "DELETE") {
      const before = !!S.ws.members_see_all_expenses;
      S.ws = { ...DEFAULT_WS, ...row };
      if (before !== !!S.ws.members_see_all_expenses && !["admin", "viewer"].includes(session.profile?.role)) {
        // visibility of other people's expenses changed: fetch the new set
        sb.from("expenses").select("*").order("spent_on", { ascending: false }).limit(5000)
          .then(({ data }) => { if (data) { S.expenses = data; onChange("expenses"); } });
      }
    }
  } else if (table === "activity") {
    if (type === "INSERT") S.activity = [row, ...S.activity.filter((a) => a.id !== row.id)].slice(0, 80);
  } else if (table === "people_private") {
    if (type === "DELETE") delete S.salaries[old.person_id]; else S.salaries[row.person_id] = row;
  } else if (table === "profiles") {
    if (type === "DELETE") drop(S.profiles, old.id); else upsert(S.profiles, row);
    if (row.id && row.id === myId()) {
      const was = session.profile ? `${session.profile.role}/${session.profile.active}` : "";
      session.profile = { ...session.profile, ...row };
      if (was !== `${row.role}/${row.active}`) { onChange("access"); return; }
    }
  } else if (TABLES.includes(table)) {
    if (type === "DELETE") drop(S[table], old.id); else upsert(S[table], row);
  }
  onChange(table);
}

export function subscribe(cb) {
  onChange = cb;
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("aamaritoaid-db");
  for (const t of ["workspace", "profiles", "people", "people_private", "expenses", "tasks", "products", "activity"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: t }, (ev) => applyEvent(t, ev));
  }
  channel.subscribe((status) => {
    S.live = status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting";
    onChange("live");
  });
}
export function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }

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
