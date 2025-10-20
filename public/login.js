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
      window.location.href = 'index.html';
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

  // Add label hiding logic
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const usernameLabel = usernameInput.previousElementSibling;
  const passwordLabel = passwordInput.previousElementSibling;

  function toggleLabel(input, label) {
    if (input.value.trim() !== '') {
      label.style.display = 'none';
    } else {
      label.style.display = 'block';
    }
  }

  usernameInput.addEventListener('input', () => toggleLabel(usernameInput, usernameLabel));
  passwordInput.addEventListener('input', () => toggleLabel(passwordInput, passwordLabel));

  // Initial check
  toggleLabel(usernameInput, usernameLabel);
  toggleLabel(passwordInput, passwordLabel);
}

async function checkIfLoggedIn() {
  if (authToken) {
    try {
      await request('/profile');
      window.location.href = 'index.html';
    } catch (err) {
      localStorage.removeItem('qnotes_token');
      authToken = null;
    }
  }
  setupAuthForm();
}

window.addEventListener('load', checkIfLoggedIn);
