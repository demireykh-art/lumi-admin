// ============================================================
//  crm-shell.js — 사이드바 레이아웃 셸 + ⚙️설정(직원·문제점·오더·재고)
//  patients.js / fee-schedule.js / crm.html(bootstrap) 와 전역 스코프 공유
//  의존 전역: db, patients, visits, employees, treatmentCategories,
//            inventoryItems, _boardDate, _detailPatientId, escapeHtml,
//            deriveFromRRN, variantDesc, quickAddItem, empName, tagChips,
//            roleLabels, currentCrmCanEditFees, formatCurrency,
//            openModal, closeModal, crmShowView, openPatientDetail, boardShift, boardToday
// ============================================================
(function () {
    'use strict';
    function $(id) { return document.getElementById(id); }
    function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

    // ---- ① 차팅 워크스페이스를 모달 → 인라인(#chartMount) 으로 이동 ----
    function relocateChart() {
        const modal = $('patientDetailModal');
        const mount = $('chartMount');
        if (modal && mount) {
            const grid = modal.querySelector('.ws-grid');
            if (grid) mount.appendChild(grid);
            modal.remove();
        }
        injectProblemBar();
    }
    // 오더 섹션 위에 "문제점 선택 → 오더 자동추가" 핑크 바 주입
    function injectProblemBar() {
        const sel = $('visitCatSel');
        if (!sel || $('problemQuickBar')) return;
        const sec = sel.closest('.chart-sec');
        if (!sec || !sec.parentNode) return;
        const bar = document.createElement('div');
        bar.id = 'problemQuickBar';
        bar.innerHTML =
            '<label>🩹 문제점 선택 → 오더 자동추가</label>' +
            '<select class="form-select" id="chartProblemSel" onchange="crmRenderProblemOrders()" style="margin-top:.35rem"></select>' +
            '<div id="chartProblemOrders"></div>';
        sec.parentNode.insertBefore(bar, sec);
        crmRenderProblemSel();
    }

    // ============================================================
    //  사이드바 예약/검색 목록
    // ============================================================
    function todayStr() { return new Date().toISOString().slice(0, 10); }

    window.sideRenderList = function () {
        const wrap = $('sideResvList'); if (!wrap) return;
        const bd = (typeof _boardDate !== 'undefined') ? _boardDate : todayStr();
        const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(bd).getDay()];
        setText('sideDateLabel', `${bd.slice(5)} (${wd})`);

        const vis = (typeof visits !== 'undefined' && Array.isArray(visits)) ? visits : [];
        const pts = (typeof patients !== 'undefined' && Array.isArray(patients)) ? patients : [];
        const resv = vis.filter(v => v.nextReservation === bd);
        const doneToday = vis.filter(v => v.date === bd);
        const doneSet = new Set(doneToday.map(v => v.patientId));
        const past = bd < todayStr();
        const noShow = resv.filter(v => !doneSet.has(v.patientId) && past);
        setText('sideResvCount', resv.length);
        setText('sideDoneCount', doneToday.length);
        setText('sideNoShowCount', noShow.length);

        const q = ($('sideSearch') && $('sideSearch').value || '').trim().toLowerCase();
        let cards;
        if (q) {
            cards = pts.filter(p => (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q))
                .slice(0, 60).map(p => sideCard(p.id, p, null, '검색'));
        } else if (!resv.length) {
            wrap.innerHTML = '<div style="padding:1.5rem .5rem;text-align:center;color:#7A8199;font-size:.8rem">이 날짜 예약이 없습니다.<br>상단 검색으로 고객을 찾으세요.</div>';
            return;
        } else {
            cards = resv.map(v => {
                const p = pts.find(x => x.id === v.patientId);
                const status = doneSet.has(v.patientId) ? '완료' : (past ? '부도' : '예약');
                return sideCard(v.patientId, p, v, status);
            });
        }
        wrap.innerHTML = cards.join('') || '<div style="padding:1.5rem;text-align:center;color:#7A8199;font-size:.8rem">결과 없음</div>';
    };
    function sideCard(pid, p, v, status) {
        const name = escapeHtml((v && v.patientName) || (p && p.name) || '-');
        let sex = '', age = '';
        try { if (p) { const d = deriveFromRRN(p.rrnFront, p.rrnGender); sex = d.sex || ''; age = d.age || ''; } } catch (_) { }
        const tags = (p && Array.isArray(p.tags) ? p.tags : []).slice(0, 3)
            .map(t => `<span class="rc-tag">${escapeHtml(t)}</span>`).join('');
        const sel = (typeof _detailPatientId !== 'undefined' && pid === _detailPatientId) ? ' sel' : '';
        const stColor = status === '완료' ? '#34D399' : status === '부도' ? '#F87171' : status === '검색' ? '#93A0BD' : '#C7CBD6';
        const sub = [sex && age ? `${sex}/${age}` : '', (p && p.phone) ? escapeHtml(p.phone) : '', (p && p.isJapanese) ? '🇯🇵' : ''].filter(Boolean).join(' · ');
        return `<div class="resv-card${sel}" onclick="openPatientDetail('${pid}')">
            <div class="rc-name">${name} <span style="font-size:.68rem;font-weight:600;color:${stColor}">${status}</span></div>
            ${sub ? `<div class="rc-sub">${sub}</div>` : ''}
            ${tags ? `<div class="rc-tags">${tags}</div>` : ''}
        </div>`;
    }
    window.sideShift = function (d) { if (typeof boardShift === 'function') boardShift(d); window.sideRenderList(); };
    window.sideToday = function () { if (typeof boardToday === 'function') boardToday(); window.sideRenderList(); };

    // ============================================================
    //  문제점(crmProblems) 로드 + 차팅 퀵바
    // ============================================================
    window.crmProblems = [];
    window.loadCrmProblems = async function () {
        try {
            const s = await db.collection('crmProblems').get();
            window.crmProblems = s.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.name || '').localeCompare(b.name || ''));
        } catch (e) { console.warn('문제점 로드 실패:', e); window.crmProblems = []; }
        crmRenderProblemSel();
        if ($('setpane-problems') && $('setpane-problems').classList.contains('active')) renderSettingsProblems();
    };
    window.crmRenderProblemSel = function () {
        const sel = $('chartProblemSel'); if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">문제점 선택…</option>' +
            window.crmProblems.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        if (cur) sel.value = cur;
        crmRenderProblemOrders();
    };
    window.crmRenderProblemOrders = function () {
        const box = $('chartProblemOrders'); if (!box) return;
        const sel = $('chartProblemSel');
        const prob = window.crmProblems.find(p => p.id === (sel && sel.value));
        if (!prob || !(prob.orders || []).length) { box.innerHTML = ''; return; }
        box.innerHTML = (prob.orders || []).map((o, oi) =>
            `<span class="po-chip" onclick="crmAddProblemOrder('${prob.id}',${oi})" title="클릭하면 오더에 추가">${escapeHtml(o.label || '(오더)')}</span>`
        ).join('');
    };
    window.crmAddProblemOrder = function (pid, oi) {
        const prob = window.crmProblems.find(p => p.id === pid); if (!prob) return;
        const o = (prob.orders || [])[oi]; if (!o) return;
        if (o.cat && o.treat && typeof treatmentCategories !== 'undefined') {
            const ci = treatmentCategories.findIndex(c => c.name === o.cat);
            if (ci >= 0) {
                const ti = treatmentCategories[ci].treatments.findIndex(t => t.name === o.treat);
                if (ti >= 0) {
                    const t = treatmentCategories[ci].treatments[ti];
                    const vi = (t.variants || []).findIndex(v => variantDesc(v) === o.variant);
                    if (vi >= 0) { const q = Math.max(1, o.qty || 1); for (let k = 0; k < q; k++) quickAddItem(ci, ti, vi); return; }
                }
            }
        }
        // 매칭 실패 또는 직접입력 오더 → 오더 메모에 추가
        const m = $('visitMemo');
        if (m) { m.value = (m.value ? m.value + '\n' : '') + (o.label || ''); if (typeof autoGrow === 'function') autoGrow(m); }
        else alert('오더 추가: ' + (o.label || ''));
    };

    // ============================================================
    //  ⚙️ 설정 모달
    // ============================================================
    window.openSettings = function () {
        openModal('settingsModal');
        renderSettingsStaff();
        renderSettingsProblems();
        renderSettingsInv();
        setTab('staff');
    };
    window.setTab = function (pane) {
        document.querySelectorAll('#settingsModal .set-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === pane));
        document.querySelectorAll('#settingsModal .set-pane').forEach(p => p.classList.remove('active'));
        const el = $('setpane-' + pane); if (el) el.classList.add('active');
    };

    // ---- 직원 목록 (읽기 전용, admin에서 관리) ----
    function renderSettingsStaff() {
        const wrap = $('setpane-staff'); if (!wrap) return;
        const emps = (typeof employees !== 'undefined' && Array.isArray(employees)) ? employees : [];
        const rl = (typeof roleLabels !== 'undefined') ? roleLabels : {};
        const active = emps.filter(e => e.status !== 'resigned' && e.status !== '퇴사');
        const rows = active.map(e => `<tr>
            <td>${escapeHtml(e.name || e.id)}</td>
            <td>${escapeHtml(rl[e.role] || e.role || '-')}</td>
            <td>${escapeHtml(e.staffId || '')}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${escapeHtml(e.email || '')}</td>
        </tr>`).join('');
        wrap.innerHTML = `
            <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.6rem">admin(직원관리)에 등록된 직원입니다. 추가·수정·삭제는 admin에서 하세요.</div>
            <div class="table-container"><table><thead><tr><th>이름</th><th>직무</th><th>ID</th><th>이메일</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">등록된 직원이 없습니다.</td></tr>'}</tbody></table></div>`;
    }

    // ---- 문제점 · 오더 (CRUD) ----
    function canEdit() { return (typeof currentCrmCanEditFees !== 'undefined') && currentCrmCanEditFees; }
    function renderSettingsProblems() {
        const wrap = $('setpane-problems'); if (!wrap) return;
        const edit = canEdit();
        const cats = (typeof treatmentCategories !== 'undefined') ? treatmentCategories : [];
        const addBar = edit ? `
            <div style="display:flex;gap:.4rem;margin-bottom:.8rem">
                <input class="form-input" id="newProblemName" placeholder="새 문제점 (예: 색소·모공·탄력)" style="flex:1" onkeydown="if(event.key==='Enter')crmAddProblem()">
                <button class="btn btn-primary" onclick="crmAddProblem()">+ 문제점 추가</button>
            </div>` : '<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.6rem">※ 편집 권한(관리자/실장)이 없어 보기 전용입니다.</div>';

        const catOpts = '<option value="">카테고리</option>' + cats.map((c, i) => `<option value="${i}">${escapeHtml(c.name)}</option>`).join('');

        const body = window.crmProblems.map((prob, pi) => {
            const chips = (prob.orders || []).map((o, oi) =>
                `<span class="po-chip" style="cursor:default">${escapeHtml(o.label || '')}${edit ? ` <span onclick="crmDelOrder('${prob.id}',${oi})" style="cursor:pointer;color:#DB2777;font-weight:700">×</span>` : ''}</span>`
            ).join('') || '<span style="font-size:.76rem;color:var(--text-muted)">등록된 오더 없음</span>';
            const orderAdder = edit ? `
                <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.45rem;align-items:center">
                    <select class="form-select" id="poCat${pi}" onchange="crmPoCatChange(${pi})" style="flex:1;min-width:100px">${catOpts}</select>
                    <select class="form-select" id="poTreat${pi}" onchange="crmPoTreatChange(${pi})" style="flex:1;min-width:100px"><option value="">시술</option></select>
                    <select class="form-select" id="poVar${pi}" style="flex:1.2;min-width:110px"><option value="">옵션</option></select>
                    <input type="number" class="form-input" id="poQty${pi}" value="1" min="1" style="width:52px" title="수량">
                    <button class="btn btn-secondary btn-sm" onclick="crmAddTreatOrder('${prob.id}',${pi})">+ 시술오더</button>
                </div>
                <div style="display:flex;gap:.3rem;margin-top:.35rem">
                    <input class="form-input" id="poText${pi}" placeholder="직접입력 오더 (예: 진정관리 안내)" style="flex:1" onkeydown="if(event.key==='Enter')crmAddTextOrder('${prob.id}',${pi})">
                    <button class="btn btn-outline btn-sm" onclick="crmAddTextOrder('${prob.id}',${pi})">+ 직접입력</button>
                </div>` : '';
            return `<div style="border:1px solid #E9EAF0;border-radius:10px;padding:.6rem .7rem;margin-bottom:.6rem">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem">
                    <strong style="font-size:.95rem">${escapeHtml(prob.name)}</strong>
                    ${edit ? `<button class="btn btn-outline btn-sm" onclick="crmRenameProblem('${prob.id}')" style="margin-left:auto">이름수정</button>
                    <button class="btn btn-danger btn-sm" onclick="crmDelProblem('${prob.id}')">삭제</button>` : ''}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:.3rem;align-items:center">${chips}</div>
                ${orderAdder}
            </div>`;
        }).join('');

        wrap.innerHTML = addBar +
            (window.crmProblems.length ? body : '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.85rem">등록된 문제점이 없습니다. 위에서 추가하세요.</div>');
    }
    // 문제점 오더 카테고리→시술→옵션 캐스케이드 (설정 화면)
    window.crmPoCatChange = function (pi) {
        const ci = $('poCat' + pi).value;
        const tSel = $('poTreat' + pi), vSel = $('poVar' + pi);
        vSel.innerHTML = '<option value="">옵션</option>';
        if (ci === '') { tSel.innerHTML = '<option value="">시술</option>'; return; }
        const cat = treatmentCategories[ci];
        tSel.innerHTML = '<option value="">시술</option>' + cat.treatments.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('');
    };
    window.crmPoTreatChange = function (pi) {
        const ci = $('poCat' + pi).value, ti = $('poTreat' + pi).value, vSel = $('poVar' + pi);
        if (ci === '' || ti === '') { vSel.innerHTML = '<option value="">옵션</option>'; return; }
        const t = treatmentCategories[ci].treatments[ti];
        vSel.innerHTML = '<option value="">옵션</option>' + (t.variants || []).map((v, i) => `<option value="${i}">${escapeHtml(variantDesc(v))} — ${v.price}만</option>`).join('');
    };
    async function saveProblem(prob) {
        const data = { name: prob.name, sort: prob.sort || 0, orders: prob.orders || [] };
        if (prob.id) await db.collection('crmProblems').doc(prob.id).set(data, { merge: true });
        else await db.collection('crmProblems').add(data);
    }
    window.crmAddProblem = async function () {
        const inp = $('newProblemName'); const name = (inp.value || '').trim();
        if (!name) { inp.focus(); return; }
        try { await db.collection('crmProblems').add({ name, sort: window.crmProblems.length, orders: [] }); inp.value = ''; await window.loadCrmProblems(); renderSettingsProblems(); }
        catch (e) { alert('추가 실패: ' + e.message); }
    };
    window.crmRenameProblem = async function (id) {
        const prob = window.crmProblems.find(p => p.id === id); if (!prob) return;
        const name = prompt('문제점 이름', prob.name); if (name == null) return;
        const t = name.trim(); if (!t) return;
        try { await db.collection('crmProblems').doc(id).update({ name: t }); await window.loadCrmProblems(); renderSettingsProblems(); }
        catch (e) { alert('수정 실패: ' + e.message); }
    };
    window.crmDelProblem = async function (id) {
        const prob = window.crmProblems.find(p => p.id === id); if (!prob) return;
        if (!confirm(`"${prob.name}" 문제점을 삭제할까요?`)) return;
        try { await db.collection('crmProblems').doc(id).delete(); await window.loadCrmProblems(); renderSettingsProblems(); }
        catch (e) { alert('삭제 실패: ' + e.message); }
    };
    window.crmAddTreatOrder = async function (id, pi) {
        const ci = $('poCat' + pi).value, ti = $('poTreat' + pi).value, vi = $('poVar' + pi).value;
        const qty = parseInt($('poQty' + pi).value) || 1;
        if (ci === '' || ti === '' || vi === '') { alert('카테고리·시술·옵션을 선택하세요.'); return; }
        const cat = treatmentCategories[ci], t = cat.treatments[ti], v = t.variants[vi];
        const vd = variantDesc(v);
        const order = { label: `${t.name} ${vd}${qty > 1 ? ' ×' + qty : ''}`, cat: cat.name, treat: t.name, variant: vd, qty };
        await appendOrder(id, order);
    };
    window.crmAddTextOrder = async function (id, pi) {
        const inp = $('poText' + pi); const txt = (inp.value || '').trim();
        if (!txt) { inp.focus(); return; }
        await appendOrder(id, { label: txt, text: true });
        inp.value = '';
    };
    async function appendOrder(id, order) {
        const prob = window.crmProblems.find(p => p.id === id); if (!prob) return;
        const orders = (prob.orders || []).concat([order]);
        try { await db.collection('crmProblems').doc(id).update({ orders }); await window.loadCrmProblems(); renderSettingsProblems(); }
        catch (e) { alert('오더 추가 실패: ' + e.message); }
    }
    window.crmDelOrder = async function (id, oi) {
        const prob = window.crmProblems.find(p => p.id === id); if (!prob) return;
        const orders = (prob.orders || []).slice(); orders.splice(oi, 1);
        try { await db.collection('crmProblems').doc(id).update({ orders }); await window.loadCrmProblems(); renderSettingsProblems(); }
        catch (e) { alert('삭제 실패: ' + e.message); }
    };

    // ---- 재고 현황 (읽기 전용, inventory 컬렉션) ----
    function invStockOf(it) {
        if (typeof it.currentStock === 'number') return it.currentStock;
        if (it.locations && typeof it.locations === 'object') return Object.values(it.locations).reduce((s, n) => s + (Number(n) || 0), 0);
        return Number(it.currentStock) || 0;
    }
    function renderSettingsInv() {
        const wrap = $('setpane-inv'); if (!wrap) return;
        const items = (typeof inventoryItems !== 'undefined' && Array.isArray(inventoryItems)) ? inventoryItems
            : (typeof recipes !== 'undefined' ? [] : []);
        if (!items.length) {
            wrap.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.85rem">재고 데이터를 불러오지 못했습니다. (admin에서 물품을 등록하세요)</div>';
            return;
        }
        const low = items.filter(it => invStockOf(it) < (Number(it.safetyStock) || 0));
        const q0 = '';
        const summary = `<div class="cards-grid" style="margin-bottom:.7rem">
            <div class="card"><div class="card-label">총 품목</div><div class="card-value">${items.length}</div></div>
            <div class="card"><div class="card-label">재고 부족</div><div class="card-value" style="color:#DB2777">${low.length}</div></div>
        </div>`;
        const rows = items.slice().sort((a, b) => (invStockOf(a) - (a.safetyStock || 0)) - (invStockOf(b) - (b.safetyStock || 0)))
            .map(it => {
                const cur = invStockOf(it);
                const lowf = cur < (Number(it.safetyStock) || 0);
                const locs = (it.locations && typeof it.locations === 'object')
                    ? Object.entries(it.locations).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${escapeHtml(k)}:${n}`).join(', ')
                    : escapeHtml(it.location || '');
                return `<tr${lowf ? ' style="background:#FEF2F7"' : ''}>
                    <td>${escapeHtml(it.name || '')}</td>
                    <td style="font-size:.78rem;color:var(--text-muted)">${escapeHtml(it.productGroup || it.category || it.type || '')}</td>
                    <td class="text-right" style="font-weight:700;color:${lowf ? '#DB2777' : '#16A34A'}">${cur}${escapeHtml(it.unit || '')}</td>
                    <td class="text-right" style="font-size:.8rem;color:var(--text-muted)">${Number(it.safetyStock) || 0}</td>
                    <td style="font-size:.74rem;color:#1976d2">${locs || '-'}</td>
                </tr>`;
            }).join('');
        wrap.innerHTML = summary +
            `<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem">※ 물품 등록·위치 수정은 재고 앱(staff.html)에서 하세요. 여기서는 현황만 봅니다.</div>
            <div class="table-container" style="max-height:52vh;overflow:auto"><table><thead><tr><th>품목</th><th>제품군</th><th class="text-right">현재고</th><th class="text-right">안전</th><th>위치</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    // ---- 초기화 ----
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relocateChart);
    else relocateChart();
})();
