// Formatting and DOM helpers
import { S } from "./state.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const pad = (n) => String(n).padStart(2, "0");
export function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function monthKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function monthLabel(k, short) {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", short ? { month: "short" } : { month: "long", year: "numeric" });
}
export function addMonths(k, n) { const [y, m] = k.split("-").map(Number); return monthKey(new Date(y, m - 1 + n, 1)); }
export function fdate(s) {
  if (!s) return "—";
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: new Date().getFullYear() === y ? undefined : "numeric" });
}
export function daysFrom(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  const a = new Date(y, m - 1, d); const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / 864e5);
}
export function relTime(iso) {
  const s = (Date.now() - new Date(iso)) / 1e3;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Bangladeshi grouping (1,25,000) suits ৳; lakh/crore for compact figures
export const NF = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const NF2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export function money(n) {
  const v = Math.round(num(n));
  return (v < 0 ? "−" : "") + (S.ws.currency || "৳") + NF.format(Math.abs(v));
}
export function compact(n) {
  n = num(n); const a = Math.abs(n); const c = S.ws.currency || "৳";
  if (a >= 1e7) return c + NF2.format(n / 1e7) + " cr";
  if (a >= 1e5) return c + NF2.format(n / 1e5) + " lakh";
  return money(n);
}
export const qty = (n) => NF2.format(num(n));

const AV_COLORS = ["#0A7670", "#2F5FB3", "#B97A10", "#8C3FA8", "#BC3328", "#23824F", "#5B6B1F", "#B4477A", "#3E6E8E"];
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export function initials(n) {
  const p = String(n || "?").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
export function avatar(p, cls = "") {
  if (!p) return `<span class="av ${cls}" style="background:var(--line-2)" aria-hidden="true">?</span>`;
  const name = p.name ?? p.full_name ?? p.email;
  return `<span class="av ${cls}" style="background:${AV_COLORS[hash(p.id) % AV_COLORS.length]}" aria-hidden="true">${esc(initials(name))}</span>`;
}
export const opt = (list, v) => list.find((o) => o.v === v) || list[list.length - 1];
export function chip(list, v) {
  const o = list.find((o) => o.v === v);
  return o ? `<span class="chip ${o.c}">${esc(o.l)}</span>` : "";
}
export const icon = (id) => `<svg class="icon"><use href="#${id}"/></svg>`;

export function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), bad ? 4500 : 2400);
}

export function downloadFile(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
