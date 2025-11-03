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

function renderUploadsSummary(summary) {
  const el = document.getElementById('uploads-summary');
  if (!el) return;
  const count = summary && typeof summary.fileCount === 'number' ? summary.fileCount : 0;
  const bytes = summary && typeof summary.totalBytes === 'number' ? summary.totalBytes : 0;
  el.textContent = `文件数量：${count}，总大小：${formatBytes(bytes)}`;
}

function renderDiskSummary(info) {
  const el = document.getElementById('disk-summary');
  if (!el) return;
  const free = info && typeof info.freeBytes === 'number' ? info.freeBytes : null;
  if (free == null) {
    el.textContent = '未知（无法检测）';
    el.style.color = '';
    return;
  }
  el.textContent = `可用空间：${formatBytes(free)}`;
  const threshold = 1024 * 1024 * 1024; // 1024MB
  el.style.color = free < threshold ? 'red' : '';
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
    const [summary, usersRes, tablesRes, settingsRes, groupsRes, membershipsRes, sectionsRes, uploadsRes, diskRes] = await Promise.all([
      request('/admin/db/summary'),
      request('/admin/users'),
      request('/admin/db/tables'),
      request('/admin/settings'),
      request('/admin/groups'),
      request('/admin/memberships'),
      request('/admin/sections'),
      request('/admin/uploads/summary'),
      request('/admin/disk/free')
    ]);
    renderDbSummary(summary);
    renderUploadsSummary(uploadsRes || {});
    renderDiskSummary(diskRes || {});
    renderUsers(usersRes.users || []);
    renderTablesInfo((tablesRes && tablesRes.tables) || {});
    setupAuthMode(settingsRes && settingsRes.auth_mode);
    renderGroups(groupsRes && groupsRes.groups || []);
    renderMemberships(usersRes.users || [], groupsRes && groupsRes.groups || [], membershipsRes && membershipsRes.memberships || []);
    renderSections(groupsRes && groupsRes.groups || [], sectionsRes && sectionsRes.sections || []);
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

function setupAuthMode(mode) {
  const select = document.getElementById('auth-mode-select');
  const btn = document.getElementById('save-auth-mode-btn');
  const status = document.getElementById('auth-mode-status');
  if (select) select.value = mode === 'personal' ? 'personal' : 'team';
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        await request('/admin/settings', { method: 'POST', body: { auth_mode: select.value } });
        if (status) status.textContent = '已保存';
        setTimeout(() => { if (status) status.textContent = ''; }, 1500);
      } catch (e) {
        alert('保存失败');
      }
    });
  }
}

function renderGroups(groups) {
  const listEl = document.getElementById('groups-list');
  const input = document.getElementById('new-group-name');
  const createBtn = document.getElementById('create-group-btn');
  const render = () => {
    if (!listEl) return;
    if (!groups || groups.length === 0) {
      listEl.textContent = '暂无用户组';
      return;
    }
    listEl.innerHTML = '';
    const ul = document.createElement('ul');
    groups.forEach(g => {
      const li = document.createElement('li');
      li.innerHTML = `${escapeHtml(g.name)} <span class="meta">(成员 ${g.member_count || 0})</span> <button data-del="${g.id}">删除</button>`;
      ul.appendChild(li);
    });
    listEl.appendChild(ul);
    listEl.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-del'), 10);
        if (!confirm('确定删除此组？')) return;
        await request(`/admin/groups/${id}`, { method: 'DELETE' });
        const refreshed = await request('/admin/groups');
        groups.splice(0, groups.length, ...((refreshed && refreshed.groups) || []));
        render();
        // 也应刷新成员关系和二级授权
        const memberships = await request('/admin/memberships');
        const sections = await request('/admin/sections');
        renderMemberships(window.__usersCache || [], groups, memberships && memberships.memberships || []);
        renderSections(groups, sections && sections.sections || []);
      });
    });
  };
  render();
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      const name = (input && input.value || '').trim();
      if (!name) return;
      await request('/admin/groups', { method: 'POST', body: { name } });
      input.value = '';
      const refreshed = await request('/admin/groups');
      groups.splice(0, groups.length, ...((refreshed && refreshed.groups) || []));
      render();
      const memberships = await request('/admin/memberships');
      const sections = await request('/admin/sections');
      renderMemberships(window.__usersCache || [], groups, memberships && memberships.memberships || []);
      renderSections(groups, sections && sections.sections || []);
    });
  }
}

function renderMemberships(users, groups, memberships) {
  const panel = document.getElementById('memberships-panel');
  window.__usersCache = users;
  if (!panel) return;
  const map = new Map();
  memberships.forEach(m => {
    const arr = map.get(m.user_id) || new Set();
    arr.add(m.group_id);
    map.set(m.user_id, arr);
  });
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = `<th>用户</th>${groups.map(g => `<th>${escapeHtml(g.name)}</th>`).join('')}`;
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(u.username)}</td>` + groups.map(g => {
      const checked = map.get(u.id) && map.get(u.id).has(g.id);
      return `<td><input type="checkbox" data-uid="${u.id}" data-gid="${g.id}" ${checked ? 'checked' : ''}></td>`;
    }).join('');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.innerHTML = '';
  panel.appendChild(table);
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const uid = parseInt(cb.getAttribute('data-uid'), 10);
      const gid = parseInt(cb.getAttribute('data-gid'), 10);
      if (cb.checked) {
        await request('/admin/memberships', { method: 'POST', body: { user_id: uid, group_id: gid } });
      } else {
        await request('/admin/memberships/delete', { method: 'POST', body: { user_id: uid, group_id: gid } });
      }
    });
  });
}

function renderSections(groups, sections) {
  const panel = document.getElementById('sections-panel');
  if (!panel) return;
  if (!sections || sections.length === 0) {
    panel.textContent = '暂无二级节点';
    return;
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  // 第一列：二级节点名；后续列：公开 + 各用户组
  const thName = document.createElement('th');
  thName.textContent = '二级节点';
  trh.appendChild(thName);
  const thPublic = document.createElement('th');
  thPublic.textContent = '公开';
  trh.appendChild(thPublic);
  groups.forEach(g => {
    const th = document.createElement('th');
    th.textContent = g.name;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sections.forEach(s => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = s.title;
    tr.appendChild(tdName);
    // 单选：公开
    const tdPublic = document.createElement('td');
    const radioPublic = document.createElement('input');
    radioPublic.type = 'radio';
    radioPublic.name = `sec-${s.id}`; // 同一行互斥
    radioPublic.value = '';
    radioPublic.checked = !s.group_id;
    radioPublic.addEventListener('change', async () => {
      if (radioPublic.checked) {
        await request(`/admin/sections/${s.id}/assign`, { method: 'POST', body: { group_id: null } });
      }
    });
    tdPublic.appendChild(radioPublic);
    tr.appendChild(tdPublic);
    // 单选：各组
    groups.forEach(g => {
      const td = document.createElement('td');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `sec-${s.id}`;
      radio.value = String(g.id);
      radio.checked = s.group_id && String(s.group_id) === String(g.id);
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await request(`/admin/sections/${s.id}/assign`, { method: 'POST', body: { group_id: parseInt(radio.value, 10) } });
        }
      });
      td.appendChild(radio);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.innerHTML = '';
  panel.appendChild(table);
}


