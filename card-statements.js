/* ===== card-statements.js ============================================
 * 카드 명세서 시스템:
 *  - 카드 마스터 (cards 컬렉션)
 *  - 카테고리 자동 매핑 룰 (categoryRules 컬렉션, 학습 가능)
 *  - PG/결제대행 prefix 정규화
 *  - 4사 명세서 파서 (현대/롯데/삼성/신한) — 합계행 자동 스킵
 *  - 카드 자동 매칭 (양식의 카드 식별자 → cards.aliasPatterns)
 *  - 개인사용 플래그 (관리자가 행별 토글)
 *
 * 의존성 전역: db, employees, expenseCategories, classifyExpense
 * 호출 진입점: card-statements.js를 index.html에서 로드 후
 *   - initCardStatements() : 데이터 초기 로드
 *   - renderCardManagement() : 카드 관리 sub-tab 렌더
 *   - parseCardStatement(rows, fileName) : detectAndParse에서 위임
 * ===================================================================== */

// ───── 전역 상태 ─────
let cards = [];                     // [{id,alias,issuer,aliasPatterns:[],ownerEmpId,defaultPersonal,active}]
let categoryRules = [];             // [{id,merchantNorm,categoryId,isPersonal,timesUsed,lastUsed}]
let _cardsLoaded = false;
let _rulesLoaded = false;

// ───── PG/결제대행 정규화 ─────
const PG_PREFIX_PATTERNS = [
    /^한국정보통신\s*-\s*/,
    /^나이스\s*-\s*/,
    /^KCP\s*-\s*/,
    /^\(주\)이니시스\s*-\s*/,
    /^토스페이먼츠주식회사\s*-\s*/,
    /^토스페이먼츠\s*-\s*/,
    /^퍼스트데이터코리아\(유\)\s*-\s*/,
    /^롯데쇼핑㈜\s+/,
    /^삼성카드\s+/,
    /^네이버페이\s+/,
    /^컬리페이[_\s]+/,
    /^배민클럽[_\s]+/,
];

// 외화 표기 (가맹점명 끝에 ',USD:24.02' 등) 분리
const FX_TAIL_REGEX = /,\s*([A-Z]{3}):([0-9.,]+)\s*$/;

function normalizeMerchant(rawName){
    if(!rawName) return {merchantNorm:'', isOverseas:false, fxAmount:''};
    let s = String(rawName).trim();
    let isOverseas = false, fxAmount = '';
    const fx = s.match(FX_TAIL_REGEX);
    if(fx){
        isOverseas = true;
        fxAmount = `${fx[1]} ${fx[2]}`;
        s = s.replace(FX_TAIL_REGEX, '').trim();
    }
    for(const p of PG_PREFIX_PATTERNS){
        const m = s.match(p);
        if(m){ s = s.slice(m[0].length); break; }
    }
    // 끝의 잔여 공백/구두점
    s = s.replace(/\s+/g,' ').trim();
    return {merchantNorm:s, isOverseas, fxAmount};
}

// ───── 합계/소계 행 판별 ─────
function isSummaryRow(rowText){
    if(!rowText) return false;
    const t = String(rowText).replace(/\s/g,'');
    // "일시불소계 121건", "합계", "총건수", "할부소계", "해외소계" 등
    if(/소계\d*건?/.test(t)) return true;
    if(/^(합계|총합|총건수|총건|소계|총금액)/.test(t)) return true;
    return false;
}

// ───── 날짜 정규화 (expense.js의 normalizeDate 재사용 가능하지만 안전을 위해 자체 구현) ─────
function cardNormalizeDate(raw){
    if(typeof normalizeDate === 'function') return normalizeDate(raw);
    if(!raw) return '';
    const s = String(raw).trim();
    let m = s.match(/(\d{4})\s*[년\.\-\/]\s*(\d{1,2})\s*[월\.\-\/]\s*(\d{1,2})/);
    if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    return '';
}

function cardNormalizeAmount(raw){
    if(typeof normalizeAmount === 'function') return normalizeAmount(raw);
    if(!raw && raw!==0) return 0;
    const s = String(raw).replace(/[",\s원₩]/g,'');
    return parseInt(s) || 0;
}

// ───── 카드 자동 매칭 ─────
// raw: 양식에서 추출한 카드 식별자 (이용카드 텍스트, 카드번호 마스킹 등)
function findCardByAlias(raw){
    if(!raw) return null;
    const s = String(raw).trim();
    // last4 매칭 (마스킹된 카드번호에서 끝 4자리)
    const last4Match = s.match(/(\d{4})$/);
    const last4 = last4Match ? last4Match[1] : '';
    const last3 = s.match(/(\d{3})\*?$/)?.[1] || '';
    for(const c of cards){
        if(!c.active && c.active !== undefined) continue;
        const patterns = c.aliasPatterns || [];
        for(const p of patterns){
            if(!p) continue;
            const pat = String(p).trim();
            if(s === pat) return c;
            if(s.includes(pat)) return c;
            if(last4 && pat === last4) return c;
            if(last3 && pat === last3) return c;
        }
    }
    return null;
}

// ───── 룰 자동 추천 ─────
function suggestFromRules(merchantNorm){
    if(!merchantNorm) return null;
    const m = merchantNorm.toLowerCase();
    // 정확 일치 우선
    let exact = categoryRules.find(r => (r.merchantNorm||'').toLowerCase() === m);
    if(exact) return exact;
    // contains (가장 긴 패턴 우선)
    const contains = categoryRules
        .filter(r => r.merchantNorm && m.includes(r.merchantNorm.toLowerCase()))
        .sort((a,b)=>b.merchantNorm.length - a.merchantNorm.length);
    return contains[0] || null;
}

// ───── 카드사별 파서 ─────

// 헤더에서 컬럼 인덱스 매핑 헬퍼
function findCol(header, ...keywords){
    return header.findIndex(h => {
        const t = (h||'').replace(/\s/g,'');
        return keywords.some(k => t.includes(k.replace(/\s/g,'')));
    });
}

function findHeaderRow(rows, key){
    for(let i=0;i<Math.min(rows.length,30);i++){
        if(rows[i] && rows[i].some(c => (c||'').replace(/\s/g,'').includes(key.replace(/\s/g,'')))){
            return i;
        }
    }
    return -1;
}

function parseHyundaiCard(rows, fileName){
    const hi = findHeaderRow(rows, '이용가맹점');
    if(hi < 0) return [];
    const header = rows[hi];
    const iDate = findCol(header, '이용일');
    const iCard = findCol(header, '이용카드');
    const iName = findCol(header, '이용가맹점','가맹점명');
    const iAmt  = findCol(header, '결제원금','이용금액');  // 결제원금 우선
    const iInst = findCol(header, '할부','회차');
    if(iDate<0 || iName<0 || iAmt<0) return [];

    const results = [];
    for(let i=hi+1;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r.length) continue;
        const joined = r.map(x=>String(x||'')).join(' ').trim();
        if(!joined) continue;
        if(isSummaryRow(joined)) continue;
        const date = cardNormalizeDate(r[iDate]);
        if(!date) continue;
        const amount = cardNormalizeAmount(r[iAmt]);
        if(amount === 0) continue;
        const cardRaw = (r[iCard]||'').trim();
        const merchantRaw = (r[iName]||'').trim();
        const norm = normalizeMerchant(merchantRaw);
        const installment = (r[iInst]||'').trim();
        const card = findCardByAlias(cardRaw);
        results.push(makeRow({
            source:'현대카드', issuer:'hyundai',
            date, amount,
            cardRaw, cardId: card?.id || null,
            cardLabel: card?.alias || cardRaw,
            defaultPersonal: !!card?.defaultPersonal,
            merchantRaw, merchantNorm: norm.merchantNorm,
            isOverseas: norm.isOverseas, fxAmount: norm.fxAmount,
            installment, isCancel: amount<0,
            fileName,
        }));
    }
    return results;
}

function parseLotteCard(rows, fileName){
    // 롯데카드는 헤더가 2줄(병합) — '이용일' 행을 헤더로, 다음 행에 서브헤더
    const hi = findHeaderRow(rows, '이용일');
    if(hi < 0) return [];
    const header = rows[hi];
    const iDate = findCol(header, '이용일');
    const iCard = findCol(header, '이용카드');
    const iName = findCol(header, '이용가맹점','가맹점명');
    // 롯데: "이번 달 입금하실 금액"은 병합 헤더, 그 아래 "원금" 컬럼이 실제 결제금액
    // 휴리스틱: 이용가맹점 다음 컬럼들 중 첫 번째 숫자 컬럼을 원금으로 간주
    if(iDate<0 || iName<0) return [];

    // 데이터 첫 행에서 숫자가 들어있는 컬럼들을 찾아 결제 컬럼 추정
    let dataStart = hi + 1;
    // 두 번째 헤더 행(있으면) 스킵: '원금','수수료' 같은 서브헤더
    while(dataStart < rows.length){
        const sub = rows[dataStart];
        if(!sub) break;
        const txt = sub.map(x=>String(x||'')).join('').replace(/\s/g,'');
        if(/원금|수수료|적립예정/.test(txt) && !/\d{4}\.\d/.test(txt)){
            dataStart++;
            continue;
        }
        break;
    }
    // 결제원금 컬럼: 가맹점 다음 컬럼들에서 가장 자주 숫자가 등장하는 첫 컬럼
    const numericCounts = {};
    for(let i=dataStart;i<Math.min(dataStart+20,rows.length);i++){
        const r = rows[i]; if(!r) continue;
        for(let c=iName+1;c<r.length;c++){
            const v = cardNormalizeAmount(r[c]);
            if(v>0){ numericCounts[c] = (numericCounts[c]||0)+1; }
        }
    }
    const iAmt = Object.entries(numericCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if(iAmt === undefined) return [];
    const amtIdx = parseInt(iAmt);

    const results = [];
    for(let i=dataStart;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r.length) continue;
        const joined = r.map(x=>String(x||'')).join(' ').trim();
        if(!joined) continue;
        if(isSummaryRow(joined)) continue;
        const date = cardNormalizeDate(r[iDate]);
        if(!date) continue;
        const amount = cardNormalizeAmount(r[amtIdx]);
        if(amount === 0) continue;
        const cardRaw = iCard>=0 ? (r[iCard]||'').trim() : '';
        const merchantRaw = (r[iName]||'').trim();
        const norm = normalizeMerchant(merchantRaw);
        const card = findCardByAlias(cardRaw);
        results.push(makeRow({
            source:'롯데카드', issuer:'lotte',
            date, amount,
            cardRaw, cardId: card?.id || null,
            cardLabel: card?.alias || cardRaw,
            defaultPersonal: !!card?.defaultPersonal,
            merchantRaw, merchantNorm: norm.merchantNorm,
            isOverseas: norm.isOverseas, fxAmount: norm.fxAmount,
            installment:'', isCancel: amount<0,
            fileName,
        }));
    }
    return results;
}

function parseSamsungCardV2(rows, fileName){
    const hi = findHeaderRow(rows, '승인일자');
    if(hi < 0) return [];
    const header = rows[hi];
    const iDate = findCol(header, '승인일자');
    const iCardNo = findCol(header, '카드번호');
    const iName = findCol(header, '가맹점명','이용가맹점');
    const iAmt = findCol(header, '승인금액','이용금액');
    const iCancel = findCol(header, '취소여부');
    const iInst = findCol(header, '할부개월');
    if(iDate<0 || iName<0 || iAmt<0) return [];

    const results = [];
    for(let i=hi+1;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r.length) continue;
        const joined = r.map(x=>String(x||'')).join(' ').trim();
        if(!joined) continue;
        if(isSummaryRow(joined)) continue;
        const date = cardNormalizeDate(r[iDate]);
        if(!date) continue;
        const rawAmt = (r[iAmt]||'').toString();
        let amount = cardNormalizeAmount(rawAmt);
        if(amount === 0) continue;
        const cancel = iCancel>=0 ? String(r[iCancel]||'').trim() : '';
        const isCancel = (cancel && cancel !== '-') || amount < 0;
        if(isCancel && amount > 0) amount = -amount;  // 취소를 음수로 정규화
        const cardRaw = iCardNo>=0 ? String(r[iCardNo]||'').trim() : '';
        const merchantRaw = (r[iName]||'').trim();
        const norm = normalizeMerchant(merchantRaw);
        const installment = iInst>=0 ? String(r[iInst]||'').trim() : '';
        const card = findCardByAlias(cardRaw);
        results.push(makeRow({
            source:'삼성카드', issuer:'samsung',
            date, amount,
            cardRaw, cardId: card?.id || null,
            cardLabel: card?.alias || cardRaw,
            defaultPersonal: !!card?.defaultPersonal,
            merchantRaw, merchantNorm: norm.merchantNorm,
            isOverseas: norm.isOverseas, fxAmount: norm.fxAmount,
            installment, isCancel,
            fileName,
        }));
    }
    return results;
}

function parseShinhanCardV2(rows, fileName){
    // 신한카드 (개인/사업자 모두): 거래일 + 카드구분 + 가맹점명
    const hi = (function(){
        for(let i=0;i<Math.min(rows.length,30);i++){
            const r = rows[i] || [];
            const has거래일 = r.some(c => (c||'').replace(/\s/g,'').includes('거래일'));
            const has카드구분 = r.some(c => (c||'').replace(/\s/g,'').includes('카드구분'));
            if(has거래일 && has카드구분) return i;
        }
        return findHeaderRow(rows, '거래일');
    })();
    if(hi < 0) return [];
    const header = rows[hi];
    const iDate = findCol(header, '거래일');
    const iKind = findCol(header, '카드구분');
    const iCard = findCol(header, '이용카드');
    const iName = findCol(header, '가맹점명','이용가맹점');
    const iAmt = findCol(header, '금액','이용금액');
    const iCancel = findCol(header, '취소상태');
    const iBuy = findCol(header, '매입구분');
    const iInst = findCol(header, '이용구분');
    if(iDate<0 || iName<0 || iAmt<0) return [];

    const results = [];
    for(let i=hi+1;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r.length) continue;
        const joined = r.map(x=>String(x||'')).join(' ').trim();
        if(!joined) continue;
        if(isSummaryRow(joined)) continue;
        const date = cardNormalizeDate(r[iDate]);
        if(!date) continue;
        let amount = cardNormalizeAmount(r[iAmt]);
        if(amount === 0) continue;
        const cancel = iCancel>=0 ? String(r[iCancel]||'').trim() : '';
        const buy = iBuy>=0 ? String(r[iBuy]||'').trim() : '';
        const isCancel = !!cancel || /취소/.test(buy) || amount < 0;
        if(isCancel && amount > 0) amount = -amount;
        const cardKind = iKind>=0 ? (String(r[iKind]||'').trim()==='체크' ? 'check' : 'credit') : null;
        const cardRaw = iCard>=0 ? String(r[iCard]||'').trim() : '';
        const merchantRaw = (r[iName]||'').trim();
        const norm = normalizeMerchant(merchantRaw);
        const installment = iInst>=0 ? String(r[iInst]||'').trim() : '';
        const card = findCardByAlias(cardRaw);
        results.push(makeRow({
            source:'신한카드', issuer:'shinhan',
            date, amount,
            cardRaw, cardId: card?.id || null,
            cardLabel: card?.alias || cardRaw,
            defaultPersonal: !!card?.defaultPersonal,
            merchantRaw, merchantNorm: norm.merchantNorm,
            isOverseas: norm.isOverseas, fxAmount: norm.fxAmount,
            installment, isCancel, cardKind,
            fileName,
        }));
    }
    return results;
}

// ───── 통합 행 객체 생성 + 자동 카테고리 추정 ─────
function makeRow(opts){
    const rec = suggestFromRules(opts.merchantNorm);
    let category = '기타', isPersonal = !!opts.defaultPersonal;
    if(rec){
        category = rec.categoryId;
        if(rec.isPersonal) isPersonal = true;
    } else {
        // 룰이 없으면 기존 키워드 기반 classifyExpense 시도
        if(typeof classifyExpense === 'function'){
            const c = classifyExpense(opts.merchantNorm || opts.merchantRaw);
            if(c?.category) category = c.category;
            if(c?.exclude) isPersonal = true;  // 기존 exclude → personal로 매핑
        }
    }
    return {
        source: opts.source,
        issuer: opts.issuer,
        date: opts.date,
        amount: opts.amount,
        cardRaw: opts.cardRaw||'',
        cardId: opts.cardId||null,
        cardLabel: opts.cardLabel||'',
        merchantRaw: opts.merchantRaw,
        merchantNorm: opts.merchantNorm || opts.merchantRaw,
        isOverseas: !!opts.isOverseas,
        fxAmount: opts.fxAmount||'',
        installment: opts.installment||'',
        isCancel: !!opts.isCancel,
        cardKind: opts.cardKind||null,
        category,                              // expenseCategories의 id
        isPersonal,                            // true면 사업비에서 제외, 개인사용 리포트로
        exclude: false,                        // 사용자가 명시적으로 제외 (저장 안 함)
        fileName: opts.fileName,
        note: `[${opts.source}] ${opts.merchantNorm||opts.merchantRaw}` +
              (opts.isOverseas?` (${opts.fxAmount})`:'') +
              (opts.installment?` ${opts.installment}`:'') +
              (opts.isCancel?' [취소/환불]':''),
        name: opts.merchantNorm || opts.merchantRaw,  // 기존 expense 시스템 호환
    };
}

// ───── detectAndParse 위임 진입점 ─────
function parseCardStatement(rows, fileName){
    const headerText = rows.slice(0,30).map(r=>(r||[]).join(',')).join('\n');
    if(/이용가맹점/.test(headerText) && /할부\/회차/.test(headerText))    return parseHyundaiCard(rows, fileName);
    if(/이용총액/.test(headerText) && /적립예정/.test(headerText))         return parseLotteCard(rows, fileName);
    if(/카드번호/.test(headerText) && /승인일자/.test(headerText))         return parseSamsungCardV2(rows, fileName);
    if(/거래일/.test(headerText)   && /카드구분/.test(headerText))         return parseShinhanCardV2(rows, fileName);
    return null;  // 미인식 → 기존 detectAndParse가 다른 파서 시도
}

// ───── Firestore: 카드 마스터 로드/저장 ─────
async function loadCards(){
    try{
        const s = await db.collection('cards').orderBy('alias').get();
        cards = s.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){
        console.warn('cards 로드 실패:', e);
        cards = [];
    }
    _cardsLoaded = true;
}

async function saveCard(data, editId){
    if(editId){
        await db.collection('cards').doc(editId).update({...data, updatedAt: new Date().toISOString()});
    } else {
        await db.collection('cards').add({...data, createdAt: new Date().toISOString()});
    }
    await loadCards();
    renderCardManagement();
}

async function deleteCard(id){
    if(!confirm('이 카드를 삭제하시겠습니까? (저장된 명세서 거래에는 영향 없음)')) return;
    await db.collection('cards').doc(id).delete();
    await loadCards();
    renderCardManagement();
}

// ───── Firestore: 카테고리 룰 로드/저장 ─────
async function loadCategoryRules(){
    try{
        const s = await db.collection('categoryRules').get();
        categoryRules = s.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){
        console.warn('categoryRules 로드 실패:', e);
        categoryRules = [];
    }
    _rulesLoaded = true;
}

// 룰 학습/갱신: 같은 merchantNorm이 있으면 갱신, 없으면 추가
async function learnRule(merchantNorm, categoryId, isPersonal){
    if(!merchantNorm || !categoryId || categoryId==='unknown') return;
    const existing = categoryRules.find(r => (r.merchantNorm||'').toLowerCase() === merchantNorm.toLowerCase());
    if(existing){
        if(existing.categoryId === categoryId && !!existing.isPersonal === !!isPersonal){
            // 동일 → timesUsed만 증가
            try{
                await db.collection('categoryRules').doc(existing.id).update({
                    timesUsed: (existing.timesUsed||0) + 1,
                    lastUsed: new Date().toISOString(),
                });
            }catch(_){}
            existing.timesUsed = (existing.timesUsed||0)+1;
            return;
        }
        // 분류 변경 → 갱신
        try{
            await db.collection('categoryRules').doc(existing.id).update({
                categoryId, isPersonal: !!isPersonal,
                timesUsed: (existing.timesUsed||0) + 1,
                lastUsed: new Date().toISOString(),
            });
        }catch(_){}
        existing.categoryId = categoryId;
        existing.isPersonal = !!isPersonal;
        return;
    }
    // 신규 룰
    try{
        const ref = await db.collection('categoryRules').add({
            merchantNorm, categoryId, isPersonal: !!isPersonal,
            timesUsed: 1, source: 'learned',
            lastUsed: new Date().toISOString(),
            createdAt: new Date().toISOString(),
        });
        categoryRules.push({id: ref.id, merchantNorm, categoryId, isPersonal: !!isPersonal, timesUsed:1, source:'learned'});
    }catch(_){}
}

// ───── 카드 관리 UI ─────
function renderCardManagement(){
    const tbody = document.getElementById('cardsTable');
    if(!tbody) return;
    if(!cards.length){
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:#888;padding:1rem">등록된 카드가 없습니다. + 카드 추가 버튼으로 등록하세요.</td></tr>';
        return;
    }
    const issuerLabel = {hyundai:'현대', lotte:'롯데', samsung:'삼성', shinhan:'신한', kb:'KB', bc:'BC', woori:'우리', hana:'하나', other:'기타'};
    tbody.innerHTML = cards.map(c=>{
        const owner = (c.ownerEmpId && employees) ? (employees.find(e=>e.id===c.ownerEmpId)?.name || c.ownerEmpId) : '법인';
        const personal = c.defaultPersonal ? '<span class="badge" style="background:#fde8e8;color:#9b1c1c">개인 기본</span>' : '<span class="badge" style="background:#e8f4fd;color:#1e40af">사업 기본</span>';
        const patterns = (c.aliasPatterns||[]).map(p=>`<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:.75rem">${p}</code>`).join(' ');
        return `<tr>
            <td><strong>${c.alias||''}</strong></td>
            <td>${issuerLabel[c.issuer]||c.issuer||'-'}</td>
            <td>${patterns||'-'}</td>
            <td>${owner}</td>
            <td>${personal}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="openCardModal('${c.id}')">수정</button>
                <button class="btn btn-sm btn-danger" onclick="deleteCard('${c.id}')">삭제</button>
            </td>
        </tr>`;
    }).join('');
}

function openCardModal(cardId){
    const isEdit = !!cardId;
    const c = isEdit ? cards.find(x=>x.id===cardId) : null;
    document.getElementById('cardModalTitle').textContent = isEdit ? '카드 수정' : '카드 등록';
    document.getElementById('cardEditId').value = cardId || '';
    document.getElementById('cardAlias').value = c?.alias || '';
    document.getElementById('cardIssuer').value = c?.issuer || 'hyundai';
    document.getElementById('cardAliasPatterns').value = (c?.aliasPatterns||[]).join(', ');
    document.getElementById('cardDefaultPersonal').checked = !!c?.defaultPersonal;
    // 직원 선택
    const sel = document.getElementById('cardOwnerEmp');
    if(sel){
        sel.innerHTML = '<option value="">법인</option>' +
            (employees||[]).filter(e=>e.status==='active').map(e=>`<option value="${e.id}"${c?.ownerEmpId===e.id?' selected':''}>${e.name}</option>`).join('');
    }
    document.getElementById('cardModal').style.display = 'flex';
}

function closeCardModal(){ document.getElementById('cardModal').style.display = 'none'; }

async function saveCardModal(){
    const editId = document.getElementById('cardEditId').value;
    const alias = document.getElementById('cardAlias').value.trim();
    const issuer = document.getElementById('cardIssuer').value;
    const patternsRaw = document.getElementById('cardAliasPatterns').value.trim();
    const defaultPersonal = document.getElementById('cardDefaultPersonal').checked;
    const ownerEmpId = document.getElementById('cardOwnerEmp').value || '';
    if(!alias){ alert('카드 별칭을 입력하세요.'); return; }
    const aliasPatterns = patternsRaw.split(',').map(s=>s.trim()).filter(Boolean);
    const data = { alias, issuer, aliasPatterns, defaultPersonal, ownerEmpId, active: true };
    try{
        await saveCard(data, editId);
        closeCardModal();
    }catch(e){ alert('저장 실패: ' + e.message); }
}

// ───── 초기화 (initApp에서 호출) ─────
async function initCardStatements(){
    await Promise.all([loadCards(), loadCategoryRules()]);
    renderCardManagement();
}
