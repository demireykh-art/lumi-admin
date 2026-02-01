/* ===== inventory.js - LUMI ERP v11 - 재고 & 레시피 관리 ===== */

const INV_TYPES={disposable:'1회용',portioned:'소분용',hygiene:'위생용품'};
const INV_TYPE_CLASS={disposable:'inv-type-disposable',portioned:'inv-type-portioned',hygiene:'inv-type-hygiene'};
const LOSS_RATE=0.10; // 소분 액체류 10% 로스율
const BASE_HYGIENE_COST=1000; // 기본위생용품 공통 비용

// ===== 재고 렌더링 =====
function renderInventory(){
    const tbody=document.getElementById('inventoryTable');
    if(!tbody)return;
    const search=(document.getElementById('invSearch')?.value||'').toLowerCase();
    const typeFilter=document.getElementById('invTypeFilter')?.value||'';
    
    let items=inventoryItems.filter(i=>{
        if(search&&!i.name?.toLowerCase().includes(search))return false;
        if(typeFilter&&i.type!==typeFilter)return false;
        return true;
    }).sort((a,b)=>(a.name||'').localeCompare(b.name||''));

    if(items.length===0){
        tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:2rem">등록된 소모품이 없습니다. 위 버튼으로 추가하세요.</td></tr>';
    }else{
        tbody.innerHTML=items.map(item=>{
            const typeLabel=INV_TYPES[item.type]||item.type||'-';
            const typeClass=INV_TYPE_CLASS[item.type]||'';
            const expiryWarn=isExpiryWarning(item.expiryDate);
            const stockLow=item.safetyStock&&item.currentStock<item.safetyStock;
            const unitCost=item.purchasePrice&&item.purchaseQty?(item.purchasePrice/item.purchaseQty):0;
            return `<tr class="${stockLow?'inv-stock-low':''}">
                <td><strong>${item.name||'-'}</strong></td>
                <td><span class="inv-type-badge ${typeClass}">${typeLabel}</span></td>
                <td class="text-right">${formatNumber(item.currentStock||0)} ${item.unit||'개'}</td>
                <td class="text-right">${formatNumber(item.safetyStock||0)}</td>
                <td class="text-right">${formatCurrency(item.purchasePrice||0)}</td>
                <td>${item.purchaseQty||'-'} ${item.purchaseUnit||''}</td>
                <td class="text-right">${unitCost?formatCurrency(unitCost):'-'}</td>
                <td class="${expiryWarn?'inv-expiry-warn':''}">${item.expiryDate||'-'}</td>
                <td><div class="btn-group">
                    <button class="btn btn-sm btn-outline" onclick="editInventoryItem('${item.id}')">수정</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteInventoryItem('${item.id}')">삭제</button>
                </div></td>
            </tr>`;
        }).join('');
    }

    // 요약 카드
    const totalItems=inventoryItems.length;
    const lowStock=inventoryItems.filter(i=>i.safetyStock&&i.currentStock<i.safetyStock).length;
    const expiryWarnCount=inventoryItems.filter(i=>isExpiryWarning(i.expiryDate)).length;
    const totalValue=inventoryItems.reduce((s,i)=>s+(i.purchasePrice||0)*(i.currentStock||0)/(i.purchaseQty||1),0);
    
    const cards=document.getElementById('inventoryCards');
    if(cards)cards.innerHTML=`
        <div class="card"><div class="card-label">총 품목 수</div><div class="card-value">${totalItems}개</div></div>
        <div class="card"><div class="card-label">재고 부족 (발주 필요)</div><div class="card-value" style="color:${lowStock?'var(--red)':'var(--green)'}">${lowStock}개</div></div>
        <div class="card"><div class="card-label">유통기한 임박 (3개월)</div><div class="card-value" style="color:${expiryWarnCount?'var(--warning)':'var(--green)'}">${expiryWarnCount}개</div></div>
        <div class="card"><div class="card-label">총 재고 가치</div><div class="card-value">${formatCurrency(totalValue)}</div></div>
    `;
}

function isExpiryWarning(expiryDate){
    if(!expiryDate)return false;
    const exp=new Date(expiryDate);
    const threeMonths=new Date();
    threeMonths.setMonth(threeMonths.getMonth()+3);
    return exp<=threeMonths;
}

// ===== 재고 CRUD =====
function openInventoryModal(id=null){
    const modal=document.getElementById('inventoryModal');
    document.getElementById('invModalTitle').textContent=id?'소모품 수정':'소모품 등록';
    document.getElementById('invEditId').value=id||'';
    
    if(id){
        const item=inventoryItems.find(i=>i.id===id);
        if(item){
            document.getElementById('invName').value=item.name||'';
            document.getElementById('invType').value=item.type||'disposable';
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
        document.getElementById('invName').value='';
        document.getElementById('invType').value='disposable';
        document.getElementById('invUnit').value='개';
        document.getElementById('invCurrentStock').value='';
        document.getElementById('invSafetyStock').value='';
        document.getElementById('invPurchasePrice').value='';
        document.getElementById('invPurchaseQty').value='1';
        document.getElementById('invPurchaseUnit').value='';
        document.getElementById('invExpiryDate').value='';
        document.getElementById('invNote').value='';
    }
    openModal('inventoryModal');
}

async function saveInventoryItem(){
    const id=document.getElementById('invEditId').value;
    const data={
        name:document.getElementById('invName').value.trim(),
        type:document.getElementById('invType').value,
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
        if(id){await db.collection('inventory').doc(id).update(data);}
        else{data.createdAt=new Date().toISOString();await db.collection('inventory').add(data);}
        closeModal('inventoryModal');
        await loadInventory();
        renderInventory();
        if(typeof renderDashboardCards==='function')renderDashboardCards();
    }catch(e){alert('저장 실패: '+e.message);}
}

function editInventoryItem(id){openInventoryModal(id);}
async function deleteInventoryItem(id){
    if(!confirm('정말 삭제하시겠습니까?'))return;
    try{await db.collection('inventory').doc(id).delete();await loadInventory();renderInventory();}
    catch(e){alert('삭제 실패: '+e.message);}
}

// ===== 레시피 렌더링 =====
function renderRecipes(){
    const tbody=document.getElementById('recipeTable');
    if(!tbody)return;
    
    if(recipes.length===0){
        tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:2rem">등록된 레시피가 없습니다.</td></tr>';
    }else{
        tbody.innerHTML=recipes.sort((a,b)=>(a.treatmentName||'').localeCompare(b.treatmentName||'')).map(r=>{
            const cost=calculateRecipeCost(r);
            const ingredientList=(r.ingredients||[]).map(ing=>{
                const item=inventoryItems.find(i=>i.id===ing.itemId);
                return `${item?.name||'?'} × ${ing.amount}${item?.unit||''}`;
            }).join(', ');
            return `<tr>
                <td><strong>${r.treatmentName||'-'}</strong></td>
                <td style="font-size:.8rem;max-width:300px">${ingredientList||'-'}</td>
                <td class="text-right"><span class="recipe-cost-badge">${formatCurrency(cost)}</span></td>
                <td class="text-right">${formatCurrency(BASE_HYGIENE_COST)}</td>
                <td><div class="btn-group">
                    <button class="btn btn-sm btn-outline" onclick="editRecipe('${r.id}')">수정</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteRecipe('${r.id}')">삭제</button>
                </div></td>
            </tr>`;
        }).join('');
    }
    
    // 레시피 요약
    const recipeCards=document.getElementById('recipeCards');
    if(recipeCards){
        const totalRecipes=recipes.length;
        const avgCost=totalRecipes?recipes.reduce((s,r)=>s+calculateRecipeCost(r),0)/totalRecipes:0;
        recipeCards.innerHTML=`
            <div class="card"><div class="card-label">등록된 레시피</div><div class="card-value">${totalRecipes}개</div></div>
            <div class="card"><div class="card-label">평균 재료 원가</div><div class="card-value">${formatCurrency(avgCost)}</div></div>
            <div class="card"><div class="card-label">기본 위생용품</div><div class="card-value">${formatCurrency(BASE_HYGIENE_COST)}/건</div></div>
        `;
    }
}

// ===== 레시피 원가 계산 =====
function calculateRecipeCost(recipe){
    if(!recipe||!recipe.ingredients)return BASE_HYGIENE_COST;
    let cost=BASE_HYGIENE_COST; // 기본위생용품 항상 포함
    
    for(const ing of recipe.ingredients){
        const item=inventoryItems.find(i=>i.id===ing.itemId);
        if(!item)continue;
        const unitCost=item.purchasePrice/(item.purchaseQty||1);
        let amount=ing.amount||0;
        // 소분용 품목은 로스율 10% 적용
        if(item.type==='portioned'){
            amount=amount*(1+LOSS_RATE);
        }
        cost+=unitCost*amount;
    }
    return cost;
}

// 특정 시술의 원가 조회 (외부에서 호출)
function getRecipeCostByTreatment(treatmentName){
    const recipe=recipes.find(r=>r.treatmentName===treatmentName);
    return recipe?calculateRecipeCost(recipe):BASE_HYGIENE_COST;
}

// ===== 레시피 CRUD =====
let tempIngredients=[];

function openRecipeModal(id=null){
    document.getElementById('recipeModalTitle').textContent=id?'레시피 수정':'레시피 등록';
    document.getElementById('recipeEditId').value=id||'';
    
    if(id){
        const r=recipes.find(x=>x.id===id);
        if(r){
            document.getElementById('recipeTreatment').value=r.treatmentName||'';
            tempIngredients=[...(r.ingredients||[])];
        }
    }else{
        document.getElementById('recipeTreatment').value='';
        tempIngredients=[];
    }
    renderIngredientRows();
    openModal('recipeModal');
}

function renderIngredientRows(){
    const container=document.getElementById('recipeIngredients');
    container.innerHTML=tempIngredients.map((ing,idx)=>{
        const item=inventoryItems.find(i=>i.id===ing.itemId);
        return `<div class="recipe-ingredient-row">
            <select onchange="tempIngredients[${idx}].itemId=this.value">
                <option value="">품목 선택</option>
                ${inventoryItems.map(i=>`<option value="${i.id}" ${i.id===ing.itemId?'selected':''}>${i.name} (${INV_TYPES[i.type]||i.type})</option>`).join('')}
            </select>
            <input type="number" step="0.001" value="${ing.amount||''}" placeholder="소모량" onchange="tempIngredients[${idx}].amount=parseFloat(this.value)||0" style="max-width:100px">
            <span style="font-size:.75rem;color:var(--text-secondary);min-width:30px">${item?.unit||''}</span>
            <button class="btn btn-sm btn-danger" onclick="removeIngredient(${idx})">×</button>
        </div>`;
    }).join('');
    
    // 예상 원가 표시
    const estCost=BASE_HYGIENE_COST+tempIngredients.reduce((s,ing)=>{
        const item=inventoryItems.find(i=>i.id===ing.itemId);
        if(!item)return s;
        const unitCost=item.purchasePrice/(item.purchaseQty||1);
        let amount=ing.amount||0;
        if(item.type==='portioned')amount*=(1+LOSS_RATE);
        return s+unitCost*amount;
    },0);
    document.getElementById('recipeEstCost').textContent=formatCurrency(estCost);
}

function addIngredient(){
    tempIngredients.push({itemId:'',amount:0});
    renderIngredientRows();
}
function removeIngredient(idx){
    tempIngredients.splice(idx,1);
    renderIngredientRows();
}

async function saveRecipe(){
    const id=document.getElementById('recipeEditId').value;
    const data={
        treatmentName:document.getElementById('recipeTreatment').value.trim(),
        ingredients:tempIngredients.filter(i=>i.itemId&&i.amount>0),
        updatedAt:new Date().toISOString()
    };
    if(!data.treatmentName){alert('시술명을 입력하세요.');return;}
    try{
        if(id){await db.collection('recipes').doc(id).update(data);}
        else{data.createdAt=new Date().toISOString();await db.collection('recipes').add(data);}
        closeModal('recipeModal');
        await loadRecipes();
        renderRecipes();
    }catch(e){alert('저장 실패: '+e.message);}
}

function editRecipe(id){openRecipeModal(id);}
async function deleteRecipe(id){
    if(!confirm('정말 삭제하시겠습니까?'))return;
    try{await db.collection('recipes').doc(id).delete();await loadRecipes();renderRecipes();}
    catch(e){alert('삭제 실패: '+e.message);}
}

// ===== 발주 필요 품목 수 (대시보드용) =====
function getLowStockCount(){
    return inventoryItems.filter(i=>i.safetyStock&&i.currentStock<i.safetyStock).length;
}
