export type SymbolKind = 'function' | 'method' | 'class' | 'const' | 'type';

export interface SymbolInfo {
  kind: SymbolKind;
  name: string;
  /** '<repo-relative posix path>#<Outer.Inner>' */
  qname: string;
  startLine: number; // 1-based
  endLine: number; // 1-based
  signature: string;
  bodyHash: string;
  /** normalize(body) capped at SNAPSHOT_CAP — feeds drift diffs at review time. */
  normText: string;
}

export type SymbolChange = 'added' | 'changed' | 'removed';

export interface SymbolDiff {
  qname: string;
  change: SymbolChange;
  oldHash?: string;
  newHash?: string;
}

export interface IndexResult {
  filesSeen: number;
  filesIndexed: number;
  filesDeleted: number;
  diffs: SymbolDiff[];
}
