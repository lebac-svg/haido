import Database from 'better-sqlite3';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

export type Db = InstanceType<typeof Database>;

/** Open (or create) a haido database and ensure the schema is present. */
export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const hasMeta = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
    .get();
  if (!hasMeta) {
    db.exec(SCHEMA_SQL);
    db.prepare(`INSERT INTO meta(key, value) VALUES ('schema_version', ?)`).run(
      String(SCHEMA_VERSION),
    );
    return;
  }
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    { value: string } | undefined;
  let version = row ? Number(row.value) : 0;

  if (version === 1) {
    // v2: normalized-text snapshots so drift reviews can show WHAT changed.
    // No data backfill here — the indexer re-parses any row whose norm_text
    // is NULL on its next pass (self-healing beats one-shot migration tricks).
    db.exec(
      `ALTER TABLE files ADD COLUMN norm_text TEXT;
       ALTER TABLE symbols ADD COLUMN norm_text TEXT;
       ALTER TABLE anchors ADD COLUMN snapshot TEXT;`,
    );
    version = 2;
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run(String(version));
  }

  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `haido.db schema version ${version} != expected ${SCHEMA_VERSION}. ` +
        `No migration path from this version — delete .haido/haido.db and re-run 'haido index' ` +
        `(memories are safe if they live in a pack: 'haido import --pack <dir>').`,
    );
  }
}
