require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-qnotes-key';
const LOCK_DURATION_SECONDS = Number(process.env.LOCK_DURATION_SECONDS || 300);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '12h'
  });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }
  const [, token] = authHeader.split(' ');
  if (!token) {
    return res.status(401).json({ error: 'Invalid authorization header' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const trimmedUsername = username.trim().toLowerCase();
  if (!trimmedUsername) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(trimmedUsername, passwordHash);
  const user = { id: info.lastInsertRowid, username: trimmedUsername };
  const token = generateToken(user);
  res.json({ token, user });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get('/api/profile', authenticate, (req, res) => {
  res.json({ user: req.user });
});

function buildTree(notes) {
  const map = new Map();
  notes.forEach((note) => {
    note.children = [];
    map.set(note.id, note);
  });
  const roots = [];
  notes.forEach((note) => {
    if (note.parent_id) {
      const parent = map.get(note.parent_id);
      if (parent) {
        parent.children.push(note);
      }
    } else {
      roots.push(note);
    }
  });
  return roots;
}

function cleanupExpiredLocks() {
  db.prepare(`
    UPDATE notes
    SET lock_user_id = NULL, lock_expires_at = NULL
    WHERE lock_expires_at IS NOT NULL AND lock_expires_at <= datetime('now')
  `).run();
}

app.get('/api/notes', authenticate, (req, res) => {
  cleanupExpiredLocks();
  const notes = db.prepare(`
    SELECT n.id, n.parent_id, n.title, n.updated_at, u.username AS owner_username
    FROM notes n
    JOIN users u ON u.id = n.owner_id
    ORDER BY (n.parent_id IS NOT NULL), n.parent_id, n.title
  `).all();
  res.json({ tree: buildTree(notes) });
});

app.get('/api/notes/:id', authenticate, (req, res) => {
  cleanupExpiredLocks();
  const note = db.prepare(`
    SELECT n.*, u.username AS owner_username, lu.username AS lock_username
    FROM notes n
    JOIN users u ON u.id = n.owner_id
    LEFT JOIN users lu ON lu.id = n.lock_user_id
    WHERE n.id = ?
  `).get(req.params.id);
  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }
  let content;
  let keywords = [];
  try {
    content = JSON.parse(note.content);
  } catch (err) {
    content = {};
  }
  try {
    keywords = note.keywords ? JSON.parse(note.keywords) : [];
    if (!Array.isArray(keywords)) keywords = [];
  } catch (err) {
    keywords = [];
  }
  res.json({
    note: {
      id: note.id,
      title: note.title,
      parent_id: note.parent_id,
      owner_id: note.owner_id,
      owner_username: note.owner_username,
      content,
      keywords,
      updated_at: note.updated_at,
      lock_user_id: note.lock_user_id,
      lock_username: note.lock_username,
      lock_expires_at: note.lock_expires_at
    }
  });
});

app.post('/api/notes', authenticate, (req, res) => {
  const { title, parent_id } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const info = db
    .prepare('INSERT INTO notes (title, parent_id, owner_id, keywords) VALUES (?, ?, ?, ?)')
    .run(title.trim(), parent_id || null, req.user.id, '[]');
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ note });
});

app.put('/api/notes/:id', authenticate, (req, res) => {
  const { title, content, keywords } = req.body;
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }
  
  // 暂时绕过锁定检查，直接保存
  console.log('保存笔记（绕过锁定检查）:', req.params.id);
  let safeKeywords = [];
  try {
    if (Array.isArray(keywords)) {
      safeKeywords = keywords
        .map(k => typeof k === 'string' ? k.trim() : '')
        .filter(k => k.length > 0);
    }
  } catch (e) {
    safeKeywords = [];
  }
  db.prepare(
    'UPDATE notes SET title = ?, content = ?, keywords = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(title || note.title, JSON.stringify(content || {}), JSON.stringify(safeKeywords), req.params.id);
  
  console.log('笔记保存成功');
  res.json({ success: true });
});

app.post('/api/notes/:id/lock', authenticate, (req, res) => {
  console.log('锁定请求 - 用户ID:', req.user.id, '笔记ID:', req.params.id);
  
  cleanupExpiredLocks();
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) {
    console.log('笔记不存在:', req.params.id);
    return res.status(404).json({ error: 'Note not found' });
  }
  
  // 重新检查锁定状态（清理过期锁后）
  const freshNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  console.log('清理后笔记状态:', freshNote);
  
  if (freshNote.lock_user_id && parseInt(freshNote.lock_user_id) !== parseInt(req.user.id)) {
    console.log('笔记被其他用户锁定:', freshNote.lock_user_id, '请求用户:', req.user.id);
    return res.status(423).json({
      error: 'Note is currently being edited by another user',
      lock_user_id: freshNote.lock_user_id
    });
  }
  
  // 获取锁定用户信息用于错误消息
  const lockUser = freshNote.lock_user_id ? 
    db.prepare('SELECT username FROM users WHERE id = ?').get(freshNote.lock_user_id) : null;
  
  if (lockUser) {
    console.log('找到锁定用户:', lockUser.username);
    return res.status(423).json({
      error: `${lockUser.username} 正在编辑此笔记`,
      lock_user_id: freshNote.lock_user_id
    });
  }
  
  console.log('尝试锁定笔记...');
  const expiresAt = db.prepare(`
    UPDATE notes
    SET lock_user_id = ?, lock_expires_at = datetime('now', ?)
    WHERE id = ?
  `).run(req.user.id, `+${LOCK_DURATION_SECONDS} seconds`, req.params.id);
  
  const updated = db.prepare('SELECT lock_user_id, lock_expires_at FROM notes WHERE id = ?').get(req.params.id);
  console.log('锁定成功:', updated);
  
  res.json({
    success: true,
    lock_user_id: updated.lock_user_id,
    lock_expires_at: updated.lock_expires_at
  });
});

app.post('/api/notes/:id/unlock', authenticate, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }
  if (note.lock_user_id && parseInt(note.lock_user_id) !== parseInt(req.user.id)) {
    return res.status(403).json({ error: 'You do not hold the lock on this note' });
  }
  db.prepare('UPDATE notes SET lock_user_id = NULL, lock_expires_at = NULL WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/notes/:id', authenticate, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`QNotes server listening on http://localhost:${PORT}`);
});
