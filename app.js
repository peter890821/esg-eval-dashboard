/**
 * ESG Kanban Dashboard - Main Application Logic
 * ================================================
 * Loads merged indicator data (with optional AI suggestions),
 * renders Kanban board grouped by department, table view,
 * and detail modal.
 */

// === State ===
let allData = [];
let filteredData = [];
let currentView = 'kanban'; // 'kanban' or 'table'
let groupByField = '114_相關負責部門'; // Kanban grouping

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  applyFilters();
});

// === Data Loading ===
async function loadData() {
  try {
    // Try suggestions_output.json first, fallback to data.json
    let resp;
    try {
      resp = await fetch('suggestions_output.json');
      if (!resp.ok) throw new Error();
    } catch {
      resp = await fetch('data.json');
    }
    allData = await resp.json();

    // Filter out non-indicator rows (category headers, extra items)
    allData = allData.filter(d => d['編號'] && /^[ESG]-\d+$/.test(d['編號']));

    populateDeptFilter();
    renderStats();
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('kanbanBoard').innerHTML =
      '<div style="padding:40px;color:#f06565;">Failed to load data.json or suggestions_output.json</div>';
  }
}

// === Filters ===
function populateDeptFilter() {
  const depts = new Set();
  allData.forEach(d => {
    const dept = d['114_相關負責部門'];
    if (dept) depts.add(dept);
  });

  const sel = document.getElementById('filterDept');
  [...depts].sort().forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });
}

function applyFilters() {
  const face = document.getElementById('filterFace').value;
  const status = document.getElementById('filterStatus').value;
  const dept = document.getElementById('filterDept').value;
  const search = document.getElementById('searchInput').value.toLowerCase().trim();

  filteredData = allData.filter(d => {
    if (face && d['構面'] !== face) return false;
    if (status && d['狀態標記'] !== status) return false;
    if (dept && d['114_相關負責部門'] !== dept) return false;
    if (search) {
      const haystack = [
        d['編號'], d['評鑑指標'], d['指標說明'],
        d['114_自評來源及說明'], d['114_相關負責部門']
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
  const newCount = filteredData.filter(d => d['狀態標記'] === 'New_2026').length;
  const modCount = filteredData.filter(d => d['狀態標記'] === 'Modified_2026').length;
  const aiCount = filteredData.filter(d => d['ai_suggestion'] && !d['ai_suggestion'].error).length;

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
    ${aiCount > 0 ? `<span class="stat-item">
      <span class="stat-dot" style="background:var(--accent-purple)"></span>
      <span class="stat-count">${aiCount}</span> AI建議
    </span>` : ''}
  `;
}

// === Event Listeners ===
function setupEventListeners() {
  document.getElementById('filterFace').addEventListener('change', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);
  document.getElementById('filterDept').addEventListener('change', applyFilters);
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

// === Kanban Rendering ===
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  // Group by department
  const groups = new Map();

  // Unassigned group for items without dept
  filteredData.forEach(d => {
    const dept = d['114_相關負責部門'] || '待分配';
    if (!groups.has(dept)) groups.set(dept, []);
    groups.get(dept).push(d);
  });

  // Sort: 待分配 last, then alphabetically
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === '待分配') return 1;
    if (b === '待分配') return -1;
    return a.localeCompare(b, 'zh-TW');
  });

  sortedKeys.forEach(dept => {
    const items = groups.get(dept);
    const col = createColumn(dept, items);
    board.appendChild(col);
  });
}

function createColumn(title, items) {
  const col = document.createElement('div');
  col.className = 'kanban-column';

  const colorMap = {
    '永續辦': 'var(--env-color)',
    '董秘': 'var(--gov-color)',
    '財務': 'var(--accent-blue)',
    '人資': 'var(--soc-color)',
    '法務': 'var(--accent-orange)',
    '待分配': 'var(--text-muted)',
  };

  // Pick color based on first matching keyword
  let dotColor = 'var(--accent-cyan)';
  for (const [key, color] of Object.entries(colorMap)) {
    if (title.includes(key)) { dotColor = color; break; }
  }

  col.innerHTML = `
    <div class="kanban-column-header">
      <span class="kanban-column-title">
        <span class="column-color-dot" style="background:${dotColor}"></span>
        ${title}
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
  const isNew = item['狀態標記'] === 'New_2026';
  const scoreVal = item['114_得分數值'];
  const scoreText = item['114_自評得分'] || '';
  const hasAI = item['ai_suggestion'] && !item['ai_suggestion']?.error && !item['ai_suggestion']?.parse_error;

  let scoreClass = 'na';
  let scoreDisplay = '--';
  if (scoreVal === 1) { scoreClass = 'pass'; scoreDisplay = '1分'; }
  else if (scoreVal === 0) { scoreClass = 'fail'; scoreDisplay = '0分'; }
  else if (scoreText) { scoreDisplay = scoreText.substring(0, 6); scoreClass = 'pass'; }

  const title = (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 100);

  card.innerHTML = `
    <div class="card-header">
      <span class="card-id ${faceClass}">${id}</span>
      <span class="card-badge ${isNew ? 'new' : 'modified'}">${isNew ? 'NEW' : 'MOD'}</span>
    </div>
    <div class="card-title">${title}</div>
    <div class="card-footer">
      <span class="card-type">${item['題型'] || ''}</span>
      <span class="card-score ${scoreClass}">${isNew ? '(新增)' : scoreDisplay}</span>
    </div>
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

    const isNew = item['狀態標記'] === 'New_2026';
    const scoreVal = item['114_得分數值'];
    let scoreBadge = '--';
    if (isNew) scoreBadge = '<span style="color:var(--new-color)">(新增)</span>';
    else if (scoreVal === 1) scoreBadge = '<span style="color:var(--score-pass)">1分</span>';
    else if (scoreVal === 0) scoreBadge = '<span style="color:var(--score-fail)">0分</span>';

    const face = item['構面'] || '';
    const faceLabel = face === 'E' ? '環境' : face === 'S' ? '社會' : face === 'G' ? '治理' : face;

    tr.innerHTML = `
      <td><strong>${item['編號'] || ''}</strong></td>
      <td><span class="card-badge ${isNew ? 'new' : 'modified'}" style="font-size:11px">${isNew ? 'NEW' : 'MOD'}</span></td>
      <td>${faceLabel}</td>
      <td>${(item['評鑑指標'] || '').replace(/\n/g, ' ')}</td>
      <td>${item['題型'] || ''}</td>
      <td>${scoreBadge}</td>
      <td>${item['114_相關負責部門'] || '<span style="color:var(--text-muted)">待分配</span>'}</td>
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

  const isNew = item['狀態標記'] === 'New_2026';

  badge.textContent = isNew ? 'NEW 2026 新增指標' : 'MOD 2026 修正指標';
  badge.className = `modal-badge ${isNew ? 'new card-badge' : 'modified card-badge'}`;
  title.textContent = `${item['編號']} — ${(item['評鑑指標'] || '').replace(/\n/g, ' ')}`;

  // Score info
  const scoreVal = item['114_得分數值'];
  let scoreHtml = '';
  if (!isNew) {
    if (scoreVal === 1) scoreHtml = '<span class="score-badge pass">&#x2713; 得分</span>';
    else if (scoreVal === 0) scoreHtml = '<span class="score-badge fail">&#x2717; 未得分</span>';
    else scoreHtml = `<span class="score-badge pass">${item['114_自評得分'] || 'N/A'}</span>`;
  }

  let html = `
    <!-- Info Cards -->
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
          <div class="info-card-value">${item['114_相關負責部門'] || '待分配'}</div>
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

  // 114 Self-evaluation (only for Modified)
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
          <div class="ai-item-label">📚 官方參考與較佳案例</div>
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
  const headers = ['編號', '狀態標記', '構面', '評鑑指標', '題型',
    '114_自評得分', '114_相關負責部門', '114_自評來源及說明'];

  const bom = '\uFEFF';
  let csv = bom + headers.join(',') + '\n';

  filteredData.forEach(d => {
    const row = headers.map(h => {
      let val = d[h] || '';
      val = String(val).replace(/"/g, '""').replace(/\n/g, ' ');
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

// === Utils ===
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
