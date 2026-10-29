# aamaritoaid

A team workspace for **expense management, task management, product & stock management and people management**, with admin and user roles, live sync and a full audit trail.

It is a static web app (plain HTML, CSS and JavaScript modules, no build step) backed by **Supabase** (Postgres, authentication, file storage and realtime). Every permission is enforced inside the database with row-level security, so the data stays safe even if someone opens the browser's developer tools.

---

## Features

**Overview**
- Spending this month against the total budget, claims waiting for approval, open and overdue tasks, stock value, team size
- 6-month spending chart, spending by category against budgets, upcoming deadlines, items to restock
- Live activity feed of everything the team changes

**Expenses**
- Log claims with amount, date, category, vendor, who spent it, payment method (Cash, bKash, Nagad, Rocket, bank, card, cheque) and receipt number
- Attach a receipt photo or PDF (stored in a private bucket, opened through short-lived signed links)
- Approval workflow: *Pending → Approved → Paid out*, or *Rejected*. Only admins can approve, and the approver and time are recorded
- Bulk approve, reject or pay out; filter by month, category, status and person; sort any column
- Monthly budgets per category with warnings near and over the limit
- Members see only their own claims unless an admin allows everyone's
- CSV export

**Tasks**
- Kanban board (To do → In progress → In review → Done) with drag and drop, plus a list view
- Owner, priority, due date, project and checklist; overdue and due-soon highlighting
- Completion time recorded automatically

**Products & stock**
- Catalogue with SKU (unique), category, unit, selling price, cost, margin and stock value
- Stock changes go through one atomic database function, so two people adjusting at once never lose an update, and every movement is logged with who, when, why and the new balance
- Reorder levels with low and out-of-stock alerts; CSV export

**People**
- Team directory with role, department, employment type, status, contact details, joining date, manager and location
- Profile view with open tasks, spending this month, tenure and direct reports
- Admin-only HR fields: salary, NID, bank or bKash account, private notes (kept in a separate table only admins can read); monthly payroll total
- Link a person to their login account

**Users & access** (admins)
- Approve or decline people who sign up, change roles, turn access on or off
- The workspace always keeps at least one active admin

**Everywhere**
- Search across everything with **Ctrl K** (or **/**)
- Change history on every record
- Light and dark mode, full phone layout, keyboard friendly
- Bangladeshi number formatting (৳1,25,000; lakh and crore); currency symbol is configurable

---

## Roles

| | Admin | Member | Viewer |
|---|:---:|:---:|:---:|
| See dashboards, tasks, products, people | ✓ | ✓ | ✓ |
| Log expenses (own claims) | ✓ | ✓ | |
| Edit or delete own claim while pending | ✓ | ✓ | |
| Approve, reject, pay out expenses | ✓ | | |
| See everyone's expenses | ✓ | optional | ✓ |
| Create, edit and move tasks | ✓ | ✓ | |
| Add and edit products, adjust stock | ✓ | ✓ | |
| Delete products | ✓ | | |
| Add and edit people, see salaries and HR fields | ✓ | | |
| Budgets, categories, workspace settings | ✓ | | |
| Approve sign-ups, change roles and access | ✓ | | |

- The **first account that signs up becomes the admin** automatically.
- Everyone who signs up after that waits as **pending** and sees nothing until an admin approves them.
- An admin can turn off anyone's access instantly; their open sessions lose access straight away.

---

## Set up (about 15 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free tier is enough to start). Pick the region closest to your team, for example **Singapore** for Bangladesh.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It creates the tables, roles, security rules, audit log, stock function, the private `receipts` storage bucket and realtime. Running it again later is safe.

### 2. Configure sign-in
In **Authentication → URL Configuration**:
- **Site URL**: the address where the app will live, for example `https://YOUR-USERNAME.github.io/aamaritoaid/`
- **Redirect URLs**: add the same address, plus `http://localhost:8000/` for local testing

Under **Authentication → Providers → Email**, keep email sign-in on. Turning on **Confirm email** is recommended; new people then confirm their address before signing in.

### 3. Connect the app
1. In Supabase copy the **Project URL** (Project Settings → Data API, or the green **Connect** button) and the **publishable key** (Project Settings → API Keys, starts with `sb_publishable_`). On older projects the legacy **anon public** key (starts with `eyJ`) works too.
2. Copy `js/config.example.js` to `js/config.js` and paste both values in.

The publishable key is designed to be public: it can only do what the row-level security rules allow. **Never** put a secret key (`sb_secret_...`) or the `service_role` key in the app.

### 4. Run it locally
Any static file server works, for example:

```bash
cd aamaritoaid
python3 -m http.server 8000
```

Open http://localhost:8000, click **Create an account**, and sign up. That first account is your admin.

---

## Put it on GitHub and deploy

### Upload to GitHub
```bash
cd aamaritoaid
git init
git add .
git commit -m "aamaritoaid workspace"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/aamaritoaid.git
git push -u origin main
```

`js/config.js` is listed in `.gitignore`, so your keys are not committed by default. Choose one of these:

### Option A: GitHub Pages with the included workflow (recommended)
1. In your repository open **Settings → Secrets and variables → Actions → Variables** and add two repository variables:
   - `SUPABASE_URL`: your project URL
   - `SUPABASE_ANON_KEY`: your publishable key
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` writes `js/config.js` from those variables and publishes the site at `https://YOUR-USERNAME.github.io/aamaritoaid/`.

### Option B: commit the config file
Remove the `js/config.js` line from `.gitignore` and commit the file. This is safe because the publishable key is public by design. It then works on GitHub Pages (Settings → Pages → Deploy from branch → `main` / root), Netlify, Vercel, Cloudflare Pages or any static host, with no build command and the repository root as the output folder.

After deploying, make sure the live address is in Supabase's **Site URL** and **Redirect URLs**, otherwise confirmation and password-reset emails link to the wrong place.

---

## Day-to-day admin

- **Approve new people:** they sign up at your site's address, then show up under **Users & access → Waiting for approval**. Approve them as Member or Viewer.
- **Link accounts to people:** open a person in **People** and choose their **Login account**. Their new expenses then default to their own name.
- **Let members see every expense:** **Workspace → Members can see everyone's expenses**.
- **Budgets and categories:** **Workspace → Expense categories and monthly budgets**.
- **Recover the admin role:** if you ever lock yourself out, run this in the Supabase SQL Editor:
  ```sql
  update public.profiles set role = 'admin', active = true where email = 'you@example.com';
  ```
- **Backups:** Supabase takes daily backups on paid plans. On the free plan, export a copy now and then from **Database → Backups** or with `pg_dump`.

---

## Project structure

```
aamaritoaid/
├── index.html               App shell and icons
├── css/app.css              All styles (light and dark themes, phone layout)
├── js/
│   ├── main.js              Start-up, sign-in flow, routing, events, search, CSV
│   ├── auth.js              Sign in, sign up, password reset, waiting screens
│   ├── data.js              Supabase queries, realtime, receipts, error messages
│   ├── views.js             Overview, Expenses, Tasks, Products, People, Users, Workspace
│   ├── drawer.js            Create, view and edit panel; history; account
│   ├── state.js             Shared state, constants, role permissions (UI)
│   ├── util.js              Formatting and helpers
│   ├── lib/supabase.js      Supabase client set-up
│   └── config.example.js    Copy to config.js and fill in
├── supabase/schema.sql      Database: tables, security rules, triggers, functions
├── assets/favicon.svg
└── .github/workflows/deploy.yml   GitHub Pages deployment
```

### How security works
- **Row-level security** is on for every table. Policies call `my_role()`, which reads the signed-in user's role and treats deactivated users as having no access.
- **Triggers** stop anyone but an admin from approving expenses or changing roles, stamp `created_by` and timestamps so they cannot be forged, protect the last admin, and write the audit log.
- **Salaries and HR fields** live in `people_private`, which only admins can read or write.
- **Receipts** are in a private storage bucket; each person uploads into their own folder and files are opened through signed links that expire after 5 minutes.
- The browser only hides buttons a role can't use. The database refuses the action either way.

The permission rules were tested against Postgres 16 for admin, member, viewer, waiting and deactivated accounts, including attempts to self-approve, change one's own role, read salaries, forge audit entries and push stock below zero.

---

## Customising

- **Brand colours and fonts:** the tokens at the top of `css/app.css`
- **Expense statuses, payment methods, units, employment types:** `js/state.js`
- **Default categories and departments:** set them in the app under **Workspace**, or change the defaults in `supabase/schema.sql`

## Tech
- Frontend: vanilla JavaScript ES modules, no framework or bundler
- [supabase-js](https://github.com/supabase/supabase-js) 2.100.0, loaded from jsDelivr
- Supabase: Postgres 15+, Auth, Storage, Realtime

## License
MIT. See [LICENSE](LICENSE).
