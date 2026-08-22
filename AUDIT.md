# AUDIT.md — Phase 0 조사 보고서

- 작성일: 2026-08-22
- 대상 커밋: `c656612` (main)
- 조사 범위: 레포 전체 (`staff.html` 16,039줄 / `index.html` 1,051줄 / JS 8개 / `functions/index.js` 1,358줄 / `firestore.rules` 131줄)
- **코드 변경 없음.** 조사·판정만 수행했습니다.

> 참고: 지시서(`BRIEF.md`)와 `admin.html`은 레포 루트에 없고 업로드 파일로 받았습니다. 두 파일 모두 아직 커밋되지 않은 상태입니다.

---

## 0. 요약 — 먼저 결론

| 질문 | 답 |
|---|---|
| **CRM을 끄면 재고가 깨지는가?** | **깨지지 않는다.** 재고 코드에서 CRM을 참조하는 지점 **0건**. 의존은 전부 CRM → 재고 단방향. |
| 그럼 뭘 잃는가? | ① 차팅 준비완료 시 **재고 자동차감**(`inventoryTransactions`) ② 관리자앱 재고탭의 **레시피/시술원가 서브탭** ③ 매출 업로드 시 레시피 기반 자동차감. 셋 다 SaaS 판매 대상이 아니다. |
| 가장 큰 리스크는? | 재고가 아니라 **`staff.html` 단일 파일 구조**와 **컬렉션 60개 규모의 Rules 재작성**. 그리고 **홈페이지(lumiclinic.co.kr)가 같은 Firestore·같은 Rules 파일을 공유**한다는 점. |
| 지시서에 빠진 것 | **CRM 격리(Phase 0.5)가 Phase 번호를 못 받았다.** 그리고 **매출·비용·세무 모듈(관리자앱 전체)이 3개 모듈 어디에도 매핑되지 않는다.** → §6 질문 참조 |

---

## 1. 하드코딩 인벤토리

### 1-1. `lumi` 계열 문자열

전체 **86건**. 성격별로 나누면 위험도가 크게 다릅니다.

| 종류 | 건수 | 위치 | 판정 |
|---|---|---|---|
| `@lumi.local` | 15 | `staff.html`×8, `index.html`×2, `hr-attendance.js`×4, `functions/index.js`×1 | **설정값 필수** — `settings/profile.slug`로 |
| `lumiclinic-c1a95` (Firebase 프로젝트) | 14 | `firebase-config.js`, `staff.html:2478`, `expense-upload-parser.html`, `functions/`, `.firebaserc` | **그대로 둔다** — 전 병원이 한 프로젝트를 공유하는 멀티테넌시이므로 변경 불필요 |
| `lumiclinic.co.kr` | 8 | 홈 링크, OG 태그, 공용계정 이메일 예시 | **설정값** — `settings/profile.homepage` (선택) |
| `lumi_*` localStorage 키 | 18 | `lumi_staff_user`, `lumi_biometric_credential`, `lumi_biometric_user`, `lumi_admin_auth` | **⚠️ 반드시 테넌트 스코프화** — §1-6 참조 |
| `LUMI` 브랜드 표기 | 21 | `<title>`, 로그인 로고, OG, WebAuthn `rp.name` | **설정값** — `settings/profile.name` |
| `SHARED_ACCOUNT_ID='lumistaff'` + `startsWith('lumi')` 필터 | 8 | `staff.html:2618, 2667, 5362, 11605, 11804, 12802, 13142` | **⚠️ 최우선 제거** — §1-5 참조 |

**가장 위험한 것 (`staff.html:2667`, `12802`, `13142`)**

```js
.filter(e => (!e.status||e.status==='active') && !String(e.id||'').startsWith('lumi'))
```

직원 목록에서 **문서 ID가 `lumi`로 시작하면 숨긴다**. 공용계정(`lumistaff`)을 걸러내려는 의도지만, 다른 병원에 `lumina`, `lumiel` 같은 ID를 가진 실제 직원이 생기면 **그 직원이 급여·인센티브 정산에서 조용히 사라집니다.** 오류도 안 납니다. 반드시 `role==='shared'` 플래그 기반으로 교체해야 합니다.

### 1-2. 층·장소 (`5층`/`6층`)

**87건** (5층 42 / 6층 45). 파일별: `staff.html` 71, `inventory.js` 8, `index.html` 4, `supplies-catalog.js` 4.

| 유형 | 대표 위치 | 판정 |
|---|---|---|
| 시드 장소 목록 (하드코딩 13개소) | `staff.html:15537-15540`, `15573-15576` | **설정값** → `settings/locations.places[]` |
| `<select>` 옵션 | `staff.html:1768-1769`, `1966-1967`, `index.html` | **설정값** — 동적 렌더로 |
| 층 그룹핑 정렬·필터 로직 | `staff.html:5785, 5968-5990, 6353, 6500, 14266-14270`, `inventory.js:41-49` | **설정값 + 로직 일반화** — 층 개수를 2개로 가정한 분기가 다수 |
| 키 규칙 `"{floor}-{name}"` | 전역 | **그대로 둔다** — 규칙 자체는 문제없음. 단 `5층-5층-처치실` 같은 중복 접두 legacy 키 처리 코드(`staff.html:15110`)가 이미 존재 |

⚠️ `inventory.items[].locations`는 **`"6층-준비실 냉장고"` 같은 문자열을 그대로 key로 쓰는 map**입니다. 장소 이름을 바꾸면 전 품목 문서를 rekey해야 하고, 실제로 그 마이그레이션 코드가 이미 있습니다(`staff.html:6128-6150`). Phase 3에서 장소를 설정값으로 뺄 때 **key를 placeId로 바꾸는 유혹을 참으세요** — 이관 비용이 재고 문서 전체입니다. 이름 그대로 두고 `settings/locations`는 목록만 관리하는 편이 안전합니다.

### 1-3. 하드코딩 enum 판정표

| # | enum | 값 | 위치 (중복 포함) | 판정 |
|---|---|---|---|---|
| 1 | **직급** | `doctor, nurse, coordinator, marketing, manager, esthetician` | `staff.html:2323, 2550, 12778`, `firebase-config.js:23`, `hr-attendance.js:12, 485, 525, 1089, 1327`, `index.html:625` — **동일 리터럴이 8곳에 복붙** | **설정값** → `settings/org.ranks[]`. 성형/정형은 직급 체계가 다름. **복붙 8곳부터 단일 소스로 합쳐야 함** |
| 2 | **재고 카테고리** | `nursing(간호), skin(피부), desk(데스크), common(공통)` | `staff.html:5746, 6222, 9801, 13746, 13761` + `<option>` 6곳, `inventory.js:5-6`, `index.html`×3 | **설정값** → `settings/org.stockCategories[]`. 정형외과에 "피부"는 무의미 |
| 3 | **재고 타입** | `disposable(1회용), portioned(소분용), hygiene(위생용품)` | `staff.html:1432-1434`, `inventory.js:3-4`, `index.html:975-977` | **그대로 둔다.** 과가 달라도 "1회용/소분용/위생용품"은 그대로 통함. 단 `portioned`에 걸린 **로스율 10%**(`inventory.js:7 LOSS_RATE`)와 **기본위생비 ₩1,000**(`BASE_HYGIENE_COST`)은 설정값 |
| 4 | **인센티브 유형** | `none, totalMinusPersonal, personal, totalAll` + `incJapan`(일본인 건별 ₩10,000 고정) + 항목 타입 `perCase, salesPercent, japanSales` | `staff.html:2362-2384(UI), 4656-4690(계산), 12755, 12868-12874, 13247-13251`, `revenue.js:154`, `hr-attendance.js:300-307` | **설정값 — 그리고 가장 어려움.** §1-4 참조 |
| 5 | **식대 정책** | 월한도제 / 일할적립제 | `staff.html:4210-4249, 12552-12619` — **이미 `settings/mealPolicy`에 있음** (`{mode, history[], monthlyLimit, dailyAmount}`) | **이미 설정값.** 하드코딩은 기본값 2개뿐: `MEAL_DAILY_DEFAULT=14000`, `MEAL_MONTHLY_DEFAULT=300000` (`staff.html:4225-4226`) → 시드 템플릿으로 이동 |
| 6 | **근태 GPS·지각기준·요일별 퇴근시간** | `CLINIC_LAT/LNG/RADIUS`, `09:10`, 요일별 18:30/18:00/15:00 | `staff.html:2494-2506` — **이미 `settings/attendance`로 override 가능** | **이미 설정값.** 기본값만 시드로 이동 |
| 7 | **공휴일표** | `KR_HOLIDAYS_DEFAULT` 2026년치 | `staff.html:9497~` | **그대로 둔다** (전국 공통). 병원별 휴무는 이미 `clinicSchedule`로 분리됨 |
| 8 | **인계 부서** | `doctor, desk, skin, nursing, common` | `staff.html:9796-9802` + `_myHandoverDept()` 매핑 `9823-9840` | **설정값** — #1(직급), #2(재고 카테고리)와 함께 묶여야 함 |
| 9 | **공용계정 이메일 local-part → 카테고리** | `nurse→nursing, desk→desk, skin→skin` | `staff.html:6768`, `9827` | **설정값** — 공용계정 정의를 `settings/org`로 |
| 10 | **Google Drive 매출 폴더** | `REVENUE_FOLDER_ID='1BLzrDhy8mvWUa27RsKlwhYV9sOYhG5iI'` | `functions/index.js:370` | **설정값 필수 (테넌트별)** — 다만 §6 질문 참조 |

### 1-4. 인센티브 — 지시서 판단이 맞고, 마이그레이션이 진짜 일이다

지시서는 "1차 버전에서 규칙 빌더를 만들지 않는다"고 했습니다. **동의합니다.** 현재 구조를 보면 그 판단이 옳습니다.

현재 로직(`staff.html:4640-4715`)은 두 축이 섞여 있습니다.

1. **직원 문서 필드 기반 매출 인센티브** — `emp.incType` + `incPercent` + `incRounding` + `incJapan` + `personalSalesSource`. 계산 소스는 `monthlyIncentiveInput` (총매출·일본인방문객수·직원별매출).
2. **`incentiveItems` 컬렉션 기반 건별 인센티브** — `type: perCase | salesPercent | japanSales`, 실적은 `incentiveRecords`.

지시서의 3종(`perCase` / `percent+ownRevenue` / `manual`)에 매핑하면:

| 현재 | 지시서 3종 매핑 | 문제 |
|---|---|---|
| `personal` (본인 매출 기반) | `{type:'percent', base:'ownRevenue'}` | 깔끔히 매핑됨 |
| `totalAll` (총매출 전체) | ❌ 매핑 없음 | `base:'totalRevenue'`가 3종에 없음 |
| `totalMinusPersonal` (총매출 − 개인매출합) | ❌ 매핑 없음 | 파생 집계값. `manual`로 밀 수밖에 없음 |
| `incJapan` (일본인 1명당 ₩10,000) | `{type:'perCase', amount:10000}` | 매핑되지만 **"건수"의 소스가 매출 업로드 자동 집계**라 수동 입력과 성격이 다름 |
| `incentiveItems.perCase` | `{type:'perCase'}` | 깔끔히 매핑됨 |
| `incentiveItems.salesPercent / japanSales` | ❌ | `manual`로 |

**즉 루미 현행 5종 중 3종이 `manual`로 강등됩니다.** 루미클리닉은 매일 실사용 중이므로, SaaS 스키마로 바꾸는 순간 **루미의 인센티브가 자동계산에서 수기입력으로 퇴행**합니다.

**제안:** `settings/org.incentiveRules[]`에 지시서 3종을 신규 정의하되, **루미 인스턴스는 legacy 필드(`emp.incType` 등)를 그대로 읽는 경로를 남깁니다.** 새 병원만 3종을 쓰고, 루미는 파일럿 5곳 결과가 나올 때까지 현행 유지. 이건 지시서의 "범위를 임의로 확장하지 말 것"과 충돌하지 않습니다 — 새 기능을 만드는 게 아니라 **기존 동작을 깨뜨리지 않는 것**이고, 지시서 작업규칙 "기존 동작을 깨뜨리는 변경은 반드시 사전에 알린다"에 해당합니다. **이 건은 승인이 필요합니다.**

### 1-5. `settings/` 단일 컬렉션 과부하

`settings` 컬렉션 하나에 **13종의 이질적인 문서**가 들어 있습니다.

| 문서 | 용도 | 모듈 |
|---|---|---|
| `staff` | 공용계정 이메일 화이트리스트 | core (인증) |
| `employees` | 개인계정 이메일 화이트리스트 | core (인증) |
| `bizAdmins` | 경영관리자 이메일 | 플랫폼 |
| `adminHigh` | 대표원장급 이메일 | 플랫폼 |
| `admin` | (레거시) | ? |
| `attendance` | GPS·지각기준·요일 스케줄 | core |
| `mealPolicy` | 식대 투트랙 정책 | payroll |
| `feeSchedule` | **시술 수가표 전체 (JSON 문자열 1개 필드)** | **CRM** |
| `consultTree` / `consultAnesth` | 상담 트리 | **CRM** |
| `chatConfig` | 고객 채팅 설정 | **CRM** |
| `chartEquipment` | 장비 마스터 | **CRM** |
| `orderCategoryMap` | 오더 분류 매핑 | CRM/매출 |

+ 홈페이지 전용 8종 (`treatmentMenu`, `heroSlider`, `spaceGallery`, `schedule`, `feeInfo`, `pageLayout`, `gallery`, `clinicHours`) — Rules에서 **비로그인 읽기 허용** 중.

**Phase 1에서 이 컬렉션은 그냥 옮기면 안 됩니다.** 지시서의 `settings/{modules, profile, org, locations}` 4종과 현행 13종을 매핑하는 별도 설계가 필요하고, **CRM 문서 4종(`feeSchedule`, `consultTree`, `consultAnesth`, `chatConfig`, `chartEquipment`)은 `clinics/{cid}/crm/` 같은 별도 네임스페이스로 빼야** Rules 한 줄로 차단할 수 있습니다.

### 1-6. localStorage — 완료기준 #5의 실질적 걸림돌

**80회 사용, 키 20종.** 전부 테넌트 스코프가 없습니다.

```
lumi_staff_user, lumi_biometric_credential, lumi_biometric_user, lumi_admin_auth,
staff_fee_cats_v2, staff_fee_tax_v1, staff_consult_tree_v2/v3, staff_notices_v1,
staff_clinic_sched_v1, staff_handovers_v1, staff_vendors_v1, staff_anesthesia_opts_v1,
staff_fee_collapsed_v1, staff_fee_cat/maj/mid_collapsed_v1, staff_consult_saved_v1,
staff_*_migrated_v1 (마이그레이션 완료 플래그 4종)
```

완료기준 **"병원 2곳을 동시에 띄워놓고 데이터가 섞이지 않는다"** — 같은 브라우저의 두 탭은 localStorage를 공유합니다. 현 상태로 A병원·B병원을 동시에 열면 **`staff_vendors_v1`(거래처 캐시), `staff_notices_v1`(공지), `lumi_staff_user`(로그인 세션)가 서로 덮어씁니다.**

특히 `staff_*_migrated_v1` 플래그는 "이 병원은 Firestore 이관 끝남" 표시인데, A병원에서 켜지면 **B병원에서 마이그레이션이 스킵**됩니다.

→ **Phase 2에 "localStorage 키에 clinicId 접두" 작업을 명시적으로 넣어야 합니다.** 지시서에는 없습니다.

---

## 2. Firestore 컬렉션 지도

### 2-1. 최상위 컬렉션 전체 (Rules 기준 47개 + 서브컬렉션 2개)

`firestore.rules`에 화이트리스트된 컬렉션 중 **이 레포에서 실제로 쓰는 것과 안 쓰는 것**을 구분했습니다.

#### A. 이 레포에서 사용 중 (모듈 매핑 대상)

| 컬렉션 | 사용처 | 모듈 | 비고 |
|---|---|---|---|
| `employees` | staff, admin, hr, functions | **core** | 24회 |
| `attendance` | staff, admin, hr | **core** | 12회 |
| `leaveRequests` | staff, admin, hr | **core** | 17회 |
| `notices` | staff | **core** | 7회 |
| `clinicSchedule` | staff | **core** | 진료일정, 문서ID=YYYY-MM-DD |
| `handovers` | staff | **core** | 교육·인계 |
| `settings` | 전역 | **혼합** | §1-5 — 분해 필요 |
| `config` | admin | 비용 | `expenseCategories`, `passwords` |
| `admins` | admin | 플랫폼 | 6회 |
| `lunchOT` | staff, admin, hr | **payroll** | OT |
| `mealRecords` | staff, admin | **payroll** | 식대 |
| `payroll` | admin(expense.js) | **payroll** | |
| `payslips` | staff, admin, hr, functions | **payroll** | ⚠️ §2-4 |
| `incentiveItems` | staff, admin, hr | **payroll** | |
| `incentiveRecords` | staff, admin | **payroll** | |
| `monthlyIncentiveInput` | staff, hr | **payroll** | |
| `inventory` | staff(24), admin | **inventory** | 품목 마스터. `locations` map |
| `inventoryLogs` | staff, admin, revenue.js | **inventory** | 실사·차감 로그 |
| `inventoryAudits` | staff, admin | **inventory** | 실사 세션 |
| `receiveHistory` | staff | **inventory** | 입고 이력 → 발주 예측 소스 |
| `receivingHistory` | staff | **inventory** | ⚠️ `receiveHistory`와 **중복 의심** (§ISSUES 후보) |
| `locations` | staff, admin | **inventory** | 층·장소 마스터 |
| `vendors` | staff | **inventory** | 거래처 |
| `purchaseRequests` | staff, admin | **inventory** | 비품 요청 |
| `suppliesCatalogLinks` | staff | **inventory** | 구매 링크 |
| `suppliesCatalogCustom` | staff | **inventory** | 커스텀 카탈로그 |
| `categoryRules` | card-statements.js | 비용 | |
| `cards` | card-statements.js | 비용 | |
| `revenue` | staff, admin, functions | **미분류** ⚠️ | §6 질문 |
| `salesDetail` | staff, admin, functions | **미분류** ⚠️ | |
| `fixedExpenses` / `variableExpenses` | admin | **미분류** ⚠️ | |
| `incomeTaxes` / `vatTaxes` / `withholdingTaxes` | admin | **미분류** ⚠️ | |
| `inventoryTransactions` | staff **(차팅 전용)** | **CRM→inventory 경계** | §3 |
| `visits` (+ `/followups`) | staff | **CRM** | 상담 차팅 |
| `procedures` | staff | **CRM** | 시술 마스터. **`.recipe[]`가 재고 FK** |
| `recipes` | **inventory.js (관리자앱)** | **경계** ⚠️ | §3-3 |
| `vouchers` | staff | **CRM** | 회차권/금액권 |
| `productRatings` | staff, product-rating.js | **CRM** | `/main` 단일 문서 |
| `procedureTimes` | staff | **CRM** | `/main` 단일 문서 |
| `injectionMixes` | staff | **CRM** | 주사제 믹스 |
| `consultTreeBackups` | staff | **CRM** | |
| `chatThreads` (+ `/messages`) | staff, functions | **CRM** | 고객 채팅 |

#### B. Rules에는 있으나 **이 레포에서 전혀 안 씀** — 홈페이지(lumiclinic.co.kr) 소유

`doctors`, `solutions`, `events`, `treatmentCards`, `equipment`, `ba_items`, `schedules`, `shortUrls`, `reservations`, `analytics_visits`, `analytics_events`, `analytics_daily`, `patients`, `channels`, `treatments`, `feeSchedule`(최상위) — **16개, 사용 0회.**

> ### 🚨 Phase 1·2 최대 제약
> **`firestore.rules`는 이 레포 단독 소유가 아닙니다.** 같은 Firebase 프로젝트(`lumiclinic-c1a95`)의 **공개 홈페이지가 같은 Rules 파일에 의존**하며, 그중 다수가 `allow read: if true` (비로그인 공개)입니다. `reservations`는 `allow create: if true`(누구나 예약 신청), `analytics_daily`는 `allow read, write: if true`입니다.
>
> Phase 2에서 Rules를 `clinics/{cid}/` 구조로 재작성할 때 **이 16개 매치 블록을 건드리면 홈페이지가 죽습니다.** 그리고 마지막 줄 `match /{document=**} { allow read, write: if false; }`가 있으므로, 새 경로를 추가할 때 이 catch-all보다 위에 놓아야 합니다.
>
> → Rules 재작성은 "새 `clinics/**` 블록 추가 + 기존 최상위 블록은 이관 완료 후 단계적 제거" 2단계로 가야 합니다. 한 번에 갈아엎을 수 없습니다.

### 2-2. 지시서 Phase 1 트리와 현실의 차이

지시서가 제시한 트리는 컬렉션 **13개**, 현실은 **31개**(홈페이지 제외)입니다. 누락분:

| 지시서에 없는데 이관해야 하는 것 | 모듈 |
|---|---|
| `notices`, `clinicSchedule`, `handovers` | core |
| `lunchOT`(OT), `monthlyIncentiveInput` | payroll |
| `inventoryLogs`, `inventoryAudits`, `receiveHistory`, `receivingHistory`, `locations`, `suppliesCatalogLinks`, `suppliesCatalogCustom` | inventory |
| `revenue`, `salesDetail`, `fixedExpenses`, `variableExpenses`, `cards`, `categoryRules`, `incomeTaxes`, `vatTaxes`, `withholdingTaxes`, `config` | **미분류** |
| CRM 12종 | CRM |

또 지시서는 `stockItems / stockBatches / stockCounts`라는 **새 이름**을 씁니다. 현행은 `inventory / (배치 개념 없음) / inventoryAudits`입니다. **이름까지 바꾸면 Phase 1이 "경로 이동"에서 "스키마 리네임 + 경로 이동"으로 커집니다.** `stockBatches`에 해당하는 컬렉션은 아예 없습니다(배치는 `receiveHistory`의 `batchNo` 필드로만 존재, `staff.html:15893`).

→ **권고: Phase 1은 경로만 옮기고 이름은 유지.** 리네임은 별도 커밋으로. (승인 필요 — §6)

### 2-3. 컬렉션 간 참조 관계

```
                      ┌─────────────────────── CRM ───────────────────────┐
                      │                                                   │
settings/feeSchedule ─┼─(파생)→ procedures ──.recipe[].itemId──┐          │
   (시술 수가표)       │        (시술 마스터)                    │          │
        │             │             │                          │          │
        │             │             ↓ _procRecipeOf()           │          │
        │             │      visits.staffSection                │          │
        │             │        .prepCards[].recipeSnapshot ─────┤          │
        │             │             │                           │          │
        │             │             ↓ chartingPrepComplete()     │          │
        │             │       inventoryTransactions ────────────┤          │
        │             │        (type:'procedure_use'/'refund')   │          │
        │             │                                         │          │
        │             │  injectionMixes.recipe[].itemId ─────────┤          │
        │             │  vouchers.procId → procedures            │          │
        │             │  procedureTimes ← feeSchedule(오더명)     │          │
        └──.supplies[]{name,price} (스냅샷, FK 아님)              │          │
                      └─────────────────────────────────────────┼──────────┘
                                                                 ↓
        ┌──────────────────── 재고팩 (inventory) ────────────────────────────┐
        │  inventory ←── locations (문자열 key "5층-처치실")                  │
        │      ↑ ↑                                                          │
        │      │ └── inventoryLogs (실사·차감)                               │
        │      │ └── inventoryAudits (실사 세션)                             │
        │      │ └── receiveHistory ──→ 발주 예측 (analyzeItem)              │
        │      │ └── receivingHistory (중복 의심)                            │
        │      └──── purchaseRequests, vendors, suppliesCatalog*             │
        └───────────────────────────────────────────────────────────────────┘
                                        ↑
        ┌── 관리자앱 전용 ────────────────┤
        │  recipes.treatmentName (자유문자열, 매출 엑셀 오더명)                │
        │      ↑ revenue.js deductInventoryByRecipes(salesDetail 오더명 집계) │
        │      ↑ finance.js 원가 계산                                        │
        └────────────────────────────────────────────────────────────────────┘

        ┌── core ──┐   ┌── payroll ──────────────────────────┐
        │ employees│──→│ attendance, lunchOT, mealRecords,   │
        │ leaveReq │   │ payslips, incentive*, payroll       │
        │ notices  │   └─────────────────────────────────────┘
        │ clinicSch│         ↑ monthlyIncentiveInput ← revenue/salesDetail (미분류)
        │ handovers│
        └──────────┘
```

**핵심: CRM → 재고 화살표는 5개, 재고 → CRM 화살표는 0개.**

### 2-4. `payslips` 구조 주의 (Phase 2 비용 영향)

`staff.html:12988-12998` / `hr-attendance.js:1616`

```js
await db.collection('payslips').doc(`${ym}__${emp.id}`).set({
  ym, employeeId, name, authEmail, fileName,
  dataUrl,        // ← PDF 전체가 base64 dataURL로 문서 안에 들어감
  size, deliverAt, uploadedAt, uploadedBy
});
```

**PDF를 Firestore 문서 필드에 base64로 저장합니다.** Firebase Storage는 이 레포 어디에서도 사용하지 않습니다(`firebase.json`에 storage 항목 없음, Storage SDK 로드 안 함).

Phase 2 영향:
- 문서 1MB 제한 → PDF가 ~730KB 넘으면 저장 실패
- 급여명세서 목록을 그리려고 `where('ym','==',ym).get()`을 하면(`staff.html:13107`) **전 직원 PDF를 통째로 다운로드**합니다
- Rules의 `resource.data.uid == request.auth.uid` 검사는 문서 전체를 읽은 뒤 평가되므로, **거부되는 요청도 읽기 비용이 발생**

지시서 범위 밖이지만 Phase 2 read 과금 논의에 직결되므로 기록합니다. (수정은 하지 않았습니다 — 작업규칙에 따라 `ISSUES.md` 후보)

---

## 3. CRM 결합 지점 — **핵심 질문 답변**

### 3-1. 재고 모듈이 CRM을 참조하는 지점: **0건**

재고팩 코드 구역 전체를 스캔했습니다.

| 파일 | 구역 | CRM 참조 |
|---|---|---|
| `staff.html` | 5,700–6,825 (실사·장소·카테고리) | **0건** |
| `staff.html` | 13,469–16,035 (거래처·카탈로그·입고·이동·삭제·비품요청·발주분석) | **0건** ※ |
| `inventory.js` | 전체 705줄 | **0건** (레시피 서브탭 제외, §3-3) |

※ 13,696–13,740에 `_feeData` 참조가 있으나 이는 **상담 트리의 `consultOpenFee()`** 함수가 물리적으로 그 줄 번호에 위치할 뿐, 재고 코드가 아닙니다.

검증한 심볼: `feeSchedule`, `_feeData`, `procedures`, `_procMeta`, `_procCache`, `_procRecipeOf`, `visits`, `recipes`, `vouchers`, `procedureTimes`, `chatThreads`, `productRatings`, `injectionMixes`, `_mixes`.

특히 **발주 예측**은 CRM과 무관합니다(`staff.html:15658-15760`). 소비량을 `receiveHistory` 입고 이력에서 역산합니다:

```js
const totalConsumed = Math.max(0, totalReceived - currentStock);
const monthlyUsage  = totalConsumed / monthsDiff;
```

시술 횟수를 쓰지 않습니다.

### 3-2. CRM → 재고 결합 지점: **5건 (전부 단방향)**

| # | 위치 | 결합 형태 | CRM 끄면 |
|---|---|---|---|
| 1 | `procedures/{procId}.recipe[].itemId` | **진짜 FK** — 시술 마스터가 재고 품목 ID를 참조 | 시술 마스터가 통째로 사라짐. 재고 품목은 무영향 |
| 2 | `staff.html:10791-11000` **재고 자동차감 엔진** | `visits.prepCards[].recipeSnapshot` → `inventory.locations` 트랜잭션 차감 + `inventoryTransactions` 로그 | **차감이 멈춤.** §3-4 |
| 3 | `injectionMixes.recipe[].itemId` (`staff.html:2907-3002`) | FK — 믹스 원가를 재고 단가에서 계산 | 믹스 UI가 사라짐. 재고 무영향 |
| 4 | `settings/feeSchedule` variant `.supplies[]` (`staff.html:8427-8515`) | **스냅샷** — `{name, price, qty, unit}` 값 복사. **itemId 없음** | 무영향 (애초에 참조가 아님) |
| 5 | `_ensureInvItems()` 호출 6곳 (`staff.html:3041, 3067, 3135, 7617, 8378`) | CRM UI가 재고 목록을 **읽기만** | 호출자가 사라짐. 재고 무영향 |

`inventoryTransactions` 컬렉션은 **쓰기 5곳·읽기 3곳이 전부 차팅 섹션(9,967–11,252) 안**에 있습니다. 재고 UI는 이 컬렉션을 **한 번도 읽지 않습니다** — 소진 추이 그래프(`staff.html:14868`)조차 `inventoryAudits + receiveHistory`만 씁니다.

### 3-3. 회색지대 — `recipes` 컬렉션 (관리자앱)

**지시서의 CRM 제외 목록에 `recipes`가 없습니다.** 판정이 필요합니다.

`recipes`는 **시술 마스터와 무관한 별개 컬렉션**입니다. 관리자앱(`index.html` → `inventory.js`)의 **재고 탭 안 "레시피 (시술 원가)" 서브탭**에 붙어 있고, 키는 `treatmentName` — **자유 문자열**입니다. UI 안내문이 명확합니다(`index.html:1022`):

> 시술명 (오더명) * — `매출 엑셀의 오더명과 동일하게`

즉 `recipes`는 **시술 수가표가 아니라 매출 엑셀(`salesDetail`의 오더명)에 이름으로 묶여 있습니다.** 소비처는 둘:

1. `revenue.js:517-575 deductInventoryByRecipes(ym, treatmentCounts)` — 매출 업로드 시 오더명별 건수 × 레시피 → `inventory` 차감 + `inventoryLogs` 기록
2. `finance.js:81-98` — 손익 계산의 재료원가

**판정: `recipes`는 CRM이 아니라 "매출↔재고 원가 브릿지"입니다.** 그런데 매출 모듈 자체가 3개 모듈에 없습니다(§6 질문 1). 잠정 결론:

- **SaaS 재고팩에서 `recipes` 서브탭을 제외**한다 (매출 데이터가 없으면 무의미)
- 루미 인스턴스에서는 유지
- → `CRM_ENABLED` 와 **별개 플래그**가 필요합니다. 매출 모듈 판정에 종속됩니다.

### 3-4. 판정: **CRM을 떼도 재고는 깨지지 않는다**

**근거**

| 기준 | 결과 |
|---|---|
| 재고 코드가 CRM 심볼을 참조하는가 | 아니오 (0건) |
| 재고 코드가 CRM 컬렉션을 읽는가 | 아니오 (0건) |
| CRM 제거 시 재고에서 `undefined` 참조가 발생하는가 | 아니오 — 모든 결합이 CRM 쪽 호출자에 있음 |
| 재고 문서 스키마가 CRM 필드를 갖는가 | 아니오 — `inventory` 문서에 `procId`/`recipeId` 없음 |
| 발주 예측이 시술 데이터를 쓰는가 | 아니오 (`receiveHistory` 기반) |

**단, 두 가지 기능이 사라집니다.**

**(a) 시술 준비 → 재고 자동차감이 없어진다**

이게 유일하게 실질적인 손실입니다. 현재 재고 수량이 줄어드는 경로는 3개:

1. 차팅 준비완료 자동차감 (**CRM**)
2. 매출 업로드 레시피 차감 (`revenue.js`, 관리자앱 — 매출 모듈)
3. **실사 입력** (`onInvInput`, `staff.html:6667-6710`) — 직원이 직접 숫자를 세어 입력

CRM을 끄면 1이 사라지고 **3만 남습니다.** 재고는 "실사로만 맞추는" 모드가 되는데 — SaaS로 파는 재고팩이 **원래 그 모델**입니다(지시서: "재고 실사·입고·배치·유통기한·장소이동·발주예측·거래처·비품요청"). 자동차감은 상품 설명에 없습니다.

**(b) `inventoryTransactions`가 안 쌓인다**

읽는 곳이 없으므로 UI 손상 없음. 다만 **차감 이력이라는 데이터 자산이 사라집니다.**

**→ 분리 제안: 의존성을 뒤집는다**

현재는 CRM이 재고 내부(`inventory.locations` map, `_planDeduction` 그리디 로직, `inventoryTransactions` 스키마)를 직접 조작합니다. 이 상태로 `CRM_ENABLED=false`를 넣으면 **차감 엔진 코드 200줄이 CRM 블록 안에 갇혀** 재고팩에서 영원히 못 씁니다.

```
[지금]                              [제안]
CRM 차팅                            CRM 차팅            재고팩 "수동 사용 등록"
  └→ inventory.locations 직접 조작        └────┬────────────┘
  └→ inventoryTransactions 직접 write          ↓
                                    재고팩 API (재고팩 소유)
                                      consumeStock(items[], {reason, refType, refId})
                                      refundStock(txIds[])
                                        └→ inventory.locations
                                        └→ inventoryTransactions
```

- `consumeStock()` / `refundStock()` 를 **재고팩 코드 구역으로 이동**시키고, `_planDeduction`·`_sumLoc`도 함께 옮긴다
- CRM은 `consumeStock(items, {refType:'visit', refId:visitId})` 를 **호출만** 한다
- `CRM_ENABLED=false`면 호출자만 사라지고, **재고팩은 "사용 등록" 버튼으로 같은 API를 쓸 수 있다** (SaaS 재고팩의 실질 기능 추가)
- `inventoryTransactions.refType`으로 출처를 구분 → CRM 흔적이 스키마에 남지 않음

**공수: 0.5~1인일.** 로직 이동 + 인자 일반화(`visitId/procId/cardId` → `refType/refId`)뿐이고 알고리즘 변경 없음. Phase 0.5(CRM 격리) 안에서 처리하는 게 가장 쌉니다.

### 3-5. CRM 격리 작업 규모 (지시서에 Phase 번호가 없는 항목)

`CRM_ENABLED = false` 로 숨겨야 할 코드:

| 영역 | 위치 | 대략 줄수 |
|---|---|---|
| 시술 마스터 · 장비 마스터 | `staff.html` 2,650–2,905 | 256 |
| 주사제 믹스 | 2,907–3,002 | 96 |
| 바우처 | 3,193–3,436 | 244 |
| 제품 평점 | 6,825–6,978 | 154 |
| 시술시간 | 6,979–7,578 | 600 |
| 시술 수가표 + procedures 파생 | 7,579–8,955 | 1,377 |
| 상담 트리 편집기 | 8,956–9,420 | 465 |
| 상담 차팅 (재고 차감 엔진 포함) | 9,967–11,252 | 1,286 |
| 고객 채팅 | 11,253–11,542 | 290 |
| HTML 탭 10개 + 홈 버튼 6개 | 536–599, 615–681, 785–891, 920–957 | ~280 |
| **합계** | | **≈ 5,050줄 (staff.html의 31%)** |

**⚠️ 부팅 경로가 문제입니다.** `staff.html:3568-3587` — 로그인 직후 **모든 사용자에게** 무조건 실행됩니다.

```js
_migrateFeeToFirestore().finally(()=>{        // settings/feeSchedule read+write
  _initFeeRealtime();                          // onSnapshot 구독
  ensureFeeData().then(()=>{ _deriveProceduresFromFee(); _scheduleProcSync(); });
});
_initProcTimeRealtime();                       // procedureTimes/main onSnapshot
_migrateConsultToFirestore().finally(()=>_initConsultRealtime());  // consultTree
_initChatRealtime();                           // chatThreads onSnapshot
if(_chartVisible) _loadProcedureMeta();        // procedures 전체 get()
```

완료기준 **"`CRM_ENABLED=false`로 빌드하면 CRM 흔적이 UI·네트워크 요청 어디에도 없다"** 를 만족하려면 **이 6개 초기화 호출을 반드시 가드**해야 합니다. UI만 숨기면 네트워크 탭에 `feeSchedule`, `procedures`, `chatThreads` 요청이 그대로 보입니다.

`onSnapshot` 구독은 총 13개(전부 `staff.html`)이고 그중 **6개가 CRM**입니다 — `procedureTimes`(7067), `settings/feeSchedule`(7740), `settings/consultTree`(8729), `settings/consultAnesth`(8746), `chatThreads`(11271), `chatThreads/{id}/messages`(11371).

---

## 4. Cloud Functions 목록과 병원별 분리 가능성

전 8개, 모두 `asia-northeast3`.

| # | 함수 | 트리거 | 현재 권한 | 병원별 분리 | 난이도 | 비고 |
|---|---|---|---|---|---|---|
| 1 | `resetUserPassword` | `onCall` | `settings/bizAdmins.emails` | **가능** | 낮음 | 대상 계정이 호출자 병원 소속인지 검사 추가 필요. 지금은 **어느 병원 계정이든 비번 변경 가능** |
| 2 | `updateUserEmail` | `onCall` | `settings/bizAdmins.emails` | **가능** | 중간 | `payslips.authEmail` 일괄 갱신(`:220-231`)이 컬렉션 전체 스캔 → `clinics/{cid}/payslips`로 범위 한정 필요 |
| 3 | `webhookKakao` | `onRequest` (공개) | **없음** ⚠️ | **어려움** | **높음** | URL 하나에 전 병원 유입. 병원 식별자가 payload에 없음. **⚠️ 서명 검증이 TODO로 남아 있음**(`:281-283`) — 누구나 스레드 생성 가능. CRM이므로 SaaS에서는 **미배포** 권장 |
| 4 | `webhookNaver` | `onRequest` (공개) | **없음** ⚠️ | **어려움** | **높음** | 위와 동일. 서명 검증 자체가 없음 |
| 5 | `sendChatReply` | `onCall` | 로그인만 | CRM | — | SaaS 미배포 |
| 6 | `listRevenueFiles` | `onCall` | `settings/adminHigh.emails` | **불가 (현 구조)** | 높음 | `REVENUE_FOLDER_ID` 하드코딩(`:370`) + Drive 서비스계정 1개 공유. 병원별 폴더/자격증명 매핑 설계 필요 |
| 7 | `parseRevenueFile` | `onCall` | `settings/adminHigh.emails` | **불가 (현 구조)** | 높음 | 위와 동일. 파싱 결과를 `revenue`/`salesDetail`에 최상위 write |
| 8 | `ocrReceipt` | `onCall` | 로그인만 | **가능 (수정 불필요)** | 낮음 | 스테이트리스. Firestore 미접근. 다만 **로그인만 하면 누구나 호출** → Vision API 과금 노출. 병원별 쿼터 고려 |

### 공통 문제 — Custom Claims 미도입

**8개 전부 `request.auth.token.email`을 Firestore 화이트리스트(`settings/bizAdmins` / `settings/adminHigh`)와 대조**합니다. 호출마다 Firestore read 1회가 발생하고, **병원 소속 개념이 아예 없습니다.**

Phase 2에서 `setClinicClaims`를 도입하면:
- `request.auth.token.clinicId` 로 소속 판별 (read 0회)
- `bizAdmins`는 **플랫폼 관리자**로 의미가 바뀜 (병원 관리자는 `role:'owner'`)
- 함수 1·2는 "대상이 내 병원 소속인가" 검사가 **새로 필요** — 현재는 그 검사가 없어 **병원 간 계정 조작이 가능**

### `setClinicClaims` 신규 작성 필요

지시서 Phase 2가 요구하는 `setClinicClaims`는 **존재하지 않습니다.** Custom Claims를 세팅하는 코드가 레포 전체에 없습니다(`setCustomUserClaims` 검색 결과 0건). 신규 작성입니다.

---

## 5. 예상 공수 — 실측 기반 재추정

### 측정된 규모

| 지표 | 값 |
|---|---|
| `.collection(` 호출 총계 | **366건** (staff.html 235, firebase-config.js 31, hr-attendance.js 29, functions 18, expense.js 14, inventory.js 13, 기타 26) |
| `onSnapshot` 구독 | 13개 (전부 staff.html) |
| localStorage 사용 | 80회 / 키 20종 |
| 이관 대상 최상위 컬렉션 | 31개 (+ 서브컬렉션 2, + 홈페이지 16 = 손대면 안 됨) |
| Cloud Functions | 8개 (신규 1개 필요) |
| `staff.html` | 16,039줄 · 인라인 `<script>` 단일 |
| **기존 테스트 인프라** | **없음** — 루트 `package.json` 없음, 테스트 파일 0개, CI는 배포 워크플로우 2개뿐 |

### Phase별 재추정 (1인 기준, 인일)

| Phase | 지시서 범위 | 실측 재추정 | 근거 |
|---|---|---|---|
| **0.5** ⚠️ | *(지시서에 번호 없음)* CRM 격리 | **3 ~ 5** | 5,050줄 격리 + 부팅 경로 6개 가드 + onSnapshot 5개 + §3-4 의존성 역전(0.5~1) |
| **1** | 데이터 모델 이관 | **6 ~ 9** | 366개 호출부를 `clinicPath()` 헬퍼로 치환(2~3) + `migrate.js` 멱등·dry-run·백업·검증(2~3) + 루미 실데이터 검증(2~3). ※ 컬렉션 리네임(`inventory`→`stockItems` 등)을 포함하면 **+3~4** |
| **2** | 인증·3단 게이팅 | **7 ~ 11** | `setClinicClaims` 신규(1) + 기존 8개 함수 claims 전환·소속검사(1.5) + Rules 재작성 31경로(2, **기존 홈페이지 16경로 보존하며 2단계로**) + UI 게이팅(0.5, `displayTabs` 재활용 가능) + 라우팅 가드(0.5, `showTop`) + **테스트 인프라 신설(1~2, 라이브러리 승인 필요)** + 침투테스트 5종 작성(1) + **localStorage 테넌트 스코프화(1, 지시서 누락)** |
| **3** | 하드코딩 제거 | **5 ~ 8** | 층·장소 87건(1.5) + 직급 8곳 중복 통합(1) + 재고 카테고리 5곳(0.5) + `startsWith('lumi')` 8건 제거(0.5) + **인센티브 3종 전환 + 루미 legacy 병행 경로(2~4, §1-4)** |
| **4** | 운영 콘솔 연동 | **4 ~ 6** | `admin.html` 목업→실연동(1.5) + `createClinic` 온보딩 트랜잭션(1.5) + 시드 템플릿 4종(1, §1-3 enum 전부가 시드 대상) + bizAdmins 게이팅(0.5) |
| **5** | 온보딩·결제 | **8 ~ 12** | 마법사 4단계(3) + 토스 정기결제(3~5, **외부 연동·심사 변수 큼**) + `settings/billing.status` 잠금·복원(1.5) + CSV 일괄등록(1) |
| | **합계** | **33 ~ 51 인일** | 리네임 포함 시 **36 ~ 55** |

### 추정 신뢰도

- **높음**: Phase 0.5, 3, 4 — 대상이 전부 세어졌습니다
- **중간**: Phase 1, 2 — 루미 실데이터 규모(문서 수)를 못 봤습니다. `d-reads: 184,200`(admin.html 목업)이 실측치라면 이관 스크립트 실행 시간·비용을 다시 잡아야 합니다
- **낮음**: Phase 5 — 토스페이먼츠 심사·계약 리드타임이 개발 공수와 무관하게 걸립니다

### 순서 권고

지시서 순서(1→2→3→4→5)에 **Phase 0.5를 Phase 1 앞에** 넣기를 권합니다.

CRM을 먼저 격리하면 Phase 1의 이관 대상이 **31개 → 19개**로 줄고, Phase 2의 Rules 경로도 그만큼 줄어듭니다. 반대로 Phase 1을 먼저 하면 CRM 12개 컬렉션까지 `clinics/{cid}/` 로 옮긴 뒤 다시 격리해야 합니다 — **같은 일을 두 번** 합니다.

---

## 6. 승인이 필요한 결정 4건

지시서 작업규칙 "불확실하면 추측해서 진행하지 말고 질문한다"에 따라, **Phase 1 착수 전에 답이 필요한 것만** 추렸습니다.

### 질문 1 — 매출·비용·세무 모듈은 어디로 갑니까? (가장 중요)

관리자앱(`index.html`)의 **매출·비용·손익·세무 탭 전체**가 3개 모듈 어디에도, CRM 제외 목록 어디에도 없습니다.

해당 컬렉션 9개: `revenue`, `salesDetail`, `fixedExpenses`, `variableExpenses`, `cards`, `categoryRules`, `incomeTaxes`, `vatTaxes`, `withholdingTaxes`
해당 코드: `revenue.js`(584줄), `expense.js`(1,824줄), `finance.js`(296줄), `card-statements.js`(626줄), `expense-categories.js`(280줄), `expense-upload-parser.html`(1,518줄) ≈ **5,100줄**
해당 함수: `listRevenueFiles`, `parseRevenueFile`

**이게 결정되어야 정해지는 것들:**
- `recipes` 컬렉션의 운명 (§3-3) — 매출이 없으면 무의미
- `monthlyIncentiveInput`이 매출에 의존하므로 **payroll 인센티브의 자동계산 가능 여부**
- Phase 1 이관 대상 9개 컬렉션 포함 여부

**선택지:** (a) 4번째 모듈 `finance`로 판매 (b) 루미 전용으로 CRM처럼 격리 (c) 이번 범위 제외·현행 유지

### 질문 2 — 컬렉션 이름을 바꿉니까?

지시서 Phase 1 트리는 `stockItems / stockBatches / stockCounts`인데 현행은 `inventory / (없음) / inventoryAudits`입니다.

- **(a) 이름 유지** — 경로만 `clinics/{cid}/` 하위로. 이관 위험 최소. **권고**
- **(b) 리네임 동시 수행** — +3~4인일, 롤백 난이도 상승

`stockBatches`는 대응 컬렉션 자체가 없습니다(배치는 `receiveHistory.batchNo` 필드). 신규 설계가 필요하면 별도 논의가 필요합니다.

### 질문 3 — 루미의 인센티브를 퇴행시켜도 됩니까?

§1-4 참조. SaaS 3종으로 통일하면 루미 현행 5종 중 3종(`totalAll`, `totalMinusPersonal`, `japanSales`)이 **자동계산 → 수기입력**으로 내려갑니다. 루미는 매일 실사용 중입니다.

- **(a) 루미만 legacy 경로 병행 유지** (+1~2인일) — **권고**
- **(b) 전부 3종으로 통일, 루미도 manual 수용**

### 질문 4 — 테스트 라이브러리 추가를 승인해 주십니까?

지시서 Phase 2는 `Firebase Emulator + @firebase/rules-unit-testing`으로 침투 테스트를 **테스트 코드로** 요구합니다. 그런데 작업규칙은 "라이브러리 추가는 사전 승인, 지금은 vanilla JS + Firebase SDK만"입니다.

현재 루트에 `package.json`이 없고 테스트가 0개이므로 다음이 필요합니다:
`package.json`(devDependencies) · `firebase-tools` · `@firebase/rules-unit-testing` · 테스트 러너(node:test로 무의존 가능) · `firebase.json`에 `emulators` 블록 · CI 워크플로우 1개

**런타임 번들에는 아무것도 추가되지 않습니다** (devDependency 전용). 승인해 주시면 Phase 2에서 함께 세웁니다.

---

## 7. 지시서 대비 발견된 누락·불일치 (참고)

| 항목 | 지시서 | 현실 |
|---|---|---|
| CRM 격리 | Phase 번호 없음 | 필수 선행 작업, 3~5인일 |
| localStorage 테넌트 분리 | 언급 없음 | 완료기준 #5를 막는 실질 장애물 (§1-6) |
| Rules 공유 | 언급 없음 | 홈페이지가 같은 Rules 16경로에 의존 (§2-1B) |
| 이관 컬렉션 수 | 13개 | 31개 (홈페이지 16 제외) |
| `payroll`의 `core` 의존 | "근태·연차 없이 명세서를 만들 수 없어" | **코드상 사실 확인.** `monthlyIncentiveInput`·`lunchOT`·`mealRecords`가 `employees`/`attendance` 참조 |
| `inventory` 단독 구독 | 가능 | **코드상 사실 확인.** 재고팩은 `employees`를 실사자 이름 표시(`currentUser.name`)에만 씀 — 로그인 계정 자체로 대체 가능 |
| 두 앱의 재고 구현 | 단일 가정 | **`staff.html` 인라인판과 `inventory.js` 판이 별개로 존재.** 같은 `inventory` 컬렉션을 다른 코드가 읽고 씀. Phase 1에서 **양쪽 다** 고쳐야 함 |

---

## 8. 다음 단계

§6 질문 4건에 답을 주시면 Phase 1을 시작합니다.
**질문 1(매출 모듈)과 질문 2(리네임)는 Phase 1 착수 전 필수**입니다 — 이관 대상과 스키마가 달라집니다.
질문 3·4는 각각 Phase 3·2 착수 전까지 답이 있으면 됩니다.

권고 순서: **Phase 0.5 (CRM 격리) → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5**
