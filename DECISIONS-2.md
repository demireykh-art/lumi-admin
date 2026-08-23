# DECISIONS-2.md — AUDIT-REPLY.md 회신

- 회신 대상: `AUDIT-REPLY.md` (2026-08-22)
- 이 문서는 `DECISIONS.md`를 **보완**한다. 충돌하면 이 문서가 우선한다.

---

## 🚨 최우선 — 재고 정합성 복구를 오늘 처리한다 (HOTFIX)

회신 1의 버그 (1)은 "발견된 이슈"가 아니라 **지금 진행 중인 데이터 오염**이다.
루미는 매일 실사용 중이고, 재고 목록·발주 배지·재고가치·발주예측이 전부 틀린 숫자를 보고 있다.

`ISSUES.md`에 기록만 하고 넘기지 않는다. **Phase 0.5보다 먼저, 별도 브랜치·별도 커밋으로** 처리한다.

### HOTFIX-1: 코드 수정

`staff.html:15928-15931`

```js
tx.update(docRef, {
    batches: batches,
    locations: itemLocations,
    totalStock: totalStock,
    currentStock: totalStock,        // ← 추가
    updatedAt: new Date().toISOString()
});
```

이 한 줄이다. **다른 것은 아무것도 건드리지 않는다.** 커밋 하나, 변경 1줄.

### HOTFIX-2: 과거 데이터 복구

다행히 입고 탭도 `locations`는 정상 갱신했다. 따라서 진실은 `locations`에 남아 있고 복구가 가능하다.

`scripts/fix-currentstock.js`를 작성한다.

```
for each doc in inventory:
  const sum = Object.values(doc.locations || {}).reduce((a,b)=>a+b, 0)
  if (doc.currentStock !== sum) → 기록
```

요구사항:

- **dry-run 우선.** 먼저 `report` 모드로 어긋난 품목 목록(품목명 / `currentStock` / Σlocations / 차이)만 출력한다
- 그 보고서를 나에게 보여주고 **승인받은 뒤에** 쓰기를 실행한다
- 쓰기 전 `inventory` 컬렉션 전체 백업(JSON 덤프)
- 멱등. 두 번 돌려도 안전할 것
- `totalStock`도 함께 맞춘다

**차이가 큰 품목이 나오면 그것 자체가 정보다.** 어느 품목을 입고 탭으로 관리해왔는지 드러난다.

### HOTFIX-3: 발주 예측이 두 컬렉션을 합산하도록 수정

회신 1의 버그 (2). `analyzeItem()` (`staff.html:15697-15760`)이 `receiveHistory`만 읽는다.

`receivingHistory`의 입고 수량도 `totalReceived`에 합산한다. 두 컬렉션의 스키마가 다르므로 정규화 함수를 하나 두고, **집계 결과만 합친다.** 컬렉션을 합치는 게 아니다.

HOTFIX 1·2가 끝나고 검증된 뒤에 별도 커밋으로 진행한다.

> 세 건 모두 리팩터링과 분리한다. `CRM_ENABLED`, 경로 이동, Claims 어느 것도 건드리지 않는다.

---

## 결정 A — `receiveHistory` / `receivingHistory`: **(a) + (c)**

- **버그는 위 HOTFIX로 지금 고친다** — (a)
- **Phase 1은 둘 다 그대로 이관한다** — (c)
- **통합은 이번 프로젝트 범위에서 제외한다**

### 통합하지 않는 이유

통합은 기술 결정이 아니라 **제품 결정**이다. 입고 탭과 재고 탭 중 어느 UX를 남길지, 배치·유통기한을 정식 기능으로 승격할지가 먼저 정해져야 한다. 그 판단은 파일럿 5곳에서 실제 사용 패턴을 본 뒤에 내린다. Phase 1에 끌어들이면 이관 리스크와 UX 재설계가 뒤섞인다.

### 다만 신규 병원에는 하나만 노출한다

입고 경로가 두 개인 채로 SaaS를 파는 건 말이 안 된다.

- **신규 병원: 입고 탭(`receivingHistory`) 경로만 노출.** 배치·유통기한·트랜잭션을 갖춘 쪽이 기술적으로 우수하다
- 재고 탭의 `📥 입고` 버튼은 신규 병원에서 숨긴다
- **루미는 둘 다 유지** — 기존 워크플로를 깨지 않는다
- 분기는 `settings/org.receivingMode: 'legacy' | 'v2'`. 병원 ID로 분기하지 말 것 (`DECISIONS.md` 조건 1과 동일)

Phase 3에서 처리한다. 예상 +0.5인일.

### 실데이터 확인은 HOTFIX-2 보고서로 대체한다

제안한 `count()` / `orderBy` 쿼리 대신, HOTFIX-2의 dry-run 보고서가 같은 답을 더 정확하게 준다. **어긋난 품목이 몇 개인지가 곧 입고 탭이 얼마나 쓰이는지다.** 별도 쿼리를 돌리지 않는다.

---

## 결정 B — `employees` 문서 ID: **전환 승인. 단 `{uid}`가 아니라 `{autoId}`**

전환한다. 동명이인은 병원 50곳이면 반드시 발생하고, 개명 시 이력 단절은 급여 데이터에서 치명적이다. Phase 1이 전 컬렉션을 손대는 유일한 시점이라는 판단에 동의한다.

### 다만 `BRIEF.md`의 `employees/{uid}`는 내 실수다

Auth uid를 문서 ID로 쓰면 **Auth 계정이 없는 직원을 등록할 수 없다.** 실제로 문제가 된다:

- 입사 예정자를 미리 등록해두는 경우
- 계정 발급 전 근태만 기록하는 경우
- 퇴사 후 Auth 계정을 삭제해도 급여·근태 이력은 남아야 하는 경우

```
employees/{autoId}          // Firestore 자동 ID
  authUid: string | null     // Auth 계정 연결 (없어도 됨)
  name: string
  ...
```

`authUid`에 인덱스를 걸어 로그인 시 조회한다. Security Rules에서는 `request.auth.uid`와 `resource.data.authUid`를 대조한다.

### FK 6종 재작성 시 지킬 것

```
attendance.employeeId, lunchOT.employeeId, mealRecords.employeeId,
incentiveRecords.employeeId, leaveRequests.employeeId,
payslips 문서ID = `${ym}__${empId}`
```

- 이관 스크립트에 **이름 → autoId 매핑 테이블**을 만들어 파일로 남긴다. 롤백과 검증에 반드시 필요하다
- 매핑에 실패한 FK(존재하지 않는 직원 이름을 가리키는 고아 문서)는 **삭제하지 말고 별도 컬렉션에 격리**하고 목록을 보고한다
- `payslips` 문서 ID 변경은 D-2(Storage 이관)와 같은 Phase 2에 걸린다. **두 작업의 순서를 명시해서 사전 보고할 것**
- 이관 후 검증: 직원별 근태·급여 문서 수가 이관 전후로 정확히 일치하는지 대조

Phase 1 +2~3인일을 승인한다.

---

## DB 접근 문제 — 이건 지금 풀어야 한다

Firebase 자격증명이 없어 실데이터를 못 본다고 했는데, 이건 회신 2건의 문제가 아니라 **프로젝트 전체의 블로커**다. Phase 1 이관 검증, HOTFIX-2 dry-run, 완료기준 "데이터 유실 0" 확인이 전부 DB 접근을 전제한다.

다음 순서로 해결한다.

### 1단계 — 에뮬레이터 + 프로덕션 스냅샷 (기본 작업 환경)

```
firebase firestore:export gs://.../snapshot-YYYYMMDD
→ 에뮬레이터에 import
```

- 모든 이관 스크립트·마이그레이션·테스트는 **에뮬레이터에서 개발하고 검증**한다
- 스냅샷에는 실데이터가 들어 있으므로 `.gitignore`에 반드시 넣고 커밋하지 않는다

### 2단계 — 읽기 전용 서비스계정 (조사용)

프로덕션 조사가 필요할 때를 위해 `roles/datastore.viewer` 권한만 가진 서비스계정 키를 별도로 발급한다.

### 3단계 — 프로덕션 쓰기는 내가 직접 실행한다

**프로덕션에 쓰는 스크립트는 실행하지 않는다.** 스크립트를 작성하고, dry-run 보고서를 내고, 실행 명령어를 알려주면 내가 확인 후 직접 돌린다. HOTFIX-2도 이 방식으로 간다.

`firebase-tools`는 이미 `DECISIONS.md` 질문 4에서 승인했다. 에뮬레이터 설정(`firebase.json`)을 Phase 0.5와 함께 세워도 좋다.

---

## 회신 3 — 인센티브: 어댑터 설계 **채택**

`legacyToV2()` 읽기 어댑터 방식에 동의한다. 루미 문서를 마이그레이션하지 않는다는 점이 특히 좋다 — 데이터 유실 리스크가 0이 된다.

계산 복붙 3곳(`staff.html:4656`, `staff.html:12755`, `hr-attendance.js:440`)을 단일 엔진으로 통합하는 것도 승인한다. **다만 이건 인센티브 작업 안에서만 한다.** 다른 중복 로직으로 확대하지 말 것.

회귀 검증 조건을 하나 추가한다: **루미의 최근 3개월 실제 급여 데이터로 legacy 입력 → v2 엔진 결과가 원 단위까지 일치**해야 한다. 에뮬레이터 스냅샷으로 검증 가능하다. 불일치가 하나라도 나오면 Phase 3을 중단하고 보고할 것.

---

## `ISSUES.md` 6건 — 승인, 우선순위 조정

| # | 항목 | 처리 |
|---|---|---|
| 2 | 입고 탭 `currentStock` 미갱신 | **HOTFIX-1·2로 즉시 처리.** ISSUES에서 제외 |
| 3 | 발주 예측 누락 | **HOTFIX-3으로 즉시 처리.** ISSUES에서 제외 |
| 1 | Webhook 서명 검증 부재 | ISSUES 최상단. 별건 (D-5) |
| 4 | 죽은 인센티브 유형 2종 | ISSUES 기록. Phase 3에서 v2 전환 시 **UI에서 생성 옵션 제거** |
| 5 | `payslips` base64 | ISSUES 기록. Phase 2 (D-2) |
| 6 | 함수 소속 미검사 | ISSUES 기록. Phase 2 (D-4) |

**7번 추가**: `currentStock`과 `totalStock`이 항상 같은 값을 갖는 중복 필드다. 같은 진실을 두 곳에 쓰는 구조가 이번 버그의 근본 원인이다. 통합 대상으로 기록하되 **이번 프로젝트에서 손대지 않는다** — 읽는 곳이 58곳이다.

---

## 착수 순서

| 순서 | 작업 | 상태 |
|---|---|---|
| **0** | **HOTFIX-1** (1줄 수정) | **지금 시작** |
| **0** | **HOTFIX-2** dry-run 보고서 → 내 승인 → 실행 | HOTFIX-1 직후 |
| **0** | **HOTFIX-3** 발주 예측 합산 | HOTFIX-2 검증 후 |
| 1 | 에뮬레이터 + 스냅샷 환경 구축 | HOTFIX와 병렬 가능 |
| 2 | **Phase 0.5** — CRM·FINANCE 격리, 의존성 역전(D-3), `startsWith('lumi')` 제거(D-1) | HOTFIX 완료 후 |
| 3 | Phase 1 (`{autoId}` 전환 포함) | |

**HOTFIX 3건을 먼저 끝내고 보고하라.** Phase 0.5는 그 뒤다.

`BRIEF.md` 작업 규칙은 그대로 유효하다. 특히 **범위 혼합 금지** — HOTFIX 커밋에 리팩터링을 섞지 말 것.
