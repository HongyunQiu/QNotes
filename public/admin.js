const API_BASE = '/api';
let authToken = localStorage.getItem('qnotes_token');

async function request(path, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = (bytes / Math.pow(1024, i)).toFixed(2);
  return `${v} ${sizes[i] || 'B'}`;
}

function renderDbSummary(summary) {
  const el = document.getElementById('db-summary');
  el.textContent = `用户数：${summary.users}，笔记数：${summary.notes}，数据库大小：${formatBytes(summary.dbSizeBytes || 0)}`;
}

function renderUsers(list) {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';
  list.forEach(u => {
    const tr = document.createElement('tr');
    const safeId = escapeHtml(String(u.id));
    const safeUsername = escapeHtml(String(u.username || ''));
    const roleHtml = u.is_admin ? '<span class="pill pill-admin">管理员</span>' : '普通用户';
    const safeNoteCount = escapeHtml(String(u.note_count || 0));
    const safeCreatedAt = escapeHtml(String(u.created_at || ''));
    tr.innerHTML = `
      <td>${safeId}</td>
      <td>${safeUsername}</td>
      <td>${roleHtml}</td>
      <td>${safeNoteCount}</td>
      <td>${safeCreatedAt}</td>
    `;
    tbody.appendChild(tr);
  });
  if (list.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="meta">暂无用户</td>';
    tbody.appendChild(tr);
  }
}

function renderTablesInfo(tables) {
  const el = document.getElementById('tables-info');
  const parts = [];
  Object.keys(tables).forEach(name => {
    const cols = tables[name] || [];
    const colsStr = cols.map(c => `${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value != null ? ' DEFAULT ' + c.dflt_value : ''}`).join(', ');
    parts.push(`${name}: ${colsStr}`);
  });
  el.textContent = parts.join(' | ');
}

async function init() {
  // auth check
  if (!authToken) {
    window.location.href = 'login.html';
    return;
  }
  // logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('qnotes_token');
      authToken = null;
      window.location.href = 'login.html';
    });
  }
  // backup button
  const backupBtn = document.getElementById('backup-btn');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      downloadBackup();
    });
  }
  try {
    const { user } = await request('/profile');
    if (!user || !user.is_admin) {
      alert('仅限超级管理员访问');
      window.location.href = 'index.html';
      return;
    }
  } catch (e) {
    window.location.href = 'login.html';
    return;
  }
  try {
    const [summary, usersRes, tablesRes] = await Promise.all([
      request('/admin/db/summary'),
      request('/admin/users'),
      request('/admin/db/tables')
    ]);
    renderDbSummary(summary);
    renderUsers(usersRes.users || []);
    renderTablesInfo((tablesRes && tablesRes.tables) || {});
  } catch (e) {
    console.error(e);
    alert('加载管理数据失败');
  }
}

window.addEventListener('load', init);

async function downloadBackup() {
  const btn = document.getElementById('backup-btn');
  const statusEl = document.getElementById('backup-status');
  const barWrap = document.getElementById('backup-progress');
  const bar = document.getElementById('backup-progress-bar');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '准备中…';
  }
  if (statusEl) statusEl.textContent = '正在准备备份…';
  if (barWrap) barWrap.style.display = 'block';
  if (bar) bar.style.width = '0%';
  try {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API_BASE}/admin/backup`, { headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || res.statusText);
    }
    const sourceBytesHeader = res.headers.get('X-Source-Bytes');
    const sourceBytes = sourceBytesHeader ? parseInt(sourceBytesHeader, 10) : 0;
    let filename = 'qnotes-backup.zip';
    const dispo = res.headers.get('Content-Disposition') || '';
    const m = dispo.match(/filename=\"?([^\";]+)\"?/i);
    if (m && m[1]) filename = m[1];

    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) {
      const blob = await res.blob();
      triggerDownload(blob, filename);
    } else {
      const chunks = [];
      let received = 0;
      if (statusEl) statusEl.textContent = '开始压缩并下载…';
      if (btn) btn.textContent = '打包中… 0%';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength || 0;
        if (sourceBytes > 0) {
          const pct = Math.max(0, Math.min(99, Math.floor((received / sourceBytes) * 100)));
          if (bar) bar.style.width = pct + '%';
          if (btn) btn.textContent = `打包中… ${pct}%`;
          if (statusEl) statusEl.textContent = `已下载 ${formatBytes(received)} / 预计源大小 ${formatBytes(sourceBytes)}（压缩中）`;
        } else {
          if (statusEl) statusEl.textContent = `已下载 ${formatBytes(received)}（压缩中）`;
        }
      }
      if (bar) bar.style.width = '100%';
      if (btn) btn.textContent = '打包完成，保存中…';
      if (statusEl) statusEl.textContent = '压缩完成，正在保存文件…';
      const blob = new Blob(chunks, { type: 'application/zip' });
      triggerDownload(blob, filename);
    }
  } catch (e) {
    console.error(e);
    alert('备份失败：' + (e && e.message ? e.message : '未知错误'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '下载备份';
    }
    if (statusEl) statusEl.textContent = '';
    if (barWrap) barWrap.style.display = 'none';
    if (bar) bar.style.width = '0%';
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


