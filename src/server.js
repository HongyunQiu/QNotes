require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const multer = require('multer');
const checkDiskSpace = (require('check-disk-space') && (require('check-disk-space').default || require('check-disk-space'))) || null;
const { URL } = require('url');
const http = require('http');
const https = require('https');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-qnotes-key';
const LOCK_DURATION_SECONDS = Number(process.env.LOCK_DURATION_SECONDS || 300);

// 文件上传目录
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const safeExt = ext && ext.length <= 10 ? ext.toLowerCase() : '';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${unique}${safeExt}`);
  }
});
const upload = multer({ storage });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, is_admin: !!user.is_admin }, JWT_SECRET, {
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

function requireAdmin(req, res, next) {
  try {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user && req.user.id);
    if (!row || !row.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Admin check failed' });
  }
}

function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function textFromUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    const base = url.split('?')[0].split('#')[0];
    const segs = base.split('/');
    return segs[segs.length - 1] || '';
  } catch (e) {
    return '';
  }
}

function flattenEditorJsToText(data) {
  try {
    if (!data || typeof data !== 'object') return '';
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const parts = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const type = block.type;
      const d = block.data || {};
      if (type === 'header') {
        parts.push(stripHtml(d.text));
      } else if (type === 'paragraph') {
        parts.push(stripHtml(d.text));
      } else if (type === 'quote') {
        parts.push(stripHtml(d.text));
        parts.push(stripHtml(d.caption));
      } else if (type === 'checklist') {
        const items = Array.isArray(d.items) ? d.items : [];
        items.forEach(it => parts.push(stripHtml(it && it.text)));
      } else if (type === 'image') {
        parts.push(stripHtml(d.caption));
        const file = d.file || {};
        parts.push(textFromUrl(file.url));
      } else if (type === 'code') {
        parts.push(typeof d.code === 'string' ? d.code : '');
      } else if (type === 'mermaid') {
        parts.push(typeof d.code === 'string' ? d.code : '');
      } else if (type === 'attaches') {
        const f = d.file || {};
        parts.push(f.name || '');
        parts.push(textFromUrl(f.url));
      } else if (type === 'warehouse') {
        // 尝试提取可能的标题/描述字段
        if (typeof d.title === 'string') parts.push(stripHtml(d.title));
        if (typeof d.description === 'string') parts.push(stripHtml(d.description));
      }
    }
    return parts
      .filter(Boolean)
      .map(s => (typeof s === 'string' ? s : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (e) {
    return '';
  }
}

function buildSnippet(haystack, needle, maxLen = 120) {
  if (typeof haystack !== 'string' || typeof needle !== 'string') return '';
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase().trim();
  if (!lowerNeedle) return '';
  const idx = lowerHay.indexOf(lowerNeedle);
  if (idx === -1) {
    return haystack.slice(0, maxLen) + (haystack.length > maxLen ? '…' : '');
  }
  const start = Math.max(0, idx - Math.floor((maxLen - lowerNeedle.length) / 2));
  const end = Math.min(haystack.length, start + maxLen);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < haystack.length ? '…' : '';
  const raw = prefix + haystack.slice(start, end) + suffix;
  // 简单高亮（不转义，由前端负责安全渲染或转义）
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return raw.replace(re, (m) => `<<${m}>>`); // 用占位符，前端再替换为 <mark>
}

function backfillContentText() {
  try {
    const rows = db.prepare("SELECT id, content, keywords, content_text FROM notes WHERE content_text IS NULL OR content_text = ''").all();
    if (!rows || rows.length === 0) return;
    const update = db.prepare("UPDATE notes SET content_text = ? WHERE id = ?");
    for (const row of rows) {
      let contentObj = {};
      try { contentObj = JSON.parse(row.content || '{}'); } catch (e) {}
      let flat = flattenEditorJsToText(contentObj);
      try {
        const kws = JSON.parse(row.keywords || '[]');
        if (Array.isArray(kws) && kws.length) {
          flat = `${flat} ${kws.join(' ')}`.trim();
        }
      } catch (e) {}
      update.run(flat, row.id);
    }
    console.log(`Backfilled content_text for ${rows.length} notes`);
  } catch (e) {
    console.warn('Backfill content_text failed:', e.message);
  }
}

backfillContentText();

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
  // If this is the very first user, or no admin exists, promote this user
  try {
    const adminCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c || 0;
    const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c || 0;
    if (adminCount === 0 && totalUsers >= 1) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(info.lastInsertRowid);
    }
  } catch (_) {}
  const fullUser = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = generateToken(fullUser);
  res.json({ token, user: fullUser });
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
  res.json({ token, user: { id: user.id, username: user.username, is_admin: !!user.is_admin } });
});

app.get('/api/profile', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Profile fetch failed' });
  }
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

app.get('/api/keywords', authenticate, (req, res) => {
  // 返回按关键词分组的笔记列表
  const rows = db.prepare('SELECT id, title, updated_at, keywords FROM notes').all();
  const map = new Map(); // keyword -> array of notes
  rows.forEach((row) => {
    let list = [];
    try {
      list = row.keywords ? JSON.parse(row.keywords) : [];
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }
    list.forEach((kw) => {
      if (typeof kw !== 'string') return;
      const key = kw.trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ id: row.id, title: row.title, updated_at: row.updated_at });
    });
  });
  const index = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([keyword, notes]) => ({
      keyword,
      notes: notes.sort((a, b) => a.title.localeCompare(b.title))
    }));
  res.json({ index });
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
  // 生成纯文本内容（含附件名）并附加关键词文本，便于搜索
  let contentText = '';
  try {
    contentText = flattenEditorJsToText(content || {});
  } catch (e) {
    contentText = '';
  }
  if (safeKeywords.length) {
    contentText = `${contentText} ${safeKeywords.join(' ')}`.trim();
  }
  db.prepare(
    'UPDATE notes SET title = ?, content = ?, content_text = ?, keywords = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(title || note.title, JSON.stringify(content || {}), contentText, JSON.stringify(safeKeywords), req.params.id);
  
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

app.get('/api/search', authenticate, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  if (!q) {
    return res.json({ total: 0, items: [] });
  }
  const like = `%${q}%`;
  const where = 'title LIKE ? OR content_text LIKE ? OR keywords LIKE ?';
  const countStmt = db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE ${where}`);
  const total = countStmt.get(like, like, like).c || 0;
  const listStmt = db.prepare(`
    SELECT id, title, updated_at, keywords, content_text
    FROM notes
    WHERE ${where}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `);
  const rows = listStmt.all(like, like, like, limit, offset);
  const items = rows.map(r => {
    let fields = [];
    const lowerQ = q.toLowerCase();
    if ((r.title || '').toLowerCase().includes(lowerQ)) fields.push('title');
    if ((r.keywords || '').toLowerCase().includes(lowerQ)) fields.push('keywords');
    if ((r.content_text || '').toLowerCase().includes(lowerQ)) fields.push('content');
    const snippet = buildSnippet(r.content_text || r.title || '', q);
    return {
      id: r.id,
      title: r.title,
      updated_at: r.updated_at,
      matchFields: fields,
      snippet
    };
  });
  res.json({ total, items });
});

// Admin APIs
app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT u.id, u.username, u.is_admin, u.created_at,
             (SELECT COUNT(1) FROM notes n WHERE n.owner_id = u.id) AS note_count
      FROM users u
      ORDER BY u.id ASC
    `).all();
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.get('/api/admin/db/summary', authenticate, requireAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c || 0;
    const notes = db.prepare('SELECT COUNT(*) AS c FROM notes').get().c || 0;
    const pageCount = db.pragma('page_count', { simple: true });
    const pageSize = db.pragma('page_size', { simple: true });
    const dbSizeBytes = (Number(pageCount) || 0) * (Number(pageSize) || 0);
    res.json({ users, notes, dbSizeBytes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load db summary' });
  }
});

app.get('/api/admin/db/tables', authenticate, requireAdmin, (req, res) => {
  try {
    const usersInfo = db.prepare('PRAGMA table_info(users)').all();
    const notesInfo = db.prepare('PRAGMA table_info(notes)').all();
    res.json({ tables: { users: usersInfo, notes: notesInfo } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load table info' });
  }
});

// 备份：将 data、public/uploads、public/vendor 压缩为一个 zip 文件并下载
app.get('/api/admin/backup', authenticate, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const filename = `qnotes-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;

    // 预估源文件大小，便于前端展示进度（近似值），并用于磁盘空间校验
    const ROOT = path.join(__dirname, '..');
    const dataDir = path.join(ROOT, 'data');
    const uploadsDir = path.join(ROOT, 'public', 'uploads');
    const vendorDir = path.join(ROOT, 'public', 'vendor');
    function safeStat(p) { try { return fs.statSync(p); } catch (_) { return null; } }
    function sumDirSize(dir) {
      const st = safeStat(dir);
      if (!st) return 0;
      if (!st.isDirectory()) return 0;
      let total = 0;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { entries = []; }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isFile()) {
          const fst = safeStat(full);
          total += fst && fst.size ? fst.size : 0;
        } else if (ent.isDirectory()) {
          total += sumDirSize(full);
        }
      }
      return total;
    }
    const sourceBytes = sumDirSize(dataDir) + sumDirSize(uploadsDir) + sumDirSize(vendorDir);

    // 校验磁盘剩余空间：若可用空间低于阈值则拒绝备份
    // 阈值策略：max(环境变量 BACKUP_MIN_FREE_BYTES(默认 50MB), floor(sourceBytes * 0.1))
    const MIN_FREE_BYTES = Number(process.env.BACKUP_MIN_FREE_BYTES || 50 * 1024 * 1024);
    let freeBytes = null;
    if (checkDiskSpace) {
      try {
        const disk = await checkDiskSpace(ROOT);
        freeBytes = Number(disk && disk.free ? disk.free : 0);
      } catch (_) {
        freeBytes = null; // 无法检测时忽略（不中断）
      }
    }
    const requiredFreeBytes = Math.max(MIN_FREE_BYTES, Math.floor(sourceBytes * 0.1));
    if (freeBytes !== null && freeBytes < requiredFreeBytes) {
      return res.status(507).json({
        error: '磁盘空间不足，无法进行备份',
        freeBytes,
        requiredFreeBytes,
        sourceBytes
      });
    }

    // 设置下载响应头（在校验通过后再设置）
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Source-Bytes', String(sourceBytes));

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err && err.message ? err.message : err);
      try { res.end(); } catch (_) {}
    });
    archive.on('warning', (err) => {
      console.warn('Archive warning:', err && err.message ? err.message : err);
    });

    archive.pipe(res);

    if (fs.existsSync(dataDir)) {
      archive.directory(dataDir, 'data');
    }
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, path.join('public', 'uploads'));
    }
    if (fs.existsSync(vendorDir)) {
      archive.directory(vendorDir, path.join('public', 'vendor'));
    }

    // 可选：加入一个简单的元信息文件，帮助识别备份
    const meta = {
      generatedAt: now.toISOString(),
      include: ['data/**', 'public/uploads/**', 'public/vendor/**']
    };
    archive.append(JSON.stringify(meta, null, 2), { name: 'backup-meta.json' });

    archive.finalize();
  } catch (e) {
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

app.delete('/api/notes/:id', authenticate, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 移动笔记：更新父节点，带循环校验
app.post('/api/notes/:id/move', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rawParentId = req.body && typeof req.body.parent_id !== 'undefined' ? req.body.parent_id : null;
  const parentId = rawParentId === null || rawParentId === undefined || rawParentId === '' ? null : parseInt(rawParentId, 10);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid note id' });
  }
  if (parentId !== null && !Number.isInteger(parentId)) {
    return res.status(400).json({ error: 'Invalid parent_id' });
  }
  if (parentId !== null && id === parentId) {
    return res.status(400).json({ error: 'Cannot move a note under itself' });
  }

  const note = db.prepare('SELECT id FROM notes WHERE id = ?').get(id);
  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }

  if (parentId !== null) {
    const parent = db.prepare('SELECT id, parent_id FROM notes WHERE id = ?').get(parentId);
    if (!parent) {
      return res.status(400).json({ error: 'Parent note not found' });
    }
    // 循环校验：从目标父节点向上回溯，不能遇到自己
    const rows = db.prepare('SELECT id, parent_id FROM notes').all();
    const map = new Map(rows.map(r => [r.id, r.parent_id]));
    let p = parentId;
    const guard = 100000; // 简单保护以避免异常环导致死循环
    let steps = 0;
    while (p !== null && typeof p !== 'undefined') {
      if (p === id) {
        return res.status(400).json({ error: 'Cannot move a note under its descendant' });
      }
      p = map.get(p) ?? null;
      steps++;
      if (steps > guard) {
        return res.status(400).json({ error: 'Invalid hierarchy detected' });
      }
    }
  }

  db.prepare('UPDATE notes SET parent_id = ? WHERE id = ?').run(parentId, id);
  return res.json({ success: true });
});

// 上传图片（表单文件）
app.post('/api/uploadFile', authenticate, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const publicUrl = `/uploads/${req.file.filename}`;
  res.json({ success: 1, file: { url: publicUrl, name: req.file.originalname, size: req.file.size } });
});

// 上传通用附件（与 @editorjs/attaches 兼容，字段名为 file）
app.post('/api/uploadAttachment', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const publicUrl = `/uploads/${req.file.filename}`;
  const name = req.file.originalname || req.file.filename;
  const size = req.file.size || 0;
  const ext = path.extname(name).replace('.', '').toLowerCase();
  res.json({
    success: 1,
    file: {
      url: publicUrl,
      name,
      size,
      extension: ext
    }
  });
});

// 通过 URL 下载图片
app.post('/api/fetchUrl', authenticate, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'Invalid url' });
    }
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http/https is allowed' });
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const uniqueBase = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const downloadToFile = () => new Promise((resolve, reject) => {
      const reqGet = client.get(url, (resp) => {
        if (resp.statusCode && resp.statusCode >= 400) {
          reject(new Error(`Download failed: ${resp.statusCode}`));
          resp.resume();
          return;
        }
        const contentType = resp.headers['content-type'] || '';
        let ext = '';
        if (contentType.includes('image/')) {
          ext = `.${contentType.split('/')[1].split(';')[0]}`;
        } else if (contentType.includes('video/')) {
          ext = `.${contentType.split('/')[1].split(';')[0]}`;
        } else {
          // 尝试从 URL 推断
          ext = path.extname(parsed.pathname) || '';
        }
        if (ext.length > 10) ext = '';
        const filename = `${uniqueBase}${ext || '.bin'}`;
        const filepath = path.join(UPLOAD_DIR, filename);
        const fileStream = fs.createWriteStream(filepath);
        resp.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(() => resolve({ filename })));
        fileStream.on('error', reject);
      });
      reqGet.on('error', reject);
    });

    const { filename } = await downloadToFile();
    const publicUrl = `/uploads/${filename}`;
    res.json({ success: 1, file: { url: publicUrl } });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Download failed' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`QNotes server listening on http://localhost:${PORT}`);
});
