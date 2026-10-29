// Supabase client, created at start-up.
// The config file and the Supabase library are loaded dynamically so a
// missing js/config.js shows a setup screen instead of a blank page.

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.0/+esm";

export let sb = null;

/** @returns {Promise<{ok: boolean, reason?: "no-config"|"empty-config"|"cdn"}>} */
export async function initClient() {
  let cfg;
  try {
    cfg = await import("../config.js");
  } catch (e) {
    return { ok: false, reason: "no-config" };
  }
  const url = (cfg.SUPABASE_URL || "").trim();
  const key = (cfg.SUPABASE_ANON_KEY || "").trim();
  if (!/^https?:\/\//.test(url) || !key) return { ok: false, reason: "empty-config" };
  let lib;
  try {
    lib = await import(SUPABASE_CDN);
  } catch (e) {
    return { ok: false, reason: "cdn" };
  }
  sb = lib.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return { ok: true };
}
