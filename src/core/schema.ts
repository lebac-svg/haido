/**
 * SQLite schema — single source of truth (docs/ARCHITECTURE.md §2).
 * `contains` edges are NOT stored: they are fully derived from symbols.file_id.
 */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,   -- repo-relative POSIX
  lang         TEXT NOT NULL,
  content_hash TEXT NOT NULL,          -- sha1 of raw file bytes (rename detection)
  norm_hash    TEXT NOT NULL,          -- sha1(normalize(whole file)) — file-anchor fingerprint
  norm_text    TEXT,                   -- normalize(whole file), capped — feeds drift diffs
  mtime        INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  indexed_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

CREATE TABLE IF NOT EXISTS symbols (
  id           INTEGER PRIMARY KEY,
  file_id      INTEGER NOT NULL REFERENCES files(id),
  kind         TEXT NOT NULL,          -- function|method|class|const|type
  name         TEXT NOT NULL,
  qname        TEXT NOT NULL,          -- 'src/engine/board.ts#Board.move'
  start_line   INTEGER NOT NULL,
  end_line     INTEGER NOT NULL,
  signature    TEXT,
  body_hash    TEXT NOT NULL,          -- sha1(normalize(body)) — see indexer/normalize.ts
  norm_text    TEXT,                   -- normalize(body), capped — feeds drift diffs
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER                 -- soft delete (staleness engine correlates later)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_symbols_qname_alive
  ON symbols(qname) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_bodyhash ON symbols(body_hash);

CREATE TABLE IF NOT EXISTS edges (
  src_kind TEXT NOT NULL,              -- 'file' | 'symbol'
  src_id   INTEGER NOT NULL,
  dst_kind TEXT NOT NULL,
  dst_id   INTEGER NOT NULL,
  kind     TEXT NOT NULL,              -- 'imports' | 'co_change'
  weight   REAL NOT NULL DEFAULT 1.0,
  meta     TEXT,
  PRIMARY KEY (src_kind, src_id, dst_kind, dst_id, kind)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_kind, dst_id, kind);

CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('decision','invariant','gotcha','convention','todo')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) <= 700),
  why        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','needs_review','retired')),
  author     TEXT NOT NULL,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anchors (
  id            INTEGER PRIMARY KEY,
  memory_id     TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('symbol','file')),
  qname         TEXT NOT NULL,         -- snapshot at link time (no hard FK: symbols may vanish)
  path          TEXT NOT NULL,
  hash_at_link  TEXT NOT NULL,
  snapshot      TEXT,                  -- normalize(target) at link/confirm time — the "old" side of drift diffs
  status        TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','drift','missing','moved')),
  stale_since   INTEGER,
  meta          TEXT
);
CREATE INDEX IF NOT EXISTS idx_anchors_qname ON anchors(qname);
CREATE INDEX IF NOT EXISTS idx_anchors_memory ON anchors(memory_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, body, why,
  content='memories', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, body, why)
  VALUES (new.rowid, new.title, new.body, new.why);
END;
CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body, why)
  VALUES ('delete', old.rowid, old.title, old.body, old.why);
END;
CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body, why)
  VALUES ('delete', old.rowid, old.title, old.body, old.why);
  INSERT INTO memories_fts(rowid, title, body, why)
  VALUES (new.rowid, new.title, new.body, new.why);
END;

CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
`;
