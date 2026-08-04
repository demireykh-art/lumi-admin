# CLAUDE.md

Guidance for AI assistants (Claude Code) working in this repository.

> The product is a Korean-language clinic management suite for **루미의원 / THE CLINIC LUMI**.
> UI text, domain terms, commit messages, and the design docs are in Korean — keep new
> user-facing strings and commit messages in Korean to match. This file is in English for
> quick orientation; the authoritative feature/spec docs live in `docs/` (also Korean).

## What this is

A **Firebase-backed, buildless web app** — plain HTML + vanilla JS served as static files,
with all persistence in Cloud Firestore and privileged work in Cloud Functions. There is
**no bundler, no framework, no package.json at the repo root, and no build step** for the
front end. Scripts are loaded with `<script src="...">` tags and every function lives on
the global scope (`window`). Do not introduce a build toolchain, modules (`import`/`export`),
or a framework without an explicit request.

- **Firebase project**: `lumiclinic-c1a95`
- **Cloud Functions region**: `asia-northeast3` (Seoul)
- **Firebase SDK**: `10.7.0` **compat** build, loaded from `gstatic.com` CDN (`firebase-*-compat.js`)
- **Front-end hosting**: Vercel (auto-deploy on push to `main`) — *not* Firebase Hosting

## The two front-end apps

| App | File | Audience | Scope |
|---|---|---|---|
| **경영관리 (Management ERP)** | `index.html` | 경영관리자 (business admins) | Revenue, expenses, cards, payroll, taxes, incentives, inventory |
| **통합앱 (Integrated Staff App)** | `staff.html` | Clinic staff & doctors | Inventory, fee schedule, consult charting, notices, HR/attendance, customer chat, STAFF admin |

Both share the same Firebase project, `firebase-config.js`, `styles.css`, and `version-check.js`.

### `index.html` — 경영관리 ERP
Loads a set of sibling JS files (each is a plain script defining global `render*`/handler
functions), in this order (see the bottom of `index.html`):

```
firebase-config.js  → revenue.js → expense-categories.js → card-statements.js
→ expense.js → hr-attendance.js → inventory.js → finance.js → version-check.js
```

- `firebase-config.js` — initializes Firebase (`db`, `auth`, `functions`) **and holds the
  shared global state** (`employees`, `attendance`, `revenueData`, `fixedExpenses`,
  `incentiveItems`, `currentYear`/`currentMonth`, etc.). Included first everywhere.
- `revenue.js` / `expense.js` / `card-statements.js` / `expense-categories.js` — finance domains
- `hr-attendance.js` — attendance & payroll
- `inventory.js` / `supplies-catalog.js` — inventory (catalog helper is used by `staff.html`)
- `finance.js` — finance rollups / dashboards
- `expense-upload-parser.html` — standalone helper page for parsing uploaded expense files
- Extra CDN libs used here: Chart.js 4.4.1, SheetJS/xlsx 0.18.5, pdf.js 3.11.174

### `staff.html` — 통합앱
A **single very large (~700KB) self-contained file**: markup, one big inline `<script>`,
and most feature logic all live here. Only `supplies-catalog.js` and `version-check.js` are
loaded as external scripts. When editing, search within `staff.html` for the feature area
rather than expecting separate module files.

Feature areas inside `staff.html` (see `docs/integrated-app.md` for the living feature list):
- 📦 Inventory (audits, receiving, location moves, reorder suggestions, usage charts, vendors)
- 💊 Fee schedule (`settings/feeSchedule`) — 3-level category/treatment/variant tree, inline edit
- 📋 Consult charting v2 (`visits`) — 3 role sections; see `docs/charting-v2.md`
- 🌳 Consult tree (`settings/consultTree`) editor + backups
- 📢 Notices / to-dos (`notices`)
- ⚙ Admin settings modal (business admins only)
- 🕐 HR / attendance & 💰 payroll·incentives
- 👥 STAFF admin (대표원장 only) — calendar, approvals, attendance, OT, payroll, revenue
- 💬 Customer chat (Kakao/Naver integration — owned by the "chat" workstream, see ownership below)

## Cloud Functions (`functions/`)

Node 20, `firebase-functions` v6 (v2 API), `firebase-admin` v12. Deployed separately from
the front end. `functions/index.js` exports:

| Function | Type | Purpose |
|---|---|---|
| `resetUserPassword` | `onCall` | Admin resets a staff account password |
| `webhookKakao` | `onRequest` | Inbound Kakao chat webhook |
| `webhookNaver` | `onRequest` | Inbound Naver chat webhook |
| `sendChatReply` | `onCall` | Send a reply to a chat thread |
| `listRevenueFiles` | `onCall` | List revenue xlsx files in a Google Drive folder |
| `parseRevenueFile` | `onCall` | Parse `오더판매내역및환자내역_YYYYMM.xlsx` → Firestore `revenue/{ym}` |

- Google Drive access uses a **Service Account** via the `DRIVE_SERVICE_KEY` secret
  (`defineSecret`). Dependencies: `googleapis`, `xlsx`.
- The revenue parser (`parseRevenueFile`) must stay **schema-compatible with `revenue.js`** in
  the ERP app — recent commits fixed drift between the two. If you touch one, check the other.

## Firestore data model (key collections)

Shared/live data is Firestore with **realtime snapshot listeners** (cross-device sync).

- `settings/*` — singletons: `bizAdmins`, `adminHigh`, `staff`, `employees`, `feeSchedule`,
  `consultTree`, `autoLogoutMinutes`, etc. (access + config live here)
- `employees`, `attendance`, `leaveRequests`, `lunchOT`, `mealRecords` — HR
- `incentiveItems`, `incentiveRecords`, `monthlyIncentiveInput/{ym}`, `payroll` — payroll/incentives
- `revenue/{ym}`, `salesDetail` — revenue
- `fixedExpenses`, `variableExpenses`, `cards`, `categoryRules` — expenses (ERP)
- `inventory`, `locations`, `vendors`, `receiveHistory`, `inventoryTransactions`,
  `inventoryAudits`, `inventoryLogs`, `purchaseRequests` — inventory
- `visits` — consult charts (3-section schema, read-time migration via `_migrateVisit`)
- `procedures` — procedure master, auto-derived from `feeSchedule` variants
- `vouchers` — session/amount vouchers (charting v2)
- `notices`, `followups`, `consultTreeBackups`
- `chatThreads`, `messages` — customer chat

## Roles & access control

- **Account type**: `shared` (공용 staff kiosk account) vs personal (employee). Check via
  `isSharedAccount()` / `currentUser.role==='shared'`. Some home cards are personal-only.
- **bizAdmins** (`settings/bizAdmins.emails`) — business admins; gate the ⚙ admin settings
  modal with `isBizAdmin`.
- **adminHigh** (`settings/adminHigh.emails`) — 대표원장 (director); gates the 👥 STAFF area
  via `isAdminHigh`.
- **chartRole** (`employees.chartRole`: `doctor` | `consultant` | `staff` | `multi`) — controls
  which charting section a user can edit. adminHigh is treated as `multi`. See `docs/charting-v2.md`.

## Conventions

**Data & state**
- Shared data → Firestore + realtime snapshots. Personal/UI-only state → `localStorage`.
- When migrating local→Firestore data, guard with a `xxx_migrated_v1`-style flag to avoid dupes.
- New Firestore fields should be optional/back-compat; add read-time migration if a schema changes
  (`visits` uses `_migrateVisit` to promote legacy fields).

**Editing UX (staff.html)**
- Inline edits use **double-tap / double-click** (prevents accidental edits on tablets).
- An open editor tints its background yellow (`#fef3c7`); only **one row is editable at a time**.

**Cache busting**
- `version-check.js` polls the current HTML (HEAD request, ETag/Last-Modified) and shows a
  reload banner when a new deploy is detected. Externally-loaded scripts are versioned with a
  query string (e.g. `inventory.js?v=20260613d`) — bump the `?v=` when you change such a file.

**Adding features (common patterns)** — from `docs/integrated-app.md`:
- New home card in `staff.html`: add a `<button onclick="showTop('newview')">`, a
  `<div class="tab-content" id="tab-newview">`, a case in `showTop`, and decide shared vs
  personal visibility.
- New admin setting: define a `settings/xxx` doc, add UI to the ⚙ admin modal, gate with `isBizAdmin`.

## Build, deploy, run

- **No build step.** Open `index.html` / `staff.html` directly or serve statically (e.g.
  `python3 -m http.server`). There is nothing to compile and no test suite in this repo.
- **Front-end deploy**: push to `main` → **Vercel auto-deploys** `index.html` / `staff.html`
  and the static assets.
- **Functions deploy**: `cd functions && npm install && firebase deploy --only functions`
  (uses `.firebaserc` default project `lumiclinic-c1a95`). Set the `DRIVE_SERVICE_KEY` secret
  before deploying the Drive functions.

## Git workflow

- Develop on the branch assigned for the task; create it from the latest `main` if needed.
- **Never** push directly to `main` without explicit permission. Do **not** open a PR unless asked.
- Commit message convention (Korean subjects are the norm):
  `feat|fix|refactor|chore(staff|admin|functions|hr|...): <설명>`
  — see `git log` for many examples.

## `quote/` — sales collateral (unrelated to the app)

Python (reportlab) scripts that generate the Korean sales quote / guide PDFs
(`generate_quote.py`, `generate_guide.py`). These are one-off document generators for the
project's own quote, not part of the deployed application. They depend on Nanum fonts.

## Docs — read these first for feature work

- `docs/integrated-app.md` — living status/plan doc for `staff.html` (everything except chat).
  **Update it when you finish a feature** (move to "완성된 기능", adjust file ownership).
- `docs/charting-v2.md` — full spec for consult charting v2 (roles, `procedures`/recipes,
  `vouchers`, inventory auto-deduction).

### File / workstream ownership (avoid cross-session conflicts)
`staff.html` is edited by parallel workstreams. Chat-related code — `_initChatRealtime`,
`renderChatList`, `openChatThread`, and other `chat*` / `_chat*` functions — belongs to the
customer-chat workstream. Coordinate before editing another workstream's area.
