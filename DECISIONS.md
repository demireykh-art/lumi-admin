# DECISIONS.md — AUDIT.md 회신 및 BRIEF.md 개정

- 대상 보고서: `AUDIT.md` (2026-08-22, 커밋 `c656612`)
- 이 문서는 `BRIEF.md`를 **덮어쓴다.** 충돌하면 이 문서가 우선한다.

---

## 보고서 승인

Phase 0 완료로 인정한다. 다음 판정에 동의한다.

- CRM → 재고 단방향, 재고 무손상 (§3-1, §3-4)
- Phase 0.5를 Phase 1 앞으로 (§5 순서 권고)
- Rules 2단계 재작성, 홈페이지 16경로 보존 (§2-1B)
- `settings` 13종 분해 후 이관 (§1-5)
- localStorage 테넌트 스코프화를 Phase 2에 추가 (§1-6)
- 인센티브 규칙 빌더 미제작 (§1-4)

---

## 질문 1 — 매출·비용·세무: **(b) 루미 전용 격리**

`CRM_ENABLED`와 **별개 플래그** `FINANCE_ENABLED`로 격리한다. SaaS 배포본에서는 `false`.

### 이유

1. `parseRevenueFile`은 **루미가 쓰는 EMR의 매출 엑셀 포맷**에 맞춰져 있다. 병원마다 EMR이 다르므로(의사랑/비트/이지스…) 파서가 그대로 안 돈다. 포맷 일반화는 그 자체로 별도 제품이다.
2. `expense-upload-parser.html` 1,518줄도 특정 카드사·은행 명세서 포맷 종속일 가능성이 높다.
3. `listRevenueFiles`가 Drive 서비스계정 1개 + 폴더 ID 하드코딩(`functions/index.js:370`)이다. 병원별 Drive 위임은 OAuth 재설계 영역이다.
4. 세무(부가세·원천세·소득세)는 세무사 영역이다. 대표원장 타겟에게 판매 우선순위가 낮다.

### 그래서 따라오는 결정

| 항목 | 결정 |
|---|---|
| 컬렉션 9종 (`revenue`, `salesDetail`, `fixedExpenses`, `variableExpenses`, `cards`, `categoryRules`, `incomeTaxes`, `vatTaxes`, `withholdingTaxes`) + `config` | **Phase 1 이관 대상에서 제외.** 최상위에 그대로 둔다. 루미 단독 사용이므로 테넌트 충돌이 없다 |
| `recipes` (§3-3) | `FINANCE_ENABLED`에 종속. SaaS 재고팩에서 **레시피 서브탭 제외.** 보고서 판정에 동의 |
| `monthlyIncentiveInput` | **payroll에 남긴다.** 아래 참조 |

### `monthlyIncentiveInput` 처리 — 중요

매출 모듈이 빠지면 이 문서를 채울 자동 경로가 없다. SaaS에서는 **수동 입력 폼**으로 제공한다.

- 원장이 월말에 총매출 / 직원별 매출을 직접 입력하는 화면 하나를 만든다
- 직원 5~15명 규모면 입력에 5분이면 끝난다
- **오히려 이게 낫다.** 특정 EMR 포맷에 종속되지 않아 어떤 병원이든 즉시 붙는다
- 루미 인스턴스는 `FINANCE_ENABLED=true`이므로 기존 자동 집계 경로를 그대로 쓴다

공수: 폼 1개 + 기존 계산 로직 재사용이므로 0.5인일 이내로 본다. Phase 3에서 인센티브 작업과 함께 처리한다.

> `finance`를 4번째 판매 모듈로 올리는 건 파일럿 5곳 이후에 재검토한다. 지금 범위에 넣으면 Phase 5까지 전부 늘어난다.

---

## 질문 2 — 리네임: **(a) 이름 유지**

Phase 1은 **경로 이동만** 한다. `inventory`, `inventoryAudits`, `inventoryLogs` 등 현행 이름을 그대로 쓴다.

`BRIEF.md`의 `stockItems / stockBatches / stockCounts`는 내가 코드를 안 보고 상상해서 쓴 이름이다. **폐기한다.** 특히 `stockBatches`는 대응 개념이 없다 — 배치가 `receiveHistory.batchNo` 필드로 이미 동작하고 있으면 그게 정답이다. 새 컬렉션을 만들지 않는다.

리네임은 이 프로젝트 전체가 끝난 뒤 별도 논의한다.

### 다만 Phase 1 착수 전 확인할 것

**`receiveHistory` vs `receivingHistory` 중복 의심 (§2-1A)** — 이건 `ISSUES.md`가 아니라 Phase 1 블로커다. 둘 중 하나가 죽은 컬렉션이면 이관 대상이 하나 줄고, 둘 다 살아 있으면 이관 후에도 데이터가 두 갈래로 갈린다.

- 각각의 **쓰기 지점**과 **최근 문서 생성 시각**을 확인해서 보고할 것
- 한쪽이 죽었으면 이관 대상에서 빼고 `ISSUES.md`에 기록
- 둘 다 살아 있으면 통합 여부를 다시 묻는다. **임의로 합치지 말 것**

---

## 질문 3 — 인센티브: **(a) legacy 병행. 단, 조건 2개**

### 조건 1 — 병원 ID로 분기하지 말 것

`clinicId === 'lumi'` 같은 분기를 새로 만들면, 지금 제거하려는 문제(`startsWith('lumi')`)를 형태만 바꿔 다시 만드는 것이다.

```js
settings/org.incentiveEngine: 'legacy' | 'v2'
```

이 플래그로 분기한다. 루미는 `legacy`, 신규 병원은 `v2`. 나중에 루미를 옮길 때 플래그만 바꾸면 된다.

### 조건 2 — `base` enum을 3개로 두면 퇴행이 줄어든다

보고서는 5종 중 3종이 `manual`로 강등된다고 했는데, `base`를 확장하면 대부분 살릴 수 있다.

```js
{ name, type: 'perCase',  amount }                         // 건당 정액
{ name, type: 'percent',  base: <BASE>, rate, rounding }   // 매출 비율
{ name, type: 'manual' }                                   // 원장 직접 입력

BASE = 'ownRevenue' | 'totalRevenue' | 'totalMinusPersonal'
```

재매핑 결과:

| 현행 | v2 매핑 |
|---|---|
| `personal` | `percent / ownRevenue` |
| `totalAll` | `percent / totalRevenue` |
| `totalMinusPersonal` | `percent / totalMinusPersonal` |
| `incJapan` | `perCase` (건수는 `monthlyIncentiveInput` 수동 입력에서 받는다) |
| `incentiveItems.perCase` | `perCase` |
| `incentiveItems.salesPercent` | `percent` |
| `japanSales` | `manual` |

**7종 중 6종이 살아난다.** 이건 규칙 빌더가 아니라 enum 3개 추가이므로 범위 확장이 아니다. `incRounding`(절사 단위)도 필드로 그대로 옮긴다.

이 설계로 legacy 병행 공수가 줄어들 것으로 본다. 재추정해서 보고할 것.

---

## 질문 4 — 테스트 라이브러리: **승인**

devDependency 전용이므로 런타임 번들에 영향이 없다. Rules 테스트 없이 멀티테넌시를 배포하는 건 무모하다.

승인 범위:

```
package.json (devDependencies only)
firebase-tools
@firebase/rules-unit-testing
firebase.json → emulators 블록
.github/workflows/ 테스트 워크플로우 1개
```

**테스트 러너는 `node:test`를 쓴다.** jest/vitest는 추가하지 않는다.
런타임 의존성은 여전히 vanilla JS + Firebase SDK만이다. 이 원칙은 유지된다.

---

## 내가 추가로 내리는 결정 5건

### D-1. `startsWith('lumi')` 필터는 Phase 3이 아니라 **Phase 0.5에서 제거**

§1-1이 지적한 대로 이건 조용한 데이터 유실 버그다. 지금 루미에서도 `lumi`로 시작하는 직원 ID가 생기면 급여·인센티브에서 사라진다.

- `employees` 문서에 `role: 'shared'` 필드를 추가하고, 필터를 `e.role !== 'shared'`로 교체
- 8곳(`2618, 2667, 5362, 11605, 11804, 12802, 13142`) 전부
- `SHARED_ACCOUNT_ID='lumistaff'` 상수도 함께 제거
- 기존 공용계정 문서에 `role:'shared'`를 넣는 일회성 스크립트 포함
- **작업 전 루미 `employees` 전체를 스캔해서 `lumi`로 시작하는 ID가 공용계정 말고 또 있는지 확인하고 보고할 것**

### D-2. `payslips` base64 → Firebase Storage 이관을 **Phase 2에 포함**

§2-4가 범위 밖이라고 했지만 포함시킨다. 이유:

1. Rules의 `resource.data.uid == request.auth.uid`가 **문서 전체를 읽은 뒤** 평가된다 → 거부되는 요청도 PDF 전체 read 과금
2. 목록 조회(`where('ym','==',ym).get()`)가 전 직원 PDF를 다운로드한다
3. 병원 50곳 × 직원 10명 × 매월이면 이 구조로는 비용이 감당 안 된다
4. 급여명세서는 payroll 팩의 핵심 판매 기능이다. 나중에 고치는 게 훨씬 비싸다

설계: 문서에는 메타데이터만, PDF는 `gs://.../clinics/{cid}/payslips/{ym}/{empId}.pdf`. Storage Rules로 동일하게 게이팅. 기존 문서 이관 스크립트 포함.

`firebase.json`에 storage 항목과 Storage SDK 로드가 새로 필요하다. **승인한다.**

### D-3. `consumeStock()` / `refundStock()` 의존성 역전 — **채택**

§3-4의 제안을 그대로 채택한다. Phase 0.5 안에서 처리한다.

추가 요구: 재고팩 UI에 **"사용 등록" 버튼**을 함께 만든다. CRM 없는 병원도 실사 외에 차감할 수단이 생긴다. `inventoryTransactions.refType`은 `'visit' | 'manual' | 'sales'` 3종으로 둔다.

### D-4. Cloud Functions 병원 간 계정 조작 차단 — Phase 2 필수

§4가 지적한 `resetUserPassword` / `updateUserEmail`의 소속 미검사는 **현재 프로덕션의 권한 상승 취약점**이다. Phase 2에서 반드시 막는다.

### D-5. Webhook 서명 검증 부재 — `ISSUES.md` 최상단, 별건 처리

`webhookKakao` / `webhookNaver`에 서명 검증이 없어(§4) 누구나 `chatThreads`를 생성할 수 있다. CRM이라 SaaS에는 미배포지만 **루미에서 지금 열려 있는 구멍**이다.

이번 리팩터링과 섞지 않는다. `ISSUES.md` 최상단에 기록하고, 별도 작업으로 따로 요청하겠다.

---

## 확정된 Phase 순서

| Phase | 내용 | 변경점 |
|---|---|---|
| **0.5** | CRM 격리 + `FINANCE_ENABLED` 격리 + 의존성 역전(D-3) + `startsWith('lumi')` 제거(D-1) | 신설. Phase 1 앞 |
| **1** | 데이터 모델 이관 (경로만, 리네임 없음) | 매출 9종 + `config` 제외 |
| **2** | Claims · 3단 게이팅 · Rules 2단계 · localStorage 스코프 · 테스트 인프라 · payslips Storage(D-2) · 함수 소속검사(D-4) | 항목 3개 추가 |
| **3** | 하드코딩 제거 · 인센티브 v2 + legacy 병행 · `monthlyIncentiveInput` 수동 폼 | |
| **4** | 운영 콘솔 연동 | `admin.html` 참조 |
| **5** | 온보딩 · 결제 | |

---

## Phase 0.5 착수 전 회신할 것 3가지

코드를 고치기 전에 아래만 확인해서 짧게 보고하라. 별도 문서 없이 채팅으로 답해도 된다.

1. **`receiveHistory` vs `receivingHistory`** — 각각의 쓰기 지점과 마지막 문서 생성 시각 (질문 2 블로커)
2. **`employees`에 `lumi` 접두 ID가 공용계정 외에 존재하는지** (D-1)
3. **인센티브 `base` 3종 설계 적용 시 Phase 3 공수 재추정** (질문 3)

이 3개에 답이 오면 Phase 0.5를 시작한다.

`BRIEF.md`의 작업 규칙(한 번에 한 Phase, 기능 단위 커밋, 사전 고지, 범위 혼합 금지, 불확실하면 질문)은 그대로 유효하다.
