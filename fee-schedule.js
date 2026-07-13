/* ===== fee-schedule.js — 시술 수가표 =====
 * 정가 / 원가(재고 믹스) / 할인율 / 마진 / 마진율 / 소요시간 / 10분당 이익
 * CRM 연동(오더 단가) · admin·실장(manager)만 편집 (currentCrmCanEditFees)
 * 저장: Firestore feeSchedule 컬렉션 (doc per variant key)
 */
let feeSchedule = {}; // key -> {key, price, recipe:[{itemId,amount}], manualCost, discountRate, durationMin, updatedAt, updatedBy}
const FEE_LOSS_RATE = 0.10; // 소분(portioned) 품목 로스율

// 직원(비관리자)에게 보여줄 컬럼 (true=표시). 수익 정보는 기본 숨김.
// admin/실장은 항상 전체 표시. 이 설정으로 직원 노출 여부만 제어.
let feeColVis = { cost: true, margin: false, marginRate: false, per10: false };
const FEE_COL_LABELS = { cost: '원가', margin: '마진', marginRate: '마진율', per10: '10분당이익' };

// 시술 구성(회차별) 상세
let _feeExpanded = new Set(); // 펼쳐진 key
let _feeElKey = {};           // elId -> key (특수문자 회피용)
function feeElId(key) {
    try { return 'fs' + btoa(unescape(encodeURIComponent(key))).replace(/[^A-Za-z0-9]/g, ''); }
    catch (_) { return 'fs' + Math.abs(key.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)); }
}
function _feeGet(key) { const f = feeSchedule[key] || { key }; feeSchedule[key] = f; return f; }
async function _persistSessions(key, f) {
    f.key = key; f.updatedAt = new Date().toISOString();
    if (typeof currentCrmUser !== 'undefined' && currentCrmUser) f.updatedBy = currentCrmUser.id;
    feeSchedule[key] = f;
    try { await db.collection('feeSchedule').doc(feeDocId(key)).set({ key, sessions: f.sessions || [], updatedAt: f.updatedAt, updatedBy: f.updatedBy || null }, { merge: true }); }
    catch (e) { alert('회차 저장 실패: ' + e.message); }
}

function feeKey(catId, tName, vDesc) { return `${catId}||${tName}||${vDesc}`; }
function feeDocId(key) { return key.replace(/\//g, '∕').replace(/\./g, '·').slice(0, 1400); }
function canEditFees() { return typeof currentCrmCanEditFees !== 'undefined' && currentCrmCanEditFees; }

async function loadFeeSchedule() {
    feeSchedule = {};
    try {
        const s = await db.collection('feeSchedule').get();
        s.docs.forEach(d => { const data = d.data(); if (data && data.key) feeSchedule[data.key] = data; });
    } catch (e) { console.warn('수가표 로드 실패:', e); }
    // 직원 노출 컬럼 설정
    try {
        const d = await db.collection('settings').doc('feeColVisibility').get();
        if (d.exists) feeColVis = Object.assign(feeColVis, d.data());
    } catch (e) { console.warn('수가표 표시설정 로드 실패:', e); }
}
async function saveFeeColVis() {
    try { await db.collection('settings').doc('feeColVisibility').set(feeColVis, { merge: true }); }
    catch (e) { alert('표시설정 저장 실패: ' + e.message); }
}
function toggleFeeCol(col, checked) {
    if (!canEditFees()) return;
    feeColVis[col] = !!checked;
    saveFeeColVis();
    renderFeeSchedule();
}
// admin/실장 전용: 직원 노출 컬럼 체크박스
function renderFeeVisConfig() {
    const box = document.getElementById('feeVisConfig');
    if (!box) return;
    if (!canEditFees()) { box.innerHTML = ''; return; }
    const boxes = Object.keys(FEE_COL_LABELS).map(col =>
        `<label style="display:inline-flex;align-items:center;gap:.3rem;font-size:.8rem;margin-right:.9rem">
            <input type="checkbox" ${feeColVis[col] ? 'checked' : ''} onchange="toggleFeeCol('${col}',this.checked)"> ${FEE_COL_LABELS[col]}
        </label>`).join('');
    box.innerHTML = `<div style="background:#F7F8FB;border:1px solid #E9EAF0;border-radius:8px;padding:.5rem .75rem">
        <span style="font-size:.78rem;font-weight:600;color:#4F46E5;margin-right:.6rem">🔒 직원에게 표시할 항목</span>${boxes}
        <span style="font-size:.72rem;color:var(--text-muted);margin-left:.3rem">(체크 해제 시 직원 화면에서 숨김 · admin/실장은 항상 전체 표시)</span>
    </div>`;
}

// 재고 1단위당 단가(원)
function invUnitCost(item) {
    if (!item) return 0;
    return item.purchaseQty ? (item.purchasePrice || 0) / item.purchaseQty : (item.purchasePrice || 0);
}
// 믹스(레시피)로 원가 계산
function feeRecipeCost(recipe) {
    if (!Array.isArray(recipe)) return 0;
    const inv = (typeof inventoryItems !== 'undefined') ? inventoryItems : [];
    let cost = 0;
    recipe.forEach(ing => {
        const it = inv.find(i => i.id === ing.itemId);
        if (!it) return;
        let amt = ing.amount || 0;
        if (it.type === 'portioned') amt *= (1 + FEE_LOSS_RATE);
        cost += invUnitCost(it) * amt;
    });
    return Math.round(cost);
}
// 조제 원가 × (실사용량 / 총조제량). 조제량 미입력 시 전량 사용 기준
function feeComputedCost(f) {
    const mixCost = feeRecipeCost(f && f.recipe);
    const total = Number(f && f.mixTotal) || 0;
    const used = Number(f && f.mixUsed) || 0;
    if (total > 0 && used > 0) return Math.round(mixCost * used / total);
    return mixCost;
}
// 변형 원가: 수동(manualCost) 우선, 없으면 조제/사용량 기반 계산
function feeCost(f) {
    if (!f) return 0;
    if (f.manualCost != null && f.manualCost !== '') return Number(f.manualCost) || 0;
    return feeComputedCost(f);
}
// CRM 오더 단가 연동: 정가 override(원) 반환, 없으면 null
function feeOverridePrice(catId, tName, vDesc) {
    const f = feeSchedule[feeKey(catId, tName, vDesc)];
    return (f && f.price != null && f.price !== '') ? manToWon(f.price) : null;
}

// ===== 렌더 =====
function renderFeeSchedule() {
    const wrap = document.getElementById('feeWrap');
    if (!wrap) return;
    renderFeeVisConfig();
    const editable = canEditFees();
    const tmBtn = document.getElementById('tmManageBtn'); if (tmBtn) tmBtn.style.display = editable ? '' : 'none';
    const badge = document.getElementById('feeEditBadge');
    if (badge) badge.innerHTML = editable
        ? '<span style="background:#E7F6EC;color:#16A34A;padding:1px 8px;border-radius:8px">편집 가능 (admin/실장)</span>'
        : '<span style="background:#F3F4F6;color:#6B7280;padding:1px 8px;border-radius:8px">읽기 전용 (편집은 admin/실장)</span>';
    if (typeof treatmentCategories === 'undefined' || !treatmentCategories.length) {
        wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary)">시술 데이터를 불러오지 못했습니다.</div>'; return;
    }
    // 컬럼 노출: 편집권한자는 전체, 직원은 feeColVis 설정에 따름
    const vis = {
        cost: editable || !!feeColVis.cost,
        margin: editable || !!feeColVis.margin,
        marginRate: editable || !!feeColVis.marginRate,
        per10: editable || !!feeColVis.per10
    };
    const q = (document.getElementById('feeSearch')?.value || '').trim().toLowerCase();
    const dis = editable ? '' : 'disabled';
    const colCount = 5 + (vis.cost ? 1 : 0) + (vis.margin ? 1 : 0) + (vis.marginRate ? 1 : 0) + (vis.per10 ? 1 : 0);
    let html = '';
    treatmentCategories.forEach(c => {
        let rows = '';
        c.treatments.forEach(t => {
            if (q && !(t.name.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))) return;
            (t.variants || []).forEach(v => {
                const vDesc = variantDesc(v);
                const key = feeKey(c.id, t.name, vDesc);
                const elId = feeElId(key); _feeElKey[elId] = key;
                const expanded = _feeExpanded.has(key);
                const sessN = Array.isArray((feeSchedule[key] || {}).sessions) ? feeSchedule[key].sessions.length : 0;
                const f = feeSchedule[key] || {};
                const priceMan = (f.price != null && f.price !== '') ? f.price : (v.price || 0);
                const priceWon = manToWon(priceMan);
                const cost = feeCost(f);
                const disc = Number(f.discountRate) || 0;
                const dur = Number(f.durationMin) || 0;
                const salePrice = Math.round(priceWon * (1 - disc / 100));
                const margin = salePrice - cost;
                const marginRate = salePrice > 0 ? (margin / salePrice * 100) : 0;
                const per10 = dur > 0 ? Math.round(margin / (dur / 10)) : null;
                const costSrc = (f.manualCost != null && f.manualCost !== '') ? '수동'
                    : (Array.isArray(f.recipe) && f.recipe.length ? '믹스' : '미설정');
                rows += `<tr>
                    <td style="font-size:.82rem"><button class="btn btn-sm" onclick="toggleFeeSessions('${elId}')" title="시술 구성(회차) 상세" style="padding:.02rem .35rem;font-size:.72rem;background:#EEF0FE;color:#4F46E5;margin-right:.35rem">${expanded ? '▾' : '▸'}${sessN ? '<span style="font-size:.62rem"> ' + sessN + '</span>' : ''}</button>${escapeHtml(t.name)} <span style="color:var(--text-muted)">${escapeHtml(vDesc)}</span></td>
                    <td class="text-right"><input type="number" class="form-input" style="width:70px;text-align:right;padding:.3rem" value="${priceMan}" ${dis} onchange="saveFeeField('${key}','price',this.value)">만</td>
                    ${vis.cost ? `<td class="text-right" style="min-width:120px"><div>${formatCurrency(cost)}</div>${editable ? `<button class="btn btn-sm btn-outline" onclick="openCostModal('${key.replace(/'/g, "\\'")}','${escapeHtml(t.name + ' ' + vDesc).replace(/'/g, "\\'")}')" style="font-size:.66rem;padding:.12rem .4rem;margin-top:.15rem">${costSrc} 믹스</button>` : ''}</td>` : ''}
                    <td class="text-right"><input type="number" class="form-input" style="width:50px;text-align:right;padding:.3rem" value="${disc || ''}" ${dis} onchange="saveFeeField('${key}','discountRate',this.value)">%</td>
                    <td class="text-right">${formatCurrency(salePrice)}</td>
                    ${vis.margin ? `<td class="text-right" style="color:${margin >= 0 ? '#16A34A' : '#DC2626'};font-weight:600">${formatCurrency(margin)}</td>` : ''}
                    ${vis.marginRate ? `<td class="text-right" style="color:${marginRate >= 0 ? '#16A34A' : '#DC2626'}">${marginRate.toFixed(0)}%</td>` : ''}
                    <td class="text-right"><input type="number" class="form-input" style="width:50px;text-align:right;padding:.3rem" value="${dur || ''}" ${dis} onchange="saveFeeField('${key}','durationMin',this.value)">분</td>
                    ${vis.per10 ? `<td class="text-right" style="font-weight:600;color:#4F46E5">${per10 != null ? formatCurrency(per10) : '-'}</td>` : ''}
                </tr>
                <tr id="r${elId}" ${expanded ? '' : 'style="display:none"'}><td colspan="${colCount}" style="background:#FAFBFE;padding:.4rem .8rem"><div id="${elId}">${feeSessionsHtml(elId)}</div></td></tr>`;
            });
        });
        if (!rows) return;
        html += `<div class="section" style="margin-bottom:1.1rem">
            <div class="section-header"><div class="section-title">${escapeHtml(c.name)}</div></div>
            <div class="table-container"><table><thead><tr>
                <th>시술/옵션</th><th class="text-right">정가</th>${vis.cost ? '<th class="text-right">원가</th>' : ''}<th class="text-right">할인</th>
                <th class="text-right">실판매가</th>${vis.margin ? '<th class="text-right">마진</th>' : ''}${vis.marginRate ? '<th class="text-right">마진율</th>' : ''}<th class="text-right">소요</th>${vis.per10 ? '<th class="text-right">10분당</th>' : ''}
            </tr></thead><tbody>${rows}</tbody></table></div></div>`;
    });
    wrap.innerHTML = html || '<div style="padding:2rem;text-align:center;color:var(--text-secondary)">검색 결과가 없습니다.</div>';
}

async function saveFeeField(key, field, value) {
    if (!canEditFees()) { alert('수가표 편집 권한이 없습니다. (admin/실장만 가능)'); renderFeeSchedule(); return; }
    const f = feeSchedule[key] || { key };
    f.key = key;
    f[field] = (value === '' || value == null) ? null : Number(value);
    f.updatedAt = new Date().toISOString();
    if (typeof currentCrmUser !== 'undefined' && currentCrmUser) f.updatedBy = currentCrmUser.id;
    feeSchedule[key] = f;
    try { await db.collection('feeSchedule').doc(feeDocId(key)).set(f, { merge: true }); }
    catch (e) { alert('저장 실패: ' + e.message); }
    renderFeeSchedule();
}

// ===== 원가 믹스 모달 =====
let _costKey = null, _costRows = [];
function _invList() { return (typeof inventoryItems !== 'undefined') ? inventoryItems : []; }
function _itemByName(name) { return _invList().find(i => i.name === name); }
function openCostModal(key, label) {
    if (!canEditFees()) { alert('수가표 편집 권한이 없습니다. (admin/실장만 가능)'); return; }
    _costKey = key;
    document.getElementById('costModalTitle').textContent = '원가 믹스 — ' + label;
    const f = feeSchedule[key] || {};
    _costRows = Array.isArray(f.recipe) ? JSON.parse(JSON.stringify(f.recipe)) : [];
    if (!_costRows.length) _costRows.push({ itemId: '', amount: 0 });
    const dl = document.getElementById('invItemDatalist');
    if (dl) dl.innerHTML = _invList().map(i => `<option value="${escapeHtml(i.name)}">`).join('');
    const mt = document.getElementById('costMixTotal'); if (mt) mt.value = (f.mixTotal != null ? f.mixTotal : '');
    const mu = document.getElementById('costMixUsed'); if (mu) mu.value = (f.mixUsed != null ? f.mixUsed : '');
    renderCostRows();
    openModal('costModal');
}
function renderCostRows() {
    const wrap = document.getElementById('costRows');
    if (!wrap) return;
    wrap.innerHTML = _costRows.map((r, i) => {
        const it = _invList().find(x => x.id === r.itemId);
        const unit = it ? (it.unit || '개') : 'cc';
        const uc = it ? invUnitCost(it) : 0;
        return `<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem">
            <input class="form-input" list="invItemDatalist" placeholder="재고 품목명 (예: 하이톡스, NS)" value="${it ? escapeHtml(it.name) : ''}" onchange="setCostItem(${i},this.value)" style="flex:1">
            <input type="number" class="form-input" placeholder="투입량" value="${r.amount || ''}" onchange="setCostAmount(${i},this.value)" style="width:90px;text-align:right" step="0.01">
            <span style="font-size:.72rem;color:var(--text-muted);width:78px">${unit}${uc ? ' · ' + formatCurrency(uc) : ' · 단가?'}</span>
            <button class="btn btn-sm btn-danger" onclick="removeCostRow(${i})">×</button>
        </div>`;
    }).join('');
    updateCostTotal();
}
function setCostItem(i, name) { const it = _itemByName(name); _costRows[i].itemId = it ? it.id : ''; renderCostRows(); }
function setCostAmount(i, val) { _costRows[i].amount = Number(val) || 0; updateCostTotal(); }
function addCostRow() { _costRows.push({ itemId: '', amount: 0 }); renderCostRows(); }
function removeCostRow(i) { _costRows.splice(i, 1); if (!_costRows.length) _costRows.push({ itemId: '', amount: 0 }); renderCostRows(); }
function updateCostTotal() {
    const mix = feeRecipeCost(_costRows);
    const total = Number(document.getElementById('costMixTotal')?.value) || 0;
    const used = Number(document.getElementById('costMixUsed')?.value) || 0;
    const final = (total > 0 && used > 0) ? Math.round(mix * used / total) : mix;
    const mixEl = document.getElementById('costModalMix'); if (mixEl) mixEl.textContent = formatCurrency(mix);
    const el = document.getElementById('costModalTotal'); if (el) el.textContent = formatCurrency(final);
    const hint = document.getElementById('costModalHint');
    if (hint) hint.textContent = (total > 0 && used > 0)
        ? `조제 ${formatCurrency(mix)} × ${used}cc ÷ ${total}cc = ${formatCurrency(final)}`
        : '총 조제량·1회 실사용량 미입력 시 전량 사용 기준으로 계산됩니다.';
}
async function saveCost() {
    if (!canEditFees()) { alert('권한이 없습니다.'); return; }
    const recipe = _costRows.filter(r => r.itemId && r.amount > 0);
    const total = Number(document.getElementById('costMixTotal')?.value) || null;
    const used = Number(document.getElementById('costMixUsed')?.value) || null;
    const f = feeSchedule[_costKey] || { key: _costKey };
    f.key = _costKey; f.recipe = recipe; f.mixTotal = total; f.mixUsed = used; f.manualCost = null;
    f.updatedAt = new Date().toISOString();
    if (typeof currentCrmUser !== 'undefined' && currentCrmUser) f.updatedBy = currentCrmUser.id;
    feeSchedule[_costKey] = f;
    try { await db.collection('feeSchedule').doc(feeDocId(_costKey)).set(f, { merge: true }); }
    catch (e) { alert('저장 실패: ' + e.message); return; }
    closeModal('costModal');
    renderFeeSchedule();
}

// ===== 시술 구성(회차별) 상세 =====
function toggleFeeSessions(elId) {
    const key = _feeElKey[elId]; if (!key) return;
    if (_feeExpanded.has(key)) _feeExpanded.delete(key); else _feeExpanded.add(key);
    renderFeeSchedule();
}
function _refreshSess(elId) { const el = document.getElementById(elId); if (el) el.innerHTML = feeSessionsHtml(elId); }
function feeSessionsHtml(elId) {
    const key = _feeElKey[elId]; if (!key) return '';
    const editable = canEditFees();
    const f = feeSchedule[key] || {};
    const sessions = Array.isArray(f.sessions) ? f.sessions : [];
    const dis = editable ? '' : 'disabled';
    let rows = sessions.map((s, i) => `
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem">
            <span style="width:46px;font-size:.78rem;color:#6B7280;flex-shrink:0">${i + 1}회차</span>
            <input class="form-input" style="flex:1;padding:.3rem;font-size:.82rem" value="${escapeHtml(s.c || '')}" ${dis} placeholder="예: 토닝 + 실펌" onchange="setFeeSession('${elId}',${i},this.value)">
            <button class="btn btn-sm ${s.photo ? 'btn-primary' : 'btn-outline'}" ${dis} onclick="toggleFeeSessionPhoto('${elId}',${i})" title="촬영 여부" style="font-size:.72rem;padding:.2rem .45rem;flex-shrink:0">📷${s.photo ? ' ✓' : ''}</button>
            ${editable ? `<button class="btn btn-sm btn-secondary" onclick="cloneFeeSession('${elId}',${i})" title="다음 회차로 복제" style="font-size:.72rem;padding:.2rem .5rem;flex-shrink:0">복제</button>
            <button class="btn btn-sm btn-danger" onclick="removeFeeSession('${elId}',${i})" style="font-size:.72rem;padding:.2rem .4rem;flex-shrink:0">×</button>` : ''}
        </div>`).join('');
    if (!sessions.length) rows = `<div style="font-size:.78rem;color:var(--text-muted);padding:.3rem 0">회차 구성이 없습니다.${editable ? ' [+ 회차 추가]로 시작하세요.' : ''}</div>`;
    return `<div style="padding:.35rem .2rem">
        <div style="font-weight:600;font-size:.8rem;margin-bottom:.4rem;color:#4F46E5">🗂 시술 구성 (회차별) <span style="font-weight:400;font-size:.72rem;color:var(--text-muted)">· 📷=촬영 회차</span></div>
        ${rows}
        ${editable ? `<button class="btn btn-sm btn-secondary" onclick="addFeeSession('${elId}')" style="margin-top:.25rem">+ 회차 추가</button>` : ''}
    </div>`;
}
async function addFeeSession(elId) {
    const key = _feeElKey[elId]; if (!key || !canEditFees()) return;
    const f = _feeGet(key); f.sessions = Array.isArray(f.sessions) ? f.sessions : [];
    f.sessions.push({ c: '', photo: false });
    await _persistSessions(key, f); _refreshSess(elId);
}
async function cloneFeeSession(elId, i) {
    const key = _feeElKey[elId]; if (!key || !canEditFees()) return;
    const f = _feeGet(key); const arr = Array.isArray(f.sessions) ? f.sessions : [];
    const src = arr[i]; if (!src) return;
    arr.splice(i + 1, 0, { c: src.c || '', photo: !!src.photo }); // 그대로 다음 회차로 복제
    f.sessions = arr;
    await _persistSessions(key, f); _refreshSess(elId);
}
async function removeFeeSession(elId, i) {
    const key = _feeElKey[elId]; if (!key || !canEditFees()) return;
    const f = _feeGet(key); const arr = Array.isArray(f.sessions) ? f.sessions : [];
    arr.splice(i, 1); f.sessions = arr;
    await _persistSessions(key, f); _refreshSess(elId);
}
function setFeeSession(elId, i, val) {
    const key = _feeElKey[elId]; if (!key || !canEditFees()) return;
    const f = _feeGet(key); const arr = Array.isArray(f.sessions) ? f.sessions : [];
    if (!arr[i]) arr[i] = { c: '', photo: false };
    arr[i].c = val; f.sessions = arr;
    _persistSessions(key, f); // 재렌더 없이 저장(입력 흐름 유지)
}
async function toggleFeeSessionPhoto(elId, i) {
    const key = _feeElKey[elId]; if (!key || !canEditFees()) return;
    const f = _feeGet(key); const arr = Array.isArray(f.sessions) ? f.sessions : [];
    if (!arr[i]) arr[i] = { c: '', photo: false };
    arr[i].photo = !arr[i].photo; f.sessions = arr;
    await _persistSessions(key, f); _refreshSess(elId);
}

// ============================================================
//  시술 추가·수정·삭제 (treatments 컬렉션) — admin/실장
//  시드(JSON) 상태면 최초 1회 DB로 이관 후 CRUD
// ============================================================
function treatmentsAreSeed(){
    // DB 로드분은 각 treatment에 docId가 있음. 하나도 없으면 시드.
    return !(treatmentCategories||[]).some(c=>(c.treatments||[]).some(t=>t.docId));
}
async function ensureTreatmentsDb(){
    if(!treatmentsAreSeed()) return;
    const batch=db.batch();
    (treatmentCategories||[]).forEach(c=>{
        (c.treatments||[]).forEach(t=>{
            const ref=db.collection('treatments').doc();
            batch.set(ref,{categoryId:c.id,categoryName:c.name,name:t.name,note:t.note||'',variants:t.variants||[],createdAt:new Date().toISOString()});
        });
    });
    await batch.commit();
    if(typeof loadTreatmentsMaster==='function') await loadTreatmentsMaster();
}
async function openTreatmentManager(){
    if(!canEditFees()){ alert('권한이 없습니다. (admin/실장)'); return; }
    openModal('tmModal');
    document.getElementById('tmModalBody').innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">불러오는 중…</div>';
    try{ await ensureTreatmentsDb(); }catch(e){ alert('시술 DB 준비 실패: '+e.message); }
    renderTmList();
}
function renderTmList(){
    const body=document.getElementById('tmModalBody'); if(!body) return;
    document.getElementById('tmModalTitle').textContent='시술 관리';
    let html=`<div style="margin-bottom:.6rem"><button class="btn btn-primary btn-sm" onclick="openTmForm()">+ 시술 추가</button></div>`;
    (treatmentCategories||[]).forEach(c=>{
        html+=`<div style="font-weight:700;font-size:.82rem;color:#4F46E5;margin:.7rem 0 .25rem">${escapeHtml(c.name)}</div>`;
        (c.treatments||[]).forEach(t=>{
            html+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:.35rem .4rem;border-bottom:1px solid #F0F1F5">
                <span style="font-size:.85rem;min-width:0">${escapeHtml(t.name)} <span style="color:var(--text-muted);font-size:.72rem">${(t.variants||[]).length}옵션</span></span>
                <span style="display:flex;gap:.3rem;flex-shrink:0">
                    <button class="btn btn-sm btn-outline" onclick="openTmForm('${t.docId}')">수정</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTreatment('${t.docId}')">삭제</button>
                </span></div>`;
        });
    });
    body.innerHTML=html;
}
let _tmEditDocId='', _tmVariants=[];
function openTmForm(docId){
    _tmEditDocId=docId||'';
    document.getElementById('tmModalTitle').textContent=docId?'시술 수정':'시술 추가';
    let t=null, cat=null;
    if(docId){ (treatmentCategories||[]).forEach(c=>{ const f=(c.treatments||[]).find(x=>x.docId===docId); if(f){ t=f; cat=c; } }); }
    _tmVariants = t ? (t.variants||[]).map(v=>({label:variantDesc(v), price:v.price||0})) : [{label:'기본',price:0}];
    const catList=(treatmentCategories||[]).map(c=>`<option value="${escapeHtml(c.name)}">`).join('');
    document.getElementById('tmModalBody').innerHTML=`
        <div class="form-group"><label class="form-label">카테고리</label>
            <input class="form-input" id="tmCat" list="tmCatList" value="${cat?escapeHtml(cat.name):''}" placeholder="예: 보톡스 (기존 선택 또는 새로 입력)">
            <datalist id="tmCatList">${catList}</datalist></div>
        <div class="form-group"><label class="form-label">시술명</label><input class="form-input" id="tmName" value="${t?escapeHtml(t.name):''}" placeholder="시술명"></div>
        <div class="form-group"><label class="form-label">옵션 · 정가(만원)</label><div id="tmVariants"></div>
            <button class="btn btn-sm btn-secondary" onclick="addTmVariant()" style="margin-top:.35rem">+ 옵션 추가</button></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;border-top:1px solid #eee;padding-top:.7rem">
            <button class="btn btn-outline btn-sm" onclick="renderTmList()">← 목록</button>
            <button class="btn btn-primary" onclick="saveTreatment()">저장</button>
        </div>`;
    renderTmVariants();
}
function renderTmVariants(){
    const wrap=document.getElementById('tmVariants'); if(!wrap) return;
    wrap.innerHTML=_tmVariants.map((v,i)=>`<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.35rem">
        <input class="form-input" style="flex:1" placeholder="옵션명 (예: 100u 코어톡스)" value="${escapeHtml(v.label||'')}" onchange="setTmVariant(${i},'label',this.value)">
        <input type="number" class="form-input" style="width:90px;text-align:right" placeholder="만원" value="${v.price||''}" onchange="setTmVariant(${i},'price',this.value)">
        <button class="btn btn-sm btn-danger" onclick="removeTmVariant(${i})">×</button>
    </div>`).join('');
}
function setTmVariant(i,f,val){ if(!_tmVariants[i])return; _tmVariants[i][f] = (f==='price')?(Number(val)||0):val; }
function addTmVariant(){ _tmVariants.push({label:'',price:0}); renderTmVariants(); }
function removeTmVariant(i){ _tmVariants.splice(i,1); if(!_tmVariants.length)_tmVariants.push({label:'기본',price:0}); renderTmVariants(); }
async function saveTreatment(){
    if(!canEditFees()){ alert('권한이 없습니다.'); return; }
    await ensureTreatmentsDb();
    const catName=(document.getElementById('tmCat').value||'').trim();
    const name=(document.getElementById('tmName').value||'').trim();
    if(!catName||!name){ alert('카테고리와 시술명을 입력하세요.'); return; }
    const existCat=(treatmentCategories||[]).find(c=>c.name===catName);
    const categoryId = existCat ? existCat.id : ('cat_'+Date.now());
    const variants=_tmVariants.map(v=>({label:(v.label||'').trim()||'기본', price:Number(v.price)||0}));
    const data={categoryId, categoryName:catName, name, variants, updatedAt:new Date().toISOString()};
    if(typeof currentCrmUser!=='undefined'&&currentCrmUser) data.updatedBy=currentCrmUser.id;
    try{
        if(_tmEditDocId){ await db.collection('treatments').doc(_tmEditDocId).update(data); }
        else{ data.note=''; data.createdAt=new Date().toISOString(); await db.collection('treatments').add(data); }
        if(typeof loadTreatmentsMaster==='function') await loadTreatmentsMaster();
        renderTmList(); renderFeeSchedule();
    }catch(e){ alert('저장 실패: '+e.message); }
}
async function deleteTreatment(docId){
    if(!canEditFees()){ alert('권한이 없습니다.'); return; }
    if(!confirm('이 시술을 삭제하시겠습니까? (수가표에서도 사라집니다)')) return;
    await ensureTreatmentsDb();
    try{
        await db.collection('treatments').doc(docId).delete();
        if(typeof loadTreatmentsMaster==='function') await loadTreatmentsMaster();
        renderTmList(); renderFeeSchedule();
    }catch(e){ alert('삭제 실패: '+e.message); }
}
