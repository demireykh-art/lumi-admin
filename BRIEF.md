# 작업 지시서 — 병원 ERP 멀티테넌시 개조

## 배경

`staff.html`은 현재 **루미클리닉 한 곳 전용**으로 동작하는 단일 페이지 앱이다.
Firebase(Auth + Firestore + Storage + Cloud Functions) 기반이며, 다음 기능이 이미 구현되어 있다.

- 출퇴근, 연차, 오프 캘린더, 직원 관리
- OT(점심/퇴근후), 식대(영수증 OCR), 인센티브, 급여명세서
- 재고 실사·입고·배치·유통기한·장소 이동·발주 예측·거래처·비품 구매요청
- (제외 대상) 시술 수가표, 상담 트리, 상담 차팅, 고객 채팅, 제품 평점, 시술시간, 바우처

**목표: 이 앱을 여러 병원에 판매하는 SaaS로 전환한다.**

---

## 범위 — 반드시 지킬 것

### 판매할 모듈 (3개)

| ID | 이름 | 포함 기능 | 월 요금 | 의존 |
|---|---|---|---|---|
| `core` | 기본·직원관리 | 직원 등록, 출퇴근, 연차 신청·승인, 오프 캘린더 | 30,000 | — |
| `payroll` | 급여팩 | OT, 식대 정산, 인센티브, 급여명세서 | 40,000 | `core` |
| `inventory` | 재고팩 | 재고 실사·입고·배치·유통기한·장소이동·발주예측·거래처·비품요청 | 40,000 | — |

- `core`는 항상 켜져 있다(끌 수 없음).
- `payroll`을 켜면 `core`가 자동으로 켜진다. `core`를 끄면 `payroll`도 꺼진다.
- `inventory`는 단독 구독이 가능하다.

### 판매하지 않는 기능 (환자 개인정보 포함 → SaaS 제외)

**상담 차팅, 상담 트리, 고객 채팅, 시술 수가표, 제품 평점, 시술시간, 바우처, 시술 마스터, 주사제 믹스**

이 기능들은 **삭제하지 말고**, 빌드 플래그 하나로 통째로 숨길 수 있게 격리한다.
루미클리닉 자체 인스턴스에서는 계속 써야 한다.

```js
const CRM_ENABLED = false;   // SaaS 배포 시 false
```

관련 Firestore 경로와 Cloud Function도 SaaS 배포본에서는 Rules로 완전 차단한다.

---

## Phase 0 — 조사부터. 코드를 고치기 전에 보고서를 먼저 낸다

**이 단계를 건너뛰고 리팩터링을 시작하지 말 것.**

다음을 조사해서 `AUDIT.md`로 제출한다.

1. **하드코딩 인벤토리**
   - `lumi`, `@lumi.local`, `5층`, `6층` 문자열이 나오는 모든 위치와 개수
   - 하드코딩된 enum 전부: 직급, 재고 카테고리(간호/피부/데스크/공통), 인센티브 유형 4종, 식대 정책(월한도제/일할적립제), 재고 타입(1회용/소분용/위생용품)
   - 각 항목이 **설정값으로 빼야 하는지 / 그대로 둬도 되는지** 판정

2. **Firestore 컬렉션 지도**
   - 현재 최상위 컬렉션 전체 목록
   - 각 컬렉션이 어느 모듈(core/payroll/inventory/CRM)에 속하는지 매핑
   - 컬렉션 간 참조 관계 (특히 재고 ↔ 시술마스터 레시피처럼 CRM과 얽힌 지점)

3. **CRM 결합 지점**
   - 재고 모듈이 시술 수가표·시술 마스터에 의존하는 부분을 전부 찾는다
   - CRM을 끄면 재고가 깨지는지 판정. 깨진다면 어떻게 분리할지 제안

4. **Cloud Functions 목록**과 각각이 병원별로 분리 가능한지

5. **예상 공수** — 아래 Phase 1~5 각각에 대해 실측 기반으로 재추정

보고서를 받고 내가 승인한 뒤에 Phase 1을 시작한다.

---

## Phase 1 — 데이터 모델 이관

모든 데이터를 `clinics/{clinicId}/` 하위로 옮긴다.
필드에 `clinicId`를 추가하는 방식은 **쓰지 않는다.** Security Rules가 지저분해지고 실수로 새는 경로가 생긴다.

```
clinics/{clinicId}
  ├─ settings/
  │    ├─ modules      { core, payroll, inventory, billedAt, monthlyFee }
  │    ├─ profile      { name, dept, slug, createdAt, staffCount }
  │    ├─ org          { ranks[], mealPolicy, incentiveRules[] }
  │    └─ locations    { floors[], places[] }
  ├─ employees/{uid}
  ├─ attendance/{doc}
  ├─ leaves/{doc}
  ├─ overtime/{doc}
  ├─ meals/{doc}
  ├─ payslips/{doc}
  ├─ incentives/{doc}
  ├─ stockItems/{doc}
  ├─ stockBatches/{doc}
  ├─ stockCounts/{doc}
  ├─ vendors/{doc}
  └─ purchaseRequests/{doc}
```

**작업 방식**
- 이관 스크립트(`scripts/migrate.js`)를 작성한다. **멱등**이어야 한다. 두 번 돌려도 안전할 것.
- 실행 전 전체 백업을 뜨고, dry-run 모드를 먼저 지원한다.
- 루미클리닉 실데이터로 검증한다. 데이터 유실은 절대 안 된다.
- 이관 후 검증 스크립트로 문서 수를 대조한다.

---

## Phase 2 — 인증과 게이팅 (3단)

### Custom Claims

```js
{ clinicId: 'seum', role: 'owner' }   // role: owner | manager | staff
```

Cloud Function `setClinicClaims`로 발급한다.
**Rules 안에서 병원 판별을 위해 Firestore를 조회하지 말 것.** read 과금이 폭증한다. Claims로 해결한다.

Auth 이메일 형식: `{loginId}@{clinicSlug}.local`
기존 `@lumi.local` 계정은 이관 시 유지한다(재로그인 요구 금지).

### 3단 게이팅 — 셋 다 구현한다

1. **UI** — 결제하지 않은 모듈의 탭·메뉴를 렌더하지 않는다 (기존 "Staff App 탭 노출 설정" 로직 재활용)
2. **라우팅 가드** — 해시/직접 진입 차단
3. **Security Rules** — 실제 차단. 이게 없으면 나머지는 장식이다

### Rules 기본형

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    function mine(cid) {
      return request.auth != null && request.auth.token.clinicId == cid;
    }
    function has(cid, mod) {
      return get(/databases/$(db)/documents/clinics/$(cid)/settings/modules)
             .data[mod] == true;
    }
    function isOwner() {
      return request.auth.token.role == 'owner';
    }

    match /clinics/{cid}/employees/{doc} {
      allow read:  if mine(cid) && has(cid, 'core');
      allow write: if mine(cid) && has(cid, 'core') && isOwner();
    }

    match /clinics/{cid}/payslips/{doc} {
      allow read:  if mine(cid) && has(cid, 'payroll')
                   && (isOwner() || resource.data.uid == request.auth.uid);
      allow write: if false;              // 서버에서만 생성
    }

    match /clinics/{cid}/stockItems/{doc} {
      allow read, write: if mine(cid) && has(cid, 'inventory');
    }

    match /clinics/{cid}/settings/modules {
      allow read:  if mine(cid);
      allow write: if false;              // 운영 콘솔(Admin SDK)에서만
    }
  }
}
```

**요구사항**
- 급여명세서는 본인 것만 읽힌다. 원장(owner)은 전체를 읽는다.
- 모듈 설정 문서는 클라이언트에서 절대 쓸 수 없다.
- `has()`가 매 요청 Firestore를 읽으므로, 모듈 상태도 Custom Claims에 함께 넣어 캐싱하는 방안을 검토하고 트레이드오프를 보고할 것 (Claims는 갱신 지연이 있음).

### 침투 테스트 필수

Firebase Emulator + `@firebase/rules-unit-testing`으로 다음을 **테스트 코드**로 검증한다.

- A병원 계정으로 B병원 문서 읽기 → 실패해야 함
- `inventory` 미결제 병원이 `stockItems` 읽기 → 실패해야 함
- 일반 직원이 남의 급여명세서 읽기 → 실패해야 함
- 클라이언트에서 `settings/modules` 쓰기 → 실패해야 함
- CRM 경로 전체 접근 → SaaS 배포본에서 실패해야 함

---

## Phase 3 — 하드코딩 제거

Phase 0 인벤토리를 기준으로 전부 `settings/org`, `settings/locations`로 뺀다.

**인센티브가 가장 어렵다.** 현재 4종 고정(총매출-개인합계 / 본인매출 / 총매출전체 / 일본인건별)인데 이건 루미 전용 규칙이다.

**1차 버전에서는 규칙 빌더를 만들지 않는다.** 다음 세 가지 조합만 지원한다.

```js
{ name: '신환 유치', type: 'perCase', amount: 10000 }
{ name: '본인 매출', type: 'percent', base: 'ownRevenue', rate: 3 }
{ name: '기타',     type: 'manual' }              // 원장이 직접 금액 입력
```

복잡한 규칙은 `manual`로 받는다. 파일럿 5곳에서 실제 사용 패턴을 본 뒤에 빌더를 설계한다.
**이 결정을 임의로 확장하지 말 것.** 범위가 터진다.

---

## Phase 4 — 운영 콘솔 연동

별도 파일 `admin.html`이 제공된다(모듈 매트릭스 UI, 의존성 해석, 문서 미리보기 포함).
현재는 목업 데이터로 동작하며, 다음 자리에 실제 연동을 붙인다.

- `saveClinic()` → `settings/modules` 갱신 + `setClinicClaims` 호출
- `createClinic()` → 병원 문서 생성 + 시드 템플릿 주입 + owner 계정 발급
- `bizAdmins.emails`에 등록된 계정만 접근 (Admin SDK 경유, 클라이언트 직접 쓰기 금지)

시드 템플릿: 피부과 / 성형외과 / 정형외과 / 빈 상태
각 과의 재고 분류, 직급, 기본 인센티브 항목을 초기값으로 채운다.

---

## Phase 5 — 온보딩 · 결제

- 온보딩 마법사: 병원 정보 → 층·장소 등록 → 직원 일괄 등록(CSV) → 재고 초기 실사
- 토스페이먼츠 정기결제 연동
- 미납 시 자동 잠금: `settings/modules`를 건드리지 말고 별도 `settings/billing.status`로 제어. 결제 재개 시 모듈 구성이 그대로 복원되어야 한다.

---

## 작업 규칙

- **한 번에 하나의 Phase만.** 각 Phase 완료 후 보고하고 승인받는다.
- 커밋은 기능 단위로 쪼갠다. "멀티테넌시 적용" 같은 거대 커밋 금지.
- 기존 동작을 깨뜨리는 변경은 반드시 사전에 알린다. 루미클리닉이 매일 실사용 중이다.
- 리팩터링 중 발견한 버그는 고치지 말고 `ISSUES.md`에 기록만 한다. 범위를 섞지 않는다.
- 라이브러리 추가는 사전 승인. 지금은 vanilla JS + Firebase SDK만 쓴다.
- 불확실하면 추측해서 진행하지 말고 질문한다.

## 완료 기준

- [ ] 신규 병원을 콘솔에서 5분 안에 만들 수 있다
- [ ] Rules 침투 테스트가 전부 통과한다
- [ ] 루미클리닉 데이터가 하나도 유실되지 않았다
- [ ] `CRM_ENABLED = false`로 빌드하면 CRM 흔적이 UI·네트워크 요청 어디에도 없다
- [ ] 병원 2곳을 동시에 띄워놓고 데이터가 섞이지 않는다
