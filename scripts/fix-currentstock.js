#!/usr/bin/env node
/* ============================================================================
 *  fix-currentstock.js — inventory.currentStock / totalStock 정합성 복구
 *  ---------------------------------------------------------------------------
 *  배경
 *    통합앱 입고 탭(submitReceiving)이 totalStock 만 갱신하고 currentStock 을
 *    남겨두는 버그가 있었습니다(HOTFIX-1 에서 수정). 그 기간 동안 입고된 품목은
 *    currentStock 이 실제보다 작게 남아 있고, 재고 목록·발주 배지·재고 가치·
 *    발주 예측이 전부 그 값을 읽습니다.
 *
 *    다행히 locations 맵은 정상 갱신되었으므로 진실은 locations 에 있습니다.
 *    이 스크립트는 Σlocations 를 기준으로 currentStock / totalStock 을 맞춥니다.
 *
 *  안전장치
 *    · report 모드가 기본. apply 는 --confirm 을 명시해야만 씁니다.
 *    · apply 전 inventory 컬렉션 전체를 JSON 으로 백업합니다.
 *    · locations 가 아예 없는 legacy 품목은 절대 건드리지 않습니다.
 *      (실사 __total__ 경로로 총량만 기록된 품목 — Σ=0 으로 덮으면 재고 소실)
 *    · 멱등. 두 번 돌려도 두 번째는 0건입니다.
 *
 *  사용법 — macOS / Linux (bash)
 *    cd functions && npm install && cd ..                 # firebase-admin
 *    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *    node scripts/fix-currentstock.js report              # 읽기만
 *    node scripts/fix-currentstock.js report --out report.json
 *    node scripts/fix-currentstock.js apply --confirm     # 승인 후에만
 *
 *  사용법 — Windows PowerShell
 *    ※ Windows PowerShell 5.1 은 && 를 지원하지 않습니다. ; 로 나누거나 줄을 나누세요.
 *    ※ 환경변수는 export 가 아니라 $env: 입니다.
 *
 *    cd functions
 *    npm install
 *    cd ..
 *    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\경로\serviceAccount.json"
 *    node scripts/fix-currentstock.js report
 *    node scripts/fix-currentstock.js report --out report.json
 *    node scripts/fix-currentstock.js apply --confirm
 *
 *    자격증명 대안 (두 OS 공통):  gcloud auth application-default login
 *
 *  에뮬레이터에서 먼저 검증하려면
 *    # 터미널 1 — 에뮬레이터
 *    npm install                 # firebase-tools (devDependency)
 *    npm run emu
 *
 *    # 터미널 2 — 합성 데이터로 파이프라인 확인
 *    export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080        # bash
 *    $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"      # PowerShell
 *    npm run emu:seed
 *    npm run stock:report
 *
 *    끝나면 반드시 해제하세요. 남아 있으면 프로덕션 대신 에뮬레이터를 봅니다.
 *      unset FIRESTORE_EMULATOR_HOST                      # bash
 *      Remove-Item Env:\FIRESTORE_EMULATOR_HOST           # PowerShell
 *
 *    프로덕션 스냅샷을 쓰려면 seed 대신:
 *      firebase firestore:export gs://<bucket>/snapshot-YYYYMMDD
 *      gsutil -m cp -r gs://<bucket>/snapshot-YYYYMMDD ./snapshot
 *      firebase emulators:start --only firestore --import ./snapshot
 *    ※ 스냅샷에는 실데이터가 들어 있습니다. 커밋하지 마세요.
 * ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'lumiclinic-c1a95';
const COLLECTION = 'inventory';
const EPSILON = 1e-9;          // 수량은 parseFloat(소수 가능) 이므로 부동소수 오차 허용
const BATCH_LIMIT = 400;       // Firestore batch 상한 500 보다 여유

/* ───────────────────────── 순수 로직 (테스트 대상) ───────────────────────── */

/**
 * locations 맵을 합산한다.
 * @returns {{sum:number, invalidKeys:string[]}}
 */
function sumLocations(locations) {
  const invalidKeys = [];
  let sum = 0;
  if (!locations || typeof locations !== 'object' || Array.isArray(locations)) {
    return { sum: 0, invalidKeys };
  }
  for (const [key, raw] of Object.entries(locations)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) { invalidKeys.push(key); continue; }
    sum += n;
  }
  return { sum, invalidKeys };
}

const near = (a, b) => Math.abs(a - b) < EPSILON;

/**
 * 품목 하나를 분류한다. Firestore 를 모르는 순수 함수.
 *
 * status
 *   'ok'            — 이미 정합. 손대지 않음
 *   'drift'         — currentStock 또는 totalStock 이 Σlocations 와 다름 → 수정 대상
 *   'no-locations'  — locations 키가 하나도 없는데 재고가 잡혀 있음 (legacy). 절대 건드리지 않음
 *   'invalid'       — locations 에 숫자가 아닌 값이 섞임. 사람이 봐야 함. 건드리지 않음
 *
 * @param {string} id
 * @param {object} data  Firestore 문서 데이터
 */
function classifyItem(id, data) {
  const d = data || {};
  const locations = d.locations;
  const hasLocationKeys =
    !!locations && typeof locations === 'object' && !Array.isArray(locations)
    && Object.keys(locations).length > 0;

  const { sum, invalidKeys } = sumLocations(locations);

  const currentRaw = d.currentStock;
  const totalRaw = d.totalStock;
  const current = Number.isFinite(Number(currentRaw)) ? Number(currentRaw) : null;
  const total = Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : null;

  const base = {
    id,
    name: d.name || '(무명)',
    category: d.category || '',
    unit: d.unit || '개',
    currentStock: current,
    totalStock: total,
    sumLocations: sum,
    locationCount: hasLocationKeys ? Object.keys(locations).length : 0,
    // batches[] 존재 = 입고 탭(receivingHistory 경로)으로 관리된 품목이라는 직접 증거
    hasBatches: Array.isArray(d.batches) && d.batches.length > 0,
    batchCount: Array.isArray(d.batches) ? d.batches.length : 0,
  };

  if (invalidKeys.length) {
    return { ...base, status: 'invalid', reason: `locations 값이 숫자가 아님: ${invalidKeys.join(', ')}`, fields: [] };
  }

  if (!hasLocationKeys) {
    // 장소 정보가 없는 품목. Σ 는 0 이지만 그건 "재고 0" 이 아니라 "모름" 이다.
    if (current !== null && !near(current, 0)) {
      return {
        ...base, status: 'no-locations', fields: [],
        reason: '장소 미지정 legacy 품목 — Σlocations=0 으로 덮으면 재고가 소실됨. 수동 확인 필요',
      };
    }
    if (total !== null && !near(total, 0)) {
      return {
        ...base, status: 'no-locations', fields: [],
        reason: '장소 미지정 + totalStock 잔존 — 수동 확인 필요',
      };
    }
    return { ...base, status: 'ok', fields: [], reason: '' };
  }

  // 여기부터: 장소가 지정된 품목. Σlocations 가 진실이다.
  const fields = [];
  if (current === null || !near(current, sum)) fields.push('currentStock');
  if (total === null || !near(total, sum)) fields.push('totalStock');

  if (!fields.length) return { ...base, status: 'ok', fields: [], reason: '' };

  return {
    ...base,
    status: 'drift',
    fields,
    diffCurrent: current === null ? null : +(sum - current).toFixed(6),
    diffTotal: total === null ? null : +(sum - total).toFixed(6),
    reason: fields.includes('currentStock')
      ? '입고 탭 경로로 갱신되어 currentStock 이 뒤처짐(추정)'
      : 'totalStock 만 누락/불일치',
  };
}

/** 전체 문서를 분류하고 요약을 만든다. */
function analyze(docs) {
  const results = docs.map(({ id, data }) => classifyItem(id, data));
  const by = (s) => results.filter((r) => r.status === s);
  return {
    results,
    drift: by('drift'),
    ok: by('ok'),
    noLocations: by('no-locations'),
    invalid: by('invalid'),
    total: results.length,
  };
}

/* ───────────────────────── 보고서 렌더링 ───────────────────────── */

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(3));
}

// 한글·전각 문자는 터미널에서 2칸을 차지한다. 문자 수가 아니라 표시 폭으로 맞춰야
// 표가 어긋나지 않는다. (한글/한자/가나/전각기호/일부 기호 범위)
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}
function clip(s, w) {
  let out = '', used = 0;
  for (const ch of String(s)) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (used + cw > w) break;
    out += ch; used += cw;
  }
  return { text: out, width: used };
}
function pad(s, w) { const { text, width } = clip(s, w); return text + ' '.repeat(Math.max(0, w - width)); }
function padL(s, w) {
  const width = dispWidth(s);
  return width >= w ? clip(s, w).text : ' '.repeat(w - width) + String(s);
}

function renderReport(a) {
  const L = [];
  L.push('');
  L.push('='.repeat(96));
  L.push(`  inventory 정합성 조사 — 총 ${a.total} 품목`);
  L.push('='.repeat(96));
  L.push('');
  L.push(`  정합 (손댈 것 없음)      : ${a.ok.length}`);
  L.push(`  ⚠ 불일치 (수정 대상)     : ${a.drift.length}`);
  L.push(`  ⏸ 장소 미지정 (건너뜀)   : ${a.noLocations.length}`);
  L.push(`  ✗ 값 이상 (건너뜀)       : ${a.invalid.length}`);
  L.push('');

  if (a.drift.length) {
    const withBatches = a.drift.filter((r) => r.hasBatches).length;
    const currentDrift = a.drift.filter((r) => r.fields.includes('currentStock'));
    const totalOnly = a.drift.filter((r) => !r.fields.includes('currentStock'));
    const understated = currentDrift.filter((r) => r.diffCurrent !== null && r.diffCurrent > 0);
    const overstated = currentDrift.filter((r) => r.diffCurrent !== null && r.diffCurrent < 0);
    const missingCurrent = currentDrift.filter((r) => r.diffCurrent === null);

    L.push('-'.repeat(96));
    L.push('  ⚠ 불일치 상세');
    L.push('-'.repeat(96));
    L.push(`    · currentStock 불일치      : ${currentDrift.length}`);
    L.push(`        - 실제보다 적게 표시됨  : ${understated.length}   ← 입고 탭 버그의 전형적 증상`);
    L.push(`        - 실제보다 많게 표시됨  : ${overstated.length}`);
    L.push(`        - currentStock 필드 없음: ${missingCurrent.length}`);
    L.push(`    · totalStock 만 불일치     : ${totalOnly.length}`);
    L.push(`    · batches[] 보유 품목      : ${withBatches} / ${a.drift.length}   ← 입고 탭으로 관리된 직접 증거`);
    const sumUnder = understated.reduce((s, r) => s + r.diffCurrent, 0);
    if (understated.length) L.push(`    · 누락 수량 합계           : ${fmt(+sumUnder.toFixed(3))}`);
    L.push('');

    L.push('  ' + pad('품목명', 30) + padL('현재값', 10) + padL('Σlocations', 12) + padL('차이', 11)
      + '   ' + pad('배치', 6) + padL('장소', 4) + '   ' + '수정 필드');
    L.push('  ' + '-'.repeat(94));
    const sorted = a.drift.slice().sort((x, y) => {
      const dx = x.diffCurrent === null ? Infinity : Math.abs(x.diffCurrent);
      const dy = y.diffCurrent === null ? Infinity : Math.abs(y.diffCurrent);
      return dy - dx;
    });
    for (const r of sorted) {
      const touchesCurrent = r.fields.includes('currentStock');
      const diffCell = !touchesCurrent ? '—'
        : r.diffCurrent === null ? '(필드없음)'
          : (r.diffCurrent > 0 ? '+' : '') + fmt(r.diffCurrent);
      L.push('  ' + pad(r.name, 30)
        + padL(fmt(r.currentStock), 10)
        + padL(fmt(r.sumLocations), 12)
        + padL(diffCell, 11)
        + '   ' + pad(r.hasBatches ? `${r.batchCount}건` : '-', 6)
        + padL(String(r.locationCount), 4)
        + '   ' + r.fields.join(', '));
    }
    L.push('');
  }

  if (a.noLocations.length) {
    L.push('-'.repeat(96));
    L.push('  ⏸ 장소 미지정 — 이 스크립트가 절대 건드리지 않습니다 (덮으면 재고 소실)');
    L.push('-'.repeat(96));
    for (const r of a.noLocations) {
      L.push('  ' + pad(r.name, 30) + padL(`currentStock=${fmt(r.currentStock)}`, 26)
        + padL(`totalStock=${fmt(r.totalStock)}`, 24));
    }
    L.push('');
    L.push('    → 통합앱 재고 탭에서 품목을 열어 보관 장소를 지정하시면 자동으로 정합해집니다.');
    L.push('');
  }

  if (a.invalid.length) {
    L.push('-'.repeat(96));
    L.push('  ✗ locations 값 이상 — 건너뜀. 사람이 확인해야 합니다');
    L.push('-'.repeat(96));
    for (const r of a.invalid) L.push('  ' + pad(r.name, 30) + r.reason);
    L.push('');
  }

  L.push('='.repeat(96));
  if (a.drift.length === 0) {
    L.push('  결론: 수정할 품목이 없습니다. (이미 정합하거나, 이전에 이 스크립트를 실행했습니다)');
  } else {
    L.push(`  결론: ${a.drift.length} 품목을 수정해야 합니다.`);
    L.push('  실행 명령:  node scripts/fix-currentstock.js apply --confirm');
  }
  L.push('='.repeat(96));
  L.push('');
  return L.join('\n');
}

/* ───────────────────────── Firestore 입출력 ───────────────────────── */

function loadAdmin() {
  const candidates = [
    'firebase-admin',
    path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'),
    path.join(__dirname, '..', 'node_modules', 'firebase-admin'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* 다음 후보 */ }
  }
  console.error(
    '\n✗ firebase-admin 을 찾지 못했습니다.\n' +
    '  다음 중 하나를 실행해 주세요:\n' +
    '    cd functions && npm install && cd ..\n' +
    '    (또는) npm install firebase-admin\n'
  );
  process.exit(2);
}

/**
 * admin SDK 초기화.
 *
 * 에뮬레이터를 쓸 때는 일회용 자격증명을 만들어 넣습니다. 이유가 둘 있습니다.
 *   1) firebase-admin 의 Firestore 클라이언트는 credential 이 ServiceAccountCredential
 *      인스턴스이거나 ADC 여야 합니다. 평범한 객체는 거부합니다.
 *   2) 아무것도 주지 않으면 ADC 를 찾으러 GCE 메타데이터 서버를 두드리는데,
 *      프록시 뒤 환경에서는 여기서 멈춥니다.
 * 에뮬레이터는 토큰을 검증하지 않으므로 이 키는 서명에만 쓰이고 아무 권한도 없습니다.
 */
function initAdmin(admin, projectId) {
  if (admin.apps.length) return admin;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // grpc-js 는 NO_PROXY 를 보지 않고 no_grpc_proxy 만 봅니다. 회사망처럼
    // HTTPS_PROXY 가 걸린 환경에서는 에뮬레이터(localhost) 통신까지 프록시로
    // 나가려다 멈추므로, 에뮬레이터 호스트를 예외 목록에 넣어 줍니다.
    const host = String(process.env.FIRESTORE_EMULATOR_HOST).split(':')[0];
    const skip = new Set(
      String(process.env.no_grpc_proxy || '').split(',').map((s) => s.trim()).filter(Boolean)
    );
    ['127.0.0.1', 'localhost', '::1', host].forEach((h) => skip.add(h));
    process.env.no_grpc_proxy = [...skip].join(',');

    const { generateKeyPairSync } = require('crypto');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    admin.initializeApp({
      projectId,
      credential: admin.credential.cert({
        projectId,
        clientEmail: `emulator@${projectId}.iam.gserviceaccount.com`,
        privateKey,
      }),
    });
  } else {
    admin.initializeApp({ projectId });
  }
  return admin;
}

async function fetchAll(db) {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
}

function writeBackup(docs, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `inventory-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({
    collection: COLLECTION,
    projectId: PROJECT_ID,
    exportedAt: new Date().toISOString(),
    count: docs.length,
    docs,
  }, null, 2), 'utf8');
  return file;
}

async function applyFixes(db, admin, drift) {
  let batch = db.batch();
  let ops = 0;
  let written = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };

  for (const r of drift) {
    const update = { fixedBy: 'fix-currentstock.js', fixedAt: new Date().toISOString() };
    // Σlocations 를 진실로 삼아 두 필드를 함께 맞춘다 (다른 모든 갱신 지점과 동일한 규약)
    if (r.fields.includes('currentStock')) update.currentStock = r.sumLocations;
    if (r.fields.includes('totalStock')) update.totalStock = r.sumLocations;
    batch.update(db.collection(COLLECTION).doc(r.id), update);
    written++;
    if (++ops >= BATCH_LIMIT) await flush();
  }
  await flush();
  return written;
}

/* ───────────────────────── CLI ───────────────────────── */

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0] || 'report';
  const arg = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
  };
  const has = (name) => argv.includes(name);

  if (!['report', 'apply'].includes(mode)) {
    console.error('사용법: node scripts/fix-currentstock.js [report|apply] [--confirm] [--out FILE] [--backup-dir DIR]');
    process.exit(2);
  }
  if (mode === 'apply' && !has('--confirm')) {
    console.error('\n✗ apply 는 --confirm 이 필요합니다. 먼저 report 로 확인하세요.\n' +
      '    node scripts/fix-currentstock.js report\n');
    process.exit(2);
  }

  const admin = initAdmin(loadAdmin(), PROJECT_ID);
  const db = admin.firestore();

  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `에뮬레이터 ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `프로덕션 ${PROJECT_ID}`;
  console.log(`\n대상: ${target}`);
  console.log(`모드: ${mode}${mode === 'apply' ? ' (쓰기)' : ' (읽기 전용)'}`);

  const docs = await fetchAll(db);
  const a = analyze(docs);
  const report = renderReport(a);
  console.log(report);

  const out = arg('--out', null);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      generatedAt: new Date().toISOString(),
      target,
      summary: {
        total: a.total, ok: a.ok.length, drift: a.drift.length,
        noLocations: a.noLocations.length, invalid: a.invalid.length,
      },
      drift: a.drift,
      noLocations: a.noLocations,
      invalid: a.invalid,
    }, null, 2), 'utf8');
    console.log(`보고서 저장: ${out}\n`);
  }

  if (mode === 'report') {
    console.log('※ 읽기만 했습니다. 아무것도 변경하지 않았습니다.\n');
    return;
  }

  if (!a.drift.length) {
    console.log('※ 수정할 품목이 없어 종료합니다. (멱등)\n');
    return;
  }

  const backupDir = arg('--backup-dir', path.join(__dirname, '..', 'backup'));
  const backupFile = writeBackup(docs, backupDir);
  console.log(`백업 완료: ${backupFile}  (${docs.length} 문서)\n`);

  const written = await applyFixes(db, admin, a.drift);
  console.log(`✓ ${written} 품목 수정 완료.\n`);

  // 사후 검증 — 다시 읽어서 남은 불일치가 0 인지 확인
  const after = analyze(await fetchAll(db));
  if (after.drift.length === 0) {
    console.log('✓ 검증 통과: 남은 불일치 0건.\n');
  } else {
    console.log(`✗ 검증 실패: ${after.drift.length} 품목이 여전히 불일치합니다. 백업 파일로 확인하세요.\n`);
    console.log(renderReport(after));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n✗ 실패:', e && e.message ? e.message : e);
    if (e && /credential|UNAUTHENTICATED|PERMISSION_DENIED/i.test(String(e.message))) {
      console.error('  자격증명을 확인하세요:\n' +
        '    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json\n' +
        '    (또는) gcloud auth application-default login\n');
    }
    process.exit(1);
  });
}

module.exports = { sumLocations, classifyItem, analyze, renderReport, loadAdmin, initAdmin };
