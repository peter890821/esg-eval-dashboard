/**
 * ESG Kanban Dashboard - Main Application Logic (Updated)
 * ========================================================
 * Updated to support new fields: 指標分類, 狀態標記, 揭露平台,
 * 負責部門列表, 填答建議_簡要, 年度差異說明, compliance_note.
 * Kanban grouped by compliance level. Filters updated.
 */

// === Config ===
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxijoVvZzODBf0zQ6libnIhSEP6_DZ9V3dIY1hScHOsWDl3iPnT1KHhSU_BsJrTZjc2/exec';
const ALLOWED_EMAIL_DOMAIN = 'taiwancement.com';

// === State ===
let allData = [];
let filteredData = [];
let currentView = 'kanban'; // 'kanban' or 'table'
let currentModalItem = null; // track current item for draft submission

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  applyFilters();
});

// === Data Loading ===
async function loadData() {
  try {
    const ts = Date.now();
    let resp;
    // Try suggestions_output_fixed.json first, then suggestions_output.json, then data.json
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

    // Filter out non-indicator rows (category headers, extra items)
    allData = allData.filter(d => d['編號'] && /^[ESG]-\d+$/.test(d['編號']));

    populateDeptFilter();
    populatePlatformFilter();
    updateStatusFilterOptions();
    renderStats();
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('kanbanBoard').innerHTML =
      '<div style="padding:40px;color:#f06565;">Failed to load data. Check console for details.</div>';
  }
}

// === Filters ===

/**
 * Populate department filter from 負責部門列表 arrays.
 * Each indicator may have multiple departments; we collect all unique values.
 */
function populateDeptFilter() {
  const depts = new Set();
  allData.forEach(d => {
    const deptList = d['負責部門列表'];
    if (Array.isArray(deptList)) {
      deptList.forEach(dep => { if (dep) depts.add(dep); });
    } else {
      // Fallback to old field
      const dept = d['114_相關負責部門'];
      if (dept) depts.add(dept);
    }
  });

  const sel = document.getElementById('filterDept');
  // Clear existing options except the first "全部部門"
  while (sel.options.length > 1) sel.remove(1);
  [...depts].sort((a, b) => a.localeCompare(b, 'zh-TW')).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });
}

/**
 * Populate the 揭露平台 filter dropdown.
 */
function populatePlatformFilter() {
  const sel = document.getElementById('filterPlatform');
  if (!sel) return; // If HTML doesn't have this element yet, skip
  // Options are static per requirements, but ensure they exist
  const staticOptions = ['年報', '永續報告書', '官網', '公開資訊觀測站', 'ESG數位平台', '其他'];
  while (sel.options.length > 1) sel.remove(1);
  staticOptions.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
}

/**
 * Update the filterStatus dropdown to use 指標分類 values.
 */
function updateStatusFilterOptions() {
  const sel = document.getElementById('filterStatus');
  if (!sel) return;
  // Replace options to match 指標分類 field
  sel.innerHTML = `
    <option value="">全部分類</option>
    <option value="新增">新增指標</option>
    <option value="修正">修正指標</option>
    <option value="無改變">無改變</option>
  `;
}

function applyFilters() {
  const face = document.getElementById('filterFace').value;
  const statusFilter = document.getElementById('filterStatus').value; // Now filters on 指標分類
  const compliance = document.getElementById('filterCompliance').value;
  const dept = document.getElementById('filterDept').value;
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const platformEl = document.getElementById('filterPlatform');
  const platform = platformEl ? platformEl.value : '';

  filteredData = allData.filter(d => {
    if (face && d['構面'] !== face) return false;

    // 指標分類 filter (replaces old 狀態標記 filter)
    if (statusFilter && d['指標分類'] !== statusFilter) return false;

    // Department filter: match against 負責部門列表 array
    if (dept) {
      const deptList = d['負責部門列表'];
      if (Array.isArray(deptList)) {
        if (!deptList.includes(dept)) return false;
      } else {
        // Fallback to old field
        if (d['114_相關負責部門'] !== dept) return false;
      }
    }

    // 揭露平台 filter
    if (platform) {
      const platforms = d['揭露平台'];
      if (Array.isArray(platforms)) {
        if (!platforms.includes(platform)) return false;
      } else {
        return false; // No platform data, filter out
      }
    }

    // Compliance filter
    if (compliance) {
      const score = d.disclosure_analysis && d.disclosure_analysis.compliance_score
        ? d.disclosure_analysis.compliance_score : 'cannot_assess';
      if (compliance === 'low') {
        if (score !== 'partially_compliant' && score !== 'non_compliant') return false;
      } else {
        if (score !== compliance) return false;
      }
    }

    // Search
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
  const unchangedCount = filteredData.filter(d => d['指標分類'] === '無改變').length;
  const aiCount = filteredData.filter(d => d['ai_suggestion'] && !d['ai_suggestion'].error).length;

  document.getElementById('stats').innerHTML = `
    <span class="stat-item">
      <span class="stat-count">${total}</span> 指標
    </span>
    <span class="stat-item">
      <span class="stat-dot" style="background:var(--new-color, #a855f7)"></span>
      <span class="stat-count">${newCount}</span> 新增
    </span>
    <span class="stat-item">
      <span class="stat-dot" style="background:var(--mod-color, #06b6d4)"></span>
      <span class="stat-count">${modCount}</span> 修正
    </span>
    <span class="stat-item">
      <span class="stat-dot" style="background:var(--text-muted, #888)"></span>
      <span class="stat-count">${unchangedCount}</span> 無改變
    </span>
    ${aiCount > 0 ? `<span class="stat-item">
      <span class="stat-dot" style="background:var(--accent-purple, #a855f7)"></span>
      <span class="stat-count">${aiCount}</span> AI建議
    </span>` : ''}
  `;
}

// === Event Listeners ===
function setupEventListeners() {
  document.getElementById('filterFace').addEventListener('change', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);
  document.getElementById('filterCompliance').addEventListener('change', applyFilters);
  document.getElementById('filterDept').addEventListener('change', applyFilters);
  document.getElementById('searchInput').addEventListener('input', debounce(applyFilters, 200));

  const platformEl = document.getElementById('filterPlatform');
  if (platformEl) platformEl.addEventListener('change', applyFilters);

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

  // Inject 揭露平台 filter into toolbar if not present in HTML
  injectPlatformFilter();
}

/**
 * Dynamically inject the 揭露平台 filter select into the toolbar
 * if the HTML doesn't already include it.
 */
function injectPlatformFilter() {
  if (document.getElementById('filterPlatform')) return;
  const filterGroup = document.querySelector('.filter-group');
  if (!filterGroup) return;

  const sel = document.createElement('select');
  sel.id = 'filterPlatform';
  sel.className = 'filter-select';
  sel.innerHTML = '<option value="">全部平台</option>';
  // Insert after filterCompliance or at the end
  const complianceSel = document.getElementById('filterCompliance');
  if (complianceSel && complianceSel.nextSibling) {
    filterGroup.insertBefore(sel, complianceSel.nextSibling);
  } else {
    filterGroup.appendChild(sel);
  }
  sel.addEventListener('change', applyFilters);
  populatePlatformFilter();
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

// === Kanban Rendering (grouped by COMPLIANCE level) ===
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  // Define compliance columns in order
  const complianceColumns = [
    { key: 'fully_compliant', title: '完全符合', color: '#22c55e' },
    { key: 'partially_compliant', title: '部分符合', color: '#eab308' },
    { key: 'non_compliant', title: '不符合', color: '#ef4444' },
    { key: 'cannot_assess', title: '無法評估', color: '#9ca3af' }
  ];

  // Group data by compliance level
  const groups = new Map();
  complianceColumns.forEach(c => groups.set(c.key, []));

  filteredData.forEach(d => {
    const da = d['disclosure_analysis'];
    let score = (da && da.compliance_score) ? da.compliance_score : 'cannot_assess';
    // Normalize unknown scores to cannot_assess
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
  const da = item['disclosure_analysis'];
  const complianceBadge = da ? getComplianceBadgeHTML(da.compliance_score, 'small') : '';

  // Badge based on 指標分類
  let badgeHtml = '';
  if (category === '新增') {
    badgeHtml = '<span class="card-badge new">NEW</span>';
  } else if (category === '修正') {
    badgeHtml = '<span class="card-badge modified">MOD</span>';
  }
  // 無改變: no badge

  let scoreClass = 'na';
  let scoreDisplay = '--';
  const isNew = category === '新增';
  if (scoreVal === 1) { scoreClass = 'pass'; scoreDisplay = '1分'; }
  else if (scoreVal === 0) { scoreClass = 'fail'; scoreDisplay = '0分'; }
  else if (scoreText) { scoreDisplay = scoreText.substring(0, 6); scoreClass = 'pass'; }

  const title = (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 100);

  // Show department(s)
  const deptDisplay = Array.isArray(item['負責部門列表']) && item['負責部門列表'].length > 0
    ? item['負責部門列表'].join(', ')
    : (item['114_相關負責部門'] || '');

  card.innerHTML = `
    <div class="card-header">
      <span class="card-id ${faceClass}">${id}</span>
      ${badgeHtml}
      ${complianceBadge}
    </div>
    <div class="card-title">${title}</div>
    <div class="card-footer">
      <span class="card-type">${item['題型'] || ''}</span>
      <span class="card-score ${scoreClass}">${isNew ? '(新增)' : scoreDisplay}</span>
    </div>
    ${deptDisplay ? `<div class="card-dept" style="font-size:11px;color:var(--text-muted, #888);margin-top:4px;">${deptDisplay}</div>` : ''}
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
    if (isNew) scoreBadge = '<span style="color:var(--new-color, #a855f7)">(新增)</span>';
    else if (scoreVal === 1) scoreBadge = '<span style="color:var(--score-pass, #22c55e)">1分</span>';
    else if (scoreVal === 0) scoreBadge = '<span style="color:var(--score-fail, #ef4444)">0分</span>';

    const face = item['構面'] || '';
    const faceLabel = face === 'E' ? '環境' : face === 'S' ? '社會' : face === 'G' ? '治理' : face;

    // Badge
    let badgeHtml = '';
    if (category === '新增') {
      badgeHtml = '<span class="card-badge new" style="font-size:11px">NEW</span>';
    } else if (category === '修正') {
      badgeHtml = '<span class="card-badge modified" style="font-size:11px">MOD</span>';
    } else {
      badgeHtml = '<span style="font-size:11px;color:var(--text-muted, #888)">--</span>';
    }

    // Department display
    const deptDisplay = Array.isArray(item['負責部門列表']) && item['負責部門列表'].length > 0
      ? item['負責部門列表'].join(', ')
      : (item['114_相關負責部門'] || '<span style="color:var(--text-muted, #888)">待分配</span>');

    tr.innerHTML = `
      <td><strong>${item['編號'] || ''}</strong></td>
      <td>${badgeHtml}</td>
      <td>${faceLabel}</td>
      <td>${(item['評鑑指標'] || '').replace(/\n/g, ' ')}</td>
      <td>${item['題型'] || ''}</td>
      <td>${scoreBadge}</td>
      <td>${deptDisplay}</td>
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

  // Modal badge
  if (isNew) {
    badge.textContent = 'NEW 2026 新增指標';
    badge.className = 'modal-badge new card-badge';
  } else if (isMod) {
    badge.textContent = 'MOD 2026 修正指標';
    badge.className = 'modal-badge modified card-badge';
  } else {
    badge.textContent = '無改變';
    badge.className = 'modal-badge';
    badge.style.background = 'var(--text-muted, #888)';
    badge.style.color = '#fff';
  }

  title.textContent = `${item['編號']} — ${(item['評鑑指標'] || '').replace(/\n/g, ' ')}`;

  // Score info
  const scoreVal = item['114_得分數值'];
  let scoreHtml = '';
  if (!isNew) {
    if (scoreVal === 1) scoreHtml = '<span class="score-badge pass">&#x2713; 得分</span>';
    else if (scoreVal === 0) scoreHtml = '<span class="score-badge fail">&#x2717; 未得分</span>';
    else scoreHtml = `<span class="score-badge pass">${item['114_自評得分'] || 'N/A'}</span>`;
  }

  // Department display
  const deptDisplay = Array.isArray(item['負責部門列表']) && item['負責部門列表'].length > 0
    ? item['負責部門列表'].join(', ')
    : (item['114_相關負責部門'] || '待分配');

  // Platform display
  const platformDisplay = Array.isArray(item['揭露平台']) && item['揭露平台'].length > 0
    ? item['揭露平台'].map(p => `<span style="display:inline-block;background:var(--bg-surface, #f3f4f6);border:1px solid var(--border-color, #e5e7eb);padding:2px 8px;border-radius:12px;font-size:12px;margin:2px;">${p}</span>`).join(' ')
    : 'N/A';

  let html = '';

  // ============================================================
  // 填答建議 section - FIRST thing departments see (Requirement #1)
  // ============================================================
  if (item['填答建議_簡要']) {
    html += `
      <div class="modal-section" style="background:linear-gradient(135deg, #fef3c7, #fde68a); border:2px solid #f59e0b; border-radius:12px; padding:20px; margin-bottom:20px;">
        <div class="modal-section-title" style="color:#92400e; font-size:16px; font-weight:700; margin-bottom:10px;">
          &#x1F4A1; 填答建議（給負責部門）
        </div>
        <div style="color:#78350f; font-size:14px; line-height:1.8; white-space:pre-wrap;">${item['填答建議_簡要']}</div>
      </div>
    `;
  }

  // ============================================================
  // 年度差異說明 - Only for 修正 indicators (Requirement #2)
  // ============================================================
  if (isMod && item['年度差異說明']) {
    html += `
      <div class="modal-section" style="background:linear-gradient(135deg, #dbeafe, #bfdbfe); border:2px solid #3b82f6; border-radius:12px; padding:20px; margin-bottom:20px;">
        <div class="modal-section-title" style="color:#1e40af; font-size:15px; font-weight:700; margin-bottom:10px;">
          &#x1F504; 年度差異說明（與上屆比較）
        </div>
        <div style="color:#1e3a5f; font-size:14px; line-height:1.8; white-space:pre-wrap;">${item['年度差異說明']}</div>
      </div>
    `;
  }

  // === Info Cards ===
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

    <!-- 指標說明 -->
    <div class="modal-section">
      <div class="modal-section-title">&#x1F4CB; 115年 指標說明</div>
      <div class="modal-section-content">${item['指標說明'] || 'N/A'}</div>
    </div>

    <!-- 評鑑資訊依據 -->
    <div class="modal-section">
      <div class="modal-section-title">&#x1F4CE; 評鑑資訊依據</div>
      <div class="modal-section-content">${item['評鑑資訊依據'] || 'N/A'}</div>
    </div>
  `;

  // 114 Self-evaluation (only for non-new)
  if (!isNew && item['114_自評來源及說明']) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">&#x1F4DD; 114年 自評來源及說明</div>
        <div class="modal-section-content">${item['114_自評來源及說明']}</div>
      </div>
    `;
  }

  // 114 gaps
  if (!isNew) {
    const gaps = [];
    if (item['114_公司官網有缺']) gaps.push(`官網: ${item['114_公司官網有缺']}`);
    if (item['114_年報有缺']) gaps.push(`年報: ${item['114_年報有缺']}`);
    if (item['114_113年未得分']) gaps.push(`113年: ${item['114_113年未得分']}`);
    if (item['114_修正型態']) gaps.push(`修正型態: ${item['114_修正型態']}`);
    if (gaps.length > 0) {
      html += `
        <div class="modal-section">
          <div class="modal-section-title">&#x26A0;&#xFE0F; 缺失與修正</div>
          <div class="modal-section-content">${gaps.join('\n')}</div>
        </div>
      `;
    }
  }

  // AI Suggestion
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
            ${Array.isArray(ai['具體行動與揭露清單'])
        ? '<ul>' + ai['具體行動與揭露清單'].map(a => `<li>${a}</li>`).join('') + '</ul>'
        : (ai['具體行動與揭露清單'] || 'N/A')}
          </div>
        </div>
        <div class="ai-item">
          <div class="ai-item-label">官方參考與較佳案例</div>
          <div class="ai-item-content">${ai['官方參考與較佳案例'] || 'N/A'}</div>
        </div>
        <div class="ai-item">
          <div class="ai-item-label">分派建議</div>
          <div class="ai-item-content">${ai['分派建議'] || 'N/A'}</div>
        </div>
      </div>
    `;
  } else if (ai && (ai.raw_response || ai.parse_error)) {
    const rawContent = ai.raw_response || JSON.stringify(ai, null, 2);
    html += `
      <div class="modal-section ai-section">
        <div class="modal-section-title">&#x2728; AI 填答建議 (Gemini)</div>
        <div class="modal-section-content" style="white-space:pre-wrap;font-size:13px;line-height:1.7">${rawContent}</div>
      </div>
    `;
  } else {
    html += `
      <div class="modal-section ai-section">
        <div class="modal-section-title">&#x2728; AI 填答建議</div>
        <div class="ai-placeholder">尚未生成 AI 建議。請執行 generate_suggestions.py 後重新載入。</div>
      </div>
    `;
  }

  // === 揭露合規分析 ===
  const da = item['disclosure_analysis'];
  if (da && !da.error) {
    html += renderComplianceSection(da);
  } else if (da && da.error) {
    html += `
      <div class="modal-section compliance-section">
        <div class="modal-section-title">&#x1F4CA; 揭露合規分析</div>
        <div class="ai-placeholder">分析失敗: ${da.error}</div>
      </div>
    `;
  }

  // === 自評草稿區塊 ===
  const savedEmail = localStorage.getItem('esg_draft_email') || '';
  const savedName = localStorage.getItem('esg_draft_name') || '';

  html += `
    <div class="modal-section draft-section">
      <div class="modal-section-title">&#x1F4DD; 填寫今年度自評草稿</div>
      <div class="draft-form">
        <div class="draft-input-row">
          <div class="draft-field">
            <label class="draft-label">公司信箱 <span class="draft-required">*</span></label>
            <input type="email" id="draftEmail" class="draft-input"
              placeholder="your.name@taiwancement.com"
              value="${savedEmail}" />
          </div>
          <div class="draft-field">
            <label class="draft-label">姓名</label>
            <input type="text" id="draftName" class="draft-input"
              placeholder="王小明"
              value="${savedName}" />
          </div>
        </div>
        <label class="draft-label">自評內容草稿 <span class="draft-required">*</span></label>
        <textarea id="draftText" class="draft-textarea" rows="5"
          placeholder="請輸入本年度自評來源及說明，例如：\n- 已揭露於 113 年報 p.XX\n- 官網 ESG 專區已更新..."></textarea>
        <div class="draft-actions">
          <button class="draft-submit-btn" id="btnSubmitDraft" onclick="submitDraft()">
            <span class="draft-btn-text">送出到 Google Sheets</span>
            <span class="draft-btn-loading hidden">送出中...</span>
          </button>
          <div class="draft-status" id="draftStatus"></div>
        </div>
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

// === Export ===
function exportCSV() {
  const columns = [
    { header: '編號', get: d => d['編號'] },
    { header: '指標分類', get: d => d['指標分類'] || '' },
    { header: '狀態標記', get: d => d['狀態標記'] },
    { header: '構面', get: d => d['構面'] },
    { header: '評鑑指標', get: d => d['評鑑指標'] },
    { header: '115年指標說明', get: d => d['指標說明'] },
    { header: '揭露平台', get: d => Array.isArray(d['揭露平台']) ? d['揭露平台'].join(', ') : '' },
    { header: '負責部門', get: d => Array.isArray(d['負責部門列表']) ? d['負責部門列表'].join(', ') : (d['114_相關負責部門'] || '') },
    { header: '填答建議', get: d => d['填答建議_簡要'] || '' },
    { header: '年度差異說明', get: d => d['年度差異說明'] || '' },
    { header: '114_自評來源及說明', get: d => d['114_自評來源及說明'] },
    {
      header: 'AI 填答建議 (Gemini)', get: d => {
        const ai = d.ai_suggestion;
        if (!ai || ai.error) return '';
        if (ai.raw_response) return ai.raw_response;
        return `【核心要求白話文】\n${ai['核心要求白話文'] || ''}\n\n` +
          `【差異分析或現況診斷】\n${ai['差異分析或現況診斷'] || ''}\n\n` +
          `【具體行動與揭露清單】\n${ai['具體行動與揭露清單'] || ''}\n\n` +
          `【官方參考與較佳案例】\n${ai['官方參考與較佳案例'] || ''}\n\n` +
          `【分派建議】\n${ai['分派建議'] || ''}`;
      }
    },
    {
      header: '揭露合規分析及缺口分析', get: d => {
        const da = d.disclosure_analysis;
        if (!da || da.error) return '';

        let statusStr = '';
        if (da.compliance_score === 'fully_compliant') statusStr = '完全符合';
        else if (da.compliance_score === 'partially_compliant') statusStr = '部分符合';
        else if (da.compliance_score === 'non_compliant') statusStr = '不符合';
        else statusStr = '無法評估';

        return `[合規狀態: ${statusStr}]\n\n${da.gap_summary || ''}`;
      }
    }
  ];

  const bom = '\uFEFF';
  let csv = bom + columns.map(c => `"${c.header}"`).join(',') + '\n';

  filteredData.forEach(d => {
    const row = columns.map(c => {
      let val = c.get(d) || '';
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    });
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

// === Draft Submission ===
async function submitDraft() {
  const email = document.getElementById('draftEmail').value.trim().toLowerCase();
  const name = document.getElementById('draftName').value.trim();
  const text = document.getElementById('draftText').value.trim();
  const btn = document.getElementById('btnSubmitDraft');
  const statusEl = document.getElementById('draftStatus');

  // Validation
  if (!email) {
    showDraftStatus(statusEl, '請填入公司信箱', 'error');
    return;
  }
  if (!email.endsWith('@' + ALLOWED_EMAIL_DOMAIN)) {
    showDraftStatus(statusEl, `僅限 @${ALLOWED_EMAIL_DOMAIN} 信箱`, 'error');
    return;
  }
  if (!text) {
    showDraftStatus(statusEl, '請填入自評草稿內容', 'error');
    return;
  }
  if (!GAS_URL) {
    showDraftStatus(statusEl, '尚未設定 Google Sheets 連結 (GAS_URL)', 'error');
    return;
  }

  // Save to localStorage
  localStorage.setItem('esg_draft_email', email);
  localStorage.setItem('esg_draft_name', name);

  // Show loading
  btn.disabled = true;
  btn.querySelector('.draft-btn-text').classList.add('hidden');
  btn.querySelector('.draft-btn-loading').classList.remove('hidden');
  showDraftStatus(statusEl, '', '');

  const item = currentModalItem;
  const deptStr = Array.isArray(item['負責部門列表']) ? item['負責部門列表'].join(', ') : (item['114_相關負責部門'] || '');

  try {
    const formData = new URLSearchParams();
    formData.append('編號', item['編號'] || '');
    formData.append('構面', item['構面'] || '');
    formData.append('評鑑指標', (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 200));
    formData.append('負責部門', deptStr);
    formData.append('自評草稿', text);
    formData.append('填寫人信箱', email);
    formData.append('填寫人姓名', name);

    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    showDraftStatus(statusEl, '已成功送出！資料已寫入 Google Sheets', 'success');
    document.getElementById('draftText').value = '';

  } catch (err) {
    console.error('Submit error:', err);
    showDraftStatus(statusEl, `網路錯誤：${err.message || '無法連線到伺服器'}`, 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.draft-btn-text').classList.remove('hidden');
    btn.querySelector('.draft-btn-loading').classList.add('hidden');
  }
}

function showDraftStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'draft-status' + (type ? ` draft-status-${type}` : '');
}

// === Compliance Helpers ===
function getComplianceBadgeHTML(score, size = 'normal') {
  const map = {
    'fully_compliant': { emoji: '&#x1F7E2;', label: '完全符合', cls: 'compliance-full' },
    'partially_compliant': { emoji: '&#x1F7E1;', label: '部分符合', cls: 'compliance-partial' },
    'non_compliant': { emoji: '&#x1F534;', label: '不符合', cls: 'compliance-fail' },
    'cannot_assess': { emoji: '&#x2B1C;', label: '無法評估', cls: 'compliance-na' }
  };
  const info = map[score] || map['cannot_assess'];
  if (size === 'small') {
    return `<span class="compliance-badge-sm ${info.cls}" title="${info.label}">${info.emoji}</span>`;
  }
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

  // Compliance contradiction note (Requirement #9)
  if (da.compliance_note) {
    html += `
      <div style="background:#fef9c3; border:1px solid #facc15; border-radius:8px; padding:14px 16px; margin:12px 0; font-size:13px; line-height:1.7; color:#713f12;">
        <strong>&#x26A0;&#xFE0F; 合規判定說明：</strong> ${da.compliance_note}
      </div>
    `;
  }

  // Gap summary
  if (da.gap_summary) {
    html += `<div class="compliance-gap">${da.gap_summary}</div>`;
  }

  // Matched items
  if (matched.length > 0) {
    html += `<div class="compliance-list-title">&#x2705; 已符合項目 (${matched.length})</div>
      <ul class="compliance-list matched">`;
    matched.forEach(m => { html += `<li>${m}</li>`; });
    html += `</ul>`;
  }

  // Missing items
  if (missing.length > 0) {
    html += `<div class="compliance-list-title">&#x274C; 缺口項目 (${missing.length})</div>
      <ul class="compliance-list missing">`;
    missing.forEach(m => { html += `<li>${m}</li>`; });
    html += `</ul>`;
  }

  // URL coverage
  if (urlAnalysis.length > 0) {
    html += `<div class="compliance-list-title">&#x1F517; 來源覆蓋率分析</div>
      <div class="url-analysis-grid">`;
    urlAnalysis.forEach(u => {
      const icon = u.relevant ? '&#x2705;' : '&#x26AA;';
      const shortUrl = (u.url || '').replace(/^https?:\/\//, '').substring(0, 50);
      html += `
        <div class="url-analysis-item ${u.relevant ? 'relevant' : 'irrelevant'}">
          <span class="url-icon">${icon}</span>
          <div class="url-info">
            <div class="url-path" title="${u.url}">${shortUrl}...</div>
            <div class="url-summary">${u.summary || ''}</div>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  // Recommendation
  if (da.recommendation) {
    html += `<div class="compliance-recommendation">
      <strong>&#x1F4A1; 建議:</strong> ${da.recommendation}
    </div>`;
  }

  html += `</div>`;
  return html;
}

// === Utils ===
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
