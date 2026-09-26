# CLAUDE.md

이 저장소(`lumi-admin`)에서 작업할 때 참고할 프로젝트 메모입니다.

## 앱 이름 규칙 (중요)

이 저장소는 하나의 코드베이스로 두 개의 앱을 배포합니다. 대화에서 아래 이름으로 부릅니다.

| 이름 | URL | 진입 파일 |
| --- | --- | --- |
| **통합앱** | https://staff.lumiclinic.co.kr/staff.html | `staff.html` |
| **관리자앱** | https://lumi-staff.vercel.app/ | `index.html` |

- "통합앱"이라고 하면 `staff.html`(직원·공용계정용 통합 앱)을 의미합니다.
- "관리자앱"이라고 하면 `index.html`(관리자 웹)을 의미합니다.

## 배포 모델

- **호스팅**: Vercel(프로젝트 `lumi-staff`). `main` 브랜치에 push/merge되면 자동 재배포됩니다.
  PR을 열면 브랜치별 **프리뷰 배포**가 생성되므로, 병합 전에 프리뷰 URL로 확인할 수 있습니다.
- **Firestore 규칙**: `firestore.rules`. `main`에 push되면 GitHub Actions
  워크플로우(`.github/workflows/deploy-firestore-rules.yml`)가 자동 배포합니다.
- 따라서 새 기능은 **`main`에 병합·재배포되기 전까지 통합앱/관리자앱에 나타나지 않습니다.**

## 데이터

- Firebase 프로젝트: `lumiclinic-c1a95` (Firestore + Functions). 로그인한 직원만 접근하도록
  `firestore.rules`에서 컬렉션별 화이트리스트로 제어합니다. 새 컬렉션을 쓰면 규칙에 추가해야 합니다.
- 통합앱(`staff.html`)은 큰 단일 HTML 파일이며, 대부분의 로직이 인라인 `<script>`에 들어 있습니다
  (일부만 `supplies-catalog.js` 등 외부 파일). 탭 추가 등은 이 인라인 스크립트에 함께 작성합니다.

## 📣 SNS 탭 (관리자 전용) — 촬영 슬레이트

- 위치: 통합앱 홈 → `관리` 섹션 → **SNS** (`tab-sns`, `showTop('sns')`).
  서브탭 3개 — 📅 일정(기본 진입) / 🎬 촬영 슬레이트 / 📋 영상 대장.
- 노출 조건은 `isSnsAdmin()` = `settings/bizAdmins` ∪ `settings/adminHigh` ∪ `settings/snsAccess`.
  `snsAccess` 는 ⚙ 관리자 설정 → **📣 SNS 탭 권한** 에서 계정별 스위치로 켜고 끈다
  (💵 매출 결산 권한과 같은 방식).
  통합앱은 정적 파일이라 화면 숨김만으로는 못 막는다. 실제 차단은
  `firestore.rules` 의 `snsSeries`·`snsSlateLog` 규칙(`isSnsAdmin()`)이 한다.
- 데이터
  - `snsSeries/{suffix}` — `{no, name, order, active}`. 문서ID가 **파일명 접미사**다.
    오프라인 대비로 `localStorage(lumi_sns_series_v1)` 에 캐시한다.
  - `snsSlateLog/{autoId}` — 영상 대장. `{ymd, createdAt, seriesSuffix, seriesNo, seriesName,
    content, uploadDate, status, filename, captions{caption,firstComment,dm}, byName}`. 슬레이트를 저장하면 `촬영` 으로 한 건 쌓이고
    (같은 시리즈·내용을 10분 안에 다시 저장하면 새 줄 대신 갱신), 편집완료·업로드완료·보류로
    상태를 올린다. "밀린 것" = 상태가 `촬영` 에서 멈춘 것.
- 📅 일정 달력은 **별도 컬렉션이 아니라** `snsSlateLog.uploadDate` 를 월별로 펼친 뷰다.
  일정용 컬렉션을 따로 두면 같은 영상이 두 곳에 생겨 반드시 어긋나므로 대장 하나만 쓴다.
  · 달력 칸은 공지 달력과 같은 `.nc-*` 클래스를 쓴다.
  · 칩 색: 업로드완료 = 초록·취소선 / 예정일이 지난 미완료 = 빨강(밀림) / 그 외 = 노랑.
  · 달력에서 바로 만든 행은 아직 촬영 전이라 상태가 `예정` 이다(상태는 예정·촬영·편집완료·
    업로드완료·보류 5단계). 📅 탭 배지 = 밀린 업로드 건수.
  · `+ 업로드 예정 추가` 는 인라인 폼(날짜·시리즈·내용)이다. **날짜를 폼에서 직접 고른다** —
    선택한 날짜로 고정하면 늘 오늘로만 들어간다.
- 📝 업로드 문구(`captions`): 올릴 때 실제로 쓰는 세 덩어리를 칸으로 나눠 둔다 —
  `caption`(게시물 본문) · `firstComment`(올린 직후 다는 댓글) · `dm`(문의 오면 보낼 정리 내용).
  칸마다 복사 버튼이 있어 폰에서 버튼만 누르면 된다. 입력은 blur(`change`) 때 저장한다
  (타이핑 중 실시간 구독이 끼어들면 커서가 튄다). 펼쳐 둔 행은 `_snsCapOpen` 으로 기억해
  저장해도 접히지 않는다.
  · 예전에 맥 문구를 통째로 넣던 `captionsRaw` 는 캡션 칸의 초기값으로만 살려 읽고,
    캡션을 따로 저장하는 순간 비운다.
- 업로드 예약·발행 자체는 앱이 하지 않는다(Meta Business Suite 등 외부 도구). 앱은
  "무엇을 찍었나 · 어디까지 갔나 · 언제 올릴 계획인가" 기록만 맡는다.
- 슬레이트 이미지(1200×1600 · JPEG 0.94 · 레이아웃)는 **맥 편집 파이프라인이 읽어 파싱**한다.
  규격을 바꾸면 자동화가 깨지므로 임의 변경 금지.
- ⚠️ 접미사 목록은 이 탭과 **맥의 `CLAUDE.md` 두 곳**에 존재한다. 시리즈를 추가하면
  맥 쪽 규칙 파일도 같이 갱신해야 한다.
