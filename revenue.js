/* ===== revenue.js - LUMI ERP v11 - 매출 관리 ===== */
function renderCharts(){
    const labels=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    
    // 현재 연도 데이터
    const currentYearData=labels.map((_,i)=>{
        const ym=`${currentYear}-${String(i+1).padStart(2,'0')}`;
        return (revenueData[ym]?.total||0)/100000000;
    });
    
    // 전년도 데이터 (2024년 baseline 또는 Firebase)
    const lastYearData=labels.map((_,i)=>{
        if(currentYear===2025){
            return (data2024[i+1]?.total||0)/100000000;
        }else{
            const ym=`${currentYear-1}-${String(i+1).padStart(2,'0')}`;
            return (revenueData[ym]?.total||0)/100000000;
        }
    });
    
    // 월별 매출 추이 차트
    const ctx1=document.getElementById('revenueChart');
    if(ctx1){
        if(revenueChart)revenueChart.destroy();
        revenueChart=new Chart(ctx1,{
            type:'line',
            data:{
                labels,
                datasets:[
                    {label:`${currentYear}년`,data:currentYearData,borderColor:'#9a8b7a',backgroundColor:'rgba(154,139,122,0.1)',fill:true,tension:0.4},
                    {label:`${currentYear-1}년`,data:lastYearData,borderColor:'#ccc',borderDash:[5,5],fill:false,tension:0.4}
                ]
            },
            options:{
                responsive:true,maintainAspectRatio:false,
                plugins:{legend:{position:'top'}},
                scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'억'}}}
            }
        });
    }
    
    // 연도별 비교 차트 (막대)
    const ctx2=document.getElementById('compareChart');
    if(ctx2){
        if(compareChart)compareChart.destroy();
        compareChart=new Chart(ctx2,{
            type:'bar',
            data:{
                labels,
                datasets:[
                    {label:`${currentYear-1}년`,data:lastYearData,backgroundColor:'rgba(200,200,200,0.7)'},
                    {label:`${currentYear}년`,data:currentYearData,backgroundColor:'rgba(154,139,122,0.8)'}
                ]
            },
            options:{
                responsive:true,maintainAspectRatio:false,
                plugins:{legend:{position:'top'}},
                scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'억'}}}
            }
        });
    }
}

function renderRevenueOverview(){
    const ym=getYM();
    const data=revenueData[ym]||{total:0,japan:0,nonInsurance:0,transactions:0,patients:0,nonInsurancePatients:0,japanVisitors:0};
    const prevYM=currentMonth===1?`${currentYear-1}-12`:`${currentYear}-${String(currentMonth-1).padStart(2,'0')}`;
    const prevData=revenueData[prevYM]||{total:0};
    const lastYearData=data2024[currentMonth]||{total:0};
    const growth=data.total-prevData.total;
    const yoyGrowth=data.total-lastYearData.total;
    const patientCount=data.patients||0;
    const avgPerPatient=patientCount?Math.round(data.total/patientCount):0;
    const niTotal=data.nonInsurance||0;
    const niPatients=data.nonInsurancePatients||0;
    const niAvg=niPatients?Math.round(niTotal/niPatients):0;
    const jpTotal=data.japan||0;
    const jpVisitors=data.japanVisitors||0;
    const jpAvg=jpVisitors?Math.round(jpTotal/jpVisitors):0;

    document.getElementById('revenueCards').innerHTML=`
        <div class="card"><div class="card-label">총 매출</div><div class="card-value">${formatCurrency(data.total)}</div><div class="card-sub">${formatNumber(patientCount)}명 · 객단가 ${formatCurrency(avgPerPatient)}</div><div class="card-change ${growth>=0?'positive':'negative'}">전월 대비 ${growth>=0?'+':''}${formatCurrency(growth)}</div></div>
        <div class="card"><div class="card-label">비보험 매출</div><div class="card-value">${formatCurrency(niTotal)}</div><div class="card-sub">${formatNumber(niPatients)}명 · 객단가 ${formatCurrency(niAvg)}</div><div class="card-change">전체의 ${data.total?Math.round(niTotal/data.total*100):0}%</div></div>
        <div class="card"><div class="card-label">일본인 매출</div><div class="card-value">${formatCurrency(jpTotal)}</div><div class="card-sub">${jpVisitors}명 · 객단가 ${formatCurrency(jpAvg)}</div><div class="card-change">전체의 ${data.total?Math.round(jpTotal/data.total*100):0}%</div></div>
        <div class="card"><div class="card-label">전년 동월 대비</div><div class="card-value ${yoyGrowth>=0?'positive':'negative'}">${yoyGrowth>=0?'+':''}${formatCurrency(yoyGrowth)}</div><div class="card-sub">2024년 ${currentMonth}월: ${formatCurrency(lastYearData.total)}</div></div>
    `;
}

function renderDoctorSales(){
    const ym=getYM();const detail=salesDetail[ym]||{};const doctorSales=detail.doctorSales||{};
    const total=Object.values(doctorSales).reduce((sum,d)=>sum+(d.amount||0),0);
    const totalPatients=Object.values(doctorSales).reduce((sum,d)=>sum+(d.patients||0),0);
    const sorted=Object.entries(doctorSales).sort((a,b)=>b[1].amount-a[1].amount);
    const top=sorted[0];
    document.getElementById('doctorCards').innerHTML=`
        <div class="card"><div class="card-label">진료의 수</div><div class="card-value">${sorted.length}명</div></div>
        <div class="card"><div class="card-label">총 매출</div><div class="card-value">${formatCurrency(total)}</div></div>
        <div class="card"><div class="card-label">1위</div><div class="card-value">${top?top[0]:'-'}</div><div class="card-sub">${top?formatCurrency(top[1].amount):''}</div></div>
    `;
    document.getElementById('doctorTable').innerHTML=sorted.map(([name,data])=>{
        const patients=data.patients||0;
        const avgPerPatient=patients?Math.round(data.amount/patients):0;
        return `<tr><td><strong>${name}</strong></td><td class="text-right">${formatNumber(patients)}명</td><td class="text-right">${formatCurrency(data.amount)}</td><td class="text-right">${formatCurrency(avgPerPatient)}</td><td class="text-right">${total?Math.round(data.amount/total*100):0}%</td></tr>`;
    }).join('')||'<tr><td colspan="5" class="text-center">데이터 없음</td></tr>';
}

function renderStaffSales(){
    const ym=getYM();const detail=salesDetail[ym]||{};
    const staffSales=detail.staffSales||{};
    const japanStaffSales=detail.japanStaffSales||{};
    const rev=revenueData[ym]||{total:0,nonInsurance:0};
    
    // 카드: 전체 매출, 비보험 매출, 담당직원 매출
    const staffTotal=Object.values(staffSales).reduce((sum,d)=>sum+(d.amount||0),0);
    const niTotal=rev.nonInsurance||0;
    document.getElementById('staffSalesCards').innerHTML=`
        <div class="card"><div class="card-label">전체 매출</div><div class="card-value">${formatCurrency(rev.total)}</div></div>
        <div class="card"><div class="card-label">비보험 매출</div><div class="card-value">${formatCurrency(niTotal)}</div></div>
        <div class="card"><div class="card-label">담당직원 매출 합계</div><div class="card-value">${formatCurrency(staffTotal)}</div></div>
    `;
    
    // 담당직원 매출 테이블 (매출 데이터가 있는 직원 모두)
    const sorted=Object.entries(staffSales).sort((a,b)=>(b[1].amount||0)-(a[1].amount||0));
    document.getElementById('staffSalesTable').innerHTML=sorted.map(([name,data])=>{
        const patients=data.patients||0;
        const avgPrice=patients?Math.round(data.amount/patients):0;
        const jpData=japanStaffSales[name]||{amount:0,patients:0};
        // 해당 직원의 인센티브 설정 찾기
        const emp=employees.find(e=>(e.matchName||e.name)===name);
        let incDisplay='-';
        if(emp&&emp.incType==='personal'&&emp.incPercent>0){
            const inc=Math.round(data.amount*(emp.incPercent/100));
            const jpInc=emp.incJapan?(japanStaffSales[name]?.patients||0)*10000:0;
            incDisplay=`<span class="badge badge-green">${formatCurrency(inc+jpInc)}</span>`;
        }
        return `<tr>
            <td><strong>${name}</strong></td>
            <td class="text-right">${formatNumber(patients)}명</td>
            <td class="text-right">${formatCurrency(data.amount)}</td>
            <td class="text-right">${formatCurrency(avgPrice)}</td>
            <td class="text-right">${jpData.patients||0}명</td>
            <td class="text-right">${formatCurrency(jpData.amount||0)}</td>
            <td class="text-right">${incDisplay}</td>
        </tr>`;
    }).join('')||'<tr><td colspan="7" class="text-center">데이터 없음</td></tr>';
    
    // 매출 기반 인센티브 (동적 — monthlyIncInput 기반)
    const incInput=typeof monthlyIncInput!=='undefined'?monthlyIncInput:{};
    let niRows='';
    let totalIncentive=0;
    employees.filter(e=>e.status==='active'&&e.incType&&e.incType!=='none'&&e.incType!=='personal').forEach(emp=>{
        const {salesIncentive}=typeof calculateIncentiveForEmp==='function'?calculateIncentiveForEmp(emp):{salesIncentive:0};
        totalIncentive+=salesIncentive;
        const typeLabel=emp.incType==='totalMinusPersonal'?'총매출-개인매출':emp.incType==='totalAll'?'총매출':'';
        niRows+=`<tr>
            <td><strong>${emp.name}</strong></td>
            <td class="text-right">${formatCurrency(incInput.totalRevenue||0)}</td>
            <td class="text-right">${emp.incPercent}%</td>
            <td class="text-right"><span class="badge badge-green">${formatCurrency(salesIncentive)}</span></td>
            <td><small>${typeLabel}</small></td>
        </tr>`;
    });
    if(!niRows) niRows='<tr><td colspan="5" class="text-center">설정된 직원 없음</td></tr>';
    else niRows+=`<tr style="font-weight:bold;border-top:2px solid #ccc"><td>합계</td><td></td><td></td><td class="text-right"><span class="badge badge-gold">${formatCurrency(totalIncentive)}</span></td><td></td></tr>`;
    document.getElementById('nonInsuranceIncentiveTable').innerHTML=niRows;
}

function renderJapanSales(){
    const ym=getYM();
    const detail=salesDetail[ym]||{};
    const japanStaffSales=detail.japanStaffSales||{};
    const currentRevenue=revenueData[ym]||{japan:0,japanVisitors:0};
    
    // 월별 데이터
    const months=[];
    for(let m=1;m<=12;m++){
        const monthYM=`${currentYear}-${String(m).padStart(2,'0')}`;
        const data=revenueData[monthYM]||(currentYear===2024?data2024[m]:{japan:0,japanVisitors:0});
        months.push({month:m,...data});
    }
    const totalJapan=months.reduce((sum,m)=>sum+(m.japan||0),0);
    const totalVisitors=months.reduce((sum,m)=>sum+(m.japanVisitors||0),0);
    const currentVisitors=currentRevenue.japanVisitors||0;
    const avgPrice=currentVisitors?Math.round(currentRevenue.japan/currentVisitors):0;
    
    document.getElementById('japanCards').innerHTML=`
        <div class="card"><div class="card-label">${currentMonth}월 일본인 매출</div><div class="card-value">${formatCurrency(currentRevenue.japan)}</div></div>
        <div class="card"><div class="card-label">${currentMonth}월 환자 수</div><div class="card-value">${currentVisitors}명</div><div class="card-sub">고유 차트번호 기준</div></div>
        <div class="card"><div class="card-label">${currentMonth}월 객단가</div><div class="card-value">${formatCurrency(avgPrice)}</div></div>
        <div class="card"><div class="card-label">연간 누적</div><div class="card-value">${formatCurrency(totalJapan)}</div><div class="card-sub">${totalVisitors}명 방문</div></div>
    `;
    
    // 담당직원별 일본인 매출
    const staffTotal=Object.values(japanStaffSales).reduce((s,d)=>s+(d.amount||0),0);
    const sorted=Object.entries(japanStaffSales).sort((a,b)=>b[1].amount-a[1].amount);
    document.getElementById('japanStaffTable').innerHTML=sorted.map(([name,data])=>{
        const patientCount=data.patients||0;
        const avgPerPatient=patientCount?Math.round(data.amount/patientCount):0;
        const share=staffTotal?Math.round(data.amount/staffTotal*100):0;
        return `<tr><td><strong>${name}</strong></td><td class="text-right">${patientCount}명</td><td class="text-right">${formatCurrency(data.amount)}</td><td class="text-right">${formatCurrency(avgPerPatient)}</td><td class="text-right">${share}%</td></tr>`;
    }).join('')||'<tr><td colspan="5" class="text-center">데이터 없음</td></tr>';
    
    // 월별 테이블
    document.getElementById('japanTable').innerHTML=months.map(m=>{
        const visitors=m.japanVisitors||0;
        const avg=visitors?Math.round(m.japan/visitors):0;
        return `<tr><td>${m.month}월</td><td class="text-right">${formatCurrency(m.japan)}</td><td class="text-right">${visitors}명</td><td class="text-right">${formatCurrency(avg)}</td></tr>`;
    }).join('');
}

function renderUploadHistory(){
    const sorted=Object.entries(revenueData).sort((a,b)=>b[0].localeCompare(a[0]));
    document.getElementById('uploadHistory').innerHTML=sorted.map(([ym,data])=>`<tr><td>${ym}</td><td class="text-right">${formatCurrency(data.total)}</td><td class="text-right">${data.transactions||0}건</td><td>${data.uploadedAt?new Date(data.uploadedAt.toDate()).toLocaleDateString():'-'}</td><td><button class="btn btn-sm btn-danger" onclick="deleteRevenue('${ym}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="5" class="text-center">업로드된 데이터 없음</td></tr>';
}

function handleFileUpload(e){if(e.target.files[0])processFile(e.target.files[0]);}

function processFile(file){
    const reader=new FileReader();
    reader.onload=async function(e){
        try{
            const data=new Uint8Array(e.target.result);
            const wb=XLSX.read(data,{type:'array'});
            
            // 시트 선택: '오더별환자리스트' 시트 우선, 없으면 두 번째 시트, 없으면 첫 번째
            let sheetName=wb.SheetNames[0];
            if(wb.SheetNames.includes('오더별환자리스트')){
                sheetName='오더별환자리스트';
            }else if(wb.SheetNames.length>1){
                sheetName=wb.SheetNames[1];
            }
            
            const sheet=wb.Sheets[sheetName];
            let json=XLSX.utils.sheet_to_json(sheet,{header:1}); // 헤더 없이 배열로
            
            console.log('선택된 시트:', sheetName);
            console.log('총 행 수:', json.length);
            console.log('첫 3행:', json.slice(0,3));
            
            if(json.length<3){
                alert('데이터가 부족합니다.');
                return;
            }
            
            // 헤더 행 찾기 (차트번호, 금액 등이 있는 행)
            let headerRowIndex=0;
            for(let i=0;i<Math.min(5,json.length);i++){
                const row=json[i];
                if(row&&(row.includes('차트번호')||row.includes('금액')||row.includes('진료일'))){
                    headerRowIndex=i;
                    break;
                }
            }
            
            const headers=json[headerRowIndex];
            console.log('헤더 행 인덱스:', headerRowIndex);
            console.log('컬럼 헤더:', headers);
            
            // 컬럼 인덱스 찾기
            const colIndex={
                chartNo:headers.indexOf('차트번호'),
                date:headers.indexOf('진료일'),
                doctor:headers.indexOf('진료의명'),
                staff:headers.indexOf('담당직원'),
                amount:headers.indexOf('금액'),
                nationality:headers.indexOf('국적'),
                name:headers.indexOf('이름'),
                vat:headers.indexOf('부가세'),
                orderName:headers.findIndex(h=>h&&(String(h).includes('오더명')||String(h).includes('시술명')||String(h).includes('진료명')))
            };
            
            console.log('컬럼 인덱스:', colIndex);
            
            // 필수 컬럼 체크
            if(colIndex.date===-1||colIndex.amount===-1){
                alert(`필수 컬럼을 찾을 수 없습니다.\n\n발견된 컬럼: ${headers.filter(h=>h).join(', ')}\n\n필요한 컬럼: 진료일, 금액`);
                return;
            }
            
            // 데이터 행 처리 (헤더 다음 행부터, 마지막 합계행 제외)
            const dataRows=json.slice(headerRowIndex+1);
            
            // 마지막 행이 합계인지 확인 (이름 컬럼에 '합계' 포함 또는 차트번호가 비어있으면서 금액이 큰 경우)
            const lastRow=dataRows[dataRows.length-1];
            const lastRowName=colIndex.name>=0?String(lastRow?lastRow[colIndex.name]||'':'').replace(/\s/g,''):'';
            const isLastRowTotal=lastRow&&(
                lastRowName.includes('합계')||
                (colIndex.chartNo>=0&&!lastRow[colIndex.chartNo]&&lastRow[colIndex.amount]>10000000)
            );
            
            const validRows=isLastRowTotal?dataRows.slice(0,-1):dataRows;
            console.log('마지막행 합계 여부:', isLastRowTotal);
            console.log('유효 데이터 행 수:', validRows.length);
            
            // 월별로 데이터 분리
            const monthlyData={};
            
            validRows.forEach(row=>{
                if(!row||!row.length)return;
                
                const amount=parseInt(row[colIndex.amount])||0;
                if(amount<=0)return;
                
                let dateStr=String(row[colIndex.date]||'');
                
                // 날짜 형식 처리
                if(typeof row[colIndex.date]==='number'){
                    // 엑셀 시리얼 날짜
                    const jsDate=new Date((row[colIndex.date]-25569)*86400*1000);
                    dateStr=jsDate.toISOString().slice(0,10).replace(/-/g,'');
                }else if(dateStr.includes('-')){
                    dateStr=dateStr.replace(/-/g,'');
                }
                
                if(dateStr.length<8)return;
                
                const year=dateStr.substring(0,4);
                const month=dateStr.substring(4,6);
                const ym=year+'-'+month;
                
                const yearNum=parseInt(year);
                const monthNum=parseInt(month);
                if(yearNum<2020||yearNum>2030||monthNum<1||monthNum>12)return;
                
                if(!monthlyData[ym]){
                    monthlyData[ym]={
                        total:0,japan:0,nonInsurance:0,transactions:0,
                        patients:new Set(),nonInsurancePatients:new Set(),
                        japanPatients:new Set(),  // 총 일본인 내원객 (차트번호 기준)
                        doctorSales:{},staffSales:{},
                        japanCharts:{},japanStaffSales:{},
                        treatmentCounts:{}
                    };
                }
                
                const chartNo=row[colIndex.chartNo];
                const doctor=row[colIndex.doctor];
                const staff=row[colIndex.staff];
                const nationality=row[colIndex.nationality];
                const vatFlag=colIndex.vat>=0?String(row[colIndex.vat]||'').trim():'';
                const isNonInsurance=(vatFlag==='O');
                
                monthlyData[ym].total+=amount;
                monthlyData[ym].transactions++;
                if(chartNo)monthlyData[ym].patients.add(chartNo);
                
                // 비보험 매출 (부가세='O')
                if(isNonInsurance){
                    monthlyData[ym].nonInsurance+=amount;
                    if(chartNo)monthlyData[ym].nonInsurancePatients.add(chartNo);
                }
                
                // 진료의별 매출
                if(doctor&&doctor!=='빠른예약'){
                    if(!monthlyData[ym].doctorSales[doctor]){
                        monthlyData[ym].doctorSales[doctor]={count:0,amount:0,patients:new Set()};
                    }
                    monthlyData[ym].doctorSales[doctor].count++;
                    monthlyData[ym].doctorSales[doctor].amount+=amount;
                    if(chartNo)monthlyData[ym].doctorSales[doctor].patients.add(chartNo);
                }
                
                // 담당직원별 매출
                if(staff){
                    if(!monthlyData[ym].staffSales[staff]){
                        monthlyData[ym].staffSales[staff]={count:0,amount:0,patients:new Set(),niAmount:0,niPatients:new Set()};
                    }
                    monthlyData[ym].staffSales[staff].count++;
                    monthlyData[ym].staffSales[staff].amount+=amount;
                    if(chartNo)monthlyData[ym].staffSales[staff].patients.add(chartNo);
                    if(isNonInsurance){
                        monthlyData[ym].staffSales[staff].niAmount+=amount;
                        if(chartNo)monthlyData[ym].staffSales[staff].niPatients.add(chartNo);
                    }
                }
                
                // 일본인 매출
                if(nationality&&String(nationality).includes('일본')){
                    monthlyData[ym].japan+=amount;
                    
                    // 총 일본인 내원객 추적 (차트번호 기준 중복 제거)
                    if(chartNo){
                        monthlyData[ym].japanPatients.add(chartNo);
                        
                        if(!monthlyData[ym].japanCharts[chartNo]){
                            monthlyData[ym].japanCharts[chartNo]={amount:0,staff:staff||'미지정'};
                        }
                        monthlyData[ym].japanCharts[chartNo].amount+=amount;
                    }
                    
                    const staffKey=staff||'미지정';
                    if(!monthlyData[ym].japanStaffSales[staffKey]){
                        monthlyData[ym].japanStaffSales[staffKey]={
                            totalPatients:0,  // 총 일본인 내원객 수 (나중에 채움)
                            amount:0
                        };
                    }
                    monthlyData[ym].japanStaffSales[staffKey].amount+=amount;
                }
                
                // 시술명(오더명)별 횟수 집계 - 재고 차감/손익 계산용
                if(colIndex.orderName>=0){
                    const orderName=String(row[colIndex.orderName]||'').trim();
                    if(orderName){
                        monthlyData[ym].treatmentCounts[orderName]=(monthlyData[ym].treatmentCounts[orderName]||0)+1;
                    }
                }
            });
            
            // 각 월별로 Firebase에 저장
            const months=Object.keys(monthlyData).sort();
            let savedCount=0;
            
            if(months.length===0){
                alert(`데이터 파싱 실패!\n\n컬럼은 인식되었지만 유효한 데이터가 없습니다.\n진료일 형식이나 금액을 확인해주세요.`);
                return;
            }
            
            for(const ym of months){
                const d=monthlyData[ym];
                // 전체 고유 환자 수
                const patientCount=d.patients.size;
                // 일본인 고유 환자 수
                const japanVisitors=Object.keys(d.japanCharts).length;
                
                // doctorSales의 Set을 숫자로 변환
                const doctorSalesForDB={};
                for(const[doc,data]of Object.entries(d.doctorSales||{})){
                    doctorSalesForDB[doc]={
                        count:data.count,
                        amount:data.amount,
                        patients:data.patients.size
                    };
                }
                // staffSales의 Set을 숫자로 변환
                const staffSalesForDB={};
                for(const[staff,data]of Object.entries(d.staffSales||{})){
                    staffSalesForDB[staff]={
                        count:data.count,
                        amount:data.amount,
                        patients:data.patients.size,
                        niAmount:data.niAmount||0,
                        niPatients:data.niPatients?data.niPatients.size:0
                    };
                }
                // japanStaffSales 저장 - 총 일본인 내원객 수 적용
                const totalJapanPatients = d.japanPatients.size;  // 총 일본인 내원객 수
                const japanStaffSalesForDB={};
                for(const[staff,data]of Object.entries(d.japanStaffSales||{})){
                    japanStaffSalesForDB[staff]={
                        patients:totalJapanPatients,  // 모든 담당자에게 동일한 총 내원객 수
                        amount:data.amount
                    };
                }
                
                await db.collection('revenue').doc(ym).set({
                    total:d.total,japan:d.japan,
                    nonInsurance:d.nonInsurance,
                    nonInsurancePatients:d.nonInsurancePatients.size,
                    japanVisitors:japanVisitors,
                    transactions:d.transactions,
                    patients:patientCount,
                    uploadedAt:firebase.firestore.FieldValue.serverTimestamp()
                },{merge:true});
                await db.collection('salesDetail').doc(ym).set({
                    doctorSales:doctorSalesForDB,
                    staffSales:staffSalesForDB,
                    japanStaffSales:japanStaffSalesForDB,
                    treatmentCounts:d.treatmentCounts||{},
                    totalTreatments:d.transactions,
                    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
                });
                savedCount++;
            }
            
            // 결과 알림
            const totalAll=Object.values(monthlyData).reduce((s,d)=>s+d.total,0);
            const patientsAll=Object.values(monthlyData).reduce((s,d)=>s+d.patients.size,0);
            
            // 재고 자동 차감
            let deductionMsg='';
            for(const ym of months){
                const tc=monthlyData[ym].treatmentCounts;
                if(Object.keys(tc).length>0){
                    const result=await deductInventoryByRecipes(ym,tc);
                    if(result.deducted>0){
                        deductionMsg+=`\n${ym}: ${result.deducted}개 품목 재고 차감 (${result.matched}개 시술 매칭)`;
                    }
                    if(result.unmatched.length>0){
                        deductionMsg+=`\n  ⚠ 레시피 미등록: ${result.unmatched.slice(0,5).join(', ')}${result.unmatched.length>5?' 외 '+(result.unmatched.length-5)+'개':''}`;
                    }
                }
            }
            
            alert(`업로드 완료!\n\n저장된 월: ${months.join(', ')}\n총 ${savedCount}개월 데이터\n총 환자: ${patientsAll}명\n총 매출: ${formatCurrency(totalAll)}${deductionMsg?'\n\n📦 재고 차감:'+deductionMsg:''}`);
            
            await loadRevenueData();await loadSalesDetailData();
            if(typeof loadInventory==='function')await loadInventory();
            renderAll();
        }catch(err){alert('파일 처리 오류: '+err.message);console.error(err);}
    };
    reader.readAsArrayBuffer(file);
}

// 업로드 이력 삭제
async function deleteRevenue(ym){
    if(!confirm(`${ym} 데이터를 삭제하시겠습니까?\n\n매출 및 상세 데이터가 모두 삭제됩니다.`))return;
    try{
        await db.collection('revenue').doc(ym).delete();
        await db.collection('salesDetail').doc(ym).delete();
        alert(`${ym} 데이터가 삭제되었습니다.`);
        await loadRevenueData();await loadSalesDetailData();renderAll();
    }catch(err){alert('삭제 실패: '+err.message);}
}

// ===== 매출 기반 재고 자동 차감 =====
async function deductInventoryByRecipes(ym, treatmentCounts){
    const result={matched:0, deducted:0, unmatched:[]};
    if(!recipes.length||!inventoryItems.length)return result;
    
    // 품목별 총 차감량 집계
    const deductions={}; // {itemId: totalAmount}
    
    for(const[treatmentName, count] of Object.entries(treatmentCounts)){
        const recipe=recipes.find(r=>r.treatmentName===treatmentName);
        if(!recipe){
            result.unmatched.push(treatmentName);
            continue;
        }
        result.matched++;
        
        if(!recipe.ingredients)continue;
        for(const ing of recipe.ingredients){
            if(!ing.itemId||!ing.amount)continue;
            const item=inventoryItems.find(i=>i.id===ing.itemId);
            if(!item)continue;
            
            let amountPerTreatment=ing.amount;
            // 소분용 품목: 로스율 10% 적용
            if(item.type==='portioned'){
                amountPerTreatment=amountPerTreatment*(1+0.10);
            }
            
            const totalDeduct=amountPerTreatment*count;
            deductions[ing.itemId]=(deductions[ing.itemId]||0)+totalDeduct;
        }
    }
    
    // Firebase에 차감 반영
    const batch=db.batch();
    for(const[itemId, totalDeduct] of Object.entries(deductions)){
        const item=inventoryItems.find(i=>i.id===itemId);
        if(!item)continue;
        
        const newStock=Math.max(0,(item.currentStock||0)-totalDeduct);
        const ref=db.collection('inventory').doc(itemId);
        batch.update(ref,{
            currentStock:Math.round(newStock*1000)/1000, // 소수점 3자리까지
            lastDeductedAt:new Date().toISOString(),
            lastDeductedYM:ym
        });
        result.deducted++;
    }
    
    if(result.deducted>0){
        try{
            await batch.commit();
            // 차감 이력 기록
            await db.collection('inventoryLogs').add({
                type:'auto_deduct',
                yearMonth:ym,
                treatmentCounts:treatmentCounts,
                deductions:deductions,
                matchedRecipes:result.matched,
                unmatchedTreatments:result.unmatched,
                createdAt:new Date().toISOString()
            });
        }catch(e){
            console.error('재고 차감 실패:',e);
        }
    }
    
    return result;
}
