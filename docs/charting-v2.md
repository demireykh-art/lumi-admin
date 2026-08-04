# 상담 차팅 v2 — 역할 분리 + 레시피 + 재고 자동 차감

**결정일**: 2026-08 · **상태**: 스펙 확정 (구현 대기)  
새 세션 시작 시 이 문서 + `CLAUDE.md` + `docs/integrated-app.md` 참고.

---

## 1. 목표 & 비목표

### 목표
- 원장·실장·스탭 3역할이 각자 뷰에서 차팅 → 실시간 통합
- 시술 오더가 확정되면 스탭 뷰에 **[준비 카드]** 자동 생성
- 준비 완료 시 재고 자동 차감 (레시피/BOM 기반)
- 회차권·금액권·S/V 오더 관리 (통합앱이 원천)
- 통합앱을 **비보험 진료 CRM 원천**으로 확립

### 비목표 (하지 않음)
- Vegas 대체 (보험진료·결제는 Vegas 유지)
- 원장 진단서·처방전 발행 (Vegas)
- 실시간 Vegas API 자동 연동 (수동 참조·복사만)
- 회계·세무 처리

---

## 2. 역할 정의 (Q1=a)

`employees.chartRole` 필드 신규 (기존 `role` 과 별개):

| chartRole | 접근 가능 편집 섹션 | 기본 진입 탭 |
|---|---|---|
| `doctor`     | doctorSection | 원장 |
| `consultant` | consultSection | 실장 |
| `staff`      | staffSection | 스탭 |
| `multi`      | 전부 | 원장 |
| (미지정)     | 읽기 전용 (전체) | 원장 |

**모든 역할이 다른 섹션 읽기 가능**. 편집만 자기 섹션 제한. 대표원장(adminHigh)은 자동으로 `multi` 로 취급.

---

## 3. 데이터 모델

### 3.1 `procedures/{procId}` — 시술 마스터 (Q2=b 자동 파생)

`feeSchedule.categories[].treatments[].variants[]` 각 옵션을 procedure 하나로 매핑:

```
procId = feeSchedule.variantId  (안정적 id 유지)
```

```javascript
{
  code: 'BOTOX_TRAP_100U',           // 오더 코드 (옵션 : 수기 부여 or auto)
  name: '승모근 보톡스 100U',          // variant.label
  category: '보톡스',                 // treatment.category  (수가표 카테고리)
  treatmentName: '승모근 보톡스',      // treatment.name
  price: 300000,                     // variant.price * 10000 (만원 → 원)
  vatIncluded: true,
  recipe: [
    { itemId, itemName, qty, unit, memo }   // inventory 참조
  ],
  needsAnesthesia: false,
  needsPhoto: true,
  defaultStaffRole: 'nurse',
  minutes: 15,
  active: true,
  updatedAt, updatedBy
}
```

**파생 규칙**:
- `feeSchedule` Firestore 실시간 스냅샷에서 자동 파생
- 삭제된 variant → procedure.active = false
- recipe·needsAnesthesia 등은 사용자가 추가 편집 (덮어쓰지 않음)

### 3.2 `vouchers/{voucherId}` — 회차권/금액권 (Q5=b 통합앱 원천)

```javascript
{
  patientId,           // 없으면 chartNo·name 조합
  chartNo,
  patientName,
  type: 'sessions' | 'amount' | 'sv',
  productName: 'BB토닝 5회권',
  procId: 'variantId', // 어떤 시술의 회차권인지
  
  // 회차권
  totalSessions: 5,
  usedSessions: 2,
  
  // 금액권
  totalAmount: 1200000,
  usedAmount: 480000,
  
  price: 1200000,       // 실제 결제 금액
  purchasedAt: '2026-06-01',
  expiresAt: '2026-12-01',
  vegasPaymentRef: 'VEGAS_XXX',   // 수기 입력 (선택)
  status: 'active' | 'expired' | 'exhausted' | 'refunded',
  createdBy, updatedAt
}
```

### 3.3 `visits/{visitId}` — 상담 차트 (기존 확장)

**기존 필드 유지 + 3개 섹션 필드 추가**:

```javascript
{
  // ─── 기존 (유지, 마이그레이션 필요) ───
  chartNo, patientName, date,
  doctorTags: [],       // legacy → doctorSection.diagnosis 로 이관
  planTags: [],         // legacy → doctorSection.treatmentPlan 로 이관
  doctorMemo: '',       // legacy → doctorSection.freeNote
  consultMemo: '',      // legacy → consultSection.consultNote
  orders: [],           // legacy → consultSection.confirmedOrders 로 이관
  extraMemo: '',        // legacy → consultSection.extraMemo
  
  // ─── 신규: 3-섹션 ───
  doctorSection: {
    visitType: 'first' | 'revisit',
    diagnosis: [
      { tag: '색소', detail: '흑자·기미' }
    ],
    treatmentPlan: [
      { procId, note }              // 시술 마스터 참조
    ],
    todayProcedures: [
      { procId, note }              // 원장이 오늘 직접 시행
    ],
    progressNote: '',               // 재진 경과
    freeNote: '',                   // 자유메모
    updatedBy, updatedAt
  },
  
  consultSection: {
    consultNote: '',
    confirmedOrders: [
      {
        orderId: 'uid',
        procId, procName,
        orderType: 'single' | 'sessions' | 'amount' | 'sv',
        price: 300000,
        voucherRef: 'voucherId',    // 회차권 사용 시
        paymentStatus: 'pending' | 'paid' | 'refunded',
        vegasPaymentRef: '',        // Vegas 결제 참조 (수기)
        note: ''
      }
    ],
    extraMemo: '',
    updatedBy, updatedAt
  },
  
  staffSection: {
    photos: [
      { takenAt, staffId, note }
    ],
    prepCards: [
      {
        cardId: 'uid',
        procId, procName,
        recipeSnapshot: [
          { itemId, itemName, plannedQty, actualQty, unit, memo }
        ],
        anesthesia: 'none' | 'topical' | 'local',
        status: 'waiting' | 'preparing' | 'prepared' | 'done',
        preparedBy, preparedAt,
        doneBy, doneAt,
        deductionTxIds: [],         // inventoryTransactions 참조
        prepMemo: ''
      }
    ],
    generalMemo: '',
    updatedBy, updatedAt
  },
  
  status: 'draft' | 'in_progress' | 'consult_done' | 'prep_done' | 'done',
  createdAt, createdBy, updatedAt
}
```

### 3.4 `inventoryTransactions/{txId}` — 재고 이동 로그

```javascript
{
  itemId, itemName,
  type: 'procedure_use' | 'audit' | 'receive' | 'move' | 'refund' | 'manual',
  qty: -6,                     // 음수=차감, 양수=입고
  balanceAfter: 118,
  visitId: '', procId: '',     // 시술 소비 시
  cardId: '',                  // staffSection.prepCards 참조
  refundedFrom: txId,          // 취소 시 원 트랜잭션
  createdBy, createdAt
}
```

---

## 4. 워크플로우

### 4.1 상태 흐름
```
draft
  └─ [원장 진단·플랜 입력] → in_progress
       └─ [실장 오더 확정] → consult_done
            └─ [스탭 준비 완료] → prep_done  (재고 차감 발생)
                 └─ [시술 완료] → done
```

### 4.2 오더 확정 → 준비 카드 자동 생성
실장이 `confirmedOrders.push()` 하면:
- 해당 `procId` 조회
- `procedures.recipe` 를 `prepCards[].recipeSnapshot` 으로 복사 (스냅샷)
- status = 'waiting'
- 스탭 뷰에 실시간 표시 (Firestore snapshot)

### 4.3 재고 차감 (Q3=a 준비 완료 시)
스탭이 `[준비 완료]` 클릭 → Firestore transaction:
1. 각 `recipeSnapshot[i]` 의 `actualQty` 만큼 `inventory[itemId].locations[loc]` 차감
2. `inventoryTransactions` 로그 기록 (type='procedure_use', qty=-actualQty)
3. `prepCards.status = 'prepared'`, `deductionTxIds` 저장
4. **재고 부족 감지**: 음수 되면 트랜잭션 실패 + 경고

### 4.4 취소 시 복구
방문 삭제 or 준비 취소 시:
1. `deductionTxIds` 순회
2. 각 tx 에 대해 반대 부호로 새 tx 생성 (type='refund', refundedFrom=txId)
3. `inventory` 원복
4. `prepCards.status = 'waiting'`

### 4.5 회차권 사용 흐름
- 실장이 오더 시 `orderType='sessions'` 선택
- 환자의 `vouchers` 조회 → 해당 procId 활성 바우처 선택
- 오더에 `voucherRef` 저장
- 오더 확정 시 `vouchers.usedSessions += 1`
- 매출은 0원 처리 (이미 구매 시 매출 잡음)

---

## 5. UI 구조

### 5.1 상담 차팅 편집 화면 (기존 `chartingEdit` 확장)

```
┌─ 헤더: 환자정보 · 담당자 · 상태 뱃지 ─────────┐
├─ 탭 [원장] [실장] [스탭]  ← chartRole 로 기본 선택 ─┤
│                                                    │
│  원장 탭:                                          │
│    - 방문유형 (초진/재진)                          │
│    - 진단 태그 (chip)                              │
│    - 플랜 (procedures 자동완성 chip)               │
│    - 오늘 직접 시행 (procedures)                   │
│    - 경과 / 자유메모                               │
│                                                    │
│  실장 탭:                                          │
│    - 상담 메모                                     │
│    - 오더 (procedures 자동완성 + orderType 선택)   │
│    - 회차권 옵션 활성 시 → 잔여 회차 표시          │
│    - Vegas 결제 참조 (텍스트)                      │
│    - 추가 메모                                     │
│                                                    │
│  스탭 탭:                                          │
│    - 진단사진 촬영 체크·기록                       │
│    - 확정 오더 → 준비 카드 리스트                  │
│      · 레시피 표시 · actualQty 편집               │
│      · 마취 선택                                   │
│      · [준비 완료] 버튼 → 재고 차감               │
│    - 일반 메모                                     │
│                                                    │
├─ 하단: 📋 복사 · 💾 저장 · 🗑 삭제 ───────────────┤
└────────────────────────────────────────────────────┘
```

### 5.2 관리자 화면 (⚙ 관리자 설정 확장)

- **🔧 시술 마스터 관리** — `procedures` CRUD
  - 수가표에서 자동 파생 + recipe 편집
  - 각 시술에 [레시피 편집] 버튼 → 재고 아이템 선택·수량 입력
- **🎫 바우처 관리** — `vouchers` 조회·발급·환불
- **📋 재고 트랜잭션 로그** — `inventoryTransactions` 조회

### 5.3 홈 카드 (변경 없음)
- 📋 **상담 차팅** — 지금과 동일한 진입점

---

## 6. Vegas 관계

- 결제: **Vegas 원천**
  - 통합앱 오더에 `vegasPaymentRef` (문자열) 수기 입력
  - 결제 완료 시 실장이 `paymentStatus='paid'` 수동 토글
- 보험진료: **Vegas 원천** — 통합앱 개입 없음
- 오더 코드 매핑: **최소 1:다** — 통합앱 procedures 여러 개가 Vegas 오더 "비보험진료" 1건으로 결제
- **환자 인식**: `chartNo` 로 매칭 (Vegas 차트번호 = 통합앱 chartNo)

---

## 7. 마이그레이션 (기존 데이터)

기존 `visits/{id}` 필드 → 새 섹션으로 자동 이관 (읽기 시점 fallback):

```javascript
function _migrateVisit(v) {
  return {
    ...v,
    doctorSection: v.doctorSection || {
      diagnosis: (v.doctorTags||[]).map(t=>({tag:t, detail:''})),
      treatmentPlan: (v.planTags||[]).map(t=>({tag:t, note:''})),
      freeNote: v.doctorMemo || '',
      todayProcedures: [], progressNote: '',
    },
    consultSection: v.consultSection || {
      consultNote: v.consultMemo || '',
      confirmedOrders: (v.orders||[]).map(o => ({
        orderId: _uid(),
        procId: null,
        procName: o.name,
        orderType: 'single',
        price: o.price || 0,
        note: o.memo || '',
        paymentStatus: 'unknown',
      })),
      extraMemo: v.extraMemo || '',
    },
    staffSection: v.staffSection || { photos:[], prepCards:[], generalMemo:'' },
    status: v.status || 'done',
  };
}
```

기존 데이터는 저장 시 자동으로 새 스키마로 upgrade. 강제 백필 안 함.

---

## 8. 구현 페이즈

### Phase 1 — 역할 분리 + procedures 파생 (2~3일) ✅ 구현 완료 (2026-08)
- [x] `employees.chartRole` 필드 (⚙ 관리자 설정 → 🩺 차팅 역할 관리에서 수동 설정)
- [x] `visits` 새 스키마 read/write + 마이그레이션 헬퍼 (`_migrateVisit`, 읽기 시점 fallback)
- [x] `chartingEdit` 화면 3-섹션 탭 재구성 (원장/실장/스탭)
- [x] chartRole 기반 탭 자동 선택 · 편집 제한 (`_chartMyRole`/`_chartCanEdit`/`_chartDefaultTab`)
- [x] `procedures` 컬렉션 자동 파생 (feeSchedule 스냅샷 리스너에서 upsert, `_deriveProceduresFromFee`/`_syncProceduresToFirestore`)
- [x] 원장 진단·플랜, 실장 오더에서 procedures 자동완성 (`ceProcDL` datalist)

**구현 메모**
- **미지정 chartRole 처리**: 스펙(§2)은 "미지정 = 읽기 전용"이나, 라이브 롤아웃 안전을
  위해 **미지정은 전체 편집 허용**으로 구현(기존 동작 유지). 역할이 배정된 사용자만
  자기 섹션으로 편집 제한. adminHigh 는 자동 multi. → 역할 배정 후 제한이 활성화됨.
- **procedures Firestore 동기화**: 쓰기 충돌·비용을 줄이려 **adminHigh 계정에서만** upsert.
  전 계정은 in-memory `_procCache` 로 자동완성 사용. recipe·needsAnesthesia·code(사용자
  부여) 등 편집 필드는 파생 시 덮어쓰지 않음. 삭제된 variant 는 `active:false`.
- **저장 스코프**: 기존 방문 저장 시 헤더 + 편집 가능한 섹션만 갱신(섹션별 클로버 최소화).
  신규 방문은 3-섹션 전체 기록. `status` 는 내용 기반 자동 계산(기존 상태보다 낮추지 않음).
- **레거시 호환**: 저장 시 새 스키마로만 기록(강제 백필 없음). 목록·타임라인·복사·최근태그
  등 읽기 경로는 모두 `_migrateVisit` 로 승격 후 렌더. Phase 1 은 legacy 필드를 더 이상
  쓰지 않음(읽기 fallback 으로만 참조).
- **스탭 탭(Phase 1)**: 확정 오더 미리보기 + 진단사진 기록 + 일반 메모까지. 준비 카드
  자동 생성·재고 자동 차감은 Phase 2·3 에서.

### Phase 2 — 시술 마스터 편집 + 스탭 뷰 (2~3일)
- [ ] ⚙ 관리자 설정 → 시술 마스터 관리 UI
- [ ] 레시피 편집 (재고 아이템 선택 + 수량)
- [ ] 스탭 뷰 준비 카드 리스트
- [ ] 오더 확정 시 준비 카드 자동 생성

### Phase 3 — 재고 자동 차감 엔진 (1~2일)
- [ ] Firestore transaction 안전 차감
- [ ] `inventoryTransactions` 로그
- [ ] 재고 부족 방지 (음수 방지)
- [ ] 취소·환불 시 복구

### Phase 4 — 바우처 (2일)
- [ ] `vouchers` 컬렉션 CRUD
- [ ] ⚙ 관리자 설정 바우처 관리
- [ ] 실장 오더 시 바우처 선택 · 자동 차감
- [ ] 환자 타임라인에 바우처 잔여 표시

### Phase 5 — Vegas 매핑 · 통계 (1~2일)
- [ ] `vegasPaymentRef` 필드 UI (수기)
- [ ] `paymentStatus` 토글
- [ ] 미결제 오더 리스트 (실장 대시보드)
- [ ] 통계: 시술별 매출·재고 소비량 리포트

**총 예상**: 10~14 작업일 (기능·안정화·테스트 포함)

---

## 9. 오픈 이슈 & 결정 유보

- **레시피 데이터 초기 등록**: 시술 몇 개 예시 시딩 필요 (사장님 제공)
  - 승모근 보톡스 100U + 세부 예시 알려주면 즉시 시딩
- **retail products (금액권 상품) 정의**: 회차권 vs 순수 금액권 vs 프로모션 구분 명확화 필요
- **부서별 재고 격리**: 스탭이 자기 부서 재고만 차감할지, 전체 pool 인지
- **audit·receive 로그 소급 통합**: 지금은 `inventoryLogs`·`inventoryAudits`·`receiveHistory` 3개 컬렉션 → `inventoryTransactions` 로 통합 여부 결정
- **원장이 오늘 직접 시행 (todayProcedures)** 도 실장 오더 없이 재고 차감 필요? → 자동 준비 카드 생성?

---

## 10. 다음 액션

1. **이 문서 확정** — 사장님이 승인하면 Phase 1 착수
2. **Phase 1 개발** — 새 세션 시작 시 이 문서 참고 요청
3. **레시피 시딩** — 자주 쓰는 시술 5~10개 우선

새 세션 시작 프롬프트 예시:
```
프로젝트: 루미의원 통합앱
브랜치: claude/create-quote-document-AcRVl

CLAUDE.md · docs/integrated-app.md · docs/charting-v2.md 읽고 컨텍스트 파악.
목표: docs/charting-v2.md 의 Phase 1 착수
   - employees.chartRole 필드
   - visits 스키마 마이그레이션 (읽기 시점 fallback)
   - chartingEdit 3-섹션 탭 재구성
   - procedures 자동 파생

/init 로 CLAUDE.md 있으면 참고, 없으면 무시.
```
