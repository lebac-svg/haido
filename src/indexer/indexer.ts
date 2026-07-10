import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../core/db.js';
import { toPosix } from '../core/paths.js';
import type { IndexResult, SymbolDiff, SymbolInfo } from '../core/types.js';
import { extractSymbols } from './extract.js';
import { extractImports, loadTsPaths, resolveImport, type RawImport } from './imports.js';
import { hashNode, sha1 } from './normalize.js';
import { EXT_TO_LANG, parseSource, type LangId } from './parser.js';

export interface IndexOptions {
  root: string;
  db: Db;
  /** Injectable clock for tests. */
  now?: () => number;
}

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
]);
const MAX_FILE_BYTES = 1_500_000;

interface DiskFile {
  abs: string;
  rel: string;
  lang: LangId;
  mtime: number;
  size: number;
}

interface PendingFile {
  disk: DiskFile;
  contentHash: string;
  normHash: string;
  symbols: SymbolInfo[];
  imports: RawImport[];
}

/** Incremental index: only files whose mtime+size (then content hash) changed are re-parsed. */
export async function indexRepo(opts: IndexOptions): Promise<IndexResult> {
  const { db, root } = opts;
  const now = opts.now ? opts.now() : Date.now();

  const disk = scanDisk(root);
  const fileSet = new Set(disk.map((f) => f.rel));
  const dbFiles = db
    .prepare(`SELECT id, path, mtime, size, content_hash FROM files WHERE deleted_at IS NULL`)
    .all() as Array<{
    id: number;
    path: string;
    mtime: number;
    size: number;
    content_hash: string;
  }>;
  const dbByPath = new Map(dbFiles.map((r) => [r.path, r]));

  // Phase 1 — parse changed files (outside the write transaction).
  const pending: PendingFile[] = [];
  const touchedOnly: Array<{ id: number; mtime: number; size: number }> = [];
  for (const file of disk) {
    const row = dbByPath.get(file.rel);
    if (row && row.mtime === file.mtime && row.size === file.size) continue;
    const content = readFileSync(file.abs, 'utf8');
    const contentHash = sha1(content);
    if (row && row.content_hash === contentHash) {
      touchedOnly.push({ id: row.id, mtime: file.mtime, size: file.size });
      continue;
    }
    const tree = await parseSource(file.lang, content);
    const symbols = extractSymbols(tree, file.lang, file.rel);
    const imports = extractImports(tree, file.lang);
    const normHash = hashNode(tree.rootNode);
    tree.delete();
    pending.push({ disk: file, contentHash, normHash, symbols, imports });
  }
  const deletedRows = dbFiles.filter((r) => !fileSet.has(r.path));

  // Phase 2 — single write transaction.
  const tsPaths = loadTsPaths(root);
  const diffs: SymbolDiff[] = [];
  const stmt = {
    touchFile: db.prepare(`UPDATE files SET mtime = ?, size = ?, indexed_at = ? WHERE id = ?`),
    upsertFile: db.prepare(
      `INSERT INTO files (path, lang, content_hash, norm_hash, mtime, size, indexed_at, deleted_at)
       VALUES (@path, @lang, @hash, @normHash, @mtime, @size, @now, NULL)
       ON CONFLICT(path) DO UPDATE SET
         lang = @lang, content_hash = @hash, norm_hash = @normHash, mtime = @mtime, size = @size,
         indexed_at = @now, deleted_at = NULL
       RETURNING id`,
    ),
    aliveSymbols: db.prepare(
      `SELECT id, qname, body_hash FROM symbols WHERE file_id = ? AND deleted_at IS NULL`,
    ),
    insertSymbol: db.prepare(
      `INSERT INTO symbols (file_id, kind, name, qname, start_line, end_line, signature, body_hash, updated_at)
       VALUES (@fileId, @kind, @name, @qname, @startLine, @endLine, @signature, @bodyHash, @now)`,
    ),
    updateSymbol: db.prepare(
      `UPDATE symbols SET kind = @kind, name = @name, start_line = @startLine, end_line = @endLine,
         signature = @signature, body_hash = @bodyHash, updated_at = @now
       WHERE id = @id`,
    ),
    softDeleteSymbol: db.prepare(`UPDATE symbols SET deleted_at = ? WHERE id = ?`),
    softDeleteFile: db.prepare(`UPDATE files SET deleted_at = ? WHERE id = ?`),
    softDeleteFileSymbols: db.prepare(
      `UPDATE symbols SET deleted_at = ? WHERE file_id = ? AND deleted_at IS NULL`,
    ),
    listFileSymbols: db.prepare(
      `SELECT qname, body_hash FROM symbols WHERE file_id = ? AND deleted_at IS NULL`,
    ),
    clearImports: db.prepare(
      `DELETE FROM edges WHERE kind = 'imports' AND src_kind = 'file' AND src_id = ?`,
    ),
    clearEdgesTouching: db.prepare(
      `DELETE FROM edges WHERE (src_kind = 'file' AND src_id = ?) OR (dst_kind = 'file' AND dst_id = ?)`,
    ),
    insertImport: db.prepare(
      `INSERT OR IGNORE INTO edges (src_kind, src_id, dst_kind, dst_id, kind, weight)
       VALUES ('file', ?, 'file', ?, 'imports', 1.0)`,
    ),
    fileIdByPath: db.prepare(`SELECT id FROM files WHERE path = ? AND deleted_at IS NULL`),
  };

  const run = db.transaction(() => {
    for (const t of touchedOnly) stmt.touchFile.run(t.mtime, t.size, now, t.id);

    const indexedIds = new Map<string, number>();
    for (const p of pending) {
      const { id: fileId } = stmt.upsertFile.get({
        path: p.disk.rel,
        lang: p.disk.lang,
        hash: p.contentHash,
        normHash: p.normHash,
        mtime: p.disk.mtime,
        size: p.disk.size,
        now,
      }) as { id: number };
      indexedIds.set(p.disk.rel, fileId);

      const prev = new Map(
        (
          stmt.aliveSymbols.all(fileId) as Array<{ id: number; qname: string; body_hash: string }>
        ).map((s) => [s.qname, s]),
      );
      for (const s of p.symbols) {
        const old = prev.get(s.qname);
        if (!old) {
          stmt.insertSymbol.run({ fileId, now, ...s });
          diffs.push({ qname: s.qname, change: 'added', newHash: s.bodyHash });
        } else {
          prev.delete(s.qname);
          stmt.updateSymbol.run({
            id: old.id,
            now,
            kind: s.kind,
            name: s.name,
            startLine: s.startLine,
            endLine: s.endLine,
            signature: s.signature,
            bodyHash: s.bodyHash,
          });
          if (old.body_hash !== s.bodyHash) {
            diffs.push({
              qname: s.qname,
              change: 'changed',
              oldHash: old.body_hash,
              newHash: s.bodyHash,
            });
          }
        }
      }
      for (const gone of prev.values()) {
        stmt.softDeleteSymbol.run(now, gone.id);
        diffs.push({ qname: gone.qname, change: 'removed', oldHash: gone.body_hash });
      }
    }

    for (const r of deletedRows) {
      // list BEFORE soft-deleting, or the removed-diffs would always be empty
      for (const s of stmt.listFileSymbols.all(r.id) as Array<{
        qname: string;
        body_hash: string;
      }>) {
        diffs.push({ qname: s.qname, change: 'removed', oldHash: s.body_hash });
      }
      stmt.softDeleteFile.run(now, r.id);
      stmt.softDeleteFileSymbols.run(now, r.id);
      stmt.clearEdgesTouching.run(r.id, r.id);
    }

    // Import edges for (re)indexed files. Note (v0.1): an unchanged importer does not gain
    // an edge when its target appears later — documented limitation, fixed by full reindex.
    for (const p of pending) {
      const srcId = indexedIds.get(p.disk.rel);
      if (srcId === undefined) continue;
      stmt.clearImports.run(srcId);
      for (const raw of p.imports) {
        for (const target of resolveImport(p.disk.rel, raw, fileSet, tsPaths)) {
          const dst = stmt.fileIdByPath.get(target) as { id: number } | undefined;
          if (dst && dst.id !== srcId) stmt.insertImport.run(srcId, dst.id);
        }
      }
    }
  });
  run();

  return {
    filesSeen: disk.length,
    filesIndexed: pending.length,
    filesDeleted: deletedRows.length,
    diffs,
  };
}

function scanDisk(root: string): DiskFile[] {
  const out: DiskFile[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue;
        walk(path.join(absDir, name), relDir === '' ? name : `${relDir}/${name}`);
        continue;
      }
      if (!entry.isFile()) continue;
      const lang = EXT_TO_LANG[path.extname(name)];
      if (!lang) continue;
      if (name.endsWith('.d.ts') || name.includes('.min.')) continue;
      const abs = path.join(absDir, name);
      const st = statSync(abs);
      if (st.size > MAX_FILE_BYTES) continue;
      out.push({
        abs,
        rel: toPosix(relDir === '' ? name : `${relDir}/${name}`),
        lang,
        mtime: Math.trunc(st.mtimeMs),
        size: st.size,
      });
    }
  };
  walk(root, '');
  return out;
}
