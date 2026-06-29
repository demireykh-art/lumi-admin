/* ===== crm-analytics.js - LUMI ERP (관리자/index.html 전용) =====
   환자 CRM 데이터(patients/visits/treatments/channels)를 "분석 전용"으로 읽어 표시.
   입력(등록/수정/삭제)은 스탭용 crm.html 에서만 수행. 여기는 read-only + 마케팅 광고비(재무) 입력만. */

// ===== Shared State =====
let patients = [];
let visits = [];
let treatmentCategories = [];
let channels = [];

const CHANNEL_OPTIONS = ['홈페이지', '블로그', '소개', 'SNS', '간판', '국적'];

// ===== Data Loading (firebase-config.js loadAllData 가 typeof 로 호출) =====
async function loadTreatmentsMaster() {
    try {
        const snap = await db.collection('treatments').get();
        if (!snap.empty) {
            const byCat = {};
            snap.docs.forEach(d => {
                const t = d.data();
                const cid = t.categoryId || 'etc';
                if (!byCat[cid]) byCat[cid] = { id: cid, name: t.categoryName || cid, treatments: [] };
                byCat[cid].treatments.push({ name: t.name, note: t.note, variants: t.variants || [] });
            });
            treatmentCategories = Object.values(byCat);
            return;
        }
    } catch (e) { console.warn('treatments 로드 실패, 시드 사용:', e); }
    try {
        const res = await fetch('treatments-seed.json?v=' + Date.now());
        const data = await res.json();
        treatmentCategories = (data.categories || []).map(c => ({ id: c.id, name: c.name, note: c.note, treatments: (c.treatments || []).map(t => ({ name: t.name, note: t.note, variants: t.variants || [] })) }));
    } catch (e) { console.error('정가표 시드 로드 실패:', e); treatmentCategories = []; }
}
async function loadPatients() { try { const s = await db.collection('patients').get(); patients = s.docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { console.error('Load patients:', e); } }
async function loadVisits() { try { const s = await db.collection('visits').get(); visits = s.docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { console.error('Load visits:', e); } }
async function loadChannels() { try { const s = await db.collection('channels').get(); channels = s.docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { console.error('Load channels:', e); } }

// ===== Helpers =====
function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function _maskRRN(front, gender) { return front ? `${front}-${gender || '*'}******` : '-'; }
function _deriveRRN(front, gender) {
    if (!front || front.length < 6) return { age: '-', sex: '-' };
    const g = parseInt(gender);
    const century = (g === 3 || g === 4 || g === 7 || g === 8) ? 2000 : 1900;
    const sex = (g % 2 === 1) ? '남' : '여';
    const yy = parseInt(front.slice(0, 2)), mm = parseInt(front.slice(2, 4)), dd = parseInt(front.slice(4, 6));
    const birth = new Date(century + yy, mm - 1, dd);
    let age = new Date().getFullYear() - birth.getFullYear();
    const m = new Date().getMonth() - (mm - 1);
    if (m < 0 || (m === 0 && new Date().getDate() < dd)) age--;
    return { age: isNaN(age) ? '-' : age + '세', sex };
}
function _variantDesc(v) { return [v.product, v.dose, v.sessions, v.size, v.qty, v.region, v.label].filter(Boolean).join(' · ') || '기본'; }
function _manToWon(m) { return Math.round((Number(m) || 0) * 10000); }
function _empName(id) { const e = employees.find(x => x.id === id); return e ? e.name : '-'; }
function _patientStats(pid) {
    const vs = visits.filter(v => v.patientId === pid);
    const total = vs.reduce((s, v) => s + (v.total || 0), 0);
    const dates = vs.map(v => v.date).filter(Boolean).sort();
    return { count: vs.length, total, last: dates.length ? dates[dates.length - 1] : null };
}

// ===== 환자 분석 (read-only) =====
function renderPatients() {
    const tbody = document.getElementById('patientTable');
    if (!tbody) return;
    const q = (document.getElementById('patientSearch')?.value || '').trim().toLowerCase();
    const chFilter = document.getElementById('patientChannelFilter')?.value || '';
    let list = patients.slice();
    if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q));
    if (chFilter) list = list.filter(p => p.channel === chFilter);
    list.sort((a, b) => _patientStats(b.id).total - _patientStats(a.id).total);

    const cards = document.getElementById('patientCards');
    if (cards) {
        const ym = getYM();
        const newThisMonth = patients.filter(p => (p.firstVisitAt || p.createdAt || '').startsWith(ym)).length;
        const jp = patients.filter(p => p.isJapanese).length;
        // 재진율: 방문 2건 이상 환자 비율
        const revisit = patients.filter(p => _patientStats(p.id).count >= 2).length;
        const revisitRate = patients.length ? Math.round(revisit / patients.length * 100) : 0;
        cards.innerHTML = `
            <div class="card"><div class="card-label">총 환자</div><div class="card-value">${formatNumber(patients.length)}명</div></div>
            <div class="card"><div class="card-label">이번달 신환</div><div class="card-value">${formatNumber(newThisMonth)}명</div></div>
            <div class="card"><div class="card-label">재진율</div><div class="card-value">${revisitRate}%</div><div class="card-sub">2회 이상 ${formatNumber(revisit)}명</div></div>
            <div class="card"><div class="card-label">일본인 환자</div><div class="card-value">${formatNumber(jp)}명</div></div>`;
    }

    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:2rem">등록된 환자가 없습니다. (입력은 스탭용 crm.html)</td></tr>'; return; }
    tbody.innerHTML = list.map(p => {
        const d = _deriveRRN(p.rrnFront, p.rrnGender);
        const st = _patientStats(p.id);
        return `<tr>
            <td><strong>${_esc(p.name)}</strong>${p.isJapanese ? ' <span style="font-size:.7rem;background:rgba(25,118,210,.1);color:#1976d2;padding:1px 6px;border-radius:8px">JP</span>' : ''}<div style="font-size:.7rem;color:var(--text-muted)">${_maskRRN(p.rrnFront, p.rrnGender)}</div></td>
            <td>${d.sex} / ${d.age}</td>
            <td>${_esc(p.phone || '-')}</td>
            <td>${_esc(p.channel || '-')}</td>
            <td class="text-right">${formatNumber(st.count)}</td>
            <td class="text-right">${formatCurrency(st.total)}</td>
            <td>${st.last || '-'}</td>
            <td><button class="btn btn-sm btn-outline" onclick="openPatientDetail('${p.id}')">상세</button></td>
        </tr>`;
    }).join('');
}

let _detailPatientId = null;
function openPatientDetail(pid) {
    _detailPatientId = pid;
    const p = patients.find(x => x.id === pid); if (!p) return;
    const d = _deriveRRN(p.rrnFront, p.rrnGender);
    const st = _patientStats(pid);
    document.getElementById('detailTitle').textContent = `${p.name} 님`;
    document.getElementById('detailInfo').innerHTML = `
        <div class="cards-grid">
            <div class="card"><div class="card-label">성별/나이</div><div class="card-value" style="font-size:1.1rem">${d.sex} / ${d.age}</div></div>
            <div class="card"><div class="card-label">연락처</div><div class="card-value" style="font-size:1.1rem">${_esc(p.phone || '-')}</div></div>
            <div class="card"><div class="card-label">유입경로</div><div class="card-value" style="font-size:1.1rem">${_esc(p.channel || '-')}</div></div>
            <div class="card"><div class="card-label">총 방문 / LTV</div><div class="card-value" style="font-size:1.1rem">${st.count}건 · ${formatCurrency(st.total)}</div></div>
        </div>${p.memo ? `<div style="margin-top:.5rem;font-size:.85rem;color:var(--text-secondary)">메모: ${_esc(p.memo)}</div>` : ''}`;
    const tbody = document.getElementById('detailVisitTable');
    const vs = visits.filter(v => v.patientId === pid).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    tbody.innerHTML = vs.length ? vs.map(v => {
        const items = (v.items || []).map(it => `${_esc(it.treatmentName)}${it.variant ? ' (' + _esc(it.variant) + ')' : ''} ×${it.qty || 1}`).join(', ');
        const staff = [v.doctorId && '진료:' + _empName(v.doctorId), v.consultantId && '상담:' + _empName(v.consultantId)].filter(Boolean).join(' / ');
        return `<tr><td>${v.date || '-'}${v.consultOnly ? ' <span style="font-size:.7rem;color:#f57f17">상담만</span>' : ''}</td><td style="font-size:.85rem;max-width:300px">${items || '-'}</td><td style="font-size:.8rem;color:var(--text-secondary)">${staff || '-'}</td><td class="text-right">${formatCurrency(v.total || 0)}</td><td style="font-size:.8rem">${_esc(v.payMethod || '-')}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:1.5rem">방문기록이 없습니다.</td></tr>';
    openModal('patientDetailModal');
}

// ===== 매출 분석 (이번달) =====
function renderCrmSales() {
    const ym = getYM();
    const monthVisits = visits.filter(v => (v.date || '').startsWith(ym));
    const total = monthVisits.reduce((s, v) => s + (v.total || 0), 0);
    const patientSet = new Set(monthVisits.map(v => v.patientId));
    const newPat = patients.filter(p => (p.firstVisitAt || p.createdAt || '').startsWith(ym)).length;
    const cards = document.getElementById('crmSalesCards');
    if (cards) {
        const avg = patientSet.size ? Math.round(total / patientSet.size) : 0;
        cards.innerHTML = `
            <div class="card"><div class="card-label">이번달 매출(시술기준)</div><div class="card-value">${formatCurrency(total)}</div></div>
            <div class="card"><div class="card-label">방문 건수</div><div class="card-value">${formatNumber(monthVisits.length)}건</div></div>
            <div class="card"><div class="card-label">방문 환자</div><div class="card-value">${formatNumber(patientSet.size)}명</div><div class="card-sub">신환 ${formatNumber(newPat)}명</div></div>
            <div class="card"><div class="card-label">객단가</div><div class="card-value">${formatCurrency(avg)}</div></div>`;
    }
    // 시술별
    const byTreat = {};
    monthVisits.forEach(v => (v.items || []).forEach(it => {
        const k = it.treatmentName || '기타';
        if (!byTreat[k]) byTreat[k] = { count: 0, amount: 0 };
        byTreat[k].count += (it.qty || 1);
        byTreat[k].amount += (it.lineTotal || 0);
    }));
    const tTbody = document.getElementById('crmTreatmentTable');
    if (tTbody) {
        const itemTotal = Object.values(byTreat).reduce((s, t) => s + t.amount, 0);
        const sorted = Object.entries(byTreat).sort((a, b) => b[1].amount - a[1].amount);
        tTbody.innerHTML = sorted.length ? sorted.map(([k, t]) => `<tr><td>${_esc(k)}</td><td class="text-right">${formatNumber(t.count)}</td><td class="text-right">${formatCurrency(t.amount)}</td><td class="text-right">${itemTotal ? Math.round(t.amount / itemTotal * 100) : 0}%</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem">이번달 시술 매출이 없습니다.</td></tr>';
    }
    // 담당자별 (진료)
    const byDoc = {};
    monthVisits.forEach(v => {
        const k = v.doctorId || '미지정';
        if (!byDoc[k]) byDoc[k] = { patients: new Set(), amount: 0 };
        byDoc[k].patients.add(v.patientId);
        byDoc[k].amount += (v.total || 0);
    });
    const dTbody = document.getElementById('crmDoctorTable');
    if (dTbody) {
        const sorted = Object.entries(byDoc).sort((a, b) => b[1].amount - a[1].amount);
        dTbody.innerHTML = sorted.length ? sorted.map(([k, d]) => {
            const n = d.patients.size;
            return `<tr><td>${k === '미지정' ? '미지정' : _esc(_empName(k))}</td><td class="text-right">${formatNumber(n)}</td><td class="text-right">${formatCurrency(d.amount)}</td><td class="text-right">${formatCurrency(n ? Math.round(d.amount / n) : 0)}</td></tr>`;
        }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem">데이터가 없습니다.</td></tr>';
    }
}

// ===== 마케팅 ROI (광고비 입력 = 관리자/재무) =====
function renderChannels() {
    const tbody = document.getElementById('channelTable');
    if (!tbody) return;
    const ym = getYM();
    const byChannel = {};
    CHANNEL_OPTIONS.forEach(c => byChannel[c] = { newPatients: 0, revenue: 0 });
    patients.forEach(p => { if (p.channel in byChannel && (p.firstVisitAt || p.createdAt || '').startsWith(ym)) byChannel[p.channel].newPatients++; });
    visits.forEach(v => {
        if (!(v.date || '').startsWith(ym)) return;
        const p = patients.find(x => x.id === v.patientId);
        if (p && p.channel in byChannel) byChannel[p.channel].revenue += (v.total || 0);
    });
    tbody.innerHTML = CHANNEL_OPTIONS.map(name => {
        const ch = channels.find(c => c.id === name) || { type: name === '국적' ? 'paid' : 'organic', monthlyCost: {} };
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

// ===== 정가표 (조회) =====
function renderPriceList() {
    const wrap = document.getElementById('priceListWrap');
    if (!wrap) return;
    if (!treatmentCategories.length) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:2rem;text-align:center">정가표를 불러오지 못했습니다.</div>'; return; }
    const q = (document.getElementById('priceSearch')?.value || '').trim().toLowerCase();
    wrap.innerHTML = treatmentCategories.map(c => {
        const rows = c.treatments.filter(t => !q || t.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).map(t => {
            const vrows = (t.variants || []).map(v => `<tr><td style="padding-left:1.5rem;color:var(--text-secondary);font-size:.85rem">${_esc(_variantDesc(v))}</td><td class="text-right">${v.price}만원</td><td class="text-right" style="color:var(--text-muted);font-size:.8rem">${formatCurrency(_manToWon(v.price))}</td></tr>`).join('');
            return `<tr><td colspan="3" style="font-weight:700;background:var(--bg,#fafafa);padding-top:.6rem">${_esc(t.name)}${t.note ? ` <span style="font-weight:400;font-size:.75rem;color:var(--text-muted)">(${_esc(t.note)})</span>` : ''}</td></tr>${vrows}`;
        }).join('');
        if (!rows) return '';
        return `<div class="section" style="margin-bottom:1.25rem"><div class="section-header"><div class="section-title">${_esc(c.name)}${c.note ? ` <span style="font-size:.75rem;font-weight:400;color:var(--text-muted)">${_esc(c.note)}</span>` : ''}</div></div><div class="table-container"><table><thead><tr><th>시술 / 옵션</th><th class="text-right">정가(만원)</th><th class="text-right">원(₩)</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }).join('');
}

// ===== 환자 CRM 접근 권한 관리 (관리자 설정 탭) =====
let crmAccess = { mode: 'all', employeeIds: [] };
async function loadCrmAccess() {
    try {
        const doc = await db.collection('settings').doc('crmAccess').get();
        if (doc.exists) crmAccess = Object.assign({ mode: 'all', employeeIds: [] }, doc.data());
    } catch (e) { console.warn('crmAccess 로드 실패:', e); }
    renderCrmAccess();
}
function onCrmAccessModeChange() {
    const mode = document.getElementById('crmAccessMode')?.value;
    const box = document.getElementById('crmAccessEmpList');
    if (box) box.style.display = (mode === 'selected') ? 'block' : 'none';
}
function renderCrmAccess() {
    const sel = document.getElementById('crmAccessMode');
    if (!sel) return;
    sel.value = crmAccess.mode || 'all';
    const box = document.getElementById('crmAccessEmpList');
    if (box) {
        const active = employees.filter(e => e.status !== 'inactive').slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        box.innerHTML = active.length ? active.map(e => {
            const checked = (crmAccess.employeeIds || []).includes(e.id) ? 'checked' : '';
            const noLogin = !e.staffId && !e.email;
            return `<label style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;font-size:.88rem">
                <input type="checkbox" class="crmAccessChk" value="${e.id}" ${checked}>
                ${_esc(e.name)} <span style="font-size:.75rem;color:var(--text-muted)">${e.role ? '(' + (roleLabels[e.role] || e.role) + ')' : ''} ${e.staffId ? '· ID:' + _esc(e.staffId) : (noLogin ? '· ⚠ 로그인ID 없음' : '')}</span>
            </label>`;
        }).join('') : '<div style="color:var(--text-muted);font-size:.85rem">등록된 직원이 없습니다.</div>';
    }
    onCrmAccessModeChange();
}
async function saveCrmAccess() {
    const mode = document.getElementById('crmAccessMode').value;
    const ids = Array.from(document.querySelectorAll('.crmAccessChk:checked')).map(c => c.value);
    const msg = document.getElementById('crmAccessMsg');
    try {
        await db.collection('settings').doc('crmAccess').set({ mode, employeeIds: ids, updatedAt: new Date().toISOString() }, { merge: true });
        crmAccess = { mode, employeeIds: ids };
        if (msg) { msg.textContent = '✅ 저장 완료'; msg.style.color = 'var(--green)'; setTimeout(() => msg.textContent = '', 2000); }
    } catch (e) { if (msg) { msg.textContent = '저장 실패: ' + e.message; msg.style.color = 'var(--red)'; } }
}

// ===== 통합 렌더 (firebase-config.js renderAll 에서 호출) =====
function renderCRM() {
    renderPatients();
    renderCrmSales();
    renderChannels();
    renderPriceList();
    renderCrmAccess();
}
