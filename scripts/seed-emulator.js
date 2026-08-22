#!/usr/bin/env node
/* ============================================================================
 *  seed-emulator.js — 에뮬레이터에 합성 재고 데이터를 넣는다
 *  ---------------------------------------------------------------------------
 *  용도
 *    프로덕션 스냅샷을 받기 전에 fix-currentstock.js 의 동작을 끝까지 확인하기
 *    위한 가짜 데이터입니다. 입고 탭 버그가 만들어내는 형태(currentStock 뒤처짐,
 *    batches[] 보유)와 절대 건드리면 안 되는 형태(장소 미지정 legacy)를
 *    모두 포함합니다.
 *
 *  🔒 안전장치
 *    FIRESTORE_EMULATOR_HOST 가 없으면 즉시 종료합니다.
 *    실수로 프로덕션에 합성 데이터를 쓰는 일은 일어나지 않습니다.
 *
 *  사용법
 *    # 터미널 1
 *    npx firebase emulators:start --only firestore --project lumiclinic-c1a95
 *
 *    # 터미널 2
 *    export FIRESTORE_EMULATOR_HOST=localhost:8080
 *    node scripts/seed-emulator.js
 *    node scripts/fix-currentstock.js report
 *
 *  실데이터 스냅샷을 쓰는 경우엔 이 스크립트가 필요 없습니다.
 *    firebase firestore:export gs://<bucket>/snapshot-YYYYMMDD
 *    gsutil -m cp -r gs://<bucket>/snapshot-YYYYMMDD ./snapshot
 *    firebase emulators:start --only firestore --import ./snapshot
 * ========================================================================= */

'use strict';

const path = require('path');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    '\n🔒 거부: FIRESTORE_EMULATOR_HOST 가 설정되지 않았습니다.\n' +
    '   이 스크립트는 에뮬레이터 전용입니다. 프로덕션에는 절대 쓰지 않습니다.\n\n' +
    '   export FIRESTORE_EMULATOR_HOST=localhost:8080\n'
  );
  process.exit(2);
}

const { loadAdmin, initAdmin } = require('./fix-currentstock.js');

/* 합성 품목 — 각 줄이 하나의 시나리오를 대표합니다. */
const SEED = [
  // ── 입고 탭 버그의 전형: locations 는 늘었는데 currentStock 이 뒤처짐 ──
  { id: 'gauze',    name: '멸균거즈 4x4',   category: 'nursing', unit: '개',
    locations: { '6층-시술실': 120, '5층-처치실': 30 }, currentStock: 40, totalStock: 150,
    batches: [{ batchNo: 'B20260701-A1' }, { batchNo: 'B20260715-C2' }, { batchNo: 'B20260805-D9' }] },
  { id: 'lido',     name: '리도카인 2%',    category: 'nursing', unit: '앰플',
    locations: { '6층-준비실 냉장고': 18 }, currentStock: 6, totalStock: 18,
    batches: [{ batchNo: 'B20260712-B3' }, { batchNo: 'B20260808-E1' }] },
  { id: 'needle30', name: '니들 30G',       category: 'nursing', unit: '개',
    locations: { '6층-준비실': 500 }, currentStock: 200, totalStock: 500,
    batches: [{ batchNo: 'B20260720-F4' }] },

  // ── totalStock 필드만 없는 구형 문서 ──
  { id: 'cotton',   name: '알콜솜',         category: 'common',  unit: '통',
    locations: { '6층-시술실': 45 }, currentStock: 45 },

  // ── 소수 수량 (portioned) — 부동소수 오차가 오판을 부르면 안 됨 ──
  { id: 'toner',    name: '토너 500ml',     category: 'skin',    unit: 'ml',
    locations: { '5층-처치실': 0.1, '6층-시술실': 0.2 },
    currentStock: 0.30000000000000004, totalStock: 0.30000000000000004 },
  { id: 'serum',    name: '앰플세럼',       category: 'skin',    unit: 'cc',
    locations: { '5층-처치실': 7.5 }, currentStock: 9, totalStock: 7.5 },

  // ── 이미 정합 — 손대면 안 됨 ──
  { id: 'toner2',   name: '프린터토너',     category: 'desk',    unit: '개',
    locations: { '5층-데스크': 2 }, currentStock: 2, totalStock: 2 },
  { id: 'glove',    name: '니트릴장갑 M',   category: 'nursing', unit: '박스',
    locations: { '6층-시술실': 12, '5층-처치실': 8 }, currentStock: 20, totalStock: 20 },

  // ── 🚨 장소 미지정 legacy — Σ=0 으로 덮으면 재고 소실. 절대 건드리면 안 됨 ──
  { id: 'mask',     name: '구형품목-마스크', category: 'common', unit: '박스',
    currentStock: 80 },
  { id: 'apron',    name: '구형품목-앞치마', category: 'common', unit: '개',
    locations: {}, currentStock: 15 },

  // ── locations 값 이상 — 건너뛰고 보고만 ──
  { id: 'weird',    name: '값이상품목',      category: 'common',  unit: '개',
    locations: { '6층-시술실': '열두개' }, currentStock: 3 },

  // ── 재고 0 + 장소 미지정 → 정합 (건드릴 것 없음) ──
  { id: 'disc',     name: '단종품목',        category: 'common',  unit: '개',
    currentStock: 0, totalStock: 0 },
];

async function main() {
  const admin = initAdmin(loadAdmin(), 'lumiclinic-c1a95');
  const db = admin.firestore();

  const batch = db.batch();
  for (const { id, ...data } of SEED) {
    batch.set(db.collection('inventory').doc(id), {
      ...data, updatedAt: new Date('2026-08-20T00:00:00Z').toISOString(),
    });
  }
  await batch.commit();

  console.log(`\n✓ 에뮬레이터(${process.env.FIRESTORE_EMULATOR_HOST}) 에 inventory ${SEED.length} 품목 주입`);
  console.log('  다음: node scripts/fix-currentstock.js report\n');
}

main().catch((e) => { console.error('✗ 실패:', e.message); process.exit(1); });
