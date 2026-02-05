/* ===== hr-attendance.js - LUMI ERP v11 - 직원/근태/인센티브 ===== */
function renderEmployees(){
    const roleLabels={doctor:'원장',nurse:'간호사',coordinator:'코디네이터',marketing:'마케팅',manager:'실장',esthetician:'피부관리사'};
    const filter=document.getElementById('attendanceFilter');
    filter.innerHTML='<option value="all">전체 직원</option>'+employees.filter(e=>e.status==='active').map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
    const otSelect=document.getElementById('otEmployee');
    otSelect.innerHTML=employees.filter(e=>e.status==='active').map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
    // 연차 필터도 업데이트
    const leaveEmpFilter=document.getElementById('leaveEmployeeFilter');
    if(leaveEmpFilter){
        leaveEmpFilter.innerHTML='<option value="all">전체 직원</option>'+employees.filter(e=>e.status==='active').map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
    }
    document.getElementById('employeeTable').innerHTML=employees.map(e=>{
        // 연차 계산
        const totalLeave=e.annualLeave||calculateLegalAnnualLeave(e.joinDate);
        const usedLeave=getUsedLeave(e.id);
        const remainLeave=Math.max(0,totalLeave-usedLeave);
        const leavePercent=totalLeave>0?Math.round((usedLeave/totalLeave)*100):0;
        const leaveBarClass=leavePercent>80?'warning':'';
        
        return `<tr>
            <td><strong>${e.name}</strong></td>
            <td>${e.matchName||'-'}</td>
            <td>${roleLabels[e.role]||e.role}</td>
            <td>${e.joinDate||'-'}</td>
            <td>${getYearsOfService(e.joinDate)}</td>
            <td>
                <div style="min-width:80px">
                    <span class="badge ${remainLeave<=2?'badge-red':remainLeave<=5?'badge-orange':'badge-green'}">${remainLeave}일 / ${totalLeave}일</span>
                    <div class="leave-bar"><div class="leave-bar-fill ${leaveBarClass}" style="width:${leavePercent}%"></div></div>
                </div>
            </td>
            <td>${e.salary?e.salary+'만원':'-'}</td>
            <td>${formatCurrency(e.hourly)}</td>
            <td><span class="badge ${e.status==='active'?'badge-green':'badge-red'}">${e.status==='active'?'재직':'퇴사'}</span></td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editEmployee('${e.id}')">수정</button>
                <button class="btn btn-sm btn-gold" onclick="resetPassword('${e.id}','${e.name}')">비번초기화</button>
                <button class="btn btn-sm btn-danger" onclick="deleteEmployee('${e.id}')">삭제</button>
            </td>
        </tr>`;
    }).join('')||'<tr><td colspan="10" class="text-center">등록된 직원 없음</td></tr>';
}

// 직원의 사용 연차 계산
function getUsedLeave(employeeId){
    const year=new Date().getFullYear().toString();
    const approved=leaveRequests.filter(r=>
        r.employeeId===employeeId && 
        r.status==='approved' &&
        r.dates?.some(d=>d.startsWith(year))
    );
    return approved.reduce((sum,r)=>{
        if(r.type?.includes('반차'))return sum+0.5;
        return sum+(r.dates?.filter(d=>d.startsWith(year)).length||1);
    },0);
}

async function resetPassword(empId,empName){
    if(!confirm(`${empName}님의 비밀번호를 초기화하시겠습니까?\n\n초기 비밀번호: fnal12890-`))return;
    try{
        await db.collection('employees').doc(empId).update({password:'fnal12890-'});
        alert(`${empName}님의 비밀번호가 초기화되었습니다.\n\n초기 비밀번호: fnal12890-`);
        await loadEmployees();renderEmployees();
    }catch(e){alert('초기화 실패: '+e.message);}
}

function renderAttendance(){
    const filter=document.getElementById('attendanceFilter').value;
    let filtered=attendance;
    if(filter!=='all'){filtered=attendance.filter(a=>a.employeeId===filter);}
    const workDays=filtered.filter(a=>a.checkIn).length;
    const lateDays=filtered.filter(a=>a.status==='late').length;
    const earlyDays=filtered.filter(a=>a.status==='early').length;
    const absentDays=filtered.filter(a=>a.status==='absent').length;
    document.getElementById('workDays').textContent=workDays+'일';
    document.getElementById('lateDays').textContent=lateDays+'회';
    document.getElementById('earlyDays').textContent=earlyDays+'회';
    document.getElementById('absentDays').textContent=absentDays+'회';
    const sorted=filtered.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    document.getElementById('attendanceTable').innerHTML=sorted.slice(0,50).map(a=>{
        const emp=employees.find(e=>e.id===a.employeeId);
        const workHours=a.checkIn&&a.checkOut?calculateWorkHours(a.checkIn,a.checkOut):'-';
        const statusBadge={normal:'<span class="badge badge-green">정상</span>',late:'<span class="badge badge-orange">지각</span>',early:'<span class="badge badge-blue">조퇴</span>',absent:'<span class="badge badge-red">결근</span>'};
        return `<tr><td>${a.date||'-'}</td><td>${emp?emp.name:a.employeeId}</td><td>${a.checkIn||'-'}</td><td>${a.checkOut||'-'}</td><td>${workHours}</td><td>${statusBadge[a.status]||'-'}</td><td><button class="btn btn-sm btn-secondary" onclick="editAttendance('${a.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteAttendance('${a.id}')">삭제</button></td></tr>`;
    }).join('')||'<tr><td colspan="7" class="text-center">근태 기록 없음</td></tr>';
}

async function editAttendance(id){
    const att=attendance.find(a=>a.id===id);
    if(!att)return;
    const newCheckIn=prompt('출근 시간 (HH:MM)',att.checkIn||'09:00');
    if(newCheckIn===null)return;
    const newCheckOut=prompt('퇴근 시간 (HH:MM)',att.checkOut||'18:00');
    if(newCheckOut===null)return;
    const newStatus=prompt('상태 (normal/late/early/absent)',att.status||'normal');
    if(newStatus===null)return;
    try{
        await db.collection('attendance').doc(id).update({checkIn:newCheckIn,checkOut:newCheckOut,status:newStatus});
        await loadAttendance();renderAttendance();
        alert('수정되었습니다.');
    }catch(e){alert('수정 실패: '+e.message);}
}

async function deleteAttendance(id){
    if(!confirm('이 근태 기록을 삭제하시겠습니까?'))return;
    try{
        await db.collection('attendance').doc(id).delete();
        await loadAttendance();renderAttendance();
        alert('삭제되었습니다.');
    }catch(e){alert('삭제 실패: '+e.message);}
}

function calculateWorkHours(checkIn,checkOut){
    const [inH,inM]=checkIn.split(':').map(Number);
    const [outH,outM]=checkOut.split(':').map(Number);
    const minutes=(outH*60+outM)-(inH*60+inM);
    const hours=Math.floor(minutes/60);const mins=minutes%60;
    return `${hours}시간 ${mins}분`;
}

function renderOvertime(){
    let eveningMinutes=0;
    attendance.forEach(a=>{
        if(a.checkOut){
            const [h,m]=a.checkOut.split(':').map(Number);
            const totalMinutes=h*60+m;
            if(totalMinutes>18*60){eveningMinutes+=totalMinutes-18*60;}
        }
    });
    const lunchMinutes=lunchOT.reduce((sum,ot)=>sum+(ot.minutes||0),0);
    const totalMinutes=eveningMinutes+lunchMinutes;
    const avgHourly=employees.length?employees.reduce((sum,e)=>sum+(e.hourly||12000),0)/employees.length:12000;
    const totalPay=Math.round(totalMinutes/60*avgHourly*1.5);
    document.getElementById('totalOT').textContent=Math.round(totalMinutes/60*10)/10+'시간';
    document.getElementById('eveningOT').textContent=Math.round(eveningMinutes/60*10)/10+'시간';
    document.getElementById('lunchOTVal').textContent=Math.round(lunchMinutes/60*10)/10+'시간';
    document.getElementById('totalOTPay').textContent=formatCurrency(totalPay);
    const sorted=lunchOT.sort((a,b)=>b.date.localeCompare(a.date));
    document.getElementById('lunchOTTable').innerHTML=sorted.map(ot=>{
        const emp=employees.find(e=>e.id===ot.employeeId);
        return `<tr><td>${ot.date}</td><td>${emp?emp.name:ot.employeeId}</td><td>${ot.minutes}분</td><td>${ot.reason||'-'}</td><td><button class="btn btn-sm btn-danger" onclick="deleteLunchOT('${ot.id}')">삭제</button></td></tr>`;
    }).join('')||'<tr><td colspan="5" class="text-center">점심 OT 기록 없음</td></tr>';
}

function renderIncentiveItems(){
    document.getElementById('incentiveItemTable').innerHTML=incentiveItems.map(item=>{
        // 적용 직원 이름만 표시 (사번 없이)
        let empNames='전체';
        if(item.employees?.length){
            empNames=item.employees.map(id=>{
                const emp=employees.find(e=>e.id===id);
                return emp?emp.name:null;
            }).filter(n=>n).join(', ')||'미지정';
        }
        let typeLabel='';
        let typeBadge='badge-blue';
        if(item.type==='perCase'){
            typeLabel=`건당 ${formatCurrency(item.price)}`;
            typeBadge='badge-blue';
        }else if(item.type==='salesPercent'){
            typeLabel=`담당 매출 ${item.salesPercent||1}%`;
            typeBadge='badge-gold';
        }else if(item.type==='japanSales'){
            typeLabel=`일본인 매출 ${item.percent||1}%`;
            typeBadge='badge-green';
        }
        return `<tr><td><strong>${item.name}</strong></td><td><span class="badge ${typeBadge}">${typeLabel}</span></td><td><span class="badge badge-purple">${empNames}</span></td><td><button class="btn btn-sm btn-secondary" onclick="editIncentiveItem('${item.id}')">수정</button> <button class="btn btn-sm btn-danger" onclick="deleteIncentiveItem('${item.id}')">삭제</button></td></tr>`;
    }).join('')||'<tr><td colspan="4" class="text-center">등록된 항목 없음</td></tr>';
}

function renderIncentiveSummary(){
    const ym=getYM();const detail=salesDetail[ym]||{};const staffSales=detail.staffSales||{};
    const japanStaffSales=detail.japanStaffSales||{};
    const rev=revenueData[ym]||{total:0,nonInsurance:0};
    const niTotal=rev.nonInsurance||0;
    const bomiNi=(staffSales['박보미']||{}).niAmount||0;
    const jiyoonNi=(staffSales['박지윤']||{}).niAmount||0;
    const okNiBase=Math.max(0,niTotal-bomiNi-jiyoonNi);
    const roleLabels={doctor:'원장',nurse:'간호사',coordinator:'코디네이터',marketing:'마케팅',manager:'실장',esthetician:'피부관리사'};
    
    document.getElementById('incentiveSummaryTable').innerHTML=employees.filter(e=>e.status==='active').map(emp=>{
        let salesIncentive=0;
        let japanIncentive=0;
        let niIncentive=0;
        const name=emp.matchName||emp.name;
        
        // 박보미, 박지윤: 담당매출 1% + 일본인 건당 1만원
        if(name==='박보미'||name==='박지윤'){
            const sd=staffSales[name]||{amount:0};
            salesIncentive=Math.round(sd.amount*0.01);
            const jpd=japanStaffSales[name]||{patients:0};
            japanIncentive=(jpd.patients||0)*10000;
        }
        // 김옥경: 비보험(박보미+박지윤제외) 0.9%
        else if(name==='김옥경'){
            niIncentive=Math.round(okNiBase*0.009);
        }
        // 신인해: 비보험 전체 0.1%
        else if(name==='신인해'){
            niIncentive=Math.round(niTotal*0.001);
        }
        
        // 피부관리사 등 기존 건별 인센티브
        const perCaseItems=incentiveItems.filter(i=>i.type==='perCase'&&i.employees?.includes(emp.id));
        const empRecords=incentiveRecords.filter(r=>r.employeeId===emp.id&&r.yearMonth===ym);
        let perCaseIncentive=0;
        empRecords.forEach(r=>{
            const item=incentiveItems.find(i=>i.id===r.itemId);
            if(item&&item.type==='perCase')perCaseIncentive+=item.price||0;
        });
        
        const total=salesIncentive+japanIncentive+niIncentive+perCaseIncentive;
        if(total===0&&!['박보미','박지윤','김옥경','신인해'].includes(name)&&perCaseIncentive===0)return '';
        
        let detail2='';
        if(salesIncentive>0)detail2+=`매출1%: ${formatCurrency(salesIncentive)}`;
        if(japanIncentive>0)detail2+=(detail2?' + ':'')+ `일본인: ${formatCurrency(japanIncentive)}`;
        if(niIncentive>0)detail2+=`비보험: ${formatCurrency(niIncentive)}`;
        if(perCaseIncentive>0)detail2+=(detail2?' + ':'')+`건별: ${formatCurrency(perCaseIncentive)}`;
        
        return `<tr><td><strong>${emp.name}</strong></td><td>${roleLabels[emp.role]||emp.role}</td><td class="text-right">${formatCurrency(salesIncentive+niIncentive)}</td><td class="text-right">${formatCurrency(japanIncentive+perCaseIncentive)}</td><td class="text-right"><strong>${formatCurrency(total)}</strong><br><small style="color:#888">${detail2}</small></td></tr>`;
    }).filter(r=>r).join('')||'<tr><td colspan="5" class="text-center">직원 없음</td></tr>';
}

function renderSalary(){
    const ym=getYM();
    const detail=salesDetail[ym]||{};
    const staffSales=detail.staffSales||{};
    const japanStaffSales=detail.japanStaffSales||{};
    const rev=revenueData[ym]||{total:0,nonInsurance:0};
    const niTotal=rev.nonInsurance||0;
    const bomiNi=(staffSales['박보미']||{}).niAmount||0;
    const jiyoonNi=(staffSales['박지윤']||{}).niAmount||0;
    const okNiBase=Math.max(0,niTotal-bomiNi-jiyoonNi);
    const roleLabelsLocal={doctor:'원장',nurse:'간호사',coordinator:'코디네이터',marketing:'마케팅',manager:'실장',esthetician:'피부관리사'};
    
    // 사전급여대장 렌더링
    document.getElementById('prePayrollTable').innerHTML=employees.filter(e=>e.status==='active').map(emp=>{
        // OT 시간 계산
        const empAttendance=attendance.filter(a=>a.employeeId===emp.id&&a.date?.startsWith(ym));
        let otMinutes=0;
        empAttendance.forEach(a=>{
            if(a.checkOut){
                const [h,m]=(a.checkOut||'00:00').split(':').map(Number);
                if(h*60+m>18*60)otMinutes+=(h*60+m)-18*60;
            }
        });
        const empLunchOT=lunchOT.filter(ot=>ot.employeeId===emp.id&&ot.date?.startsWith(ym));
        otMinutes+=empLunchOT.reduce((sum,ot)=>sum+(ot.minutes||0),0);
        const otHours=(otMinutes/60).toFixed(1);
        const otPay=Math.round(otMinutes/60*(emp.hourly||12000)*1.5);
        
        // 인센티브 계산 (새 구조)
        const name=emp.matchName||emp.name;
        let incentiveAmount=0;
        
        // 박보미/박지윤: 담당매출 1% + 일본인 건당 1만원
        if(name==='박보미'||name==='박지윤'){
            const sd=staffSales[name]||{amount:0};
            incentiveAmount+=Math.round(sd.amount*0.01);
            const jpd=japanStaffSales[name]||{patients:0};
            incentiveAmount+=(jpd.patients||0)*10000;
        }
        // 김옥경: 비보험(박보미+박지윤제외) 0.9%
        else if(name==='김옥경'){
            incentiveAmount+=Math.round(okNiBase*0.009);
        }
        // 신인해: 비보험 전체 0.1%
        else if(name==='신인해'){
            incentiveAmount+=Math.round(niTotal*0.001);
        }
        
        // 피부관리사 등 건별 인센티브
        const empRecords=incentiveRecords.filter(r=>r.employeeId===emp.id&&r.yearMonth===ym);
        let incentiveCount=empRecords.length;
        empRecords.forEach(r=>{
            const item=incentiveItems.find(i=>i.id===r.itemId);
            if(item&&item.type==='perCase'){
                incentiveAmount+=item.price||0;
            }
        });
        
        return `<tr>
            <td><strong>${emp.name}</strong></td>
            <td>${roleLabelsLocal[emp.role]||emp.role}</td>
            <td>${emp.salary?emp.salary+'만원':'-'}</td>
            <td class="text-right">${otHours}H</td>
            <td class="text-right">${formatCurrency(otPay)}</td>
            <td class="text-right">${incentiveCount>0?incentiveCount+'건':'-'}</td>
            <td class="text-right">${formatCurrency(incentiveAmount)}</td>
        </tr>`;
    }).join('')||'<tr><td colspan="7" class="text-center">직원 없음</td></tr>';
}

// CRUD Operations - Expense
const fixedCategories=[
    {value:'임대료',label:'임대료/관리비'},
    {value:'공과금',label:'공과금(전기/가스/수도)'},
    {value:'장비리스',label:'장비리스/렌탈'},
    {value:'대출이자',label:'대출이자'},
    {value:'통신_인터넷',label:'인터넷'},
    {value:'통신_전화',label:'전화'},
    {value:'세무노무',label:'세무/노무'},
    {value:'보험료',label:'보험료'},
    {value:'청소비',label:'청소비'},
    {value:'수탁_폐기물',label:'수탁-폐기물'},
    {value:'수탁_검사',label:'수탁-검사'},
    {value:'정수기',label:'정수기'},
    {value:'보안_캡스',label:'보안(캡스)'},
    {value:'복리후생',label:'복리후생'},
    {value:'마케팅',label:'마케팅'},
    {value:'기타',label:'기타'}
];
const variableCategories=[
    {value:'의료소모품',label:'의료소모품'},
    {value:'미용소모품',label:'미용소모품'},
    {value:'사무용품',label:'사무/비품'},
    {value:'복리후생비',label:'복리후생비(식대/음료)'},
    {value:'접대비',label:'접대비'},
    {value:'차량유지비',label:'차량유지비'},
    {value:'교통비',label:'교통/주차'},
    {value:'시설보수',label:'시설/보수'},
    {value:'장비수리',label:'장비수리'},
    {value:'인테리어',label:'인테리어'},
    {value:'교육비',label:'교육/세미나'},
    {value:'공과금',label:'공과금'},
    {value:'세금',label:'세금'},
    {value:'리스료',label:'리스료'},
    {value:'소모품비',label:'일반소모품'},
    {value:'금융/이체',label:'금융/이체'},
    {value:'기타',label:'기타'}
];
function openEmployeeModal(id=null){
    document.getElementById('employeeModalTitle').textContent=id?'직원 수정':'직원 등록';
    document.getElementById('empEditId').value=id||'';
    document.getElementById('empName').value='';
    document.getElementById('empMatchName').value='';
    document.getElementById('empRole').value='staff';
    document.getElementById('empJoinDate').value='';
    document.getElementById('empSalary').value='';
    document.getElementById('empHourly').value='12000';
    document.getElementById('empBirthday').value='';
    document.getElementById('empStatus').value='active';
    document.getElementById('empAnnualLeave').value='';
    document.getElementById('empUsedLeave').value='0';
    document.getElementById('autoAnnualLeave').textContent='0';
    document.getElementById('empId').value='';
    // 탭 체크박스 초기화
    document.querySelectorAll('.empTab').forEach(cb=>cb.checked=true);
    
    if(id){
        const emp=employees.find(e=>e.id===id);
        if(emp){
            document.getElementById('empName').value=emp.name||'';
            document.getElementById('empMatchName').value=emp.matchName||'';
            document.getElementById('empRole').value=emp.role||'staff';
            document.getElementById('empJoinDate').value=emp.joinDate||'';
            document.getElementById('empSalary').value=emp.salary||'';
            document.getElementById('empHourly').value=emp.hourly||12000;
            document.getElementById('empBirthday').value=emp.birthday||'';
            document.getElementById('empStatus').value=emp.status||'active';
            document.getElementById('empAnnualLeave').value=emp.annualLeave||'';
            document.getElementById('empUsedLeave').value=emp.usedLeave||0;
            document.getElementById('empId').value=emp.id;
            // 법정 연차 자동계산 표시
            const autoLeave=calculateLegalAnnualLeave(emp.joinDate);
            document.getElementById('autoAnnualLeave').textContent=autoLeave;
            // 탭 선택 복원
            if(emp.visibleTabs&&emp.visibleTabs.length>0){
                // 명시적으로 저장된 탭이 있으면, 먼저 모두 해제 후 저장된 것만 체크
                document.querySelectorAll('.empTab').forEach(cb=>cb.checked=false);
                emp.visibleTabs.forEach(tab=>{
                    const cb=document.querySelector(`.empTab[data-tab="${tab}"]`);
                    if(cb)cb.checked=true;
                });
            }
            // visibleTabs가 null이거나 없으면 기본값(모두 체크) 유지
        }
    }
    openModal('employeeModal');
}

// 법정 연차 자동계산 (근로기준법)
function calculateLegalAnnualLeave(joinDate){
    if(!joinDate)return 0;
    const join=new Date(joinDate);
    const now=new Date();
    const diffMs=now-join;
    const diffDays=Math.floor(diffMs/(1000*60*60*24));
    const years=Math.floor(diffDays/365);
    
    if(years<1){
        // 1년 미만: 1개월 개근 시 1일 (최대 11일)
        const months=Math.floor(diffDays/30);
        return Math.min(months,11);
    }else{
        // 1년 이상: 15일 + 2년마다 1일 추가 (최대 25일)
        const extraDays=Math.floor((years-1)/2);
        return Math.min(15+extraDays,25);
    }
}

// 입사일 변경 시 법정 연차 자동계산
document.getElementById('empJoinDate')?.addEventListener('change',function(){
    const autoLeave=calculateLegalAnnualLeave(this.value);
    document.getElementById('autoAnnualLeave').textContent=autoLeave;
});

// 연봉 입력 시 시급 자동 계산 (연봉 ÷ 2508시간)
document.getElementById('empSalary')?.addEventListener('input',function(){
    const salary=parseInt(this.value)||0;
    const hourly=salary>0?Math.round(salary*10000/2508):12000;
    document.getElementById('empHourly').value=hourly;
});
function editEmployee(id){openEmployeeModal(id);}
async function saveEmployee(){
    const editId=document.getElementById('empEditId').value;
    const name=document.getElementById('empName').value.trim();
    const joinDate=document.getElementById('empJoinDate').value;
    if(!name||!joinDate){alert('이름과 입사일은 필수입니다.');return;}
    
    // ID 결정: 수정 시 기존 ID, 신규 시 이름을 ID로 사용
    let empId=editId||name;
    
    // 신규 등록 시 이름 중복 체크
    if(!editId){
        const existing=await db.collection('employees').doc(name).get();
        if(existing.exists){
            alert('이미 등록된 이름입니다: '+name);
            return;
        }
    }
    
    const salary=parseInt(document.getElementById('empSalary').value)||0;
    const annualLeaveInput=document.getElementById('empAnnualLeave').value;
    const annualLeave=annualLeaveInput?parseInt(annualLeaveInput):null; // null이면 자동계산 사용
    const usedLeave=parseInt(document.getElementById('empUsedLeave').value)||0;
    
    // 탭 선택 수집
    const selectedTabs=[];
    const allTabs=document.querySelectorAll('.empTab');
    document.querySelectorAll('.empTab:checked').forEach(cb=>{
        selectedTabs.push(cb.getAttribute('data-tab'));
    });
    
    // 모든 탭이 체크되어 있으면 null (기본값, 모든 탭 표시)
    // 일부만 체크되어 있으면 선택된 탭만 배열로 저장
    const visibleTabsValue=selectedTabs.length===allTabs.length?null:selectedTabs;
    
    // isIncentiveTarget: 인센티브 탭이 포함되어 있는지 자동 판단
    const isIncentiveTarget=selectedTabs.includes('incentive');
    
    const data={
        name,
        matchName:document.getElementById('empMatchName').value.trim(),
        role:document.getElementById('empRole').value,
        joinDate,
        salary:salary,
        hourly:parseInt(document.getElementById('empHourly').value)||12000,
        birthday:document.getElementById('empBirthday').value,
        status:document.getElementById('empStatus').value,
        annualLeave:annualLeave,
        usedLeave:usedLeave,
        isIncentiveTarget:isIncentiveTarget, // 인센티브 탭 체크 여부로 자동 설정
        visibleTabs:visibleTabsValue // null=모든 탭 표시(기본값), 배열=선택된 탭만 표시
    };
    try{
        await db.collection('employees').doc(empId).set(data,{merge:true});
        closeModal('employeeModal');
        await loadEmployees();
        renderAll();
        alert('직원 정보가 저장되었습니다.');
    }catch(e){alert('저장 실패: '+e.message);}
}
async function deleteEmployee(id){
    if(!confirm('정말 삭제하시겠습니까?'))return;
    try{
        await db.collection('employees').doc(id).delete();
        await loadEmployees();
        renderAll();
    }catch(e){alert('삭제 실패: '+e.message);}
}

// CRUD Operations - Lunch OT
function openOTModal(){
    document.getElementById('otDate').value=new Date().toISOString().split('T')[0];
    document.getElementById('otMinutes').value='30';document.getElementById('otReason').value='';
    openModal('otModal');
}
async function saveLunchOT(){
    const date=document.getElementById('otDate').value;
    const employeeId=document.getElementById('otEmployee').value;
    const minutes=parseInt(document.getElementById('otMinutes').value)||0;
    const reason=document.getElementById('otReason').value.trim();
    if(!date||!employeeId||!minutes){alert('날짜, 직원, 시간을 입력해주세요.');return;}
    try{await db.collection('lunchOT').add({date,employeeId,minutes,reason,createdAt:firebase.firestore.FieldValue.serverTimestamp()});closeModal('otModal');await loadLunchOT();renderOvertime();}catch(e){alert('저장 실패: '+e.message);}
}
async function deleteLunchOT(id){if(!confirm('정말 삭제하시겠습니까?'))return;try{await db.collection('lunchOT').doc(id).delete();await loadLunchOT();renderOvertime();}catch(e){alert('삭제 실패: '+e.message);}}

// CRUD Operations - Incentive Items
function toggleIncItemFields(){
    const type=document.getElementById('incItemType').value;
    document.getElementById('perCaseFields').style.display=type==='perCase'?'block':'none';
    document.getElementById('salesPercentFields').style.display=type==='salesPercent'?'block':'none';
    document.getElementById('japanSalesFields').style.display=type==='japanSales'?'block':'none';
}

function openIncentiveItemModal(id=null){
    document.getElementById('incentiveItemModalTitle').textContent=id?'인센티브 항목 수정':'인센티브 항목 추가';
    document.getElementById('incItemEditId').value=id||'';
    document.getElementById('incItemName').value='';
    document.getElementById('incItemType').value='perCase';
    document.getElementById('incItemPrice').value='50000';
    document.getElementById('incItemPercent').value='1';
    document.getElementById('incItemSalesPercent').value='1';
    toggleIncItemFields();
    const selectedEmps=id?incentiveItems.find(i=>i.id===id)?.employees||[]:[];
    const container=document.getElementById('incItemEmployees');
    container.innerHTML=employees.filter(e=>e.status==='active').map(e=>`<label style="display:block;padding:.4rem 0;cursor:pointer"><input type="checkbox" name="incEmp" value="${e.id}" ${selectedEmps.includes(e.id)?'checked':''}> ${e.name} (${roleLabels[e.role]||e.role})</label>`).join('')||'<div style="color:var(--text-muted)">등록된 직원 없음</div>';
    if(id){const item=incentiveItems.find(i=>i.id===id);if(item){
        document.getElementById('incItemName').value=item.name||'';
        document.getElementById('incItemType').value=item.type||'perCase';
        document.getElementById('incItemPrice').value=item.price||50000;
        document.getElementById('incItemPercent').value=item.percent||1;
        document.getElementById('incItemSalesPercent').value=item.salesPercent||1;
        toggleIncItemFields();
    }}
    openModal('incentiveItemModal');
}
async function saveIncentiveItem(){
    const editId=document.getElementById('incItemEditId').value;
    const name=document.getElementById('incItemName').value.trim();
    const type=document.getElementById('incItemType').value;
    const price=parseInt(document.getElementById('incItemPrice').value)||0;
    const percent=parseFloat(document.getElementById('incItemPercent').value)||1;
    const salesPercent=parseFloat(document.getElementById('incItemSalesPercent').value)||1;
    const selectedEmps=Array.from(document.querySelectorAll('input[name="incEmp"]:checked')).map(cb=>cb.value);
    if(!name){alert('항목명을 입력해주세요.');return;}
    const data={name,type,employees:selectedEmps};
    if(type==='perCase'){
        data.price=price;
    }else if(type==='salesPercent'){
        data.salesPercent=salesPercent;
    }else if(type==='japanSales'){
        data.percent=percent;
    }
    try{
        if(editId){await db.collection('incentiveItems').doc(editId).update(data);}
        else{await db.collection('incentiveItems').add(data);}
        closeModal('incentiveItemModal');await loadIncentiveItems();renderIncentiveItems();renderIncentiveSummary();
    }catch(e){alert('저장 실패: '+e.message);}
}
function editIncentiveItem(id){openIncentiveItemModal(id);}
async function deleteIncentiveItem(id){if(!confirm('정말 삭제하시겠습니까?'))return;try{await db.collection('incentiveItems').doc(id).delete();await loadIncentiveItems();renderIncentiveItems();renderIncentiveSummary();}catch(e){alert('삭제 실패: '+e.message);}}

// File Upload
const uploadZone=document.getElementById('uploadZone');
uploadZone.addEventListener('click',()=>document.getElementById('fileInput').click());
uploadZone.addEventListener('dragover',e=>{e.preventDefault();uploadZone.style.borderColor='var(--accent-gold)';});
uploadZone.addEventListener('dragleave',()=>{uploadZone.style.borderColor='var(--border-color)';});
uploadZone.addEventListener('drop',e=>{e.preventDefault();uploadZone.style.borderColor='var(--border-color)';if(e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);});
function exportPrePayroll(){
    const ym=getYM();
    const detail=salesDetail[ym]||{};
    const japanStaffSales=detail.japanStaffSales||{};
    const roleLabelsLocal={doctor:'원장',nurse:'간호사',coordinator:'코디네이터',marketing:'마케팅',manager:'실장',esthetician:'피부관리사'};
    
    const rows=[['직원','직급','연봉(만원)','시급','OT시간(H)','예상OT수당','인센티브실적(건)','예상인센티브']];
    
    employees.filter(e=>e.status==='active').forEach(emp=>{
        // OT 계산
        const empAttendance=attendance.filter(a=>a.employeeId===emp.id&&a.date?.startsWith(ym));
        let otMinutes=0;
        empAttendance.forEach(a=>{
            if(a.checkOut){
                const [h,m]=(a.checkOut||'00:00').split(':').map(Number);
                if(h*60+m>18*60)otMinutes+=(h*60+m)-18*60;
            }
        });
        const empLunchOT=lunchOT.filter(ot=>ot.employeeId===emp.id&&ot.date?.startsWith(ym));
        otMinutes+=empLunchOT.reduce((sum,ot)=>sum+(ot.minutes||0),0);
        const otHours=(otMinutes/60).toFixed(1);
        const otPay=Math.round(otMinutes/60*(emp.hourly||12000)*1.5);
        
        // 인센티브 계산
        const empRecords=incentiveRecords.filter(r=>r.employeeId===emp.id&&r.yearMonth===ym);
        let incentiveCount=empRecords.length;
        let incentiveAmount=0;
        empRecords.forEach(r=>{
            const item=incentiveItems.find(i=>i.id===r.itemId);
            if(item&&item.type!=='japanSales'){
                incentiveAmount+=item.price||0;
            }
        });
        // 일본인 매출 인센티브
        const japanItems=incentiveItems.filter(i=>i.type==='japanSales'&&i.employees?.includes(emp.id));
        japanItems.forEach(item=>{
            if(emp.matchName&&japanStaffSales[emp.matchName]){
                incentiveAmount+=Math.round(japanStaffSales[emp.matchName]*(item.percent||1)/100);
            }
        });
        
        rows.push([
            emp.name,
            roleLabelsLocal[emp.role]||emp.role,
            emp.salary||0,
            emp.hourly||12000,
            otHours,
            otPay,
            incentiveCount,
            incentiveAmount
        ]);
    });
    
    const ws=XLSX.utils.aoa_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'사전급여대장');
    XLSX.writeFile(wb,'사전급여대장_'+ym+'_노무사전달용.xlsx');
}

// Staff App Settings
async function loadStaffSettings(){
    try{
        const doc=await db.collection('settings').doc('staff').get();
        if(doc.exists){
            const data=doc.data();
            document.getElementById('autoLogoutMinutes').value=data.autoLogoutMinutes||10;
        }
    }catch(e){console.error('설정 로드 오류:',e);}
}

async function saveStaffSettings(){
    const autoLogoutMinutes=parseInt(document.getElementById('autoLogoutMinutes').value)||10;
    try{
        await db.collection('settings').doc('staff').set({
            autoLogoutMinutes,
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        },{merge:true});
        alert('설정이 저장되었습니다.\n자동 로그아웃: '+autoLogoutMinutes+'분');
    }catch(e){alert('설정 저장 실패: '+e.message);}
}

// Initialize
// initApp은 firebase-config.js에 정의됨

// ==========================================
// 연차 관리 기능
// ==========================================

// 2026년 황금연휴 & 샌드위치 휴일 데이터
const goldenHolidays2026 = [
    { month: '1월', name: '신정 연휴', dates: '1.1(목)~1.4(일)', tip: '1/2(금) 연차 → 4일 연휴', type: 'sandwich', days: 4 },
    { month: '2월', name: '설날 연휴', dates: '2.14(토)~2.18(수)', tip: '2/19(목),20(금) 연차 → 9일 연휴 가능', type: 'golden', days: 5 },
    { month: '3월', name: '삼일절 연휴', dates: '3.1(일)~3.2(월)', tip: '대체휴일 적용, 3일 연휴', type: 'golden', days: 3 },
    { month: '5월', name: '어린이날 연휴', dates: '5.1(금)~5.5(화)', tip: '근로자의날+어린이날, 5/4(월) 연차 → 5일', type: 'golden', days: 5 },
    { month: '5월', name: '부처님오신날', dates: '5.24(일)~5.25(월)', tip: '대체휴일 적용, 3일 연휴', type: 'golden', days: 3 },
    { month: '6월', name: '지방선거+현충일', dates: '6.3(수), 6.6(토)', tip: '6/4,5 연차 → 6일 연휴', type: 'sandwich', days: 6 },
    { month: '7월', name: '제헌절 (예정)', dates: '7.17(금)~7.19(일)', tip: '공휴일 재지정 시 3일 연휴', type: 'golden', days: 3 },
    { month: '8월', name: '광복절 연휴', dates: '8.15(토)~8.17(월)', tip: '대체휴일 적용, 3일 연휴', type: 'golden', days: 3 },
    { month: '9월', name: '추석 연휴', dates: '9.24(목)~9.27(일)', tip: '9/28(월) 연차 → 5일 연휴', type: 'golden', days: 4 },
    { month: '10월', name: '개천절~한글날', dates: '10.3(토)~10.11(일)', tip: '10/6~8 연차 3일 → 9일 대연휴!', type: 'golden', days: 9 },
    { month: '12월', name: '성탄절 연휴', dates: '12.25(금)~12.27(일)', tip: '3일 연휴', type: 'golden', days: 3 }
];

function renderLeaveManagement(){
    renderGoldenHolidays();
    renderLeaveStatus();
    renderPendingLeaves();
    renderApprovedLeaves();
}

function renderGoldenHolidays(){
    const container = document.getElementById('goldenHolidayGrid');
    if(!container) return;
    
    container.innerHTML = goldenHolidays2026.map(h => `
        <div class="holiday-card ${h.type}">
            <span class="holiday-badge ${h.type}">${h.type==='golden'?'황금연휴':'샌드위치'}</span>
            <div class="holiday-month">${h.month}</div>
            <div class="holiday-name">${h.name}</div>
            <div class="holiday-dates">📅 ${h.dates}</div>
            <div class="holiday-tip">💡 ${h.tip}</div>
        </div>
    `).join('');
}

function renderLeaveStatus(){
    const container = document.getElementById('leaveStatusTable');
    if(!container) return;
    
    const year = new Date().getFullYear().toString();
    const roleLabels={doctor:'원장',nurse:'간호사',coordinator:'코디네이터',marketing:'마케팅',manager:'실장',esthetician:'피부관리사'};
    
    container.innerHTML = employees.filter(e=>e.status==='active').map(emp => {
        const totalLeave = emp.annualLeave || calculateLegalAnnualLeave(emp.joinDate);
        const usedLeave = getUsedLeave(emp.id);
        const remainLeave = Math.max(0, totalLeave - usedLeave);
        
        // 사용 내역 요약
        const usedDates = leaveRequests
            .filter(r => r.employeeId === emp.id && r.status === 'approved' && r.dates?.some(d => d.startsWith(year)))
            .flatMap(r => r.dates?.filter(d => d.startsWith(year)) || [])
            .sort()
            .slice(0, 5);
        const usedSummary = usedDates.length > 0 
            ? usedDates.map(d => d.slice(5)).join(', ') + (usedDates.length < usedLeave ? '...' : '')
            : '-';
        
        return `<tr>
            <td><strong>${emp.name}</strong> <span class="badge badge-purple">${roleLabels[emp.role]||''}</span></td>
            <td class="text-center">${totalLeave}일</td>
            <td class="text-center">${usedLeave}일</td>
            <td class="text-center"><strong style="color:${remainLeave<=2?'var(--accent-red)':remainLeave<=5?'var(--accent-orange)':'var(--accent-green)'}">${remainLeave}일</strong></td>
            <td style="font-size:.8rem;color:var(--text-secondary)">${usedSummary}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="text-center">직원이 없습니다</td></tr>';
}

function renderPendingLeaves(){
    const container = document.getElementById('pendingLeaveTable');
    const countBadge = document.getElementById('pendingLeaveCount');
    if(!container) return;
    
    const pending = leaveRequests.filter(r => r.status === 'pending');
    if(countBadge) countBadge.textContent = pending.length;
    
    if(pending.length === 0){
        container.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">승인 대기 중인 연차가 없습니다</td></tr>';
        return;
    }
    
    container.innerHTML = pending.map(r => {
        const emp = employees.find(e => e.id === r.employeeId);
        const dates = r.dates?.join(', ') || '-';
        const createdAt = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('ko-KR') : '-';
        
        // 황금연휴 체크
        const isGoldenPeriod = r.dates?.some(d => {
            const month = parseInt(d.split('-')[1]);
            return [2,5,9,10].includes(month); // 설,어린이날,추석,개천절~한글날
        });
        
        return `<tr style="${isGoldenPeriod?'background:#fff9f0':''}">
            <td>${createdAt}</td>
            <td><strong>${emp?.name || r.employeeId}</strong></td>
            <td><span class="badge badge-blue">${r.type || '연차'}</span></td>
            <td>${dates} ${isGoldenPeriod?'<span class="badge badge-gold">황금연휴</span>':''}</td>
            <td style="font-size:.85rem">${r.reason || '-'}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="approveLeave('${r.id}')">승인</button>
                <button class="btn btn-sm btn-danger" onclick="rejectLeave('${r.id}')">반려</button>
            </td>
        </tr>`;
    }).join('');
}

function renderApprovedLeaves(){
    const container = document.getElementById('approvedLeaveTable');
    if(!container) return;
    
    const year = document.getElementById('leaveYearFilter')?.value || new Date().getFullYear().toString();
    const empFilter = document.getElementById('leaveEmployeeFilter')?.value || 'all';
    
    let approved = leaveRequests.filter(r => 
        r.status === 'approved' && 
        r.dates?.some(d => d.startsWith(year))
    );
    
    if(empFilter !== 'all'){
        approved = approved.filter(r => r.employeeId === empFilter);
    }
    
    // 날짜순 정렬
    approved.sort((a, b) => {
        const dateA = a.dates?.[0] || '';
        const dateB = b.dates?.[0] || '';
        return dateA.localeCompare(dateB);
    });
    
    if(approved.length === 0){
        container.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">승인된 연차가 없습니다</td></tr>';
        return;
    }
    
    container.innerHTML = approved.map(r => {
        const emp = employees.find(e => e.id === r.employeeId);
        const dates = r.dates?.filter(d => d.startsWith(year)).join(', ') || '-';
        const approvedAt = r.approvedAt?.toDate ? r.approvedAt.toDate().toLocaleDateString('ko-KR') : '-';
        
        return `<tr>
            <td><strong>${emp?.name || r.employeeId}</strong></td>
            <td><span class="badge badge-blue">${r.type || '연차'}</span></td>
            <td>${dates}</td>
            <td style="font-size:.85rem">${r.reason || '-'}</td>
            <td>${approvedAt}</td>
            <td><button class="btn btn-sm btn-danger" onclick="cancelLeave('${r.id}')">취소</button></td>
        </tr>`;
    }).join('');
}

async function approveLeave(id){
    if(!confirm('이 연차 신청을 승인하시겠습니까?')) return;
    try{
        await db.collection('leaveRequests').doc(id).update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadLeaveRequests();
        renderLeaveManagement();
        renderEmployees();
        alert('승인되었습니다.');
    }catch(e){
        alert('승인 실패: ' + e.message);
    }
}

async function rejectLeave(id){
    const reason = prompt('반려 사유를 입력하세요:');
    if(reason === null) return;
    try{
        await db.collection('leaveRequests').doc(id).update({
            status: 'rejected',
            rejectReason: reason,
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadLeaveRequests();
        renderLeaveManagement();
        alert('반려되었습니다.');
    }catch(e){
        alert('반려 실패: ' + e.message);
    }
}

async function cancelLeave(id){
    if(!confirm('이 승인된 연차를 취소하시겠습니까?')) return;
    try{
        await db.collection('leaveRequests').doc(id).update({
            status: 'cancelled',
            cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadLeaveRequests();
        renderLeaveManagement();
        renderEmployees();
        alert('취소되었습니다.');
    }catch(e){
        alert('취소 실패: ' + e.message);
    }
}

checkAuth();
