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
  노출 조건은 `isSnsAdmin()` = `settings/bizAdmins` 또는 `settings/adminHigh` 이메일.
  통합앱은 정적 파일이라 화면 숨김만으로는 못 막는다. 실제 차단은
  `firestore.rules` 의 `snsSeries` 규칙(`isSnsAdmin()`)이 한다.
- 데이터: `snsSeries/{suffix}` — `{no, name, order, active}`. 문서ID가 **파일명 접미사**다.
  오프라인 대비로 `localStorage(lumi_sns_series_v1)` 에 캐시한다.
- 슬레이트 이미지(1200×1600 · JPEG 0.94 · 레이아웃)는 **맥 편집 파이프라인이 읽어 파싱**한다.
  규격을 바꾸면 자동화가 깨지므로 임의 변경 금지.
- ⚠️ 접미사 목록은 이 탭과 **맥의 `CLAUDE.md` 두 곳**에 존재한다. 시리즈를 추가하면
  맥 쪽 규칙 파일도 같이 갱신해야 한다.
- 2차 예정: 영상 대장(`snsSlateLog`) — 저장 시 `촬영` 기록 → 편집완료/업로드완료 상태 갱신, 밀린 것 필터.
