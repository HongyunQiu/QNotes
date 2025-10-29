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

module.exports = db;
