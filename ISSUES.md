# ISSUES.md — 리팩터링 중 발견한 미해결 이슈

멀티테넌시 개조(`BRIEF.md` → `DECISIONS.md` → `DECISIONS-2.md`) 진행 중 발견했으나
**범위 혼합 금지 원칙에 따라 고치지 않고 기록만 한 항목**입니다.

- 기준 커밋: `df21ee7` (main, 2026-08-22)
- 줄 번호는 위 커밋 기준입니다. 코드가 바뀌면 함께 갱신해 주세요.
- 우선순위·처리 시점은 `DECISIONS-2.md` §「`ISSUES.md` 6건 — 승인, 우선순위 조정」을 따릅니다.

## 규칙

- 여기 있는 항목은 **해당 Phase에 도달하기 전까지 손대지 않습니다.**
- 새 이슈는 번호를 재사용하지 말고 뒤에 추가합니다. ID는 다른 문서에서 참조되므로 고정입니다.
- 해결되면 삭제하지 말고 **§「해결됨」으로 이동**하고 처리 커밋을 적습니다.

---

## 한눈에

| ID | 항목 | 심각도 | 처리 시점 | 상태 |
|---|---|---|---|---|
| **ISSUE-6** | `resetUserPassword`/`updateUserEmail` 소속 미검사 | **높음** | Phase 2 (D-4) | 미착수 |
| **ISSUE-5** | `payslips` PDF를 base64로 문서에 인라인 | 중간 | Phase 2 (D-2) | 미착수 |
| **ISSUE-4** | 죽은 인센티브 유형 2종 — 만들 수는 있으나 정산 미반영 | 중간 | Phase 3 | 미착수 |
| **ISSUE-1** | 상담톡 웹훅 3종 배포 해제 (서명 검증 미구현) | 낮음(정리) | **Phase 0.5** | 미착수 |
| **ISSUE-7** | `currentStock` / `totalStock` 중복 필드 | 낮음(구조) | **이번 프로젝트 제외** | 보류 |

---

## ISSUE-6 — Cloud Functions 병원 간 계정 조작 가능 🔴

**심각도: 높음 (멀티테넌시 도입 시 권한 상승 취약점)**
**처리: Phase 2 필수 (`DECISIONS.md` D-4)**

### 현상

계정을 조작하는 두 함수가 **호출자가 비즈관리자인지만 확인하고, 대상 계정이 어느 병원 소속인지는 검사하지 않습니다.**

현재는 단일 테넌트라 실질 피해가 없지만, **Phase 1·2로 병원이 늘어나는 순간 A병원 관리자가 B병원 직원의 비밀번호와 로그인 이메일을 바꿀 수 있게 됩니다.**

### 근거

`functions/index.js:16-117` — `resetUserPassword`

```js
const adminsDoc = await admin.firestore().collection('settings').doc('bizAdmins').get();
// ... callerEmail 이 화이트리스트에 있는지만 확인
const targetEmail = String((request.data && request.data.email) || '').trim().toLowerCase();
// ↑ 대상이 어느 병원 소속인지 검사 없음
```

`functions/index.js:129-237` — `updateUserEmail`

동일 패턴. 추가로 `functions/index.js:223` 의 `payslips` `authEmail` 일괄 갱신이
**컬렉션 전체를 스캔**하므로, 이관 후에는 다른 병원 문서까지 훑게 됩니다.

### 영향

- 병원 간 계정 탈취 (비밀번호 재설정 → 로그인)
- 이메일 변경으로 급여명세서 접근권 이전 (`payslips.authEmail` 이 조회 키)

### 처리 (Phase 2)

1. `setClinicClaims` 도입 후 `request.auth.token.clinicId` 로 호출자 병원 판별
2. 대상 계정의 `clinicId` 가 호출자와 같은지 검사 → 다르면 `permission-denied`
3. `payslips` 갱신 범위를 `clinics/{cid}/payslips` 로 한정
4. `bizAdmins` 의 의미를 **플랫폼 관리자**로 재정의 (병원 관리자는 `role: 'owner'`)

> 나머지 6개 함수는 `AUDIT.md` §4 참조. `ocrReceipt` 는 로그인만 하면 호출 가능해
> Vision API 과금이 노출되지만, 스테이트리스라 데이터 유출은 없어 별도 항목으로 두지 않았습니다.
> 병원별 쿼터가 필요해지면 그때 항목을 추가합니다.

---

## ISSUE-5 — `payslips` PDF를 base64로 문서에 인라인

**심각도: 중간 (비용·확장성)**
**처리: Phase 2 (`DECISIONS.md` D-2 — Firebase Storage 이관)**

### 현상

급여명세서 PDF 전체를 base64 dataURL로 만들어 **Firestore 문서 필드에 넣습니다.**
Firebase Storage는 이 레포 어디에서도 쓰지 않습니다 (`firebase.json` 에 storage 항목 없음,
Storage SDK 로드 없음).

### 근거

`staff.html:12997-13008`

```js
const dataUrl = await _staffFileToDataUrl(blob);
const docId = `${ym}__${emp.id}`;
await db.collection('payslips').doc(docId).set({
  ym, employeeId: emp.id, name: emp.name,
  authEmail: (emp.email||'').toLowerCase(),
  fileName: fname, dataUrl, size: blob.size, deliverAt,   // ← PDF 전체
  ...
});
```

같은 로직이 `hr-attendance.js:1616` 에도 중복 존재합니다.

### 영향

| 문제 | 근거 |
|---|---|
| **문서 1MB 제한** | base64는 원본의 약 1.37배. PDF가 ~730KB 넘으면 저장 실패 |
| **목록 조회가 전 직원 PDF를 다운로드** | `staff.html:13116`, `hr-attendance.js:1762` — `where('ym','==',ym).get()` |
| **거부되는 요청도 읽기 과금** | Rules의 `resource.data.authEmail == request.auth.token.email` 는 문서를 읽은 뒤 평가 |
| **확장 불가** | 병원 50곳 × 직원 10명 × 매월 |

### 처리 (Phase 2)

- 문서에는 메타데이터만, PDF는 `gs://.../clinics/{cid}/payslips/{ym}/{empId}.pdf`
- Storage Rules로 Firestore와 동일하게 게이팅 (본인 또는 owner)
- `firebase.json` 에 storage 항목 + Storage SDK 로드 추가 (D-2에서 승인됨)
- 기존 문서 이관 스크립트 필요

> ⚠️ `payslips` 문서 ID 는 `` `${ym}__${empId}` `` 형태라, `DECISIONS-2.md` 결정 B
> (`employees/{autoId}` 전환)와 **이 이슈가 같은 Phase 2에서 충돌합니다.**
> 두 작업의 순서를 사전 보고하기로 되어 있습니다 (`DECISIONS-2.md` 결정 B).

---

## ISSUE-4 — 죽은 인센티브 유형 2종

**심각도: 중간 (조용한 오작동 — 원장이 만든 항목이 정산에 반영되지 않음)**
**처리: Phase 3, 인센티브 v2 전환 시 UI에서 생성 옵션 제거**

### 현상

`incentiveItems` 의 `salesPercent`(매출 %) 와 `japanSales`(일본매출 %) 유형은
**UI에서 만들 수 있고 목록에 표시되지만, 급여 집계 어디에서도 합산되지 않습니다.**

원장이 이 유형으로 항목을 만들면 화면에는 보이는데 **급여에는 0원으로 반영**됩니다.
오류 메시지도 경고도 없습니다.

### 근거

**생성은 가능**

| 위치 | 내용 |
|---|---|
| `staff.html:13256` | `prompt('유형 (1=건당, 2=매출%, 3=일본매출%):')` |
| `index.html:936` | `<option value="salesPercent">담당 매출 % (매출 연동)</option>` |
| `hr-attendance.js:1065-1070` | 세 유형 모두 저장 |

**표시도 됨**

| 위치 | 내용 |
|---|---|
| `staff.html:13231-13233` | 유형별 라벨 렌더 |
| `hr-attendance.js:300-309` | 유형별 배지 렌더 |

**그런데 합산은 `perCase` 만** — 합산 지점 8곳 전부

```
staff.html        4704, 4718, 12880, 12941, 13168
hr-attendance.js   495,  551,  1111
```

전부 `if (item.type === 'perCase')` 로 필터합니다. 다른 두 유형을 더하는 코드가 없습니다.

### 영향

- 원장이 만든 인센티브 항목이 조용히 무시됨
- `AUDIT-REPLY.md` §회신 3 에서 확인했듯, **인센티브 v2 재매핑에서 살릴 것이 없습니다** —
  기능이 존재한 적이 없으므로 `manual` 강등도 아닙니다

### 처리 (Phase 3)

- 인센티브 v2 전환 시 `salesPercent` / `japanSales` **생성 옵션을 UI에서 제거**
- 기존 데이터에 해당 유형 문서가 있으면 목록을 보고 (정산에 안 들어갔으므로 삭제해도 금액 영향 없음)
- v2의 `percent / base` 3종으로 같은 의도를 표현할 수 있으므로 기능 후퇴가 아님

---

## ISSUE-1 — 상담톡 웹훅 3종 배포 해제

**심각도: 낮음 (정리 작업)**
**처리: Phase 0.5 에 묶어서 처리. 별건 우선처리 하지 않음**

> **심각도 조정 (2026-08-22)** — 당초 "높음(프로덕션에 열려 있는 구멍)"으로 올렸으나,
> 원장 확인 결과 **루미는 카카오·네이버 채널을 자체 웹훅에 연결한 적이 없습니다.**
> 콜백 URL이 어디에도 등록되어 있지 않아 **정상 트래픽 경로가 존재하지 않습니다.**
> 다만 URL이 노출되면 여전히 호출 가능하므로, 서명 검증을 붙이는 대신 **배포를 해제**합니다.
> (Functions 호출 횟수 확인은 원장 판단으로 생략)

### 현상

카카오·네이버 상담톡 웹훅이 서명 검증 없이 공개 엔드포인트로 배포되어 있습니다.
채널에 연결된 적이 없어 실제로 들어오는 트래픽은 없지만, URL을 아는 사람은
임의의 `chatThreads` 문서와 메시지를 만들 수 있습니다.

### 근거

`functions/index.js:277-306` — `webhookKakao` (`onRequest`, 공개)

```js
exports.webhookKakao = onRequest(
  {region: 'asia-northeast3', cors: false},
  async (req, res) => {
    try {
      // TODO: 서명 검증 — 심사 통과 후 카카오 시크릿으로 HMAC 확인
      // const signature = req.headers['x-kakao-signature'];
      // if (!_verifyKakaoSig(req.rawBody, signature)) return res.status(401).send('bad sig');
```

검증 코드가 **주석 처리된 TODO**로 남아 있습니다.

`functions/index.js:310-338` — `webhookNaver` (`onRequest`, 공개)

**서명 검증 코드가 주석으로도 존재하지 않습니다.** `body.event === 'send'` 인지만 확인하고
바로 `_findOrCreateThread()` 를 호출합니다.

`functions/index.js:341-360` — `sendChatReply` (`onCall`)

**이 함수는 공개 엔드포인트가 아닙니다.** `if (!request.auth) throw` 로 로그인을 요구합니다
(`functions/index.js:344`). 배포 해제 대상에 포함하는 이유는 보안 구멍이라서가 아니라
**CRM 표면을 배포본에서 걷어내기 위해서**입니다.

### 처리 방침 (확정)

| 항목 | 결정 |
|---|---|
| `webhookKakao` / `webhookNaver` / `sendChatReply` | **배포 해제** |
| 함수 코드 | **보존** (`functions/index.js` 에 그대로 둠) |
| `chatThreads` 데이터 | **보존** (삭제하지 않음) |
| HMAC 서명 검증 | **재개발 시점으로 연기.** 지금 구현하지 않음 |
| 시점 | **Phase 0.5** — CRM 격리와 함께 |

### ⚠️ 구현 시 반드시 확인할 것 — "배포 대상에서 제외"만으로는 안 내려갑니다

`.github/workflows/deploy-functions.yml:58-61` 이 현재 이렇게 배포합니다.

```yaml
firebase deploy --only functions --project lumiclinic-c1a95 --non-interactive
```

여기서 배포 목록을 명시적으로 좁혀도(`--only functions:a,functions:b`)
**이미 GCP에 떠 있는 `webhookKakao` / `webhookNaver` 는 그대로 살아 있습니다.**
`--only functions:X` 는 X만 갱신할 뿐, 목록에 없는 함수를 삭제하지 않습니다.
URL도 그대로 유효합니다. 즉 **목표("URL 노출 시 호출 가능하므로 배포 해제")가 달성되지 않습니다.**

실제로 내리려면 다음 순서가 필요합니다.

1. `functions/index.js` 에서 3개 `exports` 를 `CRM_ENABLED` 플래그 뒤로 옮긴다 (코드 자체는 보존)
2. **최초 1회 명시적 삭제** — 배포 파이프라인이 아니라 손으로 한 번:
   ```
   firebase functions:delete webhookKakao webhookNaver sendChatReply \
     --region asia-northeast3 --project lumiclinic-c1a95 --force
   ```
3. 이후에는 source 에 export 가 없으므로 워크플로우가 다시 올리지 않습니다

> `firebase deploy --only functions --force` 로도 삭제되지만, 그 플래그는 **소스에 없는 모든
> 함수를 지웁니다.** 의도치 않은 함수까지 날아갈 수 있으므로 `functions:delete` 로
> 대상을 명시하는 편이 안전합니다.

### 부수 영향 — Phase 0.5 와 자연히 맞물립니다

통합앱의 채팅 전송 버튼(`staff.html:895`)이 `sendChatReply` 를 호출합니다
(`staff.html:11453`). 함수를 지우면 이 버튼이 실패하는데,

- 호출부가 이미 `try/catch` 로 감싸여 경고만 찍습니다 (`staff.html:11458`)
- Phase 0.5 의 `CRM_ENABLED=false` 가 채팅 UI 자체를 숨깁니다

→ **두 작업을 같은 Phase 에서 하면 사용자에게 보이는 오류가 없습니다.** 순서는
UI 숨김(`CRM_ENABLED`)을 먼저 배포하고, 그다음 함수 삭제입니다.

> 루미 인스턴스는 `CRM_ENABLED=true` 로 채팅 UI가 남지만, 애초에 채널이 연결된 적이
> 없어 스레드가 유입되지 않으므로 전송 버튼을 쓸 일이 없습니다. 상담톡을 실제로
> 쓰기로 결정하는 시점에 HMAC 검증과 함께 재배포합니다.

---

## ISSUE-7 — `currentStock` / `totalStock` 중복 필드

**심각도: 낮음 (구조적 부채. 단, HOTFIX 대상 버그의 근본 원인)**
**처리: ❌ 이번 프로젝트에서 손대지 않음 (`DECISIONS-2.md` 결정)**

### 현상

`inventory` 문서가 **같은 값을 두 필드에 중복 저장**합니다. 둘 다 `Σlocations` 입니다.

거의 모든 갱신 지점이 두 필드를 함께 쓰지만, **한 곳이라도 빠뜨리면 두 화면이 다른 숫자를
보여줍니다.** 실제로 그 일이 일어났습니다 (§해결됨 FIXED-2).

### 근거

두 필드를 함께 쓰는 지점

| 위치 | 내용 |
|---|---|
| `staff.html:5925-5926` | 장소 키 통합 |
| `staff.html:6151-6152` | 장소 rekey |
| `staff.html:6193-6194` | 장소 삭제 |
| `staff.html:14849-14850` | 재고 장소 이동 |
| `inventory.js:273-274` | 관리자앱 품목 저장 |

참조 규모

| 필드 | 라인 | 등장 |
|---|---|---|
| `currentStock` | 59 | 65 |
| `totalStock` | 19 | 20 |

읽는 쪽이 갈려 있습니다 — 재고 목록·발주 배지·발주 예측·재고 가치는 `currentStock`,
입고 탭 화면은 `totalStock`(`staff.html:15619`, `15644`).

### 왜 지금 안 고치는가

- `currentStock` 참조가 59개 라인. 통합은 넓은 수술이고 회귀 위험이 큽니다
- 멀티테넌시 개조와 성격이 다릅니다 (범위 혼합 금지)
- HOTFIX-1로 **증상은 막혔습니다.** 구조는 남지만 지금 당장 데이터가 틀리지는 않습니다

### 나중에 할 일

- `totalStock` 을 폐기하고 `currentStock` 하나로 통합
- 또는 두 필드를 함께 쓰는 헬퍼 하나를 두고 직접 `update` 를 금지
- Phase 1에서 재고 컬렉션을 어차피 손대므로, **그때 헬퍼만 도입해 두면 통합이 쉬워집니다** (선택)

---

## 해결됨

> 삭제하지 않고 남겨둡니다. 같은 것을 다시 이슈로 올리지 않기 위해서입니다.

### FIXED-2 — 입고 탭이 `currentStock` 을 갱신하지 않던 버그 ✅

- **처리:** HOTFIX-1 — `claude/hotfix-inventory-currentstock` 브랜치, 커밋 `fa6727e`
- **증상:** 입고 탭(`submitReceiving`)이 `totalStock` 만 쓰고 `currentStock` 을 남겨두어,
  입고해도 재고 목록 수량·발주 필요 배지·재고 가치·발주 예측이 옛 값을 표시.
  입고 탭 자신은 `totalStock` 을 읽어 자기 화면에서만 정상으로 보였습니다.
- **위치:** `staff.html:15939` 부근 (main `df21ee7` 기준)
- **과거 데이터:** HOTFIX-2 (`scripts/fix-currentstock.js`) 로 `Σlocations` 기준 복구.
  **보고서 확인 → 승인 → 실행 순서.** 진행 상태는 대화 기록 참조
- **근본 원인:** ISSUE-7 (중복 필드 구조)

### FIXED-3 — 발주 예측이 `receivingHistory` 입고를 누락 ⏸

- **처리 예정:** HOTFIX-3 — HOTFIX-2 보고서 확인 후 착수
- **증상:** `analyzeItem()`(`staff.html:15706-15769`)이 `receiveHistory` 만 읽어,
  입고 탭으로 들어온 물량이 `totalReceived` 에 잡히지 않음 → 월 소비량·발주 시점 오차
- **판단 보류 사유:** HOTFIX-2 보고서의 `batches[]` 보유 품목 수가 곧 입고 탭 사용량입니다.
  0건이면 `receivingHistory` 가 사실상 미사용이므로 HOTFIX-3 자체가 불필요해집니다
- **방침:** 두 컬렉션을 합치지 않습니다. 정규화 함수를 두고 **집계 결과만** 더합니다
  (`DECISIONS-2.md` HOTFIX-3)

---

## 참고 — 이슈가 아니라 결정 사항인 것

혼동을 막기 위해 적어 둡니다. 아래는 버그가 아니라 `DECISIONS.md` / `DECISIONS-2.md` 에서
**의도적으로 내린 결정**이므로 이 문서의 대상이 아닙니다.

| 항목 | 근거 문서 |
|---|---|
| `receiveHistory` / `receivingHistory` 두 컬렉션 병존 | `DECISIONS-2.md` 결정 A — 통합은 파일럿 이후 |
| 매출·비용·세무를 SaaS에서 제외 | `DECISIONS.md` 질문 1 — `FINANCE_ENABLED` 격리 |
| 인센티브 규칙 빌더 미제작 | `DECISIONS.md` 질문 3 — 3종 고정 |
| `employees/{이름}` → `{autoId}` 전환 | `DECISIONS-2.md` 결정 B — Phase 1 |
| CRM 기능 유지 (삭제하지 않음) | `BRIEF.md` — `CRM_ENABLED` 플래그로 격리 |
