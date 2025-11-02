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


