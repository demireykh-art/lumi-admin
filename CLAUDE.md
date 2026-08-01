# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal ERP for THE CLINIC LUMI (루미의원), a Korean aesthetic clinic. Two separate
static web apps backed by Firebase (project `lumiclinic-c1a95`). The codebase and all
commit messages are in **Korean**; currency is KRW. There is **no build step, no
bundler, and no framework** — plain HTML/CSS/JS served as static files, with Firebase
compat SDKs and other libraries pulled from CDNs at runtime.

- **`index.html`** — 경영관리 portal (management/admin ERP, desktop). Loads a chain of
  global `*.js` module scripts.
- **`staff.html`** — Staff app (mobile-first, ~540KB single file with mostly inline
  styles/scripts). Loads only `supplies-catalog.js` and `version-check.js`.

## Commands

There is no test suite, linter, or root `package.json`. The only npm project is
`functions/`.

```bash
# Cloud Functions (Node 20)
cd functions && npm install
firebase deploy --only functions          # deploy to asia-northeast3
firebase emulators:start --only functions # run locally

# Static apps: no build — open the HTML directly or serve the repo root, e.g.
python3 -m http.server 8000
```

`firebase.json` only configures the `functions` codebase; static hosting is not wired
up in this repo, so front-end changes are deployed by whatever hosting mechanism is
configured outside it (edit the HTML/JS files directly — nothing to compile).

## Architecture

### index.html (admin portal) — global-namespace module chain

Everything runs in the **global scope**; there are no ES modules or imports. Script
load order in `index.html` matters and is the backbone of the app:

1. `firebase-config.js` — initializes Firebase (`db`, `auth`, `functions` globals),
   declares **all shared mutable state as global variables** (`employees`,
   `revenueData`, `salesDetail`, `fixedExpenses`, `inventoryItems`, `recipes`, …),
   holds the auth flow (`auth.onAuthStateChanged` → `initApp`), the top-level data
   loaders (`loadAllData`, `loadEmployees`, `loadRevenueData`, …), and the render
   dispatch that calls into the module files.
2. Feature modules, each defining global `render*`/handler functions that read and
   mutate those globals: `revenue.js`, `expense-categories.js`, `card-statements.js`,
   `expense.js`, `hr-attendance.js`, `inventory.js`, `finance.js`.
3. `version-check.js` — client-side cache-busting (see below).

Because state and functions are global, a module calls another module's function
directly (e.g. `firebase-config.js` does `if(typeof renderCharts==='function')
renderCharts()`). When adding a data collection, wire it through: a global variable +
a loader in `firebase-config.js` + a `render*` in the relevant module. Navigation is
tab-based (`.nav-tab[data-tab]` in `index.html`: 매출/지출/직원관리/재고관리/손익
리포트/설정).

Cache-busting on module `<script src>` uses manual `?v=YYYYMMDD` query strings (e.g.
`hr-attendance.js?v=20260613b`) — bump these when shipping a change that browsers must
not serve stale.

### staff.html (staff app)

Largely self-contained: inline HTML/CSS/JS plus `supplies-catalog.js`. Same Firebase
project and collections as the admin portal.

### Cloud Functions (`functions/index.js`, region `asia-northeast3`)

- `resetUserPassword` (callable) — bizAdmin-only Firebase Auth password reset; sets
  `mustChangePassword` on the employee doc to force a self-set on next login.
- `webhookKakao` / `webhookNaver` (onRequest) — inbound customer-chat webhooks (KakaoTalk
  / Naver TalkTalk), still stubbed (signature verification TODO). Write into
  `chatThreads/{id}/messages`.
- `sendChatReply` (callable) — staff → Kakao/Naver outbound reply.

### Auth & authorization model

Firebase Auth email/password (LOCAL persistence). **Business-admin authorization is a
whitelist**: `settings/bizAdmins.emails` (checked both client-side in
`firebase-config.js` and server-side in `resetUserPassword`). Auto-logout timeouts live
in `settings/admin` and `settings/staff` (`autoLogoutMinutes`). A legacy `admins`
collection and `config/passwords` also exist.

### Firestore collections (shared by both apps)

`employees`, `attendance`, `revenue`, `salesDetail`, `fixedExpenses`,
`variableExpenses`, `incentiveItems`, `incentiveRecords`, `monthlyIncentiveInput`,
`payroll`, `leaveRequests`, `lunchOT`, `mealRecords`, `inventory`, `inventoryLogs`,
`inventoryAudits`, `recipes`, `supplies`/`purchaseRequests`, `cards`, `categoryRules`,
`vatTaxes`, `incomeTaxes`, `withholdingTaxes`, `chatThreads` (+ `messages` subcollection),
`locations`, `settings`, `config`, `admins`.

Docs in monthly collections are keyed by `YYYY-MM` (see `getYM()`); loaders often filter
with `.where('date','>=', ym+'-01')`.

### version-check.js

Loaded by both apps. After 20s, polls a HEAD request against the current page every 60s;
if `ETag`/`Last-Modified` changes, shows a reload banner (auto-reload countdown, paused
while the user is typing or a `.modal.active` is open). Failures are silently ignored.

## Other files

- `expense-upload-parser.html` — standalone one-off tool (older Firebase 9.23 compat SDK)
  for bulk-importing expense data.
- `quote/*.py` — one-off `reportlab` scripts that generate the project quote/guide PDFs;
  unrelated to the running app.
- `treatments-seed.json` — seed data for treatments/수가표.
