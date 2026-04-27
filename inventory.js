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
    let items=inventoryItems.filter(i=>{
        if(search&&!i.name?.toLowerCase().includes(search))return false;
        if(typeFilter&&i.type!==typeFilter)return false;
        if(catFilter&&i.category!==catFilter)return false;
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
        tbody.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--text-secondary);padding:2rem">등록된 소모품이 없습니다.</td></tr>';
    }else{
        tbody.innerHTML=items.map(item=>{
            const catLabel=INV_CATEGORIES[item.category]||'-';
            const catClass=INV_CAT_CLASS[item.category]||'';
            const typeLabel=INV_TYPES[item.type]||'-';
            const typeClass=INV_TYPE_CLASS[item.type]||'';
            const stockLow=item.safetyStock&&item.currentStock<item.safetyStock;
            const unitCost=item.purchasePrice&&item.purchaseQty?(item.purchasePrice/item.purchaseQty):0;
            const lowStyle=stockLow?'background:rgba(255,152,0,0.08)':'';
            return `<tr style="${lowStyle}">
                <td><strong>${item.name||'-'}</strong>${stockLow?' <span style="display:inline-block;background:#ff9800;color:#fff;font-size:.6rem;padding:1px 4px;border-radius:3px;vertical-align:middle">발주</span>':''}</td>
                <td><span class="inv-type-badge ${catClass}">${catLabel}</span></td>
                <td><span class="inv-type-badge ${typeClass}">${typeLabel}</span></td>
                <td class="text-right" style="${stockLow?'color:var(--red);font-weight:700':''}">${formatNumber(item.currentStock||0)} ${item.unit||'개'}</td>
                <td class="text-right">${formatNumber(item.safetyStock||0)}</td>
                <td class="text-right">${formatCurrency(item.purchasePrice||0)}</td>
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
            document.getElementById('invCurrentStock').value=item.currentStock||0;
            document.getElementById('invSafetyStock').value=item.safetyStock||0;
            document.getElementById('invPurchasePrice').value=item.purchasePrice||0;
            document.getElementById('invPurchaseQty').value=item.purchaseQty||1;
            document.getElementById('invPurchaseUnit').value=item.purchaseUnit||'';
            document.getElementById('invExpiryDate').value=item.expiryDate||'';
            document.getElementById('invNote').value=item.note||'';
            document.getElementById('invPurchaseLink').value=item.purchaseLink||'';
        }
    }else{
        ['invName','invUnit','invCurrentStock','invSafetyStock','invPurchasePrice','invPurchaseUnit','invExpiryDate','invNote','invPurchaseLink'].forEach(x=>document.getElementById(x).value='');
        document.getElementById('invType').value='disposable';
        document.getElementById('invCategory').value='common';
        document.getElementById('invPurchaseQty').value='1';
    }
    openModal('inventoryModal');
}
async function saveInventoryItem(){
    const id=document.getElementById('invEditId').value;
    const data={
        name:document.getElementById('invName').value.trim(),
        type:document.getElementById('invType').value,
        category:document.getElementById('invCategory').value,
        unit:document.getElementById('invUnit').value.trim()||'개',
        currentStock:parseFloat(document.getElementById('invCurrentStock').value)||0,
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
    c.innerHTML=tempIngredients.map((ing,idx)=>{
        const item=inventoryItems.find(i=>i.id===ing.itemId);
        return `<div class="recipe-ingredient-row"><select onchange="tempIngredients[${idx}].itemId=this.value;renderIngredientRows()"><option value="">품목 선택</option>${inventoryItems.map(i=>`<option value="${i.id}" ${i.id===ing.itemId?'selected':''}>${i.name} (${INV_TYPES[i.type]||i.type})</option>`).join('')}</select><input type="number" step="0.001" value="${ing.amount||''}" placeholder="소모량" onchange="tempIngredients[${idx}].amount=parseFloat(this.value)||0;renderIngredientRows()" style="max-width:100px"><span style="font-size:.75rem;color:var(--text-secondary);min-width:30px">${item?.unit||''}</span><button class="btn btn-sm btn-danger" onclick="removeIngredient(${idx})">×</button></div>`;
    }).join('');
    const est=BASE_HYGIENE_COST+tempIngredients.reduce((s,ing)=>{const it=inventoryItems.find(i=>i.id===ing.itemId);if(!it)return s;let a=ing.amount||0;if(it.type==='portioned')a*=(1+LOSS_RATE);return s+(it.purchasePrice/(it.purchaseQty||1))*a;},0);
    document.getElementById('recipeEstCost').textContent=formatCurrency(est);
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
    renderLocations();
    updateLocationFilters();
}

function renderLocations(){
    const el5=document.getElementById('locations5F');
    const el6=document.getElementById('locations6F');
    if(!el5||!el6)return;
    
    const locs5=locations.filter(l=>l.floor==='5층');
    const locs6=locations.filter(l=>l.floor==='6층');
    
    if(!locs5.length){
        el5.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:.85rem">등록된 장소가 없습니다</div>';
    }else{
        el5.innerHTML=locs5.map(l=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:#fff">
            <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:.7rem;color:var(--text-muted);min-width:20px">${l.order}</span>
                <strong style="font-size:.9rem">${l.name}</strong>
            </div>
            <div style="display:flex;gap:4px">
                <button onclick="editLocation('${l.id}')" style="padding:3px 8px;font-size:.7rem;border:1px solid var(--primary);color:var(--primary);background:none;border-radius:4px;cursor:pointer">수정</button>
                <button onclick="deleteLocation('${l.id}','${l.name.replace(/'/g,"\\'")} (5층)')" style="padding:3px 8px;font-size:.7rem;border:1px solid var(--red);color:var(--red);background:none;border-radius:4px;cursor:pointer">삭제</button>
            </div>
        </div>`).join('');
    }
    
    if(!locs6.length){
        el6.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:.85rem">등록된 장소가 없습니다</div>';
    }else{
        el6.innerHTML=locs6.map(l=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:#fff">
            <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:.7rem;color:var(--text-muted);min-width:20px">${l.order}</span>
                <strong style="font-size:.9rem">${l.name}</strong>
            </div>
            <div style="display:flex;gap:4px">
                <button onclick="editLocation('${l.id}')" style="padding:3px 8px;font-size:.7rem;border:1px solid var(--primary);color:var(--primary);background:none;border-radius:4px;cursor:pointer">수정</button>
                <button onclick="deleteLocation('${l.id}','${l.name.replace(/'/g,"\\'")} (6층)')" style="padding:3px 8px;font-size:.7rem;border:1px solid var(--red);color:var(--red);background:none;border-radius:4px;cursor:pointer">삭제</button>
            </div>
        </div>`).join('');
    }
}

function updateLocationFilters(){
    const filter=document.getElementById('invLocationFilter');
    if(!filter)return;
    const current=filter.value;
    filter.innerHTML='<option value="">전체 장소</option><option value="5층">5층 전체</option><option value="6층">6층 전체</option>';
    locations.forEach(loc=>{
        const opt=document.createElement('option');
        opt.value=`${loc.floor}-${loc.name}`;
        opt.textContent=`${loc.floor}-${loc.name}`;
        filter.appendChild(opt);
    });
    filter.value=current;
}

function openLocationModal(id=null){
    document.getElementById('locationModalTitle').textContent=id?'장소 수정':'장소 추가';
    document.getElementById('locationEditId').value=id||'';
    document.getElementById('locationFloor').value='5층';
    document.getElementById('locationName').value='';
    document.getElementById('locationOrder').value='1';
    
    if(id){
        const loc=locations.find(l=>l.id===id);
        if(loc){
            document.getElementById('locationFloor').value=loc.floor||'5층';
            document.getElementById('locationName').value=loc.name||'';
            document.getElementById('locationOrder').value=loc.order||1;
        }
    }
    openModal('locationModal');
}

function editLocation(id){openLocationModal(id);}

async function saveLocation(){
    const editId=document.getElementById('locationEditId').value;
    const floor=document.getElementById('locationFloor').value;
    const name=document.getElementById('locationName').value.trim();
    const order=parseInt(document.getElementById('locationOrder').value)||1;
    
    if(!name){alert('장소명을 입력하세요.');return;}
    
    const data={floor,name,order,updatedAt:new Date().toISOString()};
    if(!editId)data.createdAt=new Date().toISOString();
    
    try{
        if(editId){
            await db.collection('locations').doc(editId).update(data);
        }else{
            await db.collection('locations').add(data);
        }
        closeModal('locationModal');
        await loadLocations();
        alert('✅ 저장 완료');
    }catch(e){alert('저장 실패: '+e.message);}
}

async function deleteLocation(id,name){
    if(!confirm(`"${name}" 장소를 삭제하시겠습니까?\n해당 장소의 재고 데이터는 유지되지만 새로 입력할 수 없습니다.`))return;
    try{
        await db.collection('locations').doc(id).delete();
        await loadLocations();
        alert('✅ 삭제 완료');
    }catch(e){alert('삭제 실패: '+e.message);}
}

// 초기 장소 데이터 생성 (최초 1회)
async function initDefaultLocations(){
    const snap=await db.collection('locations').limit(1).get();
    if(!snap.empty)return; // 이미 데이터 있음
    
    const defaults=[
        {floor:'5층',name:'처치실',order:1},
        {floor:'5층',name:'냉장고',order:2},
        {floor:'6층',name:'시술실',order:1},
        {floor:'6층',name:'수액실',order:2},
        {floor:'6층',name:'줄기세포센터',order:3},
        {floor:'6층',name:'수술실',order:4},
        {floor:'6층',name:'준비실',order:5},
        {floor:'6층',name:'준비실옆보관실',order:6},
        {floor:'6층',name:'준비실 냉장고',order:7},
        {floor:'6층',name:'어븀실',order:8},
        {floor:'6층',name:'레이저실',order:9},
        {floor:'6층',name:'리팟실',order:10}
    ];
    
    const batch=db.batch();
    defaults.forEach(d=>{
        const ref=db.collection('locations').doc();
        batch.set(ref,{...d,createdAt:new Date().toISOString()});
    });
    await batch.commit();
    console.log('기본 장소 데이터 생성 완료');
}

