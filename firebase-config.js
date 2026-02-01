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
    const join=new Date(joinDate);
    const now=new Date();
    const years=(now-join)/(365.25*24*60*60*1000);
    return Math.max(0,years);
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

// ===== Auth =====
const ADMIN_ID='adminhighgo';
const ADMIN_PW='gndls-asdk!jd-As';

function handleAdminLogin(){
    const id=document.getElementById('adminId').value.trim();
    const pw=document.getElementById('adminPw').value;
    document.getElementById('loginError').textContent='';
    if(id===ADMIN_ID&&pw===ADMIN_PW){
        localStorage.setItem('lumi_admin_auth','true');
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appContainer').classList.add('active');
        initApp();
    }else{
        document.getElementById('loginError').textContent='ID 또는 비밀번호가 올바르지 않습니다.';
    }
}
function logout(){localStorage.removeItem('lumi_admin_auth');location.reload();}
function checkAuth(){
    if(localStorage.getItem('lumi_admin_auth')==='true'){
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appContainer').classList.add('active');
        initApp();
        return;
    }
    document.getElementById('loginScreen').classList.remove('hidden');
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
            typeof loadAuditRecords==='function'?loadAuditRecords():Promise.resolve()
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
    if(typeof renderIncentiveSummary==='function')renderIncentiveSummary();
    if(typeof renderSalary==='function')renderSalary();
    if(typeof renderLeaveManagement==='function')renderLeaveManagement();
    // 재고
    if(typeof renderInventory==='function')renderInventory();
    if(typeof renderRecipes==='function')renderRecipes();
    if(typeof renderAuditReport==='function')renderAuditReport();
    // 손익
    if(typeof renderPLStatement==='function')renderPLStatement();
}

// ===== Init =====
async function initApp(){
    initMonthSelector();
    initNavigation();
    await loadAllData(); // 재고/레시피 선 로딩 후 나머지 로드 후 렌더
    if(typeof initTaxDropZone==='function')initTaxDropZone();
    if(typeof loadStaffSettings==='function')loadStaffSettings();
}

// Auto-check auth on load
document.addEventListener('DOMContentLoaded',checkAuth);
