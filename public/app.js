const API_BASE = '/api';
let authToken = localStorage.getItem('qnotes_token');
let currentUser = null;
let editorInstance = null;
let currentNoteId = null;
let isEditing = false;
let lockTimer = null;
let isDirty = false; // 编辑内容是否有修改
let autosaveTimer = null; // 自动保存定时器
let autosaveEnabled = true; // 自动保存开关，默认开启
let isSaving = false; // 是否正在保存（用于指示灯）
let lastSaveHadError = false; // 上次保存是否报错
let currentKeywords = []; // 当前笔记关键词
let activeSidebarTab = 'notes'; // 'notes' | 'keywords'
let searchDebounceTimer = null;
let isSearchOpen = false;
let lastRenderedEditorData = null; // 最近一次渲染到编辑器的数据

// 自动保存进度圈相关
let autosaveIntervalMs = 60000;
let autosaveCountdownTick = null;
let lastAutosaveTickTs = 0; // 上一次自动保存触发的时间基点（用于计算下次剩余）

// 连接心跳与状态
let netOnline = navigator.onLine;
let authValid = !!authToken;
let netHbTimer = null;
let authHbTimer = null;
let netBackoff = 0;
let authBackoff = 0;
const NET_BASE_VISIBLE_MS = 15000;
const NET_BASE_HIDDEN_MS = 60000;
const AUTH_BASE_VISIBLE_MS = 60000;
const AUTH_BASE_HIDDEN_MS = 300000; // 5 分钟
const NET_TIMEOUT_MS = 3000;
const AUTH_TIMEOUT_MS = 4000;

function getElSafe(id) { try { return document.getElementById(id); } catch (_) { return null; } }

function updateConnIndicators() {
  const netDot = getElSafe('net-dot');
  const netText = getElSafe('net-text');
  const authDot = getElSafe('auth-dot');
  const authText = getElSafe('auth-text');
  if (netDot) {
    netDot.classList.remove('ok', 'warn', 'error', 'offline');
    netDot.classList.add(netOnline ? 'ok' : 'offline');
  }
  if (netText) {
    netText.textContent = netOnline ? '网络正常' : '网络不可用';
  }
  if (authDot) {
    authDot.classList.remove('ok', 'warn', 'error', 'offline');
    // 仅在网络可用且持有token时评估鉴权；否则置为灰
    if (!netOnline || !authToken) {
      authDot.classList.add('offline');
    } else {
      authDot.classList.add(authValid ? 'ok' : 'error');
    }
  }
  if (authText) {
    if (!authToken) {
      authText.textContent = '未登录';
    } else if (!netOnline) {
      authText.textContent = '无法校验';
    } else {
      authText.textContent = authValid ? '鉴权有效' : '鉴权失效';
    }
  }
}

function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const merged = { ...options, signal: controller.signal, cache: 'no-store', keepalive: true };
  return fetch(url, merged).finally(() => clearTimeout(id));
}

function currentNetInterval() {
  const base = document.visibilityState === 'visible' ? NET_BASE_VISIBLE_MS : NET_BASE_HIDDEN_MS;
  const delay = base * Math.pow(2, Math.min(4, netBackoff));
  return Math.min(delay, 5 * 60 * 1000);
}
function currentAuthInterval() {
  const base = document.visibilityState === 'visible' ? AUTH_BASE_VISIBLE_MS : AUTH_BASE_HIDDEN_MS;
  const delay = base * Math.pow(2, Math.min(4, authBackoff));
  return Math.min(delay, 10 * 60 * 1000);
}

function scheduleNetHeartbeat(delay) {
  if (netHbTimer) clearTimeout(netHbTimer);
  netHbTimer = setTimeout(runNetHeartbeat, Math.max(500, delay));
}
async function runNetHeartbeat() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/../healthz`, { method: 'GET' }, NET_TIMEOUT_MS);
    if (res && (res.status === 204 || res.ok)) {
      netOnline = true;
      netBackoff = 0;
    } else {
      netOnline = false;
      netBackoff = Math.min(4, netBackoff + 1);
    }
  } catch (_) {
    netOnline = false;
    netBackoff = Math.min(4, netBackoff + 1);
  } finally {
    updateConnIndicators();
    scheduleNetHeartbeat(currentNetInterval());
  }
}

function scheduleAuthHeartbeat(delay) {
  if (authHbTimer) clearTimeout(authHbTimer);
  authHbTimer = setTimeout(runAuthHeartbeat, Math.max(500, delay));
}
async function runAuthHeartbeat() {
  // 仅在网络可用且存在token时执行
  if (!authToken || !netOnline) {
    updateConnIndicators();
    scheduleAuthHeartbeat(currentAuthInterval());
    return;
  }
  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetchWithTimeout(`${API_BASE}/auth/ping`, { method: 'GET', headers }, AUTH_TIMEOUT_MS);
    if (res && res.status === 204) {
      authValid = true;
      authBackoff = 0;
    } else if (res && (res.status === 401 || res.status === 403)) {
      authValid = false;
      authBackoff = 0; // 立即保持较短探测，提示尽快恢复
    } else {
      // 其他错误视作暂时失败，退避
      authBackoff = Math.min(4, authBackoff + 1);
    }
  } catch (_) {
    // 网络错误也会影响网络状态判断
    netOnline = false;
    authBackoff = Math.min(4, authBackoff + 1);
  } finally {
    updateConnIndicators();
    scheduleAuthHeartbeat(currentAuthInterval());
  }
}

function startHeartbeat() {
  updateConnIndicators();
  scheduleNetHeartbeat(500);
  scheduleAuthHeartbeat(1000);
}
function stopHeartbeat() {
  if (netHbTimer) { clearTimeout(netHbTimer); netHbTimer = null; }
  if (authHbTimer) { clearTimeout(authHbTimer); authHbTimer = null; }
}

function getEl(id) {
  return document.getElementById(id);
}

function setSaveIndicator(status, text) {
  const indicator = getEl('save-indicator');
  const label = getEl('save-status-text');
  if (indicator) {
    indicator.classList.remove('status-ok', 'status-saving', 'status-error');
    indicator.classList.add(status);
  }
  if (label && typeof text === 'string') {
    label.textContent = text;
  }
}

function setAutosaveProgress(deg, showCountdown, secondsLeft) {
  const indicator = getEl('save-indicator');
  const textEl = getEl('save-countdown-text');
  if (!indicator) return;
  // 0-360 度
  const clamped = Math.max(0, Math.min(360, deg || 0));
  indicator.style.setProperty('--progress', clamped + 'deg');
  if (showCountdown) {
    indicator.setAttribute('data-counting', 'true');
    if (textEl) {
      const secs = Math.max(0, Math.ceil((secondsLeft || 0)));
      textEl.textContent = String(secs);
    }
  } else {
    indicator.removeAttribute('data-counting');
    if (textEl) textEl.textContent = '';
  }
}

function computeRemainingMs(nowTs) {
  const now = typeof nowTs === 'number' ? nowTs : Date.now();
  if (!lastAutosaveTickTs) return autosaveIntervalMs;
  const elapsed = now - lastAutosaveTickTs;
  const cycleElapsed = elapsed % autosaveIntervalMs;
  return Math.max(0, autosaveIntervalMs - cycleElapsed);
}

function updateAutosaveCountdownUI() {
  // 仅在需要时展示：开启自动保存 + 有编辑 + 有未保存更改 + 有笔记
  const shouldShow = autosaveEnabled && isEditing && isDirty && !!currentNoteId;
  if (!shouldShow) {
    setAutosaveProgress(0, false, 0);
    return;
  }
  const remaining = computeRemainingMs();
  const ratio = remaining / autosaveIntervalMs; // 1 -> 0
  const deg = Math.round(ratio * 360);
  setAutosaveProgress(deg, true, remaining / 1000);
}

function startAutosaveCountdown() {
  // 启动或重启进度刷新
  stopAutosaveCountdown();
  // 立即刷新一次，避免1秒延迟空白
  updateAutosaveCountdownUI();
  autosaveCountdownTick = setInterval(updateAutosaveCountdownUI, 250);
}

function stopAutosaveCountdown() {
  if (autosaveCountdownTick) {
    clearInterval(autosaveCountdownTick);
    autosaveCountdownTick = null;
  }
  setAutosaveProgress(0, false, 0);
}

function renderEditorDataAsStaticHTML(data) {
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.boxSizing = 'border-box';

  function append(el) { container.appendChild(el); }
  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  (data.blocks || []).forEach(function (block, idx) {
    const type = block && block.type;
    const d = (block && block.data) || {};
    let el;
    switch (type) {
      case 'header': {
        const level = Math.min(Math.max(parseInt(d.level || 2, 10), 1), 6);
        el = document.createElement('h' + String(level));
        el.innerHTML = d.text || '';
        el.style.margin = '16px 0 8px';
        append(el);
        break;
      }
      case 'paragraph': {
        el = createEl('p');
        // EditorJS paragraph 允许内联 HTML
        el.innerHTML = d.text || '';
        el.style.margin = '8px 0';
        append(el);
        break;
      }
      case 'checklist': {
        const ul = createEl('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        (Array.isArray(d.items) ? d.items : []).forEach(function (item) {
          const li = createEl('li');
          li.style.margin = '4px 0';
          const mark = item && item.checked ? '☑ ' : '☐ ';
          li.textContent = mark + (item && item.text ? item.text : '');
          ul.appendChild(li);
        });
        append(ul);
        break;
      }
      case 'quote': {
        const bq = createEl('blockquote');
        bq.style.margin = '12px 0';
        bq.style.padding = '8px 12px';
        bq.style.borderLeft = '4px solid #e5e7eb';
        const p = createEl('p');
        p.innerHTML = d.text || '';
        bq.appendChild(p);
        if (d.caption) {
          const cite = createEl('cite', null, d.caption);
          cite.style.display = 'block';
          cite.style.textAlign = 'right';
          cite.style.color = '#6b7280';
          bq.appendChild(cite);
        }
        append(bq);
        break;
      }
      case 'delimiter': {
        append(createEl('hr'));
        break;
      }
      case 'image': {
        const url = (d && d.file && d.file.url) || d.url || '';
        if (url) {
          const fig = createEl('figure');
          const img = document.createElement('img');
          // 规范化为绝对 URL，避免相对路径在 html2canvas 解析异常
          const abs = /^https?:\/\//i.test(url) ? url : (window.location.origin + url);
          img.src = abs;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          fig.appendChild(img);
          if (d.caption) {
            const cap = createEl('figcaption');
            cap.textContent = d.caption;
            cap.style.color = '#6b7280';
            cap.style.fontSize = '12px';
            fig.appendChild(cap);
          }
          append(fig);
        }
        break;
      }
      case 'table': {
        const content = Array.isArray(d.content) ? d.content : [];
        const table = createEl('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        content.forEach(function (row) {
          const tr = createEl('tr');
          (Array.isArray(row) ? row : []).forEach(function (cell) {
            const td = createEl('td');
            td.innerHTML = cell || '';
            td.style.border = '1px solid #ddd';
            td.style.padding = '6px 8px';
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        append(table);
        break;
      }
      case 'code': {
        const pre = createEl('pre');
        const code = createEl('code');
        code.textContent = d.code || '';
        pre.appendChild(code);
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        pre.style.background = '#f5f5f5';
        pre.style.padding = '10px';
        pre.style.borderRadius = '6px';
        append(pre);
        break;
      }
      case 'mermaid': {
        // 简化：以代码形式输出（可后续增强为克隆现有 SVG）
        const pre = createEl('pre');
        pre.textContent = d.code || d.text || '';
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        pre.style.background = '#f5f5f5';
        pre.style.padding = '10px';
        pre.style.borderRadius = '6px';
        append(pre);
        break;
      }
      case 'attaches': {
        const url = d && d.file && d.file.url;
        const name = d && (d.title || d.name || (d.file && d.file.name) || '附件');
        const a = createEl('a');
        if (url) {
          a.href = url;
          a.textContent = name + '  bb';
        } else {
          a.textContent = name;
        }
        append(a);
        break;
      }
      case 'warehouse': {
        // 暂时以 JSON 输出
        const pre = createEl('pre');
        pre.textContent = JSON.stringify(d, null, 2);
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.background = '#f5f5f5';
        pre.style.padding = '10px';
        pre.style.borderRadius = '6px';
        append(pre);
        break;
      }
      default: {
        const pre = createEl('pre');
        pre.textContent = '[' + String(type || 'unknown') + ']\n' + JSON.stringify(d, null, 2);
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.background = '#f5f5f5';
        pre.style.padding = '10px';
        pre.style.borderRadius = '6px';
        append(pre);
      }
    }
  });

  return container;
}

function addCanvasToPdfPaged(canvas, doc, marginMm) {
  const pageWidthMm = doc.internal.pageSize.getWidth();
  const pageHeightMm = doc.internal.pageSize.getHeight();
  const margin = typeof marginMm === 'number' ? marginMm : 10;
  const availableWidthMm = pageWidthMm - margin * 2;
  const availableHeightMm = pageHeightMm - margin * 2;

  const imgWidthPx = canvas.width;
  const imgHeightPx = canvas.height;
  const scaleMmPerPx = availableWidthMm / imgWidthPx; // 保持等比，按宽度适配
  const sliceHeightPx = Math.floor(availableHeightMm / scaleMmPerPx);

  let yPx = 0;
  let isFirstPage = true;
  while (yPx < imgHeightPx) {
    const currentSlicePx = Math.min(sliceHeightPx, imgHeightPx - yPx);
    // 切片
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = imgWidthPx;
    sliceCanvas.height = currentSlicePx;
    const ctx = sliceCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, yPx, imgWidthPx, currentSlicePx, 0, 0, imgWidthPx, currentSlicePx);
    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);

    if (!isFirstPage) doc.addPage();
    doc.addImage(imgData, 'JPEG', margin, margin, availableWidthMm, currentSlicePx * scaleMmPerPx);

    isFirstPage = false;
    yPx += currentSlicePx;
  }
}

function markDirty() {
  isDirty = true;
  // 仅在非错误且非保存中时显示有改动提示
  if (!isSaving && !lastSaveHadError) {
    setSaveIndicator('status-ok', '有未保存更改');
  }
  // 有改动时开始显示倒计时（若开启自动保存）
  if (autosaveEnabled) {
    if (!lastAutosaveTickTs) lastAutosaveTickTs = Date.now();
    startAutosaveCountdown();
  }
}

function resetDirtyFlag() {
  isDirty = false;
}

function normalizeAttachesTitles(data) {
  if (!data || !Array.isArray(data.blocks)) return data;
  data.blocks.forEach(function (block) {
    if (!block || block.type !== 'attaches') return;
    const d = block.data || {};
    const hasTitle = typeof d.title === 'string' && d.title.trim().length > 0;
    if (!hasTitle) {
      const file = d.file || {};
      const candidateName = (typeof file.name === 'string' && file.name) || (typeof d.name === 'string' && d.name) || '';
      if (candidateName) {
        d.title = candidateName;
      }
    }
    block.data = d;
  });
  return data;
}

async function persistNote({ silent = false, reason = 'manual' } = {}) {
  if (!currentNoteId || !editorInstance) return;
  // 保存前复位 flag（按需求）
  const wasDirty = isDirty;
  resetDirtyFlag();

  try {
    isSaving = true;
    setSaveIndicator('status-saving', '保存中…');

    await editorInstance.isReady;
    let data = await editorInstance.save();
    // 在保存前规范化附件块的标题：若未填写，则使用上传文件名
    data = normalizeAttachesTitles(data);
    const title = getEl('note-title').value || '无标题笔记';

    await request(`/notes/${currentNoteId}`, {
      method: 'PUT',
      body: { title, content: data, keywords: currentKeywords }
    });

    isSaving = false;
    lastSaveHadError = false;
    setSaveIndicator('status-ok', '已保存');
    // 保存成功后，如无未保存更改则隐藏倒计时
    updateAutosaveCountdownUI();
  } catch (err) {
    // 失败：回退脏标记，指示灯红色
    if (wasDirty) {
      isDirty = true;
    }
    isSaving = false;
    lastSaveHadError = true;
    setSaveIndicator('status-error', '保存失败');
    if (!silent) {
      showMessage('保存失败: ' + err.message, 'error');
      throw err;
    }
  }
}

function startAutosaveTimer() {
  stopAutosaveTimer();
  if (!autosaveEnabled) return;
  // 基点：当前时刻起算一个周期
  lastAutosaveTickTs = Date.now();
  startAutosaveCountdown();
  autosaveTimer = setInterval(async () => {
    if (!autosaveEnabled) return;
    if (!currentNoteId || !isEditing || !editorInstance) return;
    if (!isDirty) return;
    // 触发点：进入下一周期
    lastAutosaveTickTs = Date.now();
    await persistNote({ silent: true, reason: 'autosave' });
  }, 60000);
}

function stopAutosaveTimer() {
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
  stopAutosaveCountdown();
}

async function request(path, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
    });
    // 连接成功，标记网络可达
    netOnline = true;
    if (res.status === 401 || res.status === 403) {
      authValid = false;
      updateConnIndicators();
    }
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || res.statusText);
    }
    if (res.status === 204) return null;
    // 成功的受保护接口可视作鉴权有效
    if (path !== '/auth/ping' && path !== '/../healthz' && authToken) {
      authValid = true;
      updateConnIndicators();
    }
    return res.json();
  } catch (err) {
    // 可能的网络错误
    if (err && (err.name === 'TypeError' || /NetworkError|Failed to fetch|load failed|abort/i.test(String(err && err.message)))) {
      netOnline = false;
      updateConnIndicators();
    }
    throw err;
  }
}

// 移动笔记到新父节点（null 表示移动到根）
async function moveNote(sourceId, newParentId) {
  try {
    await request(`/notes/${sourceId}/move`, {
      method: 'POST',
      body: { parent_id: newParentId == null ? null : newParentId }
    });
    await loadTree();
    if (currentNoteId) {
      // 重新高亮当前选中项
      const el = document.querySelector(`#note-tree li[data-id="${currentNoteId}"]`);
      if (el) el.classList.add('active');
    }
    showMessage('移动成功', 'success');
  } catch (err) {
    showMessage('移动失败: ' + (err && err.message ? err.message : '未知错误'), 'error');
  }
}

function setUserInfo(user) {
  currentUser = user;
  const userSpan = document.getElementById('current-user');
  if (userSpan) {
    userSpan.textContent = user ? `欢迎，${user.username}` : '';
  }
  const userInfoWrap = document.querySelector('.user-info');
  const existingAdminLink = document.getElementById('admin-link');
  if (user && user.is_admin) {
    if (!existingAdminLink && userInfoWrap) {
      const a = document.createElement('a');
      a.id = 'admin-link';
      a.className = 'tab';
      a.href = 'admin.html';
      a.textContent = '管理';
      userInfoWrap.insertBefore(a, userInfoWrap.firstChild);
    }
  } else if (existingAdminLink && existingAdminLink.parentNode) {
    existingAdminLink.parentNode.removeChild(existingAdminLink);
  }
}

function buildTreeList(nodes, parentEl, depth = 0) {
  nodes.forEach((node) => {
    const li = document.createElement('li');
    li.dataset.id = node.id;
    li.className = 'tree-item';
    li.setAttribute('draggable', 'true');
    
    // 创建树形结构的HTML
    const hasChildren = node.children && node.children.length > 0;
    const indent = '  '.repeat(depth); // 使用空格缩进
    const expandIcon = hasChildren ? '▶' : '  '; // 展开/折叠图标
    
    li.innerHTML = `
      <div class="tree-item-content" style="padding-left: ${depth * 1.5}rem;">
        <span class="expand-icon">${expandIcon}</span>
        <span class="title">${node.title}</span>
      </div>
    `;

    // 拖拽事件
    li.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      try { e.dataTransfer.setData('text/plain', String(node.id)); } catch (_) {}
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      li.classList.remove('drag-over');
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over');
    });
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove('drag-over');
      const data = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      const sourceId = parseInt(data, 10);
      const targetId = node.id;
      if (!sourceId || sourceId === targetId) return;
      await moveNote(sourceId, targetId);
    });
    
    // 点击事件处理
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // 如果点击的是展开图标，切换展开/折叠状态
      if (e.target.classList.contains('expand-icon') && hasChildren) {
        const childUl = li.querySelector('.note-tree-children');
        const expandIcon = li.querySelector('.expand-icon');
        
        if (childUl.style.display === 'none') {
          childUl.style.display = 'block';
          expandIcon.textContent = '▼';
        } else {
          childUl.style.display = 'none';
          expandIcon.textContent = '▶';
        }
        return;
      }
      
      // 否则选择笔记
      selectNote(node.id, li);
    });
    
    parentEl.appendChild(li);
    
    // 如果有子节点，递归创建
    if (hasChildren) {
      const childUl = document.createElement('ul');
      childUl.className = 'note-tree-children';
      childUl.style.display = 'none'; // 默认折叠
      li.appendChild(childUl);
      buildTreeList(node.children, childUl, depth + 1);
    }
  });
}
function getExpandedNodes() {
  const expanded = new Set();
  document.querySelectorAll('#note-tree .note-tree-children').forEach(ul => {
    if (ul.style.display === 'block') {
      const li = ul.closest('li');
      if (li) expanded.add(li.dataset.id);
    }
  });
  return expanded;
}
function restoreExpandedNodes(expanded) {
  expanded.forEach(id => {
    const li = document.querySelector(`#note-tree li[data-id="${id}"]`);
    if (li) {
      const ul = li.querySelector('.note-tree-children');
      if (ul) {
        ul.style.display = 'block';
        const icon = li.querySelector('.expand-icon');
        if (icon) icon.textContent = '▼';
      }
    }
  });
}
async function loadTree() {
  if (activeSidebarTab === 'keywords') {
    return loadKeywordsIndex();
  }
  const expanded = getExpandedNodes();
  try {
    const data = await request('/notes');
    const treeEl = document.getElementById('note-tree');
    treeEl.innerHTML = '';
    buildTreeList(data.tree, treeEl);
    restoreExpandedNodes(expanded);
    if (!currentNoteId) {
      const firstId = findFirstNoteId(data.tree);
      if (firstId) {
        await selectNote(firstId);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadKeywordsIndex() {
  try {
    const data = await request('/keywords');
    const treeEl = document.getElementById('note-tree');
    treeEl.innerHTML = '';
    buildKeywordIndexList(data.index, treeEl);
  } catch (err) {
    console.error(err);
  }
}

function findFirstNoteId(nodes) {
  if (!nodes || !nodes.length) return null;
  const [first] = nodes;
  if (first) {
    return first.id || findFirstNoteId(first.children);
  }
  return null;
}

async function selectNote(id, element) {
  // 切换笔记前询问保存
  if (id !== currentNoteId && isDirty) {
    const ok = confirm('检测到未保存的更改，是否保存当前笔记？');
    if (ok) {
      await persistNote({ silent: false, reason: 'switch-note' });
    } else {
      resetDirtyFlag();
    }
  }
  if (isEditing) {
    await stopEditing();
  }
  currentNoteId = id;
  document.querySelectorAll('#note-tree li').forEach((li) => li.classList.remove('active'));
  if (element) {
    element.classList.add('active');
  } else {
    const el = document.querySelector(`#note-tree li[data-id="${id}"]`);
    if (el) el.classList.add('active');
  }
  await loadNote(id);
}

async function loadNote(id) {
  try {
    const { note } = await request(`/notes/${id}`);
    document.getElementById('note-title').value = note.title;
    currentKeywords = Array.isArray(note.keywords) ? note.keywords : [];
    renderKeywords();
    
    // 如果编辑器未初始化，先初始化
    if (!editorInstance) {
      console.log('初始化编辑器以加载笔记...');
      setupEditor();
    }
    
    await editorInstance.isReady;
    
    // 清理数据，只保留支持的工具类型
    let data = note.content && Object.keys(note.content).length ? note.content : { blocks: [] };
    if (data.blocks) {
      data.blocks = data.blocks.filter(block => {
        // 只保留支持的工具类型
        return block.type === 'header' || block.type === 'paragraph' ||
               block.type === 'checklist' || block.type === 'quote' ||
               block.type === 'delimiter' || block.type === 'image' ||
               block.type === 'table' || block.type === 'code' ||
               block.type === 'mermaid' || block.type === 'attaches'||
               block.type === 'warehouse' || block.type === 'password';
      });
    }
    
    editorInstance.render(data);
    lastRenderedEditorData = data;
    resetDirtyFlag();
    if (!lastSaveHadError) setSaveIndicator('status-ok', '已就绪');
    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) deleteBtn.disabled = false;
    
    // 检查笔记是否被其他用户锁定
    if (note.lock_user_id && parseInt(note.lock_user_id) !== parseInt(currentUser.id)) {
      showLockInfo(`${note.lock_username} 正在编辑此笔记`);
      document.getElementById('save-btn').disabled = true;
      isEditing = false;
      if (lockTimer) {
        clearInterval(lockTimer);
        lockTimer = null;
      }
    } else {
      hideLockInfo();
      setReadOnly(true);
      document.getElementById('save-btn').disabled = true;
      isEditing = false;
    }
  } catch (err) {
    console.error(err);
  }
}

function resetEditorState() {
  setReadOnly(true);
  isEditing = false;
  document.getElementById('save-btn').disabled = true;
  hideLockInfo();
  if (lockTimer) {
    clearInterval(lockTimer);
    lockTimer = null;
  }
}

async function setReadOnly(readOnly) {
  try {
    if (!editorInstance) {
      console.warn('编辑器实例不存在');
      return;
    }
    
    await editorInstance.isReady;
    
    const currentState = await editorInstance.readOnly.isEnabled;
    if (currentState !== readOnly) {
      await editorInstance.readOnly.toggle();
      console.log('编辑器只读状态已切换到:', readOnly);
    } else {
      console.log('编辑器只读状态已为:', readOnly);
    }
    updateReadOnlySwitch();
  } catch (err) {
    console.error('设置只读状态失败:', err);
  }
}

async function updateReadOnlySwitch() {
  try {
    const chk = document.getElementById('readonly-toggle');
    if (!chk || !editorInstance) return;
    await editorInstance.isReady;
    const enabled = await editorInstance.readOnly.isEnabled;
    // 反转映射：checked 表示“编辑模式”，未勾选表示“只读模式”
    chk.checked = !enabled;
  } catch (err) {
    // 忽略按钮状态更新错误
  }
}

function showLockInfo(message) {
  const el = document.getElementById('lock-info');
  el.textContent = message;
  el.classList.remove('hidden');
  // 确保编辑器保持只读状态
  setReadOnly(true);
  const roChk = document.getElementById('readonly-toggle');
  if (roChk) roChk.disabled = true;
}

function hideLockInfo() {
  document.getElementById('lock-info').classList.add('hidden');
  const roChk = document.getElementById('readonly-toggle');
  if (roChk) roChk.disabled = false;
}

function showMessage(message, type = 'info') {
  // 创建消息提示
  const messageDiv = document.createElement('div');
  messageDiv.className = `message message-${type}`;
  messageDiv.textContent = message;
  
  // 添加到页面顶部
  document.body.insertBefore(messageDiv, document.body.firstChild);
  
  // 3秒后自动移除
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.parentNode.removeChild(messageDiv);
    }
  }, 3000);
}

async function startEditing() {
  if (!currentNoteId) {
    console.log('没有选择笔记');
    return;
  }
  
  try {
    // 如果编辑器未初始化，先初始化编辑器
    if (!editorInstance) {
      console.log('初始化编辑器...');
      setupEditor();
      await editorInstance.isReady;
      console.log('编辑器初始化完成');
    }
    
    // 等待编辑器准备就绪
    await editorInstance.isReady;
    console.log('编辑器已准备就绪');
    
    // 启动编辑模式
    isEditing = true;
    setReadOnly(false);
    document.getElementById('save-btn').disabled = false;
    hideLockInfo();
    startAutosaveTimer();
    
    console.log('编辑模式已启动');
  } catch (err) {
    console.error('启动编辑模式失败:', err);
    showMessage('启动编辑模式失败: ' + err.message, 'error');
  }
}

async function refreshLockStatus() {
  if (!currentNoteId || !isEditing) return;
  try {
    await request(`/notes/${currentNoteId}/lock`, { method: 'POST', body: {} });
  } catch (err) {
    console.warn('刷新锁失败', err);
  }
}

async function stopEditing() {
  if (!currentNoteId || !isEditing) return;
  try {
    // 暂时绕过解锁操作
    console.log('停止编辑（绕过解锁）');
  } catch (err) {
    console.warn('停止编辑失败', err);
  }
  resetEditorState();
  stopAutosaveTimer();
}

async function saveNote() {
  if (!currentNoteId) {
    showMessage('请先选择笔记', 'warning');
    return;
  }
  
  if (!editorInstance) {
    showMessage('编辑器未初始化', 'error');
    return;
  }
  
  try {
    console.log('保存笔记:', currentNoteId);
    await persistNote({ silent: false, reason: 'manual' });
    await stopEditing();
    await loadTree();
    await selectNote(currentNoteId);
    showMessage('笔记保存成功', 'success');
    console.log('笔记保存成功');
  } catch (err) {
    console.error('保存失败:', err);
    showMessage('保存失败: ' + err.message, 'error');
  }
}

async function createNote() {
  let parentUl;
  let parentLi = null;
  let childDepth = 0;
  if (currentNoteId) {
    parentLi = document.querySelector(`#note-tree li[data-id="${currentNoteId}"]`);
    if (!parentLi) return;
    const parentContent = parentLi.querySelector('.tree-item-content');
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const parentPaddingPx = parseFloat(getComputedStyle(parentContent).paddingLeft);
    const parentPaddingRem = parentPaddingPx / rootFontSize;
    childDepth = Math.round(parentPaddingRem / 1.5) + 1;
    parentUl = parentLi.querySelector('.note-tree-children');
    if (!parentUl) {
      parentUl = document.createElement('ul');
      parentUl.className = 'note-tree-children';
      parentUl.style.display = 'block';
      parentLi.appendChild(parentUl);
      const expandIcon = parentLi.querySelector('.expand-icon');
      if (expandIcon) expandIcon.textContent = '▼';
    } else if (parentUl.style.display === 'none') {
      parentUl.style.display = 'block';
      const expandIcon = parentLi.querySelector('.expand-icon');
      if (expandIcon) expandIcon.textContent = '▼';
    }
  } else {
    parentUl = document.getElementById('note-tree');
    childDepth = 0;
  }
  const tempLi = document.createElement('li');
  tempLi.className = 'tree-item';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'tree-item-content';
  contentDiv.style.paddingLeft = `${childDepth * 1.5}rem`;
  const expandSpan = document.createElement('span');
  expandSpan.className = 'expand-icon';
  expandSpan.textContent = '  ';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'new-title-input';
  input.placeholder = '输入标题...';
  contentDiv.appendChild(expandSpan);
  contentDiv.appendChild(input);
  tempLi.appendChild(contentDiv);
  parentUl.appendChild(tempLi);
  input.focus();
  const handleSave = async () => {
    const title = input.value.trim();
    if (!title) {
      parentUl.removeChild(tempLi);
      cleanupIfEmpty(parentLi);
      return;
    }
    try {
      const { note } = await request('/notes', {
        method: 'POST',
        body: { title, parent_id: currentNoteId || null }
      });
      await loadTree();
      await selectNote(note.id);
    } catch (err) {
      console.error(err);
      parentUl.removeChild(tempLi);
      cleanupIfEmpty(parentLi);
      showMessage('创建失败', 'error');
    }
  };
  const handleDiscard = () => {
    parentUl.removeChild(tempLi);
    cleanupIfEmpty(parentLi);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.removeEventListener('blur', handleDiscard);
      handleSave();
    }
  });
  input.addEventListener('blur', handleDiscard);
  tempLi.addEventListener('click', (e) => e.stopPropagation());
}

function cleanupIfEmpty(li) {
  if (!li) return;
  const ul = li.querySelector('.note-tree-children');
  if (ul && ul.children.length === 0) {
    li.removeChild(ul);
    const expandIcon = li.querySelector('.expand-icon');
    if (expandIcon) expandIcon.textContent = '  ';
  }
}

async function clearEditor() {
  if (!editorInstance) {
    showMessage('编辑器未初始化', 'error');
    return;
  }
  
  try {
    await editorInstance.isReady;
    // 清空编辑器内容
    editorInstance.clear();
    lastRenderedEditorData = { blocks: [] };
    showMessage('编辑器已清空', 'success');
  } catch (error) {
    console.error('清空编辑器失败:', error);
    showMessage('清空编辑器失败: ' + error.message, 'error');
  }
}

async function deleteNote() {
  if (!currentNoteId) {
    showMessage('请先选择笔记', 'warning');
    return;
  }
  
  const confirmDelete = confirm('确定删除此笔记吗？此操作不可撤销。');
  if (!confirmDelete) return;
  
  try {
    await request(`/notes/${currentNoteId}`, { method: 'DELETE' });
    currentNoteId = null;
    document.getElementById('note-title').value = '';
    
    if (editorInstance) {
      await editorInstance.isReady;
      editorInstance.render({ blocks: [] });
    }
    
    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) deleteBtn.disabled = true;
    await loadTree();
    showMessage('笔记删除成功', 'success');
  } catch (err) {
    console.error(err);
    showMessage('删除失败: ' + err.message, 'error');
  }
}

async function exportPdfOfEditorArea() {
  try {
    const JSPDF = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    if (!JSPDF) {
      showMessage('jsPDF 不可用（可能是CDN未加载）', 'error');
      return;
    }
    if (!window.html2canvas) {
      showMessage('html2canvas 不可用（可能是CDN未加载）', 'error');
      return;
    }
    if (!editorInstance) {
      showMessage('编辑器未初始化', 'error');
      return;
    }
    await editorInstance.isReady;

    const titleInput = document.getElementById('note-title');
    const title = (titleInput && titleInput.value) ? titleInput.value : '未命名笔记';
    // 优先使用 editor.save()；若在只读等情况下不可用，则回退到最近渲染数据或服务端最新数据
    let data = null;
    try {
      data = await editorInstance.save();
    } catch (e) {
      console.warn('editor.save() 不可用，回退到已渲染数据或重新获取', e);
    }
    if (!data || !Array.isArray(data.blocks)) {
      if (lastRenderedEditorData && Array.isArray(lastRenderedEditorData.blocks)) {
        data = lastRenderedEditorData;
      } else if (currentNoteId) {
        try {
          const { note } = await request(`/notes/${currentNoteId}`);
          data = (note && note.content) ? note.content : { blocks: [] };
        } catch (_) {
          data = { blocks: [] };
        }
      } else {
        data = { blocks: [] };
      }
    }
    if (!data || !Array.isArray(data.blocks) || data.blocks.length === 0) {
      showMessage('没有可导出的内容', 'warning');
      return;
    }

    const previewEl = document.createElement('div');
    previewEl.className = 'pdf-preview';
    // 基础样式直接内联，避免额外全局样式依赖
    previewEl.style.position = 'fixed';
    // 移到视口外，避免导出时闪烁
    previewEl.style.left = '-10000px';
    previewEl.style.top = '0';
    // 注意：不能使用 opacity:0 / visibility:hidden，会导致截图透明
    previewEl.style.opacity = '1';
    previewEl.style.pointerEvents = 'none';
    previewEl.style.width = '794px'; // 约等于 A4 宽（96dpi）
    previewEl.style.boxSizing = 'border-box';
    previewEl.style.padding = '24px';
    previewEl.style.color = '#222';
    previewEl.style.font = '14px/1.6 system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
    previewEl.style.background = '#fff';

    const titleEl = document.createElement('h1');
    titleEl.textContent = title;
    titleEl.style.margin = '0 0 12px';
    titleEl.style.fontSize = '24px';
    titleEl.style.fontWeight = '600';
    previewEl.appendChild(titleEl);

    const contentWrap = document.createElement('div');
    contentWrap.className = 'pdf-content';
    contentWrap.style.maxWidth = 'none';
    // 渲染静态内容
    contentWrap.appendChild(renderEditorDataAsStaticHTML(data));
    previewEl.appendChild(contentWrap);
    document.body.appendChild(previewEl);

    // 等待布局与图片加载/解码
    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
    const imgs = Array.prototype.slice.call(previewEl.querySelectorAll('img'));
    if (imgs.length > 0) {
      await Promise.all(imgs.map(function (img) {
        if (img.complete) {
          if (img.decode) {
            return img.decode().catch(function(){ /* 某些浏览器不支持或解码报错时忽略 */ });
          }
          return Promise.resolve();
        }
        return new Promise(function (res) {
          img.onload = function () {
            if (img.decode) {
              img.decode().catch(function(){ }).finally(res);
            } else {
              res();
            }
          };
          img.onerror = res;
        });
      }));
    }

    // 截图为 canvas
    const canvas = await window.html2canvas(previewEl, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: false,
      foreignObjectRendering: false,
      imageTimeout: 15000
    });

    // 生成多页 PDF
    const doc = new JSPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    addCanvasToPdfPaged(canvas, doc, 10);

    const safeTitle = title.replace(/[\\\/:*?"<>|]/g, '_');
    doc.save((safeTitle || 'QNotes') + '.pdf');

    previewEl.parentNode && previewEl.parentNode.removeChild(previewEl);
  } catch (err) {
    console.error('导出PDF失败:', err);
    showMessage('导出PDF失败: ' + (err && err.message ? err.message : '未知错误'), 'error');
  }
}

// 调试导出函数已移除

function setupEditor() {
  try {
    console.log('开始初始化EditorJS...');
    console.log('EditorJS可用:', typeof window.EditorJS);
    console.log('Header可用:', typeof window.Header);
    console.log('Paragraph可用:', typeof window.Paragraph);
    console.log('Checklist可用:', typeof window.Checklist);
    console.log('Quote可用:', typeof window.Quote);
    console.log('Delimiter可用:', typeof window.Delimiter);
    console.log('Table可用:', typeof window.Table);
    console.log('MermaidTool可用:', typeof window.MermaidTool);
    console.log('AttachesTool可用:', typeof (window.AttachesTool || window.Attaches));
    console.log('CodeFlask可用:', typeof window.editorjsCodeflask);
    console.log('Warehouse可用:', typeof window.Warehouse);
    console.log('ColorPicker可用:', typeof window.ColorPicker);
    console.log('Password可用:', typeof window.Password);
    console.log('Marker可用:', typeof window.Marker);
    
    // 检查插件是否加载
    if (typeof window.EditorJS === 'undefined') {
      throw new Error('EditorJS 未加载');
    }
    if (typeof window.Header === 'undefined') {
      throw new Error('Header 插件未加载');
    }
    if (typeof window.Paragraph === 'undefined') {
      throw new Error('Paragraph 插件未加载');
    }
    if (typeof window.Checklist === 'undefined') {
      throw new Error('Checklist 插件未加载');
    }
    if (typeof window.Quote === 'undefined') {
      throw new Error('Quote 插件未加载');
    }
    if (typeof window.Delimiter === 'undefined') {
      throw new Error('Delimiter 插件未加载');
    }
    if (typeof window.Table === 'undefined') {
      throw new Error('Table 插件未加载');
    }
    if (typeof window.ImageTool === 'undefined') {
      throw new Error('Image 插件未加载');
    }
    if (typeof window.MermaidTool === 'undefined') {
      throw new Error('Mermaid 插件未加载');
    }
    if (typeof (window.AttachesTool || window.Attaches) === 'undefined') {
      throw new Error('Attaches 插件未加载');
    }
    if (typeof window.editorjsCodeflask === 'undefined') {
      throw new Error('CodeFlask 插件未加载');
    }
    if (typeof window.Warehouse === 'undefined') {
      throw new Error('Warehouse 插件未加载');
    }
    if (typeof window.ColorPicker === 'undefined') {
      throw new Error('ColorPicker 插件未加载');
    }
    if (typeof window.Password === 'undefined') {
      throw new Error('Password 插件未加载');
    }
    if (typeof window.Marker === 'undefined') {
      throw new Error('Marker 插件未加载');
    }
    
    // 根据测试验证成功的配置
    const tools = {
      header: {
        class: window.Header,
        config: {
          placeholder: '输入标题',
          levels: [1, 2, 3, 4, 5, 6],
          defaultLevel: 2
        }
      },
      paragraph: {
        class: window.Paragraph,
        inlineToolbar: true,
        config: {
          placeholder: '输入段落内容...'
        }
      },
      checklist: {
        class: window.Checklist,
        inlineToolbar: true,
        config: {
          placeholder: '输入待办事项...'
        }
      },
      quote: {
        class: window.Quote,
        inlineToolbar: true,
        config: {
          quotePlaceholder: '输入引用内容',
          captionPlaceholder: '引用作者'
        }
      },
      delimiter: {
        class: window.Delimiter
      },
      table: {
        class: window.Table,
        inlineToolbar: true,
        config: {
          rows: 2,
          cols: 3,
          maxRows: 5,
          maxCols: 5
        }
      },
      image: {
        class: window.ImageTool,
        config: {
          captionPlaceholder: '添加说明',
          features: { border: true, caption: true, stretch: true },
          uploader: {
            uploadByFile(file) {
              const formData = new FormData();
              formData.append('image', file);
              return request('/uploadFile', { method: 'POST', body: formData })
                .then((res) => {
                  if (!res || !res.file || !res.file.url) throw new Error('上传失败');
                  return { success: 1, file: { url: res.file.url } };
                });
            },
            uploadByUrl(url) {
              return request('/fetchUrl', { method: 'POST', body: { url } })
                .then((res) => {
                  if (!res || !res.file || !res.file.url) throw new Error('拉取失败');
                  return { success: 1, file: { url: res.file.url } };
                });
            }
          }
        }
      },
      code: {
        class: window.editorjsCodeflask,
        config: {
          placeholder: '输入代码...'
        }
      },
      warehouse: {
        class: window.Warehouse,
      },
      marker: {
        class: window.Marker,
        shortcut: 'CMD+SHIFT+M',
        config: {
          colors: ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'],
          defaultColor: 'yellow',
          columns: 7
        }
      },
      colorPicker: {
        class: window.ColorPicker && window.ColorPicker.default ? window.ColorPicker.default : window.ColorPicker,
        config: {
          columns: 7,
          colors: [
            '#000000', '#262626', '#595959', '#8C8C8C', '#BFBFBF', '#D9D9D9', '#F0F0F0', '#FFFFFF',
            '#F5222D', '#FA541C', '#FA8C16', '#FAAD14', '#FADB14', '#A0D911', '#52C41A', '#13C2C2',
            '#1890FF', '#2F54EB', '#722ED1', '#EB2F96'
          ]
        }
      },
      password: {
        class: window.Password,
        inlineToolbar: true,
        config: {
          contentPlaceholder: '请输入受保护内容',
          passwordPlaceholder: '输入密码',
          buttonText: '显示',
          lockedText: '密码保护区域',
          lockButtonText: '隐藏'
        }
      },
      attaches: {
        class: (window.AttachesTool || window.Attaches),
        config: {
          endpoint: `${API_BASE}/uploadAttachment`,
          field: 'file',
          buttonText: '选择文件',
          errorMessage: '文件上传失败',
          additionalRequestHeaders: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        }
      },
      mermaid: window.MermaidTool
    };
    
    console.log('可用工具:', Object.keys(tools));
    
    editorInstance = new window.EditorJS({
      holder: 'editorjs',
      readOnly: true,
      placeholder: '开始记录你的想法……',
      tools: tools,
      data: {
        time: Date.now(),
        blocks: [
          {
            type: "header",
            data: {
              text: "欢迎使用QNotes",
              level: 1
            }
          },
          {
            type: "paragraph",
            data: {
              text: "这是一个功能丰富的云协作笔记应用，支持多种编辑功能。"
            }
          },
          {
            type: "checklist",
            data: {
              items: [
                { text: "支持标题编辑", checked: true },
                { text: "支持段落编辑", checked: true },
                { text: "支持待办事项列表", checked: false },
                { text: "支持引用块功能", checked: false }
              ]
            }
          }
        ]
      },
      onReady: () => {
        if (window.MermaidTool && typeof window.MermaidTool.config === 'function') {
          window.MermaidTool.config({ theme: 'neutral' });
        }
        updateReadOnlySwitch();
      },
      onChange: (api, event) => {
        markDirty();
      }
    });
    
    console.log('EditorJS初始化成功:', editorInstance);
  } catch (err) {
    console.error('EditorJS初始化失败:', err);
    console.error('错误详情:', err.stack);
    alert('EditorJS初始化失败: ' + err.message);
  }
}

async function tryAutoLogin() {
  if (!authToken) {
    window.location.href = 'login.html';
    return;
  }
  try {
    const { user } = await request('/profile');
    setUserInfo(user);
    await loadTree();
  } catch (err) {
    console.warn('自动登录失败', err);
    localStorage.removeItem('qnotes_token');
    authToken = null;
    window.location.href = 'login.html';
  }
}

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    // 登出前，如有未保存更改，询问是否保存
    if (isDirty) {
      const ok = confirm('检测到未保存的更改，是否在登出前保存？');
      if (ok) {
        await persistNote({ silent: false, reason: 'logout' });
      } else {
        resetDirtyFlag();
      }
    }
    if (isEditing) {
      await stopEditing();
    }
    authToken = null;
    localStorage.removeItem('qnotes_token');
    setUserInfo(null);
    window.location.href = 'login.html';
  });

  document.getElementById('new-note-btn').addEventListener('click', createNote);
  const toggleBtn = document.getElementById('sidebar-mode-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      activeSidebarTab = activeSidebarTab === 'notes' ? 'keywords' : 'notes';
      if (activeSidebarTab === 'notes') {
        toggleBtn.textContent = '我的笔记';
        toggleBtn.classList.remove('toggle-keywords');
        toggleBtn.classList.add('toggle-notes');
      } else {
        toggleBtn.textContent = '我的关键词';
        toggleBtn.classList.remove('toggle-notes');
        toggleBtn.classList.add('toggle-keywords');
      }
      await loadTree();
    });
    // 初始状态
    toggleBtn.textContent = '我的笔记';
    toggleBtn.classList.add('toggle-notes');
  }

  // 允许将条目拖拽到根（无父级）
  const treeEl = document.getElementById('note-tree');
  if (treeEl && !treeEl.__dndRootBound) {
    treeEl.addEventListener('dragover', (e) => {
      // 若悬停位置不在某个 li 上，则视为根区域
      const li = e.target && e.target.closest ? e.target.closest('li.tree-item') : null;
      if (!li) {
        e.preventDefault();
        treeEl.classList.add('drop-root');
      }
    });
    treeEl.addEventListener('dragleave', (e) => {
      const related = e.relatedTarget;
      const stillInside = related && treeEl.contains(related);
      if (!stillInside) treeEl.classList.remove('drop-root');
    });
    treeEl.addEventListener('drop', async (e) => {
      const li = e.target && e.target.closest ? e.target.closest('li.tree-item') : null;
      if (li) return; // 有具体条目接管
      e.preventDefault();
      treeEl.classList.remove('drop-root');
      const data = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      const sourceId = parseInt(data, 10);
      if (!sourceId) return;
      await moveNote(sourceId, null);
    });
    // 标记避免重复绑定
    Object.defineProperty(treeEl, '__dndRootBound', { value: true, enumerable: false });
  }
  document.getElementById('save-btn').addEventListener('click', saveNote);
  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearEditor);
  const delBtn = document.getElementById('delete-btn');
  if (delBtn) delBtn.addEventListener('click', deleteNote);
  const exportBtn = document.getElementById('export-pdf-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportPdfOfEditorArea);

  const roChk = document.getElementById('readonly-toggle');
  if (roChk) {
    roChk.addEventListener('change', async () => {
      try {
        if (!editorInstance) {
          setupEditor();
        }
        await editorInstance.isReady;
        // 根据开关状态：checked=编辑，未勾选=只读
        const wantReadOnly = !roChk.checked;
        if (wantReadOnly) {
          await stopEditing();
        } else {
          await startEditing();
        }
      } catch (err) {
        console.error('切换只读模式失败:', err);
        showMessage('切换只读模式失败: ' + (err && err.message ? err.message : '未知错误'), 'error');
      }
    });
  }

  const titleInput = document.getElementById('note-title');
  titleInput.addEventListener('input', () => {
    if (isEditing) markDirty();
  });

  // 关键词输入事件
  const kwInput = document.getElementById('keywords-input');
  if (kwInput) {
    kwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = kwInput.value.trim();
        if (value) {
          addKeyword(value);
          kwInput.value = '';
        }
      } else if (e.key === 'Backspace' && !kwInput.value) {
        // 空时退格删除最后一个关键词
        if (currentKeywords.length > 0) {
          currentKeywords.pop();
          renderKeywords();
          markDirty();
        }
      }
    });
  }

  // 自动保存开关初始化
  const autosaveToggle = document.getElementById('autosave-toggle');
  const stored = localStorage.getItem('qnotes_autosave');
  if (stored !== null) {
    autosaveEnabled = stored === 'true';
  }
  if (autosaveToggle) {
    autosaveToggle.checked = autosaveEnabled;
    autosaveToggle.addEventListener('change', () => {
      autosaveEnabled = autosaveToggle.checked;
      localStorage.setItem('qnotes_autosave', String(autosaveEnabled));
      if (autosaveEnabled) startAutosaveTimer(); else stopAutosaveTimer();
    });
    // 初始状态若开启，启动定时器与倒计时
    if (autosaveEnabled) startAutosaveTimer();
  }

  window.addEventListener('beforeunload', (e) => {
    if (isEditing && currentNoteId) {
      const payload = new Blob([JSON.stringify({})], { type: 'application/json' });
      navigator.sendBeacon(`${API_BASE}/notes/${currentNoteId}/unlock`, payload);
    }
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      if (autosaveEnabled && isDirty && currentNoteId && isEditing) {
        await persistNote({ silent: true, reason: 'visibilitychange' });
      }
    }
    // 调整心跳频率
    scheduleNetHeartbeat(0);
    scheduleAuthHeartbeat(0);
  });

  // 搜索入口
  const openSearchBtn = document.getElementById('open-search-btn');
  const closeSearchBtn = document.getElementById('close-search-btn');
  const searchOverlay = document.getElementById('search-overlay');
  const searchInput = document.getElementById('global-search-input');
  const searchResults = document.getElementById('search-results');

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.remove('hidden');
    isSearchOpen = true;
    setTimeout(() => searchInput && searchInput.focus(), 0);
  }
  function closeSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.add('hidden');
    isSearchOpen = false;
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.innerHTML = '';
  }

  async function performSearch(q) {
    try {
      if (!q || !q.trim()) {
        searchResults.innerHTML = '<div class="search-empty">请输入关键词开始搜索</div>';
        return;
      }
      searchResults.innerHTML = '<div class="search-loading">搜索中…</div>';
      const data = await request(`/search?q=${encodeURIComponent(q)}&limit=20&offset=0`);
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        searchResults.innerHTML = '<div class="search-empty">未找到匹配内容</div>';
        return;
      }
      const html = items.map(item => {
        const safeTitle = escapeHtml(item.title || '（无标题）');
        const safeSnippet = escapeHtml(item.snippet || '')
          .replace(/&lt;&lt;/g, '<mark>')
          .replace(/&gt;&gt;/g, '</mark>');
        const fields = (item.matchFields || []).join(', ');
        const meta = fields ? `匹配字段：${fields}` : '';
        return `
          <div class="search-item" data-id="${item.id}">
            <div class="search-item-title">${safeTitle}</div>
            <div class="search-item-snippet">${safeSnippet}</div>
            <div class="search-item-meta">${meta}</div>
          </div>
        `;
      }).join('');
      searchResults.innerHTML = html;
      // 绑定点击
      searchResults.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('click', async () => {
          const id = parseInt(el.getAttribute('data-id'), 10);
          if (id) {
            closeSearch();
            await selectNote(id);
          }
        });
      });
    } catch (err) {
      console.error(err);
      searchResults.innerHTML = `<div class="search-error">搜索失败：${escapeHtml(err.message || '未知错误')}</div>`;
    }
  }

  if (openSearchBtn) openSearchBtn.addEventListener('click', openSearch);
  if (closeSearchBtn) closeSearchBtn.addEventListener('click', closeSearch);
  if (searchOverlay) {
    searchOverlay.addEventListener('click', (e) => {
      if (e.target === searchOverlay) closeSearch();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => performSearch(q), 300);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    });
  }
  // 快捷键 Ctrl/⌘+K 打开
  document.addEventListener('keydown', (e) => {
    const isCtrlK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
    if (isCtrlK) {
      e.preventDefault();
      if (isSearchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
    } else if (e.key === 'Escape' && isSearchOpen) {
      e.preventDefault();
      closeSearch();
    }
  });

  // 浏览器在线/离线事件
  window.addEventListener('online', () => { netOnline = true; updateConnIndicators(); scheduleNetHeartbeat(0); scheduleAuthHeartbeat(0); });
  window.addEventListener('offline', () => { netOnline = false; updateConnIndicators(); });
}

function buildKeywordIndexList(index, parentEl) {
  index.forEach(group => {
    const title = document.createElement('div');
    title.className = 'keyword-group-title';
    title.textContent = group.keyword;
    parentEl.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'keyword-group-list';
    group.notes.forEach(n => {
      const li = document.createElement('li');
      li.className = 'tree-item';
      li.dataset.id = n.id;
      li.innerHTML = `
        <div class="tree-item-content" style="padding-left: 1.5rem;">
          <span class="expand-icon">  </span>
          <span class="title">${n.title}</span>
        </div>
      `;
      li.addEventListener('click', async (e) => {
        e.stopPropagation();
        await selectNote(n.id, li);
      });
      ul.appendChild(li);
    });
    parentEl.appendChild(ul);
  });
}

function renderKeywords() {
  const list = document.getElementById('keywords-list');
  if (!list) return;
  list.innerHTML = '';
  currentKeywords.forEach((kw, index) => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = kw;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = '删除';
    btn.addEventListener('click', () => {
      removeKeyword(index);
    });
    chip.appendChild(btn);
    list.appendChild(chip);
  });
}

function addKeyword(value) {
  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  let changed = false;
  parts.forEach(p => {
    if (p && !currentKeywords.includes(p)) {
      currentKeywords.push(p);
      changed = true;
    }
  });
  if (changed) {
    renderKeywords();
    markDirty();
  }
}

function removeKeyword(index) {
  if (index >= 0 && index < currentKeywords.length) {
    currentKeywords.splice(index, 1);
    renderKeywords();
    markDirty();
  }
}

function setupResizer() {
  const sidebar = document.querySelector('.sidebar');
  const resizer = document.querySelector('.resizer');
  let isResizing = false;
  let lastDownX = 0;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    lastDownX = e.clientX;
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);
  });

  function resize(e) {
    if (!isResizing) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const newWidth = sidebarRect.width + (e.clientX - lastDownX);
    lastDownX = e.clientX;
    if (newWidth > 200 && newWidth < window.innerWidth * 0.5) {
      sidebar.style.width = `${newWidth}px`;
    }
  }

  function stopResize() {
    isResizing = false;
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResize);
  }
}

// 等待页面完全加载后再初始化
window.addEventListener('load', async () => {
  console.log('开始初始化应用...');
  
  // 多次重试检查EditorJS和所有插件
  let retryCount = 0;
  const maxRetries = 5;
  
  function checkAndInitialize() {
    const requiredPlugins = ['EditorJS', 'Header', 'Paragraph', 'Checklist', 'Quote', 'Delimiter'];
    const missingPlugins = [];
    
    if (typeof window.EditorJS === 'undefined') missingPlugins.push('EditorJS');
    if (typeof window.Header === 'undefined') missingPlugins.push('Header');
    if (typeof window.Paragraph === 'undefined') missingPlugins.push('Paragraph');
    if (typeof window.Checklist === 'undefined') missingPlugins.push('Checklist');
    if (typeof window.Quote === 'undefined') missingPlugins.push('Quote');
    if (typeof window.Delimiter === 'undefined') missingPlugins.push('Delimiter');
    
    if (missingPlugins.length === 0) {
      console.log('所有插件已加载，开始初始化应用');
      initializeApp();
      return;
    }
    
    retryCount++;
    if (retryCount < maxRetries) {
      console.log(`插件未完全加载，第${retryCount}次重试... 缺失: ${missingPlugins.join(', ')}`);
      setTimeout(checkAndInitialize, 1000);
    } else {
      console.error('插件加载失败，已达到最大重试次数');
      console.error('缺失的插件:', missingPlugins);
      alert('编辑器插件加载失败: ' + missingPlugins.join(', ') + '，请检查网络连接或刷新页面重试');
    }
  }
  
  checkAndInitialize();
});

async function initializeApp() {
  try {
    // 延迟初始化编辑器，等待用户点击开始编辑
    setupEventListeners();
    setupResizer();
    startHeartbeat();
    await tryAutoLogin();
    console.log('应用初始化完成');
  } catch (err) {
    console.error('应用初始化失败:', err);
  }
}
