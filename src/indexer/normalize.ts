import { createHash } from 'node:crypto';
import type { Node } from 'web-tree-sitter';

/**
 * Content fingerprint of a symbol (docs/memory/m-boot-003):
 * walk the AST, DROP comments, join remaining leaf tokens with a single space.
 * Formatting-only edits (whitespace, indentation, comments) MUST NOT change the hash;
 * any real token change MUST change it.
 */
const SKIP_TYPES = new Set(['comment', 'hash_bang_line']);

export function normalizedText(node: Node): string {
  const parts: string[] = [];
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n || SKIP_TYPES.has(n.type)) continue;
    const count = n.childCount;
    if (count === 0) {
      if (n.text.length > 0) parts.push(n.text);
      continue;
    }
    for (let i = count - 1; i >= 0; i--) {
      const child = n.child(i);
      if (child) stack.push(child);
    }
  }
  return parts.join(' ');
}

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/**
 * Stored copy of the normalized text is capped (diff rendering needs the head,
 * not megabytes); the HASH is always computed over the FULL text.
 */
export const SNAPSHOT_CAP = 20_000;

export function hashNode(node: Node): string {
  return sha1(normalizedText(node));
}
