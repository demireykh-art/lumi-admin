# LUMI CRM — 작업 메모

## 응답 규칙 (중요)
- **모든 답변 끝에 아래 "접속 링크"를 항상 포함**한다. 사용자가 오랜만에 대화에 들어와도 바로 찾을 수 있도록.

## 접속 링크 (Vercel 미리보기 — 브랜치 claude/hospital-crm-requirements-srgj0r)
- 스탭 CRM(차팅·수가표): https://lumi-staff-git-claude-hospital-crm-44b8da-lumiclinics-projects.vercel.app/crm.html
- 관리자(분석): https://lumi-staff-git-claude-hospital-crm-44b8da-lumiclinics-projects.vercel.app/index.html
- PR: https://github.com/demireykh-art/lumi-admin/pull/33
- 운영(main): https://lumi-staff.vercel.app/

## 앱 구조
- `index.html` (admin/bizAdmins 전용) — 매출·지출·직원·재고/레시피·손익 분석
- `crm.html` (직원 로그인) — 환자/차팅/리콜·생일/시술 수가표. patients.js + fee-schedule.js
- 백엔드: Firebase(Auth + Firestore). 호스팅: Vercel.
- Firestore 규칙은 콘솔 관리. 새 컬렉션 추가 시 규칙 게시 필요(현재 `/{document=**}` 전체 허용 존재).

## 권한
- admin 앱 = bizAdmins 화이트리스트
- 수가표 편집 = bizAdmin 또는 실장(role=manager): `currentCrmCanEditFees`
