/* ===== expense.js - LUMI ERP v11 - 지출 관리 ===== */
function renderExpenses(){
    // 정렬 함수
    const sortExpenses=(list,sortKey)=>{
        const sorted=[...list];
        switch(sortKey){
            case 'date-desc':sorted.sort((a,b)=>(b.date||'').localeCompare(a.date||''));break;
            case 'date-asc':sorted.sort((a,b)=>(a.date||'').localeCompare(b.date||''));break;
            case 'amount-desc':sorted.sort((a,b)=>(b.amount||0)-(a.amount||0));break;
            case 'amount-asc':sorted.sort((a,b)=>(a.amount||0)-(b.amount||0));break;
            case 'category':sorted.sort((a,b)=>(a.category||'').localeCompare(b.category||''));break;
        }
        return sorted;
    };
    
    // 고정비 카테고리 필터 드롭다운 업데이트
    const categories=[...new Set(fixedExpenses.map(e=>e.category))].sort();
    const categoryFilter=document.getElementById('fixedCategoryFilter');
    if(categoryFilter){
        const currentVal=categoryFilter.value;
        categoryFilter.innerHTML='<option value="">전체 카테고리</option>'+categories.map(c=>`<option value="${c}">${c}</option>`).join('');
        categoryFilter.value=currentVal||'';
    }
    
    // 고정비 필터링
    const searchText=(document.getElementById('fixedSearch')?.value||'').toLowerCase();
    const filterCategory=document.getElementById('fixedCategoryFilter')?.value||'';
    let filteredFixed=fixedExpenses.filter(e=>{
        const matchSearch=!searchText||e.name.toLowerCase().includes(searchText)||(e.note||'').toLowerCase().includes(searchText);
        const matchCategory=!filterCategory||e.category===filterCategory;
        return matchSearch&&matchCategory;
    });
    
    // 고정비
    const fixedSort=document.getElementById('fixedSort')?.value||'date-desc';
    const sortedFixed=sortExpenses(filteredFixed,fixedSort);
    const fixedTotal=fixedExpenses.reduce((sum,e)=>sum+(e.amount||0),0);
    const filteredTotal=filteredFixed.reduce((sum,e)=>sum+(e.amount||0),0);
    document.getElementById('fixedTotal').textContent=formatCurrency(fixedTotal);
    document.getElementById('fixedCount').textContent=fixedExpenses.length+'개';
    document.getElementById('fixedYearly').textContent=formatCurrency(fixedTotal*12);
    // 이체 현황 업데이트
    const ym=getYM();
    const transferItems=fixedExpenses.filter(e=>e.transferBank&&e.transferAccount);
    const doneItems=transferItems.filter(e=>e.lastTransferYM===ym);
    const transferEl=document.getElementById('fixedTransferStatus');
    if(transferItems.length>0){
        transferEl.innerHTML=`<span style="color:${doneItems.length===transferItems.length?'#2e7d32':'#e65100'}">${doneItems.length}/${transferItems.length} 완료</span>`;
    } else { transferEl.textContent='-'; }
    
    // 고정비 테이블 - 장비리스 정보 표시 개선
    document.getElementById('fixedTable').innerHTML=sortedFixed.map(e=>{
        let noteDisplay=e.note||'-';
        // 장비리스인 경우 추가 정보 표시
        if(e.category==='장비리스/렌탈'&&(e.leaseEndDate||e.leasePaymentDay)){
            const leaseInfo=[];
            if(e.leasePaymentMethod)leaseInfo.push(e.leasePaymentMethod);
            if(e.leasePaymentDay)leaseInfo.push('매월 '+e.leasePaymentDay+'일');
            if(e.leaseEndDate)leaseInfo.push(e.leaseEndDate+' 만기');
            if(e.leaseCompany)leaseInfo.push(e.leaseCompany);
            if(leaseInfo.length>0)noteDisplay=leaseInfo.join(', ')+(e.note?' | '+e.note:'');
        }
        return `<tr><td>${e.date||'-'}</td><td><strong>${e.name}</strong></td><td>${getCategoryBadge(e.category)}</td><td class="text-right">${formatCurrency(e.amount)}</td><td>${e.transferBank&&e.transferAccount?`<span style="font-size:12px">${e.transferBank} ${e.transferAccount}${e.transferHolder?' ('+e.transferHolder+')':''}</span>`:'<span style="color:#aaa;font-size:12px">미등록</span>'}</td><td>${noteDisplay}</td><td>${e.transferBank&&e.transferAccount?(e.lastTransferYM===getYM()?`<span style="color:#2e7d32;font-size:12px;font-weight:600;cursor:pointer" onclick="doTransfer('${e.id}')" title="클릭하여 재이체">✅ ${e.lastTransferDate?e.lastTransferDate.substring(5):''}</span>`:`<button class="btn btn-sm" style="background:#2e7d32;color:#fff;white-space:nowrap" onclick="doTransfer('${e.id}')">💸 이체</button>`):'<span style="color:#ccc">-</span>'}</td><td><button class="btn btn-sm btn-secondary" onclick="editExpense('fixed','${e.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteExpense('fixed','${e.id}')">삭제</button></td></tr>`;
    }).join('')||(searchText||filterCategory?`<tr><td colspan="8" class="text-center">검색 결과 없음 (전체 ${fixedExpenses.length}개 중)</td></tr>`:'<tr><td colspan="8" class="text-center">등록된 고정비 없음</td></tr>');

    // 유동비 (현재 선택 월만 + 검색/카드/카테고리/개인사용숨김)
    const variableSort=document.getElementById('variableSort')?.value||'date-desc';
    const vSearch=(document.getElementById('variableSearch')?.value||'').trim().toLowerCase();
    const vCardFilter=document.getElementById('variableCardFilter')?.value||'';
    const vCatFilter=document.getElementById('variableCategoryFilter')?.value||'';
    const vHidePersonal=document.getElementById('variableHidePersonal')?.checked;

    // 카드/카테고리 옵션 자동 채우기 (현재 월 데이터 기준)
    const monthRows=variableExpenses.filter(e=>!e.yearMonth||e.yearMonth===getYM());
    const cardSet=new Set(monthRows.map(e=>e.cardLabel||e.card||'').filter(Boolean));
    const catSet=new Set(monthRows.map(e=>e.category||'').filter(Boolean));
    const cardFilterEl=document.getElementById('variableCardFilter');
    const catFilterEl=document.getElementById('variableCategoryFilter');
    if(cardFilterEl){
        const cur=cardFilterEl.value;
        cardFilterEl.innerHTML='<option value="">전체 카드/수단</option>'+[...cardSet].sort().map(c=>`<option value="${c}">${c}</option>`).join('');
        cardFilterEl.value=cur;
    }
    if(catFilterEl){
        const cur=catFilterEl.value;
        catFilterEl.innerHTML='<option value="">전체 카테고리</option>'+[...catSet].sort().map(c=>`<option value="${c}">${c}</option>`).join('');
        catFilterEl.value=cur;
    }

    const variableFiltered=monthRows.filter(e=>{
        if(vCardFilter && (e.cardLabel||e.card)!==vCardFilter) return false;
        if(vCatFilter && e.category!==vCatFilter) return false;
        if(vHidePersonal && e.isPersonal) return false;
        if(vSearch){
            const hay=(e.name+' '+(e.merchant||'')+' '+(e.note||'')+' '+(e.cardLabel||e.card||'')).toLowerCase();
            if(!hay.includes(vSearch)) return false;
        }
        return true;
    });
    const sortedVariable=sortExpenses(variableFiltered,variableSort);
    const variableTotal=variableFiltered.reduce((sum,e)=>sum+(e.amount||0),0);
    document.getElementById('variableTotal').textContent=formatCurrency(variableTotal);
    document.getElementById('variableCount').textContent=variableFiltered.length+'건';
    document.getElementById('variableTable').innerHTML=sortedVariable.map(e=>{
        const merchant=e.merchant||'';
        const note=e.note||'';
        const catBadge=getCategoryBadge(e.category);
        const cardCell=e.cardLabel||e.card||'-';
        const personalBadge=e.isPersonal?' <span style="font-size:.7rem;background:#fde8e8;color:#9b1c1c;padding:1px 5px;border-radius:3px">개인</span>':'';
        const rowStyle=e.isPersonal?'background:#fffbeb':'';
        return `<tr style="${rowStyle}"><td>${e.date}</td><td><strong>${e.name}</strong>${personalBadge}</td><td style="font-size:.85rem;color:#555;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${merchant}">${merchant||'-'}</td><td>${catBadge}</td><td>${cardCell}</td><td class="text-right">${formatCurrency(e.amount)}</td><td style="font-size:.8rem;color:#777;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${note}">${note||'-'}</td><td><button class="btn btn-sm btn-secondary" onclick="editExpense('variable','${e.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteExpense('variable','${e.id}')">삭제</button></td></tr>`;
    }).join('')||'<tr><td colspan="8" class="text-center">표시할 유동비 없음</td></tr>';
    
    // 급여 렌더링
    renderPayroll();
    
    // 세금 렌더링
    renderTaxes();
    
    // 지출 분석 렌더링
    renderExpenseAnalysis();
}

// 장비리스 필드 토글
function toggleLeaseFields(){
    const category=document.getElementById('expenseCategory')?.value||'';
    const leaseFields=document.getElementById('leaseFields');
    if(leaseFields){
        leaseFields.style.display=(category==='장비리스/렌탈')?'block':'none';
    }
}

function renderPayroll(){
    const ym=getYM();
    const filterMonth=document.getElementById('payrollMonth')?.value||'';
    
    // 월 선택 드롭다운 업데이트
    const months=[...new Set(payrollData.map(p=>p.yearMonth))].sort().reverse();
    const monthSelect=document.getElementById('payrollMonth');
    if(monthSelect){
        const currentVal=monthSelect.value;
        monthSelect.innerHTML='<option value="">전체</option>'+months.map(m=>`<option value="${m}">${m}</option>`).join('');
        monthSelect.value=currentVal||'';
    }
    
    // 필터링
    let filtered=payrollData;
    if(filterMonth){filtered=payrollData.filter(p=>p.yearMonth===filterMonth);}
    else{filtered=payrollData.filter(p=>p.yearMonth===ym);}
    
    // 합계 계산
    const totalGross=filtered.reduce((sum,p)=>sum+(p.grossPay||0),0);
    const totalNet=filtered.reduce((sum,p)=>sum+(p.netPay||0),0);
    const empCount=filtered.length;
    
    document.getElementById('payrollTotal').textContent=formatCurrency(totalGross);
    document.getElementById('payrollNetTotal').textContent=formatCurrency(totalNet);
    document.getElementById('payrollCount').textContent=empCount+'명';
    
    // 테이블
    document.getElementById('payrollTable').innerHTML=filtered.sort((a,b)=>(b.yearMonth||'').localeCompare(a.yearMonth||'')||(a.name||'').localeCompare(b.name||'')).map(p=>`<tr><td>${p.yearMonth||'-'}</td><td><strong>${p.name||'-'}</strong></td><td class="text-right">${formatCurrency(p.extraOT||0)}</td><td class="text-right">${formatCurrency(p.incentive||0)}</td><td class="text-right"><strong>${formatCurrency(p.netPay)}</strong></td><td><button class="btn btn-sm btn-danger" onclick="deletePayroll('${p.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="6" class="text-center">등록된 급여 내역 없음</td></tr>';
}

function renderTaxes(){
    // 원천세 (근로소득세+지방세)
    const withholdingTotal=withholdingTaxes.reduce((sum,t)=>sum+((t.incomeTax||0)+(t.localTax||0)),0);
    document.getElementById('withholdingTotal').textContent=formatCurrency(withholdingTotal);
    document.getElementById('withholdingTable').innerHTML=withholdingTaxes.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=>`<tr><td>${t.date||'-'}</td><td>${t.attributeMonth||'-'}</td><td class="text-right">${formatCurrency(t.incomeTax)}</td><td class="text-right">${formatCurrency(t.localTax)}</td><td class="text-right"><strong>${formatCurrency((t.incomeTax||0)+(t.localTax||0))}</strong></td><td>${t.note||'-'}</td><td><button class="btn btn-sm btn-secondary" onclick="editTax('withholding','${t.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteTax('withholding','${t.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="7" class="text-center">등록된 원천세 내역 없음</td></tr>';
    
    // 부가세
    const vatTotal=vatTaxes.reduce((sum,t)=>sum+(t.amount||0),0);
    document.getElementById('vatTotal').textContent=formatCurrency(vatTotal);
    document.getElementById('vatTable').innerHTML=vatTaxes.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=>`<tr><td>${t.date||'-'}</td><td>${t.quarter||'-'}</td><td class="text-right"><strong>${formatCurrency(t.amount)}</strong></td><td>${t.note||'-'}</td><td><button class="btn btn-sm btn-secondary" onclick="editTax('vat','${t.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteTax('vat','${t.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="5" class="text-center">등록된 부가세 내역 없음</td></tr>';
    
    // 종소세
    const incomeTotal=incomeTaxes.filter(t=>t.taxYear===String(currentYear)||t.taxYear===String(currentYear-1)).reduce((sum,t)=>sum+(t.amount||0),0);
    document.getElementById('incomeTotal').textContent=formatCurrency(incomeTotal);
    document.getElementById('incomeTable').innerHTML=incomeTaxes.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=>`<tr><td>${t.date||'-'}</td><td>${t.taxYear||'-'}년</td><td>${t.incomeType||'-'}</td><td class="text-right"><strong>${formatCurrency(t.amount)}</strong></td><td>${t.note||'-'}</td><td><button class="btn btn-sm btn-secondary" onclick="editTax('income','${t.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteTax('income','${t.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="6" class="text-center">등록된 종소세 내역 없음</td></tr>';
    
    // 합계
    document.getElementById('taxTotal').textContent=formatCurrency(withholdingTotal+vatTotal+incomeTotal);
}

let expenseChart=null;
function renderExpenseAnalysis(){
    const ym=getYM();
    const fixedTotal=fixedExpenses.reduce((sum,e)=>sum+(e.amount||0),0);
    const variableTotal=variableExpenses.reduce((sum,e)=>sum+(e.amount||0),0);
    // 인건비 (해당월)
    const payrollTotal=payrollData.filter(p=>p.yearMonth===ym).reduce((sum,p)=>sum+(p.netPay||0),0);
    const totalExpense=fixedTotal+variableTotal+payrollTotal;
    
    // 월 매출
    const rev=revenueData[ym];
    const monthRevenue=rev?rev.total:0;
    const monthProfit=monthRevenue-totalExpense;
    const profitRate=monthRevenue>0?((monthProfit/monthRevenue)*100).toFixed(1):0;
    
    document.getElementById('totalExpense').textContent=formatCurrency(totalExpense);
    document.getElementById('totalExpense').nextElementSibling.textContent=`고정비 + 유동비 + 인건비`;
    document.getElementById('monthRevenue').textContent=formatCurrency(monthRevenue);
    document.getElementById('monthRevenueDate').textContent=rev?`${ym.substring(0,4)}년 ${parseInt(ym.substring(5))}월`:'데이터 없음';
    document.getElementById('monthProfit').textContent=formatCurrency(monthProfit);
    document.getElementById('monthProfit').style.color=monthProfit>=0?'var(--accent-green)':'var(--accent-red)';
    document.getElementById('profitRate').textContent=profitRate+'%';
    document.getElementById('profitRate').style.color=monthProfit>=0?'var(--accent-green)':'var(--accent-red)';
    
    // 카테고리별 지출
    const fixedByCategory={};
    fixedExpenses.forEach(e=>{fixedByCategory[e.category]=(fixedByCategory[e.category]||0)+e.amount;});
    // 인건비를 고정비 카테고리에 추가
    if(payrollTotal>0)fixedByCategory['인건비']=payrollTotal;
    const variableByCategory={};
    variableExpenses.forEach(e=>{variableByCategory[e.category]=(variableByCategory[e.category]||0)+e.amount;});
    
    const renderCategoryList=(data,total)=>{
        const sorted=Object.entries(data).sort((a,b)=>b[1]-a[1]);
        return sorted.map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee"><span>${getCategoryBadge(cat)}</span><span><strong>${formatCurrency(amt)}</strong> <span style="color:#999">(${((amt/total)*100).toFixed(1)}%)</span></span></div>`).join('')||'<div style="color:#999;padding:8px 0">데이터 없음</div>';
    };
    document.getElementById('fixedByCategory').innerHTML=renderCategoryList(fixedByCategory,fixedTotal||1);
    document.getElementById('variableByCategory').innerHTML=renderCategoryList(variableByCategory,variableTotal||1);
    
    // 월별 지출 차트
    renderExpenseChart();
}

function renderExpenseChart(){
    const year=currentYear;
    const months=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    const fixedData=[];const variableData=[];const revenueDataArr=[];const profitData=[];
    
    for(let m=1;m<=12;m++){
        const ym=year+String(m).padStart(2,'0');
        // 고정비: 연간 전체 데이터에서 해당 월 필터
        const fixedTotal=(typeof allFixedExpenses!=='undefined'?allFixedExpenses:fixedExpenses).filter(e=>e.yearMonth===ym).reduce((sum,e)=>sum+(e.amount||0),0);
        // 유동비: 연간 전체 데이터에서 해당 월 필터
        const varTotal=(typeof allVariableExpenses!=='undefined'?allVariableExpenses:variableExpenses).filter(e=>e.yearMonth===ym).reduce((sum,e)=>sum+(e.amount||0),0);
        const rev=revenueData[ym];
        const monthRev=rev?rev.total:0;
        
        fixedData.push(fixedTotal/10000);
        variableData.push(varTotal/10000);
        revenueDataArr.push(monthRev/10000);
        profitData.push((monthRev-fixedTotal-varTotal)/10000);
    }
    
    const ctx=document.getElementById('expenseChart');
    if(!ctx)return;
    if(expenseChart)expenseChart.destroy();
    expenseChart=new Chart(ctx,{
        type:'bar',
        data:{
            labels:months,
            datasets:[
                {label:'매출',data:revenueDataArr,type:'line',borderColor:'rgba(154,139,122,1)',backgroundColor:'rgba(154,139,122,0.1)',fill:true,tension:0.3,yAxisID:'y'},
                {label:'고정비',data:fixedData,backgroundColor:'rgba(59,130,246,0.7)',stack:'expense',yAxisID:'y'},
                {label:'유동비',data:variableData,backgroundColor:'rgba(249,115,22,0.7)',stack:'expense',yAxisID:'y'},
                {label:'수익',data:profitData,type:'line',borderColor:'rgba(34,197,94,1)',borderDash:[5,5],pointStyle:'rectRot',pointRadius:4,yAxisID:'y'}
            ]
        },
        options:{
            responsive:true,
            interaction:{mode:'index',intersect:false},
            scales:{y:{beginAtZero:true,ticks:{callback:v=>v.toLocaleString()+'만'}}},
            plugins:{tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw.toLocaleString()+'만원'}}}
        }
    });
}

function openExpenseModal(type,id=null){
    document.getElementById('expenseModalTitle').textContent=id?(type==='fixed'?'고정비 수정':'유동비 수정'):(type==='fixed'?'고정비 추가':'유동비 추가');
    document.getElementById('expenseEditId').value=id||'';document.getElementById('expenseType').value=type;
    document.getElementById('expenseName').value='';document.getElementById('expenseAmount').value='';document.getElementById('expenseNote').value='';
    document.getElementById('expenseDate').value=new Date().toISOString().split('T')[0];
    document.getElementById('expenseDateGroup').style.display='block';  // 고정비/유동비 모두 날짜 표시
    document.getElementById('expenseCardGroup').style.display=type==='variable'?'block':'none';
    document.getElementById('expenseCard').value='롯데카드';
    // 이체 정보 초기화
    document.getElementById('transferFields').style.display=type==='fixed'?'block':'none';
    document.getElementById('transferBank').value='';
    document.getElementById('transferAccount').value='';
    document.getElementById('transferHolder').value='';
    // 장비리스 필드 초기화
    document.getElementById('leaseFields').style.display='none';
    document.getElementById('leaseStartDate').value='';
    document.getElementById('leaseEndDate').value='';
    document.getElementById('leasePaymentDay').value='';
    document.getElementById('leasePaymentMethod').value='롯데카드';
    document.getElementById('leaseCompany').value='';
    // 카테고리 드롭다운 — Firestore 기반 (expense-categories.js)
    const catSelect=document.getElementById('expenseCategory');
    if(typeof buildExpenseCategoryDropdown==='function'){
        buildExpenseCategoryDropdown(catSelect, type==='fixed'?'fixed':'variable', type==='fixed'?'기타고정':'기타');
    }else{
        const cats=type==='fixed'?fixedCategories:variableCategories;
        catSelect.innerHTML=cats.map(c=>`<option value="${c.value}">${c.label}</option>`).join('');
        catSelect.value='기타';
    }
    if(id){const list=type==='fixed'?fixedExpenses:variableExpenses;const item=list.find(e=>e.id===id);if(item){
        document.getElementById('expenseName').value=item.name||'';document.getElementById('expenseCategory').value=item.category||'기타';
        document.getElementById('expenseAmount').value=item.amount||'';document.getElementById('expenseNote').value=item.note||'';
        document.getElementById('expenseDate').value=item.date||'';
        if(type==='variable'){document.getElementById('expenseCard').value=item.card||'롯데카드';}
        // 이체 정보 로드
        if(type==='fixed'){
            document.getElementById('transferBank').value=item.transferBank||'';
            document.getElementById('transferAccount').value=item.transferAccount||'';
            document.getElementById('transferHolder').value=item.transferHolder||'';
        }
        // 장비리스 정보 로드
        if(item.category==='장비리스/렌탈'){
            document.getElementById('leaseFields').style.display='block';
            document.getElementById('leaseStartDate').value=item.leaseStartDate||'';
            document.getElementById('leaseEndDate').value=item.leaseEndDate||'';
            document.getElementById('leasePaymentDay').value=item.leasePaymentDay||'';
            document.getElementById('leasePaymentMethod').value=item.leasePaymentMethod||'롯데카드';
            document.getElementById('leaseCompany').value=item.leaseCompany||'';
        }
    }}
    toggleLeaseFields();
    openModal('expenseModal');
}
async function saveExpense(){
    const editId=document.getElementById('expenseEditId').value;
    const type=document.getElementById('expenseType').value;
    const name=document.getElementById('expenseName').value.trim();
    const category=document.getElementById('expenseCategory').value;
    const amount=parseInt(document.getElementById('expenseAmount').value)||0;
    const note=document.getElementById('expenseNote').value.trim();
    const date=document.getElementById('expenseDate').value;
    const card=document.getElementById('expenseCard').value;
    if(!name||!amount){alert('항목명과 금액은 필수입니다.');return;}
    const collection=type==='fixed'?'fixedExpenses':'variableExpenses';
    const data={name,category,amount,note,date};
    if(type==='variable'){data.card=card;}
    // 이체 정보 저장 (고정비만)
    if(type==='fixed'){
        data.transferBank=document.getElementById('transferBank').value||null;
        data.transferAccount=document.getElementById('transferAccount').value.replace(/[^0-9]/g,'')||null;
        data.transferHolder=document.getElementById('transferHolder').value.trim()||null;
    }
    // 장비리스 정보 저장
    if(category==='장비리스/렌탈'){
        data.leaseStartDate=document.getElementById('leaseStartDate').value||null;
        data.leaseEndDate=document.getElementById('leaseEndDate').value||null;
        data.leasePaymentDay=parseInt(document.getElementById('leasePaymentDay').value)||null;
        data.leasePaymentMethod=document.getElementById('leasePaymentMethod').value||null;
        data.leaseCompany=document.getElementById('leaseCompany').value.trim()||null;
    }
    data.yearMonth=date?date.substring(0,7):getYM();
    try{
        if(editId){await db.collection(collection).doc(editId).update(data);}
        else{await db.collection(collection).add(data);}
        closeModal('expenseModal');await loadExpenses();renderExpenses();
    }catch(e){alert('저장 실패: '+e.message);}
}
function editExpense(type,id){openExpenseModal(type,id);}
async function deleteExpense(type,id){
    if(!confirm('정말 삭제하시겠습니까?'))return;
    try{const collection=type==='fixed'?'fixedExpenses':'variableExpenses';await db.collection(collection).doc(id).delete();await loadExpenses();renderExpenses();}catch(e){alert('삭제 실패: '+e.message);}
}
// 이체 기능
function doTransfer(id){
    const item=fixedExpenses.find(e=>e.id===id);
    if(!item||!item.transferBank||!item.transferAccount)return alert('이체 정보가 없습니다.');
    openTransferModal(item);
}
function openTransferModal(item){
    const bankCodes={'신한':'088','국민':'004','우리':'020','하나':'081','농협':'011','기업':'003','SC제일':'023','씨티':'027','카카오뱅크':'090','토스뱅크':'092','케이뱅크':'089','대구':'031','부산':'032','경남':'039','광주':'034','전북':'037','제주':'035','수협':'007','새마을금고':'045','신협':'048','우체국':'071','산업':'002'};
    const bankCode=bankCodes[item.transferBank]||'088';
    const isMobile=/Android|iPhone|iPad/i.test(navigator.userAgent);
    let html=`<div style="text-align:center;padding:20px 0">
        <div style="font-size:18px;font-weight:700;margin-bottom:20px">💸 ${item.name} 이체</div>
        <div style="background:#f5f5f0;border-radius:12px;padding:20px;margin-bottom:20px;text-align:left">
            <div style="display:grid;grid-template-columns:80px 1fr;gap:12px;font-size:15px">
                <span style="color:#888">입금은행</span><strong>${item.transferBank}은행</strong>
                <span style="color:#888">계좌번호</span><strong id="transferAcctDisplay">${item.transferAccount}</strong>
                <span style="color:#888">예금주</span><strong>${item.transferHolder||'-'}</strong>
                <span style="color:#888">이체금액</span><strong style="color:#2e7d32;font-size:17px">${formatCurrency(item.amount)}</strong>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn btn-primary" style="background:#2e7d32;padding:14px;font-size:15px" onclick="copyTransferInfo('${item.transferBank}','${item.transferAccount}','${item.transferHolder||''}',${item.amount},'${item.name}')">📋 이체 정보 복사</button>`;
    if(isMobile){
        // 신한SOL뱅크 딥링크 (앱 열기)
        html+=`<button class="btn" style="background:#0046ff;color:#fff;padding:14px;font-size:15px" onclick="openSOLApp()">🏦 신한 SOL뱅크 열기</button>
            <button class="btn" style="background:#1e3a5f;color:#fff;padding:14px;font-size:15px" onclick="openSOLBizApp()">🏢 신한 SOL Biz 열기</button>`;
    }
    html+=`<button class="btn" style="background:#e3a008;color:#fff;padding:14px;font-size:15px" onclick="markTransferDone('${item.id}')">✅ 이체 완료 기록</button>
        </div>
        <div id="transferCopyResult" style="margin-top:12px;color:#2e7d32;font-weight:600;display:none">✅ 복사 완료!</div>
    </div>`;
    // 모달 동적 생성
    let modal=document.getElementById('transferModal');
    if(!modal){modal=document.createElement('div');modal.id='transferModal';modal.className='modal';modal.innerHTML=`<div class="modal-content" style="max-width:420px"><div class="modal-header"><div class="modal-title">이체 실행</div><button class="modal-close" onclick="closeModal('transferModal')">&times;</button></div><div class="modal-body" id="transferModalBody"></div></div>`;document.body.appendChild(modal);}
    document.getElementById('transferModalBody').innerHTML=html;
    openModal('transferModal');
}
function copyTransferInfo(bank,account,holder,amount,name){
    const text=`[${name}]\n입금은행: ${bank}은행\n계좌번호: ${account}\n예금주: ${holder||'-'}\n이체금액: ${amount.toLocaleString()}원`;
    navigator.clipboard.writeText(account).then(()=>{
        const r=document.getElementById('transferCopyResult');
        r.style.display='block';r.textContent='✅ 계좌번호 복사 완료! ('+account+')';
        setTimeout(()=>{r.style.display='none';},3000);
    }).catch(()=>{
        // fallback
        const ta=document.createElement('textarea');ta.value=account;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
        const r=document.getElementById('transferCopyResult');r.style.display='block';r.textContent='✅ 계좌번호 복사 완료!';
        setTimeout(()=>{r.style.display='none';},3000);
    });
}
function openSOLApp(){
    // 신한 SOL뱅크 앱 열기 시도
    const schemes=['shinhan-solbank://','sbankmoasign://','newsolbank://'];
    const androidPkg='com.shinhan.sbanking';
    const iosStore='https://apps.apple.com/kr/app/id357484932';
    const isAndroid=/Android/i.test(navigator.userAgent);
    if(isAndroid){
        // intent 스킴 사용
        location.href='intent://#Intent;scheme=shinhan-solbank;package='+androidPkg+';end';
    } else {
        // iOS: custom scheme 시도 → 실패 시 앱스토어
        const start=Date.now();
        location.href='shinhan-solbank://';
        setTimeout(()=>{if(Date.now()-start<2000)location.href=iosStore;},1500);
    }
}
function openSOLBizApp(){
    const isAndroid=/Android/i.test(navigator.userAgent);
    if(isAndroid){
        location.href='intent://#Intent;scheme=shinhan-solbiz;package=com.shinhan.bizbank;end';
    } else {
        const start=Date.now();
        location.href='shinhan-solbiz://';
        setTimeout(()=>{if(Date.now()-start<2000)location.href='https://apps.apple.com/kr/app/id587766126';},1500);
    }
}
async function markTransferDone(id){
    const now=new Date();
    const ym=now.getFullYear()+('0'+(now.getMonth()+1)).slice(-2);
    const dateStr=now.toISOString().split('T')[0];
    const timeStr=now.toTimeString().split(' ')[0].substring(0,5);
    try{
        await db.collection('fixedExpenses').doc(id).update({
            lastTransferDate:dateStr,
            lastTransferTime:timeStr,
            lastTransferYM:ym
        });
        await loadExpenses();renderExpenses();
        closeModal('transferModal');
        alert('✅ 이체 완료가 기록되었습니다. ('+dateStr+' '+timeStr+')');
    }catch(e){alert('기록 실패: '+e.message);}
}
function batchTransfer(){
    const ym=getYM();
    const pending=fixedExpenses.filter(e=>e.transferBank&&e.transferAccount&&e.lastTransferYM!==ym);
    if(pending.length===0)return alert('✅ 이번 달 이체가 모두 완료되었습니다!');
    const totalAmount=pending.reduce((s,e)=>s+(e.amount||0),0);
    let html=`<div style="padding:10px 0">
        <div style="font-size:16px;font-weight:700;margin-bottom:16px">📋 미이체 항목 (${pending.length}건, 총 ${formatCurrency(totalAmount)})</div>
        <div style="max-height:400px;overflow-y:auto">`;
    pending.forEach((e,i)=>{
        html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:${i%2?'#fff':'#f9f9f7'};border-radius:8px;margin-bottom:6px">
            <div>
                <div style="font-weight:600">${e.name}</div>
                <div style="font-size:12px;color:#888">${e.transferBank} ${e.transferAccount} ${e.transferHolder?'('+e.transferHolder+')':''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
                <strong style="color:#2e7d32">${formatCurrency(e.amount)}</strong>
                <button class="btn btn-sm" style="background:#2e7d32;color:#fff" onclick="doTransfer('${e.id}')">이체</button>
            </div>
        </div>`;
    });
    html+=`</div></div>`;
    let modal=document.getElementById('batchTransferModal');
    if(!modal){modal=document.createElement('div');modal.id='batchTransferModal';modal.className='modal';modal.innerHTML=`<div class="modal-content" style="max-width:520px"><div class="modal-header"><div class="modal-title">💸 일괄 이체</div><button class="modal-close" onclick="closeModal('batchTransferModal')">&times;</button></div><div class="modal-body" id="batchTransferBody"></div></div>`;document.body.appendChild(modal);}
    document.getElementById('batchTransferBody').innerHTML=html;
    openModal('batchTransferModal');
}

// CRUD Operations - Payroll
async function processPayrollFile(input){
    const file=input.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=async function(e){
        try{
            const data=new Uint8Array(e.target.result);
            const workbook=XLSX.read(data,{type:'array'});
            
            // "4.임금대장" 시트 찾기, 없으면 첫번째 시트
            let sheetName=workbook.SheetNames.find(n=>n.includes('임금대장'))||workbook.SheetNames[0];
            const sheet=workbook.Sheets[sheetName];
            const json=XLSX.utils.sheet_to_json(sheet,{header:1});
            
            if(json.length<10){alert('데이터가 부족합니다.');return;}
            
            // 연월 추출 (행1에서 "2025 년    12 월" 형식)
            let yearMonth=getYM();
            const row1=json[1];
            if(row1&&row1[0]){
                const ymMatch=String(row1[0]).match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
                if(ymMatch)yearMonth=ymMatch[1]+'-'+ymMatch[2].padStart(2,'0');
            }
            // 파일명에서도 시도
            const fileMatch=file.name.match(/(\d{4})[\-_]?(\d{2})/);
            if(fileMatch&&!row1)yearMonth=fileMatch[1]+'-'+fileMatch[2];
            
            // 기존 해당월 데이터 삭제
            const existing=await db.collection('payroll').where('yearMonth','==',yearMonth).get();
            const batch=db.batch();
            existing.docs.forEach(doc=>batch.delete(doc.ref));
            
            let totalNet=0;
            let count=0;
            
            // 루미의원 급여대장 형식 (노무사 작성)
            // 컬럼 인덱스: 0:번호, 1:성명, 11:기본급, 14:추가연장수당(=실제OT), 19:인센티브, 33:지급합계, 46:공제합계, 47:차인지급액
            // 추가연장수당 = 실제 OT 금액 (중요!)
            for(let i=8;i<json.length;i++){
                const row=json[i];
                if(!row||!row[1])continue;
                
                const name=String(row[1]||'').trim();
                if(!name||name.includes('합계')||name.includes('총')||name==='NaN')continue;
                
                const basePay=parseInt(row[11])||0;
                // 추가연장수당 = 실제 OT 수당 (컬럼14)
                const extraOT=parseInt(row[14])||0;
                // 인센티브 (컬럼19)
                const incentive=parseInt(row[19])||0;
                const grossPay=parseInt(row[33])||0;
                const deduction=parseInt(row[46])||0;
                const netPay=parseInt(row[47])||0;
                
                if(netPay===0&&grossPay===0)continue;
                
                const payrollDoc={
                    yearMonth,
                    name,
                    basePay,
                    extraOT,      // 추가연장수당 = 실제 OT (중요!)
                    incentive,    // 인센티브
                    grossPay,
                    deduction,
                    netPay,       // 실수령액
                    uploadedAt:firebase.firestore.FieldValue.serverTimestamp()
                };
                batch.set(db.collection('payroll').doc(),payrollDoc);
                totalNet+=netPay;
                count++;
            }
            
            if(count===0){
                alert('유효한 급여 데이터를 찾을 수 없습니다.\n시트명: '+sheetName);
                return;
            }
            
            await batch.commit();
            alert(`${yearMonth} 급여대장 업로드 완료!\n직원 ${count}명\n차인지급액 합계: ${formatCurrency(totalNet)}`);
            input.value='';
            await loadExpenses();
            renderExpenses();
        }catch(err){
            console.error(err);
            alert('파일 처리 오류: '+err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

async function deletePayroll(id){
    if(!confirm('정말 삭제하시겠습니까?'))return;
    try{
        await db.collection('payroll').doc(id).delete();
        await loadExpenses();renderExpenses();
    }catch(e){alert('삭제 실패: '+e.message);}
}

// CRUD Operations - Tax
function openTaxModal(type,id=null){
    const titles={withholding:'원천세',vat:'부가세',income:'종소세'};
    document.getElementById('taxModalTitle').textContent=id?titles[type]+' 수정':titles[type]+' 추가';
    document.getElementById('taxEditId').value=id||'';
    document.getElementById('taxType').value=type;
    document.getElementById('withholdingFields').style.display=type==='withholding'?'block':'none';
    document.getElementById('vatFields').style.display=type==='vat'?'block':'none';
    document.getElementById('incomeFields').style.display=type==='income'?'block':'none';
    // 초기화
    document.getElementById('taxDate').value=new Date().toISOString().split('T')[0];
    document.getElementById('taxAttributeMonth').value=getYM();
    document.getElementById('taxIncomeTax').value='';
    document.getElementById('taxLocalTax').value='';
    document.getElementById('taxQuarter').value='1기';
    document.getElementById('taxYear').value=String(currentYear-1);
    document.getElementById('taxIncomeType').value='중간예납';
    document.getElementById('taxAmount').value='';
    document.getElementById('taxNote').value='';
    if(id){
        const list=type==='withholding'?withholdingTaxes:type==='vat'?vatTaxes:incomeTaxes;
        const item=list.find(t=>t.id===id);
        if(item){
            document.getElementById('taxDate').value=item.date||'';
            document.getElementById('taxAmount').value=item.amount||'';
            document.getElementById('taxNote').value=item.note||'';
            if(type==='withholding'){
                document.getElementById('taxAttributeMonth').value=item.attributeMonth||'';
                document.getElementById('taxIncomeTax').value=item.incomeTax||'';
                document.getElementById('taxLocalTax').value=item.localTax||'';
            }else if(type==='vat'){
                document.getElementById('taxQuarter').value=item.quarter||'1기';
            }else{
                document.getElementById('taxYear').value=item.taxYear||String(currentYear-1);
                document.getElementById('taxIncomeType').value=item.incomeType||'중간예납';
            }
        }
    }
    openModal('taxModal');
}
async function saveTax(){
    const editId=document.getElementById('taxEditId').value;
    const type=document.getElementById('taxType').value;
    const date=document.getElementById('taxDate').value;
    const note=document.getElementById('taxNote').value.trim();
    if(!date){alert('납부일은 필수입니다.');return;}
    const collections={withholding:'withholdingTaxes',vat:'vatTaxes',income:'incomeTaxes'};
    const collection=collections[type];
    let data={date,note,year:date.substring(0,4)};
    if(type==='withholding'){
        data.attributeMonth=document.getElementById('taxAttributeMonth').value;
        data.incomeTax=parseInt(document.getElementById('taxIncomeTax').value)||0;
        data.localTax=parseInt(document.getElementById('taxLocalTax').value)||0;
        data.amount=data.incomeTax+data.localTax;
    }else if(type==='vat'){
        data.quarter=document.getElementById('taxQuarter').value;
        data.amount=parseInt(document.getElementById('taxAmount').value)||0;
    }else{
        data.taxYear=document.getElementById('taxYear').value;
        data.incomeType=document.getElementById('taxIncomeType').value;
        data.amount=parseInt(document.getElementById('taxAmount').value)||0;
    }
    if(!data.amount){alert('납부세액은 필수입니다.');return;}
    try{
        if(editId){await db.collection(collection).doc(editId).update(data);}
        else{await db.collection(collection).add(data);}
        closeModal('taxModal');await loadExpenses();renderExpenses();
    }catch(e){alert('저장 실패: '+e.message);}
}
function editTax(type,id){openTaxModal(type,id);}
async function deleteTax(type,id){
    if(!confirm('정말 삭제하시겠습니까?'))return;
    try{
        const collections={withholding:'withholdingTaxes',vat:'vatTaxes',income:'incomeTaxes'};
        await db.collection(collections[type]).doc(id).delete();
        await loadExpenses();renderExpenses();
    }catch(e){alert('삭제 실패: '+e.message);}
}

// Tax PDF Upload
function initTaxDropZone(){
    const dropZone=document.getElementById('taxDropZone');
    if(!dropZone)return;
    dropZone.addEventListener('click',()=>document.getElementById('taxFile').click());
    dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.style.borderColor='var(--primary)';dropZone.style.background='rgba(154,139,122,0.1)';});
    dropZone.addEventListener('dragleave',e=>{e.preventDefault();dropZone.style.borderColor='#ddd';dropZone.style.background='';});
    dropZone.addEventListener('drop',e=>{
        e.preventDefault();
        dropZone.style.borderColor='#ddd';dropZone.style.background='';
        const files=e.dataTransfer.files;
        if(files.length>0)handleTaxFiles(files);
    });
}

function processTaxFile(input){
    if(input.files.length>0)handleTaxFiles(input.files);
    input.value='';
}

async function handleTaxFiles(files){
    for(const file of files){
        try{
            const fileName=file.name.toLowerCase();
            const originalFileName=file.name;
            let taxType=null;
            
            // 파일명으로 세금 종류 추정
            if(fileName.includes('부가')&&(fileName.includes('세')||fileName.includes('가치'))){
                taxType='vat';
            }else if(fileName.includes('종합소득')||fileName.includes('종소세')){
                taxType='income';
            }else if(fileName.includes('근로')||fileName.includes('원천')){
                taxType='withholding_income';
            }else if(fileName.includes('지방')){
                taxType='withholding_local';
            }else{
                alert('파일명에서 세금 종류를 인식할 수 없습니다: '+file.name+'\n\n파일명에 "부가세", "종합소득세", "근로", "지방세" 키워드를 포함해주세요.');
                continue;
            }
            
            // PDF에서 텍스트 추출
            let pdfText='';
            if(file.type==='application/pdf'||fileName.endsWith('.pdf')){
                try{
                    pdfText=await extractPdfText(file);
                    console.log('📄 PDF 텍스트 추출 완료:',pdfText.substring(0,500));
                }catch(pdfErr){
                    console.error('PDF 추출 실패:',pdfErr);
                }
            }
            
            // 파일명 + PDF 텍스트에서 정보 추출
            const taxInfo=parseTaxInfo(originalFileName,pdfText,taxType);
            console.log('📊 파싱 결과:',taxInfo);
            await saveTaxFromFile(taxInfo);
        }catch(err){
            console.error('파일 처리 오류:',err);
            alert('파일 처리 중 오류: '+err.message);
        }
    }
}

async function extractPdfText(file){
    return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=async function(e){
            try{
                if(typeof pdfjsLib==='undefined'){
                    console.error('PDF.js 라이브러리가 로드되지 않았습니다.');
                    resolve('');
                    return;
                }
                pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                const loadingTask=pdfjsLib.getDocument({data:new Uint8Array(e.target.result)});
                const pdf=await loadingTask.promise;
                let text='';
                for(let i=1;i<=pdf.numPages;i++){
                    const page=await pdf.getPage(i);
                    const content=await page.getTextContent();
                    const pageText=content.items.map(item=>item.str).join(' ');
                    text+=pageText+'\n';
                }
                console.log('📑 전체 PDF 텍스트:\n',text);
                resolve(text);
            }catch(err){
                console.error('PDF 파싱 오류:',err);
                resolve('');
            }
        };
        reader.onerror=()=>{
            console.error('파일 읽기 오류');
            resolve('');
        };
        reader.readAsArrayBuffer(file);
    });
}

function parseTaxInfo(fileName,pdfText,taxType){
    const info={type:taxType,fileName};
    const combinedText=fileName+' '+pdfText;
    const allText=combinedText.replace(/\s+/g,' ');
    
    console.log('🔍 파싱 시작 - 세금종류:',taxType);
    
    // 금액 패턴들 (다양한 형식 지원)
    const amountPatterns=[
        // "계" 다음 금액 (국세 납부서)
        /계\s*([0-9,]+)/g,
        // "합 계" 또는 "합계" 금액
        /합\s*계\s*([0-9,]+)/g,
        // 납부금액
        /납부금액\s*([0-9,]+)/g,
        /납부세액\s*([0-9,]+)/g,
        // 세목별 금액
        /부가가치세\s*([0-9,]+)/g,
        /종합소득세\s*([0-9,]+)/g,
        /근로소득세[^\d]*([0-9,]+)/g,
        /지방소득세[^\d]*([0-9,]+)/g,
        // 일반 큰 금액 패턴 (1백만원 이상)
        /([1-9][0-9]{0,2},[0-9]{3},[0-9]{3})/g,
        /([1-9][0-9]{6,})/g
    ];
    
    // 가장 큰 금액 찾기 (세금은 보통 가장 큰 금액)
    let maxAmount=0;
    let foundAmounts=[];
    
    for(const pattern of amountPatterns){
        const matches=[...allText.matchAll(pattern)];
        for(const match of matches){
            const amountStr=match[1]||match[0];
            const amount=parseInt(amountStr.replace(/,/g,''));
            if(amount>10000){// 1만원 이상만
                foundAmounts.push(amount);
                if(amount>maxAmount)maxAmount=amount;
            }
        }
    }
    
    console.log('💰 발견된 금액들:',foundAmounts);
    
    if(maxAmount>0){
        info.amount=maxAmount;
    }
    
    // 납부기한 추출 (다양한 형식)
    const datePatterns=[
        /납부기한[일]?\s*[:\s]*(\d{4})[\-년\.]?\s*(\d{1,2})[\-월\.]?\s*(\d{1,2})/,
        /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*까지/,
        /(\d{4})-(\d{2})-(\d{2})/
    ];
    
    for(const pattern of datePatterns){
        const match=allText.match(pattern);
        if(match){
            info.dueDate=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
            console.log('📅 납부기한:',info.dueDate);
            break;
        }
    }
    
    // 귀속월 추출
    const attrMatch=allText.match(/(\d{1,2})월\s*귀속/);
    if(attrMatch){
        const yearMatch=allText.match(/(\d{4})/);
        const year=yearMatch?yearMatch[1]:String(currentYear);
        info.attributeMonth=year+'-'+attrMatch[1].padStart(2,'0');
        console.log('📆 귀속월:',info.attributeMonth);
    }
    
    // 분기 추출 (부가세)
    const quarterMatch=allText.match(/(\d{4})\s*년?\s*(\d)\s*기/);
    if(quarterMatch){
        info.year=quarterMatch[1];
        info.quarter=quarterMatch[2]+'기';
        console.log('📊 분기:',info.quarter);
    }
    
    // 귀속연도 (종소세)
    if(taxType==='income'){
        const yearPatterns=[
            /_(\d{4})_/,
            /(\d{4})년?\s*귀속/,
            /귀속[^\d]*(\d{4})/
        ];
        for(const p of yearPatterns){
            const m=allText.match(p);
            if(m){info.taxYear=m[1];break;}
        }
        if(!info.taxYear){
            const y=allText.match(/(\d{4})/);
            if(y)info.taxYear=y[1];
        }
        
        // 구분
        if(allText.includes('중간예납'))info.incomeType='중간예납';
        else if(allText.includes('확정'))info.incomeType='확정신고';
        else if(allText.includes('분납'))info.incomeType='분납';
    }
    
    return info;
}

async function saveTaxFromFile(info){
    // 파일에서 추출한 정보로 모달 열기
    if(info.type==='vat'){
        openTaxModal('vat');
        if(info.quarter)document.getElementById('taxQuarter').value=info.quarter;
        if(info.amount)document.getElementById('taxAmount').value=info.amount;
        if(info.dueDate)document.getElementById('taxDate').value=info.dueDate;
        document.getElementById('taxNote').value='파일: '+info.fileName;
    }else if(info.type==='income'){
        openTaxModal('income');
        if(info.taxYear)document.getElementById('taxYear').value=info.taxYear;
        if(info.incomeType)document.getElementById('taxIncomeType').value=info.incomeType;
        if(info.amount)document.getElementById('taxAmount').value=info.amount;
        if(info.dueDate)document.getElementById('taxDate').value=info.dueDate;
        document.getElementById('taxNote').value='파일: '+info.fileName;
    }else if(info.type==='withholding_income'){
        openTaxModal('withholding');
        if(info.attributeMonth)document.getElementById('taxAttributeMonth').value=info.attributeMonth;
        if(info.amount)document.getElementById('taxIncomeTax').value=info.amount;
        if(info.dueDate)document.getElementById('taxDate').value=info.dueDate;
        document.getElementById('taxNote').value='파일: '+info.fileName;
    }else if(info.type==='withholding_local'){
        openTaxModal('withholding');
        if(info.attributeMonth)document.getElementById('taxAttributeMonth').value=info.attributeMonth;
        if(info.amount)document.getElementById('taxLocalTax').value=info.amount;
        if(info.dueDate)document.getElementById('taxDate').value=info.dueDate;
        document.getElementById('taxNote').value='파일: '+info.fileName;
    }
    
    const amountStr=info.amount?formatCurrency(info.amount):'인식 실패';
    alert(`📄 세금 고지서 인식 완료!\n\n세금 종류: ${info.type==='vat'?'부가세':info.type==='income'?'종소세':'원천세'}\n금액: ${amountStr}\n\n내용을 확인하고 저장해주세요.`);
}

// CRUD Operations - Employee

/* ===== 멀티 지출 데이터 통합 업로더 ===== */
let expUploadParsed=[];

// 카테고리별 배지 색상
function getCategoryBadge(cat){
    // expenseCategories가 로드된 경우 group 기반 색상 사용
    if(typeof expenseCategories!=='undefined'&&expenseCategories.length){
        const found=expenseCategories.find(c=>c.id===cat);
        if(found){
            const groupColors={
                fixed:   ['#1e3a5f','#dbeafe'],
                variable:['#7c3d0f','#fef3c7'],
                payroll: ['#14532d','#dcfce7'],
                tax:     ['#713f12','#fef9c3'],
            };
            const [fg,bg]=groupColors[found.group]||['#555','#f0f0f0'];
            return `<span style="display:inline-block;font-size:.75rem;font-weight:600;padding:2px 8px;border-radius:10px;color:${fg};background:${bg};white-space:nowrap">${found.name||cat}</span>`;
        }
    }
    // fallback: 기존 하드코딩 색상
    const colors={
        '의료소모품':['#0277bd','#e1f5fe'],'미용소모품':['#c2185b','#fce4ec'],
        '소모품비':['#1565c0','#e3f2fd'],'사무용품':['#37474f','#eceff1'],
        '복리후생비':['#2e7d32','#e8f5e9'],'접대비':['#ad1457','#fce4ec'],
        '차량유지비':['#00838f','#e0f7fa'],'교통비':['#1a237e','#e8eaf6'],
        '시설보수':['#4e342e','#efebe9'],'장비수리':['#455a64','#eceff1'],
        '인테리어':['#00695c','#e0f2f1'],'교육비':['#004d40','#e0f2f1'],
        '공과금':['#e65100','#fff3e0'],'세금':['#b71c1c','#ffebee'],
        '리스료':['#6a1b9a','#f3e5f5'],'금융/이체':['#757575','#f5f5f5'],
        '임대료':['#bf360c','#fbe9e7'],'장비리스':['#6a1b9a','#f3e5f5'],
        '대출이자':['#880e4f','#fce4ec'],'통신_인터넷':['#0d47a1','#e3f2fd'],
        '통신_전화':['#0d47a1','#e3f2fd'],'세무노무':['#4a148c','#f3e5f5'],
        '보험료':['#1b5e20','#e8f5e9'],'청소비':['#33691e','#f1f8e9'],
        '수탁_폐기물':['#827717','#f9fbe7'],'수탁_검사':['#827717','#f9fbe7'],
        '정수기':['#006064','#e0f7fa'],'보안_캡스':['#263238','#eceff1'],
        '복리후생':['#2e7d32','#e8f5e9'],'마케팅':['#e65100','#fff3e0'],
        '광고비':['#c2410c','#fff7ed'],'루미컨설팅비':['#6d28d9','#ede9fe'],
        '인건비':['#d32f2f','#ffebee'],'환불':['#0f766e','#ccfbf1'],
        '기타':['#555','#f0f0f0'],'기타고정':['#555','#eff6ff'],
    };
    const [fg,bg]=colors[cat]||colors['기타'];
    return `<span style="display:inline-block;font-size:.75rem;font-weight:600;padding:2px 8px;border-radius:10px;color:${fg};background:${bg};white-space:nowrap">${cat}</span>`;
}

// 자동 분류 키워드 매핑
const EXP_CATEGORY_RULES=[
    // 카드사 결제 / 자기 계좌 이체 / 대출 원리금 → 실제 지출 아님 → 자동 제외
    {category:'금융/이체',keywords:['카드대금','현대카드','삼성카드','신한카드','KB카드','롯데카드','우리카드','비씨카드','하나카드','체크카드','자동이체','대출이자','원리금','적금','예금'],exclude:true},
    // 4대보험 (국민연금/건강/고용/산재) — 실제 지출 → 고정비로 분류
    {category:'4대보험',keywords:['국민연금','건강보험','고용보험','산재보험','근로복지공단','보건복지부']},
    // 일반 보험료 (자동차/사업자배상/화재 등) → 고정비
    {category:'보험료',keywords:['보험료','메리츠화재','삼성화재','현대해상','DB손해','KB손해','롯데손해','한화손해','흥국화재','MG손해','MG손보','롯손']},
    {category:'리스료',keywords:['캐피탈','리스','렌탈','오릭스','메리츠캐피탈','JB우리','한국캐피탈','아주캐피탈']},
    {category:'공과금',keywords:['에너지','전력','한전','수도','도시가스','쉴더스','관리비','통신비','KT','SKT','LG유플','인터넷']},
    {category:'세금',keywords:['세금','국세','지방세','원천세','부가세','종합소득세','종소세','주민세','재산세','자동차세','취득세','등록세','면허세','환경개선부담금']},
    {category:'복리후생비',keywords:['배달의민족','우아한형제들','요기요','쿠팡이츠','식당','컬리','편의점','CU','씨유','GS25','지에스','세븐일레','이마트24','카페','커피','스타벅스','투썸','이디야','빽다방','메가커피','컴포즈','더벤티','할리스','엔제리너스','아웃백','빕스','피자','치킨','맥도날드','버거킹','서브웨이','김밥','분식','한솥','본죽','죽','베이커리','빵','떡','족발','보쌈','삼겹','고기','갈비','냉면','국밥','설렁탕','찌개','백반','도시락','밥','반찬','다래연','식자재','마라','양꼬치','초밥','회','돈까스','우동','라멘','파스타','샐러드','샌드위치','토스트']},
    {category:'의료소모품',keywords:['메디','주사','거즈','밴드','소독','글러브','수액','약품','주사기','의료','진료','시술','필러','보톡스','레이저','피부과','약국','드럭']},
    {category:'미용소모품',keywords:['올리브영','화장','뷰티','스킨','마스크팩','미용']},
    {category:'소모품비',keywords:['네이버','쿠팡','지마켓','옥션','11번가','위메프','티몬','다이소','오피스','문구','마트','홈플러스','롯데마트','코스트코','트레이더스']},
    {category:'차량유지비',keywords:['주유','SK에너지','GS칼텍스','현대오일','S-OIL','주차','하이패스','톨게이트','세차','타이어']},
    {category:'접대비',keywords:['골프','라운지','호텔','리조트']},
    {category:'교통비',keywords:['택시','버스','지하철','KTX','SRT','항공','티머니']},
    {category:'교육비',keywords:['학회','세미나','컨퍼런스','교육','수강','연수']},
];

function classifyExpense(name, date, amount){
    // 유경훈 본인 이체 → 집계 제외
    if((name||'').includes('유경훈')) return {category:'금융/이체',exclude:true};

    // 롯데카드 출금: 날짜·금액 기준으로 키워드 규칙보다 먼저 처리
    if((name||'').includes('롯데카드')){
        const day=parseInt((date||'').split('-')[2])||0;
        if(day===19) return {category:'세금',exclude:false};
        if(day===25&&(amount===3612100||amount===2661300)) return {category:'리스료',exclude:false};
    }

    // 등록된 카드 별칭/카드사 키워드와 매칭되는 행은 카드대금 결제로 간주 → 제외
    // (은행 명세서에서 카드사 결제 합계가 카드 명세서 개별 거래와 중복되지 않도록)
    if(typeof cards !== 'undefined' && Array.isArray(cards) && cards.length){
        const lowerName=(name||'').toLowerCase().replace(/\s/g,'');
        const issuerKeywords={
            hyundai:['현대카드','hyundaicard'], lotte:['롯데카드','lottecard'],
            samsung:['삼성카드','samsungcard'], shinhan:['신한카드','shinhancard'],
            kb:['kb카드','국민카드','kbcard'], bc:['bc카드','bccard'],
            woori:['우리카드','wooricard'], hana:['하나카드','hanacard']
        };
        for(const c of cards){
            const issuerKws=issuerKeywords[c.issuer]||[];
            for(const kw of issuerKws){
                if(lowerName.includes(kw.replace(/\s/g,''))) return {category:'금융/이체',exclude:true};
            }
        }
    }

    // 기존 키워드 규칙 (변경 없음)
    const n=(name||'').toLowerCase().replace(/\s/g,'');
    for(const rule of EXP_CATEGORY_RULES){
        for(const kw of rule.keywords){
            if(n.includes(kw.toLowerCase().replace(/\s/g,''))) return {category:rule.category,exclude:!!rule.exclude};
        }
    }
    return {category:'기타',exclude:false};
}

// CSV 파싱 유틸 (쉼표 내 따옴표 처리)
function parseCSVLine(line){
    const result=[];let cur='';let inQ=false;
    for(let i=0;i<line.length;i++){
        const c=line[i];
        if(c==='"'){inQ=!inQ;}
        else if(c===','&&!inQ){result.push(cur.trim().replace(/^"|"$/g,''));cur='';}
        else{cur+=c;}
    }
    result.push(cur.trim().replace(/^"|"$/g,''));
    return result;
}

function parseCSVRows(text){
    return text.split(/\r?\n/).filter(l=>l.trim()).map(l=>parseCSVLine(l));
}

// 날짜 정규화 (여러 형식 지원)
function normalizeDate(raw){
    if(!raw)return '';
    let s=raw.replace(/['"]/g,'').trim();
    // 공백·특수문자 앞뒤 정리
    s=s.replace(/^\s+|\s+$/g,'');
    
    // 1) 20260115 (8자리 숫자)
    if(/^\d{8}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
    
    // 2) 2026-01-15, 2026/01/15, 2026.01.15, 2026.1.5 (4자리 연도 + 구분자)
    let m=s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if(m) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    
    // 3) 01/15/2026, 01-15-2026 (MM/DD/YYYY - 4자리 연도가 뒤에 오는 경우)
    m=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if(m){
        const a=parseInt(m[1]),b=parseInt(m[2]);
        if(a<=12) return m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
        return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
    }
    
    // 4) 26-01-15, 26/01/15, 26.01.15 (2자리 연도 + 구분자)
    m=s.match(/^(\d{2})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if(m) return '20'+m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    
    // 5) 2026년 01월 15일 / 2026년1월5일 (한글 형식)
    m=s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
    if(m) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    
    // 6) 260115 (6자리 - YYMMDD)
    if(/^\d{6}$/.test(s)) return '20'+s.slice(0,2)+'-'+s.slice(2,4)+'-'+s.slice(4,6);
    
    // 7) ISO datetime (2026-01-15T09:30:00)
    m=s.match(/^(\d{4}-\d{2}-\d{2})/);
    if(m) return m[1];
    
    return s;
}

// 금액 정규화
function normalizeAmount(raw){
    if(!raw)return 0;
    const s=String(raw).replace(/[",\s원₩]/g,'');
    return Math.abs(parseInt(s))||0;
}

// ===== 파일별 파싱 로직 =====

function detectAndParse(rows,fileName){
    const fn=(fileName||'').toLowerCase();
    const headerText=rows.slice(0,30).map(r=>r.join(',')).join('\n').toLowerCase();

    // 1) card-statements.js의 4사 파서 (현대/롯데/삼성/신한) 우선 시도
    if(typeof parseCardStatement==='function'){
        const parsed=parseCardStatement(rows,fileName);
        if(parsed && parsed.length) return parsed;
    }

    // 2) 기존 파서 fallback
    if(headerText.includes('승인일자')&&(headerText.includes('승인금액')||fn.includes('삼성'))){
        return parseSamsungCard(rows,fileName);
    }
    if((headerText.includes('이용금액')||fn.includes('신한카드'))&&headerText.includes('거래일')){
        return parseShinhanCard(rows,fileName);
    }
    if(headerText.includes('출금')&&(headerText.includes('거래일자')||fn.includes('신한은행')||fn.includes('은행'))){
        return parseShinhanBank(rows,fileName);
    }
    // 3) 미인식 — 디버그 정보 콘솔에 출력
    console.warn('[Upload] 파서 미인식:', fileName, '→ 첫 5행:');
    rows.slice(0,5).forEach((r,i)=>console.warn(`  [${i}]`, r));
    return parseGenericCSV(rows,fileName);
}

function parseSamsungCard(rows,fileName){
    // 헤더행 찾기
    let headerIdx=rows.findIndex(r=>r.some(c=>(c||'').includes('승인일자')));
    if(headerIdx<0)return [];
    const header=rows[headerIdx].map(h=>(h||'').replace(/\s/g,''));
    const iDate=header.findIndex(h=>h.includes('승인일자'));
    const iName=header.findIndex(h=>h.includes('가맹점명')||h.includes('이용가맹점'));
    const iAmt=header.findIndex(h=>h.includes('승인금액')||h.includes('이용금액'));
    if(iDate<0||iAmt<0)return [];
    
    const results=[];
    for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];
        if(!r||r.length<3)continue;
        const date=normalizeDate(r[iDate]);
        const name=(r[iName]||'').trim();
        const amount=normalizeAmount(r[iAmt]);
        if(!date||!amount)continue;
        const cls=classifyExpense(name);
        results.push({source:'삼성카드',date,name,amount,category:cls.category,exclude:cls.exclude,fileName,note:'[삼성카드] '+name});
    }
    return results;
}

function parseShinhanCard(rows,fileName){
    // 상단 4행 제외 후 헤더 찾기
    let headerIdx=-1;
    for(let i=0;i<Math.min(rows.length,10);i++){
        if(rows[i].some(c=>(c||'').includes('거래일'))){headerIdx=i;break;}
    }
    if(headerIdx<0)headerIdx=4;
    const header=rows[headerIdx].map(h=>(h||'').replace(/\s/g,''));
    const iDate=header.findIndex(h=>h.includes('거래일')||h.includes('이용일'));
    const iName=header.findIndex(h=>h.includes('가맹점명')||h.includes('이용가맹점')||h.includes('내용'));
    const iAmt=header.findIndex(h=>h.includes('이용금액')||h.includes('금액'));
    if(iDate<0||iAmt<0)return [];
    
    const results=[];
    for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];
        if(!r||r.length<3)continue;
        const date=normalizeDate(r[iDate]);
        const name=(r[iName]||'').trim();
        const amount=normalizeAmount(r[iAmt]);
        if(!date||!amount)continue;
        const cls=classifyExpense(name);
        results.push({source:'신한카드',date,name,amount,category:cls.category,exclude:cls.exclude,fileName,note:'[신한카드] '+name});
    }
    return results;
}

function parseShinhanBank(rows,fileName){
    // 상단 6행 제외 후 헤더 찾기
    let headerIdx=-1;
    for(let i=0;i<Math.min(rows.length,12);i++){
        if(rows[i].some(c=>(c||'').replace(/\s/g,'').includes('거래일자'))){headerIdx=i;break;}
    }
    if(headerIdx<0)headerIdx=6;
    const header=rows[headerIdx].map(h=>(h||'').replace(/\s/g,''));
    const iDate=header.findIndex(h=>h.includes('거래일자')||h.includes('거래일'));
    const iName=header.findIndex(h=>h.includes('내용')||h.includes('거래내용'));
    const iMemo=header.findIndex(h=>h.includes('적요'));
    const iOut=header.findIndex(h=>h.includes('출금'));
    if(iDate<0||iOut<0)return [];
    
    const results=[];
    for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];
        if(!r||r.length<3)continue;
        const date=normalizeDate(r[iDate]);
        // 내용 → 적요 fallback
        let name=(iName>=0?(r[iName]||'').trim():'');
        const memo=(iMemo>=0?(r[iMemo]||'').trim():'');
        if(!name&&memo) name=memo;
        const displayName=name||(memo||'(내용없음)');
        const amount=normalizeAmount(r[iOut]);
        if(!date||!amount)continue;
        const cls=classifyExpense(displayName, date, amount);
        // note: 원본 내용+적요 모두 기록
        const noteParts=['[신한은행]'];
        if(name)noteParts.push(name);
        if(memo&&memo!==name)noteParts.push('(적요:'+memo+')');
        results.push({source:'신한은행',date,name:displayName,amount,category:cls.category,exclude:cls.exclude,fileName,note:noteParts.join(' ')});
    }
    return results;
}

function parseGenericCSV(rows,fileName){
    if(rows.length<2)return [];
    const header=rows[0].map(h=>(h||'').replace(/\s/g,''));
    const iDate=header.findIndex(h=>h.includes('일자')||h.includes('날짜')||h.includes('거래일')||h.includes('Date'));
    const iName=header.findIndex(h=>h.includes('가맹점')||h.includes('내용')||h.includes('적요')||h.includes('항목'));
    const iAmt=header.findIndex(h=>h.includes('금액')||h.includes('출금')||h.includes('Amount'));
    if(iDate<0||iAmt<0)return [];
    
    const results=[];
    for(let i=1;i<rows.length;i++){
        const r=rows[i];
        if(!r||r.length<2)continue;
        const date=normalizeDate(r[iDate]);
        const name=(r[iName]||'').trim();
        const amount=normalizeAmount(r[iAmt]);
        if(!date||!amount)continue;
        const cls=classifyExpense(name);
        results.push({source:'기타CSV',date,name,amount,category:cls.category,exclude:cls.exclude,fileName,note:'[기타] '+name});
    }
    return results;
}

// ===== 파일 핸들러 + 중복 제거 (파일 여러 번 업로드 누적) =====
async function handleExpenseFiles(files){
    if(!files||!files.length)return;
    const statusEl=document.getElementById('expUploadStatus');
    statusEl.style.display='block';
    const prevCount=expUploadParsed.length;
    if(prevCount===0){statusEl.innerHTML='⏳ 파일 분석 중...';}
    else{statusEl.innerHTML=`⏳ 추가 파일 분석 중... (기존 ${prevCount}건 유지)`;}

    let allParsed=[];
    for(const file of files){
        try{
            const rows=await readFileAsRows(file);
            const parsed=detectAndParse(rows,file.name);
            allParsed.push(...parsed);
            statusEl.innerHTML+=`<br>✅ <strong>${file.name}</strong>: ${parsed.length}건 인식 (${parsed.length>0?parsed[0].source:'?'})`;
        }catch(e){
            statusEl.innerHTML+=`<br>❌ <strong>${file.name}</strong>: 읽기 실패 - ${e.message}`;
        }
    }

    // ── 기존 누적 + 신규 합치고 중복 제거 ──
    // 키: 출처+날짜+가맹점+금액 (다른 카드의 같은 가맹점/금액은 다른 거래로 간주)
    const merged=[...expUploadParsed, ...allParsed];
    const seen=new Set();
    const deduped=[];
    for(const item of merged){
        const key=`${item.source||''}|${item.date}|${item.name}|${item.amount}|${item.cardLabel||''}`;
        if(!seen.has(key)){seen.add(key);deduped.push(item);}
    }
    const dupCount=merged.length-deduped.length;
    if(dupCount>0) statusEl.innerHTML+=`<br>🔄 중복 ${dupCount}건 자동 제거`;

    // 금융/이체 제외 건수 표시 (이번 신규분만 카운트)
    const excludeCount=allParsed.filter(d=>d.exclude).length;
    if(excludeCount>0) statusEl.innerHTML+=`<br>🏦 카드대금/이체 ${excludeCount}건 자동 제외 표시`;

    // ── DB 이력 기반 자동 재분류 ──
    // 같은 가맹점이 금액별로 다른 카테고리(예: 롯데카드(주) — 리스료 vs 카드 결제)인 경우
    //   1) (이름, 금액) 정확 일치하는 학습 항목 → 그것을 우선 적용
    //   2) 같은 이름의 카테고리가 단 하나뿐이면 이름만으로 매칭
    //   3) 같은 이름인데 카테고리가 여러 개면 이름-only fallback 금지 (자동 분류 룰 결과 유지)
    const exactMap={};         // 'name|amount' → category
    const nameCatMap={};       // name → Set(category)
    variableExpenses.forEach(e=>{
        const n=e.merchant||e.name;
        if(!n||!e.category) return;
        exactMap[`${n}|${e.amount}`]=e.category;
        if(!nameCatMap[n]) nameCatMap[n]=new Set();
        nameCatMap[n].add(e.category);
    });
    // 세션 내 수동 오버라이드 (같은 세션에서 일괄 적용)
    Object.assign(exactMap, expMerchantOverrides);

    let reClassified=0;
    allParsed.forEach(d=>{
        const key=`${d.name}|${d.amount}`;
        if(exactMap[key] && exactMap[key]!==d.category){
            // 정확 일치 학습 항목
            d.category=exactMap[key];
            d.exclude=d.category==='금융/이체';
            reClassified++;
            return;
        }
        const cats=nameCatMap[d.name];
        if(cats && cats.size===1){
            // 같은 이름이 단일 카테고리 이력 → 적용
            const only=[...cats][0];
            if(only!==d.category){
                d.category=only;
                d.exclude=d.category==='금융/이체';
                reClassified++;
            }
        }
        // 같은 이름인데 카테고리가 여러 개면 자동 분류 결과 유지 (사용자 수동 분류 필요)
    });
    if(reClassified>0) statusEl.innerHTML+=`<br>📚 이전 분류 이력으로 ${reClassified}건 자동 재분류 (금액별 정밀)`;
    if(prevCount>0) statusEl.innerHTML+=`<br>📦 누적: 총 ${deduped.length}건 (이전 ${prevCount} + 신규 ${deduped.length-prevCount})`;

    expUploadParsed=deduped;
    renderExpUploadPreview();
}

// CSV/XLS/XLSX → 2차원 배열로 통합 변환
// 카드사가 .xls 확장자로 HTML/XHTML 표를 내려주는 경우가 많아 별도 분기 처리.
function readFileAsRows(file){
    return new Promise((resolve,reject)=>{
        const ext=(file.name||'').split('.').pop().toLowerCase();

        if(ext==='xls'||ext==='xlsx'){
            const reader=new FileReader();
            reader.onload=function(e){
                try{
                    const buffer=e.target.result;
                    const data=new Uint8Array(buffer);
                    // HTML/XHTML 감지: 앞부분에 <html, <!doctype, <table 이 있는지
                    const headLen=Math.min(data.length,1000);
                    let head='';
                    for(let i=0;i<headLen;i++) head+=String.fromCharCode(data[i]);
                    const isHtml=/<\!doctype|<html|<table/i.test(head);
                    if(isHtml){
                        // DOMParser로 직접 테이블 추출 (SheetJS의 HTML 파싱보다 안정적, XHTML 호환)
                        const text=new TextDecoder('utf-8').decode(data);
                        const rows=htmlToRows(text);
                        if(rows.length>0){console.log('[Upload] HTML 테이블 파싱:', rows.length, '행 (DOMParser)'); resolve(rows); return;}
                        console.warn('[Upload] DOMParser로 0행 → SheetJS HTML 모드 시도');
                        try{
                            const wb=XLSX.read(text,{type:'string',cellDates:false,raw:false});
                            const ws=wb.Sheets[wb.SheetNames[0]];
                            const r=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
                            resolve((r||[]).map(row=>row.map(c=>String(c||''))));
                            return;
                        }catch(_){
                            reject(new Error('HTML 파일이지만 테이블을 추출하지 못했습니다.'));
                            return;
                        }
                    }
                    // 정상 binary xlsx/xls
                    const wb=XLSX.read(data,{type:'array',cellDates:false,raw:false});
                    let bestRows=[];
                    for(const name of wb.SheetNames){
                        const ws=wb.Sheets[name];
                        const r=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
                        const nonEmptyCount=(r||[]).filter(row=>row && row.some(c=>String(c||'').trim()!=='')).length;
                        if(nonEmptyCount>bestRows.length) bestRows=r;
                    }
                    if(!bestRows.length){
                        const ws=wb.Sheets[wb.SheetNames[0]];
                        bestRows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
                    }
                    resolve(bestRows.map(r=>r.map(c=>String(c||''))));
                }catch(err){reject(new Error('엑셀 파싱 실패: '+err.message));}
            };
            reader.onerror=()=>reject(new Error('파일 읽기 실패'));
            reader.readAsArrayBuffer(file);
        }else{
            // CSV: EUC-KR 우선 시도 → 깨지면 UTF-8
            const reader=new FileReader();
            reader.onload=function(){
                let text=reader.result;
                if(text.includes('�')){
                    const reader2=new FileReader();
                    reader2.onload=()=>resolve(parseCSVRows(reader2.result));
                    reader2.onerror=()=>reject(new Error('파일 읽기 실패'));
                    reader2.readAsText(file,'UTF-8');
                    return;
                }
                resolve(parseCSVRows(text));
            };
            reader.onerror=()=>reject(new Error('파일 읽기 실패'));
            reader.readAsText(file,'EUC-KR');
        }
    });
}

// HTML/XHTML 문서에서 <table> 추출 → 2차원 배열 (DOMParser 사용)
// 여러 테이블이 있으면 행 수가 가장 많은 것 선택
function htmlToRows(htmlString){
    try{
        const doc=new DOMParser().parseFromString(htmlString,'text/html');
        const tables=doc.querySelectorAll('table');
        if(!tables.length) return [];
        let bestRows=[];
        for(const table of tables){
            const rows=[];
            const trs=table.querySelectorAll('tr');
            for(const tr of trs){
                const row=[];
                const cells=tr.querySelectorAll('th,td');
                for(const cell of cells){
                    row.push((cell.textContent||'').trim().replace(/\s+/g,' '));
                }
                if(row.length) rows.push(row);
            }
            if(rows.length>bestRows.length) bestRows=rows;
        }
        return bestRows;
    }catch(e){
        console.warn('htmlToRows 실패:', e);
        return [];
    }
}

// 모든 카테고리(고정/유동/인건/세금)를 그룹별 optgroup으로 묶은 <option>들 반환
function buildAllCategoryOptions(selectedValue){
    const groupLabels={fixed:'🔵 고정비', variable:'🟠 유동비', payroll:'🟢 인건비', tax:'🟡 세금'};
    const groups=['fixed','variable','payroll','tax'];
    if(typeof expenseCategories==='undefined' || !expenseCategories.length){
        const fb=['소모품비','복리후생비','공과금','세금','리스료','차량유지비','접대비','금융/이체','기타'];
        return fb.map(v=>`<option value="${v}"${selectedValue===v?' selected':''}>${v}</option>`).join('');
    }
    return groups.map(g=>{
        const items=expenseCategories.filter(c=>c.group===g);
        if(!items.length) return '';
        return `<optgroup label="${groupLabels[g]||g}">${items.map(c=>`<option value="${c.id}"${selectedValue===c.id?' selected':''}>${c.name}</option>`).join('')}</optgroup>`;
    }).join('');
}

// ===== 미리보기 렌더링 =====
function renderExpUploadPreview(){
    const container=document.getElementById('expUploadPreview');
    const tbody=document.getElementById('expPreviewTable');
    const filterEl=document.getElementById('expPreviewFilter');
    if(!expUploadParsed.length){container.style.display='none';return;}
    container.style.display='block';
    
    // 카테고리 필터 업데이트
    const cats=[...new Set(expUploadParsed.map(d=>d.category))].sort();
    const curFilter=filterEl.value;
    filterEl.innerHTML='<option value="">전체 카테고리</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
    filterEl.value=curFilter;
    
    let items=expUploadParsed;
    if(curFilter) items=items.filter(d=>d.category===curFilter);
    
    document.getElementById('expPreviewCount').textContent=`총 ${expUploadParsed.length}건 / 표시 ${items.length}건`;
    
    // ── 가맹점별 그룹 분류 패널 ──
    renderMerchantGroupPanel();
    
    tbody.innerHTML=items.map((d,i)=>{
        const realIdx=expUploadParsed.indexOf(d);
        const rowStyle=d.exclude?'opacity:.5;text-decoration:line-through;':(d.isPersonal?'background:#fff8e1':'');
        const catBadge=d.exclude?'<span style="font-size:.75rem;color:#999">금융/이체</span>':getCategoryBadge(d.category);
        const noteText=(d.note||'').replace(/"/g,'&quot;');
        const cardLabel=d.cardLabel?`<div style="font-size:.65rem;color:#888">💳 ${d.cardLabel}</div>`:'';
        return `<tr style="${rowStyle}">
            <td><span style="font-size:.75rem;background:#f5f5f5;padding:2px 6px;border-radius:3px">${d.source}</span>${cardLabel}</td>
            <td>${d.date}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.merchantRaw||d.name}">${d.name}${d.isCancel?' <span style="color:#dc2626;font-size:.7rem">[취소]</span>':''}</td>
            <td><select onchange="applyMerchantCategory('${d.name.replace(/'/g,"\\'")}',this.value)" style="font-size:.8rem;padding:2px 4px;border:1px solid #ddd;border-radius:4px">
                ${buildAllCategoryOptions(d.category)}
            </select> ${catBadge}</td>
            <td class="text-right" style="font-weight:600">${formatCurrency(d.amount)}</td>
            <td style="font-size:.8rem;color:#777;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${noteText}">${d.note||'-'}</td>
            <td style="text-align:center" title="개인사용 (사업비 합산에서 제외)"><input type="checkbox" ${d.isPersonal?'checked':''} onchange="expUploadParsed[${realIdx}].isPersonal=this.checked;renderExpUploadPreview()"></td>
            <td style="text-align:center" title="제외 (저장 안 함)"><input type="checkbox" ${d.exclude?'checked':''} onchange="expUploadParsed[${realIdx}].exclude=this.checked;renderExpUploadPreview()"></td>
            <td style="text-align:center"><button onclick="expUploadParsed.splice(${realIdx},1);renderExpUploadPreview()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem">✕</button></td>
        </tr>`;
    }).join('');
    
    renderExpUploadSummary();
}

// 같은 가맹점명 전체를 한번에 카테고리 변경
function applyMerchantCategory(merchantName,newCategory){
    const isExclude=newCategory==='금융/이체';
    expUploadParsed.forEach(d=>{
        if(d.name===merchantName){
            d.category=newCategory;
            d.exclude=isExclude;
        }
    });
    // 학습 기억에 저장
    expMerchantOverrides[merchantName]=newCategory;
    renderExpUploadPreview();
}

// 가맹점별 그룹 분류 패널
let expMerchantOverrides={}; // {가맹점명: 카테고리} 세션 내 기억

function renderMerchantGroupPanel(){
    let panel=document.getElementById('expMerchantPanel');
    if(!panel){
        panel=document.createElement('div');
        panel.id='expMerchantPanel';
        const previewEl=document.getElementById('expUploadPreview');
        const tableEl=previewEl.querySelector('.table-container');
        previewEl.insertBefore(panel,tableEl);
    }
    
    // 가맹점별 그룹 집계 (제외 건 포함)
    const groups={};
    expUploadParsed.forEach(d=>{
        if(!groups[d.name]) groups[d.name]={count:0,total:0,category:d.category,exclude:d.exclude};
        groups[d.name].count++;
        groups[d.name].total+=d.amount;
    });
    
    const entries=Object.entries(groups).sort((a,b)=>b[1].count-a[1].count);
    // 2건 이상 or 기타인 가맹점만 표시
    const showEntries=entries.filter(([name,g])=>g.count>=2||g.category==='기타');
    
    if(!showEntries.length){panel.innerHTML='';return;}
    
    panel.innerHTML=`
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:1rem;margin-bottom:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
                <strong style="font-size:.9rem">🏷 가맹점별 일괄 분류</strong>
                <span style="font-size:.75rem;color:var(--text-secondary)">하나를 바꾸면 같은 가맹점 전체가 변경됩니다</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.5rem">
                ${showEntries.map(([name,g])=>{
                    const badge=g.exclude?'':getCategoryBadge(g.category);
                    const escapedName=name.replace(/'/g,"\\'");
                    return `<div style="display:flex;align-items:center;gap:4px;background:#fafafa;padding:4px 8px;border-radius:6px;border:1px solid #eee;font-size:.82rem">
                        <span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${name}">${name}</span>
                        <span style="color:#999;font-size:.7rem">${g.count}건</span>
                        <select onchange="applyMerchantCategory('${escapedName}',this.value)" style="font-size:.78rem;padding:1px 3px;border:1px solid #ddd;border-radius:3px">
                            ${buildAllCategoryOptions(g.category)}
                        </select>
                        ${badge}
                    </div>`;
                }).join('')}
            </div>
        </div>
    `;
}

function renderExpUploadSummary(){
    const el=document.getElementById('expPreviewSummary');
    const active=expUploadParsed.filter(d=>!d.exclude);
    const excluded=expUploadParsed.filter(d=>d.exclude);
    const totalActive=active.reduce((s,d)=>s+d.amount,0);
    const totalExcluded=excluded.reduce((s,d)=>s+d.amount,0);
    
    // 카테고리별 합계
    const byCat={};
    active.forEach(d=>{byCat[d.category]=(byCat[d.category]||0)+d.amount;});
    
    el.innerHTML=`
        <div style="background:var(--bg-card);padding:1rem;border-radius:8px;border:1px solid var(--border);min-width:200px">
            <div style="font-size:.8rem;color:var(--text-secondary)">지출 합계 (제외 제외)</div>
            <div style="font-size:1.3rem;font-weight:700;color:#2e7d32">${formatCurrency(totalActive)}</div>
            <div style="font-size:.75rem;color:#999;margin-top:.25rem">${active.length}건</div>
        </div>
        <div style="background:var(--bg-card);padding:1rem;border-radius:8px;border:1px solid var(--border);min-width:200px">
            <div style="font-size:.8rem;color:var(--text-secondary)">제외 (카드대금/이체)</div>
            <div style="font-size:1.3rem;font-weight:700;color:#999">${formatCurrency(totalExcluded)}</div>
            <div style="font-size:.75rem;color:#999;margin-top:.25rem">${excluded.length}건</div>
        </div>
        <div style="background:var(--bg-card);padding:1rem;border-radius:8px;border:1px solid var(--border);flex:1;min-width:200px">
            <div style="font-size:.8rem;color:var(--text-secondary);margin-bottom:.5rem">카테고리별</div>
            ${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;font-size:.8rem;padding:2px 0"><span>${cat}</span><strong>${formatCurrency(amt)}</strong></div>`).join('')}
        </div>
    `;
}

// ===== 일괄 저장 =====
// 카테고리 그룹(고정/유동/인건/세금)에 따라 자동 분기 저장
function getCategoryGroupSafe(catId){
    if(typeof getCategoryGroup === 'function'){ return getCategoryGroup(catId); }
    if(typeof expenseCategories !== 'undefined'){
        const c = expenseCategories.find(x => x.id === catId);
        return c?.group || 'variable';
    }
    return 'variable';
}

async function saveExpensesBulk(){
    const items=expUploadParsed.filter(d=>!d.exclude);
    if(!items.length){alert('저장할 항목이 없습니다.');return;}

    // 카테고리 그룹별 분리
    // - fixed → fixedExpenses
    // - variable/payroll/tax → variableExpenses (세금은 컬렉션이 부가세/종소세/원천세로 나뉘어
    //   클라이언트에서 자동 분기하면 누락 위험 → 일단 유동비에 보관 후 사용자가 세금 탭에서 직접 입력)
    const fixedItems = items.filter(d => getCategoryGroupSafe(d.category) === 'fixed');
    const expItems   = items.filter(d => {
        const g = getCategoryGroupSafe(d.category);
        return g === 'variable' || g === 'payroll' || g === 'tax';
    });

    // ── 사전 중복 검사 (DB에 이미 존재하는 행 카운트) ──
    const existingVarKeys = new Set(variableExpenses.map(e=>`${e.date}|${e.name}|${e.amount}`));
    const existingFixKeys = new Set((typeof allFixedExpenses!=='undefined'?allFixedExpenses:fixedExpenses||[]).map(e=>`${e.date||e.yearMonth}|${e.name}|${e.amount}`));
    const dupExpCount = expItems.filter(d=>existingVarKeys.has(`${d.date}|${d.name}|${d.amount}`)).length;
    const dupFixCount = fixedItems.filter(d=>existingFixKeys.has(`${d.date}|${d.name}|${d.amount}`)).length;
    const totalDupCount = dupExpCount + dupFixCount;
    const newCount = items.length - totalDupCount;

    if(newCount <= 0){
        alert(`⛔ 저장 차단\n\n선택된 ${items.length}건이 모두 이미 저장된 항목입니다.\n같은 파일을 다시 업로드하셨거나 동일한 거래입니다.\n\n새로 저장할 항목이 없으므로 작업을 취소합니다.`);
        return;
    }

    // 카테고리별 합계 계산 (그룹 표시 추가)
    const byCat={};
    items.forEach(d=>{byCat[d.category]=(byCat[d.category]||0)+d.amount;});
    const groupLabel = {fixed:'🔵고정', variable:'🟠유동', payroll:'🟢인건', tax:'🟡세금'};
    const catSummary=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>{
        const g = getCategoryGroupSafe(cat);
        return `  ${groupLabel[g]||''} • ${cat}: ${formatCurrency(amt)}`;
    }).join('\n');

    // 월별 합계 계산
    const byMonth={};
    items.forEach(d=>{const ym=d.date.substring(0,7);byMonth[ym]=(byMonth[ym]||0)+d.amount;});
    const monthSummary=Object.entries(byMonth).sort().map(([ym,amt])=>`  ${ym}: ${formatCurrency(amt)}`).join('\n');

    const total=items.reduce((s,d)=>s+d.amount,0);
    const personalCount = items.filter(d=>d.isPersonal).length;
    const routeNote =
        (fixedItems.length?`\n  • 고정비 ${fixedItems.length}건 → fixedExpenses`:'') +
        (expItems.length?`\n  • 유동비/인건비/세금 ${expItems.length}건 → variableExpenses`:'');
    const dupNote = totalDupCount>0
        ? `\n\n⚠ 중복 ${totalDupCount}건은 이미 저장되어 자동으로 건너뜁니다 (date+name+amount 기준).`
        : '';
    const dupRatio = totalDupCount/items.length;
    const heavyDupWarning = dupRatio>=0.5
        ? `\n\n🚨 절반 이상이 중복입니다 (${totalDupCount}/${items.length}). 같은 파일을 다시 업로드한 것이 아닌지 확인하세요.`
        : '';
    const personalNote = personalCount?`\n\n🔘 개인사용 표시 ${personalCount}건 (저장은 되되 사업비 합산에서 제외)`:'';

    if(!confirm(`📊 저장 전 요약\n━━━━━━━━━━━━━━━━━━\n\n신규 저장: ${newCount}건${dupNote}${heavyDupWarning}\n\n[저장 위치]${routeNote}\n\n[카테고리별 합계]\n${catSummary}\n\n[월별 합계]\n${monthSummary}\n\n━━━━━━━━━━━━━━━━━━\n총 ${items.length}건 / ${formatCurrency(total)}${personalNote}\n\n저장하시겠습니까?`))return;

    const btn=document.getElementById('expBulkSaveBtn');
    btn.disabled=true;btn.textContent='저장 중...';

    try{
        const batchSize=450;
        let savedFixedCount=0, savedExpCount=0, skipCount=0;

        // ── 고정비 저장 ──
        if(fixedItems.length){
            const existingKeys=new Set((typeof allFixedExpenses!=='undefined'?allFixedExpenses:fixedExpenses||[]).map(e=>`${e.date||e.yearMonth}|${e.name}|${e.amount}`));
            const newFixed=fixedItems.filter(d=>!existingKeys.has(`${d.date}|${d.name}|${d.amount}`));
            skipCount+=fixedItems.length-newFixed.length;

            for(let i=0;i<newFixed.length;i+=batchSize){
                const chunk=newFixed.slice(i,i+batchSize);
                const batch=db.batch();
                for(const item of chunk){
                    const ref=db.collection('fixedExpenses').doc();
                    batch.set(ref,{
                        date:item.date,
                        name:item.name,
                        amount:item.amount,
                        category:item.category,
                        card:item.source,
                        cardId:item.cardId||null,
                        cardLabel:item.cardLabel||'',
                        merchantNorm:item.merchantNorm||item.name,
                        isPersonal: !!item.isPersonal,
                        isCancel: !!item.isCancel,
                        note:item.note||('['+item.source+'] '+item.name),
                        merchant:item.name,
                        yearMonth:item.date.substring(0,7),
                        createdAt:new Date().toISOString(),
                        uploadBatch:true
                    });
                }
                await batch.commit();
                savedFixedCount+=chunk.length;
                if(typeof learnRule==='function'){
                    const seen=new Set();
                    for(const item of chunk){
                        const key=(item.merchantNorm||item.name||'').trim();
                        if(!key || seen.has(key)) continue;
                        seen.add(key);
                        try{ await learnRule(key, item.category, !!item.isPersonal); }catch(_){}
                    }
                }
            }
        }

        // ── 유동비/인건비 저장 ──
        if(expItems.length){
            const existingKeys=new Set(variableExpenses.map(e=>`${e.date}|${e.name}|${e.amount}`));
            const newExp=expItems.filter(d=>!existingKeys.has(`${d.date}|${d.name}|${d.amount}`));
            skipCount+=expItems.length-newExp.length;

            for(let i=0;i<newExp.length;i+=batchSize){
                const chunk=newExp.slice(i,i+batchSize);
                const batch=db.batch();
                for(const item of chunk){
                    const ref=db.collection('variableExpenses').doc();
                    batch.set(ref,{
                        date:item.date,
                        name:item.name,
                        amount:item.amount,
                        category:item.category,
                        card:item.source,
                        cardId:item.cardId||null,
                        cardLabel:item.cardLabel||'',
                        merchantNorm:item.merchantNorm||item.name,
                        isPersonal: !!item.isPersonal,
                        isCancel: !!item.isCancel,
                        isOverseas: !!item.isOverseas,
                        note:item.note||('['+item.source+'] '+item.name),
                        merchant:item.name,
                        yearMonth:item.date.substring(0,7),
                        createdAt:new Date().toISOString(),
                        uploadBatch:true
                    });
                }
                await batch.commit();
                savedExpCount+=chunk.length;
                if(typeof learnRule==='function'){
                    const seen=new Set();
                    for(const item of chunk){
                        const key=(item.merchantNorm||item.name||'').trim();
                        if(!key || seen.has(key)) continue;
                        seen.add(key);
                        try{ await learnRule(key, item.category, !!item.isPersonal); }catch(_){}
                    }
                }
            }
        }
        
        let msg=[];
        if(savedFixedCount) msg.push(`고정비 ${savedFixedCount}건`);
        if(savedExpCount) msg.push(`유동비/세금 ${savedExpCount}건`);
        let result=`✅ 저장 완료! (${msg.join(' + ')||'0건'})`;
        if(skipCount>0) result+=`\n🔄 ${skipCount}건은 이미 존재하여 건너뜀`;
        alert(result);
        
        // 데이터 리로드
        await loadExpenses();
        renderExpenses();
        renderExpenseAnalysis();
        
        // 업로드 초기화
        expUploadParsed=[];
        document.getElementById('expUploadPreview').style.display='none';
        document.getElementById('expUploadStatus').innerHTML='✅ 저장 완료. 유동비/세금 탭에서 확인하세요.';
    }catch(e){
        alert('저장 실패: '+e.message);
    }finally{
        btn.disabled=false;btn.textContent='💾 일괄 저장';
    }
}
