// ============================================================
// expense-categories.js
// 지출 카테고리 Firestore 관리
// Firestore: config/expenseCategories { items: [...] }
// item: { id, name, group: 'fixed'|'variable'|'payroll'|'tax', order }
// ============================================================

// ── Fallback (Firestore 로드 실패 시) ─────────────────────
const DEFAULT_EXPENSE_CATEGORIES = [
  // 고정비
  { id:'임대료',       name:'임대료/관리비',        group:'fixed' },
  { id:'공과금',       name:'공과금(전기/가스/수도)', group:'fixed' },
  { id:'장비리스',     name:'장비리스/렌탈',          group:'fixed' },
  { id:'대출이자',     name:'대출이자',               group:'fixed' },
  { id:'통신_인터넷',  name:'인터넷',                 group:'fixed' },
  { id:'통신_전화',    name:'전화',                   group:'fixed' },
  { id:'세무노무',     name:'세무/노무',               group:'fixed' },
  { id:'보험료',       name:'보험료',                 group:'fixed' },
  { id:'청소비',       name:'청소비',                 group:'fixed' },
  { id:'수탁_폐기물',  name:'수탁-폐기물',            group:'fixed' },
  { id:'수탁_검사',    name:'수탁-검사',              group:'fixed' },
  { id:'정수기',       name:'정수기',                 group:'fixed' },
  { id:'보안_캡스',    name:'보안(캡스)',              group:'fixed' },
  { id:'복리후생',     name:'복리후생',               group:'fixed' },
  { id:'마케팅',       name:'마케팅',                 group:'fixed' },
  { id:'기타고정',     name:'기타(고정)',              group:'fixed' },
  // 유동비
  { id:'의료소모품',   name:'의료소모품',             group:'variable' },
  { id:'미용소모품',   name:'미용소모품',             group:'variable' },
  { id:'사무용품',     name:'사무/비품',              group:'variable' },
  { id:'복리후생비',   name:'복리후생비(식대/음료)',   group:'variable' },
  { id:'접대비',       name:'접대비',                 group:'variable' },
  { id:'차량유지비',   name:'차량유지비',             group:'variable' },
  { id:'교통비',       name:'교통/주차',              group:'variable' },
  { id:'시설보수',     name:'시설/보수',              group:'variable' },
  { id:'장비수리',     name:'장비수리',               group:'variable' },
  { id:'인테리어',     name:'인테리어',               group:'variable' },
  { id:'교육비',       name:'교육/세미나',            group:'variable' },
  { id:'광고비',       name:'광고비',                 group:'variable' },
  { id:'루미컨설팅비', name:'루미컨설팅비',           group:'variable' },
  { id:'소모품비',     name:'일반소모품',             group:'variable' },
  { id:'금융/이체',    name:'금융/이체',              group:'variable' },
  { id:'환불',         name:'환불',                   group:'variable' },
  { id:'기타',         name:'기타',                   group:'variable' },
  // 인건비
  { id:'인건비',       name:'인건비(급여)',           group:'payroll' },
  // 세금
  { id:'세금',         name:'세금',                   group:'tax' },
];

// ── 런타임 상태 ──────────────────────────────────────────
let expenseCategories = [...DEFAULT_EXPENSE_CATEGORIES]; // Firestore 로드 전 fallback

// ── Firestore 로드 ────────────────────────────────────────
async function loadExpenseCategories() {
  try {
    const doc = await db.collection('config').doc('expenseCategories').get();
    if (doc.exists && doc.data().items && doc.data().items.length > 0) {
      expenseCategories = doc.data().items;
    } else {
      // 최초 실행: 기본값 저장
      await db.collection('config').doc('expenseCategories').set({ items: DEFAULT_EXPENSE_CATEGORIES });
      expenseCategories = [...DEFAULT_EXPENSE_CATEGORIES];
    }
  } catch (e) {
    console.warn('카테고리 로드 실패, 기본값 사용:', e);
    expenseCategories = [...DEFAULT_EXPENSE_CATEGORIES];
  }
  // hr-attendance.js 전역 배열 동기화 (기존 코드 호환)
  syncLegacyCategoryArrays();
}

// ── 기존 전역 배열 동기화 (expense.js 호환) ──────────────
function syncLegacyCategoryArrays() {
  if (typeof fixedCategories !== 'undefined') {
    fixedCategories.length = 0;
    getCategories('fixed').forEach(c => fixedCategories.push({ value: c.id, label: c.name }));
  }
  if (typeof variableCategories !== 'undefined') {
    variableCategories.length = 0;
    getCategories('variable').forEach(c => variableCategories.push({ value: c.id, label: c.name }));
  }
}

// ── 조회 헬퍼 ─────────────────────────────────────────────
function getCategories(group) {
  return expenseCategories.filter(c => c.group === group);
}

function getAllCategoryIds() {
  return expenseCategories.map(c => c.id);
}

function isCategoryFixed(catId) {
  const c = expenseCategories.find(x => x.id === catId);
  return c ? c.group === 'fixed' : false;
}

function getCategoryGroup(catId) {
  const c = expenseCategories.find(x => x.id === catId);
  return c ? c.group : 'variable';
}

// ── Firestore 저장 ────────────────────────────────────────
async function saveExpenseCategories() {
  await db.collection('config').doc('expenseCategories').set({ items: expenseCategories });
  syncLegacyCategoryArrays();
}

// ── 카테고리 추가 ─────────────────────────────────────────
async function addExpenseCategory(id, name, group) {
  if (!id || !name || !group) return;
  if (expenseCategories.find(c => c.id === id)) {
    alert('이미 존재하는 카테고리 ID입니다: ' + id);
    return;
  }
  expenseCategories.push({ id, name, group });
  await saveExpenseCategories();
  renderCategorySettings();
}

// ── 카테고리 수정 ─────────────────────────────────────────
async function updateExpenseCategory(id, newName, newGroup) {
  const cat = expenseCategories.find(c => c.id === id);
  if (!cat) return;
  cat.name = newName;
  cat.group = newGroup;
  await saveExpenseCategories();
  renderCategorySettings();
}

// ── 카테고리 삭제 ─────────────────────────────────────────
async function deleteExpenseCategory(id) {
  if (!confirm(`"${id}" 카테고리를 삭제하시겠습니까?\n기존 데이터의 카테고리는 변경되지 않습니다.`)) return;
  expenseCategories = expenseCategories.filter(c => c.id !== id);
  await saveExpenseCategories();
  renderCategorySettings();
}

// ── 순서 이동 ─────────────────────────────────────────────
async function moveCategoryUp(id) {
  const idx = expenseCategories.findIndex(c => c.id === id);
  if (idx <= 0) return;
  [expenseCategories[idx - 1], expenseCategories[idx]] = [expenseCategories[idx], expenseCategories[idx - 1]];
  await saveExpenseCategories();
  renderCategorySettings();
}

async function moveCategoryDown(id) {
  const idx = expenseCategories.findIndex(c => c.id === id);
  if (idx < 0 || idx >= expenseCategories.length - 1) return;
  [expenseCategories[idx], expenseCategories[idx + 1]] = [expenseCategories[idx + 1], expenseCategories[idx]];
  await saveExpenseCategories();
  renderCategorySettings();
}

// ── 설정 화면 렌더링 ──────────────────────────────────────
const GROUP_LABELS = { fixed: '🔵 고정비', variable: '🟠 유동비', payroll: '🟢 인건비', tax: '🟡 세금' };
const GROUP_COLORS = { fixed: '#1e3a5f', variable: '#7c3d0f', payroll: '#14532d', tax: '#713f12' };
const GROUP_BG    = { fixed: '#e8f0fe', variable: '#fff3e0', payroll: '#e8f5e9', tax: '#fffde7' };

function renderCategorySettings() {
  const container = document.getElementById('categorySettingsContainer');
  if (!container) return;

  const groups = ['fixed', 'variable', 'payroll', 'tax'];

  container.innerHTML = groups.map(group => {
    const items = expenseCategories.filter(c => c.group === group);
    return `
      <div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-weight:700;font-size:1rem">${GROUP_LABELS[group]}</span>
          <span style="font-size:.8rem;color:#888">${items.length}개</span>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          ${items.length === 0 ? '<div style="padding:12px 16px;color:#aaa;font-size:.85rem">항목 없음</div>' :
            items.map((cat, i) => `
              <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:${i%2===0?'#fff':'#fafafa'};border-bottom:1px solid #f3f4f6" id="catRow_${cat.id}">
                <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:.78rem;font-weight:600;background:${GROUP_BG[cat.group]};color:${GROUP_COLORS[cat.group]}">${GROUP_LABELS[cat.group].replace(/[🔵🟠🟢🟡] /,'')}</span>
                <span style="flex:1;font-size:.9rem" id="catName_${cat.id}">${cat.name}</span>
                <span style="font-size:.75rem;color:#aaa;margin-right:4px">${cat.id}</span>
                <button onclick="openEditCategoryModal('${cat.id}')" style="padding:3px 10px;font-size:.78rem;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer">수정</button>
                <button onclick="moveCategoryUp('${cat.id}')" style="padding:3px 8px;font-size:.78rem;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer" ${i===0?'disabled':''}>↑</button>
                <button onclick="moveCategoryDown('${cat.id}')" style="padding:3px 8px;font-size:.78rem;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer" ${i===items.length-1?'disabled':''}>↓</button>
                <button onclick="deleteExpenseCategory('${cat.id}')" style="padding:3px 10px;font-size:.78rem;border:1px solid #fca5a5;border-radius:4px;background:#fff5f5;color:#dc2626;cursor:pointer">삭제</button>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  }).join('');
}

// ── 추가 모달 열기 ────────────────────────────────────────
function openAddCategoryModal() {
  document.getElementById('catModalTitle').textContent = '카테고리 추가';
  document.getElementById('catEditId').value = '';
  document.getElementById('catId').value = '';
  document.getElementById('catId').disabled = false;
  document.getElementById('catName').value = '';
  document.getElementById('catGroup').value = 'variable';
  document.getElementById('categoryModal').style.display = 'flex';
}

// ── 수정 모달 열기 ────────────────────────────────────────
function openEditCategoryModal(id) {
  const cat = expenseCategories.find(c => c.id === id);
  if (!cat) return;
  document.getElementById('catModalTitle').textContent = '카테고리 수정';
  document.getElementById('catEditId').value = id;
  document.getElementById('catId').value = id;
  document.getElementById('catId').disabled = true; // ID는 변경 불가
  document.getElementById('catName').value = cat.name;
  document.getElementById('catGroup').value = cat.group;
  document.getElementById('categoryModal').style.display = 'flex';
}

// ── 모달 저장 ─────────────────────────────────────────────
async function saveCategoryModal() {
  const editId   = document.getElementById('catEditId').value;
  const id       = editId || document.getElementById('catId').value.trim();
  const name     = document.getElementById('catName').value.trim();
  const group    = document.getElementById('catGroup').value;
  if (!id || !name) { alert('카테고리 ID와 이름을 입력하세요.'); return; }
  if (editId) {
    await updateExpenseCategory(editId, name, group);
  } else {
    await addExpenseCategory(id, name, group);
  }
  document.getElementById('categoryModal').style.display = 'none';
}

// ── 드롭다운 빌드 헬퍼 (expense.js에서 호출) ─────────────
function buildExpenseCategoryDropdown(selectEl, type, selectedValue) {
  // type: 'fixed' | 'variable' | 'all'
  const groups = type === 'fixed' ? ['fixed']
               : type === 'variable' ? ['variable', 'payroll', 'tax']
               : ['fixed', 'variable', 'payroll', 'tax'];

  selectEl.innerHTML = groups.map(group => {
    const items = expenseCategories.filter(c => c.group === group);
    if (items.length === 0) return '';
    return `<optgroup label="${GROUP_LABELS[group]}">
      ${items.map(c => `<option value="${c.id}"${c.id === selectedValue ? ' selected' : ''}>${c.name}</option>`).join('')}
    </optgroup>`;
  }).join('');

  if (selectedValue) selectEl.value = selectedValue;
}
