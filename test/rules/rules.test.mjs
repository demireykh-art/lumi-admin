/**
 * Firestore 보안 규칙 에뮬레이터 테스트 — 수가표2
 *
 * 지시서 Section 5 요구 4개 케이스:
 *   1) 비로그인 사용자가 fee_items 읽기 → 거부
 *   2) view만 있는 계정(=editor/publisher 아님)이 가격 수정 → 거부
 *   3) editor 계정이 fee_public 쓰기 → 거부
 *   4) 누구든 fee_audit 수정·삭제 → 거부
 *
 * 실행:
 *   1. Firebase CLI 설치:  npm i -g firebase-tools
 *   2. 이 디렉터리에서:    npm install
 *   3. 에뮬레이터 기동:    firebase emulators:start --only firestore
 *   4. 다른 터미널에서:    npm test
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('error');

const PROJECT_ID = 'lumiclinic-c1a95-test';
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8');

const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
        rules: RULES,
        host: '127.0.0.1',
        port: 8080,
    },
});

// ─── 시드: fee_access/main 등록 ───────────────────────────────
// alice@ = editor, bob@ = publisher, carol@ = 로그인만 (권한 없음)
await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.collection('fee_access').doc('main').set({
        editors: ['alice@lumi.test'],
        publishers: ['bob@lumi.test'],
    });
    await db.collection('settings').doc('bizAdmins').set({
        emails: ['owner@lumi.test'],
    });
    // 감사 로그 update/delete 테스트를 위한 사전 문서
    await db.collection('fee_audit').doc('seed1').set({
        itemId: 'P001', field: 'priceRegular', before: 40000, after: 45000,
        uid: 'seed', email: 'seed@x', action: 'update', at: new Date(),
    });
    // 가격 수정 테스트를 위한 사전 fee_items 문서
    await db.collection('fee_items').doc('P001').set({
        id: 'P001', homeCategory: 'botox', name: '보톡스', priceRegular: 40000,
        showOnPrice: true, showOnEvent: false, sortOrder: 1, archived: false,
    });
});

// ─── 컨텍스트 헬퍼 ─────────────────────────────────────────────
const anon        = testEnv.unauthenticatedContext().firestore();
const alice       = testEnv.authenticatedContext('alice-uid',  { email: 'alice@lumi.test' }).firestore();  // editor
const bob         = testEnv.authenticatedContext('bob-uid',    { email: 'bob@lumi.test' }).firestore();    // publisher
const carol       = testEnv.authenticatedContext('carol-uid',  { email: 'carol@lumi.test' }).firestore(); // signedIn only
const owner       = testEnv.authenticatedContext('owner-uid',  { email: 'owner@lumi.test' }).firestore(); // bizAdmins

// ─── 실행 ──────────────────────────────────────────────────────
const results = [];
const T = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }); console.log(`  ✅ ${name}`); }
    catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ❌ ${name}\n     ${e.message}`); }
};

console.log('\n📜 Firestore Rules — 수가표2 에뮬레이터 테스트\n');

// ── 지시서 요구 4건 ──
console.log('[지시서 Section 5 요구 케이스]');

await T('1) 비로그인이 fee_items 읽기 → 거부', async () => {
    await assertFails(anon.collection('fee_items').doc('P001').get());
});

await T('2) 편집·게시 권한 없는 로그인 계정(carol)이 fee_items 쓰기 → 거부', async () => {
    await assertFails(
        carol.collection('fee_items').doc('P001').update({ priceRegular: 999999 })
    );
});

await T('3) editor(alice)가 fee_public 쓰기 → 거부 (Cloud Function만 쓸 수 있음)', async () => {
    await assertFails(
        alice.collection('fee_public').doc('current').set({ items: [] })
    );
});

await T('4a) 누구든 fee_audit update → 거부 (editor alice)', async () => {
    await assertFails(
        alice.collection('fee_audit').doc('seed1').update({ after: 999999 })
    );
});
await T('4b) 누구든 fee_audit delete → 거부 (editor alice)', async () => {
    await assertFails(alice.collection('fee_audit').doc('seed1').delete());
});
await T('4c) 관리자(owner)도 fee_audit update → 거부', async () => {
    await assertFails(
        owner.collection('fee_audit').doc('seed1').update({ after: 999999 })
    );
});

// ── 추가 검증 ──
console.log('\n[추가 검증 — 정상 경로가 열려 있는가]');

await T('editor(alice)가 fee_items read → 허용', async () => {
    await assertSucceeds(alice.collection('fee_items').doc('P001').get());
});
await T('editor(alice)가 fee_items update → 허용', async () => {
    await assertSucceeds(
        alice.collection('fee_items').doc('P001').update({ priceRegular: 45000 })
    );
});
await T('editor(alice)가 fee_audit create → 허용', async () => {
    await assertSucceeds(alice.collection('fee_audit').add({
        itemId: 'P001', field: 'priceRegular', before: 40000, after: 45000,
        uid: 'alice-uid', email: 'alice@lumi.test', action: 'update', at: new Date(),
    }));
});
await T('publisher(bob)가 fee_settings write → 허용', async () => {
    await assertSucceeds(
        bob.collection('fee_settings').doc('main').set({ eventPriceDisplay: 'strike_regular' }, { merge: true })
    );
});
await T('editor(alice)가 fee_settings write → 거부 (publisher 전용)', async () => {
    await assertFails(
        alice.collection('fee_settings').doc('main').set({ eventPriceDisplay: 'event_only' }, { merge: true })
    );
});
await T('비로그인이 fee_public/current read → 허용 (홈페이지 소비)', async () => {
    // 먼저 시드 필요
    await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().collection('fee_public').doc('current').set({ items: [], categories: [] });
    });
    await assertSucceeds(anon.collection('fee_public').doc('current').get());
});
await T('editor(alice)가 fee_access write → 거부 (bizAdmins 전용)', async () => {
    await assertFails(
        alice.collection('fee_access').doc('main').update({ editors: ['hack@x'] })
    );
});
await T('owner(bizAdmins)가 fee_access write → 허용', async () => {
    await assertSucceeds(
        owner.collection('fee_access').doc('main').set(
            { editors: ['alice@lumi.test', 'new@lumi.test'], publishers: ['bob@lumi.test'] }, { merge: true }
        )
    );
});

// ─── 리포트 ───────────────────────────────────────────────────
await testEnv.cleanup();

const fail = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(60)}`);
console.log(`총 ${results.length} · 통과 ${results.length - fail.length} · 실패 ${fail.length}`);
if (fail.length) {
    console.log('\n실패한 케이스:');
    for (const r of fail) console.log(`  · ${r.name}: ${r.err}`);
    process.exit(1);
}
console.log('✅ 모든 규칙 테스트 통과');
process.exit(0);
