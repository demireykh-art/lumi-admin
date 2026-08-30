/* ═══════════════════════════════════════════════════════════════════════════
 *  repo.js — 데이터 접근 계층
 *  ---------------------------------------------------------------------------
 *  ★ 앱 화면 코드는 Firestore 를 직접 부르지 않는다. 전부 이 파일을 통한다.
 *
 *  왜:
 *   1. **테넌시를 한 곳에서 강제한다.** 경로 앞에 clinics/{clinicId} 를 붙이는
 *      일을 화면마다 반복하면 언젠가 한 곳에서 빠진다. 그 한 곳이 사고다.
 *      여기서만 경로를 만들면 빠질 수가 없다.
 *   2. **락인을 줄인다.** 나중에 다른 백엔드로 옮길 때 고칠 파일이 이것 하나다.
 *      화면 코드는 listItems() 가 어디서 오는지 모른다.
 *   3. 서버 타임스탬프·감사 필드(createdBy 등)를 빠뜨릴 수 없게 한다.
 *
 *  규칙:
 *   · 이 파일 밖에서 db.collection(...) 을 쓰면 리뷰에서 되돌린다.
 *   · 이 파일은 화면을 모른다. DOM 을 만지지 않는다.
 *   · 업무 규칙(재고 음수 금지 등)은 여기 또는 그 위에 둔다. Rules 에 두지 않는다.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* global firebase */

const Repo = (() => {
  'use strict';

  let _db = null;
  let _clinicId = null;
  let _user = null;      // {uid, displayName}

  function init(db, clinicId, user) {
    if (!clinicId) throw new Error('clinicId 없이 Repo 를 쓸 수 없습니다.');
    _db = db;
    _clinicId = clinicId;
    _user = user || null;
  }

  function ready() {
    return !!(_db && _clinicId);
  }

  /** 병원 루트. 모든 경로가 여기서 출발한다 — 여기 말고는 경로를 만들지 않는다. */
  function root() {
    if (!ready()) throw new Error('Repo.init() 을 먼저 호출하세요.');
    return _db.collection('clinics').doc(_clinicId);
  }

  function col(name) {
    return root().collection(name);
  }

  const now = () => firebase.firestore.FieldValue.serverTimestamp();

  /** 만들 때 붙는 감사 필드. 빠뜨릴 수 없게 여기서만 만든다. */
  function stampCreate(data) {
    return Object.assign({}, data, {
      clinicId: _clinicId,                       // Rules 의 clinicIdMatches() 와 짝
      createdAt: now(),
      updatedAt: now(),
      createdBy: _user ? _user.uid : null,
      createdByName: _user ? (_user.displayName || '') : '',
    });
  }

  function stampUpdate(data) {
    return Object.assign({}, data, {
      updatedAt: now(),
      updatedBy: _user ? _user.uid : null,
    });
  }

  const withId = (snap) => Object.assign({id: snap.id}, snap.data());

  /* ── 품목 ──────────────────────────────────────────────────────────── */

  async function listItems() {
    const s = await col('items').orderBy('name').get();
    return s.docs.map(withId);
  }

  async function getItem(itemId) {
    const d = await col('items').doc(itemId).get();
    return d.exists ? withId(d) : null;
  }

  /** 실시간 구독. 해제 함수를 돌려준다 — 화면을 떠날 때 반드시 부른다. */
  function watchItems(onChange, onError) {
    return col('items').orderBy('name').onSnapshot(
      (s) => onChange(s.docs.map(withId)),
      onError || ((e) => console.warn('items 구독 실패:', e))
    );
  }

  async function createItem(data) {
    const ref = await col('items').add(stampCreate(data));
    return ref.id;
    }

  async function updateItem(itemId, patch) {
    await col('items').doc(itemId).update(stampUpdate(patch));
  }

  /**
   * 거래처 품목코드로 찾는다 (P2 명세서 OCR 이 쓴다).
   * vendorCodes 는 객체 배열이라 부분일치 질의가 안 된다. 그래서 평탄화한
   * vendorCodeKeys 를 array-contains 로 친다. 키를 만드는 규칙이 여기 있어야
   * 쓰는 쪽과 읽는 쪽이 어긋나지 않는다.
   */
  function vendorCodeKey(vendorId, code) {
    const c = String(code || '').replace(/[\[\]\s]/g, '').toUpperCase();
    return `${vendorId}::${c}`;
  }

  async function findItemByVendorCode(vendorId, code) {
    const s = await col('items')
      .where('vendorCodeKeys', 'array-contains', vendorCodeKey(vendorId, code))
      .limit(1).get();
    return s.empty ? null : withId(s.docs[0]);
  }

  /* ── 입출고 원장 ────────────────────────────────────────────────────── */

  /**
   * 입출고는 **원장 기록과 재고 갱신이 한 트랜잭션**이어야 한다.
   * 따로 쓰면 중간에 끊겼을 때 재고와 이력이 어긋나고, 그때부터 어느 쪽이
   * 맞는지 알 수 없게 된다. (루미가 currentStock 과 locations 로 겪은 일이다)
   *
   * ⚠️ movement 는 만들기만 하고 고치지 않는다 (Rules 가 update 를 막는다).
   *    잘못 넣었으면 반대 전표를 넣는다.
   */
  async function postMovement(mv) {
    if (!mv || !mv.itemId) throw new Error('itemId 가 필요합니다.');
    const qtyBase = Number(mv.qtyBase) || 0;
    if (!qtyBase) throw new Error('qtyBase 가 0 입니다.');

    const itemRef = col('items').doc(mv.itemId);
    const mvRef = col('movements').doc();

    await _db.runTransaction(async (tx) => {
      const snap = await tx.get(itemRef);
      if (!snap.exists) throw new Error('품목을 찾을 수 없습니다.');
      const item = snap.data();

      const sign = mv.type === 'in' ? 1 : -1;
      const patch = {updatedAt: now()};

      if (item.trackMode === 'bulk') {
        // 미개봉 박스 단위로 센다. 낱개는 movements 에만 남는다 (RESEARCH §D-3)
        const packs = Number(mv.qtyPacks) || 0;
        if (!packs) throw new Error('bulk 품목은 qtyPacks 가 필요합니다.');
        const next = (Number(item.sealedPacks) || 0) + sign * packs;
        if (next < 0) throw new Error('재고보다 많이 뺄 수 없습니다.');
        patch.sealedPacks = next;
      } else {
        const next = (Number(item.totalBase) || 0) + sign * qtyBase;
        if (next < 0) throw new Error('재고보다 많이 뺄 수 없습니다.');
        patch.totalBase = next;
      }

      // 이동가중평균 (RESEARCH §A-7). 입고일 때만 갱신한다.
      if (mv.type === 'in' && Number(mv.unitPriceBase) > 0) {
        const prevQty = Number(item.totalBase) || (Number(item.sealedPacks) || 0) * (Number(item.packSize) || 1);
        const prevAvg = Number(item.avgCostBase) || 0;
        const inQty = qtyBase;
        const inPrice = Number(mv.unitPriceBase);
        patch.avgCostBase = prevQty + inQty > 0
          ? Math.round((prevQty * prevAvg + inQty * inPrice) / (prevQty + inQty))
          : inPrice;
        patch.lastPriceBase = inPrice;             // 발주할 때 보는 건 평균이 아니라 마지막 가격
        patch.lastReceivedAt = now();
      }

      tx.set(mvRef, stampCreate(mv));
      tx.update(itemRef, patch);
    });

    return mvRef.id;
  }

  async function listMovements(itemId, limit) {
    let q = col('movements');
    if (itemId) q = q.where('itemId', '==', itemId);
    const s = await q.orderBy('createdAt', 'desc').limit(limit || 50).get();
    return s.docs.map(withId);
  }

  /* ── 거래처 · 보관장소 ──────────────────────────────────────────────── */

  async function listVendors() {
    const s = await col('vendors').orderBy('name').get();
    return s.docs.map(withId);
  }

  async function createVendor(data) {
    const ref = await col('vendors').add(stampCreate(data));
    return ref.id;
  }

  async function listLocations() {
    const s = await col('locations').orderBy('sortKey').get();
    return s.docs.map(withId);
  }

  /* ── 병원 · 구성원 ──────────────────────────────────────────────────── */

  async function getClinic() {
    const d = await root().get();
    return d.exists ? withId(d) : null;
  }

  async function listMembers() {
    const s = await col('members').get();
    return s.docs.map(withId);
  }

  return {
    init, ready, vendorCodeKey,
    listItems, getItem, watchItems, createItem, updateItem, findItemByVendorCode,
    postMovement, listMovements,
    listVendors, createVendor, listLocations,
    getClinic, listMembers,
    // 테스트용. 앱 코드에서 쓰지 마세요.
    _root: root,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Repo;
