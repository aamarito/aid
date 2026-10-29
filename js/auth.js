// Screens shown before the workspace: setup, sign in, sign up,
// password reset, and "waiting for approval".
import { sb } from "./lib/supabase.js";
import { session } from "./state.js";
import { errText } from "./data.js";
import { $, esc, icon } from "./util.js";

const art = `
  <section class="gate-art">
    <div class="brand" style="padding:0"><div class="mark" aria-hidden="true">a</div><div><b>aamaritoaid</b><small>Team workspace</small></div></div>
    <div style="display:flex;flex-direction:column;gap:14px;position:relative;z-index:1">
      <h2>Money, work, stock and people in one place.</h2>
      <p>Log and approve expenses against budgets, run the team's tasks, keep the product catalogue and stock straight, and manage the people who make it happen.</p>
    </div>
    <ul>
      <li>${icon("i-wallet")}Expense approvals</li>
      <li>${icon("i-check")}Task boards</li>
      <li>${icon("i-box")}Stock and margins</li>
      <li>${icon("i-users")}Team directory</li>
      <li>${icon("i-shield")}Admin and user roles</li>
      <li>${icon("i-history")}Full audit trail</li>
    </ul>
  </section>`;

function shell(inner) {
  const g = $("#gate");
  g.innerHTML = `<div class="gate">${art}<section class="gate-form"><div class="gate-card">${inner}</div></section></div>`;
  g.hidden = false;
  $("#app").hidden = true;
  $("#bnav").hidden = true;
  const first = g.querySelector("input");
  if (first) setTimeout(() => first.focus(), 30);
}
function setMsg(text, kind = "bad") {
  const m = $("#gateMsg");
  if (!m) return;
  m.className = "msg " + kind;
  m.textContent = text;
  m.hidden = !text;
}
function busy(form, on, label) {
  const b = form.querySelector("button[type=submit]");
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = label; b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
}
const redirect = () => location.origin + location.pathname;

export function showSetup(reason) {
  const why = reason === "cdn"
    ? "The Supabase library couldn't load. Check your internet connection, then reload."
    : "aamaritoaid isn't connected to a Supabase project yet.";
  shell(`
    <h1>Connect your database</h1>
    <p class="lead">${esc(why)}</p>
    ${reason === "cdn" ? "" : `
    <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px;color:var(--muted)">
      <li>Create a free project at <b>supabase.com</b>.</li>
      <li>In its SQL Editor, run <code>supabase/schema.sql</code> from this repository.</li>
      <li>Copy <code>js/config.example.js</code> to <code>js/config.js</code> and fill in the Project URL and the publishable key from Project Settings → API Keys.</li>
      <li>Reload this page and create the first account. It becomes the admin.</li>
    </ol>
    <pre>export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_...";</pre>
    <p style="margin:0;color:var(--muted);font-size:13px">The README has the full walkthrough, including GitHub Pages deployment.</p>`}
    <button class="btn" type="button" onclick="location.reload()">Reload</button>`);
}

export function showLoading(text = "Opening your workspace…") {
  shell(`<h1>aamaritoaid</h1><p class="lead">${esc(text)}</p>`);
}

export function showSignIn(note) {
  shell(`
    <h1>Sign in</h1>
    <p class="lead">Welcome back. Sign in to your team's workspace.</p>
    <div id="gateMsg" class="msg ${note ? "good" : "bad"}" ${note ? "" : "hidden"}>${esc(note || "")}</div>
    <form id="signInForm" novalidate>
      <div class="fld"><label for="siEmail">Work email</label><input class="inp" id="siEmail" type="email" autocomplete="email" required></div>
      <div class="fld"><label for="siPass">Password</label><input class="inp" id="siPass" type="password" autocomplete="current-password" required></div>
      <button class="btn pri" type="submit">Sign in</button>
    </form>
    <div class="alt"><button class="linkbtn" type="button" id="toReset">Forgot password?</button><span>New here? <button class="linkbtn" type="button" id="toSignUp">Create an account</button></span></div>`);
  $("#toReset").onclick = () => showReset();
  $("#toSignUp").onclick = () => showSignUp();
  $("#signInForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#siEmail").value.trim(), password = $("#siPass").value;
    if (!email || !password) return setMsg("Enter your email and password.");
    busy(e.target, true, "Signing in…");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy(e.target, false);
    if (error) setMsg(errText(error));
  };
}

export function showSignUp() {
  shell(`
    <h1>Create your account</h1>
    <p class="lead">The very first account becomes the workspace admin. Everyone after that waits for an admin to approve them.</p>
    <div id="gateMsg" class="msg bad" hidden></div>
    <form id="signUpForm" novalidate>
      <div class="fld"><label for="suName">Full name</label><input class="inp" id="suName" autocomplete="name" required></div>
      <div class="fld"><label for="suEmail">Work email</label><input class="inp" id="suEmail" type="email" autocomplete="email" required></div>
      <div class="fld"><label for="suPass">Password</label><input class="inp" id="suPass" type="password" autocomplete="new-password" minlength="8" required><span style="font-size:12px;color:var(--muted)">At least 8 characters.</span></div>
      <button class="btn pri" type="submit">Create account</button>
    </form>
    <div class="alt"><span>Already have an account? <button class="linkbtn" type="button" id="toSignIn">Sign in</button></span></div>`);
  $("#toSignIn").onclick = () => showSignIn();
  $("#signUpForm").onsubmit = async (e) => {
    e.preventDefault();
    const full_name = $("#suName").value.trim(), email = $("#suEmail").value.trim(), password = $("#suPass").value;
    if (!full_name || !email) return setMsg("Enter your name and email.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("Check the email address.");
    if (password.length < 8) return setMsg("Use a password with at least 8 characters.");
    busy(e.target, true, "Creating account…");
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: redirect() } });
    busy(e.target, false);
    if (error) return setMsg(errText(error));
    if (!data.session) showSignIn(`Check ${email} for a confirmation link, then sign in.`);
  };
}

export function showReset() {
  shell(`
    <h1>Reset your password</h1>
    <p class="lead">We'll email you a link to choose a new password.</p>
    <div id="gateMsg" class="msg bad" hidden></div>
    <form id="resetForm" novalidate>
      <div class="fld"><label for="rsEmail">Work email</label><input class="inp" id="rsEmail" type="email" autocomplete="email" required></div>
      <button class="btn pri" type="submit">Send reset link</button>
    </form>
    <div class="alt"><button class="linkbtn" type="button" id="toSignIn">Back to sign in</button></div>`);
  $("#toSignIn").onclick = () => showSignIn();
  $("#resetForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#rsEmail").value.trim();
    if (!email) return setMsg("Enter your email.");
    busy(e.target, true, "Sending…");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
    busy(e.target, false);
    if (error) return setMsg(errText(error));
    setMsg(`If ${email} has an account, a reset link is on its way.`, "good");
  };
}

export function showNewPassword(done) {
  shell(`
    <h1>Choose a new password</h1>
    <div id="gateMsg" class="msg bad" hidden></div>
    <form id="npForm" novalidate>
      <div class="fld"><label for="npPass">New password</label><input class="inp" id="npPass" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn pri" type="submit">Save password</button>
    </form>`);
  $("#npForm").onsubmit = async (e) => {
    e.preventDefault();
    const password = $("#npPass").value;
    if (password.length < 8) return setMsg("Use a password with at least 8 characters.");
    busy(e.target, true, "Saving…");
    const { error } = await sb.auth.updateUser({ password });
    busy(e.target, false);
    if (error) return setMsg(errText(error));
    done();
  };
}

export function showPending(onCheck) {
  const p = session.profile;
  const deactivated = p && !p.active;
  shell(`
    <h1>${deactivated ? "Your access is paused" : "Waiting for approval"}</h1>
    <p class="lead">${deactivated
      ? "An admin has turned off your access to this workspace. Contact them if you think this is a mistake."
      : `You're signed in as <b>${esc(session.user?.email || "")}</b>. An admin needs to approve your account before you can see the workspace. This page opens the workspace as soon as they do.`}</p>
    <div id="gateMsg" class="msg bad" hidden></div>
    <div class="toolbar"><button class="btn pri" type="button" id="pendCheck">Check again</button><button class="btn" type="button" id="pendOut">${icon("i-out")}Sign out</button></div>`);
  $("#pendCheck").onclick = onCheck;
  $("#pendOut").onclick = () => sb.auth.signOut();
}
