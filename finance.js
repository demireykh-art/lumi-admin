/* ===== finance.js - LUMI ERP v11 - 손익계산서 & 대시보드 ===== */

// ===== 대시보드 상단 3카드 =====
function renderDashboardCards(){
    const strip=document.getElementById('dashboardStrip');
    if(!strip)return;
    
    const ym=getYM();
    const rev=revenueData[ym];
    const todayTotal=getTodayRevenue();
    const pl=calculatePL();
    const lowStock=typeof getLowStockCount==='function'?getLowStockCount():0;
    
    strip.innerHTML=`
        <div class="dash-card revenue">
            <div class="dash-card-icon">💰</div>
            <div class="dash-card-label">오늘의 매출</div>
            <div class="dash-card-value">${formatCurrency(todayTotal)}</div>
            <div class="dash-card-sub">이번 달 총: ${formatCurrency(rev?.total||0)}</div>
        </div>
        <div class="dash-card profit">
            <div class="dash-card-icon">📊</div>
            <div class="dash-card-label">이번 달 누적 순이익</div>
            <div class="dash-card-value" style="color:${pl.netProfit>=0?'var(--green)':'var(--red)'}">
                ${formatCurrency(pl.netProfit)}
            </div>
            <div class="dash-card-sub">영업이익률 ${rev?.total?Math.round(pl.netProfit/rev.total*100):0}%</div>
        </div>
        <div class="dash-card alert">
            <div class="dash-card-icon">📦</div>
            <div class="dash-card-label">발주 필요 재고</div>
            <div class="dash-card-value" style="color:${lowStock?'var(--red)':'var(--green)'}">
                ${lowStock}개
            </div>
            <div class="dash-card-sub">안전재고 미달 품목</div>
        </div>
    `;
}

function getTodayRevenue(){
    // salesDetail에서 오늘 날짜의 매출 합산
    const today=new Date().toISOString().slice(0,10);
    const ym=getYM();
    const detail=salesDetail[ym];
    if(!detail?.rows)return 0;
    return detail.rows.filter(r=>{
        const d=r['결제일']||r['접수일']||'';
        return d.includes(today.slice(5).replace('-','/'));
    }).reduce((s,r)=>s+(parseFloat(String(r['총액']||r['수납총액']||0).replace(/,/g,''))||0),0);
}

// ===== P&L 계산 =====
function calculatePL(){
    const ym=getYM();
    const rev=revenueData[ym];
    const totalRevenue=rev?.total||0;
    
    // 매출 구분 (의사별)
    const doctorRevenue={};
    const detail=salesDetail[ym];
    if(detail?.doctorSales){
        for(const[doc,data] of Object.entries(detail.doctorSales)){
            doctorRevenue[doc]=(data.amount||0);
        }
    }
    
    // 재료비: salesDetail.treatmentCounts × 레시피 원가 (정확한 매칭)
    let materialCost=0;
    let matchedTreatments=0;
    let unmatchedTreatments=0;
    let totalTreatmentCount=0;
    const treatmentCosts={}; // 시술별 원가 상세 (손익계산서 상세 표시용)
    
    const tc=detail?.treatmentCounts||{};
    if(Object.keys(tc).length>0&&recipes.length>0){
        for(const[name,count] of Object.entries(tc)){
            totalTreatmentCount+=count;
            const recipe=recipes.find(r=>r.treatmentName===name);
            let cost;
            if(recipe){
                cost=typeof calculateRecipeCost==='function'?calculateRecipeCost(recipe):BASE_HYGIENE_COST;
                matchedTreatments++;
            }else{
                // 레시피 미등록 시술은 기본위생용품비만
                cost=BASE_HYGIENE_COST;
                unmatchedTreatments++;
            }
            const lineCost=cost*count;
            materialCost+=lineCost;
            treatmentCosts[name]={count,unitCost:cost,totalCost:lineCost,hasRecipe:!!recipe};
        }
    }else if(detail?.totalTreatments>0){
        // treatmentCounts가 없으면 전체 건수 × 기본위생비
        totalTreatmentCount=detail.totalTreatments;
        materialCost=totalTreatmentCount*BASE_HYGIENE_COST;
    }else if(rev?.transactions>0){
        totalTreatmentCount=rev.transactions;
        materialCost=totalTreatmentCount*BASE_HYGIENE_COST;
    }
    
    // 인건비 (급여 데이터 또는 직원 연봉 기반)
    let laborCost=0;
    const ymKey=ym.replace('-','');
    const monthPayroll=payrollData.filter(p=>p.yearMonth===ymKey);
    if(monthPayroll.length>0){
        laborCost=monthPayroll.reduce((s,p)=>s+(p.totalPay||p.grossPay||0),0);
    }else{
        // 급여 데이터 없으면 연봉 기반 추정
        const activeEmps=employees.filter(e=>e.status!=='inactive');
        laborCost=activeEmps.reduce((s,e)=>{
            const annual=(e.salary||0)*10000;
            return s+annual/12;
        },0);
    }
    
    // 고정비
    const fixedCost=fixedExpenses.reduce((s,e)=>s+(e.amount||0),0);
    
    // 유동비 (이번달)
    const monthVariable=variableExpenses.filter(e=>{
        const d=e.date||e.payDate||'';
        return d.startsWith(ym);
    });
    const variableCost=monthVariable.reduce((s,e)=>s+(e.amount||0),0);
    
    // 세금 (이번달)
    const monthTax=[
        ...withholdingTaxes.filter(t=>(t.date||'').startsWith(ym)),
        ...vatTaxes.filter(t=>(t.date||'').startsWith(ym)),
        ...incomeTaxes.filter(t=>(t.date||'').startsWith(ym))
    ].reduce((s,t)=>s+(t.amount||0),0);
    
    const totalExpense=materialCost+laborCost+fixedCost+variableCost;
    const netProfit=totalRevenue-totalExpense;
    
    return{
        totalRevenue,doctorRevenue,
        materialCost,laborCost,fixedCost,variableCost,monthTax,
        totalExpense,netProfit,
        treatmentCosts,totalTreatmentCount,matchedTreatments,unmatchedTreatments
    };
}

// ===== 손익계산서 렌더링 =====
let plRevenueChart=null,plExpenseChart=null,plTrendChart=null;

function renderPLStatement(){
    const container=document.getElementById('plContainer');
    if(!container)return;
    
    const pl=calculatePL();
    const ym=getYM();
    const margin=pl.totalRevenue?Math.round(pl.netProfit/pl.totalRevenue*100):0;
    
    container.innerHTML=`
        <div class="pl-charts">
            <div class="chart-container">
                <div class="chart-title">매출 구성 (의사별)</div>
                <div class="chart-wrapper" style="height:250px"><canvas id="plRevenueChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title">비용 구성</div>
                <div class="chart-wrapper" style="height:250px"><canvas id="plExpenseChart"></canvas></div>
            </div>
        </div>
        <div class="pl-statement">
            <h3 style="text-align:center;margin-bottom:1.5rem;font-size:1.1rem">📋 ${currentYear}년 ${currentMonth}월 손익계산서</h3>
            
            <div class="pl-section-title">매출</div>
            <div class="pl-row total">
                <span class="pl-label">총 매출</span>
                <span class="pl-value">${formatCurrency(pl.totalRevenue)}</span>
            </div>
            ${Object.entries(pl.doctorRevenue).map(([doc,amt])=>`
                <div class="pl-row">
                    <span class="pl-label" style="padding-left:1rem">└ ${doc}</span>
                    <span class="pl-value">${formatCurrency(amt)} (${pl.totalRevenue?Math.round(amt/pl.totalRevenue*100):0}%)</span>
                </div>
            `).join('')}
            
            <div class="pl-section-title">비용</div>
            <div class="pl-row">
                <span class="pl-label">재료비 (시술 원가)
                    <span style="font-size:.75rem;color:var(--text-secondary);margin-left:.5rem">
                        ${pl.totalTreatmentCount||0}건 시술 / ${pl.matchedTreatments||0}개 레시피 매칭${pl.unmatchedTreatments?' / '+pl.unmatchedTreatments+'개 미등록':''}
                    </span>
                </span>
                <span class="pl-value negative">${formatCurrency(pl.materialCost)}</span>
            </div>
            ${Object.keys(pl.treatmentCosts||{}).length>0?`
                <div style="max-height:200px;overflow-y:auto;margin-bottom:.5rem">
                ${Object.entries(pl.treatmentCosts).sort((a,b)=>b[1].totalCost-a[1].totalCost).slice(0,15).map(([name,d])=>`
                    <div class="pl-row" style="font-size:.8rem;padding:.4rem 0 .4rem 1.5rem;color:var(--text-secondary)">
                        <span>└ ${name} × ${d.count}건 ${d.hasRecipe?'':'⚠️미등록'}</span>
                        <span>${formatCurrency(d.totalCost)}</span>
                    </div>
                `).join('')}
                ${Object.keys(pl.treatmentCosts).length>15?`<div style="text-align:center;font-size:.75rem;color:var(--text-secondary);padding:.5rem">... 외 ${Object.keys(pl.treatmentCosts).length-15}개 시술</div>`:''}
                </div>
            `:''}
            <div class="pl-row">
                <span class="pl-label">인건비</span>
                <span class="pl-value negative">${formatCurrency(pl.laborCost)}</span>
            </div>
            <div class="pl-row">
                <span class="pl-label">고정비 (임대료/리스 등)</span>
                <span class="pl-value negative">${formatCurrency(pl.fixedCost)}</span>
            </div>
            <div class="pl-row">
                <span class="pl-label">유동비 (기타 비용)</span>
                <span class="pl-value negative">${formatCurrency(pl.variableCost)}</span>
            </div>
            <div class="pl-row subtotal">
                <span class="pl-label">총 비용</span>
                <span class="pl-value negative">${formatCurrency(pl.totalExpense)}</span>
            </div>
            
            <div class="pl-section-title">손익</div>
            <div class="pl-row total">
                <span class="pl-label">순이익 (영업이익률 ${margin}%)</span>
                <span class="pl-value ${pl.netProfit>=0?'positive':'negative'}">${formatCurrency(pl.netProfit)}</span>
            </div>
        </div>
        <div class="chart-container">
            <div class="chart-title">월별 손익 추이</div>
            <div class="chart-wrapper"><canvas id="plTrendChart"></canvas></div>
        </div>
    `;
    
    renderPLCharts(pl);
}

function renderPLCharts(pl){
    // 매출 파이 (의사별)
    const revCtx=document.getElementById('plRevenueChart');
    if(revCtx){
        if(plRevenueChart)plRevenueChart.destroy();
        const labels=Object.keys(pl.doctorRevenue);
        const data=Object.values(pl.doctorRevenue);
        plRevenueChart=new Chart(revCtx,{
            type:'doughnut',
            data:{labels,datasets:[{data,backgroundColor:['#9a8b7a','#5a7a5a','#4a7a9a','#a85a5a','#e67e22','#8e44ad']}]},
            options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:12}}}}}
        });
    }
    
    // 비용 파이
    const expCtx=document.getElementById('plExpenseChart');
    if(expCtx){
        if(plExpenseChart)plExpenseChart.destroy();
        plExpenseChart=new Chart(expCtx,{
            type:'doughnut',
            data:{
                labels:['재료비','인건비','고정비','유동비'],
                datasets:[{data:[pl.materialCost,pl.laborCost,pl.fixedCost,pl.variableCost],
                    backgroundColor:['#e67e22','#3498db','#9a8b7a','#95a5a6']}]
            },
            options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:12}}}}}
        });
    }
    
    // 월별 추이 바차트
    const trendCtx=document.getElementById('plTrendChart');
    if(trendCtx){
        if(plTrendChart)plTrendChart.destroy();
        const months=[];const revenues=[];const profits=[];
        for(let m=1;m<=12;m++){
            const mym=`${currentYear}-${String(m).padStart(2,'0')}`;
            months.push(`${m}월`);
            const r=revenueData[mym];
            revenues.push(r?.total||0);
            // 간이 손익 (매출 - 고정비 - 인건비 추정)
            const mRev=r?.total||0;
            const est=mRev-(pl.fixedCost)-(pl.laborCost)-(pl.materialCost>0?pl.materialCost:mRev*0.1);
            profits.push(m<=currentMonth?est:0);
        }
        plTrendChart=new Chart(trendCtx,{
            type:'bar',
            data:{labels:months,datasets:[
                {label:'매출',data:revenues,backgroundColor:'rgba(154,139,122,0.5)',borderColor:'#9a8b7a',borderWidth:1},
                {label:'순이익',data:profits,backgroundColor:profits.map(p=>p>=0?'rgba(90,122,90,0.5)':'rgba(168,90,90,0.5)'),borderColor:profits.map(p=>p>=0?'#5a7a5a':'#a85a5a'),borderWidth:1}
            ]},
            options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>v>=1e8?(v/1e8).toFixed(1)+'억':v>=1e4?(v/1e4).toFixed(0)+'만':v}}},plugins:{legend:{position:'top'}}}
        });
    }
}
