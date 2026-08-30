/* ============================================================================
 *  fix-currentstock.test.js — 순수 로직 검증 (Firestore 불필요)
 *
 *  실행:  node --test scripts/fix-currentstock.test.js
 *
 *  이 스크립트는 프로덕션 재고 데이터를 씁니다. 특히 "장소 미지정 legacy 품목을
 *  0 으로 덮지 않는다"는 보장이 깨지면 재고가 소실되므로 반드시 테스트로 고정합니다.
 * ========================================================================= */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sumLocations, classifyItem, analyze } = require('./fix-currentstock.js');

/* ── sumLocations ── */

test('sumLocations: 정상 합산', () => {
  assert.strictEqual(sumLocations({ '5층-처치실': 4, '6층-시술실': 2 }).sum, 6);
});

test('sumLocations: 소수 수량 합산 (portioned 품목)', () => {
  const { sum } = sumLocations({ a: 1.5, b: 2.25 });
  assert.ok(Math.abs(sum - 3.75) < 1e-9);
});

test('sumLocations: 문자열 숫자도 허용', () => {
  assert.strictEqual(sumLocations({ a: '3', b: 2 }).sum, 5);
});

test('sumLocations: 숫자 아닌 값은 invalidKeys 로 분리', () => {
  const { sum, invalidKeys } = sumLocations({ a: 3, b: 'abc' });
  assert.strictEqual(sum, 3);
  assert.deepStrictEqual(invalidKeys, ['b']);
});

test('sumLocations: null/undefined/배열 방어', () => {
  assert.strictEqual(sumLocations(null).sum, 0);
  assert.strictEqual(sumLocations(undefined).sum, 0);
  assert.strictEqual(sumLocations([1, 2]).sum, 0);
});

/* ── classifyItem: 핵심 안전장치 ── */

test('🚨 장소 미지정 + 재고 있음 → no-locations. 절대 수정 대상이 아님', () => {
  // 실사 __total__ 경로(staff.html:6683)로 총량만 기록된 legacy 품목.
  // Σlocations=0 으로 덮으면 재고 50 이 사라진다.
  const r = classifyItem('x', { name: '레거시품목', currentStock: 50 });
  assert.strictEqual(r.status, 'no-locations');
  assert.deepStrictEqual(r.fields, []);
});

test('🚨 locations 가 빈 객체 + 재고 있음 → no-locations', () => {
  const r = classifyItem('x', { name: 'A', locations: {}, currentStock: 12 });
  assert.strictEqual(r.status, 'no-locations');
});

test('🚨 장소 미지정 + totalStock 만 잔존 → no-locations', () => {
  const r = classifyItem('x', { name: 'A', currentStock: 0, totalStock: 7 });
  assert.strictEqual(r.status, 'no-locations');
});

test('장소 미지정 + 재고 0 → ok (건드릴 것 없음)', () => {
  assert.strictEqual(classifyItem('x', { name: 'A', currentStock: 0, totalStock: 0 }).status, 'ok');
  assert.strictEqual(classifyItem('x', { name: 'A' }).status, 'ok');
});

/* ── classifyItem: 정상 판정 ── */

test('정합한 품목 → ok', () => {
  const r = classifyItem('x', { name: 'A', locations: { L: 5 }, currentStock: 5, totalStock: 5 });
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.fields, []);
});

test('입고 탭 버그 전형 — currentStock 이 뒤처짐 → drift, 양수 차이', () => {
  const r = classifyItem('x', {
    name: '거즈', locations: { '6층-시술실': 30 },
    currentStock: 10, totalStock: 30,
    batches: [{ batchNo: 'B1' }, { batchNo: 'B2' }],
  });
  assert.strictEqual(r.status, 'drift');
  assert.deepStrictEqual(r.fields, ['currentStock']);
  assert.strictEqual(r.diffCurrent, 20);
  assert.strictEqual(r.sumLocations, 30);
  assert.strictEqual(r.hasBatches, true);
  assert.strictEqual(r.batchCount, 2);
});

test('currentStock 필드 자체가 없으면 → drift, diffCurrent 는 null', () => {
  const r = classifyItem('x', { name: 'A', locations: { L: 4 } });
  assert.strictEqual(r.status, 'drift');
  assert.deepStrictEqual(r.fields, ['currentStock', 'totalStock']);
  assert.strictEqual(r.diffCurrent, null);
});

test('totalStock 만 불일치해도 drift (요구사항: totalStock 도 맞춘다)', () => {
  const r = classifyItem('x', { name: 'A', locations: { L: 5 }, currentStock: 5, totalStock: 99 });
  assert.strictEqual(r.status, 'drift');
  assert.deepStrictEqual(r.fields, ['totalStock']);
});

test('locations 에 0 값 키가 있으면 장소 관리 품목으로 본다 → Σ=0 이 진실', () => {
  const r = classifyItem('x', { name: 'A', locations: { '6층-시술실': 0 }, currentStock: 50 });
  assert.strictEqual(r.status, 'drift');
  assert.strictEqual(r.sumLocations, 0);
  assert.strictEqual(r.diffCurrent, -50);
});

test('부동소수 오차는 불일치로 보지 않는다', () => {
  const r = classifyItem('x', {
    name: 'A', locations: { a: 0.1, b: 0.2 },
    currentStock: 0.30000000000000004, totalStock: 0.30000000000000004,
  });
  assert.strictEqual(r.status, 'ok');
});

test('locations 값이 이상하면 invalid — 건드리지 않음', () => {
  const r = classifyItem('x', { name: 'A', locations: { a: 'NaN값' }, currentStock: 1 });
  assert.strictEqual(r.status, 'invalid');
  assert.deepStrictEqual(r.fields, []);
});

/* ── 멱등성 ── */

test('멱등: 수정 후 상태로 다시 분류하면 drift 0건', () => {
  const before = { name: 'A', locations: { L1: 10, L2: 5 }, currentStock: 3, totalStock: 3 };
  const r1 = classifyItem('x', before);
  assert.strictEqual(r1.status, 'drift');

  // apply 가 하는 일을 그대로 재현
  const after = { ...before };
  if (r1.fields.includes('currentStock')) after.currentStock = r1.sumLocations;
  if (r1.fields.includes('totalStock')) after.totalStock = r1.sumLocations;

  assert.strictEqual(classifyItem('x', after).status, 'ok');
});

/* ── analyze 집계 ── */

test('analyze: 상태별로 정확히 분류한다', () => {
  const a = analyze([
    { id: '1', data: { name: '정합', locations: { L: 5 }, currentStock: 5, totalStock: 5 } },
    { id: '2', data: { name: '불일치', locations: { L: 9 }, currentStock: 2, totalStock: 9 } },
    { id: '3', data: { name: '레거시', currentStock: 40 } },
    { id: '4', data: { name: '이상', locations: { L: {} }, currentStock: 1 } },
  ]);
  assert.strictEqual(a.total, 4);
  assert.strictEqual(a.ok.length, 1);
  assert.strictEqual(a.drift.length, 1);
  assert.strictEqual(a.noLocations.length, 1);
  assert.strictEqual(a.invalid.length, 1);
  assert.strictEqual(a.drift[0].name, '불일치');
});

test('analyze: 수정 대상에 no-locations / invalid 가 절대 섞이지 않는다', () => {
  const a = analyze([
    { id: '1', data: { name: '레거시1', currentStock: 40 } },
    { id: '2', data: { name: '레거시2', locations: {}, currentStock: 7 } },
    { id: '3', data: { name: '이상', locations: { L: 'x' }, currentStock: 1 } },
  ]);
  assert.strictEqual(a.drift.length, 0);
});
