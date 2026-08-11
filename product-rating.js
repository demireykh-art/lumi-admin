// ===== 제품별 평점 (Product Rating) =====
// 상품/오더별로 여러 평가 항목(수분, 피부결, 잔주름, 모공 등)에 대해
// 3점 만점 별점을 부여·관리하는 탭. 헤더(평가항목)와 행(상품)을 자유롭게
// 추가·수정·삭제할 수 있으며, Firestore(productRatings/main) 단일 문서에 저장된다.

const RATING_MAX = 3;
const DEFAULT_RATING_COLUMNS = ['수분', '피부결', '잔주름', '모공'];
// 전역 상태: { columns:[...], rows:[{name, ratings:{항목:점수}}] }
let productRatingState = null;

// HTML 속성값 이스케이프 (사용자 입력 상품명/항목명 안전 삽입용)
function _ratingEscAttr(s){
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── 데이터 로드 ──
async function loadProductRatings(){
    try{
        const doc = await db.collection('productRatings').doc('main').get();
        if(doc.exists){
            const d = doc.data() || {};
            productRatingState = {
                columns: (Array.isArray(d.columns) && d.columns.length) ? d.columns.slice() : DEFAULT_RATING_COLUMNS.slice(),
                rows: Array.isArray(d.rows) ? d.rows.map(r => ({
                    name: r && r.name ? String(r.name) : '',
                    ratings: (r && r.ratings && typeof r.ratings === 'object') ? Object.assign({}, r.ratings) : {}
                })) : []
            };
        }else{
            productRatingState = { columns: DEFAULT_RATING_COLUMNS.slice(), rows: [] };
        }
    }catch(e){
        console.error('Load productRatings:', e);
        if(!productRatingState) productRatingState = { columns: DEFAULT_RATING_COLUMNS.slice(), rows: [] };
    }
}

// ── 저장 (디바운스) ──
let _ratingSaveTimer = null;
function saveProductRatings(){
    const st = productRatingState;
    if(!st) return;
    const statusEl = document.getElementById('ratingSaveStatus');
    if(statusEl) statusEl.textContent = '저장 중...';
    clearTimeout(_ratingSaveTimer);
    _ratingSaveTimer = setTimeout(async () => {
        try{
            await db.collection('productRatings').doc('main').set({
                columns: st.columns,
                rows: st.rows,
                updatedAt: new Date().toISOString()
            });
            if(statusEl) statusEl.textContent = '✓ 저장됨';
        }catch(e){
            console.error('Save productRatings:', e);
            if(statusEl) statusEl.textContent = '⚠ 저장 실패';
            else alert('저장 실패: ' + e.message);
        }
    }, 500);
}

// ── 별점 셀 렌더 ──
function _ratingStarsHtml(ri, ci, value){
    const v = Number(value) || 0;
    let h = '<span class="rating-stars">';
    for(let k = 1; k <= RATING_MAX; k++){
        const filled = k <= v;
        h += `<span class="rating-star${filled ? ' filled' : ''}" onclick="setRating(${ri},${ci},${k})" title="${k}점">${filled ? '★' : '☆'}</span>`;
    }
    h += `<span class="rating-score">${v}</span></span>`;
    return h;
}

// ── 전체 테이블 렌더 ──
function renderProductRatings(){
    const head = document.getElementById('ratingHead');
    const body = document.getElementById('ratingBody');
    if(!head || !body) return;
    const st = productRatingState || { columns: DEFAULT_RATING_COLUMNS.slice(), rows: [] };

    // 헤더: 상품명 + 각 평가항목(수정/삭제 가능) + 관리
    let hh = '<tr><th style="min-width:150px">상품명 / 오더명</th>';
    st.columns.forEach((col, ci) => {
        hh += `<th style="text-align:center;white-space:nowrap">`
            + `<input class="rating-col-input" value="${_ratingEscAttr(col)}" onchange="renameRatingColumn(${ci},this.value)" title="클릭하여 항목명 수정">`
            + `<button class="rating-col-del" onclick="removeRatingColumn(${ci})" title="항목 삭제">×</button>`
            + `</th>`;
    });
    hh += '<th style="text-align:center">관리</th></tr>';
    head.innerHTML = hh;

    // 바디
    if(!st.rows.length){
        body.innerHTML = `<tr><td colspan="${st.columns.length + 2}" style="text-align:center;color:var(--text-secondary);padding:2rem">상품이 없습니다. 우측 상단 [+ 상품 추가] 버튼으로 추가하세요.</td></tr>`;
        return;
    }
    let bh = '';
    st.rows.forEach((row, ri) => {
        bh += '<tr>';
        bh += `<td><input class="form-input" style="min-width:140px" value="${_ratingEscAttr(row.name || '')}" placeholder="상품명 또는 오더" onchange="updateRatingName(${ri},this.value)"></td>`;
        st.columns.forEach((col, ci) => {
            const v = Number(row.ratings && row.ratings[col] || 0);
            bh += `<td style="text-align:center">${_ratingStarsHtml(ri, ci, v)}</td>`;
        });
        bh += `<td style="text-align:center"><button class="btn btn-danger btn-sm" onclick="removeRatingRow(${ri})">삭제</button></td>`;
        bh += '</tr>';
    });
    body.innerHTML = bh;
}

// ── 별점 설정: 현재 점수와 같은 별을 다시 누르면 1점 감소(토글) ──
function setRating(ri, ci, k){
    const st = productRatingState;
    if(!st) return;
    const col = st.columns[ci];
    const row = st.rows[ri];
    if(col == null || !row) return;
    if(!row.ratings) row.ratings = {};
    const cur = Number(row.ratings[col] || 0);
    row.ratings[col] = (cur === k) ? k - 1 : k;
    renderProductRatings();
    saveProductRatings();
}

// ── 상품명 수정 ──
function updateRatingName(ri, val){
    const st = productRatingState;
    if(!st || !st.rows[ri]) return;
    st.rows[ri].name = (val || '').trim();
    saveProductRatings();
}

// ── 행(상품) 추가/삭제 ──
function addRatingRow(){
    const st = productRatingState;
    if(!st) return;
    st.rows.push({ name: '', ratings: {} });
    renderProductRatings();
    saveProductRatings();
    // 새로 추가된 마지막 행의 상품명 입력란에 포커스
    const inputs = document.querySelectorAll('#ratingBody tr td:first-child input');
    if(inputs.length) inputs[inputs.length - 1].focus();
}
function removeRatingRow(ri){
    const st = productRatingState;
    if(!st || !st.rows[ri]) return;
    const nm = st.rows[ri].name;
    const label = nm ? `'${nm}'` : '이 행';
    if(!confirm(`${label}을(를) 삭제할까요?`)) return;
    st.rows.splice(ri, 1);
    renderProductRatings();
    saveProductRatings();
}

// ── 헤더(평가항목) 추가/수정/삭제 ──
function addRatingColumn(){
    const st = productRatingState;
    if(!st) return;
    let name = prompt('추가할 평가 항목명을 입력하세요 (예: 탄력, 홍조)', '');
    if(name == null) return;
    name = name.trim();
    if(!name) return;
    if(st.columns.includes(name)){ alert('이미 존재하는 항목입니다.'); return; }
    st.columns.push(name);
    renderProductRatings();
    saveProductRatings();
}
function renameRatingColumn(ci, newName){
    const st = productRatingState;
    if(!st || st.columns[ci] == null) return;
    const old = st.columns[ci];
    newName = (newName || '').trim();
    if(!newName || newName === old){ renderProductRatings(); return; }
    if(st.columns.includes(newName)){ alert('이미 존재하는 항목입니다.'); renderProductRatings(); return; }
    st.columns[ci] = newName;
    // 기존 점수 키 이전
    st.rows.forEach(r => {
        if(r.ratings && Object.prototype.hasOwnProperty.call(r.ratings, old)){
            r.ratings[newName] = r.ratings[old];
            delete r.ratings[old];
        }
    });
    renderProductRatings();
    saveProductRatings();
}
function removeRatingColumn(ci){
    const st = productRatingState;
    if(!st || st.columns[ci] == null) return;
    const col = st.columns[ci];
    if(!confirm(`'${col}' 항목을 삭제할까요? 모든 상품의 해당 점수도 함께 삭제됩니다.`)) return;
    st.columns.splice(ci, 1);
    st.rows.forEach(r => { if(r.ratings) delete r.ratings[col]; });
    renderProductRatings();
    saveProductRatings();
}
