# 데이터 모델

> P0 시점 스키마입니다. **P1 에서 `items` 가 확정**되고, P2(명세서 OCR)가
> `vendorCodes` · `movements.tax` 를 채웁니다. 근거는 `RESEARCH.md` §D.

## 최상위

```
users/{uid}                  본인 프로필. clinicId·role 은 Functions 만 씀
clinics/{clinicId}           병원
invites/{code}               초대. code 를 아는 것이 곧 권한
```

## `clinics/{clinicId}`

```js
{
  name: '루미클리닉',
  ownerUid: 'uid...',
  plan: 'pilot',            // pilot | basic | pro — 클라이언트가 못 고침
  planExpiresAt: null,
  timezone: 'Asia/Seoul',
  createdAt,
}
```

## `clinics/{clinicId}/items/{itemId}` ★ P1 의 주인공

```js
{
  name: '일회용 주사기 5ml',
  category: '주사소모품',
  parentName: '',              // 모품목 (묶어 보기)

  // ── 수량 체계 (RESEARCH §D-3) ──
  trackMode: 'bulk',           // bulk = 미개봉 박스만 셈 | unit = 낱개까지 셈
  packSize: 100,               // 1 박스 = 낱개 몇 개
  baseUnit: '개',
  sealedPacks: 3,              // trackMode==='bulk' 일 때 재고
  totalBase: 0,                // trackMode==='unit' 일 때 재고
  openedBase: 0,               // 개봉한 박스에서 남은 낱개 (P3)

  // ── 원가 (RESEARCH §A-7) ──
  avgCostBase: 202,            // 이동가중평균. 낱개당
  lastPriceBase: 202,          // 마지막 매입가. 발주할 때 보는 값
  lastReceivedAt,

  safetyStockBase: 500,
  volumeMl: null,              // 1개 용량 — 믹스 원가용 (v1.5). 필드만 미리
  discontinued: false,

  // ── 거래처 코드 (P2 명세서 OCR) ──
  vendorCodes: [
    {vendorId, code, vendorName, packSize, lastPrice, lastAt, confirmedBy},
  ],
  vendorCodeKeys: ['v_plandocs::1000017590'],   // array-contains 조회용

  clinicId, createdAt, updatedAt, createdBy,
}
```

> **`vendorCodeKeys` 를 따로 두는 이유**: Firestore 는 객체 배열의 부분일치를
> 질의하지 못합니다. 키 만드는 규칙은 `repo.js` 의 `vendorCodeKey()` 한 곳에만
> 둡니다 — 쓰는 쪽과 읽는 쪽이 어긋나면 조용히 안 찾아집니다.

## `clinics/{clinicId}/movements/{movementId}` — 원장

**만들기만 하고 고치지 않습니다.** 잘못 넣었으면 반대 전표를 넣습니다.

```js
{
  type: 'in',                  // in | out | adjust | return | dispose
  itemId,

  qtyPacks: 3,                 // 박스 수 — 명세서 「수량」 그대로
  qtyBase: 300,                // 낱개 환산
  packSize: 100,               // ★ 이 시점의 입수 (스냅샷)
  trackMode: 'bulk',           // ★ 스냅샷

  unitPricePack: 20216,        // 세포함, 안분 반영 후
  unitPriceBase: 202,
  amount: 60648,

  // 명세서에서 읽은 원본. 저장만 하고 화면에 안 띄움 (RESEARCH §D-2)
  tax: {source, supplyAmount, vatAmount, printedUnitPrice, vatIncluded},
  allocation: {discount, shipping, basis},

  purchaseDocId, vendorId, locationId, reason,
  clinicId, createdAt, createdBy, createdByName,
}
```

> **`packSize` 와 `trackMode` 가 스냅샷인 이유**: 거래처가 박스 입수를
> 100 → 50 으로 바꾸면, `items.packSize` 만 보는 구조에서는 **과거 movement 가
> 전부 다시 해석되어** 예전 입고 수량이 절반으로 바뀝니다.

## 나머지

```
locations/{id}      {name, sortKey, kind}
vendors/{id}        {name, bizNo, tel, memo, purchaseLink}
purchaseDocs/{id}   {vendorId, issuedAt, imagePath, ocrRaw, totals, status}   (P2)
counts/{id}         {startedAt, closedAt, lines[], status}                    (P4)
members/{uid}       {uid, role, joinedAt}    ← Functions 만 씀
settings/{docId}    병원별 설정
```

## 인덱스

`firestore.indexes.json` 에 셋 + 배열 하나. 새 질의를 만들면 여기에도
추가해야 합니다 — 안 그러면 프로덕션에서만 실패합니다(에뮬레이터는 그냥 돕니다).
