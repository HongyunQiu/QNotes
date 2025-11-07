## QNotes — Project Guide for AI Agents

### What this project is
QNotes is a lightweight collaborative notes app using Editor.js for block-style editing, Express for the API, and SQLite (better-sqlite3) for storage. The frontend is a static single page served from `public/`.

### Tech stack
- Backend: Node.js + Express (`src/server.js`), JWT auth, file uploads via `multer`
- DB: SQLite via `better-sqlite3` (`src/db.js`)
- Frontend: Vanilla JS + Editor.js in `public/` (main logic in `public/app.js`)
- Auth: Bearer JWT (`Authorization: Bearer <token>`) stored in `localStorage`

### Run locally
1) Install: `npm install`
2) Start: `npm start` (default `PORT=3000`)
3) Open: `http://localhost:3000`

Environment variables (optional):
- `PORT` (default 3000)
- `JWT_SECRET` (default `super-secret-qnotes-key`)
- `DB_FILE` (default `./data/qnotes.db`)
- `LOCK_DURATION_SECONDS` (default 300)

### Key directories and files
- `public/index.html`: loads Editor.js and tools via CDN, app shell
- `public/app.js`: initializes Editor.js (`setupEditor()`), app UI/events, saving, search
- `src/server.js`: Express API, auth, uploads, search, locking
- `src/db.js`: SQLite schema/bootstrap
- `doc/`: feature docs; see `EditorJS工具接入一般步骤(CDN).md` for adding Editor.js tools

### Data model (SQLite)
- `users(id, username, password_hash, created_at)`
- `notes(id, parent_id, title, content, content_text, keywords, owner_id, updated_at, lock_user_id, lock_expires_at)`
  - `content`: JSON string of Editor.js output
  - `content_text`: flattened text for search (derived)
  - `keywords`: JSON array of strings

### API overview (all under `/api`)
- Auth: `POST /register`, `POST /login`, `GET /profile`
- Notes tree: `GET /notes`
- Note CRUD: `POST /notes`, `GET /notes/:id`, `PUT /notes/:id`, `DELETE /notes/:id`
- Move note: `POST /notes/:id/move` (reparent with cycle checks)
- Locking: `POST /notes/:id/lock`, `POST /notes/:id/unlock`
- Search: `GET /search?q=...&limit&offset` (matches title, keywords, content_text)
- Uploads: `POST /uploadFile` (image), `POST /uploadAttachment` (generic attaches), `POST /fetchUrl` (download by URL)

### Frontend/editor notes
- Editor is created in `setupEditor()` with tools configured in `tools` map
- Tools loaded via CDN in `public/index.html` (e.g., Header, Paragraph, Checklist, Quote, Delimiter, Image, Mermaid, CodeFlask, Warehouse, Table)
- Whitelisting: `loadNote()` filters `data.blocks` to allowed `block.type` values; add new tools there when needed
- How to add an Editor.js tool (CDN): see doc `doc/EditorJS工具接入一般步骤(CDN).md`

### Conventions for agents
- Keep code readable; prefer explicit names; avoid deep nesting
- Don’t catch errors without handling; avoid unnecessary try/catch
- Preserve existing indentation style in edited files
- Validate plugin availability at runtime (e.g., `if (typeof window.Table === 'undefined') throw ...`)

### Typical flow
1) User registers or logs in → JWT stored
2) Notes tree loads → select note → `loadNote()` renders Editor.js data
3) Edits mark dirty; manual save or autosave triggers `editor.save()` → `PUT /api/notes/:id`
4) Search queries `GET /api/search` and highlights via placeholders (front-end marks)

### Where to start
- Minor UI/feature changes: `public/app.js`
- Editor.js tool updates: `public/index.html` (CDN), `public/app.js` (tools map + whitelist)
- API changes: `src/server.js`, schema in `src/db.js`

### Editor.js document
- visit https://editorjs.io/base-concepts/