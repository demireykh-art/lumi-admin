/* ===== patients.js - LUMI ERP - 환자 CRM / 방문기록 / 시술 정가표 / 마케팅 채널 ===== */
/* Phase 1: 환자 등록 + 방문(시술) 기록 입력 + 정가표 조회 + 유입경로 채널 관리 */

// ===== Global State =====
let patients = [];          // {id, name, rrnFront, rrnGender, phone, channel, isJapanese, memo, tags[], packages[], status, firstVisitAt, createdAt}
let visits = [];            // {id, patientId, patientName, date, doctorId, assistantId, consultantId, ordererId, items[], discount, total, payMethod, isNonInsurance, consultOnly, nextReservation, memo, createdAt}
let treatmentCategories = []; // [{id, name, note, treatments:[{name, note, variants:[]}]}]
let channels = [];          // {id(name), type, monthlyCost:{ 'YYYY-MM': 원 }}

// 유입경로 기본 선택지 (정가표 확정 시점 기준)
const CHANNEL_OPTIONS = ['홈페이지', '블로그', '소개', 'SNS', '간판', '국적'];
const PAY_METHODS = ['카드', '현금', '계좌이체', '현금영수증', '기타'];

// ===== Data Loading =====
// 시술 마스터: Firestore(treatments) 우선, 없으면 로컬 시드(treatments-seed.json) 사용
async function loadTreatmentsMaster() {
    try {
        const snap = await db.collection('treatments').get();
        if (!snap.empty) {
            // Firestore 문서를 카테고리별로 그룹화
            const byCat = {};
            snap.docs.forEach(d => {
                const t = d.data();
                const cid = t.categoryId || 'etc';
                if (!byCat[cid]) byCat[cid] = { id: cid, name: t.categoryName || cid, treatments: [] };
                byCat[cid].treatments.push({ docId: d.id, name: t.name, note: t.note, variants: t.variants || [] });
            });
            treatmentCategories = Object.values(byCat);
            return;
        }
    } catch (e) { console.warn('treatments 컬렉션 로드 실패, 시드 사용:', e); }
    // 폴백: 로컬 시드 JSON
    try {
        const res = await fetch('treatments-seed.json?v=' + Date.now());
        const data = await res.json();
        treatmentCategories = (data.categories || []).map(c => ({
            id: c.id, name: c.name, note: c.note,
            treatments: (c.treatments || []).map(t => ({ name: t.name, note: t.note, variants: t.variants || [] }))
        }));
    } catch (e) { console.error('정가표 시드 로드 실패:', e); treatmentCategories = []; }
}

async function loadPatients() {
    try { const s = await db.collection('patients').get(); patients = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.error('Load patients:', e); }
}
async function loadVisits() {
    try { const s = await db.collection('visits').get(); visits = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.error('Load visits:', e); }
}
async function loadChannels() {
    try { const s = await db.collection('channels').get(); channels = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.error('Load channels:', e); }
}

// 오더 준비물품 연동: admin 레시피(recipes) + 재고(inventory) 읽기 전용 로드
let recipes = [];
let inventoryItems = [];
async function loadRecipesAndInventory() {
    try { const s = await db.collection('recipes').get(); recipes = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.warn('Load recipes:', e); recipes = []; }
    try { const s = await db.collection('inventory').get(); inventoryItems = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.warn('Load inventory:', e); inventoryItems = []; }
}
// 시술명 → 레시피의 준비물품 목록 [{name, amount, unit}]
function suppliesForTreatment(name) {
    const r = recipes.find(x => x.treatmentName === name);
    if (!r || !Array.isArray(r.ingredients)) return [];
    return r.ingredients.map(ing => {
        const it = inventoryItems.find(i => i.id === ing.itemId);
        return { name: it ? it.name : '(미등록 품목)', amount: ing.amount, unit: (it && it.unit) || '' };
    });
}
function suppliesText(supplies) {
    if (!Array.isArray(supplies) || !supplies.length) return '';
    return supplies.map(s => `${escapeHtml(s.name)}${s.amount ? ' ×' + s.amount + (s.unit || '') : ''}`).join(', ');
}

// 기본 채널 시드 (최초 1회) — 일본마케팅(국적) 월 500만원, 나머지 organic 0원
async function initDefaultChannels() {
    try {
        const snap = await db.collection('channels').limit(1).get();
        if (!snap.empty) return;
        const ym = getYM();
        const defaults = [
            { id: '홈페이지', type: 'organic' },
            { id: '블로그', type: 'organic' },
            { id: '소개', type: 'organic' },
            { id: 'SNS', type: 'organic' },
            { id: '간판', type: 'organic' },
            { id: '국적', type: 'paid', monthlyCost: { [ym]: 5000000 } } // 일본마케팅
        ];
        const batch = db.batch();
        defaults.forEach(c => {
            const { id, ...rest } = c;
            batch.set(db.collection('channels').doc(id), { type: rest.type, monthlyCost: rest.monthlyCost || {}, createdAt: new Date().toISOString() });
        });
        await batch.commit();
        await loadChannels();
        if (document.getElementById('channelTable')) renderChannels();
    } catch (e) { console.warn('기본 채널 시드 실패:', e); }
}

// ===== Helpers =====
function maskRRN(front, gender) {
    if (!front) return '-';
    return `${front}-${gender || '*'}******`;
}
// 주민번호 앞6+성별1 → 나이/성별 파생
function deriveFromRRN(front, gender) {
    if (!front || front.length < 6) return { age: '-', sex: '-' };
    const g = parseInt(gender);
    let century = 1900;
    if (g === 1 || g === 2 || g === 5 || g === 6) century = 1900;
    else if (g === 3 || g === 4 || g === 7 || g === 8) century = 2000;
    const sex = (g % 2 === 1) ? '남' : '여';
    const yy = parseInt(front.slice(0, 2)), mm = parseInt(front.slice(2, 4)), dd = parseInt(front.slice(4, 6));
    const birth = new Date(century + yy, mm - 1, dd);
    let age = new Date().getFullYear() - birth.getFullYear();
    const m = new Date().getMonth() - (mm - 1);
    if (m < 0 || (m === 0 && new Date().getDate() < dd)) age--;
    return { age: isNaN(age) ? '-' : age + '세', sex };
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function variantDesc(v) {
    return [v.product, v.dose, v.sessions, v.size, v.qty, v.region, v.label].filter(Boolean).join(' · ') || '기본';
}
function manToWon(man) { return Math.round((Number(man) || 0) * 10000); }
function empName(id) { const e = employees.find(x => x.id === id); return e ? e.name : '-'; }
function staffOptions(selected) {
    return '<option value="">선택</option>' + employees
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(e => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${escapeHtml(e.name)}${e.role ? ' (' + (roleLabels[e.role] || e.role) + ')' : ''}</option>`).join('');
}
// 환자별 방문 통계
function patientStats(pid) {
    const vs = visits.filter(v => v.patientId === pid);
    const total = vs.reduce((s, v) => s + (v.total || 0), 0);
    const dates = vs.map(v => v.date).filter(Boolean).sort();
    return { count: vs.length, total, last: dates.length ? dates[dates.length - 1] : null };
}
// 가장 최근 방문에 기록된 "다음 예약일"
function patientNextRsv(pid) {
    const vs = visits.filter(v => v.patientId === pid && v.nextReservation)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return vs.length ? vs[0].nextReservation : null;
}

// ===== 날짜/태그 유틸 =====
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysBetween(from, to) { return Math.round((new Date(to) - new Date(from)) / 86400000); }
function tagColor(t) {
    if (/VIP/i.test(t)) return '#f57f17';
    if (t.includes('주의') || t.includes('알러지') || t.includes('알레르기') || /allergy/i.test(t)) return '#d32f2f';
    return '#1976d2';
}
function tagChips(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return ' ' + tags.map(t => {
        const c = tagColor(t);
        return `<span style="font-size:.68rem;background:${c}22;color:${c};padding:1px 7px;border-radius:8px;margin-left:3px;white-space:nowrap">${escapeHtml(t)}</span>`;
    }).join('');
}
function parseTags(str) {
    return String(str || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
}
// 주민번호 → 생일(월/일)
function birthMonth(front) { return (front && front.length >= 6) ? parseInt(front.slice(2, 4)) : null; }
function birthDay(front) { return (front && front.length >= 6) ? front.slice(4, 6) : null; }

// ============================================================
//  리콜 대시보드 (page-recall) — 곧 예약 / 예약지남·미방문 / 휴면 / 생일
// ============================================================
const RECALL_DORMANT_DAYS = 90;   // 휴면 기준(일)
const RECALL_SOON_DAYS = 7;       // "곧 예약" 기준(일)

function computeRecall() {
    const today = todayStr();
    const soon = [], missed = [], dormant = [];
    patients.forEach(p => {
        const st = patientStats(p.id);
        const nextRsv = patientNextRsv(p.id);
        if (nextRsv) {
            if (nextRsv >= today) {
                const dleft = daysBetween(today, nextRsv);
                if (dleft <= RECALL_SOON_DAYS) soon.push({ p, st, nextRsv, dleft });
            } else {
                // 예약일이 지났는데 그 이후 방문 기록이 없으면 = 미방문(노쇼 의심)
                if (!st.last || st.last < nextRsv) missed.push({ p, st, nextRsv, dover: daysBetween(nextRsv, today) });
                else if (st.last && daysBetween(st.last, today) >= RECALL_DORMANT_DAYS) dormant.push({ p, st });
            }
        } else if (st.last && daysBetween(st.last, today) >= RECALL_DORMANT_DAYS) {
            dormant.push({ p, st });
        }
    });
    soon.sort((a, b) => a.nextRsv.localeCompare(b.nextRsv));
    missed.sort((a, b) => b.dover - a.dover);
    dormant.sort((a, b) => (a.st.last || '').localeCompare(b.st.last || ''));
    return { soon, missed, dormant };
}
function _recallActionCell(pid) {
    return `<td><button class="btn btn-sm btn-primary" onclick="openPatientDetail('${pid}')">상세</button></td>`;
}
function renderRecall() {
    const cards = document.getElementById('recallCards');
    if (!cards) return; // 리콜 페이지가 없는 화면이면 skip
    const { soon, missed, dormant } = computeRecall();
    cards.innerHTML = `
        <div class="card"><div class="card-label">곧 예약 (${RECALL_SOON_DAYS}일내)</div><div class="card-value">${soon.length}명</div></div>
        <div class="card"><div class="card-label">예약지남·미방문</div><div class="card-value" style="color:#d32f2f">${missed.length}명</div></div>
        <div class="card"><div class="card-label">휴면 (${RECALL_DORMANT_DAYS}일+ 미방문)</div><div class="card-value" style="color:#f57f17">${dormant.length}명</div></div>`;

    const empty = (cols, msg) => `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-secondary);padding:1.25rem">${msg}</td></tr>`;

    const tSoon = document.getElementById('recallSoon');
    if (tSoon) tSoon.innerHTML = soon.length ? soon.map(it => `<tr>
        <td><strong>${escapeHtml(it.p.name)}</strong>${tagChips(it.p.tags)}</td>
        <td>${escapeHtml(it.p.phone || '-')}</td>
        <td>${it.nextRsv} <span style="font-size:.72rem;color:#2e7d32">${it.dleft === 0 ? '오늘' : 'D-' + it.dleft}</span></td>
        ${_recallActionCell(it.p.id)}</tr>`).join('') : empty(4, '곧 예약된 환자가 없습니다.');

    const tMissed = document.getElementById('recallMissed');
    if (tMissed) tMissed.innerHTML = missed.length ? missed.map(it => `<tr>
        <td><strong>${escapeHtml(it.p.name)}</strong>${tagChips(it.p.tags)}</td>
        <td>${escapeHtml(it.p.phone || '-')}</td>
        <td>${it.nextRsv} <span style="font-size:.72rem;color:#d32f2f">${it.dover}일 지남</span></td>
        ${_recallActionCell(it.p.id)}</tr>`).join('') : empty(4, '예약일이 지난 미방문 환자가 없습니다.');

    const tDormant = document.getElementById('recallDormant');
    if (tDormant) tDormant.innerHTML = dormant.length ? dormant.map(it => `<tr>
        <td><strong>${escapeHtml(it.p.name)}</strong>${tagChips(it.p.tags)}</td>
        <td>${escapeHtml(it.p.phone || '-')}</td>
        <td>${it.st.last || '-'} <span style="font-size:.72rem;color:#f57f17">${it.st.last ? daysBetween(it.st.last, todayStr()) + '일 전' : ''}</span></td>
        ${_recallActionCell(it.p.id)}</tr>`).join('') : empty(4, '휴면 환자가 없습니다.');
}
// 이번 달 생일 고객
function renderBirthdays() {
    const tbody = document.getElementById('birthdayTable');
    if (!tbody) return;
    const m = new Date().getMonth() + 1;
    const cnt = document.getElementById('birthdayCount');
    const list = patients.filter(p => birthMonth(p.rrnFront) === m)
        .sort((a, b) => (birthDay(a.rrnFront) || '').localeCompare(birthDay(b.rrnFront) || ''));
    if (cnt) cnt.textContent = `${m}월 · ${list.length}명`;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.25rem">이번 달 생일 고객이 없습니다.</td></tr>'; return; }
    tbody.innerHTML = list.map(p => {
        const d = deriveFromRRN(p.rrnFront, p.rrnGender);
        const mmdd = `${String(birthMonth(p.rrnFront)).padStart(2, '0')}-${birthDay(p.rrnFront)}`;
        return `<tr>
            <td><strong>${escapeHtml(p.name)}</strong>${tagChips(p.tags)}</td>
            <td>🎂 ${mmdd}</td>
            <td>${d.sex} / ${d.age}</td>
            <td>${escapeHtml(p.phone || '-')} <button class="btn btn-sm btn-outline" style="margin-left:.25rem" onclick="openPatientDetail('${p.id}')">상세</button></td>
        </tr>`;
    }).join('');
}

// 회원권 차감/복원 (방문 저장/삭제 시 호출)
async function _adjustPackage(pid, pkgId, delta) {
    if (!pid || !pkgId) return;
    const p = patients.find(x => x.id === pid);
    if (!p || !Array.isArray(p.packages)) return;
    const pk = p.packages.find(k => k.id === pkgId);
    if (!pk) return;
    pk.used = Math.max(0, (pk.used || 0) + delta);
    try { await db.collection('patients').doc(pid).update({ packages: p.packages }); await loadPatients(); }
    catch (e) { console.warn('회원권 갱신 실패:', e); }
}

// ============================================================
//  환자 목록 (sub-crm-patients)
// ============================================================
function renderPatients() {
    const tbody = document.getElementById('patientTable');
    if (!tbody) return;
    const q = (document.getElementById('patientSearch')?.value || '').trim().toLowerCase();
    const chFilter = document.getElementById('patientChannelFilter')?.value || '';
    let list = patients.slice();
    if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q));
    if (chFilter) list = list.filter(p => p.channel === chFilter);
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // 상단 요약 카드
    const cards = document.getElementById('patientCards');
    if (cards) {
        const newThisMonth = patients.filter(p => (p.firstVisitAt || p.createdAt || '').startsWith(getYM())).length;
        const jp = patients.filter(p => p.isJapanese).length;
        cards.innerHTML = `
            <div class="card"><div class="card-label">총 환자</div><div class="card-value">${formatNumber(patients.length)}명</div></div>
            <div class="card"><div class="card-label">이번달 신환</div><div class="card-value">${formatNumber(newThisMonth)}명</div></div>
            <div class="card"><div class="card-label">일본인 환자</div><div class="card-value">${formatNumber(jp)}명</div></div>
            <div class="card"><div class="card-label">누적 방문건수</div><div class="card-value">${formatNumber(visits.length)}건</div></div>`;
    }

    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:2rem">등록된 환자가 없습니다.</td></tr>'; return; }
    tbody.innerHTML = list.map(p => {
        const d = deriveFromRRN(p.rrnFront, p.rrnGender);
        const st = patientStats(p.id);
        return `<tr>
            <td><strong>${escapeHtml(p.name)}</strong>${p.isJapanese ? ' <span style="font-size:.7rem;background:rgba(25,118,210,.1);color:#1976d2;padding:1px 6px;border-radius:8px">JP</span>' : ''}${tagChips(p.tags)}<div style="font-size:.7rem;color:var(--text-muted)">${maskRRN(p.rrnFront, p.rrnGender)}</div></td>
            <td>${d.sex} / ${d.age}</td>
            <td>${escapeHtml(p.phone || '-')}</td>
            <td>${escapeHtml(p.channel || '-')}</td>
            <td class="text-right">${formatNumber(st.count)}</td>
            <td class="text-right">${formatCurrency(st.total)}</td>
            <td>${st.last || '-'}</td>
            <td><div class="btn-group">
                <button class="btn btn-sm btn-primary" onclick="openPatientDetail('${p.id}')">상세</button>
                <button class="btn btn-sm btn-outline" onclick="openPatientModal('${p.id}')">수정</button>
                <button class="btn btn-sm btn-danger" onclick="deletePatient('${p.id}')">삭제</button>
            </div></td>
        </tr>`;
    }).join('');
}

// ===== 환자 등록/수정 모달 =====
function openPatientModal(id = null) {
    document.getElementById('patientModalTitle').textContent = id ? '환자 수정' : '환자 등록';
    document.getElementById('patientEditId').value = id || '';
    const chSel = document.getElementById('patChannel');
    chSel.innerHTML = '<option value="">선택</option>' + CHANNEL_OPTIONS.map(c => `<option value="${c}">${c}</option>`).join('');
    const p = id ? patients.find(x => x.id === id) : null;
    document.getElementById('patName').value = p?.name || '';
    document.getElementById('patRrnFront').value = p?.rrnFront || '';
    document.getElementById('patRrnGender').value = p?.rrnGender || '';
    document.getElementById('patPhone').value = p?.phone || '';
    document.getElementById('patChannel').value = p?.channel || '';
    document.getElementById('patIsJapanese').checked = !!p?.isJapanese;
    document.getElementById('patMemo').value = p?.memo || '';
    const tagsEl = document.getElementById('patTags');
    if (tagsEl) tagsEl.value = (p?.tags || []).join(', ');
    _patPackages = p?.packages ? JSON.parse(JSON.stringify(p.packages)) : [];
    renderPatPackages();
    openModal('patientModal');
}
// ===== 회원권/선불 패키지 편집 (환자 모달) =====
let _patPackages = [];
function addPatPackage() {
    const nameEl = document.getElementById('patPkgName');
    const totalEl = document.getElementById('patPkgTotal');
    const name = nameEl.value.trim();
    const total = parseInt(totalEl.value) || 0;
    if (!name || total <= 0) { alert('회원권 이름과 총 횟수를 입력하세요.'); return; }
    _patPackages.push({ id: 'pkg' + Date.now(), name, total, used: 0 });
    nameEl.value = ''; totalEl.value = '';
    renderPatPackages();
}
function removePatPackage(idx) { _patPackages.splice(idx, 1); renderPatPackages(); }
function renderPatPackages() {
    const wrap = document.getElementById('patPkgList');
    if (!wrap) return;
    if (!_patPackages.length) { wrap.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted)">등록된 회원권이 없습니다.</div>'; return; }
    wrap.innerHTML = _patPackages.map((pk, i) => {
        const rem = (pk.total - (pk.used || 0));
        return `<div style="display:flex;align-items:center;gap:.5rem;font-size:.85rem;padding:.25rem 0;border-bottom:1px dashed var(--border,#eee)">
            <span style="flex:1">${escapeHtml(pk.name)} — <strong style="color:${rem > 0 ? '#2e7d32' : '#d32f2f'}">${rem}/${pk.total}회</strong> 남음</span>
            <button class="btn btn-sm btn-danger" onclick="removePatPackage(${i})">삭제</button>
        </div>`;
    }).join('');
}
async function savePatient() {
    const id = document.getElementById('patientEditId').value;
    const name = document.getElementById('patName').value.trim();
    if (!name) { alert('이름을 입력하세요.'); return; }
    const rrnFront = document.getElementById('patRrnFront').value.trim();
    if (rrnFront && !/^\d{6}$/.test(rrnFront)) { alert('주민번호 앞자리는 숫자 6자리여야 합니다.'); return; }
    const rrnGender = document.getElementById('patRrnGender').value.trim();
    if (rrnGender && !/^\d$/.test(rrnGender)) { alert('주민번호 뒷 1자리는 숫자 1자리여야 합니다.'); return; }
    const data = {
        name,
        rrnFront,
        rrnGender,
        phone: document.getElementById('patPhone').value.trim(),
        channel: document.getElementById('patChannel').value,
        isJapanese: document.getElementById('patIsJapanese').checked,
        memo: document.getElementById('patMemo').value.trim(),
        tags: parseTags(document.getElementById('patTags')?.value),
        packages: _patPackages
    };
    try {
        const me = (typeof currentCrmUser !== 'undefined' && currentCrmUser) ? currentCrmUser : null;
        if (id) {
            if (me) data.updatedBy = me.id;
            await db.collection('patients').doc(id).update(data);
        }
        else {
            data.createdAt = new Date().toISOString();
            data.firstVisitAt = data.createdAt;
            data.status = 'active';
            if (me) { data.createdBy = me.id; data.createdByName = me.name; }
            await db.collection('patients').add(data);
        }
        closeModal('patientModal');
        await loadPatients();
        renderPatients(); renderRecall(); renderBirthdays();
    } catch (e) { alert('저장 실패: ' + e.message); }
}
async function deletePatient(id) {
    const vs = visits.filter(v => v.patientId === id);
    if (!confirm(`이 환자를 삭제하시겠습니까?${vs.length ? '\n방문기록 ' + vs.length + '건도 함께 삭제됩니다.' : ''}`)) return;
    try {
        const batch = db.batch();
        batch.delete(db.collection('patients').doc(id));
        vs.forEach(v => batch.delete(db.collection('visits').doc(v.id)));
        await batch.commit();
        await Promise.all([loadPatients(), loadVisits()]);
        renderPatients(); renderRecall(); renderBirthdays();
    } catch (e) { alert('삭제 실패: ' + e.message); }
}

// ============================================================
//  환자 상세 + 방문기록 (patientDetailModal)
// ============================================================
let _detailPatientId = null;
function openPatientDetail(pid) {
    _detailPatientId = pid;
    const p = patients.find(x => x.id === pid);
    if (!p) return;
    const d = deriveFromRRN(p.rrnFront, p.rrnGender);
    const st = patientStats(pid);
    document.getElementById('detailTitle').textContent = `${p.name} 님`;
    renderDetailHeader();
    const setv = (id, val) => { const e = document.getElementById(id); if (e) e.value = val || ''; };
    setv('detailComplaint', p.chiefComplaint);
    setv('detailMemo', p.memo);
    setv('detailEtc', p.etcMemo);
    const msg = document.getElementById('detailSaveMsg'); if (msg) msg.textContent = '';
    renderPatientVisits();
    openVisitModal(pid, null);          // 차팅 입력폼 초기화(새 차팅)
    openModal('patientDetailModal');
    autoGrowAll();                      // 모달 표시 후 textarea 높이 보정
}
// 워크스페이스 상단 환자정보 바
function renderDetailHeader() {
    const hdr = document.getElementById('detailHeaderInfo');
    const p = patients.find(x => x.id === _detailPatientId);
    if (!hdr || !p) return;
    const d = deriveFromRRN(p.rrnFront, p.rrnGender);
    const st = patientStats(p.id);
    const pkgs = (Array.isArray(p.packages) ? p.packages : []).map(pk => { const rem = pk.total - (pk.used || 0); return `<span style="background:${rem > 0 ? 'rgba(46,125,50,.1)' : 'rgba(211,47,47,.1)'};color:${rem > 0 ? '#2e7d32' : '#d32f2f'};padding:1px 8px;border-radius:8px;font-size:.72rem">${escapeHtml(pk.name)} ${rem}/${pk.total}회</span>`; }).join('');
    hdr.innerHTML = `
        <span><strong style="color:#1F2533">No.</strong> ${escapeHtml(p.id.slice(-6))}</span>
        <span>${maskRRN(p.rrnFront, p.rrnGender)}</span>
        <span>📞 ${escapeHtml(p.phone || '-')}</span>
        <span>${d.sex} / ${d.age}</span>
        <span>방문 ${st.count}건 · ${formatCurrency(st.total)}</span>
        ${p.isJapanese ? '<span style="background:rgba(25,118,210,.1);color:#1976d2;padding:1px 7px;border-radius:8px;font-size:.72rem">일본인</span>' : ''}
        ${tagChips(p.tags)}${pkgs}`;
}
// 차팅 입력폼을 새 차팅 상태로 초기화 (워크스페이스 유지)
function resetChartEntry() { if (_detailPatientId) openVisitModal(_detailPatientId, null); }
// 주소증/메모/기타 저장
async function saveDetailNotes() {
    if (!_detailPatientId) return;
    const data = {
        chiefComplaint: (document.getElementById('detailComplaint')?.value || '').trim(),
        memo: (document.getElementById('detailMemo')?.value || '').trim(),
        etcMemo: (document.getElementById('detailEtc')?.value || '').trim()
    };
    try {
        await db.collection('patients').doc(_detailPatientId).update(data);
        await loadPatients();
        renderPatients(); renderRecall(); renderBirthdays();
        const msg = document.getElementById('detailSaveMsg'); if (msg) { msg.textContent = '✓ 저장되었습니다'; msg.style.color = '#16A34A'; }
    } catch (e) { alert('저장 실패: ' + e.message); }
}
function renderPatientVisits() {
    const wrap = document.getElementById('detailVisitList');
    if (!wrap) return;
    const vs = visits.filter(v => v.patientId === _detailPatientId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!vs.length) { wrap.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:1rem 0;text-align:center">차팅 기록이 없습니다.</div>'; return; }
    wrap.innerHTML = vs.map(v => {
        const items = (v.items || []).map(it => `${escapeHtml(it.treatmentName)}${it.variant ? ' (' + escapeHtml(it.variant) + ')' : ''} ×${it.qty || 1}${it.staffName ? ' <span style="color:var(--text-muted);font-size:.72rem">[' + escapeHtml(it.staffName) + ']</span>' : ''}`).join('<br>');
        const doc = v.doctorId ? empName(v.doctorId) : '';
        const notes = [v.doctorNote && '🩺 ' + v.doctorNote, v.consultNote && '💬 ' + v.consultNote, v.staffNote && '🧑‍⚕️ ' + v.staffNote].filter(Boolean).map(escapeHtml).join('<br>');
        return `<div style="border:1px solid #E9EAF0;border-radius:9px;padding:.55rem .6rem;margin-bottom:.5rem;background:#fff">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <strong style="font-size:.82rem">${v.date || '-'}</strong>
                <span style="font-size:.74rem;color:var(--text-muted)">${escapeHtml(doc)}${v.consultOnly ? ' · 상담만' : ''}</span>
            </div>
            ${v.diagnosis ? `<div style="font-size:.76rem;color:#16A34A;margin-top:.2rem">🩺 ${escapeHtml(v.diagnosis)}</div>` : ''}
            <div style="font-size:.78rem;margin-top:.25rem;line-height:1.5">${items || '<span style="color:var(--text-muted)">시술 없음</span>'}</div>
            ${notes ? `<div style="font-size:.72rem;color:var(--text-secondary);margin-top:.25rem;line-height:1.5">${notes}</div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.4rem">
                <span style="font-weight:700;font-size:.82rem;color:#4F46E5">${formatCurrency(v.total || 0)} <span style="font-weight:400;font-size:.72rem;color:var(--text-muted)">${escapeHtml(v.payMethod || '')}</span></span>
                <span><button class="btn btn-sm btn-outline" onclick="openVisitModal('${_detailPatientId}','${v.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteVisit('${v.id}')">삭제</button></span>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
//  방문(시술) 기록 입력 모달 (visitModal)
// ============================================================
let _visitItems = []; // 임시 시술 항목 [{treatmentName, variant, unitPrice(원), qty, lineTotal}]
function openVisitModal(pid, vid = null) {
    const p = patients.find(x => x.id === pid);
    if (!p) return;
    document.getElementById('visitPatientId').value = pid;
    document.getElementById('visitEditId').value = vid || '';
    document.getElementById('visitModalTitle').textContent = `${p.name} 님 · ${vid ? '방문기록 수정' : '방문기록 입력'}`;

    // 역할별 담당자 select 채우기 (의료진/상담/스탭 + 오더 라인별 담당자)
    ['visitDoctor', 'visitAssistant', 'visitConsultant', 'visitItemStaff'].forEach(elId => {
        const el = document.getElementById(elId);
        if (el) el.innerHTML = staffOptions('');
    });
    // 시술 카테고리 select
    const catSel = document.getElementById('visitCatSel');
    catSel.innerHTML = '<option value="">카테고리 선택</option>' + treatmentCategories.map((c, i) => `<option value="${i}">${escapeHtml(c.name)}</option>`).join('');
    document.getElementById('visitTreatSel').innerHTML = '<option value="">시술 선택</option>';
    document.getElementById('visitVarSel').innerHTML = '<option value="">옵션 선택</option>';

    // 결제수단
    document.getElementById('visitPayMethod').innerHTML = PAY_METHODS.map(m => `<option value="${m}">${m}</option>`).join('');

    // 회원권 차감 select (신규 방문에서만, 잔여>0 인 것만)
    const pkgRow = document.getElementById('visitPkgRow');
    const pkgSel = document.getElementById('visitPkgSel');
    if (pkgRow && pkgSel) {
        const avail = (p.packages || []).filter(pk => (pk.total - (pk.used || 0)) > 0);
        if (!vid && avail.length) {
            pkgRow.style.display = '';
            pkgSel.innerHTML = '<option value="">회원권 차감 안 함</option>' +
                avail.map(pk => `<option value="${pk.id}">${escapeHtml(pk.name)} (${pk.total - (pk.used || 0)}회 남음)</option>`).join('');
        } else {
            pkgRow.style.display = 'none';
            pkgSel.innerHTML = '';
        }
    }

    const v = vid ? visits.find(x => x.id === vid) : null;
    document.getElementById('visitDate').value = v?.date || new Date().toISOString().slice(0, 10);
    // 의료진: 기존 차팅이면 그 값, 새 차팅이면 로그인 계정으로 기본 선택
    document.getElementById('visitDoctor').value = v?.doctorId || ((typeof currentCrmUser !== 'undefined' && currentCrmUser) ? currentCrmUser.id : '');
    document.getElementById('visitAssistant').value = v?.assistantId || '';
    document.getElementById('visitConsultant').value = v?.consultantId || '';
    // 역할별 차팅 메모
    const setNote = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
    setNote('visitDoctorNote', v?.doctorNote);
    setNote('visitConsultNote', v?.consultNote);
    setNote('visitStaffNote', v?.staffNote);
    setNote('visitDiagnosis', v?.diagnosis);
    const setSearch = document.getElementById('visitSetSearch');
    if (setSearch) setSearch.value = '';
    renderVisitSets();
    document.getElementById('visitPayMethod').value = v?.payMethod || '카드';
    document.getElementById('visitDiscount').value = v?.discount ? v.discount / 10000 : '';
    document.getElementById('visitConsultOnly').checked = !!v?.consultOnly;
    document.getElementById('visitNextRsv').value = v?.nextReservation || '';
    document.getElementById('visitMemo').value = v?.memo || '';
    _visitItems = v ? JSON.parse(JSON.stringify(v.items || [])) : [];
    renderVisitItems();
    autoGrowAll();
}
// 차팅 textarea 줄바꿈 + 글자에 맞춰 자동 확장
function autoGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
function autoGrowAll() { document.querySelectorAll('#patientDetailModal textarea.auto-grow').forEach(autoGrow); }
// 카테고리 → 시술 → 옵션 캐스케이드
function onVisitCatChange() {
    const ci = document.getElementById('visitCatSel').value;
    const tSel = document.getElementById('visitTreatSel');
    const vSel = document.getElementById('visitVarSel');
    vSel.innerHTML = '<option value="">옵션 선택</option>';
    if (ci === '') { tSel.innerHTML = '<option value="">시술 선택</option>'; return; }
    const cat = treatmentCategories[ci];
    tSel.innerHTML = '<option value="">시술 선택</option>' + cat.treatments.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('');
}
function onVisitTreatChange() {
    const ci = document.getElementById('visitCatSel').value;
    const ti = document.getElementById('visitTreatSel').value;
    const vSel = document.getElementById('visitVarSel');
    if (ci === '' || ti === '') { vSel.innerHTML = '<option value="">옵션 선택</option>'; return; }
    const t = treatmentCategories[ci].treatments[ti];
    vSel.innerHTML = '<option value="">옵션 선택</option>' + (t.variants || []).map((v, i) => `<option value="${i}">${escapeHtml(variantDesc(v))} — ${v.price}만원</option>`).join('');
}
function addVisitItem() {
    const ci = document.getElementById('visitCatSel').value;
    const ti = document.getElementById('visitTreatSel').value;
    const vi = document.getElementById('visitVarSel').value;
    const qty = parseInt(document.getElementById('visitQty').value) || 1;
    if (ci === '' || ti === '' || vi === '') { alert('카테고리 · 시술 · 옵션을 모두 선택하세요.'); return; }
    const t = treatmentCategories[ci].treatments[ti];
    const v = t.variants[vi];
    let unitPrice = manToWon(v.price);
    if (typeof feeOverridePrice === 'function') { const o = feeOverridePrice(treatmentCategories[ci].id, t.name, variantDesc(v)); if (o != null) unitPrice = o; }
    const staffId = document.getElementById('visitItemStaff')?.value || '';
    const supplies = suppliesForTreatment(t.name); // admin 레시피 준비물품 스냅샷
    _visitItems.push({
        treatmentName: t.name, variant: variantDesc(v), unitPrice, qty, lineTotal: unitPrice * qty,
        staffId, staffName: staffId ? empName(staffId) : '', supplies
    });
    document.getElementById('visitQty').value = 1;
    renderVisitItems();
}
function removeVisitItem(idx) { _visitItems.splice(idx, 1); renderVisitItems(); }
// 오른쪽 "시술 세트" 빠른추가 패널 (베가스 세트 미리보기 형태)
function renderVisitSets() {
    const wrap = document.getElementById('visitSetList');
    if (!wrap) return;
    const q = (document.getElementById('visitSetSearch')?.value || '').trim().toLowerCase();
    let html = '';
    treatmentCategories.forEach((c, ci) => {
        const matched = c.treatments.map((t, ti) => ({ t, ti })).filter(({ t }) => !q || t.name.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q));
        if (!matched.length) return;
        html += `<div class="set-cat">${escapeHtml(c.name)}</div>`;
        matched.forEach(({ t, ti }) => {
            (t.variants || []).forEach((v, vi) => {
                html += `<div class="set-item" onclick="quickAddItem(${ci},${ti},${vi})" title="클릭하면 오더에 추가">
                    <span>${escapeHtml(t.name)} <span style="color:var(--text-muted)">${escapeHtml(variantDesc(v))}</span></span>
                    <span style="color:#1976d2;white-space:nowrap">${v.price}만</span></div>`;
            });
        });
    });
    wrap.innerHTML = html || '<div style="font-size:.8rem;color:var(--text-muted);padding:1rem 0">검색 결과 없음</div>';
}
function quickAddItem(ci, ti, vi) {
    const t = treatmentCategories[ci]?.treatments[ti];
    const v = t?.variants[vi];
    if (!v) return;
    let unitPrice = manToWon(v.price);
    if (typeof feeOverridePrice === 'function') { const o = feeOverridePrice(treatmentCategories[ci].id, t.name, variantDesc(v)); if (o != null) unitPrice = o; }
    const staffId = document.getElementById('visitItemStaff')?.value || '';
    const supplies = suppliesForTreatment(t.name);
    _visitItems.push({ treatmentName: t.name, variant: variantDesc(v), unitPrice, qty: 1, lineTotal: unitPrice, staffId, staffName: staffId ? empName(staffId) : '', supplies });
    renderVisitItems();
}
function renderVisitItems() {
    const tbody = document.getElementById('visitItemTable');
    if (!tbody) return;
    if (!_visitItems.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1rem">추가된 오더가 없습니다.</td></tr>';
    } else {
        tbody.innerHTML = _visitItems.map((it, i) => {
            const sup = suppliesText(it.supplies);
            return `<tr>
            <td>${escapeHtml(it.treatmentName)}<div style="font-size:.72rem;color:var(--text-secondary)">${escapeHtml(it.variant || '')}</div></td>
            <td style="font-size:.8rem">${it.staffName ? escapeHtml(it.staffName) : '<span style="color:var(--text-muted)">미지정</span>'}</td>
            <td style="font-size:.72rem;color:#1976d2;max-width:200px">${sup || '<span style="color:var(--text-muted)">레시피 없음</span>'}</td>
            <td class="text-right">${formatCurrency(it.unitPrice)}</td>
            <td class="text-right">${it.qty}</td>
            <td class="text-right">${formatCurrency(it.lineTotal)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="removeVisitItem(${i})">×</button></td>
        </tr>`;
        }).join('');
    }
    updateVisitTotal();
}
function updateVisitTotal() {
    const sum = _visitItems.reduce((s, it) => s + (it.lineTotal || 0), 0);
    const disc = manToWon(document.getElementById('visitDiscount')?.value || 0);
    const total = Math.max(0, sum - disc);
    const el = document.getElementById('visitTotalDisplay');
    if (el) el.textContent = `합계 ${formatCurrency(sum)} − 할인 ${formatCurrency(disc)} = ${formatCurrency(total)} (VAT 별도)`;
}
async function saveVisit() {
    const pid = document.getElementById('visitPatientId').value;
    const vid = document.getElementById('visitEditId').value;
    const consultOnly = document.getElementById('visitConsultOnly').checked;
    if (!_visitItems.length && !consultOnly) { alert('시술 항목을 추가하거나 "상담만"을 체크하세요.'); return; }
    const p = patients.find(x => x.id === pid);
    const sum = _visitItems.reduce((s, it) => s + (it.lineTotal || 0), 0);
    const discount = manToWon(document.getElementById('visitDiscount').value || 0);
    const data = {
        patientId: pid,
        patientName: p?.name || '',
        date: document.getElementById('visitDate').value,
        doctorId: document.getElementById('visitDoctor').value,
        assistantId: document.getElementById('visitAssistant').value,
        consultantId: document.getElementById('visitConsultant').value,
        doctorNote: (document.getElementById('visitDoctorNote')?.value || '').trim(),
        consultNote: (document.getElementById('visitConsultNote')?.value || '').trim(),
        staffNote: (document.getElementById('visitStaffNote')?.value || '').trim(),
        diagnosis: (document.getElementById('visitDiagnosis')?.value || '').trim(),
        items: _visitItems,
        discount,
        total: Math.max(0, sum - discount),
        payMethod: document.getElementById('visitPayMethod').value,
        isNonInsurance: true,
        consultOnly,
        nextReservation: document.getElementById('visitNextRsv').value,
        memo: document.getElementById('visitMemo').value.trim()
    };
    if (!data.date) { alert('방문일을 선택하세요.'); return; }
    // 회원권 차감은 신규 방문에서만
    const pkgId = (!vid && document.getElementById('visitPkgSel')) ? document.getElementById('visitPkgSel').value : '';
    if (pkgId) data.packageId = pkgId;
    const me = (typeof currentCrmUser !== 'undefined' && currentCrmUser) ? currentCrmUser : null;
    try {
        if (vid) {
            if (me) data.updatedBy = me.id;
            await db.collection('visits').doc(vid).update(data);
        }
        else {
            data.createdAt = new Date().toISOString();
            if (me) { data.chartedBy = me.id; data.chartedByName = me.name; }
            await db.collection('visits').add(data);
            if (pkgId) await _adjustPackage(pid, pkgId, +1);
        }
        await loadVisits();
        renderPatients(); renderRecall(); renderBirthdays(); renderBoard();
        renderPatientVisits();      // Progress Note 갱신
        renderDetailHeader();       // 방문/매출 헤더 갱신
        resetChartEntry();          // 입력폼을 새 차팅으로 비움(워크스페이스 유지)
        alert('차팅이 저장되었습니다.');
    } catch (e) { alert('저장 실패: ' + e.message); }
}
async function deleteVisit(id) {
    if (!confirm('이 방문기록을 삭제하시겠습니까?')) return;
    const v = visits.find(x => x.id === id);
    try {
        await db.collection('visits').doc(id).delete();
        if (v && v.packageId) await _adjustPackage(v.patientId, v.packageId, -1); // 차감 복원
        await loadVisits();
        renderPatients(); renderRecall(); renderBirthdays(); renderBoard();
        if (_detailPatientId) { renderPatientVisits(); renderDetailHeader(); }
    } catch (e) { alert('삭제 실패: ' + e.message); }
}

// ============================================================
//  시술 정가표 조회 (sub-crm-pricelist)
// ============================================================
function renderPriceList() {
    const wrap = document.getElementById('priceListWrap');
    if (!wrap) return;
    if (!treatmentCategories.length) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:2rem;text-align:center">정가표를 불러오지 못했습니다.</div>'; return; }
    const q = (document.getElementById('priceSearch')?.value || '').trim().toLowerCase();
    wrap.innerHTML = treatmentCategories.map(c => {
        const rows = c.treatments.filter(t => !q || t.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).map(t => {
            const vrows = (t.variants || []).map(v => `<tr>
                <td style="padding-left:1.5rem;color:var(--text-secondary);font-size:.85rem">${escapeHtml(variantDesc(v))}</td>
                <td class="text-right">${v.price}만원</td>
                <td class="text-right" style="color:var(--text-muted);font-size:.8rem">${formatCurrency(manToWon(v.price))}</td>
            </tr>`).join('');
            return `<tr><td colspan="3" style="font-weight:700;background:var(--bg,#fafafa);padding-top:.6rem">${escapeHtml(t.name)}${t.note ? ` <span style="font-weight:400;font-size:.75rem;color:var(--text-muted)">(${escapeHtml(t.note)})</span>` : ''}</td></tr>${vrows}`;
        }).join('');
        if (!rows) return '';
        return `<div class="section" style="margin-bottom:1.25rem">
            <div class="section-header"><div class="section-title">${escapeHtml(c.name)}${c.note ? ` <span style="font-size:.75rem;font-weight:400;color:var(--text-muted)">${escapeHtml(c.note)}</span>` : ''}</div></div>
            <div class="table-container"><table><thead><tr><th>시술 / 옵션</th><th class="text-right">정가(만원)</th><th class="text-right">원(₩)</th></tr></thead><tbody>${rows}</tbody></table></div>
        </div>`;
    }).join('');
}

// ============================================================
//  마케팅 채널 (sub-crm-channels)
// ============================================================
function renderChannels() {
    const tbody = document.getElementById('channelTable');
    if (!tbody) return;
    const ym = getYM();
    // 채널별 이번달 신규 유입 + 매출(유입경로 기준)
    const byChannel = {};
    CHANNEL_OPTIONS.forEach(c => byChannel[c] = { newPatients: 0, revenue: 0 });
    patients.forEach(p => {
        if (!p.channel || !(p.channel in byChannel)) return;
        if ((p.firstVisitAt || p.createdAt || '').startsWith(ym)) byChannel[p.channel].newPatients++;
    });
    visits.forEach(v => {
        if (!(v.date || '').startsWith(ym)) return;
        const p = patients.find(x => x.id === v.patientId);
        if (p && p.channel in byChannel) byChannel[p.channel].revenue += (v.total || 0);
    });
    tbody.innerHTML = CHANNEL_OPTIONS.map(name => {
        const ch = channels.find(c => c.id === name) || { type: 'organic', monthlyCost: {} };
        const cost = (ch.monthlyCost && ch.monthlyCost[ym]) || 0;
        const stat = byChannel[name];
        const cac = stat.newPatients ? Math.round(cost / stat.newPatients) : 0;
        const roas = cost ? (stat.revenue / cost) : 0;
        return `<tr>
            <td><strong>${name}</strong> <span style="font-size:.7rem;padding:1px 6px;border-radius:8px;background:${ch.type === 'paid' ? 'rgba(245,127,23,.12);color:#f57f17' : 'rgba(46,125,50,.1);color:#2e7d32'}">${ch.type === 'paid' ? '유료' : '무료'}</span></td>
            <td class="text-right"><input type="number" class="form-input" style="width:120px;text-align:right" value="${cost}" onchange="saveChannelCost('${name}',this.value)"> 원</td>
            <td class="text-right">${formatNumber(stat.newPatients)}명</td>
            <td class="text-right">${cost && stat.newPatients ? formatCurrency(cac) : '-'}</td>
            <td class="text-right">${formatCurrency(stat.revenue)}</td>
            <td class="text-right">${cost ? roas.toFixed(1) + 'x' : '-'}</td>
        </tr>`;
    }).join('');
}
async function saveChannelCost(name, val) {
    const ym = getYM();
    const cost = parseInt(val) || 0;
    try {
        await db.collection('channels').doc(name).set({ monthlyCost: { [ym]: cost }, type: name === '국적' ? 'paid' : 'organic' }, { merge: true });
        await loadChannels();
        renderChannels();
    } catch (e) { alert('저장 실패: ' + e.message); }
}

// ===== CRM 통합 렌더 (renderAll에서 호출) =====
function renderCRM() {
    renderPatients();
    renderRecall();
    renderBirthdays();
    renderPriceList();
    renderChannels();
    renderBoard();
    renderNotices();
}

// ============================================================
//  당일 현황판 (예약 · 접수 · 완료/수납)
// ============================================================
let _boardDate = new Date().toISOString().slice(0, 10);
function boardShift(d) { const dt = new Date(_boardDate); dt.setDate(dt.getDate() + d); _boardDate = dt.toISOString().slice(0, 10); renderBoard(); }
function boardToday() { _boardDate = new Date().toISOString().slice(0, 10); renderBoard(); }
function _boardSet(listId, cntId, arr, cardFn, empty) {
    const l = document.getElementById(listId), c = document.getElementById(cntId);
    if (c) c.textContent = arr.length;
    if (l) l.innerHTML = arr.length ? arr.map(cardFn).join('') : `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">${empty}</div>`;
}
function renderBoard() {
    const lbl = document.getElementById('boardDateLabel');
    if (!lbl) return;
    const dt = new Date(_boardDate);
    const wd = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
    lbl.textContent = `${_boardDate} (${wd})`;
    const resv = visits.filter(v => v.nextReservation === _boardDate);
    const done = visits.filter(v => v.date === _boardDate).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const pInfo = pid => { const p = patients.find(x => x.id === pid); return p ? { p, d: deriveFromRRN(p.rrnFront, p.rrnGender) } : { p: null, d: { sex: '', age: '' } }; };
    const cardResv = v => {
        const { p, d } = pInfo(v.patientId);
        return `<div class="board-card" onclick="openPatientDetail('${v.patientId}')">
            <strong>${escapeHtml(v.patientName || (p && p.name) || '-')}</strong> <span class="board-sub">${d.sex}/${d.age}</span>
            <div class="board-sub">${escapeHtml((p && p.phone) || '')}${v.doctorId ? ' · ' + escapeHtml(empName(v.doctorId)) : ''}</div>
            ${v.memo ? `<div class="board-sub" style="color:#4F46E5">${escapeHtml(v.memo)}</div>` : ''}
        </div>`;
    };
    const cardDone = v => {
        const { p } = pInfo(v.patientId);
        const items = (v.items || []).map(it => escapeHtml(it.treatmentName)).join(', ');
        return `<div class="board-card done" onclick="openPatientDetail('${v.patientId}')">
            <div style="display:flex;justify-content:space-between;gap:.5rem"><strong>${escapeHtml(v.patientName || (p && p.name) || '-')}</strong><span style="color:#16A34A;font-weight:700">${formatCurrency(v.total || 0)}</span></div>
            <div class="board-sub">${items || (v.consultOnly ? '상담만' : '-')}${v.doctorId ? ' · ' + escapeHtml(empName(v.doctorId)) : ''}${v.payMethod ? ' · ' + escapeHtml(v.payMethod) : ''}</div>
        </div>`;
    };
    _boardSet('boardResv', 'boardResvCount', resv, cardResv, '예약된 환자가 없습니다.');
    _boardSet('boardWait', 'boardWaitCount', [], null, '대기 중인 접수가 없습니다.');
    _boardSet('boardDone', 'boardDoneCount', done, cardDone, '완료·수납 내역이 없습니다.');
}

// ============================================================
//  병원 공지
// ============================================================
let notices = [];
async function loadNotices() {
    try { const s = await db.collection('notices').orderBy('createdAt', 'desc').limit(80).get(); notices = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.warn('공지 로드 실패:', e); notices = []; }
}
function renderNotices() {
    const wrap = document.getElementById('noticeList');
    if (!wrap) return;
    if (!notices.length) { wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">등록된 공지가 없습니다.</div>'; return; }
    wrap.innerHTML = notices.map(n => `<div style="border:1px solid #E9EAF0;border-radius:10px;padding:.6rem .8rem;margin-bottom:.5rem;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
            <div style="white-space:pre-wrap;font-size:.9rem;line-height:1.5">${escapeHtml(n.text || '')}</div>
            <button class="btn btn-sm btn-danger" onclick="deleteNotice('${n.id}')" style="flex-shrink:0">×</button>
        </div>
        <div style="font-size:.7rem;color:var(--text-muted);margin-top:.35rem">${escapeHtml(n.author || '')} · ${(n.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
    </div>`).join('');
}
async function addNotice() {
    const el = document.getElementById('noticeInput');
    const t = (el.value || '').trim();
    if (!t) return;
    const me = (typeof currentCrmUser !== 'undefined' && currentCrmUser) ? currentCrmUser : null;
    try {
        await db.collection('notices').add({ text: t, author: me ? me.name : '', createdAt: new Date().toISOString() });
        el.value = '';
        await loadNotices(); renderNotices();
    } catch (e) { alert('공지 등록 실패: ' + e.message); }
}
async function deleteNotice(id) {
    if (!confirm('이 공지를 삭제하시겠습니까?')) return;
    try { await db.collection('notices').doc(id).delete(); await loadNotices(); renderNotices(); }
    catch (e) { alert('삭제 실패: ' + e.message); }
}

// ============================================================
//  🌐 실시간 통역 (Papago 프록시 /api/translate + 브라우저 STT/TTS)
// ============================================================
let _interpDir = 'ko-ja';      // source-target
let _interpRec = null, _interpListening = false;
function openInterp() { openModal('interpModal'); interpSetDir(_interpDir); }
function interpSetDir(d) {
    _interpDir = d;
    const el = document.getElementById('interpDirLabel');
    if (el) el.textContent = (d === 'ko-ja') ? '한국어 → 일본어' : '일본어 → 한국어';
}
function interpToggleDir() { interpSetDir(_interpDir === 'ko-ja' ? 'ja-ko' : 'ko-ja'); }
async function interpTranslate(text) {
    const [src, tgt] = _interpDir.split('-');
    try {
        const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source: src, target: tgt }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.translated) return { ok: false, msg: (data.error || ('번역 실패(' + r.status + ')')) };
        return { ok: true, text: data.translated };
    } catch (e) { return { ok: false, msg: String(e) }; }
}
function interpSpeak(text, lang) { try { const u = new SpeechSynthesisUtterance(text); u.lang = lang; speechSynthesis.speak(u); } catch (_) { } }
function interpAddRow(orig, trans, ok, tgtLang) {
    const log = document.getElementById('interpLog'); if (!log) return;
    const div = document.createElement('div');
    div.style.cssText = 'border-bottom:1px solid #F0F1F5;padding:.45rem 0';
    const safe = (trans || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    div.innerHTML = `<div style="font-size:.82rem;color:var(--text-secondary)">${escapeHtml(orig)}</div>
        <div style="font-size:.98rem;color:${ok ? '#4F46E5' : '#DC2626'};display:flex;align-items:center;gap:.4rem;margin-top:.15rem">
            <span style="flex:1">${escapeHtml(trans)}</span>
            ${ok ? `<button class="btn btn-sm btn-outline" onclick="interpSpeak('${safe}','${tgtLang}')">🔊</button>` : ''}
        </div>`;
    log.appendChild(div); log.scrollTop = log.scrollHeight;
}
async function interpHandleText(text) {
    if (!text) return;
    const tgt = _interpDir.split('-')[1];
    const tgtLang = tgt === 'ja' ? 'ja-JP' : 'ko-KR';
    interpAddRow(text, '…', true, tgtLang);
    const res = await interpTranslate(text);
    // 마지막 임시행 갱신
    const log = document.getElementById('interpLog');
    if (log && log.lastChild) log.removeChild(log.lastChild);
    if (res.ok) { interpAddRow(text, res.text, true, tgtLang); interpSpeak(res.text, tgtLang); }
    else { interpAddRow(text, '⚠ ' + res.msg, false, tgtLang); }
}
function interpInputSend() { const el = document.getElementById('interpInput'); const t = (el.value || '').trim(); if (!t) return; el.value = ''; interpHandleText(t); }
function interpMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = document.getElementById('interpMicBtn');
    if (!SR) { alert('이 브라우저는 음성인식을 지원하지 않습니다. (아이폰 Safari 미지원) — 아래 텍스트 입력을 사용하세요.'); return; }
    if (_interpListening) { try { _interpRec && _interpRec.stop(); } catch (_) { } return; }
    _interpRec = new SR();
    _interpRec.lang = _interpDir.split('-')[0] === 'ko' ? 'ko-KR' : 'ja-JP';
    _interpRec.interimResults = false; _interpRec.maxAlternatives = 1;
    _interpRec.onresult = e => { const t = e.results[0][0].transcript; interpHandleText(t); };
    _interpRec.onend = () => { _interpListening = false; if (btn) { btn.textContent = '🎤 말하기'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); } };
    _interpRec.onerror = () => { _interpListening = false; if (btn) { btn.textContent = '🎤 말하기'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); } };
    try { _interpRec.start(); _interpListening = true; if (btn) { btn.textContent = '■ 중지'; btn.classList.remove('btn-primary'); btn.classList.add('btn-danger'); } }
    catch (_) { }
}
