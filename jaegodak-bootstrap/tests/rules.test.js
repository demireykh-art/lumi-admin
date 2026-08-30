/* ═══════════════════════════════════════════════════════════════════════════
 *  rules.test.js — 멀티테넌시가 실제로 막히는지 확인한다
 *  ---------------------------------------------------------------------------
 *  SaaS 에서 가장 큰 사고는 **다른 병원 데이터가 보이는 것**이다.
 *  Rules 를 눈으로 읽어서는 알 수 없다. 남의 병원에 실제로 접근해 보고
 *  거부되는 것을 확인한다.
 *
 *  실행:  npm test        (에뮬레이터를 자동으로 띄웠다 내린다)
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const A = 'clinic_A';
const B = 'clinic_B';

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'jaegodak-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test.beforeEach(async () => {
  await env.clearFirestore();
  // Rules 를 우회해 씨앗 데이터를 넣는다.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`clinics/${A}`).set({name: 'A병원', ownerUid: 'ownerA', plan: 'pilot'});
    await db.doc(`clinics/${B}`).set({name: 'B병원', ownerUid: 'ownerB', plan: 'pilot'});
    await db.doc(`clinics/${A}/items/i1`).set({name: 'A품목', clinicId: A});
    await db.doc(`clinics/${B}/items/i1`).set({name: 'B품목', clinicId: B});
    await db.doc(`clinics/${A}/movements/m1`).set({itemId: 'i1', qtyBase: 10, clinicId: A});
    await db.doc(`clinics/${A}/members/staffA`).set({uid: 'staffA', role: 'staff'});
    await db.doc(`users/staffA`).set({clinicId: A, role: 'staff', displayName: '직원A'});
  });
});

// 소속·권한을 클레임으로 흉내낸다 — 실제 로그인과 같은 형태다.
const as = (uid, clinicId, role) =>
  env.authenticatedContext(uid, clinicId ? {clinicId, role} : {}).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/* ── 1. 남의 병원 ★ 여기가 무너지면 제품이 끝난다 ─────────────────────── */

test('A병원 직원은 B병원 품목을 읽을 수 없다', async () => {
  await assertFails(as('u1', A, 'staff').doc(`clinics/${B}/items/i1`).get());
});

test('A병원 직원은 B병원 품목 목록을 조회할 수 없다', async () => {
  await assertFails(as('u1', A, 'staff').collection(`clinics/${B}/items`).get());
});

test('A병원 직원은 B병원에 품목을 쓸 수 없다', async () => {
  await assertFails(as('u1', A, 'staff').doc(`clinics/${B}/items/x`).set({name: '침입'}));
});

test('A병원 owner 라도 B병원 문서를 읽을 수 없다', async () => {
  await assertFails(as('ownerA', A, 'owner').doc(`clinics/${B}`).get());
});

test('A병원 직원은 B병원 원장(movements)을 읽을 수 없다', async () => {
  await assertFails(as('u1', A, 'staff').collection(`clinics/${B}/movements`).get());
});

/* ── 2. 비로그인 ─────────────────────────────────────────────────────── */

test('비로그인은 아무것도 못 읽는다', async () => {
  await assertFails(anon().doc(`clinics/${A}/items/i1`).get());
  await assertFails(anon().doc(`clinics/${A}`).get());
});

test('소속 클레임이 없는 로그인 사용자도 못 읽는다', async () => {
  await assertFails(as('u9', null, null).doc(`clinics/${A}/items/i1`).get());
});

/* ── 3. 정상 경로 — 막기만 하고 못 쓰면 소용없다 ──────────────────────── */

test('소속 직원은 자기 병원 품목을 읽는다', async () => {
  await assertSucceeds(as('u1', A, 'staff').doc(`clinics/${A}/items/i1`).get());
});

test('소속 직원은 품목을 만들 수 있다', async () => {
  await assertSucceeds(
    as('u1', A, 'staff').doc(`clinics/${A}/items/new`).set({name: '새품목', clinicId: A})
  );
});

test('소속 직원은 자기 병원 문서를 읽는다', async () => {
  await assertSucceeds(as('u1', A, 'staff').doc(`clinics/${A}`).get());
});

/* ── 4. clinicId 바꿔치기 ────────────────────────────────────────────── */

test('경로는 A인데 clinicId 를 B로 적으면 거부한다', async () => {
  await assertFails(
    as('u1', A, 'staff').doc(`clinics/${A}/items/x`).set({name: 'x', clinicId: B})
  );
});

test('clinicId 를 아예 안 적는 것은 허용한다', async () => {
  await assertSucceeds(as('u1', A, 'staff').doc(`clinics/${A}/items/y`).set({name: 'y'}));
});

/* ── 5. 권한 등급 ────────────────────────────────────────────────────── */

test('staff 는 품목을 지울 수 없다', async () => {
  await assertFails(as('u1', A, 'staff').doc(`clinics/${A}/items/i1`).delete());
});

test('manager 는 품목을 지울 수 있다', async () => {
  await assertSucceeds(as('u2', A, 'manager').doc(`clinics/${A}/items/i1`).delete());
});

test('staff 는 병원 설정을 못 바꾼다', async () => {
  await assertFails(as('u1', A, 'staff').doc(`clinics/${A}`).update({name: '바꿈'}));
});

test('owner 는 병원 이름을 바꿀 수 있다', async () => {
  await assertSucceeds(as('ownerA', A, 'owner').doc(`clinics/${A}`).update({name: '새이름'}));
});

test('owner 라도 요금제(plan)는 못 바꾼다 — 스스로 유료 전환 금지', async () => {
  await assertFails(as('ownerA', A, 'owner').doc(`clinics/${A}`).update({plan: 'enterprise'}));
});

test('owner 라도 ownerUid 는 못 바꾼다', async () => {
  await assertFails(as('ownerA', A, 'owner').doc(`clinics/${A}`).update({ownerUid: 'u1'}));
});

test('클라이언트는 병원을 만들 수 없다 (Functions 전용)', async () => {
  await assertFails(as('u1', A, 'owner').doc('clinics/new').set({name: '몰래'}));
});

/* ── 6. 원장(movements)은 고쳐 쓰지 않는다 ───────────────────────────── */

test('입출고 기록은 만들 수 있다', async () => {
  await assertSucceeds(
    as('u1', A, 'staff').doc(`clinics/${A}/movements/m2`).set({itemId: 'i1', qtyBase: 5, clinicId: A})
  );
});

test('입출고 기록은 수정할 수 없다 — owner 도 마찬가지', async () => {
  await assertFails(as('ownerA', A, 'owner').doc(`clinics/${A}/movements/m1`).update({qtyBase: 999}));
});

test('입출고 기록은 삭제할 수 없다', async () => {
  await assertFails(as('ownerA', A, 'owner').doc(`clinics/${A}/movements/m1`).delete());
});

/* ── 7. 권한 상승 ★ 클레임이 유일한 진실이어야 한다 ──────────────────── */

test('본인 users 문서에 clinicId 를 심을 수 없다', async () => {
  await assertFails(as('u9', null, null).doc('users/u9').set({clinicId: A, role: 'owner'}));
});

test('본인 users 문서의 role 을 올릴 수 없다', async () => {
  await assertFails(as('staffA', A, 'staff').doc('users/staffA').update({role: 'owner'}));
});

test('본인 users 문서의 이름은 고칠 수 있다', async () => {
  await assertSucceeds(as('staffA', A, 'staff').doc('users/staffA').update({displayName: '새이름'}));
});

test('남의 users 문서는 읽을 수 없다 — 같은 병원이어도', async () => {
  await assertFails(as('u1', A, 'manager').doc('users/staffA').get());
});

test('members 문서는 클라이언트가 못 쓴다 (Functions 전용)', async () => {
  await assertFails(as('ownerA', A, 'owner').doc(`clinics/${A}/members/u1`).set({role: 'owner'}));
});

test('members 문서는 소속이면 읽을 수 있다', async () => {
  await assertSucceeds(as('u1', A, 'staff').doc(`clinics/${A}/members/staffA`).get());
});

/* ── 8. 화이트리스트에 없는 경로 ─────────────────────────────────────── */

test('Rules 에 안 적힌 하위 컬렉션은 소속이어도 막힌다', async () => {
  await assertFails(as('u1', A, 'owner').doc(`clinics/${A}/secretStuff/x`).get());
  await assertFails(as('u1', A, 'owner').doc(`clinics/${A}/secretStuff/x`).set({a: 1}));
});

test('최상위에 새 컬렉션을 만들 수 없다', async () => {
  await assertFails(as('u1', A, 'owner').doc('inventory/x').set({a: 1}));
});

/* ── 9. 초대 ─────────────────────────────────────────────────────────── */

test('초대는 코드를 알면 읽을 수 있다 (소속 없어도)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('invites/CODE123').set({clinicId: A, role: 'staff'});
  });
  await assertSucceeds(as('u9', null, null).doc('invites/CODE123').get());
});

test('초대 목록은 훑을 수 없다 — 코드를 찾아낼 수 없어야 한다', async () => {
  await assertFails(as('u9', null, null).collection('invites').get());
});

test('초대는 클라이언트가 만들 수 없다', async () => {
  await assertFails(as('ownerA', A, 'owner').doc('invites/FAKE').set({clinicId: A, role: 'owner'}));
});
