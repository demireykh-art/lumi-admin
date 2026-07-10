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
    let html = '';
    treatmentCategories.forEach(c => {
        let rows = '';
        c.treatments.forEach(t => {
            if (q && !(t.name.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))) return;
            (t.variants || []).forEach(v => {
                const vDesc = variantDesc(v);
                const key = feeKey(c.id, t.name, vDesc);
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
                    <td style="font-size:.82rem">${escapeHtml(t.name)} <span style="color:var(--text-muted)">${escapeHtml(vDesc)}</span></td>
                    <td class="text-right"><input type="number" class="form-input" style="width:70px;text-align:right;padding:.3rem" value="${priceMan}" ${dis} onchange="saveFeeField('${key}','price',this.value)">만</td>
                    ${vis.cost ? `<td class="text-right" style="min-width:120px"><div>${formatCurrency(cost)}</div>${editable ? `<button class="btn btn-sm btn-outline" onclick="openCostModal('${key.replace(/'/g, "\\'")}','${escapeHtml(t.name + ' ' + vDesc).replace(/'/g, "\\'")}')" style="font-size:.66rem;padding:.12rem .4rem;margin-top:.15rem">${costSrc} 믹스</button>` : ''}</td>` : ''}
                    <td class="text-right"><input type="number" class="form-input" style="width:50px;text-align:right;padding:.3rem" value="${disc || ''}" ${dis} onchange="saveFeeField('${key}','discountRate',this.value)">%</td>
                    <td class="text-right">${formatCurrency(salePrice)}</td>
                    ${vis.margin ? `<td class="text-right" style="color:${margin >= 0 ? '#16A34A' : '#DC2626'};font-weight:600">${formatCurrency(margin)}</td>` : ''}
                    ${vis.marginRate ? `<td class="text-right" style="color:${marginRate >= 0 ? '#16A34A' : '#DC2626'}">${marginRate.toFixed(0)}%</td>` : ''}
                    <td class="text-right"><input type="number" class="form-input" style="width:50px;text-align:right;padding:.3rem" value="${dur || ''}" ${dis} onchange="saveFeeField('${key}','durationMin',this.value)">분</td>
                    ${vis.per10 ? `<td class="text-right" style="font-weight:600;color:#4F46E5">${per10 != null ? formatCurrency(per10) : '-'}</td>` : ''}
                </tr>`;
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
