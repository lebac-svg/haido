import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../core/db.js';
import { reconcileAnchors } from './staleness.js';
import { MEMORY_TYPES, type AnchorRow, type MemoryRow, type MemoryType } from './store.js';

/**
 * Markdown memory pack (SPEC §10, ARCHITECTURE §10): the DB is gitignored, the
 * pack is committed — knowledge travels with the repo and is reviewable in PRs.
 * Recorded anchor hashes are kept on import, so a note written on machine A
 * correctly shows up as DRIFT on machine B if the code moved on. No YAML dep:
 * the format is a restricted, self-parsed frontmatter.
 */
export interface PackExportResult {
  written: number;
  dir: string;
  /** *.md files in the dir whose id no longer exists (never deleted automatically). */
  orphans: string[];
}

export interface PackImportResult {
  imported: number;
  updated: number;
  unchanged: number;
  skipped: Array<{ file: string; reason: string }>;
}

interface ParsedAnchor {
  kind: 'symbol' | 'file';
  ref: string;
  hash?: string;
}

interface ParsedMemory {
  id: string;
  type: MemoryType;
  status: 'fresh' | 'needs_review' | 'retired';
  author: string;
  created: number;
  title: string;
  body: string;
  why: string;
  anchors: ParsedAnchor[];
}

export function exportPack(db: Db, dir: string): PackExportResult {
  mkdirSync(dir, { recursive: true });
  const memories = db.prepare(`SELECT * FROM memories ORDER BY created_at`).all() as MemoryRow[];
  const anchorsFor = db.prepare(`SELECT * FROM anchors WHERE memory_id = ? ORDER BY id`);

  const ids = new Set<string>();
  for (const m of memories) {
    ids.add(m.id);
    const anchors = anchorsFor.all(m.id) as AnchorRow[];
    const anchorLines = anchors.map((a) =>
      a.target_kind === 'symbol'
        ? `  - { kind: symbol, qname: '${a.qname}', hash: '${a.hash_at_link}' }`
        : `  - { kind: file, path: '${a.qname}', hash: '${a.hash_at_link}' }`,
    );
    const created = new Date(m.created_at).toISOString().slice(0, 10);
    const content = [
      '---',
      `id: ${m.id}`,
      `type: ${m.type}`,
      `status: ${m.status}`,
      'anchors:',
      ...anchorLines,
      `created: ${created}`,
      `author: ${m.author}`,
      '---',
      '',
      `# ${m.title}`,
      '',
      m.body,
      '',
      `**Why:** ${m.why}`,
      '',
    ].join('\n');
    writeFileSync(path.join(dir, `${m.id}.md`), content);
  }

  const orphans: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const id = /^id:\s*(\S+)\s*$/m.exec(readFileSync(path.join(dir, name), 'utf8'))?.[1];
    if (id && !ids.has(id)) orphans.push(name);
  }
  return { written: memories.length, dir, orphans };
}

export function importPack(db: Db, dir: string): PackImportResult {
  const result: PackImportResult = { imported: 0, updated: 0, unchanged: 0, skipped: [] };

  const currentSymbolHash = db.prepare(
    `SELECT body_hash AS h, norm_text AS snap FROM symbols WHERE qname = ? AND deleted_at IS NULL`,
  );
  const currentFileHash = db.prepare(
    `SELECT norm_hash AS h, norm_text AS snap FROM files WHERE path = ? AND deleted_at IS NULL`,
  );
  const getMemory = db.prepare(`SELECT * FROM memories WHERE id = ?`);
  const getAnchors = db.prepare(
    `SELECT target_kind, qname, hash_at_link FROM anchors WHERE memory_id = ? ORDER BY qname`,
  );
  const insertMemory = db.prepare(
    `INSERT INTO memories (id, type, title, body, why, status, author, session_id, created_at, updated_at)
     VALUES (@id, @type, @title, @body, @why, @status, @author, NULL, @created, @now)`,
  );
  const updateMemory = db.prepare(
    `UPDATE memories SET type = @type, title = @title, body = @body, why = @why,
       status = @status, author = @author, updated_at = @now WHERE id = @id`,
  );
  const deleteAnchors = db.prepare(`DELETE FROM anchors WHERE memory_id = ?`);
  const insertAnchor = db.prepare(
    `INSERT INTO anchors (memory_id, target_kind, qname, path, hash_at_link, snapshot, status)
     VALUES (?, ?, ?, ?, ?, ?, 'fresh')`,
  );

  const resolveHash = (a: ParsedAnchor): string => {
    if (a.hash && a.hash.length > 0) return a.hash;
    const row =
      a.kind === 'symbol'
        ? (currentSymbolHash.get(a.ref) as { h: string } | undefined)
        : (currentFileHash.get(a.ref) as { h: string } | undefined);
    return row?.h ?? '';
  };

  // The "old side" text of a future drift diff is only known when the recorded
  // fingerprint matches this machine's current code — otherwise the pre-drift
  // body never existed here and the snapshot honestly stays NULL.
  const resolveSnapshot = (a: ParsedAnchor, hash: string): string | null => {
    const row = (
      a.kind === 'symbol' ? currentSymbolHash.get(a.ref) : currentFileHash.get(a.ref)
    ) as { h: string; snap: string | null } | undefined;
    return row && row.h === hash ? row.snap : null;
  };

  const writeAnchors = (memoryId: string, anchors: ParsedAnchor[]): void => {
    deleteAnchors.run(memoryId);
    for (const a of anchors) {
      const anchorPath = a.kind === 'symbol' ? (a.ref.split('#')[0] ?? a.ref) : a.ref;
      const hash = resolveHash(a);
      insertAnchor.run(memoryId, a.kind, a.ref, anchorPath, hash, resolveSnapshot(a, hash));
    }
  };

  const files = readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md');
  const now = Date.now();

  db.transaction(() => {
    for (const name of files) {
      const parsed = parsePackFile(readFileSync(path.join(dir, name), 'utf8'));
      if (typeof parsed === 'string') {
        result.skipped.push({ file: name, reason: parsed });
        continue;
      }
      const existing = getMemory.get(parsed.id) as MemoryRow | undefined;
      if (!existing) {
        insertMemory.run({
          id: parsed.id,
          type: parsed.type,
          title: parsed.title,
          body: parsed.body,
          why: parsed.why,
          status: parsed.status,
          author: parsed.author,
          created: parsed.created,
          now,
        });
        writeAnchors(parsed.id, parsed.anchors);
        result.imported += 1;
        continue;
      }
      const sameFields =
        existing.type === parsed.type &&
        existing.title === parsed.title &&
        existing.body === parsed.body &&
        existing.why === parsed.why &&
        existing.status === parsed.status &&
        existing.author === parsed.author;
      const currentAnchors = (
        getAnchors.all(parsed.id) as Array<{
          target_kind: string;
          qname: string;
          hash_at_link: string;
        }>
      ).map((a) => `${a.target_kind}|${a.qname}|${a.hash_at_link}`);
      const packAnchors = parsed.anchors.map((a) => `${a.kind}|${a.ref}|${resolveHash(a)}`).sort();
      const sameAnchors = JSON.stringify(currentAnchors.sort()) === JSON.stringify(packAnchors);
      if (sameFields && sameAnchors) {
        result.unchanged += 1;
        continue;
      }
      updateMemory.run({
        id: parsed.id,
        type: parsed.type,
        title: parsed.title,
        body: parsed.body,
        why: parsed.why,
        status: parsed.status,
        author: parsed.author,
        now,
      });
      writeAnchors(parsed.id, parsed.anchors);
      result.updated += 1;
    }
  })();

  reconcileAnchors(db);
  return result;
}

/** Returns a ParsedMemory, or a string describing why the file was rejected. */
export function parsePackFile(raw: string): ParsedMemory | string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.trim());
  if (!fm) return 'no frontmatter block';
  const [, head = '', rest = ''] = fm;

  const field = (key: string): string | undefined =>
    new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(head)?.[1];

  const id = field('id');
  if (!id) return 'missing id';
  const type = field('type') as MemoryType | undefined;
  if (!type || !MEMORY_TYPES.includes(type)) return `invalid type '${type ?? ''}'`;
  const statusRaw = field('status') ?? 'fresh';
  const status =
    statusRaw === 'retired' ? 'retired' : statusRaw === 'needs_review' ? 'needs_review' : 'fresh';
  const author = field('author') ?? 'unknown';
  const createdRaw = field('created');
  const created = createdRaw ? Date.parse(createdRaw) : NaN;

  const anchors: ParsedAnchor[] = [];
  const anchorRe =
    /-\s*\{\s*kind:\s*(symbol|file)\s*,\s*(?:qname|path):\s*['"]([^'"]+)['"]\s*(?:,\s*hash:\s*['"]([^'"]*)['"]\s*)?\}/g;
  for (const m of head.matchAll(anchorRe)) {
    const kind = m[1] as 'symbol' | 'file';
    const ref = m[2] as string;
    anchors.push({ kind, ref, ...(m[3] !== undefined ? { hash: m[3] } : {}) });
  }
  if (anchors.length === 0) return 'no anchors';

  const titleMatch = /^#\s+(.+?)\s*$/m.exec(rest);
  if (!titleMatch?.[1]) return 'missing # title';
  const title = titleMatch[1];
  const afterTitle = rest.slice((titleMatch.index ?? 0) + titleMatch[0].length);
  const whyIdx = afterTitle.indexOf('**Why:**');
  if (whyIdx === -1) return 'missing **Why:** line';
  const body = afterTitle.slice(0, whyIdx).trim();
  const why = afterTitle.slice(whyIdx + '**Why:**'.length).trim();
  if (body.length === 0) return 'empty body';
  if (body.length > 700) return `body too long (${String(body.length)} > 700)`;
  if (why.length === 0) return 'empty why';

  return {
    id,
    type,
    status,
    author,
    created: Number.isFinite(created) ? created : Date.now(),
    title,
    body,
    why,
    anchors,
  };
}
