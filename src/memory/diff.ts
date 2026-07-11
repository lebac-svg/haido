/**
 * Token-level diff for drift review. Normalized bodies are ONE long line of
 * tokens (normalize joins with single spaces — m_boot_003), so line diffs are
 * useless here; the unit of change is the token.
 *
 * Output is a single compact line built for a terminal/agent, not a pager:
 * unchanged runs collapse to '…' (keeping a few context tokens), deletions
 * render as ⟨- …⟩ and insertions as ⟨+ …⟩, the whole thing capped.
 */
const MAX_TOKENS = 1500; // LCS bound after common prefix/suffix stripping
const CONTEXT = 3; // unchanged tokens kept on each side of a change
const MAX_OUT = 480; // characters

export function tokenDiff(oldText: string, newText: string): string {
  // \s+ so file-level snapshots (which keep newlines) tokenize cleanly too
  const a = oldText.split(/\s+/).filter((s) => s.length > 0);
  const b = newText.split(/\s+/).filter((s) => s.length > 0);

  // Strip the common prefix/suffix — a typical drift is a small change inside
  // a large body, and this keeps the LCS table tiny.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let post = 0;
  while (
    post < a.length - pre &&
    post < b.length - pre &&
    a[a.length - 1 - post] === b[b.length - 1 - post]
  ) {
    post++;
  }
  const midA = a.slice(pre, a.length - post).slice(0, MAX_TOKENS);
  const midB = b.slice(pre, b.length - post).slice(0, MAX_TOKENS);

  if (midA.length === 0 && midB.length === 0) return '(no token change)';

  const ops = lcsOps(midA, midB);
  const parts: string[] = [];
  if (pre > 0) parts.push(ellipsize(a.slice(0, pre), 'tail'));
  for (const op of ops) {
    if (op.kind === 'eq') parts.push(ellipsize(op.tokens, 'both'));
    else if (op.kind === 'del') parts.push(`⟨- ${op.tokens.join(' ')}⟩`);
    else parts.push(`⟨+ ${op.tokens.join(' ')}⟩`);
  }
  if (post > 0) parts.push(ellipsize(a.slice(a.length - post), 'head'));

  const line = parts.join(' ');
  return line.length > MAX_OUT ? `${line.slice(0, MAX_OUT)} …` : line;
}

type DiffOp = { kind: 'eq' | 'del' | 'ins'; tokens: string[] };

/** Classic LCS backtrack, coalesced into runs. Inputs are pre-capped. */
function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    }
  }
  const ops: DiffOp[] = [];
  const push = (kind: DiffOp['kind'], token: string): void => {
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) last.tokens.push(token);
    else ops.push({ kind, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('eq', a[i] as string);
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)) {
      push('del', a[i] as string);
      i++;
    } else {
      push('ins', b[j] as string);
      j++;
    }
  }
  while (i < n) {
    push('del', a[i] as string);
    i++;
  }
  while (j < m) {
    push('ins', b[j] as string);
    j++;
  }
  return ops;
}

/** Collapse a long unchanged run, keeping CONTEXT tokens at the open end(s). */
function ellipsize(tokens: string[], keep: 'head' | 'tail' | 'both'): string {
  const limit = keep === 'both' ? CONTEXT * 2 + 1 : CONTEXT + 1;
  if (tokens.length <= limit) return tokens.join(' ');
  if (keep === 'head') return `${tokens.slice(0, CONTEXT).join(' ')} …`;
  if (keep === 'tail') return `… ${tokens.slice(-CONTEXT).join(' ')}`;
  return `${tokens.slice(0, CONTEXT).join(' ')} … ${tokens.slice(-CONTEXT).join(' ')}`;
}
