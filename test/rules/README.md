# Firestore 보안 규칙 에뮬레이터 테스트

지시서 Section 5 요구 4개 케이스 + 정상 경로 8개 확인.

## 준비

```bash
# Firebase CLI 전역 설치 (한 번만)
npm install -g firebase-tools

# 테스트 의존성 설치
cd fee-schedule/rules-test
npm install
```

## 실행

터미널 두 개 필요합니다.

**터미널 1 — 에뮬레이터 기동** (Java 필수: `apt-get install -y default-jre` 또는 로컬에 이미 설치)
```bash
cd fee-schedule/rules-test
npm run emulator
```
`Firestore emulator: http://127.0.0.1:8080` 문구 나올 때까지 대기.

**터미널 2 — 테스트 실행**
```bash
cd fee-schedule/rules-test
npm test
```

## 예상 출력

```
📜 Firestore Rules — 수가표2 에뮬레이터 테스트

[지시서 Section 5 요구 케이스]
  ✅ 1) 비로그인이 fee_items 읽기 → 거부
  ✅ 2) 편집·게시 권한 없는 로그인 계정(carol)이 fee_items 쓰기 → 거부
  ✅ 3) editor(alice)가 fee_public 쓰기 → 거부 (Cloud Function만 쓸 수 있음)
  ✅ 4a) 누구든 fee_audit update → 거부 (editor alice)
  ✅ 4b) 누구든 fee_audit delete → 거부 (editor alice)
  ✅ 4c) 관리자(owner)도 fee_audit update → 거부

[추가 검증 — 정상 경로가 열려 있는가]
  ✅ editor(alice)가 fee_items read → 허용
  ✅ editor(alice)가 fee_items update → 허용
  ✅ editor(alice)가 fee_audit create → 허용
  ✅ publisher(bob)가 fee_settings write → 허용
  ✅ editor(alice)가 fee_settings write → 거부 (publisher 전용)
  ✅ 비로그인이 fee_public/current read → 허용 (홈페이지 소비)
  ✅ editor(alice)가 fee_access write → 거부 (bizAdmins 전용)
  ✅ owner(bizAdmins)가 fee_access write → 허용

============================================================
총 14 · 통과 14 · 실패 0
✅ 모든 규칙 테스트 통과
```

## 시드 계정

테스트는 다음 4개 컨텍스트로 검증합니다:

| 컨텍스트 | 이메일 | fee_access | bizAdmins |
|---|---|---|---|
| `anon` | (비로그인) | | |
| `alice` | `alice@lumi.test` | editors ✓ | |
| `bob` | `bob@lumi.test` | publishers ✓ | |
| `carol` | `carol@lumi.test` | | |
| `owner` | `owner@lumi.test` | | ✓ |

각 계정별 예상 권한:
- **anon**: `fee_public/current` read만 가능
- **carol**: signedIn이지만 fee 관련 read/write 전부 거부
- **alice** (editor): fee_items·fee_categories·fee_audit(create) 가능. fee_settings write는 불가. fee_public write 불가. fee_access write 불가
- **bob** (publisher): editor 권한 전부 + fee_settings write 가능. fee_public write는 여전히 불가 (Cloud Function만). fee_access write 불가
- **owner** (bizAdmins): fee_access write 가능. fee_audit update/delete는 여전히 불가 (append-only)
