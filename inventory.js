/* ===== inventory.js - LUMI ERP v11.1 재고 & 레시피 & 실사 ===== */

const INV_TYPES={disposable:'1회용',portioned:'소분용',hygiene:'위생용품'};
const INV_TYPE_CLASS={disposable:'inv-type-disposable',portioned:'inv-type-portioned',hygiene:'inv-type-hygiene'};
const INV_CATEGORIES={nursing:'간호',skin:'피부',desk:'데스크',common:'공통'};
const INV_CAT_CLASS={nursing:'inv-cat-nursing',skin:'inv-cat-skin',desk:'inv-cat-desk',common:'inv-cat-common'};
const LOSS_RATE=0.10;
const BASE_HYGIENE_COST=1000;

// ===== 재고 렌더링 =====
// ── 정렬 상태 ──
let invSortKey='name', invSortDir='asc';
function setInvSort(key){
    if(invSortKey===key){ invSortDir=invSortDir==='asc'?'desc':'asc'; }
    else { invSortKey=key; invSortDir='asc'; }
    renderInventory();
}
function updateInvSortIcons(){
    const keys=['name','category','currentStock','safetyStock','unitCost','expiryDate'];
    keys.forEach(k=>{
        const el=document.getElementById('invSortIcon_'+k);
        if(!el)return;
        if(k===invSortKey) el.textContent=invSortDir==='asc'?'▲':'▼';
        else el.textContent='↕';
    });
}

function renderInventory(){
    const tbody=document.getElementById('inventoryTable');if(!tbody)return;
    const search=(document.getElementById('invSearch')?.value||'').toLowerCase();
    const typeFilter=document.getElementById('invTypeFilter')?.value||'';
    const catFilter=document.getElementById('invCatFilter')?.value||'';
    const locFilter=document.getElementById('invLocationFilter')?.value||'';

    // 품목이 해당 장소(또는 층)에 재고를 갖고 있는지 검사
    function itemMatchesLocation(item, filter){
        if(!filter) return true;
        const locs=item.locations&&typeof item.locations==='object'?item.locations:{};
        const keys=Object.keys(locs);
        if(filter==='5층'||filter==='6층'){
            // 층 단위: key 가 해당 층으로 시작하거나, floor 메타가 일치하는 경우
            return keys.some(k=>(k||'').startsWith(filter)&&(Number(locs[k])||0)>0)
                || (item.location||'').startsWith(filter);
        }
        // 특정 장소: key 가 filter 와 같거나 floor-name 변형까지 허용
        return keys.some(k=>{
            if(!((Number(locs[k])||0)>0)) return false;
            return k===filter
                || k.endsWith('-'+filter)
                || filter.endsWith('-'+k);
        }) || item.location===filter;
    }

    let items=inventoryItems.filter(i=>{
        if(search&&!i.name?.toLowerCase().includes(search))return false;
        if(typeFilter&&i.type!==typeFilter)return false;
        if(catFilter&&i.category!==catFilter)return false;
        if(!itemMatchesLocation(i,locFilter))return false;
        return true;
    }).sort((a,b)=>{
        const dir=invSortDir==='asc'?1:-1;
        switch(invSortKey){
            case 'name':       return dir*(a.name||'').localeCompare(b.name||'','ko');
            case 'category':   return dir*(a.category||'').localeCompare(b.category||'');
            case 'currentStock': return dir*((a.currentStock||0)-(b.currentStock||0));
            case 'safetyStock':  return dir*((a.safetyStock||0)-(b.safetyStock||0));
            case 'unitCost': {
                const ua=a.purchasePrice&&a.purchaseQty?a.purchasePrice/a.purchaseQty:0;
                const ub=b.purchasePrice&&b.purchaseQty?b.purchasePrice/b.purchaseQty:0;
                return dir*(ua-ub);
            }
            case 'expiryDate': {
                const da=a.expiryDate||'9999-99-99';
                const db2=b.expiryDate||'9999-99-99';
                return dir*(da<db2?-1:da>db2?1:0);
            }
            default: return dir*(a.name||'').localeCompare(b.name||'','ko');
        }
    });
    updateInvSortIcons();

    if(!items.length){
        // 장소 필터가 켜져 있는데 결과 없으면 안내 메시지
        const noLocItems=locFilter?inventoryItems.filter(i=>{
            const hasLocations=i.locations&&typeof i.locations==='object'&&Object.values(i.locations).some(q=>(Number(q)||0)>0);
            return !hasLocations&&!i.location;
        }).length:0;
        const hint=locFilter&&noLocItems>0
            ? `<div style="font-size:.8rem;color:var(--warning);margin-top:.5rem">※ 장소 정보가 없는 품목 ${noLocItems}개는 표시되지 않습니다. (수정 → 장소 지정 필요)</div>`
            : '';
        tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:2rem">조건에 맞는 소모품이 없습니다.${hint}</td></tr>`;
    }else{
        tbody.innerHTML=items.map(item=>{
            const catLabel=INV_CATEGORIES[item.category]||'-';
            const catClass=INV_CAT_CLASS[item.category]||'';
            const typeLabel=INV_TYPES[item.type]||'';
            const typeClass=INV_TYPE_CLASS[item.type]||'';
            const stockLow=item.safetyStock&&item.currentStock<item.safetyStock;
            const unitCost=item.purchasePrice&&item.purchaseQty?(item.purchasePrice/item.purchaseQty):0;
            const lowStyle=stockLow?'background:rgba(255,152,0,0.08)':'';

            // 장소별 재고 셀: locations 객체 → "5층-처치실: 4 | 6층-시술실: 2"
            const locs=item.locations&&typeof item.locations==='object'?item.locations:{};
            const locEntries=Object.entries(locs)
                .filter(([,q])=>(Number(q)||0)>0)
                .sort(([a],[b])=>String(a).localeCompare(String(b),'ko'));
            const locCellHtml=locEntries.length>0
                ? locEntries.map(([k,q])=>`<span style="display:inline-block;background:#f0ece1;color:#5a4a2e;font-size:.72rem;padding:2px 7px;border-radius:10px;margin:1px 2px;white-space:nowrap">📍 ${k}: <strong>${formatNumber(q)}</strong></span>`).join('')
                : (item.location?`<span style="font-size:.75rem;color:var(--text-secondary)">📍 ${item.location}</span>`:'<span style="color:var(--text-muted);font-size:.75rem">-</span>');

            return `<tr style="${lowStyle}">
                <td>
                    <strong>${item.name||'-'}</strong>
                    ${typeLabel?`<span class="inv-type-badge ${typeClass}" style="font-size:.65rem;margin-left:4px;vertical-align:middle">${typeLabel}</span>`:''}
                    ${stockLow?' <span style="display:inline-block;background:#ff9800;color:#fff;font-size:.6rem;padding:1px 4px;border-radius:3px;vertical-align:middle">발주</span>':''}
                </td>
                <td><span class="inv-type-badge ${catClass}">${catLabel}</span></td>
                <td>${locCellHtml}</td>
                <td class="text-right" style="${stockLow?'color:var(--red);font-weight:700':''}">${formatNumber(item.currentStock||0)} ${item.unit||'개'}</td>
                <td class="text-right">${formatNumber(item.safetyStock||0)}</td>
                <td class="text-right">${unitCost?formatCurrency(unitCost):'-'}</td>
                <td class="${isExpiryWarning(item.expiryDate)?'inv-expiry-warn':''}">${item.expiryDate||'-'}</td>
                <td><div class="btn-group">
                    ${item.purchaseLink?`<a href="${item.purchaseLink}" target="_blank" class="btn btn-sm" style="text-decoration:none;background:#ff9800;color:#fff;white-space:nowrap">🛒 구매하기</a>`:''}
                    <button class="btn btn-sm btn-outline" onclick="editInventoryItem('${item.id}')">수정</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteInventoryItem('${item.id}')">삭제</button>
                </div></td>
            </tr>`;
        }).join('');
    }
    const total=inventoryItems.length;
    const low=inventoryItems.filter(i=>i.safetyStock&&i.currentStock<i.safetyStock).length;
    const expWarn=inventoryItems.filter(i=>isExpiryWarning(i.expiryDate)).length;
    const totalVal=inventoryItems.reduce((s,i)=>s+(i.purchasePrice||0)*(i.currentStock||0)/(i.purchaseQty||1),0);
    const cards=document.getElementById('inventoryCards');
    if(cards)cards.innerHTML=`
        <div class="card"><div class="card-label">총 품목</div><div class="card-value">${total}개</div></div>
        <div class="card"><div class="card-label">재고 부족</div><div class="card-value" style="color:${low?'var(--red)':'var(--green)'}">${low}개</div></div>
        <div class="card"><div class="card-label">유통기한 임박</div><div class="card-value" style="color:${expWarn?'var(--warning)':'var(--green)'}">${expWarn}개</div></div>
        <div class="card"><div class="card-label">재고 가치</div><div class="card-value">${formatCurrency(totalVal)}</div></div>
    `;
}
function isExpiryWarning(d){if(!d)return false;const e=new Date(d),t=new Date();t.setMonth(t.getMonth()+3);return e<=t;}

// ===== 재고 CRUD =====
function openInventoryModal(id=null){
    document.getElementById('invModalTitle').textContent=id?'소모품 수정':'소모품 등록';
    document.getElementById('invEditId').value=id||'';
    if(id){
        const item=inventoryItems.find(i=>i.id===id);
        if(item){
            document.getElementById('invName').value=item.name||'';
            document.getElementById('invType').value=item.type||'disposable';
            document.getElementById('invCategory').value=item.category||'common';
            document.getElementById('invUnit').value=item.unit||'개';
            document.getElementById('invSafetyStock').value=item.safetyStock||0;
            document.getElementById('invPurchasePrice').value=item.purchasePrice||0;
            document.getElementById('invPurchaseQty').value=item.purchaseQty||1;
            document.getElementById('invPurchaseUnit').value=item.purchaseUnit||'';
            document.getElementById('invExpiryDate').value=item.expiryDate||'';
            document.getElementById('invNote').value=item.note||'';
            document.getElementById('invPurchaseLink').value=item.purchaseLink||'';
            // 장소별 재고 행 복원
            const locsObj=item.locations&&typeof item.locations==='object'?item.locations:{};
            const entries=Object.entries(locsObj).filter(([,q])=>(Number(q)||0)>0);
            renderAdminInvLocationRows(entries);
            // 구형: locations 없고 currentStock 만 있는 경우 → 빈 행 + 옛 총량 미리 채움
            if(entries.length===0&&Number(item.currentStock)>0){
                renderAdminInvLocationRows([[ '', Number(item.currentStock) ]]);
            }
        }
    }else{
        ['invName','invUnit','invSafetyStock','invPurchasePrice','invPurchaseUnit','invExpiryDate','invNote','invPurchaseLink'].forEach(x=>document.getElementById(x).value='');
        document.getElementById('invType').value='disposable';
        document.getElementById('invCategory').value='common';
        document.getElementById('invPurchaseQty').value='1';
        renderAdminInvLocationRows([]);
        addAdminInvLocationRow();
    }
    openModal('inventoryModal');
}

// === admin 인벤토리 모달 - 장소별 재고 입력 ===
function _getAdminLocationOptionsHtml(selected){
    // updateLocationFilters 가 만든 dropdown 과 동일한 'floor-name' 형태 사용
    const opts=(locations||[]).slice().sort((a,b)=>{
        const fa=a.floor||'',fb=b.floor||'';
        if(fa!==fb) return fa.localeCompare(fb,'ko');
        return (a.order||0)-(b.order||0);
    });
    const sel=String(selected||'');
    return '<option value="">장소 선택</option>'+opts.map(loc=>{
        const v=`${loc.floor||''}-${loc.name||''}`;
        // 기존 키가 'floor-name' 또는 그냥 'name' 일 수 있으므로 양쪽 매칭
        const isSel=(v===sel)||((loc.name||'')===sel);
        return `<option value="${v}" ${isSel?'selected':''}>${v}</option>`;
    }).join('');
}

function renderAdminInvLocationRows(entries){
    const container=document.getElementById('adminInvLocationsList');
    if(!container) return;
    container.innerHTML='';
    (entries||[]).forEach(([loc,qty])=>{
        addAdminInvLocationRow(loc,Number(qty)||0);
    });
    updateAdminInvTotal();
}

function addAdminInvLocationRow(presetLoc='',presetQty=0){
    const container=document.getElementById('adminInvLocationsList');
    if(!container) return;
    const rowId='adminInvLoc_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    const row=document.createElement('div');
    row.id=rowId;
    row.className='admin-inv-loc-row';
    row.style.cssText='display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem';
    row.innerHTML=`
        <select class="form-select admin-inv-loc-sel" style="flex:2;min-width:0;padding:.45rem .6rem;font-size:.85rem">
            ${_getAdminLocationOptionsHtml(presetLoc)}
        </select>
        <input type="number" class="form-input admin-inv-loc-qty" step="0.01" min="0"
            value="${presetQty>0?presetQty:''}" placeholder="수량"
            style="flex:1;min-width:0;padding:.45rem .6rem;font-size:.85rem;text-align:right"
            oninput="updateAdminInvTotal()">
        <button type="button" class="btn btn-sm btn-danger" onclick="removeAdminInvLocationRow('${rowId}')" style="padding:.3rem .55rem">×</button>
    `;
    container.appendChild(row);
    row.querySelector('.admin-inv-loc-qty').addEventListener('change',updateAdminInvTotal);
    updateAdminInvTotal();
}

function removeAdminInvLocationRow(rowId){
    const row=document.getElementById(rowId);
    if(row) row.remove();
    updateAdminInvTotal();
}

function updateAdminInvTotal(){
    const container=document.getElementById('adminInvLocationsList');
    const totalEl=document.getElementById('adminInvTotalStock');
    if(!container||!totalEl) return;
    const qtys=container.querySelectorAll('.admin-inv-loc-qty');
    let total=0;
    qtys.forEach(q=>{ total+=parseFloat(q.value)||0; });
    totalEl.textContent=formatNumber(total);
}

function collectAdminInvLocations(){
    const container=document.getElementById('adminInvLocationsList');
    const out={};
    let total=0;
    if(!container) return {locations:out,total:0};
    container.querySelectorAll('.admin-inv-loc-row').forEach(row=>{
        const loc=row.querySelector('.admin-inv-loc-sel')?.value?.trim();
        const qty=parseFloat(row.querySelector('.admin-inv-loc-qty')?.value)||0;
        if(loc&&qty>0){
            out[loc]=(out[loc]||0)+qty;
            total+=qty;
        }
    });
    return {locations:out,total};
}
async function saveInventoryItem(){
    const id=document.getElementById('invEditId').value;
    const {locations:locMap,total:locTotal}=collectAdminInvLocations();
    const data={
        name:document.getElementById('invName').value.trim(),
        type:document.getElementById('invType').value,
        category:document.getElementById('invCategory').value,
        unit:document.getElementById('invUnit').value.trim()||'개',
        locations:locMap,
        currentStock:locTotal,
        totalStock:locTotal,
        safetyStock:parseFloat(document.getElementById('invSafetyStock').value)||0,
        purchasePrice:parseFloat(document.getElementById('invPurchasePrice').value)||0,
        purchaseQty:parseFloat(document.getElementById('invPurchaseQty').value)||1,
        purchaseUnit:document.getElementById('invPurchaseUnit').value.trim(),
        expiryDate:document.getElementById('invExpiryDate').value||null,
        note:document.getElementById('invNote').value.trim(),
        purchaseLink:document.getElementById('invPurchaseLink').value.trim(),
        updatedAt:new Date().toISOString()
    };
    if(!data.name){alert('품목명을 입력하세요.');return;}
    try{
        if(id)await db.collection('inventory').doc(id).update(data);
        else{data.createdAt=new Date().toISOString();await db.collection('inventory').add(data);}
        closeModal('inventoryModal');await loadInventory();renderInventory();
        if(typeof renderDashboardCards==='function')renderDashboardCards();
    }catch(e){alert('저장 실패: '+e.message);}
}
function editInventoryItem(id){openInventoryModal(id);}
async function deleteInventoryItem(id){if(!confirm('정말 삭제?'))return;try{await db.collection('inventory').doc(id).delete();await loadInventory();renderInventory();}catch(e){alert('삭제 실패: '+e.message);}}

// ===== 레시피 =====
function renderRecipes(){
    const tbody=document.getElementById('recipeTable');if(!tbody)return;
    if(!recipes.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:2rem">등록된 레시피가 없습니다.</td></tr>';return;}
    tbody.innerHTML=recipes.sort((a,b)=>(a.treatmentName||'').localeCompare(b.treatmentName||'')).map(r=>{
        const cost=calculateRecipeCost(r);
        const list=(r.ingredients||[]).map(ing=>{const it=inventoryItems.find(i=>i.id===ing.itemId);return `${it?.name||'?'}×${ing.amount}`;}).join(', ');
        return `<tr><td><strong>${r.treatmentName||'-'}</strong></td><td style="font-size:.8rem;max-width:300px">${list||'-'}</td><td class="text-right"><span class="recipe-cost-badge">${formatCurrency(cost)}</span></td><td class="text-right">${formatCurrency(BASE_HYGIENE_COST)}</td><td><div class="btn-group"><button class="btn btn-sm btn-outline" onclick="editRecipe('${r.id}')">수정</button><button class="btn btn-sm btn-danger" onclick="deleteRecipe('${r.id}')">삭제</button></div></td></tr>`;
    }).join('');
    const rc=document.getElementById('recipeCards');
    if(rc){const n=recipes.length,avg=n?recipes.reduce((s,r)=>s+calculateRecipeCost(r),0)/n:0;rc.innerHTML=`<div class="card"><div class="card-label">등록 레시피</div><div class="card-value">${n}개</div></div><div class="card"><div class="card-label">평균 원가</div><div class="card-value">${formatCurrency(avg)}</div></div><div class="card"><div class="card-label">기본 위생비</div><div class="card-value">${formatCurrency(BASE_HYGIENE_COST)}/건</div></div>`;}
}
function calculateRecipeCost(recipe){
    if(!recipe?.ingredients)return BASE_HYGIENE_COST;
    let cost=BASE_HYGIENE_COST;
    for(const ing of recipe.ingredients){const item=inventoryItems.find(i=>i.id===ing.itemId);if(!item)continue;let amt=ing.amount||0;if(item.type==='portioned')amt*=(1+LOSS_RATE);cost+=(item.purchasePrice/(item.purchaseQty||1))*amt;}
    return cost;
}
function getRecipeCostByTreatment(name){const r=recipes.find(x=>x.treatmentName===name);return r?calculateRecipeCost(r):BASE_HYGIENE_COST;}

// ===== 레시피 CRUD =====
let tempIngredients=[];
function openRecipeModal(id=null){
    document.getElementById('recipeModalTitle').textContent=id?'레시피 수정':'레시피 등록';
    document.getElementById('recipeEditId').value=id||'';
    if(id){const r=recipes.find(x=>x.id===id);if(r){document.getElementById('recipeTreatment').value=r.treatmentName||'';tempIngredients=[...(r.ingredients||[])];}}
    else{document.getElementById('recipeTreatment').value='';tempIngredients=[];}
    renderIngredientRows();openModal('recipeModal');
}
function renderIngredientRows(){
    const c=document.getElementById('recipeIngredients');
    // 공용 datalist 한 번만 주입 (검색용 옵션 풀)
    const dlOptions=inventoryItems
        .slice()
        .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'))
        .map(i=>`<option value="${(i.name||'').replace(/"/g,'&quot;')}" data-id="${i.id}">`)
        .join('');
    const dlHtml=`<datalist id="recipeItemDatalist">${dlOptions}</datalist>`;

    const rowsHtml=tempIngredients.map((ing,idx)=>{
        const item=inventoryItems.find(i=>i.id===ing.itemId);
        const currentName=item?(item.name||''):'';
        const typeLabel=item?(INV_TYPES[item.type]||item.type||''):'';
        return `<div class="recipe-ingredient-row" style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem">
            <input type="text"
                list="recipeItemDatalist"
                value="${currentName.replace(/"/g,'&quot;')}"
                placeholder="🔍 품목명 검색 (예: 리도카인)"
                oninput="onIngredientSearchInput(${idx},this.value)"
                onchange="onIngredientSearchInput(${idx},this.value)"
                style="flex:1;min-width:0;padding:.4rem .6rem;border:1px solid var(--border);border-radius:6px;font-size:.85rem">
            <span style="font-size:.7rem;color:var(--text-muted);min-width:48px;text-align:center">${typeLabel}</span>
            <input type="number" step="0.001" value="${ing.amount||''}" placeholder="소모량"
                onchange="tempIngredients[${idx}].amount=parseFloat(this.value)||0;renderIngredientRows()"
                style="width:90px;padding:.4rem .5rem;border:1px solid var(--border);border-radius:6px;font-size:.85rem;text-align:right">
            <span style="font-size:.75rem;color:var(--text-secondary);min-width:30px">${item?.unit||''}</span>
            <button class="btn btn-sm btn-danger" onclick="removeIngredient(${idx})">×</button>
        </div>`;
    }).join('');
    c.innerHTML=dlHtml+rowsHtml;

    const est=BASE_HYGIENE_COST+tempIngredients.reduce((s,ing)=>{
        const it=inventoryItems.find(i=>i.id===ing.itemId);
        if(!it)return s;
        let a=ing.amount||0;
        if(it.type==='portioned')a*=(1+LOSS_RATE);
        return s+(it.purchasePrice/(it.purchaseQty||1))*a;
    },0);
    const estEl=document.getElementById('recipeEstCost');
    if(estEl) estEl.textContent=formatCurrency(est);
}
function onIngredientSearchInput(idx,value){
    const v=String(value||'').trim();
    if(!v){
        tempIngredients[idx].itemId='';
        renderIngredientRows();
        return;
    }
    // 정확 매칭 우선
    let match=inventoryItems.find(i=>(i.name||'')===v);
    // 부분 매칭 (단일 결과일 때만)
    if(!match){
        const lower=v.toLowerCase();
        const cand=inventoryItems.filter(i=>(i.name||'').toLowerCase().includes(lower));
        if(cand.length===1) match=cand[0];
    }
    if(match){
        if(tempIngredients[idx].itemId!==match.id){
            tempIngredients[idx].itemId=match.id;
            renderIngredientRows();
        }
    }else{
        // 매칭 실패 시 itemId 초기화 (저장 시 자동 제외)
        if(tempIngredients[idx].itemId){
            tempIngredients[idx].itemId='';
        }
    }
}
function addIngredient(){tempIngredients.push({itemId:'',amount:0});renderIngredientRows();}
function removeIngredient(idx){tempIngredients.splice(idx,1);renderIngredientRows();}
async function saveRecipe(){
    const id=document.getElementById('recipeEditId').value;
    const data={treatmentName:document.getElementById('recipeTreatment').value.trim(),ingredients:tempIngredients.filter(i=>i.itemId&&i.amount>0),updatedAt:new Date().toISOString()};
    if(!data.treatmentName){alert('시술명을 입력하세요.');return;}
    try{if(id)await db.collection('recipes').doc(id).update(data);else{data.createdAt=new Date().toISOString();await db.collection('recipes').add(data);}closeModal('recipeModal');await loadRecipes();renderRecipes();}catch(e){alert('저장 실패: '+e.message);}
}
function editRecipe(id){openRecipeModal(id);}
async function deleteRecipe(id){if(!confirm('정말 삭제?'))return;try{await db.collection('recipes').doc(id).delete();await loadRecipes();renderRecipes();}catch(e){alert('삭제 실패: '+e.message);}}

// ===== 재고 실사 리포트 (관리자) =====
let auditRecords=[];
async function loadAuditRecords(){
    try{const s=await db.collection('inventoryAudits').orderBy('createdAt','desc').limit(200).get();auditRecords=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load audits:',e);}
}
function renderAuditReport(){
    const container=document.getElementById('auditReport');if(!container)return;
    // 최근 실사: 품목별 마지막 기록
    const latestByItem={};
    auditRecords.forEach(r=>{if(!latestByItem[r.itemId]||new Date(r.createdAt)>new Date(latestByItem[r.itemId].createdAt))latestByItem[r.itemId]=r;});
    const catFilter=document.getElementById('auditCatFilter')?.value||'';
    const items=inventoryItems.filter(i=>!catFilter||i.category===catFilter).map(item=>{
        const audit=latestByItem[item.id];
        const sys=item.currentStock||0;
        const act=audit?.actualStock;
        const diff=act!=null?(act-sys):null;
        return{...item,audit,sys,act,diff};
    }).sort((a,b)=>{
        if(a.diff!=null&&b.diff==null)return -1;if(a.diff==null&&b.diff!=null)return 1;
        if(a.diff!=null&&b.diff!=null)return Math.abs(b.diff)-Math.abs(a.diff);
        return(a.name||'').localeCompare(b.name||'');
    });
    const done=items.filter(i=>i.diff!=null);
    const diffItems=done.filter(i=>Math.abs(i.diff)>0.01);
    const totalLossQty=diffItems.filter(i=>i.diff<0).reduce((s,i)=>s+Math.abs(i.diff),0);
    const totalLossCost=diffItems.filter(i=>i.diff<0).reduce((s,i)=>{
        const unitCost=i.purchasePrice&&i.purchaseQty?(i.purchasePrice/i.purchaseQty):0;
        return s+Math.abs(i.diff)*unitCost;
    },0);
    container.innerHTML=`
        <div class="cards-grid" style="margin-bottom:1rem">
            <div class="card"><div class="card-label">실사 완료</div><div class="card-value">${done.length} / ${items.length}</div></div>
            <div class="card"><div class="card-label">차이 발생</div><div class="card-value" style="color:${diffItems.length?'var(--red)':'var(--green)'}">${diffItems.length}개</div></div>
            <div class="card"><div class="card-label">Loss 수량</div><div class="card-value" style="color:${totalLossQty?'var(--red)':'var(--green)'}">${totalLossQty.toFixed(1)}</div></div>
            <div class="card"><div class="card-label">Loss 추정 비용</div><div class="card-value" style="color:${totalLossCost?'var(--red)':'var(--green)'}">${formatCurrency(totalLossCost)}</div></div>
        </div>
        <div class="table-container"><table>
            <thead><tr><th>품목명</th><th>카테고리</th><th class="text-right">시스템 재고</th><th class="text-right">실재고</th><th class="text-right">차이</th><th>실사일</th><th>실사자</th></tr></thead>
            <tbody>${items.map(i=>{
                const dc=i.diff!=null?(Math.abs(i.diff)>0.01?(i.diff<0?'color:var(--red);font-weight:600':'color:var(--green);font-weight:600'):''):'';
                return `<tr><td><strong>${i.name}</strong></td><td><span class="inv-type-badge ${INV_CAT_CLASS[i.category]||''}">${INV_CATEGORIES[i.category]||'-'}</span></td><td class="text-right">${formatNumber(i.sys)} ${i.unit||''}</td><td class="text-right">${i.act!=null?formatNumber(i.act):'-'}</td><td class="text-right" style="${dc}">${i.diff!=null?(i.diff>0?'+':'')+i.diff.toFixed(1):'-'}</td><td style="font-size:.8rem">${i.audit?new Date(i.audit.createdAt).toLocaleDateString('ko'):'-'}</td><td style="font-size:.8rem">${i.audit?.staffName||'-'}</td></tr>`;
            }).join('')}</tbody>
        </table></div>
        ${diffItems.length?`<div style="margin-top:1rem"><button class="btn btn-primary" onclick="applyAuditToSystem()">📋 실재고를 시스템 재고에 반영</button></div>`:''}
    `;
}
async function applyAuditToSystem(){
    if(!confirm('실재고 → 시스템 재고에 반영하시겠습니까?'))return;
    const latestByItem={};
    auditRecords.forEach(r=>{if(!latestByItem[r.itemId]||new Date(r.createdAt)>new Date(latestByItem[r.itemId].createdAt))latestByItem[r.itemId]=r;});
    const batch=db.batch();let cnt=0;
    for(const[itemId,audit]of Object.entries(latestByItem)){
        if(audit.actualStock!=null){batch.update(db.collection('inventory').doc(itemId),{currentStock:audit.actualStock,lastAuditApplied:new Date().toISOString()});cnt++;}
    }
    try{await batch.commit();alert(cnt+'개 품목 반영 완료');await loadInventory();renderInventory();renderAuditReport();}catch(e){alert('반영 실패: '+e.message);}
}
function getLowStockCount(){return inventoryItems.filter(i=>i.safetyStock&&i.currentStock<i.safetyStock).length;}

// ===== 비품 구매 요청(Wishlist) 관리 - 관리자 =====
let purchaseRequests=[];
async function loadPurchaseRequests(){
    try{
        const s=await db.collection('purchaseRequests').orderBy('createdAt','desc').limit(100).get();
        purchaseRequests=s.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){console.error('Load purchaseRequests:',e);}
}

function renderPurchaseRequests(){
    const container=document.getElementById('purchaseRequestList');
    if(!container)return;
    const pending=purchaseRequests.filter(r=>r.status==='pending');
    const processed=purchaseRequests.filter(r=>r.status!=='pending');
    
    let html='';
    if(pending.length){
        html+=`<div style="margin-bottom:1rem"><strong>대기 중 (${pending.length}건)</strong></div>`;
        html+=pending.map(r=>{
            const linkBtn=r.purchaseLink?`<a href="${r.purchaseLink}" target="_blank" class="btn btn-sm" style="text-decoration:none;background:#ff9800;color:#fff;white-space:nowrap">🛒 구매하기</a>`:'';
            return `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;margin-bottom:8px">
                <div style="flex:1">
                    <strong>${r.name}</strong> <span style="color:#999;font-size:.8rem">×${r.qty||1}</span>
                    ${r.estimatedPrice?` <span style="font-size:.8rem;color:#e65100">${formatCurrency(r.estimatedPrice)}</span>`:''}
                    <div style="font-size:.75rem;color:#666;margin-top:2px">${r.reason||''}</div>
                    <div style="font-size:.7rem;color:#999;margin-top:2px">요청: ${r.requestedBy||'-'} · ${r.createdAt?new Date(r.createdAt).toLocaleDateString('ko'):'-'}</div>
                </div>
                ${linkBtn}
                <button class="btn btn-sm" style="background:var(--green);color:#fff" onclick="updatePurchaseRequest('${r.id}','approved')">✅ 승인</button>
                <button class="btn btn-sm btn-danger" onclick="updatePurchaseRequest('${r.id}','rejected')">❌</button>
            </div>`;
        }).join('');
    }else{
        html+='<div style="text-align:center;color:#999;padding:1rem;font-size:.9rem">대기 중인 구매 요청이 없습니다.</div>';
    }
    
    if(processed.length){
        html+=`<div style="margin-top:1.5rem;margin-bottom:.5rem"><strong>처리 완료</strong></div>`;
        html+=processed.slice(0,10).map(r=>{
            const statusBadge=r.status==='approved'
                ?'<span style="font-size:.7rem;background:#e8f5e9;color:#2e7d32;padding:1px 6px;border-radius:3px">승인됨</span>'
                :'<span style="font-size:.7rem;background:#ffebee;color:#c62828;padding:1px 6px;border-radius:3px">거절됨</span>';
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #eee;font-size:.85rem">
                <span style="flex:1">${r.name} ×${r.qty||1} ${statusBadge}</span>
                <span style="color:#999;font-size:.75rem">${r.requestedBy||'-'}</span>
                <button class="btn btn-sm btn-danger" style="font-size:.65rem;padding:1px 6px" onclick="deletePurchaseRequest('${r.id}')">삭제</button>
            </div>`;
        }).join('');
    }
    
    container.innerHTML=html;
    
    // 대기 중 뱃지 업데이트
    const badge=document.getElementById('wishlistBadge');
    if(badge){
        if(pending.length){badge.textContent=pending.length;badge.style.display='inline-block';}
        else badge.style.display='none';
    }
}

async function updatePurchaseRequest(id,status){
    try{
        await db.collection('purchaseRequests').doc(id).update({status:status,processedAt:new Date().toISOString()});
        await loadPurchaseRequests();
        renderPurchaseRequests();
    }catch(e){alert('처리 실패: '+e.message);}
}

async function deletePurchaseRequest(id){
    if(!confirm('삭제하시겠습니까?'))return;
    try{
        await db.collection('purchaseRequests').doc(id).delete();
        await loadPurchaseRequests();
        renderPurchaseRequests();
    }catch(e){alert('삭제 실패: '+e.message);}
}

// ===== 관리자 재고 모달 단가 계산기 =====
function calcAdminInvUnit(){
    const price=parseFloat(document.getElementById('invPurchasePrice')?.value)||0;
    const qty=parseFloat(document.getElementById('invPurchaseQty')?.value)||1;
    const el=document.getElementById('adminInvUnitCalc');
    if(!el)return;
    if(price>0&&qty>0){
        const unitPrice=Math.round(price/qty);
        el.textContent='낱개당 단가: '+unitPrice.toLocaleString()+'원';
        el.style.color='var(--accent-green)';
    }else{
        el.textContent='낱개당 단가: -';
        el.style.color='var(--text-secondary)';
    }
}

// ===== 장소 관리 시스템 =====
let locations=[];

async function loadLocations(){
    try{
        const snap=await db.collection('locations').orderBy('order','asc').get();
        locations=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){
        locations=[];
        console.error('장소 로드 실패:',e);
    }
    // renderLocations / showAdminDuplicateLocationBanner 는 관리자 UI 제거로 no-op
    updateLocationFilters();
}

// ===== 중복 장소 통합 (admin 측) =====
// admin 측 장소 편집/중복 통합 로직 제거 — staff 앱에서만 관리.

// staff.html 과 동일한 규칙: name 이 이미 층 접두어 포함 시 그대로, 아니면 concat
function locDisplayName(loc){
    if(!loc) return '';
    const name=String(loc.name||'').trim();
    const floor=String(loc.floor||'').trim();
    if(!name) return floor;
    if(!floor) return name;
    if(name===floor||name.startsWith(floor+'-')||name.startsWith(floor+' ')) return name;
    return `${floor}-${name}`;
}

// admin '재고관리 → 소모품 목록' 상단 필터 드롭다운 채우기 (읽기 전용).
// 장소 자체의 편집/추가/삭제는 staff 앱에서만 수행하도록 정책 변경.
function updateLocationFilters(){
    const filter=document.getElementById('invLocationFilter');
    if(!filter)return;
    const current=filter.value;
    filter.innerHTML='<option value="">전체 장소</option><option value="5층">5층 전체</option><option value="6층">6층 전체</option>';
    locations.slice().sort((a,b)=>{
        const fa=(a.floor||''),fb=(b.floor||'');
        if(fa!==fb) return fa.localeCompare(fb,'ko');
        return String(a.name||'').localeCompare(String(b.name||''),'ko');
    }).forEach(loc=>{
        const opt=document.createElement('option');
        const v=locDisplayName(loc);
        opt.value=v; opt.textContent=v;
        filter.appendChild(opt);
    });
    filter.value=current;
}

// 아래 관리 UI 함수들은 관리자 화면에서 제거됨. staff 앱을 사용하도록 안내.
function renderLocations(){/* admin 측 장소 관리 UI 제거됨 */}
function openLocationModal(){ alert('장소 추가/편집은 staff 앱 [장소 관리] 에서 진행해주세요.'); }
function editLocation(){ openLocationModal(); }
function saveLocation(){ openLocationModal(); }
function deleteLocation(){ openLocationModal(); }
function initDefaultLocations(){/* 자동 초기 데이터 생성 비활성화 */}
function showAdminDuplicateLocationBanner(){/* admin 측 노출 없음 */}
function adminMergeDuplicateLocations(){ alert('중복 통합은 staff 앱 [장소 관리] 에서 진행해주세요.'); }

// admin 측 장소 관리 관련 원본 정의는 제거되었습니다.
// staff 앱 [장소 관리] 화면이 유일한 진입점입니다.

// ===== 단가표 내보내기 (제품명/단위/용량(cc)/단가) =====
// 단위 정규화 규칙
//   cc, ml, ㎖              → "cc"
//   앰플, 바이알, vial, 병, A/v(숫자 직후) → "vial"
//   syringe, 시린지         → "syringe"
// vial/syringe 항목은 이름·단위에서 cc 용량을 추출해 별도 컬럼에 표기.
function normalizeUnitAndVolume(name, rawUnit){
    const text=`${name||''} ${rawUnit||''}`;
    const lower=text.toLowerCase();

    let volumeCc=null;
    const volMatch=lower.match(/([0-9]+(?:\.[0-9]+)?)\s*(cc|ml|㎖)/);
    if(volMatch) volumeCc=parseFloat(volMatch[1]);

    let unit;
    const isSyringe=/syringe|시린지/i.test(lower);
    const hasAmpVial=/앰플|바이알|vial|병/.test(text)
                     || /\d+\s*[av]\b/i.test(text);
    if(isSyringe){
        unit='syringe';
    }else if(hasAmpVial){
        unit='vial';
    }else if(volumeCc!=null){
        unit='cc';
    }else{
        const raw=String(rawUnit||'').trim();
        unit=raw||'개';
    }
    return {unit, volumeCc};
}

async function exportInventoryPriceList(){
    try{
        let items=Array.isArray(inventoryItems)&&inventoryItems.length>0
            ? inventoryItems
            : null;
        if(!items){
            const snap=await db.collection('inventory').orderBy('name').get();
            items=snap.docs.map(d=>({id:d.id,...d.data()}));
        }
        if(!items.length){ alert('재고에 등록된 품목이 없습니다.'); return; }

        const rows=items
            .slice()
            .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'))
            .map(item=>{
                const name=item.name||'';
                const {unit,volumeCc}=normalizeUnitAndVolume(name,item.unit);
                const qty=Number(item.purchaseQty)||0;
                const price=Number(item.purchasePrice)||0;
                const unitCost=qty>0?Math.round(price/qty):0;
                const showVolume=(unit==='vial'||unit==='syringe'||unit==='cc')&&volumeCc!=null
                    ? volumeCc : '';
                return {
                    '제품명':name,
                    '단위':unit,
                    '용량(cc)':showVolume,
                    '단가(원)':unitCost
                };
            });

        if(typeof XLSX==='undefined'){
            alert('XLSX 라이브러리 로딩 실패. 페이지를 새로고침 후 다시 시도해주세요.');
            return;
        }
        const ws=XLSX.utils.json_to_sheet(rows,{
            header:['제품명','단위','용량(cc)','단가(원)']
        });
        ws['!cols']=[{wch:30},{wch:10},{wch:10},{wch:12}];
        const range=XLSX.utils.decode_range(ws['!ref']);
        for(let R=range.s.r+1;R<=range.e.r;R++){
            const cellAddr=XLSX.utils.encode_cell({c:3,r:R});
            if(ws[cellAddr]&&typeof ws[cellAddr].v==='number'){
                ws[cellAddr].z='#,##0';
            }
        }
        const wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,ws,'단가표');

        const today=new Date();
        const stamp=`${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
        XLSX.writeFile(wb,`재고_단가표_${stamp}.xlsx`);
    }catch(e){
        console.error('단가표 내보내기 실패:',e);
        alert('단가표 내보내기 실패: '+(e.message||e));
    }
}
