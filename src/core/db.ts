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
  const version = row ? Number(row.value) : 0;
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `haido.db schema version ${version} != expected ${SCHEMA_VERSION}. ` +
        `No migration path yet (pre-release) — delete .haido/haido.db and re-run 'haido index'.`,
    );
  }
}
