/**
 * ESG Kanban Dashboard - Main Application Logic (V2 + Dept Fill-in + AI)
 * ====================================================================
 * V2 Features: 指標分類, 揭露平台, 負責部門列表, 填答建議_簡要, 年度差異說明
 * New Features: Login system, structured fill-in form, AI validation via Gemini,
 * auto-save drafts, Google Sheets write-back.
 */

// === Config ===
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxijoVvZzODBf0zQ6libnIhSEP_6_DZ9V3dIY1hScHOsWDl3iPnT1KHhSU_BsJrTZjc2/exec';

// === State ===
let allData = [];
let filteredData = [];
let currentView = 'kanban';
let currentModalItem = null;
let currentUser = { dept: '', name: '', apiKey: '' };
let submittedIndicators = new Set(); // track submitted indicators

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  loadSubmittedState();
  initLogin();
});

// === Login ===
function initLogin() {
  const saved = localStorage.getItem('esg_login');
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch {}
  }

  // Populate department dropdown from data (using V2 負責部門列表)
  const depts = new Set();
  allData.forEach(d => {
    const deptList = d['負責部門列表'];
    if (Array.isArray(deptList)) {
      deptList.forEach(dep => { if (dep) depts.add(dep); });
    } else {
      const dept = d['114_相關負責部門'];
      if (dept) depts.add(dept);
    }
  });

  const sel = document.getElementById('loginDept');
  [...depts].sort((a, b) => a.localeCompare(b, 'zh-TW')).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });

  if (currentUser.dept) sel.value = currentUser.dept;
  if (currentUser.name) document.getElementById('loginName').value = currentUser.name;
  if (currentUser.apiKey) document.getElementById('loginApiKey').value = currentUser.apiKey;

  if (currentUser.dept && currentUser.name) {
    enterDashboard();
  }
}

function handleLogin() {
  const dept = document.getElementById('loginDept').value;
  const name = document.getElementById('loginName').value.trim();
  const apiKey = document.getElementById('loginApiKey').value.trim();
  const errEl = document.getElementById('loginError');

  if (!dept) {
    errEl.textContent = '請選擇部門';
    errEl.classList.remove('hidden');
    return;
  }
  if (!name) {
    errEl.textContent = '請輸入姓名';
    errEl.classList.remove('hidden');
    return;
  }

  currentUser = { dept, name, apiKey };
  localStorage.setItem('esg_login', JSON.stringify(currentUser));
  enterDashboard();
}

function enterDashboard() {
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  document.getElementById('userInfo').innerHTML = `
    <span class="user-badge" title="點擊登出" onclick="handleLogout()">
      👤 ${currentUser.dept} — ${currentUser.name}
      ${currentUser.apiKey ? ' 🤖' : ''}
    </span>
  `;

  setupEventListeners();
  applyFilters();
}

function handleLogout() {
  if (!confirm('確定要登出嗎？')) return;
  localStorage.removeItem('esg_login');
  currentUser = { dept: '', name: '', apiKey: '' };
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

// === Data Loading ===
async function loadData() {
  try {
    const ts = Date.now();
    let resp;
    try {
      resp = await fetch(`suggestions_output_fixed.json?t=${ts}`);
      if (!resp.ok) throw new Error();
    } catch {
      try {
        resp = await fetch(`suggestions_output.json?t=${ts}`);
        if (!resp.ok) throw new Error();
      } catch {
        resp = await fetch(`data.json?t=${ts}`);
      }
    }
    allData = await resp.json();
    allData = allData.filter(d => d['編號'] && /^[ESG]-\d+$/.test(d['編號']));
    
    populateDeptFilter();
    populatePlatformFilter();
    renderStats();
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('kanbanBoard').innerHTML =
      '<div style="padding:40px;color:#f06565;">Failed to load data. 檢查檔案是否存在。</div>';
  }
}

function loadSubmittedState() {
  const saved = localStorage.getItem('esg_submitted');
  if (saved) {
    try { submittedIndicators = new Set(JSON.parse(saved)); } catch {}
  }
}

function saveSubmittedState() {
  localStorage.setItem('esg_submitted', JSON.stringify([...submittedIndicators]));
}

// === Filters ===
function populateDeptFilter() {
  const depts = new Set();
  allData.forEach(d => {
    if (Array.isArray(d['負責部門列表'])) {
      d['負責部門列表'].forEach(dep => { if (dep) depts.add(dep); });
    } else if (d['114_相關負責部門']) depts.add(d['114_相關負責部門']);
  });
  const sel = document.getElementById('filterDept');
  while (sel.options.length > 1) sel.remove(1);
  [...depts].sort().forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });
}

function populatePlatformFilter() {
  const sel = document.getElementById('filterPlatform');
  if (!sel) return;
  const staticOptions = ['年報', '永續報告書', '官網', '公開資訊觀測站', 'ESG數位平台', '其他'];
  while (sel.options.length > 1) sel.remove(1);
  staticOptions.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
}

function applyFilters() {
  const face = document.getElementById('filterFace').value;
  const statusFilter = document.getElementById('filterStatus').value; // from 指標分類
  const compliance = document.getElementById('filterCompliance').value;
  const dept = document.getElementById('filterDept').value;
  const filled = document.getElementById('filterFilled').value;
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const platformEl = document.getElementById('filterPlatform');
  const platform = platformEl ? platformEl.value : '';

  filteredData = allData.filter(d => {
    if (face && d['構面'] !== face) return false;
    if (statusFilter && d['指標分類'] !== statusFilter) return false;

    if (dept) {
      if (Array.isArray(d['負責部門列表'])) {
        if (!d['負責部門列表'].includes(dept)) return false;
      } else {
        if (d['114_相關負責部門'] !== dept) return false;
      }
    }

    if (platform) {
      if (Array.isArray(d['揭露平台'])) {
        if (!d['揭露平台'].includes(platform)) return false;
      } else {
        return false;
      }
    }

    if (compliance) {
      const score = d.disclosure_analysis?.compliance_score || 'cannot_assess';
      if (compliance === 'low') {
        if (score !== 'partially_compliant' && score !== 'non_compliant') return false;
      } else {
        if (score !== compliance) return false;
      }
    }

    if (filled) {
      const code = d['編號'];
      const isSubmitted = submittedIndicators.has(code);
      const hasDraft = !!localStorage.getItem(`esg_draft_${code}`);
      if (filled === 'filled' && !isSubmitted) return false;
      if (filled === 'draft' && (!hasDraft || isSubmitted)) return false;
      if (filled === 'empty' && (isSubmitted || hasDraft)) return false;
    }

    if (search) {
      const haystack = [
        d['編號'], d['評鑑指標'], d['指標說明'],
        d['114_自評來源及說明'], d['114_相關負責部門'],
        d['填答建議_簡要']
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  renderStats();
  if (currentView === 'kanban') renderKanban();
  else renderTable();
}

function renderStats() {
  const total = filteredData.length;
  const newCount = filteredData.filter(d => d['指標分類'] === '新增').length;
  const modCount = filteredData.filter(d => d['指標分類'] === '修正').length;
  const filledCount = filteredData.filter(d => submittedIndicators.has(d['編號'])).length;

  document.getElementById('stats').innerHTML = `
    <span class="stat-item">
      <span class="stat-count">${total}</span> 指標
    </span>
    <span class="stat-item">
      <span class="stat-dot" style="background:var(--new-color)"></span>
      <span class="stat-count">${newCount}</span> 新增
    </span>
    <span class="stat-item">
      <span class="stat-dot" style="background:var(--mod-color)"></span>
      <span class="stat-count">${modCount}</span> 修正
    </span>
    <span class="stat-item">
      <span class="stat-dot" style="background:var(--score-pass)"></span>
      <span class="stat-count">${filledCount}</span> 已填答
    </span>
  `;
}

// === Event Listeners ===
function setupEventListeners() {
  document.getElementById('filterFace').addEventListener('change', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);
  document.getElementById('filterCompliance').addEventListener('change', applyFilters);
  document.getElementById('filterDept').addEventListener('change', applyFilters);
  document.getElementById('filterFilled').addEventListener('change', applyFilters);
  if (document.getElementById('filterPlatform')) document.getElementById('filterPlatform').addEventListener('change', applyFilters);
  
  document.getElementById('searchInput').addEventListener('input', debounce(applyFilters, 200));

  document.getElementById('btnKanban').addEventListener('click', () => switchView('kanban'));
  document.getElementById('btnTable').addEventListener('click', () => switchView('table'));

  document.getElementById('btnClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  document.getElementById('btnExport').addEventListener('click', exportCSV);
}

function switchView(view) {
  currentView = view;
  document.getElementById('btnKanban').classList.toggle('active', view === 'kanban');
  document.getElementById('btnTable').classList.toggle('active', view === 'table');
  document.getElementById('kanbanView').classList.toggle('hidden', view !== 'kanban');
  document.getElementById('tableView').classList.toggle('hidden', view !== 'table');

  if (view === 'kanban') renderKanban();
  else renderTable();
}

// === Kanban Rendering (V2 behavior: Grouped by Compliance) ===
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  const complianceColumns = [
    { key: 'fully_compliant', title: '完全符合', color: '#22c55e' },
    { key: 'partially_compliant', title: '部分符合', color: '#eab308' },
    { key: 'non_compliant', title: '不符合', color: '#ef4444' },
    { key: 'cannot_assess', title: '無法評估', color: '#9ca3af' }
  ];

  const groups = new Map();
  complianceColumns.forEach(c => groups.set(c.key, []));

  filteredData.forEach(d => {
    const da = d['disclosure_analysis'];
    let score = (da && da.compliance_score) ? da.compliance_score : 'cannot_assess';
    if (!groups.has(score)) score = 'cannot_assess';
    groups.get(score).push(d);
  });

  complianceColumns.forEach(colDef => {
    const items = groups.get(colDef.key);
    const col = createComplianceColumn(colDef, items);
    board.appendChild(col);
  });
}

function createComplianceColumn(colDef, items) {
  const col = document.createElement('div');
  col.className = 'kanban-column';

  col.innerHTML = `
    <div class="kanban-column-header">
      <span class="kanban-column-title">
        <span class="column-color-dot" style="background:${colDef.color}"></span>
        ${colDef.title}
      </span>
      <span class="kanban-column-count">${items.length}</span>
    </div>
    <div class="kanban-column-body"></div>
  `;

  const body = col.querySelector('.kanban-column-body');
  items.forEach(item => {
    body.appendChild(createCard(item));
  });

  return col;
}

function createCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  card.addEventListener('click', () => openModal(item));

  const id = item['編號'] || '';
  const face = item['構面'] || '';
  const faceClass = face === 'E' ? 'env' : face === 'S' ? 'soc' : 'gov';
  const category = item['指標分類'] || '無改變';
  const scoreVal = item['114_得分數值'];
  const scoreText = item['114_自評得分'] || '';
  const hasAI = item['ai_suggestion'] && !item['ai_suggestion']?.error && !item['ai_suggestion']?.parse_error;
  
  const isSubmitted = submittedIndicators.has(id);
  const hasDraft = !!localStorage.getItem(`esg_draft_${id}`);

  let badgeHtml = '';
  if (category === '新增') badgeHtml = '<span class="card-badge new">NEW</span>';
  else if (category === '修正') badgeHtml = '<span class="card-badge modified">MOD</span>';

  let scoreClass = 'na';
  let scoreDisplay = '--';
  const isNew = category === '新增';
  if (scoreVal === 1) { scoreClass = 'pass'; scoreDisplay = '1分'; }
  else if (scoreVal === 0) { scoreClass = 'fail'; scoreDisplay = '0分'; }
  else if (scoreText) { scoreDisplay = scoreText.substring(0, 6); scoreClass = 'pass'; }

  const title = (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 100);
  const deptDisplay = Array.isArray(item['負責部門列表']) && item['負責部門列表'].length > 0
    ? item['負責部門列表'].join(', ') : (item['114_相關負責部門'] || '');

  card.innerHTML = `
    <div class="card-header">
      <span class="card-id ${faceClass}">${id}</span>
      ${badgeHtml}
      ${isSubmitted ? '<span class="card-filled-badge">✅</span>' : (hasDraft ? '<span class="card-draft-badge">📝</span>' : '')}
    </div>
    <div class="card-title">${title}</div>
    <div class="card-footer">
      <span class="card-type">${item['題型'] || ''}</span>
      <span class="card-score ${scoreClass}">${isNew ? '(新增)' : scoreDisplay}</span>
    </div>
    ${deptDisplay ? `<div class="card-dept" style="font-size:11px;color:var(--text-muted);margin-top:4px;">${deptDisplay}</div>` : ''}
    ${hasAI ? '<div class="card-ai-badge">&#x2728; AI 建議</div>' : ''}
  `;

  return card;
}

// === Table Rendering ===
function renderTable() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  filteredData.forEach(item => {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openModal(item));

    const category = item['指標分類'] || '無改變';
    const isNew = category === '新增';
    const scoreVal = item['114_得分數值'];
    
    let scoreBadge = '--';
    if (isNew) scoreBadge = '<span style="color:var(--new-color)">(新增)</span>';
    else if (scoreVal === 1) scoreBadge = '<span style="color:var(--score-pass)">1分</span>';
    else if (scoreVal === 0) scoreBadge = '<span style="color:var(--score-fail)">0分</span>';

    const face = item['構面'] || '';
    const faceLabel = face === 'E' ? '環境' : face === 'S' ? '社會' : face === 'G' ? '治理' : face;
    const id = item['編號'];

    let badgeHtml = category === '新增' ? '<span class="card-badge new" style="font-size:11px">NEW</span>' :
                    category === '修正' ? '<span class="card-badge modified" style="font-size:11px">MOD</span>' :
                    '<span style="font-size:11px;color:var(--text-muted)">--</span>';

    const deptDisplay = Array.isArray(item['負責部門列表']) && item['負責部門列表'].length > 0
      ? item['負責部門列表'].join(', ') : (item['114_相關負責部門'] || '<span style="color:var(--text-muted)">待分配</span>');

    const isSubmitted = submittedIndicators.has(id);
    const hasDraft = !!localStorage.getItem(`esg_draft_${id}`);
    const filledBadge = isSubmitted ? '<span class="filled-badge-sm">✅</span>' :
                        hasDraft ? '<span class="draft-badge-sm">📝</span>' : '<span style="color:var(--text-muted)">—</span>';

    tr.innerHTML = `
      <td><strong>${id}</strong></td>
      <td>${badgeHtml}</td>
      <td>${faceLabel}</td>
      <td>${(item['評鑑指標'] || '').replace(/\n/g, ' ')}</td>
      <td>${item['題型'] || ''}</td>
      <td>${scoreBadge}</td>
      <td>${deptDisplay}</td>
      <td>${filledBadge}</td>
      <td><button class="btn" style="padding:4px 8px;font-size:11px;background:var(--bg-surface);color:var(--text-secondary);">詳細</button></td>
    `;

    tbody.appendChild(tr);
  });
}

// === Modal ===
function openModal(item) {
  const overlay = document.getElementById('modalOverlay');
  const badge = document.getElementById('modalBadge');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');

  const category = item['指標分類'] || '無改變';
  const isNew = category === '新增';
  const isMod = category === '修正';

  if (isNew) {
    badge.textContent = 'NEW 2026 新增指標';
    badge.className = 'modal-badge new card-badge';
  } else if (isMod) {
    badge.textContent = 'MOD 2026 修正指標';
    badge.className = 'modal-badge modified card-badge';
  } else {
    badge.textContent = '無改變';
    badge.className = 'modal-badge';
    badge.style.background = 'var(--text-muted)';
    badge.style.color = '#fff';
  }

  title.textContent = `${item['編號']} — ${(item['評鑑指標'] || '').replace(/\n/g, ' ')}`;

  const scoreVal = item['114_得分數值'];
  let scoreHtml = '';
  if (!isNew) {
    if (scoreVal === 1) scoreHtml = '<span class="score-badge pass">&#x2713; 得分</span>';
    else if (scoreVal === 0) scoreHtml = '<span class="score-badge fail">&#x2717; 未得分</span>';
    else scoreHtml = `<span class="score-badge pass">${item['114_自評得分'] || 'N/A'}</span>`;
  }

  const deptDisplay = Array.isArray(item['負責部門列表']) && item['負責部門列表'].length > 0
    ? item['負責部門列表'].join(', ') : (item['114_相關負責部門'] || '待分配');

  const platformDisplay = Array.isArray(item['揭露平台']) && item['揭露平台'].length > 0
    ? item['揭露平台'].map(p => `<span style="display:inline-block;background:var(--bg-surface);border:1px solid var(--border-subtle);padding:2px 8px;border-radius:12px;font-size:12px;margin:2px;">${p}</span>`).join(' ')
    : 'N/A';

  let html = '';

  // V2 specific displays: 填答建議_簡要 & 年度差異說明
  if (item['填答建議_簡要']) {
    html += `
      <div class="modal-section" style="background:linear-gradient(135deg, rgba(245,158,11,0.1), rgba(253,230,138,0.1)); border:1px solid rgba(245,158,11,0.3); border-radius:var(--radius); padding:20px; margin-bottom:20px;">
        <div class="modal-section-title" style="color:var(--accent-orange); font-size:15px; font-weight:700; margin-bottom:10px; border-bottom:1px solid rgba(245,158,11,0.2);">
          &#x1F4A1; 填答建議（給負責部門）
        </div>
        <div style="color:var(--text-secondary); font-size:14px; line-height:1.7; white-space:pre-wrap;">${item['填答建議_簡要']}</div>
      </div>
    `;
  }

  if (isMod && item['年度差異說明']) {
    html += `
      <div class="modal-section" style="background:linear-gradient(135deg, rgba(59,130,246,0.1), rgba(191,219,254,0.1)); border:1px solid rgba(59,130,246,0.3); border-radius:var(--radius); padding:20px; margin-bottom:20px;">
        <div class="modal-section-title" style="color:var(--accent-blue); font-size:15px; font-weight:700; margin-bottom:10px; border-bottom:1px solid rgba(59,130,246,0.2);">
          &#x1F504; 年度差異說明（與上屆比較）
        </div>
        <div style="color:var(--text-secondary); font-size:14px; line-height:1.7; white-space:pre-wrap;">${item['年度差異說明']}</div>
      </div>
    `;
  }

  html += `
    <div class="modal-section">
      <div class="modal-info-grid">
        <div class="info-card">
          <div class="info-card-label">構面</div>
          <div class="info-card-value">${item['構面'] === 'E' ? '環境面 (E)' : item['構面'] === 'S' ? '社會面 (S)' : '公司治理面 (G)'}</div>
        </div>
        <div class="info-card">
          <div class="info-card-label">題型</div>
          <div class="info-card-value">${item['題型'] || 'N/A'}</div>
        </div>
        <div class="info-card">
          <div class="info-card-label">前屆編號</div>
          <div class="info-card-value">${item['前屆編號'] || '(新增)'}</div>
        </div>
        <div class="info-card">
          <div class="info-card-label">114 年得分</div>
          <div class="info-card-value">${isNew ? '(新增題)' : scoreHtml}</div>
        </div>
        <div class="info-card">
          <div class="info-card-label">負責部門</div>
          <div class="info-card-value">${deptDisplay}</div>
        </div>
        <div class="info-card">
          <div class="info-card-label">揭露平台</div>
          <div class="info-card-value">${platformDisplay}</div>
        </div>
        <div class="info-card">
          <div class="info-card-label">指標分類</div>
          <div class="info-card-value">${category}</div>
        </div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">&#x1F4CB; 115年 指標說明</div>
      <div class="modal-section-content">${item['指標說明'] || 'N/A'}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">&#x1F4CE; 評鑑資訊依據</div>
      <div class="modal-section-content">${item['評鑑資訊依據'] || 'N/A'}</div>
    </div>
  `;

  if (!isNew && item['114_自評來源及說明']) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">&#x1F4DD; 114年 自評來源及說明</div>
        <div class="modal-section-content">${item['114_自評來源及說明']}</div>
      </div>
    `;
  }

  const ai = item['ai_suggestion'];
  if (ai && !ai.error && !ai.parse_error) {
    html += `
      <div class="modal-section ai-section">
        <div class="modal-section-title">&#x2728; AI 填答建議 (Gemini)</div>
        <div class="ai-item">
          <div class="ai-item-label">指標核心要求白話文</div>
          <div class="ai-item-content">${ai['核心要求白話文'] || ai['核心要求'] || 'N/A'}</div>
        </div>
        <div class="ai-item">
          <div class="ai-item-label">差異分析 / 現況診斷</div>
          <div class="ai-item-content">${ai['差異分析或現況診斷'] || ai['差異分析'] || 'N/A'}</div>
        </div>
        <div class="ai-item">
          <div class="ai-item-label">具體行動與揭露清單</div>
          <div class="ai-item-content">
            ${Array.isArray(ai['具體行動與揭露清單']) ? '<ul>' + ai['具體行動與揭露清單'].map(a => `<li>${a}</li>`).join('') + '</ul>' : (ai['具體行動與揭露清單'] || 'N/A')}
          </div>
        </div>
        <div class="ai-item">
          <div class="ai-item-label">官方參考與較佳案例</div>
          <div class="ai-item-content">${ai['官方參考與較佳案例'] || 'N/A'}</div>
        </div>
      </div>
    `;
  }

  const da = item['disclosure_analysis'];
  if (da && !da.error) {
    html += renderComplianceSection(da);
  }

  // === 📝 Enhanced Fill-in Form (V3 Features embedded locally) ===
  const code = item['編號'];
  const draft = loadDraft(code);
  const isSubmitted = submittedIndicators.has(code);

  html += `
    <div class="modal-section draft-section">
      <div class="modal-section-title">
        &#x1F4DD; 115年度自評填答
        ${isSubmitted ? '<span class="submitted-label">✅ 已送出</span>' : ''}
      </div>
      <div class="draft-form" id="draftForm">
        <div class="draft-field">
          <label class="draft-label">填答者</label>
          <div class="draft-readonly">${currentUser.dept} — ${currentUser.name}</div>
        </div>

        <div class="draft-field">
          <label class="draft-label">揭露狀態 <span class="draft-required">*</span></label>
          <select id="draftStatus" class="draft-input" onchange="autoSaveDraft()">
            <option value="">請選擇...</option>
            <option value="已揭露" ${draft.status === '已揭露' ? 'selected' : ''}>✅ 已揭露</option>
            <option value="規劃中" ${draft.status === '規劃中' ? 'selected' : ''}>🔄 規劃中</option>
            <option value="不適用" ${draft.status === '不適用' ? 'selected' : ''}>➖ 不適用</option>
          </select>
        </div>

        <div class="draft-field">
          <label class="draft-label">質性說明 / 自評內容 <span class="draft-required">*</span></label>
          <textarea id="draftText" class="draft-textarea" rows="6"
            placeholder="請說明本公司如何符合此指標的各項要件，包含：&#10;• 具體的政策、目標與措施&#10;• 量化數據（如年度數據、達成率）&#10;• 揭露位置（年報頁碼、永續報告書章節）"
            oninput="autoSaveDraft()">${draft.text || ''}</textarea>
        </div>

        <div class="draft-field">
          <label class="draft-label">佐證來源 / 連結</label>
          <input type="text" id="draftEvidence" class="draft-input"
            placeholder="例：年報 p.92、永續報告書 p.208、https://..."
            value="${draft.evidence || ''}"
            oninput="autoSaveDraft()">
        </div>

        <div class="draft-actions">
          <div class="draft-actions-left">
            <button class="draft-ai-btn" id="btnAIValidate" onclick="runAIValidation()">
              <span class="draft-btn-text">🤖 AI 檢核</span>
              <span class="draft-btn-loading hidden">⏳ 分析中...</span>
            </button>
            <button class="draft-submit-btn" id="btnSubmitDraft" onclick="submitDraft()">
              <span class="draft-btn-text">📤 送出到 Google Sheets</span>
              <span class="draft-btn-loading hidden">⏳ 送出中...</span>
            </button>
          </div>
          <div class="draft-save-hint" id="draftSaveHint"></div>
        </div>

        <div class="draft-status" id="draftStatus2"></div>

        <!-- AI Validation Result -->
        <div class="ai-validation-result hidden" id="aiValidationResult"></div>
      </div>
    </div>
  `;

  currentModalItem = item;
  body.innerHTML = html;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

// === Draft Auto-save ===
function loadDraft(code) {
  const saved = localStorage.getItem(`esg_draft_${code}`);
  if (saved) {
    try { return JSON.parse(saved); } catch {}
  }
  return { text: '', evidence: '', status: '' };
}

function autoSaveDraft() {
  if (!currentModalItem) return;
  const code = currentModalItem['編號'];
  const draft = {
    text: document.getElementById('draftText')?.value || '',
    evidence: document.getElementById('draftEvidence')?.value || '',
    status: document.getElementById('draftStatus')?.value || '',
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(`esg_draft_${code}`, JSON.stringify(draft));

  const hint = document.getElementById('draftSaveHint');
  if (hint) {
    hint.textContent = '💾 草稿已自動儲存';
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 2000);
  }
}

// === AI Validation ===
async function runAIValidation() {
  const text = document.getElementById('draftText')?.value?.trim();
  const evidence = document.getElementById('draftEvidence')?.value?.trim();
  const status = document.getElementById('draftStatus')?.value;
  const btn = document.getElementById('btnAIValidate');
  const resultEl = document.getElementById('aiValidationResult');

  if (!text) {
    resultEl.innerHTML = '<div class="ai-val-error">❌ 請先填寫質性說明內容</div>';
    resultEl.classList.remove('hidden');
    return;
  }
  if (!currentUser.apiKey) {
    resultEl.innerHTML = '<div class="ai-val-error">❌ 請先在登入頁面設定 Gemini API Key</div>';
    resultEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.querySelector('.draft-btn-text').classList.add('hidden');
  btn.querySelector('.draft-btn-loading').classList.remove('hidden');
  resultEl.innerHTML = '<div class="ai-val-loading">🤖 正在分析您的填答內容...</div>';
  resultEl.classList.remove('hidden');

  try {
    const result = await validateWithAI(currentModalItem, text, evidence, status, currentUser.apiKey);
    renderValidationResult(result);

    const code = currentModalItem['編號'];
    const draft = loadDraft(code);
    draft.aiResult = result;
    localStorage.setItem(`esg_draft_${code}`, JSON.stringify(draft));
  } catch (err) {
    resultEl.innerHTML = `<div class="ai-val-error">❌ ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.querySelector('.draft-btn-text').classList.remove('hidden');
    btn.querySelector('.draft-btn-loading').classList.add('hidden');
  }
}

function renderValidationResult(result) {
  const el = document.getElementById('aiValidationResult');
  const complianceMap = {
    'full': { emoji: '✅', label: '符合', cls: 'val-full' },
    'partial': { emoji: '⚠️', label: '部分符合', cls: 'val-partial' },
    'non': { emoji: '❌', label: '不符合', cls: 'val-non' }
  };
  const info = complianceMap[result.compliance] || complianceMap['partial'];

  let html = `
    <div class="ai-val-header ${info.cls}">
      <span class="ai-val-emoji">${info.emoji}</span>
      <span class="ai-val-label">${info.label}</span>
      <span class="ai-val-score">${result.score || '?'}/100</span>
      <span class="ai-val-summary">${result.summary || ''}</span>
    </div>
  `;

  if (result.matched_items?.length > 0) {
    html += `<div class="ai-val-section">
      <div class="ai-val-section-title">✅ 已符合要件</div>
      <ul>${result.matched_items.map(m => `<li>${m}</li>`).join('')}</ul>
    </div>`;
  }
  if (result.missing_items?.length > 0) {
    html += `<div class="ai-val-section">
      <div class="ai-val-section-title">❌ 缺漏項目</div>
      <ul class="missing-list">${result.missing_items.map(m => `<li>${m}</li>`).join('')}</ul>
    </div>`;
  }
  if (result.suggestions?.length > 0) {
    html += `<div class="ai-val-section">
      <div class="ai-val-section-title">💡 改善建議</div>
      <ul class="suggestion-list">${result.suggestions.map(s => `<li>${s}</li>`).join('')}</ul>
    </div>`;
  }

  el.innerHTML = html;
  el.classList.remove('hidden');
}

// === Draft Submission ===
async function submitDraft() {
  const text = document.getElementById('draftText')?.value?.trim();
  const evidence = document.getElementById('draftEvidence')?.value?.trim();
  const status = document.getElementById('draftStatus')?.value;
  const btn = document.getElementById('btnSubmitDraft');
  const statusEl = document.getElementById('draftStatus2');

  if (!status) { showDraftStatus(statusEl, '❌ 請選擇揭露狀態', 'error'); return; }
  if (!text) { showDraftStatus(statusEl, '❌ 請填入質性說明內容', 'error'); return; }

  btn.disabled = true;
  btn.querySelector('.draft-btn-text').classList.add('hidden');
  btn.querySelector('.draft-btn-loading').classList.remove('hidden');
  showDraftStatus(statusEl, '', '');

  const item = currentModalItem;
  const code = item['編號'];
  const draft = loadDraft(code);
  const aiResult = draft.aiResult;
  const deptStr = Array.isArray(item['負責部門列表']) ? item['負責部門列表'].join(', ') : (item['114_相關負責部門'] || '');

  const formData = new URLSearchParams();
  formData.append('編號', code);
  formData.append('構面', item['構面'] || '');
  formData.append('評鑑指標', (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 200));
  formData.append('負責部門', deptStr);
  formData.append('填寫人姓名', currentUser.name);
  formData.append('填寫人部門', currentUser.dept);
  formData.append('揭露狀態', status);
  formData.append('自評草稿', text);
  formData.append('佐證來源', evidence || '');
  formData.append('AI檢核結果', aiResult ? (aiResult.compliance === 'full' ? '✅符合' : aiResult.compliance === 'partial' ? '⚠️部分符合' : '❌不符合') : '未檢核');
  formData.append('AI缺漏項目', aiResult?.missing_items?.join('；') || '');
  formData.append('AI建議', aiResult?.suggestions?.join('；') || '');

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    submittedIndicators.add(code);
    saveSubmittedState();
    showDraftStatus(statusEl, '✅ 已成功送出！資料已寫入 Google Sheets', 'success');
    applyFilters(); 
  } catch (err) {
    showDraftStatus(statusEl, `❌ 網路錯誤：${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.draft-btn-text').classList.remove('hidden');
    btn.querySelector('.draft-btn-loading').classList.add('hidden');
  }
}

function showDraftStatus(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'draft-status' + (type ? ` draft-status-${type}` : '');
}

// === Export ===
function exportCSV() {
  const columns = [
    { header: '編號', get: d => d['編號'] },
    { header: '指標分類', get: d => d['指標分類'] || d['狀態標記'] },
    { header: '構面', get: d => d['構面'] },
    { header: '評鑑指標', get: d => d['評鑑指標'] },
    { header: '揭露平台', get: d => Array.isArray(d['揭露平台']) ? d['揭露平台'].join(', ') : '' },
    { header: '負責部門', get: d => Array.isArray(d['負責部門列表']) ? d['負責部門列表'].join(', ') : (d['114_相關負責部門'] || '') },
    { header: '填答狀態', get: d => submittedIndicators.has(d['編號']) ? '已送出' : localStorage.getItem(`esg_draft_${d['編號']}`) ? '有草稿' : '未填答' }
  ];

  const bom = '\uFEFF';
  let csv = bom + columns.map(c => `"${c.header}"`).join(',') + '\n';
  filteredData.forEach(d => {
    const row = columns.map(c => `"${String(c.get(d) || '').replace(/"/g, '""')}"`);
    csv += row.join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'esg_indicators_export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// === Compliance Helpers (V2 features added) ===
function getComplianceBadgeHTML(score, size = 'normal') {
  const map = {
    'fully_compliant': { emoji: '&#x1F7E2;', label: '完全符合', cls: 'compliance-full' },
    'partially_compliant': { emoji: '&#x1F7E1;', label: '部分符合', cls: 'compliance-partial' },
    'non_compliant': { emoji: '&#x1F534;', label: '不符合', cls: 'compliance-fail' },
    'cannot_assess': { emoji: '&#x2B1C;', label: '無法評估', cls: 'compliance-na' }
  };
  const info = map[score] || map['cannot_assess'];
  if (size === 'small') return `<span class="compliance-badge-sm ${info.cls}" title="${info.label}">${info.emoji}</span>`;
  return `<span class="compliance-badge ${info.cls}">${info.emoji} ${info.label}</span>`;
}

function renderComplianceSection(da) {
  const score = da.compliance_score || 'cannot_assess';
  const confidence = da.score_confidence != null ? Math.round(da.score_confidence * 100) : '?';
  const matched = da.matched_items || [];
  const missing = da.missing_items || [];
  const urlAnalysis = da.url_analysis || [];

  let html = `
    <div class="modal-section compliance-section">
      <div class="modal-section-title">&#x1F4CA; 揭露合規分析</div>
      <div class="compliance-header">
        ${getComplianceBadgeHTML(score)}
        <span class="compliance-confidence">信心度: ${confidence}%</span>
        <span class="compliance-urls">已分析 ${da.urls_crawled || 0}/${da.urls_total || 0} 個來源</span>
      </div>
  `;

  if (da.compliance_note) {
    html += `
      <div style="background:rgba(250,204,21,0.1); border:1px solid rgba(250,204,21,0.3); border-radius:var(--radius-sm); padding:12px; margin:12px 0; font-size:13px; line-height:1.6; color:var(--accent-orange);">
        <strong>&#x26A0;&#xFE0F; 合規判定說明：</strong> ${da.compliance_note}
      </div>
    `;
  }

  if (da.gap_summary) html += `<div class="compliance-gap">${da.gap_summary}</div>`;

  if (matched.length > 0) {
    html += `<div class="compliance-list-title">&#x2705; 已符合項目 (${matched.length})</div><ul class="compliance-list matched">`;
    matched.forEach(m => { html += `<li>${m}</li>`; });
    html += `</ul>`;
  }

  if (missing.length > 0) {
    html += `<div class="compliance-list-title">&#x274C; 缺口項目 (${missing.length})</div><ul class="compliance-list missing">`;
    missing.forEach(m => { html += `<li>${m}</li>`; });
    html += `</ul>`;
  }

  if (urlAnalysis.length > 0) {
    html += `<div class="compliance-list-title">&#x1F517; 來源覆蓋率分析</div><div class="url-analysis-grid" style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">`;
    urlAnalysis.forEach(u => {
      const icon = u.relevant ? '&#x2705;' : '&#x26AA;';
      const shortUrl = (u.url || '').replace(/^https?:\/\//, '').substring(0, 50);
      html += `
        <div style="background:rgba(0,0,0,0.15);padding:10px;border-radius:var(--radius-sm);display:flex;gap:10px;border:1px solid var(--border-subtle);opacity:${u.relevant?1:0.6}">
          <span>${icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shortUrl}...</div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;line-height:1.5;">${u.summary || ''}</div>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  if (da.recommendation) {
    html += `<div class="compliance-recommendation"><strong>&#x1F4A1; 建議:</strong> ${da.recommendation}</div>`;
  }

  html += `</div>`;
  return html;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
