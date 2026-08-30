#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  migrate-from-lumi.js — 루미 → 재고닥 초기 이관
 *  ---------------------------------------------------------------------------
 *  ★ 지금은 report 모드만 있습니다. apply 는 아직 만들지 않았습니다.
 *
 *  왜 아직인가 — 선행 조건이 둘 있습니다.
 *   1. 루미 쪽 단가 정리가 끝나야 합니다.
 *      `lumi-admin/scripts/price-audit.js` 로 뽑은 목록을 원장님이 고친 뒤에
 *      옮겨야 합니다. 틀린 값을 옮기면 재고닥이 첫날부터 오염됩니다.
 *   2. P1 에서 items 스키마가 확정되어야 합니다. 특히 trackMode 와 packSize 는
 *      루미에 아예 없는 개념이라 사람이 정해야 합니다.
 *
 *  이 스크립트는 **루미를 읽기만 합니다.** 루미에 쓰지 않습니다.
 *
 *  사용법
 *    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\경로\lumi-sa.json"
 *    node scripts/migrate-from-lumi.js report
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const LUMI_PROJECT = 'lumiclinic-c1a95';

/* ── 매핑 규칙 (RESEARCH.md §A-6) ────────────────────────────────────────── */

/**
 * 루미 inventory 문서 → 재고닥 items 문서.
 *
 * ★ 핵심: 루미의 unitPrice 는 **최종매입가**이지 원가가 아닙니다.
 *   그대로 avgCostBase 로 넣으면 틀린 원가가 정답인 척 자리잡습니다.
 *   lastPriceBase 로 **이름을 바꿔** 넣고, 평균은 첫 입고부터 새로 쌓습니다.
 */
function mapItem(lumi) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const lastPrice = num(lumi.unitPrice) > 0
    ? Math.round(num(lumi.unitPrice))
    : (num(lumi.purchaseQty) > 0 ? Math.round(num(lumi.purchasePrice) / num(lumi.purchaseQty)) : 0);

  return {
    _sourceId: lumi.id,
    name: String(lumi.name || '').trim(),
    category: String(lumi.category || '').trim(),
    parentName: String(lumi.parentName || '').trim(),

    // ⚠️ 루미에는 등급·입수 개념이 없습니다. 전부 unit/1 로 들어오고,
    //    P1 온보딩에서 사람이 bulk 로 바꿉니다. 자동 추정하지 않습니다 —
    //    잘못 추정하면 재고가 packSize 배로 틀립니다.
    trackMode: 'unit',
    packSize: 1,
    baseUnit: String(lumi.unit || '개'),
    totalBase: num(lumi.currentStock),
    sealedPacks: 0,
    openedBase: 0,

    avgCostBase: null,              // ★ 이관하지 않습니다. 새로 쌓습니다
    lastPriceBase: lastPrice,       // ★ 개명. "마지막에 산 가격"
    lastPriceIsEstimate: true,      // 화면에서 "추정"으로 표시 (DECISIONS-3 §3-1)

    safetyStockBase: num(lumi.safetyStock),
    volumeMl: num(lumi.volumeMl) || null,
    discontinued: !!lumi.discontinued,
    vendorCodes: [],
    vendorCodeKeys: [],

    // 검산용 원본 보존 — 옮긴 뒤에도 대조할 수 있어야 합니다
    _lumiSnapshot: {
      unitPrice: num(lumi.unitPrice),
      purchasePrice: num(lumi.purchasePrice),
      purchaseQty: num(lumi.purchaseQty),
      currentStock: num(lumi.currentStock),
      totalStock: num(lumi.totalStock),
      locations: lumi.locations || {},
    },
  };
}

/** 이관 전 반드시 사람이 봐야 하는 것들 */
function auditItem(lumi, mapped) {
  const w = [];
  if (!mapped.name) w.push('이름이 비어 있음');
  if (mapped.lastPriceBase <= 0) w.push('단가 없음 — 첫 입고까지 원가 계산 불가');
  if (mapped.totalBase <= 0) w.push('현재고 0');
  // price-audit.js 검사 ① 과 같은 식. 여기서도 걸러 이관을 막습니다.
  const s = mapped._lumiSnapshot;
  if (s.unitPrice > 0 && s.purchaseQty > 0 && s.purchasePrice > 0) {
    const expected = s.unitPrice * s.purchaseQty;
    if (Math.abs(expected - s.purchasePrice) > Math.max(1, Math.ceil(s.purchaseQty / 2))) {
      w.push(`★ 단가 불일치 (되곱 ${expected} ≠ 구매액 ${s.purchasePrice}) — 이관 전 수정 필요`);
    }
  }
  if (Object.keys(s.locations || {}).length === 0 && s.currentStock > 0) {
    w.push('보관장소 미지정 — 재고닥 위치 배정 필요');
  }
  return w;
}

/* ── 실행부 ─────────────────────────────────────────────────────────────── */

async function main() {
  const mode = process.argv[2] || 'report';
  if (mode !== 'report') {
    console.error('\napply 모드는 아직 없습니다. 선행 조건 두 가지를 먼저 끝내세요:');
    console.error('  1. lumi-admin/scripts/price-audit.js 로 뽑은 단가 오류 정리');
    console.error('  2. P1 에서 items 스키마(trackMode·packSize) 확정\n');
    process.exit(1);
  }

  let admin;
  try {
    admin = require('firebase-admin');
  } catch (e) {
    console.error('\nfirebase-admin 이 없습니다:  cd functions && npm install\n');
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({projectId: LUMI_PROJECT});

  console.log(`\n루미(${LUMI_PROJECT}) inventory 를 읽습니다. 쓰지 않습니다.`);
  const snap = await admin.firestore().collection('inventory').get();
  const docs = snap.docs.map((d) => Object.assign({id: d.id}, d.data()));

  const rows = docs.map((d) => {
    const m = mapItem(d);
    return {name: m.name || '(이름없음)', warnings: auditItem(d, m)};
  });

  const blocked = rows.filter((r) => r.warnings.some((w) => w.startsWith('★')));
  const warned = rows.filter((r) => r.warnings.length && !r.warnings.some((w) => w.startsWith('★')));

  console.log(`\n총 ${rows.length}품목`);
  console.log(`  이관 차단 (단가 불일치): ${blocked.length}`);
  console.log(`  확인 필요:               ${warned.length}`);
  console.log(`  깨끗함:                  ${rows.length - blocked.length - warned.length}`);

  if (blocked.length) {
    console.log('\n── 이관 전 반드시 고쳐야 하는 품목 ──');
    blocked.forEach((r) => console.log(`  · ${r.name}\n      ${r.warnings.join('\n      ')}`));
    console.log('\n루미 통합앱 ✏️수정에서 구매 총 금액·박스수·입수를 다시 넣어 고치세요.');
  }

  console.log('\n※ 읽기만 했습니다. 아무것도 변경하지 않았습니다.\n');
}

if (require.main === module) {
  main().catch((e) => { console.error('\n실패:', e && e.message ? e.message : e); process.exit(1); });
}

module.exports = {mapItem, auditItem};
