# 수가표2 · 데이터 모델

> 대상 Firestore 프로젝트: **`lumiclinic-c1a95`**
> 접근 화면: `admin.html`의 **수가표2** 탭 (신설 예정)
> 공개 소비 페이지: `price.html`, `event.html` (Cloud Function이 게시 시 정적 HTML로 생성)

## 컬렉션 개요

| 컬렉션 | 문서 수 | 목적 | 공개 read | 편집자 write | 게시자 write | Cloud Function 전용 |
|---|---|---|:-:|:-:|:-:|:-:|
| `fee_items` | 210+ | 수가 한 줄 = 판매 단위 1개 | ✗ | ✓ | ✓ | |
| `fee_categories` | 15 | 홈페이지 분류 정의 | ✗ | ✓ | ✓ | |
| `fee_settings` | 1 (`main`) | VAT 문구·이벤트 표시 방식 등 | ✗ | ✗ | ✓ | |
| `fee_audit` | 로그(누적) | 모든 변경 이력 | ✗ | create만 | create만 | |
| `fee_public` | 1 (`current`) | 게시된 공개 스냅샷 | ✓ | ✗ | ✗ | ✓ |
| `fee_access` | 1 (`main`) | 편집자·게시자 화이트리스트 | signedIn | ✗ | ✗ | `isAdmin`(bizAdmins) |

### 왜 `fee_public`을 따로 두는가
Firestore 보안 규칙은 **문서 단위**로만 read를 통제한다. `fee_items`에 `internalMemo`(경쟁사 가격 등 비공개 내용)가 필드로 들어 있으므로 이 문서를 공개 read로 열면 필드까지 통째로 노출된다. 그래서 **공개용 문서(`fee_public/current`)를 별도로 만들고 공개 필드만 복사**한다. 홈페이지·`price.html`·`event.html`은 `fee_public/current`만 읽는다.

---

## `fee_items/{id}` — 수가 한 줄 = 판매 단위 1개

문서 ID는 xlsx의 `ID` 열과 동일하게 `P001`, `P002`, ... 형식(불변). 향후 CRM 예약 슬롯과 공유할 키.

| 필드 | 타입 | 필수 | 기본 | 설명 |
|---|---|:-:|---|---|
| `id` | string | ✓ | — | 문서 ID와 동일. 조회·중복확인용 (`P001`) |
| `homeCategory` | string | ✓ | — | `fee_categories/{id}` 참조 (예: `botox`, `lifting`) |
| `internalCategory` | string | ✓ | — | 원내 분류 원본 (예: `보톡스`). **비공개** — 관리자 화면 전용 |
| `name` | string | ✓ | — | 시술명. 같은 `homeCategory` + `name`이면 한 그룹으로 묶어 렌더 |
| `option` | string | | `''` | 옵션 (`1회`, `3회`, `국산(리즈톡스)`, `~5mm` 등) |
| `priceRegular` | number \| null | | `null` | 정가, **원 단위 정수**, VAT 별도 |
| `priceEvent` | number \| null | | `null` | 이벤트가, 원 단위 정수 |
| `eventCondition` | string | | `''` | 텍스트 조건 (예: `10+1`, `첫 방문만`). 이벤트가 없이 조건만 있을 수도 있음 |
| `eventStart` | timestamp \| null | | `null` | 이벤트 시작일 |
| `eventEnd` | timestamp \| null | | `null` | 이벤트 종료일 — 지나면 `event.html`에서 자동 비노출 |
| `showOnPrice` | bool | ✓ | `false` | `price.html` 노출 여부 |
| `showOnEvent` | bool | ✓ | `false` | `event.html` 노출 여부 |
| `duration` | string | | `''` | 시술시간 (`10분 미만` 등). **비공개** — 관리자 화면 전용, 추후 CRM 연동 |
| `publicDescription` | string | | `''` | 공개 설명 (시술명 아래 회색 글씨) |
| `internalMemo` | string | | `''` | **비공개 내부 메모** — 경쟁사 가격 등. 공개 페이지·인쇄물·JSON-LD·스냅샷 어디에도 나가면 안 됨 |
| `needsReview` | string | | `''` | 확인 필요 내용. 비어 있으면 확인 완료. **비어 있지 않은 채 게시 시도하면 차단** |
| `sortOrder` | number | ✓ | 0 | 분류 내 정렬 (import 시 xlsx 행 순서) |
| `archived` | bool | | `false` | 삭제 대체 — `showOnPrice=false, showOnEvent=false, archived=true` |
| `updatedAt` | timestamp | ✓ | serverTs | 마지막 수정 시각 |
| `updatedBy` | string (uid) | ✓ | — | 마지막 수정자 Firebase Auth uid |

**샘플 문서 (P001)**:
```json
{
  "id": "P001",
  "homeCategory": "botox",
  "internalCategory": "보톡스",
  "name": "주름 보톡스 (이마·미간·눈가·눈밑·자갈턱·콧등·입꼬리)",
  "option": "국산(리즈톡스)",
  "priceRegular": 40000,
  "priceEvent": null,
  "eventCondition": "",
  "eventStart": null,
  "eventEnd": null,
  "showOnPrice": true,
  "showOnEvent": false,
  "duration": "10분 미만",
  "publicDescription": "",
  "internalMemo": "",
  "needsReview": "제품명(전문의약품) 공개 표기 검토",
  "sortOrder": 1,
  "archived": false,
  "updatedAt": <serverTs>,
  "updatedBy": "<uid>"
}
```

---

## `fee_categories/{id}` — 홈페이지 분류

문서 ID는 **영문 slug**(URL·앵커·CSS 클래스에 그대로 씀).

| 필드 | 타입 | 필수 | 설명 |
|---|---|:-:|---|
| `label` | string | ✓ | 한글 라벨 (`보톡스`, `리프팅·탄력`) |
| `labelEn` | string | | 영문 라벨 (`Botox`, `Lifting`) — 분류 제목 병기용 |
| `order` | number | ✓ | 표시 순서 |
| `pageLink` | string | | 홈페이지 서브페이지 경로 (`lifting.html`). 빈 문자열 가능 |
| `note` | string | | 분류 상단 설명 문구 |

### 초기 15개 분류 (xlsx `분류대조` 시트 기반)

| id | label | pageLink | order |
|---|---|---|---|
| `botox` | 보톡스 | | 1 |
| `filler` | 필러 | | 2 |
| `lifting` | 리프팅·탄력 | `lifting.html` | 3 |
| `fineshot` | 파인샷 | (`fineshot.html` — **미개발**) | 4 |
| `pigment` | 색소·토닝 | `pigment.html` | 5 |
| `booster` | 스킨부스터 | `skinbooster.html` | 6 |
| `acne` | 모공·여드름 | `acne.html` | 7 |
| `scar` | 흉터 | `scar.html` | 8 |
| `bumps` | 점·돌출병변 | `bumps.html` | 9 |
| `fordyce` | 포다이스반 | `fordyce.html` | 10 |
| `tattoo` | 문신제거 | `tattoo-removal.html` | 11 |
| `hair-removal` | 제모 | `hr.html` | 12 |
| `hair-loss` | 탈모 | `hair.html` | 13 |
| `regen` | 재생·관리 | `skinregen.html` | 14 |
| `iv` | 수액 | `iv-therapy.html` | 15 |

---

## `fee_settings/main` — 전역 설정

| 필드 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `eventPriceDisplay` | `"event_only"` \| `"strike_regular"` | `"event_only"` | 이벤트가 표시 방식. 코드는 두 방식 모두 구현 |
| `vatNotice` | string | `"모든 가격은 부가세 10% 별도입니다."` | 상단 고지 |
| `footerNotice` | string | `"실제 비용은 진료 후 결정됩니다."` | 하단 고지 |
| `updatedAt` | timestamp | serverTs | |

**정가 취소선 표시(`strike_regular`) vs 이벤트가만(`event_only`)** — 원장 결정. 기본값은 `event_only`이며 스위치로 전환 가능.

---

## `fee_audit/{autoId}` — 변경 이력 (append-only)

| 필드 | 타입 | 설명 |
|---|---|---|
| `itemId` | string | 변경된 `fee_items` 문서 ID (예: `P001`). 카테고리·설정 변경 시엔 `category:botox`, `settings:main` |
| `field` | string | 변경된 필드명 (`priceRegular`, `showOnEvent` 등). 다중 필드 변경은 배치별로 여러 문서 생성 |
| `before` | any | 이전 값 |
| `after` | any | 새 값 |
| `uid` | string | 수정자 uid |
| `email` | string | 수정자 로그인 이메일 |
| `at` | timestamp | serverTs |
| `action` | `"update"` \| `"create"` \| `"archive"` \| `"publish"` | |

**규칙: `create`만 허용, `update`/`delete` 절대 불가.** 감사 로그의 무결성을 보안 규칙으로 강제.

---

## `fee_public/current` — 공개 스냅샷

**Cloud Function**만 쓸 수 있음. `fee_items` 전체에서 **공개 필드만 골라 복사**한 문서.

포함되는 데이터:
```json
{
  "publishedAt": <serverTs>,
  "publishedBy": "<uid>",
  "publisherEmail": "<email>",
  "settings": {
    "eventPriceDisplay": "event_only",
    "vatNotice": "...",
    "footerNotice": "..."
  },
  "categories": [
    { "id": "botox", "label": "보톡스", "labelEn": "Botox", "order": 1, "pageLink": "", "note": "" },
    ...
  ],
  "items": [
    {
      "id": "P001",
      "homeCategory": "botox",
      "name": "주름 보톡스 ...",
      "option": "국산(리즈톡스)",
      "priceRegular": 40000,
      "priceEvent": null,
      "eventCondition": "",
      "eventStart": null,
      "eventEnd": null,
      "showOnPrice": true,
      "showOnEvent": false,
      "publicDescription": "",
      "sortOrder": 1
    },
    ...
  ]
}
```

**필드 화이트리스트 (Cloud Function에서 이 목록으로 필터링)**:
```
id, homeCategory, name, option, priceRegular, priceEvent,
eventCondition, eventStart, eventEnd, showOnPrice, showOnEvent,
publicDescription, sortOrder
```

**의도적으로 제외**:
```
internalCategory  ← 비공개 원본 분류
internalMemo      ← 비공개 메모 (경쟁사 가격 등)
needsReview       ← 확인 필요 (내부 용도)
duration          ← 시술시간 (CRM용)
archived          ← 목록에서 제외해서 복사
updatedBy, updatedAt ← 수정 흔적
```

---

## `fee_access/main` — 편집자·게시자 화이트리스트

`admin.html`의 `settings/admins.emails` 관리자 전체를 그대로 편집자로 쓰지 않고, **명시적으로 부여받은 계정만** 수가표에 접근하도록 별도 문서로 관리.

| 필드 | 타입 | 설명 |
|---|---|---|
| `editors` | array<string> | 편집 권한 이메일 목록 (소문자, 로그인 토큰과 일치) |
| `publishers` | array<string> | 게시 권한 이메일 목록 (소문자). **`editors`에 자동 포함 아님** — publisher만 있어도 편집·게시 모두 가능하도록 규칙에서 처리 |
| `updatedAt` | timestamp | |
| `updatedBy` | string (uid) | |

**부트스트랩**:
- 최초 생성은 **Firebase Console** 또는 **`isAdmin()` = `settings/bizAdmins.emails`에 등록된 계정**만 가능
- 이후에도 `fee_access` write는 `isAdmin()`만
- 즉 편집·게시 권한 부여는 원내 최고 권한자만 할 수 있게 별도 방어선

**규칙 (요약)**:
- `feeEditor()` = signedIn ∧ 이메일이 `editors` 또는 `publishers`에 포함
- `feePublisher()` = signedIn ∧ 이메일이 `publishers`에 포함

---

## 게시(Publish) 흐름 요약

1. 편집자가 `admin.html` 수가표2 탭에서 셀 수정 → `fee_items` write
2. 매 필드 변경마다 `fee_audit` create (`action: "update"`)
3. 게시자가 "게시" 버튼 클릭
4. 클라이언트는 `fee_items`·`fee_categories`·`fee_settings` 최신본을 Cloud Function `publishFees()`에 전달할 필요 없이, **Cloud Function이 서버에서 직접 조회**
5. Cloud Function 검증:
   - 호출자 이메일이 `fee_access.publishers`에 있는가
   - `showOnPrice` 또는 `showOnEvent` 켜진 항목 중 `needsReview`가 비어있지 않은 항목이 있으면 → 차단 + 목록 반환
6. 통과 시 `fee_public/current` 갱신 (공개 필드만) + `fee_audit` create (`action: "publish"`)
7. Cloud Function이 이어서 `price.html`·`event.html`을 생성해 Firebase Hosting에 배포

---

## 이벤트 만료 처리

- 매일 **00:10 KST**에 Cloud Scheduler → `regenerateFeePages()` Cloud Function 호출
- 함수는 `fee_public/current`를 다시 읽어 `eventEnd`가 지나지 않은 항목만 렌더 → HTML 재생성 → 배포
- 보조 안전망: HTML 안의 각 이벤트 카드에 `data-end="YYYY-MM-DD"` 심고, 페이지 로드 시 5줄짜리 클라이언트 JS가 `today > data-end`인 카드를 즉시 숨김 (스케줄러 지연 대비)

---

## `event.html#P196` 딥링크

- `event.html`은 `fee_public/current` 스냅샷에서 `showOnEvent && eventEnd > today`인 항목만 카드로 렌더
- 각 카드에 `id="P196"` 심음
- 프래그먼트가 있으면 클라이언트에서 나머지 숨기고 해당 카드만 노출
- 유효하지 않은 ID 또는 종료된 이벤트는 "종료된 이벤트입니다" 안내 + 전체 목록 링크
- `og:title`은 정적 생성 시 프래그먼트별 별도 파일이 없는 한 단일값. **팀에 제안**: 각 이벤트마다 정적 stub HTML(`e/P196.html`)을 함께 생성해 `og:title`을 항목명으로 설정 → 카톡·인스타 미리보기에서 이벤트명이 뜸

---

## 원장 승인 대기 항목

1. `fee_access.editors`·`publishers` 최초 이메일 목록 (기본은 `clinic.lumi@gmail.com`)
2. `fee_settings.eventPriceDisplay` 초기값 (지시서 기본 `event_only`) — 그대로 진행 여부
3. `settings/bizAdmins.emails` 목록 확인 (Cloud Function 검증 및 fee_access write 권한 부여에 필요)
