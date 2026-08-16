# CLAUDE.md

이 저장소(`lumi-admin`)에서 작업할 때 참고할 프로젝트 메모입니다.

## 앱 이름 규칙 (중요)

이 저장소는 하나의 코드베이스로 두 개의 앱을 배포합니다. 대화에서 아래 이름으로 부릅니다.

| 이름 | URL | 진입 파일 |
| --- | --- | --- |
| **통합앱** | https://staff.lumiclinic.co.kr/staff.html | `staff.html` |
| **관리자앱** | https://lumi-staff.vercel.app/ | `index.html` |
| **환자앱** | https://lumi-staff.vercel.app/m | `patient.html` |

- "통합앱"이라고 하면 `staff.html`(직원·공용계정용 통합 앱)을 의미합니다.
- "관리자앱"이라고 하면 `index.html`(관리자 웹)을 의미합니다.
- "환자앱"이라고 하면 `patient.html`(환자용 QR 메뉴 열람)을 의미합니다.
  **비로그인 공개 페이지**이므로 Firestore 에 직접 붙이지 않고 Cloud Function
  `getPatientMenu` 로만 읽습니다. 기획·설계는 `docs/patient-app-qr-order.md` 참고.

## 가격 정책 (중요)

시술 수가표(`settings/feeSchedule`)의 정가는 **부가세 10% 별도**입니다.
(`treatments-seed.json` `_meta.vat = "별도"` 기준, 2026-08 확정)
환자에게 금액을 보여주는 화면에서는 「시술가 · 부가세 · 합계」를 함께 표기합니다.

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
