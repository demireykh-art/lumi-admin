/* ===== inventory.js - LUMI ERP v11.1 재고 & 레시피 & 실사 ===== */

const INV_TYPES={disposable:'1회용',portioned:'소분용',hygiene:'위생용품'};
const INV_TYPE_CLASS={disposable:'inv-type-disposable',portioned:'inv-type-portioned',hygiene:'inv-type-hygiene'};
const INV_CATEGORIES={nursing:'간호',skin:'피부',desk:'데스크',common:'공통'};
const INV_CAT_CLASS={nursing:'inv-cat-nursing',skin:'inv-cat-skin',desk:'inv-cat-desk',common:'inv-cat-common'};
const LOSS_RATE=0.10;
const BASE_HYGIENE_COST=1000;

// ===== 재고 렌더링 =====
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
    }).sort((a,b)=>(a.name||'').localeCompare(b.name||''));

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
            return `<tr class="${stockLow?'inv-stock-low':''}">
                <td><strong>${item.name||'-'}</strong></td>
                <td><span class="inv-type-badge ${catClass}">${catLabel}</span></td>
                <td><span class="inv-type-badge ${typeClass}">${typeLabel}</span></td>
                <td class="text-right">${formatNumber(item.currentStock||0)} ${item.unit||'개'}</td>
                <td class="text-right">${formatNumber(item.safetyStock||0)}</td>
                <td class="text-right">${formatCurrency(item.purchasePrice||0)}</td>
                <td class="text-right">${unitCost?formatCurrency(unitCost):'-'}</td>
                <td class="${isExpiryWarning(item.expiryDate)?'inv-expiry-warn':''}">${item.expiryDate||'-'}</td>
                <td><div class="btn-group">
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
        }
    }else{
        ['invName','invUnit','invCurrentStock','invSafetyStock','invPurchasePrice','invPurchaseUnit','invExpiryDate','invNote'].forEach(x=>document.getElementById(x).value='');
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
    container.innerHTML=`
        <div class="cards-grid" style="margin-bottom:1rem">
            <div class="card"><div class="card-label">실사 완료</div><div class="card-value">${done.length} / ${items.length}</div></div>
            <div class="card"><div class="card-label">차이 발생</div><div class="card-value" style="color:${diffItems.length?'var(--red)':'var(--green)'}">${diffItems.length}개</div></div>
            <div class="card"><div class="card-label">최근 실사</div><div class="card-value" style="font-size:.85rem">${done.length?new Date(done[0].audit.createdAt).toLocaleDateString('ko'):'없음'}</div></div>
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
