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

### 📋 상담 차팅 (Vegas Chart 보조)
- `visits` 컬렉션 (환자별 방문)
- 자유 태그 chip 입력 + 자동완성 (이전 태그 빈도순)
- 의사·상담 섹션 분리 (색상 구분)
- 오더(시술명·가격) + 메모
- 환자 타임라인 (방문 시간순 카드)
- 방문별 경과(별점 1-5 + 메모) 다건
- 📋 복사 (Vegas 붙여넣기용 포맷)

### 🌳 상담 트리 관리
- `settings/consultTree` (JSON 문자열) Firestore 동기화
- ⚙ 관리자 설정 → 트리 편집기 모달
- 텍스트 붙여넣기 대량 편집 (노션 스타일)
- 시각 편집 (탭·이름변경·이동·삭제)
- 백업/복원 (`consultTreeBackups` 최근 10개)

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
  - 💰 급여: 임시로 index.html 링크 (완전 이관은 후속)
- 데이터: `employees`, `leaveRequests`, `attendance`, `lunchOT` 조회
- 승인 시 `leaveRequests` 상태 업데이트 → 캘린더 즉시 갱신

### 홈 카드 라우팅
개인계정만 노출:
- 📋 상담 차팅
- 💬 고객채팅 (Phase 1+2 완성, 실 연동 대기 — 상담챗 세션 담당)
- 👥 STAFF (adminHigh만)

공용·개인 모두 노출:
- 홈페이지 · 재고 · 수가표 · 상담 · 공지

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
- Cloud Functions: `cd functions && firebase deploy --only functions`

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
