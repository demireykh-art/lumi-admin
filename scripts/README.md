# 수가표2 초기 import (1회용)

xlsx 마스터를 읽어 Firestore의 `fee_items` / `fee_categories` / `fee_settings/main` / `fee_access/main`에 시드합니다.

## 준비물

1. **서비스 계정 키** (`lumiclinic-c1a95` 프로젝트)
   - Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
   - JSON 파일로 다운로드 (예: `~/lumi-svc.json`)
2. **xlsx 마스터** — 이 저장소엔 커밋하지 않음. 로컬에서 열어서 최신본을 사용.
3. **부트스트랩 이메일** — 최초 편집·게시 권한을 받을 계정 (예: `clinic.lumi@gmail.com`).

## 실행 순서

```bash
# 1. 의존성 설치
cd fee-schedule/import
npm install

# 2. Dry-run — 아무것도 쓰지 않고 매핑 결과·집계만 출력
node import-fees.mjs --xlsx=/path/to/master.xlsx --dry-run

# 3. 실제 import (덮어쓰지 않음 · 기존 문서 있으면 스킵)
node import-fees.mjs \
    --xlsx=/path/to/master.xlsx \
    --service-account=/path/to/lumi-svc.json \
    --bootstrap-email=clinic.lumi@gmail.com

# 4. 이미 있는 문서를 강제로 덮어쓰려면
node import-fees.mjs --xlsx=... --service-account=... --force
```

## 예상 출력

```
📂 Reading /path/to/master.xlsx
  · 수가표 rows: 210

📊 카테고리별 집계:
  · 보톡스        (botox         ) :  21 행
  · 필러          (filler        ) :   3 행
  · 리프팅·탄력   (lifting       ) :  26 행
  ...
  · 수액          (iv            ) :   6 행

  총 210개 항목 · 확인 필요: 63건

🚀 Firebase project: lumiclinic-c1a95

📁 fee_categories 15개 쓰는 중...
  ✓ 15개 카테고리 저장

⚙️  fee_settings/main 기본값 시드 중...
  ✓ 저장

🔐 fee_access/main 부트스트랩 — editor+publisher: clinic.lumi@gmail.com
  ✓ editors=1명, publishers=1명

💰 fee_items 210개 쓰는 중...
  ✓ batch 1 committed (210 rows)

✅ 완료
   created: 210  updated: 0  skipped(existing): 0
   확인 필요 63건 남아 있으므로 원장 정리 전까진 게시 차단 로직이 배포를 막습니다.
```

## 확인 필요 63건 안내

`needsReview` 필드에 문구가 남아 있는 항목이 63개입니다. 지시서 3장 게시 차단 로직이 이걸 잡아냅니다 — **원장이 관리자 화면에서 하나씩 검토·비우기 전까지 `price.html`·`event.html`은 배포되지 않습니다.**

xlsx의 `확인필요` 시트에 전체 목록이 있습니다.

## 안전장치

- **idempotent**: 재실행해도 이미 있는 문서는 그대로 두고 스킵 (`skipped(existing)` 카운트)
- **--dry-run**: 실제 쓰기 없이 매핑만 확인. 처음엔 항상 dry-run 먼저 돌려서 카테고리 집계·확인 필요 개수가 xlsx `분류대조`와 일치하는지 확인
- **--force**: 명시적으로 덮어쓰기. 실수로 원장 수정본을 날리는 걸 방지
- 서비스 계정 키는 절대 저장소에 커밋하지 마세요. `.gitignore`에 `**/lumi-svc*.json` 추가돼 있음
