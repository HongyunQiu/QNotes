const API_BASE = '/api';
let authToken = localStorage.getItem('qnotes_token');
let currentUser = null;
let editorInstance = null;
let currentNoteId = null;
let isEditing = false;
let lockTimer = null;

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
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || res.statusText);
    }
    if (res.status === 204) return null;
    return res.json();
  } catch (err) {
    throw err;
  }
}

function showAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
}

function hideAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}

function setUserInfo(user) {
  currentUser = user;
  document.getElementById('current-user').textContent = user ? `欢迎，${user.username}` : '';
}

function buildTreeList(nodes, parentEl, depth = 0) {
  nodes.forEach((node) => {
    const li = document.createElement('li');
    li.dataset.id = node.id;
    li.style.paddingLeft = `${1 + depth * 0.75}rem`;
    li.innerHTML = `<span class="title">${node.title}</span>`;
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNote(node.id, li);
    });
    parentEl.appendChild(li);
    if (node.children && node.children.length) {
      buildTreeList(node.children, parentEl, depth + 1);
    }
  });
}

async function loadTree() {
  try {
    const data = await request('/notes');
    const treeEl = document.getElementById('note-tree');
    treeEl.innerHTML = '';
    buildTreeList(data.tree, treeEl);
    if (!currentNoteId) {
      const firstId = findFirstNoteId(data.tree);
      if (firstId) {
        selectNote(firstId);
      }
    }
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
  resetEditorState();
  try {
    const { note } = await request(`/notes/${id}`);
    document.getElementById('note-title').value = note.title;
    await editorInstance.isReady;
    const data = note.content && Object.keys(note.content).length ? note.content : { blocks: [] };
    await editorInstance.render(data);
    const deleteBtn = document.getElementById('delete-btn');
    deleteBtn.disabled = false;
    if (note.lock_user_id && note.lock_user_id !== currentUser.id) {
      showLockInfo(`${note.lock_username} 正在编辑此笔记`);
      setReadOnly(true);
    } else {
      hideLockInfo();
      setReadOnly(true);
    }
  } catch (err) {
    console.error(err);
  }
}

function resetEditorState() {
  setReadOnly(true);
  isEditing = false;
  document.getElementById('save-btn').disabled = true;
  document.getElementById('edit-toggle-btn').textContent = '开始编辑';
  hideLockInfo();
  if (lockTimer) {
    clearInterval(lockTimer);
    lockTimer = null;
  }
}

function setReadOnly(readOnly) {
  if (editorInstance) {
    editorInstance.readOnly.toggle(readOnly);
  }
}

function showLockInfo(message) {
  const el = document.getElementById('lock-info');
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideLockInfo() {
  document.getElementById('lock-info').classList.add('hidden');
}

async function startEditing() {
  if (!currentNoteId) return;
  try {
    const { success } = await request(`/notes/${currentNoteId}/lock`, { method: 'POST', body: {} });
    if (success) {
      isEditing = true;
      setReadOnly(false);
      document.getElementById('save-btn').disabled = false;
      document.getElementById('edit-toggle-btn').textContent = '停止编辑';
      hideLockInfo();
      refreshLockStatus();
      lockTimer = setInterval(refreshLockStatus, 60000);
    }
  } catch (err) {
    try {
      const payload = JSON.parse(err.message);
      if (payload.error) {
        showLockInfo(payload.error);
      }
    } catch (parseErr) {
      showLockInfo('无法获取编辑权限');
    }
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
    await request(`/notes/${currentNoteId}/unlock`, { method: 'POST', body: {} });
  } catch (err) {
    console.warn('释放锁失败', err);
  }
  resetEditorState();
}

async function saveNote() {
  if (!currentNoteId) return;
  try {
    const data = await editorInstance.save();
    const title = document.getElementById('note-title').value || '无标题笔记';
    await request(`/notes/${currentNoteId}`, {
      method: 'PUT',
      body: { title, content: data }
    });
    await stopEditing();
    await loadTree();
    selectNote(currentNoteId);
  } catch (err) {
    console.error(err);
    alert('保存失败，请稍后再试');
  }
}

async function createNote() {
  const title = prompt('笔记标题');
  if (!title) return;
  try {
    const { note } = await request('/notes', {
      method: 'POST',
      body: { title, parent_id: currentNoteId }
    });
    await loadTree();
    selectNote(note.id);
  } catch (err) {
    console.error(err);
  }
}

async function deleteNote() {
  if (!currentNoteId) return;
  const confirmDelete = confirm('确定删除此笔记吗？此操作不可撤销。');
  if (!confirmDelete) return;
  try {
    await request(`/notes/${currentNoteId}`, { method: 'DELETE' });
    currentNoteId = null;
    document.getElementById('note-title').value = '';
    await editorInstance.isReady;
    await editorInstance.render({ blocks: [] });
    document.getElementById('delete-btn').disabled = true;
    await loadTree();
  } catch (err) {
    console.error(err);
  }
}

function setupEditor() {
  editorInstance = new EditorJS({
    holder: 'editor',
    readOnly: true,
    placeholder: '开始记录你的想法……',
    tools: {
      header: {
        class: window.Header,
        inlineToolbar: true
      },
      list: {
        class: window.List,
        inlineToolbar: true
      },
      paragraph: {
        class: window.Paragraph,
        inlineToolbar: true
      }
    }
  });
}

function setupAuthForm() {
  const form = document.getElementById('auth-form');
  const registerBtn = document.getElementById('register-btn');
  let mode = 'login';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const messageEl = document.getElementById('auth-message');
    messageEl.textContent = '';
    try {
      const data = await request(mode === 'login' ? '/login' : '/register', {
        method: 'POST',
        body: { username, password }
      });
      authToken = data.token;
      localStorage.setItem('qnotes_token', authToken);
      setUserInfo(data.user);
      hideAuthModal();
      await loadTree();
    } catch (err) {
      try {
        const payload = JSON.parse(err.message);
        messageEl.textContent = payload.error || '操作失败';
      } catch (parseErr) {
        messageEl.textContent = '操作失败';
      }
    }
  });

  registerBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    registerBtn.textContent = mode === 'login' ? '注册' : '使用已有账号登录';
    form.querySelector('button[type="submit"]').textContent = mode === 'login' ? '登录' : '注册';
  });
}

async function tryAutoLogin() {
  if (!authToken) {
    showAuthModal();
    return;
  }
  try {
    const { user } = await request('/profile');
    setUserInfo(user);
    hideAuthModal();
    await loadTree();
  } catch (err) {
    console.warn('自动登录失败', err);
    showAuthModal();
  }
}

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (isEditing) {
      await stopEditing();
    }
    authToken = null;
    localStorage.removeItem('qnotes_token');
    setUserInfo(null);
    currentNoteId = null;
    document.getElementById('note-tree').innerHTML = '';
    document.getElementById('note-title').value = '';
    await editorInstance.isReady;
    await editorInstance.render({ blocks: [] });
    showAuthModal();
  });

  document.getElementById('new-note-btn').addEventListener('click', createNote);
  document.getElementById('save-btn').addEventListener('click', saveNote);
  document.getElementById('edit-toggle-btn').addEventListener('click', () => {
    if (!currentNoteId) return;
    if (isEditing) {
      stopEditing();
    } else {
      startEditing();
    }
  });
  document.getElementById('delete-btn').addEventListener('click', deleteNote);

  window.addEventListener('beforeunload', () => {
    if (isEditing && currentNoteId) {
      const payload = new Blob([JSON.stringify({})], { type: 'application/json' });
      navigator.sendBeacon(`${API_BASE}/notes/${currentNoteId}/unlock`, payload);
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  setupEditor();
  setupAuthForm();
  setupEventListeners();
  await tryAutoLogin();
});
