/**
 * ESG Kanban Dashboard - Main Application Logic
 * ================================================
 * Loads merged indicator data (with optional AI suggestions),
 * renders Kanban board grouped by department, table view,
 * and detail modal. Supports write-back to Google Sheets.
 */

// === Config ===
// 🔧 貼上你的 GAS Web App URL（部署後取得）
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxijoVvZzODBf0zQ6libnIhSEP6_DZ9V3dIY1hScHOsWDl3iPnT1KHhSU_BsJrTZjc2/exec';
const ALLOWED_EMAIL_DOMAIN = 'taiwancement.com';

// === State ===
let allData = [];
let filteredData = [];
let currentView = 'kanban'; // 'kanban' or 'table'
let groupByField = '114_相關負責部門'; // Kanban grouping
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
    // try suggestions_output.json first, fallback to data.json
    // Use timestamp to prevent caching old JSON files without compliance data
    const ts = Date.now();
    let resp;
    try {
      resp = await fetch(`suggestions_output.json?t=${ts}`);
      if (!resp.ok) throw new Error();
    } catch {
      resp = await fetch(`data.json?t=${ts}`);
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
  const compliance = document.getElementById('filterCompliance').value;
  const dept = document.getElementById('filterDept').value;
  const search = document.getElementById('searchInput').value.toLowerCase().trim();

  filteredData = allData.filter(d => {
    if (face && d['構面'] !== face) return false;
    if (status && d['狀態標記'] !== status) return false;
    if (dept && d['114_相關負責部門'] !== dept) return false;

    if (compliance) {
      const score = d.disclosure_analysis && d.disclosure_analysis.compliance_score ? d.disclosure_analysis.compliance_score : 'cannot_assess';
      if (compliance === 'low') {
        if (score !== 'partially_compliant' && score !== 'non_compliant') return false;
      } else {
        if (score !== compliance) return false;
      }
    }

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
  document.getElementById('filterCompliance').addEventListener('change', applyFilters);
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
  const da = item['disclosure_analysis'];
  const complianceBadge = da ? getComplianceBadgeHTML(da.compliance_score, 'small') : '';

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
      ${complianceBadge}
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

  // === 📊 揭露合規分析 ===
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

  // === 📝 自評草稿區塊 ===
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
            <span class="draft-btn-text">📤 送出到 Google Sheets</span>
            <span class="draft-btn-loading hidden">⏳ 送出中...</span>
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
    { header: '狀態標記', get: d => d['狀態標記'] },
    { header: '構面', get: d => d['構面'] },
    { header: '評鑑指標', get: d => d['評鑑指標'] },
    { header: '115年指標說明', get: d => d['指標說明'] },
    { header: '114_相關負責部門', get: d => d['114_相關負責部門'] },
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
        if (da.compliance_score === 'fully_compliant') statusStr = '🟢 完全符合';
        else if (da.compliance_score === 'partially_compliant') statusStr = '🟡 部分符合';
        else if (da.compliance_score === 'non_compliant') statusStr = '🔴 不符合';
        else statusStr = '⚪ 無法評估';

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
    showDraftStatus(statusEl, '❌ 請填入公司信箱', 'error');
    return;
  }
  if (!email.endsWith('@' + ALLOWED_EMAIL_DOMAIN)) {
    showDraftStatus(statusEl, `❌ 僅限 @${ALLOWED_EMAIL_DOMAIN} 信箱`, 'error');
    return;
  }
  if (!text) {
    showDraftStatus(statusEl, '❌ 請填入自評草稿內容', 'error');
    return;
  }
  if (!GAS_URL) {
    showDraftStatus(statusEl, '⚠️ 尚未設定 Google Sheets 連結 (GAS_URL)', 'error');
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
  const payload = {
    '編號': item['編號'] || '',
    '構面': item['構面'] || '',
    '評鑑指標': (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 200),
    '負責部門': item['114_相關負責部門'] || '',
    '自評草稿': text,
    '填寫人信箱': email,
    '填寫人姓名': name
  };

  try {
    // Google Apps Script is tricky with CORS. The most reliable way from a static page
    // is to send it as form data with no-cors. The response will be opaque.
    const formData = new URLSearchParams();
    formData.append('編號', item['編號'] || '');
    formData.append('構面', item['構面'] || '');
    formData.append('評鑑指標', (item['評鑑指標'] || '').replace(/\n/g, ' ').substring(0, 200));
    formData.append('負責部門', item['114_相關負責部門'] || '');
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

    // no-cors always succeeds if the network request goes through, but we can't read the response
    showDraftStatus(statusEl, '✅ 已成功送出！資料已寫入 Google Sheets', 'success');
    document.getElementById('draftText').value = '';

  } catch (err) {
    console.error('Submit error:', err);
    showDraftStatus(statusEl, `❌ 網路錯誤：${err.message || '無法連線到伺服器'}`, 'error');
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
