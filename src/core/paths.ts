import path from 'node:path';

/**
 * All paths stored in the DB / used in qnames are repo-relative POSIX paths.
 * (Claude Code hooks hand us absolute Windows paths — see docs/memory/m-boot-007.)
 */
export function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}

/** Absolute (or relative) OS path -> repo-relative POSIX path, or null if outside the repo. */
export function toRepoRelative(repoRoot: string, anyPath: string): string | null {
  const abs = path.isAbsolute(anyPath) ? anyPath : path.resolve(repoRoot, anyPath);
  const rel = path.relative(repoRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/** POSIX dirname for repo-relative paths. Returns '' at repo root. */
export function posixDirname(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}

/** Join + normalize POSIX segments, resolving '.' and '..' (stays repo-relative). */
export function posixJoin(...segments: string[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    for (const piece of seg.split('/')) {
      if (piece === '' || piece === '.') continue;
      if (piece === '..') parts.pop();
      else parts.push(piece);
    }
  }
  return parts.join('/');
}
