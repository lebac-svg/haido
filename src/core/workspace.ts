import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function haidoDir(root: string): string {
  return path.join(root, '.haido');
}

export function dbPath(root: string): string {
  return path.join(haidoDir(root), 'haido.db');
}

export function workspaceExists(root: string): boolean {
  return existsSync(dbPath(root));
}

export function ensureWorkspace(root: string): string {
  mkdirSync(haidoDir(root), { recursive: true });
  return dbPath(root);
}
