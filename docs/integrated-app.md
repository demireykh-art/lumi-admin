# 통합앱 (staff.html) 기능 개발

이 문서는 상담챗을 제외한 통합앱 나머지 기능의 개발 상태·계획 문서다.
상담챗(카카오·네이버 통합) 관련은 `docs/chat-integration.md` 참고.
새 세션 첫 메시지에서 이 문서 참고 요청 권장.

---

## 완성된 기능 (2026-08 현재)

### 📦 재고 관리 (`staff.html` inventory 영역)
- 파트별 카드 홈 (필터·검색·정렬)
- 실사 입력 (장소별·다중 위치)
- 입고 처리 (`receiveHistory` 기록)
- 장소 이동 (기존 → 새 장소, 총 재고 유지)
- 발주 추천 (`analyzeItem` 로직, receiveHistory 기반)
- 소진 추이 차트 (📊 소진 버튼 — 주별/월별 CSS 바)
- 거래처(vendors) 관리 — Firestore 실시간 동기화
- 30일+ 미사용 필터·단종 필터
- 재고 0 장소 유지 (재입고 편의)

### 💊 시술 수가표
- `settings/feeSchedule` Firestore 실시간 동기화
- 카테고리·시술·옵션 3단계 트리
- 더블탭·더블클릭 인라인 편집 (전 레벨)
- 접기/펼치기·순서 이동
- 상담 태그(피부/쳐짐/꺼짐/전문)

### 📋 상담 차팅 (Vegas Chart 보조) — v2 Phase 1 반영 (2026-08)
- `visits` 컬렉션 (환자별 방문) — 3-섹션 스키마(doctorSection/consultSection/staffSection)
  · 읽기 시점 마이그레이션(`_migrateVisit`)으로 legacy 필드 자동 승격
- **역할(chartRole) 분리**: 원장/실장/스탭 3탭, chartRole 로 기본 탭 자동선택·편집 제한
  · ⚙ 관리자 설정 → 🩺 차팅 역할 관리에서 직원별 지정 (미지정=전체 편집, adminHigh=multi)
- 원장: 진단 태그 + 플랜/오늘시행(시술 자동완성) + 경과/자유메모
- 실장: 상담 메모 + 확정 오더(시술 자동완성·orderType·결제상태·Vegas 참조)
- 스탭: 확정 오더 미리보기 + 진단사진 기록 + 일반 메모 (준비카드·재고차감은 Phase 2·3)
- `procedures` 자동 파생: feeSchedule variants → 시술 마스터 (자동완성·오더 매칭)
- 환자 타임라인 (방문 시간순 카드) · 방문별 경과(별점 1-5 + 메모) 다건
- 📋 복사 (Vegas 붙여넣기용 포맷) · 상세 스펙: `docs/charting-v2.md`

### 🌳 상담 트리 관리
- `settings/consultTree` (JSON 문자열) Firestore 동기화
- ⚙ 관리자 설정 → 트리 편집기 모달
- 텍스트 붙여넣기 대량 편집 (노션 스타일)
- 시각 편집 (탭·이름변경·이동·삭제)
- 백업/복원 (`consultTreeBackups` 최근 10개)

### 📚 직원 교육·인계
- `handovers` 컬렉션 Firestore 실시간 동기화
- 홈 카드 `📚 직원 교육·인계` (전 계정 노출)
- 부서 탭: 원장·데스크·피부·간호·공통 (5개)
  · 로그인 계정에 맞는 부서 자동 선택(`_myHandoverDept`): 공용계정 이메일 local-part
    (nurse/desk/skin/doctor…) → 개인계정 `role`(직급) → `chartRole` 순으로 추정
  · 부서 탭 클릭으로 자유 열람 (열람 제한 없음)
- 메모 카드: 제목(선택) + 본문 텍스트(메모장 붙여넣기) + 노션 링크(긴 내용·이미지)
  · 인라인 편집(수정/저장/취소)·삭제, `updatedAt` 최신순 정렬
- 데이터: `handovers/{id}` = {dept, title, body, notionUrl, createdAt, updatedAt, authorName}

### 📢 공지·할일
- `notices` 컬렉션 Firestore 실시간 동기화
- 홈 인라인 (오늘 공지)
- 관리 화면 (검색·필터·날짜별 그룹)
- 체크박스 → 완료 표시

### ⚙ 관리자 설정 (bizAdmins만 접근)
- 헤더 ⚙ 버튼 (경영관리자만 노출)
- 공용 staff 계정 관리 (추가·비번 재설정·화이트리스트 제거)
- 상담 트리 편집기 진입
- Cloud Function `resetUserPassword` 활용

### 🕐 근태·급여 (개인계정용)
- 출퇴근·조퇴(음수 OT)·연차·인센티브
- 급여 산정 화면 (별도 페이지)

### 👥 STAFF 관리 (대표원장 전용, `settings/adminHigh.emails`)
- 홈 카드 `👥 STAFF` — adminHigh 계정만 노출, 대기 배지
- 5개 서브탭:
  - 📅 캘린더: 월별, 각 날짜 셀 하단에 오프자 이름 (대기=노랑, 연차=빨강, 오프=파랑)
  - 📋 승인: 대기 leaveRequests 승인/반려 + 최근 이력
  - 🕐 근태: 오늘 출근 현황 + 이번 달 근태 요약 표
  - ⏰ OT·식사: 이번달 lunchOT 목록 + 직원별 합계
  - 💰 급여·인센티브 (통합앱 완전 이관):
    - 년월 선택기 (이전달/다음달)
    - 🎯 매출 인센티브 입력: 총매출 + 개인매출(수동/자동 소스) → 저장
    - 📋 인센티브 요약: 매출·일본·건별 합계 표 + [⚙ 항목 관리] 모달
    - 📊 사전 급여 대장: 직원별 연봉·저녁OT·점심OT·조퇴·총OT·인센티브
  - 📊 매출 (Google Drive 자동 파싱):
    - 폴더(1BLz...) 파일 목록 조회
    - 오더판매내역및환자내역_YYYYMM.xlsx 파싱
    - Firestore revenue/{ym} 저장 → 급여 탭 인센티브 자동 반영
    - 총매출·일본인 방문객·원장별·직원별·대분류별 표시
    - Cloud Functions: listRevenueFiles, parseRevenueFile
    - Service Account 인증 (DRIVE_SERVICE_KEY secret)
- 데이터: `employees`, `leaveRequests`, `attendance`, `lunchOT`,
  `incentiveItems`, `incentiveRecords`, `monthlyIncentiveInput/{ym}`, `revenue/{ym}`
- 승인 시 `leaveRequests` 상태 업데이트 → 캘린더 즉시 갱신
- 급여 명세서 발행·복잡한 급여 산정은 여전히 index.html에서 (다음 단계)

### 💵 매출 결산 (관리자 전용, `bizAdmins` 또는 `adminHigh`)
마감 화면 사진 여러 장 → OCR → **사람이 검수** → `dailySales/{YYYY-MM-DD}` 저장.

> **이 화면의 성격**: 월간 매출분석은 STAFF 관리 > 📊 매출(구글드라이브 엑셀)이 담당한다.
> 여기는 **매일 코디가 하는 마감정산**용이다. 그래서 기능을 늘릴 때마다
> "코디가 매일 이걸 해야 하나?"를 먼저 묻고, 아니면 접어서 관리자 쪽으로 밀어둔다.

- 홈 카드 `💵 매출 결산` — 관리자 계정에만 노출 (`tab-dailySales`)
- **업로드·검수 화면 — 매일 코디가 쓰는 화면이라 단순함이 최우선이다.**
  화면에 처음 보이는 건 딱 넷: 날짜 · [📷 사진 올리기] · 큰 숫자 · [저장].
  - **버튼 하나, 사진 여러 장.** 표 종류를 고르게 하지 않는다. `ocrDailySales` 를
    `kind` 없이 호출하면 표 제목으로 알아서 분류한다(`dsPickShots` → `_dsIngestPhoto`).
    못 알아본 사진만 "이 사진은 어떤 표인가요?" 하고 버튼으로 되묻고, 그때 쓰려고
    사진 base64 를 `draft.unknown[]` 에 들고 있다가 지정된 kind 로 다시 읽는다.
  - **큰 숫자로 확인** — `오늘 수납 합계`(현금·카드·기타 / 과세·부가세)와
    `오늘 매출(발생)`(오더 건수·보험진료). 코디가 실제 화면·시재와 눈으로 맞추는 값.
  - **검산 통과면 표를 보여주지 않는다.** `🔢 숫자 확인·수정` 은 접혀 있고,
    어긋난 표만 자동으로 펼친다(`_dsWarnScopes`). 정상일 때 코디가 할 일은 [저장] 뿐.
  - 수납 구분표 한 장만 올려도 저장된다 — 화면에도 그렇게 적혀 있다.
    총매출·건수는 담당의 → 담당직원 → 시술별 순으로 있는 표에서 읽는다.
  - 사진 없이 직접 입력도 가능(접힌 편집표) · 기존 날짜 [✏️ 수정] 도 같은 화면
  - `📷 표를 하나씩 골라서 올리기` 는 한 장만 다시 찍을 때 쓰는 보조 수단(접힘)
- **월 뷰**: 월 이동 · 달력 히트맵(칸=일별 발생매출·건수) · 월 누계 카드
  (총매출·객단가/수납 합계/보험/비보험/과세 수납금액·부가세/입력한 날) ·
  시술 분류별·직원별·담당의별 월 누계 랭킹
- **일 뷰**: 날짜 ‹ › 이동 · 요약 카드 · 🩺 진료 실적(발생매출) 섹션 +
  🔧 시술 분류별 랭킹(건수·객단가·수납) + 보험유형별 환자 분포 막대 ·
  💳 수납(현금흐름) 섹션 + 수단별 비중 막대 · 원본 표 4종 접기 · 수정/삭제

**⚠️ 환자(명) ≠ 오더(건).** 객단가의 분모를 어느 쪽으로 잡느냐가 갈린다.
- **명** — ④ 보험유형별 환자 수. 그 날 내원한 사람 수.
- **건** — ②③⑤ 표의 `이름 (n)`. 발생한 오더 수.
한 환자가 오더를 여러 건 만들거나 담당이 지정되지 않은 진료가 있어 두 수는
원래 다르다. **서로 검산하지 않는다.** 화면에는 둘 다 적고 (`오더 47건 · 내원 56명`),
전체 객단가는 환자 기준을 크게, 오더 기준을 작게 병기한다.

**보험 / 비보험 분해는 ⑤ 시술별 표가 있으면 그걸 쓴다.**
⑤ 의 `보험진료 (17)` 행이 곧 보험진료 매출·건수라, 분자와 분모가 같은 표에서 나온다.
- 보험진료 = ⑤ `보험진료` 행 (`/보험\s*진료/` 로 찾음) → 매출·건수·객단가
- 비보험 진료 = ⑤ 합계 − 보험진료 행
- ⑤ 가 없으면 급여 **금액** 기준으로 떨어뜨린다:
  보험(급여) = 급여본부금+급여청구액, 비보험(비급여) = 비과세비급여+과세비급여 총금액.
  이때 객단가 분모는 ④ 의 환자 수를 쓴다 (보험 환자 = `/일반|비급여|비보험/` 이
  아닌 모든 유형, 비보험 환자 = 일반보험 등). 화면에도 "⑤ 를 올리면 정확해진다"고 안내.
- 객단가 분모 표기는 `건`(⑤) > `명`(④) > `—` 순

**⚠️ 발생매출 ≠ 수납액.** 화면과 스키마 모두 두 축을 분리해서 다룬다.
- 발생매출(진료실적) = 담당직원별·담당의별·시술별 집계 (표 머리글: "수납한 금액 기준이 아님")
  · 시술별 표에는 분류마다 `수납` 열이 있어 그 분류에서 실제로 걷힌 돈도 같이 보인다
- 수납(현금흐름) = 수납 구분표
선수납·미수·환불 때문에 원래 다른 값이라 절대 합치거나 대조하지 않는다.

**데이터**: `dailySales/{YYYY-MM-DD}`
```
{ date, ym,
  payment: { rows: {cash|cashReceipt|bank|bankReceipt|cashSum|etc|card|
                    easy|easyReceipt|easySum|unclassified|total:
                      {copay,prepaidTax,prepaidFree,nonTaxAmt,taxGross,taxAmt,vat,sum}},
             notes: {noteTaxPlusNonTax,notePrepaidUsed,notePointUsed,
                     noteRefund,noteUnpaid,noteHealthFee} },
  staff:  {이름: {count,nonTaxFree,taxFreeGross,taxFree,vat,copay,claim,
                  copaySum,support,discount,totalSales,refundOrder}},
  staffTotal, doctor, doctorTotal,      // 합계 행은 표에 찍힌 값 그대로
  // 시술별은 열 구성이 다르다 — discount 없음, received(수납) 있음
  procedure: {분류: {count,nonTaxFree,taxFreeGross,taxFree,vat,copay,claim,
                     copaySum,support,totalSales,refundOrder,received}},
  procedureTotal,
  patients: { types: {건강보험:10, 의료급여:1, 자동차보험:0, 일반보험:45}, total: 56 },
  warnings: [...],                       // 저장 시점에 남아 있던 검산 경고
  meta: {by,byName,source:'ocr'|'manual',savedAt,updatedAt} }
```
Firestore 규칙은 **관리자 전용**(`isAdmin() || isAdminHigh()`). 병원 전체 매출이
보이는 문서라 공용 staff 계정(`signedIn()`)에는 열지 않는다.

**검산 산식** (Cloud Function·클라이언트 양쪽 동일)
- 수납: 합계 = 보험본인부담금+선수납(과세)+선수납(비과세)+비과세+과세 총수납금액 /
  과세 총수납금액 = 과세 수납금액+부가세 /
  현금 합계·간편결제 합계·수납금액 합계 = 각 구성 줄의 열별 합
- 매출집계(②③): 과세비급여 총금액 = 과세비급여+부가세 /
  본부금합 = 비과세비급여+과세비급여 총금액+급여본부금 /
  총매출액 = 본부금합+급여청구액−지원금−할인금액 / 합계 행 = 각 행의 합
- 시술별(⑤): 위와 같되 총매출액 = 본부금합+급여청구액−지원금 (**할인금액 없음**)
- 표끼리: 담당직원 합계 == 담당의 합계 == 시술별 합계 (총매출액·건수 둘 다).
  환자 수(명)는 단위가 달라 여기에 끼우지 않는다.

**Cloud Function**: `ocrDailySales` (Vision `DOCUMENT_TEXT_DETECTION`)
`kind` = `payment` | `staff` | `doctor` | `procedure` | `patients`.
**미지정이면 `dsExtractAll` 이 한 장에서 읽히는 표를 전부** `blocks[]` 로 돌려준다.
각 파서는 자기 표의 행만 골라내므로 같은 wordRows 위에 다 돌려도 섞이지 않는다.
안전장치 둘: 매출집계는 `○○별 매출집계` 제목이 **정확히 하나**일 때만 읽고(두 표가
한 화면이면 행이 섞이므로 건드리지 않는다), 환자 수 그래프는 보험유형 이름이 둘
이상일 때만 읽는다(담당의별 교차표의 `15건/15명` 에 오작동하지 않게).
- `layoutWordRows()` 로 글자 좌표에서 줄 복원 → 금액 토큰의 x좌표를 열 기준선에
  DP 로 맞춤. **OCR 이 `0` 한 칸을 놓쳐도 뒤 숫자가 밀리지 않는다.**
- 행 라벨은 정규화 + 편집거리 매칭 (`간편결제`→`간편결재` 정도는 잡음)
- **화면 전체를 찍으면** 위 탭(일일결산·환자별·시술별·담당의별·담당직원별)과
  라디오(성별·진료구분별·담당의별…)에 온갖 이름이 다 들어온다. 그래서 종류 판별은
  키워드가 아니라 **표 제목 `○○별 매출집계`** 한 줄만 본다. 제목을 못 찾으면 null 을
  돌려 경고를 띄우지 않는다 (슬롯은 어차피 사용자가 고른다).
- 행 라벨에 괄호가 들어가는 경우가 있다 — `단순(10분미만) (0)`, `위너,포다이스 (2)`.
  첫 괄호가 아니라 **뒤에 한글이 더 없는 마지막 `(숫자)`** 를 건수로 잡는다(`dsRowLabel`).
- `patients` 는 표가 아니라 막대그래프라 다르게 읽는다: 값은 `"45명"` 처럼
  **명이 붙은 숫자만** (y축 눈금 0·20·40·60 과 이걸로 갈린다). 라벨 줄을 "한글이
  둘 이상인 가장 아래 줄" 로 잡으면 전체 화면 캡처에서 표 머리글·메뉴를 물어오므로,
  **아는 보험유형 이름 개수 + 위쪽 `N명` 값과 x 가 맞는 개수**로 점수를 매겨 고른다.
  명이 없으면 라벨 줄 위·y축 오른쪽 숫자로 폴백.
- 원본 사진은 저장하지 않는다 — Storage 는 `allow read: if true` 라 매출
  스크린샷을 올리면 URL 만 알면 누구나 본다. 대신 인식된 텍스트를 화면에서 확인.

**배포**: `functions/**` 가 main 에 푸시되면 `deploy-functions.yml` 이 자동 배포한다.
Cloud Vision API 가 GCP 콘솔에서 켜져 있어야 한다(`ocrReceipt` 와 같은 API).

### 홈 카드 라우팅
개인계정만 노출:
- 📋 상담 차팅
- 💬 고객채팅 (Phase 1+2 완성, 실 연동 대기 — 상담챗 세션 담당)
- 👥 STAFF (adminHigh만)

- 💵 매출 결산 (bizAdmin 또는 adminHigh)

공용·개인 모두 노출:
- 홈페이지 · 재고 · 수가표 · 상담 · 직원 교육·인계 · 공지

---

## 진행 중 / 계획 중

### 재고 개선
- [ ] 시술 → 소비량 자동 매핑 (예: 흑자리팟 1건 = 리도카인 크림 1개)
- [ ] 발주 자동 생성 (안전재고·리드타임 기반)
- [ ] Excel 일괄 편집 지원

### 상담 차팅 확장
- [ ] 수가표 자동 매칭 (오더 입력 시 가격 자동채움)
- [ ] 태그 정리 화면 (관리자용, 잘못 만든 태그 통합)
- [ ] 환자별 만족도 요약 (시술별 평균 별점)
- [ ] 통계 (재방문율 by 시술)

### 인프라·품질
- [ ] Multi-tenant 리팩토링 — 첫 외부 병원 계약 확정 시
- [ ] Firestore 백업 자동화
- [ ] 대시보드 (일일 요약)

---

## 파일 소유권 (세션 간 충돌 방지)

이 세션(통합앱 개발)이 만지는 파일:
- `staff.html` — 채팅 관련(💬 chat*, _chat*) 함수는 **손대지 말 것**
- `firebase-config.js` (경영관리 admin 앱)
- `index.html`
- `inventory.js`, `hr-attendance.js`, `revenue.js`, `expense.js`
- `supplies-catalog.js`

이 세션이 **손대지 말아야** 하는 파일:
- `functions/index.js`의 `webhookKakao`·`webhookNaver`·`sendChatReply`
  → 상담챗 세션 담당
- `staff.html`의 `_initChatRealtime`·`renderChatList`·`openChatThread` 등
  chat*, _chat* 관련 함수 → 상담챗 세션 담당

---

## 개발 관례

### 데이터 저장
- 공용 데이터: Firestore + 실시간 스냅샷 (기기 간 동기화)
- 개인화·세션 UI 상태: localStorage
- 로컬 → Firestore 이관 시 `xxx_migrated_v1` 플래그로 중복 방지

### 편집 UX
- 인라인 편집은 **더블탭·더블클릭** (조작 오류 방지)
- 편집 모드 열리면 배경 노란색(`#fef3c7`)
- 한 번에 한 행만 편집 가능

### 배포
- `staff.html`·`index.html`: main 푸시 → Vercel 자동 배포
- Cloud Functions: `functions/**` main 푸시 → `deploy-functions.yml` 자동 배포
  (수동: `cd functions && firebase deploy --only functions`)

### 커밋 메시지 규칙
- `feat(staff|admin|functions): ...` — 신규 기능
- `refactor(staff|...): ...` — 리팩토링
- `fix(...): ...` — 버그 수정
- `chore(...): ...` — 정리·문서

### 브랜치
- 개발: `claude/create-quote-document-AcRVl` (현재 사용 중)
- 완료 후 main으로 ff 머지 → 푸시 → Vercel 배포

---

## 자주 하는 작업 패턴 (참고)

### 새 필드 추가 (Firestore 컬렉션)
1. 스키마 확장 (기존 데이터는 optional)
2. 쓰기 로직 갱신
3. 읽기·렌더링 갱신
4. Firestore 규칙 확인 (컬렉션 접근 허용 여부)

### 새 관리자 설정 항목 추가
1. `settings/xxx` 문서 정의
2. `⚙ 관리자 설정 모달`에 UI 추가
3. `isBizAdmin` 체크 후 저장·로드

### 새 홈 카드 추가
1. `staff.html` 홈 영역에 `<button onclick="showTop('newview')">` 추가
2. `<div class="tab-content" id="tab-newview">` 추가
3. `showTop` 함수에 케이스 추가
4. 개인·공용계정 노출 여부 결정 (`role==='shared'`)

---

## 진행 상황 갱신 규칙

이 문서는 자주 바뀜. 세션 종료 시 다음 항목 갱신:
- 완성 기능 → 상단으로 이동
- 새 계획 → "진행 중 / 계획 중"에 추가
- 파일 소유권 변경 시 즉시 반영
