#!/usr/bin/env node
/**
 * 루미의원 수가표2 초기 데이터 import 스크립트 (1회용)
 *
 * 사용법:
 *   node import-fees.mjs --xlsx=/path/to/master.xlsx [--dry-run]
 *                        [--service-account=/path/to/svc.json]
 *                        [--bootstrap-email=clinic.lumi@gmail.com]
 *
 * 환경변수 대안:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/svc.json node import-fees.mjs --xlsx=...
 *
 * 처리 내용:
 *   1) xlsx `수가표` 시트 210행을 fee_items 컬렉션에 문서 ID = P001~P210 로 기록
 *   2) xlsx `분류대조` 시트 15개 분류를 fee_categories 에 slug ID로 기록
 *   3) fee_settings/main 기본값 시드 (VAT 문구, 이벤트 표시 방식)
 *   4) --bootstrap-email 지정 시 fee_access/main 에 editor+publisher로 등록
 *
 * 안전장치:
 *   · --dry-run 이면 아무것도 쓰지 않고 매핑 결과만 요약 출력
 *   · 이미 있는 fee_items 문서는 덮어쓰지 않고 스킵 (idempotent). --force 로 강제 덮어쓰기 가능
 *   · needsReview 값이 있는 행은 그대로 보존 → 게시 차단 로직이 이걸 잡아냄
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import xlsx from 'xlsx';
import admin from 'firebase-admin';

// ─── 인자 파싱 ───────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
        const [k, ...v] = a.replace(/^--/, '').split('=');
        return [k, v.join('=') || true];
    })
);

const XLSX_PATH = args.xlsx;
const DRY_RUN = !!args['dry-run'];
const FORCE = !!args.force;
const BOOTSTRAP_EMAIL = args['bootstrap-email'] || null;
const SVC = args['service-account'] || process.env.GOOGLE_APPLICATION_CREDENTIALS || null;

if (!XLSX_PATH) {
    console.error('Usage: node import-fees.mjs --xlsx=<path> [--dry-run] [--service-account=<path>] [--bootstrap-email=<email>]');
    process.exit(1);
}

// ─── 한글 분류 → slug 매핑 ─────────────────────────────────────
// SCHEMA.md 표와 동일. xlsx `홈페이지 분류` 컬럼과 정확히 일치해야 함.
const CATEGORY_SLUGS = {
    '보톡스':      { id: 'botox',        order: 1,  labelEn: 'Botox',       pageLink: '' },
    '필러':        { id: 'filler',       order: 2,  labelEn: 'Filler',      pageLink: '' },
    '리프팅·탄력': { id: 'lifting',      order: 3,  labelEn: 'Lifting',     pageLink: 'lifting.html' },
    '파인샷':      { id: 'fineshot',     order: 4,  labelEn: 'Fine Shot',   pageLink: 'fineshot.html' },
    '색소·토닝':   { id: 'pigment',      order: 5,  labelEn: 'Pigment',     pageLink: 'pigment.html' },
    '스킨부스터':  { id: 'booster',      order: 6,  labelEn: 'Booster',     pageLink: 'skinbooster.html' },
    '모공·여드름': { id: 'acne',         order: 7,  labelEn: 'Acne · Pore', pageLink: 'acne.html' },
    '흉터':        { id: 'scar',         order: 8,  labelEn: 'Scar',        pageLink: 'scar.html' },
    '점·돌출병변': { id: 'bumps',        order: 9,  labelEn: 'Bumps',       pageLink: 'bumps.html' },
    '포다이스반':  { id: 'fordyce',      order: 10, labelEn: 'Fordyce',     pageLink: 'fordyce.html' },
    '문신제거':    { id: 'tattoo',       order: 11, labelEn: 'Tattoo',      pageLink: 'tattoo-removal.html' },
    '제모':        { id: 'hair-removal', order: 12, labelEn: 'Hair Removal', pageLink: 'hr.html' },
    '탈모':        { id: 'hair-loss',    order: 13, labelEn: 'Hair Loss',   pageLink: 'hair.html' },
    '재생·관리':   { id: 'regen',        order: 14, labelEn: 'Regeneration', pageLink: 'skinregen.html' },
    '수액':        { id: 'iv',           order: 15, labelEn: 'IV Therapy',  pageLink: 'iv-therapy.html' },
};

// ─── 유틸: Y/N → bool, 빈칸 → null, 문자열 정리 ────────────────
const yn = v => (typeof v === 'string' && v.trim().toUpperCase() === 'Y') || v === true;
const numOrNull = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
};
const s = v => (v == null ? '' : String(v).trim());

// ─── xlsx 파싱 ─────────────────────────────────────────────────
console.log(`📂 Reading ${XLSX_PATH}`);
const buf = await readFile(XLSX_PATH);
const wb = xlsx.read(buf, { type: 'buffer' });

if (!wb.SheetNames.includes('수가표')) {
    console.error('❌ Sheet "수가표" not found. Sheets:', wb.SheetNames);
    process.exit(1);
}

const rows = xlsx.utils.sheet_to_json(wb.Sheets['수가표'], { defval: null });
console.log(`  · 수가표 rows: ${rows.length}`);

// ─── 매핑 ─────────────────────────────────────────────────────
const items = [];
const unknownCategories = new Set();
let sortOrder = 0;

for (const r of rows) {
    sortOrder++;
    const id = s(r['ID']);
    if (!/^P\d{3,}$/.test(id)) {
        console.warn(`  ⚠️  Skip row ${sortOrder}: invalid ID ${JSON.stringify(r['ID'])}`);
        continue;
    }

    const homeKr = s(r['홈페이지 분류']);
    const catMeta = CATEGORY_SLUGS[homeKr];
    if (!catMeta) unknownCategories.add(homeKr);

    items.push({
        id,
        homeCategory:      catMeta ? catMeta.id : `unknown:${homeKr}`,
        internalCategory:  s(r['내부 분류(원본)']) || s(r['내부분류(원본)']) || homeKr,
        name:              s(r['시술명']),
        option:            s(r['옵션']),
        priceRegular:      numOrNull(r['정가(원)']),
        priceEvent:        numOrNull(r['이벤트가(원)']),
        eventCondition:    s(r['이벤트 조건']),
        eventStart:        null,   // xlsx엔 없음
        eventEnd:          null,   // xlsx엔 없음
        showOnPrice:       yn(r['홈페이지 노출']),
        showOnEvent:       yn(r['이벤트 노출']),
        duration:          s(r['시술시간']),
        publicDescription: s(r['공개 설명']),
        internalMemo:      s(r['내부 메모(비공개)']) || s(r['내부메모(비공개)']) || '',
        needsReview:       s(r['확인 필요']),
        sortOrder,
        archived:          false,
    });
}

// ─── 검증: 분류별 개수 vs 분류대조 시트 ─────────────────────────
const counts = {};
for (const it of items) counts[it.homeCategory] = (counts[it.homeCategory] || 0) + 1;

console.log('\n📊 카테고리별 집계:');
for (const [kr, meta] of Object.entries(CATEGORY_SLUGS)) {
    const n = counts[meta.id] || 0;
    console.log(`  · ${kr.padEnd(14)} (${meta.id.padEnd(14)}) : ${String(n).padStart(3)} 행`);
}
if (unknownCategories.size) {
    console.warn('  ⚠️  Unknown categories:', [...unknownCategories]);
}
const withReview = items.filter(i => i.needsReview).length;
console.log(`\n  총 ${items.length}개 항목 · 확인 필요: ${withReview}건`);

// ─── DRY RUN이면 여기서 종료 ─────────────────────────────────
if (DRY_RUN) {
    console.log('\n✅ --dry-run: 아무것도 쓰지 않고 종료합니다.');
    console.log('   샘플 매핑 결과 (P001, P002, 마지막 항목):');
    console.log(JSON.stringify(items[0], null, 2));
    console.log(JSON.stringify(items[1], null, 2));
    console.log(JSON.stringify(items[items.length - 1], null, 2));
    process.exit(0);
}

// ─── Firebase Admin SDK 초기화 ─────────────────────────────────
if (!SVC) {
    console.error('❌ service account 미지정. --service-account=<path> 또는 GOOGLE_APPLICATION_CREDENTIALS 환경변수 필요.');
    process.exit(1);
}

const svc = JSON.parse(await readFile(SVC, 'utf-8'));
admin.initializeApp({ credential: admin.credential.cert(svc), projectId: svc.project_id });
const db = admin.firestore();

console.log(`\n🚀 Firebase project: ${svc.project_id}`);

// ─── 배치 쓰기 ─────────────────────────────────────────────────
const now = admin.firestore.FieldValue.serverTimestamp();
let created = 0, skipped = 0, updated = 0;

// 1) fee_categories
console.log('\n📁 fee_categories 15개 쓰는 중...');
{
    const batch = db.batch();
    for (const [labelKr, meta] of Object.entries(CATEGORY_SLUGS)) {
        const ref = db.collection('fee_categories').doc(meta.id);
        batch.set(ref, {
            label:   labelKr,
            labelEn: meta.labelEn,
            order:   meta.order,
            pageLink: meta.pageLink,
            note:    '',
            updatedAt: now,
        }, { merge: true });
    }
    await batch.commit();
    console.log(`  ✓ ${Object.keys(CATEGORY_SLUGS).length}개 카테고리 저장`);
}

// 2) fee_settings/main
console.log('\n⚙️  fee_settings/main 기본값 시드 중...');
{
    const ref = db.collection('fee_settings').doc('main');
    const doc = await ref.get();
    if (!doc.exists || FORCE) {
        await ref.set({
            eventPriceDisplay: 'event_only',
            vatNotice: '모든 가격은 부가세 10% 별도입니다.',
            footerNotice: '실제 비용은 진료 후 결정됩니다. 비급여 진료비용은 의료법에 따라 원내에도 게시하고 있습니다.',
            updatedAt: now,
        }, { merge: true });
        console.log('  ✓ 저장');
    } else {
        console.log('  ↩ 이미 존재 (--force 시 덮어쓰기)');
    }
}

// 3) fee_access/main (부트스트랩)
if (BOOTSTRAP_EMAIL) {
    console.log(`\n🔐 fee_access/main 부트스트랩 — editor+publisher: ${BOOTSTRAP_EMAIL}`);
    const ref = db.collection('fee_access').doc('main');
    const doc = await ref.get();
    const existing = doc.exists ? doc.data() : { editors: [], publishers: [] };
    const editors = Array.from(new Set([...(existing.editors || []), BOOTSTRAP_EMAIL.toLowerCase()]));
    const publishers = Array.from(new Set([...(existing.publishers || []), BOOTSTRAP_EMAIL.toLowerCase()]));
    await ref.set({ editors, publishers, updatedAt: now }, { merge: true });
    console.log(`  ✓ editors=${editors.length}명, publishers=${publishers.length}명`);
}

// 4) fee_items — 500개 단위 배치 (Firestore 제한)
console.log(`\n💰 fee_items ${items.length}개 쓰는 중...`);
for (let i = 0; i < items.length; i += 400) {
    const chunk = items.slice(i, i + 400);
    const batch = db.batch();
    for (const it of chunk) {
        const ref = db.collection('fee_items').doc(it.id);
        const doc = await ref.get();
        if (doc.exists && !FORCE) {
            skipped++;
            continue;
        }
        batch.set(ref, {
            ...it,
            updatedAt: now,
            updatedBy: `import-script@${new Date().toISOString()}`,
        }, { merge: true });
        if (doc.exists) updated++; else created++;
    }
    await batch.commit();
    console.log(`  ✓ batch ${i / 400 + 1} committed (${chunk.length} rows)`);
}

// 5) 감사 로그
await db.collection('fee_audit').add({
    itemId: 'import',
    field: 'batch',
    before: null,
    after: { created, updated, skipped, total: items.length },
    uid: 'import-script',
    email: 'import-script@local',
    action: 'create',
    at: now,
});

console.log('\n✅ 완료');
console.log(`   created: ${created}  updated: ${updated}  skipped(existing): ${skipped}`);
console.log(`   확인 필요 63건 남아 있으므로 원장 정리 전까진 게시 차단 로직이 배포를 막습니다.`);
process.exit(0);
