const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'qnotes.db');
const dbDir = path.dirname(dbFile);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbFile);

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  content_text TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lock_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lock_expires_at TEXT
);

-- 应用设置（键值对）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 用户组
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- 用户与组的关联（多对多）
CREATE TABLE IF NOT EXISTS user_groups (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

-- 二级节点到组的一对一授权（未配置表示公开）
CREATE TABLE IF NOT EXISTS section_group (
  section_note_id INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE
);
`);

// Ensure "keywords" column exists for existing databases created before this field was added
try {
  const columns = db.prepare("PRAGMA table_info(notes)").all();
  const hasKeywords = columns.some((c) => c.name === 'keywords');
  const hasContentText = columns.some((c) => c.name === 'content_text');
  if (!hasKeywords) {
    db.prepare("ALTER TABLE notes ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'").run();
  }
  if (!hasContentText) {
    db.prepare("ALTER TABLE notes ADD COLUMN content_text TEXT NOT NULL DEFAULT ''").run();
  }
} catch (err) {
  // Swallow error to avoid crashing if PRAGMA fails unexpectedly
}

// Ensure "is_admin" column exists for existing databases created before this field was added
try {
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasIsAdmin = userColumns.some((c) => c.name === 'is_admin');
  if (!hasIsAdmin) {
    db.prepare("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0").run();
  }
} catch (err) {
  // ignore
}

// Ensure default auth mode setting exists
try {
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'auth_mode'").get();
  if (!existing) {
    db.prepare("INSERT INTO settings(key, value) VALUES('auth_mode', 'team')").run();
  }
} catch (_) {
  // ignore
}

// Guarantee there is at least one admin user: if none, promote the earliest user
try {
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1").get().c || 0;
  if (adminCount === 0) {
    const firstUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();
    if (firstUser && firstUser.id) {
      db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(firstUser.id);
    }
  }
} catch (_) {
  // ignore
}

module.exports = db;
