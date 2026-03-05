/* ===== firebase-config.js - LUMI ERP v11 ===== */

// Firebase
const firebaseConfig={apiKey:"AIzaSyDnkKNXNnDVlcPd5Y1fl59YysdeEZi7uJU",authDomain:"lumiclinic-c1a95.firebaseapp.com",projectId:"lumiclinic-c1a95",storageBucket:"lumiclinic-c1a95.firebasestorage.app",messagingSenderId:"901456209944",appId:"1:901456209944:web:f287418cd0541f324d3b6d"};
firebase.initializeApp(firebaseConfig);
const db=firebase.firestore();

// ===== Global State =====
let currentYear=new Date().getFullYear();
let currentMonth=new Date().getMonth()+1;
let employees=[],attendance=[],revenueData={},salesDetail={};
let fixedExpenses=[],variableExpenses=[];
let incentiveItems=[],lunchOT=[],incentiveRecords=[],leaveRequests=[];
let vatTaxes=[],incomeTaxes=[],payrollData=[],withholdingTaxes=[];
let inventoryItems=[],recipes=[];
let mealAllRecords=[];
let revenueChart=null,compareChart=null;

const roleLabels={doctor:'원장',nurse:'간호사',coordinator:'코디네이터',marketing:'마케팅',manager:'실장',esthetician:'피부관리사'};

// 2024 비교 데이터
const data2024={1:{total:243000000,japan:48000000,japanVisitors:32},2:{total:258000000,japan:52000000,japanVisitors:35},3:{total:199000000,japan:38000000,japanVisitors:25},4:{total:210000000,japan:42000000,japanVisitors:28},5:{total:195000000,japan:39000000,japanVisitors:26},6:{total:183000000,japan:36000000,japanVisitors:24},7:{total:169000000,japan:34000000,japanVisitors:23},8:{total:168000000,japan:33000000,japanVisitors:22},9:{total:192000000,japan:38000000,japanVisitors:25},10:{total:186000000,japan:37000000,japanVisitors:25},11:{total:194000000,japan:39000000,japanVisitors:26},12:{total:200000000,japan:40000000,japanVisitors:27}};

// ===== Utility Functions =====
function formatCurrency(num){return num?'₩'+Math.round(num).toLocaleString():'₩0';}
function formatNumber(num){return num?Math.round(num).toLocaleString():'0';}
function getYM(){return `${currentYear}-${String(currentMonth).padStart(2,'0')}`;}
function togglePw(id,btn){const input=document.getElementById(id);if(input.type==='password'){input.type='text';btn.textContent='🙈';}else{input.type='password';btn.textContent='👁';}}
function closeModal(id){document.getElementById(id).classList.remove('active');}
function openModal(id){document.getElementById(id).classList.add('active');}

function generateEmployeeId(name,joinDate){
    const initials=getKoreanInitials(name);
    const dateStr=joinDate.replace(/-/g,'').slice(2);
    return `EMP-${initials}${dateStr}`;
}
function getKoreanInitials(name){
    const initials=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    let result='';
    for(let i=0;i<name.length;i++){
        const code=name.charCodeAt(i)-0xAC00;
        if(code>=0&&code<=11171){result+=initials[Math.floor(code/588)];}
    }
    return result;
}
function getYearsOfService(joinDate){
    if(!joinDate)return'-';
    const join=new Date(joinDate);
    const now=new Date();
    let years=now.getFullYear()-join.getFullYear();
    let months=now.getMonth()-join.getMonth();
    if(now.getDate()<join.getDate())months--;
    if(months<0){years--;months+=12;}
    if(years<0)return'-';
    if(years===0)return months+'개월';
    if(months===0)return years+'년';
    return years+'년 '+months+'개월';
}
function getAge(birthday){
    if(!birthday)return'-';
    const birth=new Date(birthday);
    const now=new Date();
    let age=now.getFullYear()-birth.getFullYear();
    const m=now.getMonth()-birth.getMonth();
    if(m<0||(m===0&&now.getDate()<birth.getDate()))age--;
    return age+'세';
}
function formatBirthday(birthday){
    if(!birthday)return'-';
    const d=new Date(birthday);
    return `${d.getMonth()+1}/${d.getDate()}`;
}

// ===== Auth (다수 관리자 지원) =====
const SUPER_ADMIN_ID='adminhighgo';
const DEFAULT_ADMIN_PW='gndls-asdk!jd-As';
const DEFAULT_STAFF_PW='lumi2026!';
let currentAdmin=null; // {id, name, role:'super'|'admin', ...}

async function handleAdminLogin(){
    const id=document.getElementById('adminId').value.trim().toLowerCase();
    const pw=document.getElementById('adminPw').value;
    document.getElementById('loginError').textContent='';
    if(!id||!pw){document.getElementById('loginError').textContent='ID와 비밀번호를 입력해주세요.';return;}
    
    // ── 1) 슈퍼 관리자 (기존 하드코딩 호환) ──
    if(id===SUPER_ADMIN_ID){
        let adminPw=DEFAULT_ADMIN_PW;
        try{
            const doc=await db.collection('config').doc('passwords').get();
            if(doc.exists&&doc.data().admin_pw) adminPw=doc.data().admin_pw;
        }catch(e){}
        if(pw!==adminPw){
            document.getElementById('loginError').textContent='ID 또는 비밀번호가 올바르지 않습니다.';
            return;
        }
        currentAdmin={id:SUPER_ADMIN_ID,name:'최고관리자',role:'super'};
        localStorage.setItem('lumi_admin_auth',JSON.stringify(currentAdmin));
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appContainer').classList.add('active');
        initApp();
        return;
    }
    
    // ── 2) 추가 관리자 (admins 컬렉션) ──
    try{
        let adminDoc=null;
        // ID로 직접 조회
        let d=await db.collection('admins').doc(id).get();
        if(d.exists) adminDoc=d;
        // 소문자 변환 시도
        if(!adminDoc){
            d=await db.collection('admins').doc(id.toLowerCase()).get();
            if(d.exists) adminDoc=d;
        }
        if(!adminDoc){
            document.getElementById('loginError').textContent='ID 또는 비밀번호가 올바르지 않습니다.';
            return;
        }
        const data=adminDoc.data();
        if(data.status==='inactive'){
            document.getElementById('loginError').textContent='비활성화된 계정입니다. 최고관리자에게 문의하세요.';
            return;
        }
        if(data.password!==pw){
            document.getElementById('loginError').textContent='ID 또는 비밀번호가 올바르지 않습니다.';
            return;
        }
        currentAdmin={id:adminDoc.id,name:data.name||adminDoc.id,role:data.role||'admin'};
        localStorage.setItem('lumi_admin_auth',JSON.stringify(currentAdmin));
        // 마지막 로그인 시각 기록
        db.collection('admins').doc(adminDoc.id).update({lastLogin:new Date().toISOString()}).catch(()=>{});
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appContainer').classList.add('active');
        initApp();
    }catch(e){
        console.error('로그인 오류:',e);
        document.getElementById('loginError').textContent='로그인 오류가 발생했습니다.';
    }
}
function logout(){localStorage.removeItem('lumi_admin_auth');currentAdmin=null;location.reload();}

// ===== Admin 자동 로그아웃 (미활동 감지) =====
let _adminLogoutTimer=null;
let _adminLogoutMs=30*60*1000; // 기본 30분

function initAdminAutoLogout(){
    // 설정 로드
    db.collection('settings').doc('admin').get().then(doc=>{
        if(doc.exists){
            const mins=doc.data().autoLogoutMinutes;
            if(typeof mins==='number'){
                _adminLogoutMs=mins*60*1000;
                const el=document.getElementById('adminAutoLogoutMinutes');
                if(el) el.value=mins;
            }
        }
        if(_adminLogoutMs>0) startAdminLogoutTimer();
    }).catch(()=>{});
    
    // 활동 감지 이벤트
    ['click','keydown','mousemove','touchstart','scroll'].forEach(evt=>{
        document.addEventListener(evt, resetAdminLogoutTimer, {passive:true});
    });
}

function startAdminLogoutTimer(){
    clearTimeout(_adminLogoutTimer);
    if(_adminLogoutMs<=0) return;
    _adminLogoutTimer=setTimeout(()=>{
        alert('장시간 미활동으로 자동 로그아웃됩니다.');
        logout();
    }, _adminLogoutMs);
}

function resetAdminLogoutTimer(){
    if(_adminLogoutMs>0) startAdminLogoutTimer();
}

async function saveAdminAutoLogout(){
    const val=parseInt(document.getElementById('adminAutoLogoutMinutes').value)||0;
    try{
        await db.collection('settings').doc('admin').set({autoLogoutMinutes:val},{merge:true});
        _adminLogoutMs=val*60*1000;
        if(val>0){
            startAdminLogoutTimer();
            document.getElementById('adminLogoutStatus').textContent='✅ '+val+'분 미활동 시 자동 로그아웃';
        }else{
            clearTimeout(_adminLogoutTimer);
            document.getElementById('adminLogoutStatus').textContent='✅ 자동 로그아웃 비활성화됨';
        }
    }catch(e){alert('저장 실패: '+e.message);}
}
function checkAuth(){
    const saved=localStorage.getItem('lumi_admin_auth');
    if(saved){
        try{
            const parsed=JSON.parse(saved);
            if(parsed&&parsed.id){
                currentAdmin=parsed;
                document.getElementById('loginScreen').classList.add('hidden');
                document.getElementById('appContainer').classList.add('active');
                initApp();
                return;
            }
        }catch(e){}
        // 기존 'true' 문자열 호환 (마이그레이션)
        if(saved==='true'){
            currentAdmin={id:SUPER_ADMIN_ID,name:'최고관리자',role:'super'};
            localStorage.setItem('lumi_admin_auth',JSON.stringify(currentAdmin));
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('appContainer').classList.add('active');
            initApp();
            return;
        }
    }
    document.getElementById('loginScreen').classList.remove('hidden');
}
function isSuperAdmin(){return currentAdmin?.role==='super'||currentAdmin?.id===SUPER_ADMIN_ID;}

// ===== 관리자 계정 관리 =====
let adminAccounts=[];
async function loadAdminAccounts(){
    try{
        const snap=await db.collection('admins').orderBy('createdAt','desc').get();
        adminAccounts=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){adminAccounts=[];console.error('관리자 목록 로드 실패:',e);}
    renderAdminAccounts();
}
function renderAdminAccounts(){
    const container=document.getElementById('adminAccountList');
    if(!container)return;
    // 슈퍼관리자만 관리 가능
    if(!isSuperAdmin()){
        container.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:1.5rem">최고관리자만 관리자 계정을 관리할 수 있습니다.</div>';
        return;
    }
    if(!adminAccounts.length){
        container.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:1.5rem">추가된 관리자 계정이 없습니다.</div>';
        return;
    }
    container.innerHTML=adminAccounts.map(a=>{
        const st=a.status==='inactive';
        const lastLogin=a.lastLogin?new Date(a.lastLogin).toLocaleString('ko'):'접속 이력 없음';
        const created=a.createdAt?new Date(a.createdAt).toLocaleDateString('ko'):'';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:${st?'#fafafa':'#fff'}">
            <div style="flex:1">
                <div style="display:flex;align-items:center;gap:8px">
                    <strong style="font-size:.95rem">${a.name||a.id}</strong>
                    <span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${st?'#eee;color:#999':'rgba(46,125,50,.1);color:#2e7d32'}">${st?'비활성':'활성'}</span>
                </div>
                <div style="font-size:.75rem;color:#888;margin-top:2px">
                    ID: ${a.id} · 등록: ${created} · 최근접속: ${lastLogin}
                </div>
            </div>
            <div style="display:flex;gap:6px">
                <button onclick="toggleAdminStatus('${a.id}',${st?'true':'false'})" style="padding:4px 10px;font-size:.75rem;border:1px solid ${st?'#2e7d32':'#f57f17'};color:${st?'#2e7d32':'#f57f17'};background:none;border-radius:4px;cursor:pointer">${st?'활성화':'비활성화'}</button>
                <button onclick="resetAdminPw('${a.id}')" style="padding:4px 10px;font-size:.75rem;border:1px solid #1976d2;color:#1976d2;background:none;border-radius:4px;cursor:pointer">PW초기화</button>
                <button onclick="deleteAdminAccount('${a.id}','${(a.name||a.id).replace(/'/g,"\\'")}')" style="padding:4px 10px;font-size:.75rem;border:1px solid var(--red);color:var(--red);background:none;border-radius:4px;cursor:pointer">삭제</button>
            </div>
        </div>`;
    }).join('');
}
async function addAdminAccount(){
    if(!isSuperAdmin()){alert('최고관리자만 관리자를 추가할 수 있습니다.');return;}
    const idEl=document.getElementById('newAdminId');
    const nameEl=document.getElementById('newAdminName');
    const pwEl=document.getElementById('newAdminPw');
    const msg=document.getElementById('adminAddMsg');
    const id=(idEl.value||'').trim().toLowerCase();
    const name=(nameEl.value||'').trim();
    const pw=(pwEl.value||'').trim();
    msg.textContent='';
    if(!id||!name||!pw){msg.textContent='모든 항목을 입력해주세요.';msg.style.color='var(--red)';return;}
    if(id.length<3){msg.textContent='ID는 3자 이상이어야 합니다.';msg.style.color='var(--red)';return;}
    if(pw.length<4){msg.textContent='비밀번호는 4자 이상이어야 합니다.';msg.style.color='var(--red)';return;}
    if(id===SUPER_ADMIN_ID){msg.textContent='이 ID는 사용할 수 없습니다.';msg.style.color='var(--red)';return;}
    // 중복 체크
    try{
        const exist=await db.collection('admins').doc(id).get();
        if(exist.exists){msg.textContent='이미 존재하는 ID입니다.';msg.style.color='var(--red)';return;}
    }catch(e){}
    try{
        await db.collection('admins').doc(id).set({
            name:name,
            password:pw,
            role:'admin',
            status:'active',
            createdAt:new Date().toISOString(),
            createdBy:currentAdmin?.id||SUPER_ADMIN_ID
        });
        idEl.value='';nameEl.value='';pwEl.value='';
        msg.textContent='✅ 관리자 추가 완료';msg.style.color='var(--green)';
        setTimeout(()=>{msg.textContent='';},2000);
        await loadAdminAccounts();
    }catch(e){msg.textContent='추가 실패: '+e.message;msg.style.color='var(--red)';}
}
async function toggleAdminStatus(id,isInactive){
    const newStatus=isInactive?'active':'inactive';
    const action=isInactive?'활성화':'비활성화';
    if(!confirm(`${id} 계정을 ${action}하시겠습니까?`))return;
    try{
        await db.collection('admins').doc(id).update({status:newStatus});
        await loadAdminAccounts();
    }catch(e){alert('변경 실패: '+e.message);}
}
async function resetAdminPw(id){
    const newPw=prompt(`${id} 계정의 새 비밀번호를 입력하세요 (4자 이상):`);
    if(!newPw||newPw.length<4){if(newPw!==null)alert('비밀번호는 4자 이상이어야 합니다.');return;}
    try{
        await db.collection('admins').doc(id).update({password:newPw});
        alert('✅ 비밀번호 초기화 완료');
    }catch(e){alert('변경 실패: '+e.message);}
}
async function deleteAdminAccount(id,name){
    if(!confirm(`"${name}" (${id}) 관리자 계정을 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`))return;
    try{
        await db.collection('admins').doc(id).delete();
        await loadAdminAccounts();
        alert('✅ 삭제 완료');
    }catch(e){alert('삭제 실패: '+e.message);}
}

// ===== 비밀번호 설정 관리 =====
async function loadConfigForSettings(){
    try{
        const doc=await db.collection('config').doc('passwords').get();
        if(doc.exists){
            const d=doc.data();
            const el1=document.getElementById('cfgAdminPw');
            const el2=document.getElementById('cfgStaffPw');
            if(el1)el1.value=d.admin_pw||'';
            if(el2)el2.value=d.staff_pw||'';
        }
    }catch(e){console.warn('config 로드 실패:',e);}
}
async function saveConfigPasswords(){
    const adminPw=document.getElementById('cfgAdminPw').value.trim();
    const staffPw=document.getElementById('cfgStaffPw').value.trim();
    const msg=document.getElementById('cfgPwMsg');
    if(!adminPw&&!staffPw){msg.innerHTML='<span style="color:var(--red)">하나 이상의 비밀번호를 입력해주세요.</span>';return;}
    const data={};
    if(adminPw) data.admin_pw=adminPw;
    if(staffPw) data.staff_pw=staffPw;
    data.updatedAt=new Date().toISOString();
    try{
        await db.collection('config').doc('passwords').set(data,{merge:true});
        msg.innerHTML='<span style="color:var(--green)">✅ 저장 완료</span>';
        setTimeout(()=>{msg.innerHTML='';},2000);
    }catch(e){msg.innerHTML='<span style="color:var(--red)">저장 실패: '+e.message+'</span>';}
}
async function saveStaffSettings(){
    const val=parseInt(document.getElementById('cfgAutoLogout')?.value)||10;
    try{
        await db.collection('settings').doc('staff').set({autoLogoutMinutes:val},{merge:true});
        alert('✅ Staff 설정 저장 완료');
    }catch(e){alert('저장 실패: '+e.message);}
}

// ===== Navigation =====
function initNavigation(){
    document.querySelectorAll('.nav-tab').forEach(tab=>{
        tab.addEventListener('click',()=>{
            document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
            const target=document.getElementById('tab-'+tab.dataset.tab);
            if(target)target.classList.add('active');
        });
    });
    document.querySelectorAll('.sub-tab').forEach(tab=>{
        tab.addEventListener('click',()=>{
            const parent=tab.closest('.tab-content');
            parent.querySelectorAll('.sub-tab').forEach(t=>t.classList.remove('active'));
            tab.classList.add('active');
            parent.querySelectorAll('.sub-content').forEach(c=>c.classList.remove('active'));
            const target=parent.querySelector('#sub-'+tab.dataset.sub);
            if(target)target.classList.add('active');
        });
    });
}

// ===== Month Selector =====
function initMonthSelector(){
    const ysel=document.getElementById('yearSelect');
    const msel=document.getElementById('monthSelect');
    ysel.innerHTML='';msel.innerHTML='';
    for(let y=2024;y<=2030;y++){const o=document.createElement('option');o.value=y;o.textContent=y;ysel.appendChild(o);}
    for(let m=1;m<=12;m++){const o=document.createElement('option');o.value=m;o.textContent=m;msel.appendChild(o);}
    ysel.value=currentYear;msel.value=currentMonth;
}
function changeMonth(delta){
    if(delta){
        currentMonth+=delta;
        if(currentMonth>12){currentMonth=1;currentYear++;}
        if(currentMonth<1){currentMonth=12;currentYear--;}
        document.getElementById('yearSelect').value=currentYear;
        document.getElementById('monthSelect').value=currentMonth;
    }else{
        currentYear=parseInt(document.getElementById('yearSelect').value);
        currentMonth=parseInt(document.getElementById('monthSelect').value);
    }
    renderAll();
}
function loadData(){changeMonth();}

// ===== Data Loading =====
async function loadAllData(){
    try{
        // Phase 1: 재고 & 레시피 먼저 로드 (원가 계산에 필요)
        await Promise.all([loadInventory(),loadRecipes()]);
        
        // Phase 2: 나머지 데이터 병렬 로드
        await Promise.all([
            loadEmployees(),loadRevenueData(),loadSalesDetailData(),
            loadExpenses(),loadAttendance(),loadIncentiveItems(),
            loadIncentiveRecords(),loadLeaveRequests(),loadLunchOT(),
            typeof loadAuditRecords==='function'?loadAuditRecords():Promise.resolve(),
            typeof loadPurchaseRequests==='function'?loadPurchaseRequests():Promise.resolve(),
            loadMealAllRecords(),
            typeof loadMonthlyIncentiveInput==='function'?loadMonthlyIncentiveInput():Promise.resolve()
        ]);
        
        renderAll();
    }catch(e){console.error('Data load error:',e);}
}

async function loadEmployees(){try{const s=await db.collection('employees').get();employees=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load employees:',e);}}
async function loadRevenueData(){try{const s=await db.collection('revenue').get();revenueData={};s.docs.forEach(d=>{revenueData[d.id]=d.data();});}catch(e){console.error('Load revenue:',e);}}
async function loadSalesDetailData(){try{const s=await db.collection('salesDetail').get();salesDetail={};s.docs.forEach(d=>{salesDetail[d.id]=d.data();});}catch(e){console.error('Load salesDetail:',e);}}
async function loadExpenses(){
    try{
        const [f,v]=await Promise.all([db.collection('fixedExpenses').get(),db.collection('variableExpenses').get()]);
        fixedExpenses=f.docs.map(d=>({id:d.id,...d.data()}));
        variableExpenses=v.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){console.error('Load expenses:',e);}
    try{
        const [vt,it,wt]=await Promise.all([db.collection('vatTaxes').get(),db.collection('incomeTaxes').get(),db.collection('withholdingTaxes').get()]);
        vatTaxes=vt.docs.map(d=>({id:d.id,...d.data()}));
        incomeTaxes=it.docs.map(d=>({id:d.id,...d.data()}));
        withholdingTaxes=wt.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){console.error('Load taxes:',e);}
}
async function loadAttendance(){
    try{
        const ym=getYM();
        const s=await db.collection('attendance').where('date','>=',ym+'-01').where('date','<=',ym+'-31').get();
        attendance=s.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){console.error('Load attendance:',e);}
}
async function loadIncentiveItems(){try{const s=await db.collection('incentiveItems').get();incentiveItems=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load incentiveItems:',e);}}
async function loadIncentiveRecords(){try{const s=await db.collection('incentiveRecords').get();incentiveRecords=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load incentiveRecords:',e);}}
async function loadLeaveRequests(){try{const s=await db.collection('leaveRequests').get();leaveRequests=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load leaveRequests:',e);}}
async function loadMealAllRecords(){try{const s=await db.collection('mealRecords').get();mealAllRecords=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load mealRecords:',e);}}
async function loadLunchOT(){
    try{
        const ym=getYM();
        const s=await db.collection('lunchOT').where('date','>=',ym+'-01').where('date','<=',ym+'-31').get();
        lunchOT=s.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){console.error('Load lunchOT:',e);}
}
async function loadInventory(){try{const s=await db.collection('inventory').get();inventoryItems=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load inventory:',e);}}
async function loadRecipes(){try{const s=await db.collection('recipes').get();recipes=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error('Load recipes:',e);}}

// ===== Render All =====
function renderAll(){
    // 대시보드 상단 카드
    if(typeof renderDashboardCards==='function')renderDashboardCards();
    // 매출
    if(typeof renderRevenueOverview==='function')renderRevenueOverview();
    if(typeof renderDoctorSales==='function')renderDoctorSales();
    if(typeof renderStaffSales==='function')renderStaffSales();
    if(typeof renderJapanSales==='function')renderJapanSales();
    if(typeof renderUploadHistory==='function')renderUploadHistory();
    if(typeof renderCharts==='function')renderCharts();
    // 지출
    if(typeof renderExpenses==='function')renderExpenses();
    if(typeof renderPayroll==='function')renderPayroll();
    if(typeof renderTaxes==='function')renderTaxes();
    if(typeof renderExpenseAnalysis==='function')renderExpenseAnalysis();
    if(typeof renderExpenseChart==='function')renderExpenseChart();
    // 직원
    if(typeof renderEmployees==='function')renderEmployees();
    if(typeof renderAttendance==='function')renderAttendance();
    if(typeof renderOvertime==='function')renderOvertime();
    if(typeof renderIncentiveItems==='function')renderIncentiveItems();
    if(typeof renderIncInputForm==='function')renderIncInputForm();
    if(typeof renderIncentiveSummary==='function')renderIncentiveSummary();
    if(typeof renderSalary==='function')renderSalary();
    if(typeof renderLeaveManagement==='function')renderLeaveManagement();
    // 재고
    if(typeof renderInventory==='function')renderInventory();
    if(typeof renderRecipes==='function')renderRecipes();
    if(typeof renderAuditReport==='function')renderAuditReport();
    if(typeof renderPurchaseRequests==='function')renderPurchaseRequests();
    // 손익
    if(typeof renderPLStatement==='function')renderPLStatement();
}

// ===== Init =====
async function initApp(){
    initMonthSelector();
    initNavigation();
    await loadAllData();
    if(typeof initTaxDropZone==='function')initTaxDropZone();
    if(typeof loadStaffSettings==='function')loadStaffSettings();
    if(typeof loadConfigForSettings==='function')loadConfigForSettings();
    if(typeof loadAdminAccounts==='function')loadAdminAccounts();
    if(typeof initDefaultLocations==='function')await initDefaultLocations();
    if(typeof loadLocations==='function')await loadLocations();
    updateAdminUI();
    initAdminAutoLogout();
}

// Auto-check auth on load
// 관리자 UI 업데이트 (로그인 사용자 표시)
function updateAdminUI(){
    const nameEl=document.getElementById('adminDisplayName');
    if(nameEl&&currentAdmin) nameEl.textContent=currentAdmin.name||currentAdmin.id;
    // 슈퍼관리자가 아니면 관리자 관리 섹션 숨기기
    const adminMgmt=document.getElementById('adminMgmtSection');
    if(adminMgmt) adminMgmt.style.display=isSuperAdmin()?'':'none';
}

document.addEventListener('DOMContentLoaded',checkAuth);
