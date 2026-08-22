# AUDIT-REPLY.md — Phase 0.5 착수 전 회신

- 회신 대상: `DECISIONS.md` §「Phase 0.5 착수 전 회신할 것 3가지」
- 조사 기준 커밋: `c656612` (main)
- 작성일: 2026-08-22
- **코드 변경 없음.** 조사·판정만 수행했습니다.

---

## ⚠️ 먼저 — 2건은 실데이터가 필요한데 접근 수단이 없습니다

이 작업 환경에 Firebase 자격증명이 없습니다. `gcloud` 미설정, 서비스계정 키 파일 없음, `firebase` CLI 미설치입니다.

따라서 **1번의 "마지막 문서 생성 시각"과 2번의 "`employees` 실제 ID 목록"은 직접 확인할 수 없습니다.**

코드로 판정 가능한 부분은 전부 확정했고, 실데이터가 필요한 부분은 **실행하실 쿼리를 그대로 첨부**했습니다.

---

## 회신 1 — `receiveHistory` vs `receivingHistory`

### 결론: 둘 다 살아 있습니다. 그리고 예상보다 나쁩니다.

죽은 컬렉션이 아닙니다. **서로 다른 UI 진입점을 가진, 서로 다른 스키마의, 서로 다른 재고 필드를 갱신하는 두 개의 입고 시스템**이 병존합니다.

| | **A. `receiveHistory`** | **B. `receivingHistory`** |
|---|---|---|
| 쓰기 함수 | `saveReceiveItem()` — `staff.html:14751` | `submitReceiving()` — `staff.html:15936` |
| UI 진입점 | **재고 탭** → 품목 행 `📥 입고` 버튼(`6555`) → `receiveItemModal`(`1558`) | **입고 탭**(`tab-receiving`) → `입고 완료` 버튼(`1091`) |
| 재고 문서 갱신 필드 | `locations`, `currentStock` | `batches[]`, `locations`, **`totalStock`** |
| 부가 갱신 | `purchasePrice`, `purchaseQty`, `unitPrice`, `priceHistory`(최근 5개 유지) | 없음 |
| 배치(Batch) 개념 | 없음 | **있음** — `batchNo` 생성 + `batches[]` 배열 누적 |
| 트랜잭션 | 아니오 (`update` 후 `add`) | 예 (`runTransaction`) |
| 타임스탬프 | `createdAt` (serverTimestamp) + `receiveDate` | `receivedAt` (클라이언트 ISO 문자열) |
| 읽는 쪽 | **발주 예측**(`15669`), **소진 추이**(`14908`) | **최근 입고 10건 표시**(`15974`) — 그게 전부 |
| 접근 계정 | 공용계정 + 개인계정 | 공용계정 + 개인계정 |

두 경로 모두 `displayTabs(['inventory','receiving','wishlist'])`로 **공용계정에 노출**됩니다. 직원이 어느 탭으로 들어가느냐에 따라 다른 시스템이 돌아갑니다.

### 🚨 확정된 버그 2건

#### (1) 입고 탭 경로가 `currentStock`을 갱신하지 않습니다

`staff.html:15925-15931`

```js
const totalStock = Object.values(itemLocations).reduce((sum,v)=>sum+v,0);
tx.update(docRef, {
    batches: batches,
    locations: itemLocations,
    totalStock: totalStock,      // ← currentStock 이 없음
    updatedAt: new Date().toISOString()
});
```

코드베이스의 **다른 모든 재고 갱신 지점은 두 필드를 함께 씁니다.**

| 위치 | `currentStock` | `totalStock` |
|---|---|---|
| `staff.html:5915-5918` (장소 키 통합) | ✅ | ✅ |
| `staff.html:6141-6144` (장소 rekey) | ✅ | ✅ |
| `staff.html:6182-6185` (장소 삭제) | ✅ | ✅ |
| `staff.html:14839-14842` (장소 이동) | ✅ | ✅ |
| `inventory.js:273-274` (관리자앱 저장) | ✅ | ✅ |
| **`staff.html:15928-15931` (입고 탭)** | **❌** | ✅ |

그런데 `currentStock`을 읽는 곳은 **58곳**입니다 — `staff.html` 42, `inventory.js` 13, `revenue.js` 2, `index.html` 1. 재고 목록 수량, 발주 필요 배지, 발주 예측, 재고 가치 합계, 소진 추이가 전부 여기에 걸려 있습니다.

**결과: 입고 탭으로 입고하면 재고 목록의 수량이 올라가지 않습니다.** 입고 탭 자신만 `item.totalStock`을 읽어(`15610`, `15635`) 자기 화면에서는 정상으로 보입니다. **두 탭이 같은 품목에 대해 서로 다른 숫자를 표시합니다.**

#### (2) 입고 탭 물량이 발주 예측에서 통째로 누락됩니다

발주 예측 `analyzeItem()` (`staff.html:15697-15760`)은 `receiveHistory`만 읽습니다. 소비량 공식이

```js
const totalConsumed = Math.max(0, totalReceived - currentStock);
const monthlyUsage  = totalConsumed / monthsDiff;
```

인데, 입고 탭으로 들어온 물량은 `totalReceived`(A 컬렉션 집계)에도 없고 `currentStock`에도 반영되지 않습니다. **입고 탭을 주로 쓰는 품목은 월 소비량과 발주 시점이 조용히 틀립니다.**

### 판정

- **한쪽이 죽은 게 아니므로 Phase 1 이관 대상이 줄지 않습니다.** 둘 다 대상입니다.
- **임의로 합치지 않았습니다** (`DECISIONS.md` 질문 2 지시 준수). 통합 여부는 아래 확인 결과를 보고 다시 여쭙습니다.
- 버그 2건은 리팩터링 중 발견한 것이므로 `ISSUES.md` 기록 대상입니다. 다만 **(1)은 "지금 루미의 재고 숫자가 틀리고 있다"는 뜻**이라, 별건으로 우선 처리하실지 판단이 필요합니다.

### 실데이터로 확인하실 것

Firebase 콘솔 또는 Admin SDK에서 실행하시면 됩니다.

```js
// A — 마지막 문서 + 총 개수
await db.collection('receiveHistory').orderBy('createdAt','desc').limit(1).get();
await db.collection('receiveHistory').count().get();

// B — 마지막 문서 + 총 개수
//    ※ receivedAt 은 문자열 필드입니다. ISO 8601 이라 사전순 = 시간순이므로 결과는 정확합니다.
await db.collection('receivingHistory').orderBy('receivedAt','desc').limit(1).get();
await db.collection('receivingHistory').count().get();
```

**판정 기준**

| B의 마지막 문서 | 해석 | 조치 |
|---|---|---|
| 3개월 이내 | 두 시스템 병행 사용 중. 버그 (1)로 **재고 데이터가 이미 어긋나 있을 가능성 높음** | Phase 1 이전 정합성 점검 필요 |
| 6개월 이상 전 | 입고 탭이 사실상 폐기됨 | 이관 대상에서 제외 + `ISSUES.md` 기록 |
| 문서 0건 | 애초에 안 쓰임 | 이관 대상에서 제외 |

---

## 회신 2 — `employees`의 `lumi` 접두 ID

### 결론: 코드상 `lumistaff` 하나일 가능성이 높으나, 정황상 확인이 필요합니다.

### 코드로 확정된 것

**직원 문서 ID는 직원 이름입니다.** `staff.html:11965`, `hr-attendance.js:784`

```js
const name  = g('seEmpName').value.trim();
const empId = editId || name;                                 // ← 이름 그대로
const existing = await db.collection('employees').doc(name).get();
```

`name`은 입력값을 `trim()`만 합니다. **소문자화도 슬러그화도 하지 않습니다.** 따라서:

- 한글 이름(`"김간호"`)은 `startsWith('lumi')`에 **절대 걸리지 않습니다**
- 검사가 대소문자를 구분하므로 `"Lumi..."`도 걸리지 않습니다. **소문자 `lumi`로 시작하는 ID만** 해당합니다
- 그런 ID는 사람 이름 입력으로는 사실상 생기지 않습니다 → **의도적으로 만든 계정만 해당**

### 다만 — 필터가 두 방식으로 섞여 있는 게 걸립니다

| 방식 | 위치 |
|---|---|
| `e.id !== SHARED_ACCOUNT_ID` (정확히 `lumistaff`) | `staff.html:5362`, `11605`, `11804` |
| `!String(e.id\|\|'').startsWith('lumi')` (접두 매칭) | `staff.html:2667`, `12802`, `13142` |

**같은 목적에 두 가지 필터가 쓰이고 있고, 한쪽만 접두 매칭입니다. 정확히 `lumistaff` 하나뿐이라면 접두 매칭을 쓸 이유가 없습니다.**

과거에 또는 현재 `luminurse` / `lumidesk` / `lumiskin` 같은 문서가 존재했다는 정황으로 읽힙니다. 실제로 공용계정 이메일 예시가 3종이고(`staff.html:3383` — `nurse@ / desk@ / skin@`), 로그인 시 카테고리 자동매핑도 3종입니다(`6768`, `9827`).

### 실데이터로 확인하실 것

```js
const snap = await db.collection('employees').get();
snap.docs
  .filter(d => d.id.toLowerCase().startsWith('lumi'))
  .forEach(d => console.log(d.id, JSON.stringify({
    name:   d.data().name,
    email:  d.data().email,
    role:   d.data().role,
    status: d.data().status
  })));
```

| 결과 | 조치 |
|---|---|
| `lumistaff` 1건 | D-1은 단순 치환. 그대로 진행 |
| 2건 이상 | 각각이 공용계정인지 실제 직원인지 판정 필요 → **목록을 주시면 판정해서 회신** |

### 🚨 D-1보다 먼저 결정해야 할 것이 나왔습니다 — `employees/{uid}`

`BRIEF.md` Phase 1 트리는 `employees/{uid}`입니다. 현재는 `employees/{이름}`이고, **이 ID가 6개 컬렉션의 FK로 박혀 있습니다.**

```
employees/{이름}
  ← attendance.employeeId          staff.html:3898, 4823
  ← lunchOT.employeeId             staff.html:3905
  ← mealRecords.employeeId         staff.html:3917, 5007
  ← incentiveRecords.employeeId    staff.html:3933
  ← leaveRequests.employeeId       staff.html:3953
  ← payslips 문서 ID = `${ym}__${emp.id}`   staff.html:12991
```

**질문 2 답변("경로 이동만, 리네임 없음")이 이 건을 커버하는지 애매합니다.** `{이름}` → `{uid}`는 컬렉션 리네임이 아니라 **문서 ID 체계 변경 + FK 6종 재작성**이고, Phase 1에 **+2~3인일**이 붙습니다.

현행 유지 시의 실제 손해:

| 문제 | 근거 |
|---|---|
| **동명이인 등록 불가** | `staff.html:11967-11968` — `이미 등록된 이름입니다`로 차단됩니다. 병원 50곳 규모면 반드시 발생합니다 |
| **개명 시 이력 단절** | 문서 ID를 변경할 수 없으므로 새 문서가 생기고 근태·급여·연차 이력이 끊깁니다 |

**권고: Phase 1에서 `employees/{uid}`로 전환합니다.** Phase 1이 전 컬렉션을 손대는 유일한 시점이고, 나중에 하면 병원 수만큼 마이그레이션 비용이 곱해집니다.

다만 이는 질문 2 답변의 범위를 넓히는 것이므로 **임의로 진행하지 않겠습니다.** 판단 부탁드립니다.

---

## 회신 3 — 인센티브 `base` 3종 설계 적용 시 Phase 3 공수 재추정

### 재매핑 결과가 `DECISIONS.md` 예상(7종 중 6종)보다 좋습니다 — **실동작 5종 전부 살아납니다. 퇴행 0.**

`DECISIONS.md` 재매핑 표의 `incentiveItems.salesPercent`와 `japanSales`는 **매핑할 필요가 없습니다. 애초에 계산되지 않는 죽은 유형입니다.**

`incentiveItems` 합산 로직 **10곳 전부**가 `perCase`만 필터합니다.

```
staff.html        4695, 4709, 12871, 12932, 13159
hr-attendance.js   495,  551,  1111
```

`salesPercent` / `japanSales`는 UI에서 **생성은 가능하지만**(`staff.html:13247` prompt, `index.html:936`, `hr-attendance.js:1067-1070`), 급여 집계 어디에서도 합산되지 않습니다. 라벨만 그려집니다(`hr-attendance.js:303-307`, `staff.html:13223-13224`).

→ **`ISSUES.md` 기록 대상입니다.** 원장이 이 유형으로 항목을 만들면 정산에 반영되지 않은 채 화면에만 보입니다.

### 실동작 5종 → v2 매핑

| 실동작 현행 | v2 매핑 | 수식 동일 |
|---|---|---|
| `incType: 'personal'` | `percent / base: 'ownRevenue'` | ✅ |
| `incType: 'totalAll'` | `percent / base: 'totalRevenue'` | ✅ |
| `incType: 'totalMinusPersonal'` | `percent / base: 'totalMinusPersonal'` | ✅ |
| `incJapan` (1명당 ₩10,000) | `perCase { amount: 10000 }` | ✅ |
| `incentiveItems.perCase` | `perCase { amount: price }` | ✅ |

`incPercent` → `rate`, `incRounding` → `rounding` 도 1:1입니다.

### 그래서 legacy **병행 엔진이 필요 없습니다** — 읽기 어댑터 하나면 됩니다

현행 계산식(`staff.html:4656-4666`)과 v2 `percent` 규칙은 **수식이 동일**합니다. 엔진을 두 벌 유지할 이유가 없습니다.

```js
// 엔진은 하나. 입력만 어댑터로 정규화한다.
function resolveRules(emp, org){
  if (org.incentiveEngine === 'v2') return emp.incentiveRules || [];
  return legacyToV2(emp);   // 순수 함수 ~25줄. 루미 문서는 손대지 않는다
}
```

이 설계의 이점:

1. **루미 `employees` 문서를 마이그레이션하지 않습니다** → 데이터 유실 리스크 0
2. `DECISIONS.md` 조건 1(`clinicId === 'lumi'` 분기 금지)이 자동 충족됩니다 — 분기 기준이 `settings/org.incentiveEngine` 플래그이고, legacy 경로는 데이터 형태로만 구분됩니다
3. **부수 이득**: 현재 계산 로직이 3곳에 복붙되어 있습니다(`staff.html:4656`, `staff.html:12755`, `hr-attendance.js:440`). 단일 엔진으로 모으면 이 중복이 사라집니다

### Phase 3 재추정

| 항목 | `AUDIT.md` | 재추정 | 사유 |
|---|---|---|---|
| 층·장소 87건 | 1.5 | 1.5 | 변화 없음 |
| 직급 8곳 중복 통합 | 1.0 | 1.0 | 변화 없음 |
| 재고 카테고리 5곳 | 0.5 | 0.5 | 변화 없음 |
| `startsWith('lumi')` 8건 | 0.5 | **—** | **D-1로 Phase 0.5 이동** |
| 인센티브 v2 + legacy 병행 | **2.0 ~ 4.0** | **2.0 ~ 2.5** | 병행 엔진 → 어댑터 1개. 데이터 마이그레이션 0. 죽은 유형 2종 제외 |
| `monthlyIncentiveInput` 수동 폼 | — | **+0.5** | 질문 1 결정으로 신규 |
| **Phase 3 합계** | **5.0 ~ 8.0** | **5.5 ~ 6.0** | |

**상단이 8.0 → 6.0으로 내려갔습니다.** 절대값 감소보다 중요한 것은 **범위가 좁아진 것**입니다. 원래 2.0~4.0으로 벌어졌던 불확실성("legacy를 어떻게 병행 유지할 것인가")이 "어댑터 함수 1개"로 확정됐습니다.

**인센티브 2.0~2.5 내역**

| 작업 | 인일 |
|---|---|
| v2 엔진 1개 (`perCase` / `percent`×base 3종 / `manual` + rounding) | 0.75 |
| `legacyToV2()` 어댑터 + 단위테스트 | 0.5 |
| 계산 복붙 3곳 → 단일 엔진 호출로 통합 | 0.5 |
| 설정 UI 2곳 재배선 — `staff.html:2362-2384`, `index.html:669-703` (**중복 존재**) | 0.5 |
| 루미 회귀 검증 (legacy 입력 → v2 엔진 결과가 현행과 원 단위까지 일치) | 0.25 |

### 프로젝트 총계 영향

| Phase | 기존 | 재추정 |
|---|---|---|
| 0.5 | 3.0 ~ 5.0 | **3.5 ~ 5.5** (D-1 이관분 +0.5) |
| 1 | 6.0 ~ 9.0 | 6.0 ~ 9.0 *(`employees/{uid}` 결정 시 +2~3)* |
| 2 | 7.0 ~ 11.0 | 7.0 ~ 11.0 |
| 3 | 5.0 ~ 8.0 | **5.5 ~ 6.0** |
| 4 | 4.0 ~ 6.0 | 4.0 ~ 6.0 |
| 5 | 8.0 ~ 12.0 | 8.0 ~ 12.0 |
| **합계** | 33 ~ 51 | **약 33 ~ 48** |

---

## 종합 — 추가 판단이 필요한 것 2건

**Phase 0.5 자체는 위 3건 회신으로 착수 가능합니다.** 다만 조사 중 **Phase 1에 영향을 주는 결정 2건**이 새로 나왔습니다.

### 결정 A — `receiveHistory` / `receivingHistory` 통합 여부

둘 다 살아 있습니다. 그리고 입고 탭 경로가 `currentStock`을 갱신하지 않아 **지금 루미의 재고 숫자가 틀리고 있을 수 있습니다.**

위 쿼리로 실데이터를 확인하신 뒤 택일해 주십시오.

- (a) 재고 정합성 버그를 **별건으로 우선 수정** (리팩터링과 분리)
- (b) **Phase 1에서 통합** (이관하면서 한 컬렉션으로)
- (c) **둘로 그대로 이관** (통합은 나중에)

### 결정 B — `employees/{이름}` → `{uid}` 전환 여부

Phase 1에 **+2~3인일**. 현행 유지 시 동명이인 등록이 불가하고 개명 시 이력이 끊깁니다. Phase 1이 전 컬렉션을 손대는 유일한 시점입니다.

> **두 건 모두 Phase 0.5를 진행하면서 병렬로 결정하셔도 됩니다.** Phase 0.5(CRM·FINANCE 격리, `consumeStock`/`refundStock` 의존성 역전, `startsWith('lumi')` 제거)는 어느 쪽으로 결정되든 영향받지 않습니다.

---

## Phase 0.5 착수 시 함께 만들 `ISSUES.md` 초안 목록

`BRIEF.md` 작업규칙("리팩터링 중 발견한 버그는 고치지 말고 기록만")에 따라, 오늘까지 확인된 항목입니다.

| # | 항목 | 근거 | 심각도 |
|---|---|---|---|
| 1 | **Webhook 서명 검증 부재** — 누구나 `chatThreads` 생성 가능 | `functions/index.js:281-283`(TODO), `310-340`(검증 없음) | **높음** (D-5, 별건 처리 예정) |
| 2 | **입고 탭이 `currentStock` 미갱신** — 재고 목록·발주 배지·재고가치가 틀림 | `staff.html:15928-15931` | **높음** |
| 3 | **입고 탭 물량이 발주 예측에서 누락** | `staff.html:15697-15760` (`receiveHistory`만 읽음) | 중간 |
| 4 | **죽은 인센티브 유형 2종** — `salesPercent`·`japanSales` 생성은 되나 정산 미반영 | 합산 10곳 전부 `perCase`만 필터 | 중간 |
| 5 | **`payslips` PDF base64 인라인** — 1MB 제한·목록 조회 시 전량 다운로드 | `staff.html:12989-12995` | 중간 (D-2로 Phase 2 처리) |
| 6 | **`resetUserPassword`/`updateUserEmail` 소속 미검사** | `functions/index.js:16-127, 129-231` | 높음 (D-4로 Phase 2 처리) |

---

**`BRIEF.md` 작업 규칙**(한 번에 한 Phase, 기능 단위 커밋, 사전 고지, 범위 혼합 금지, 불확실하면 질문)**은 그대로 준수합니다.**
