/**
 * Output language for everything a human or agent reads from haido
 * (recall/overview/stale/hook strings). English is the public default;
 * a Vietnamese-speaking team sets `[ui] lang = "vi"` in haido.toml.
 * Memory CONTENT is user data and is never translated by the tool.
 */
export type Lang = 'en' | 'vi';

const STR = {
  recall_header: {
    en: '### Related memories (haido)',
    vi: '### Trí nhớ liên quan (haido)',
  },
  recall_empty: {
    en: '(no memories in this area yet)',
    vi: '(chưa có trí nhớ nào ở vùng này)',
  },
  needs_review_tag: {
    en: ' ⚠️NEEDS-REVIEW(code changed)',
    vi: ' ⚠️CẦN-REVIEW(code đã đổi)',
  },
  why: { en: 'why', vi: 'vì' },
  via_exact_symbol: { en: 'anchored at', vi: 'neo đúng' },
  via_exact_file: { en: 'anchored in', vi: 'neo trong' },
  via_same_file: { en: 'same file', vi: 'cùng file' },
  via_text_match: { en: 'text match', vi: 'khớp nội dung' },
  via_near: { en: 'nearby', vi: 'gần' },
  reason_import: { en: 'imports', vi: 'import' },
  reason_imported_by: { en: 'imported by', vi: 'được import bởi' },
  reason_cochange: { en: 'changes together', vi: 'hay đổi cùng nhau' },
  reason_cochange_times: { en: '{n}×', vi: '{n} lần' },
  reason_same_dir: { en: 'same directory', vi: 'cùng thư mục' },
  overview_header: { en: '### Project map (haido)', vi: '### Bản đồ dự án (haido)' },
  overview_root: { en: '(root)', vi: '(gốc)' },
  overview_line: {
    en: '- {dir} — {files} files · {symbols} symbols · {mems} notes{review}',
    vi: '- {dir} — {files} file · {symbols} symbol · {mems} ghi chú{review}',
  },
  overview_review_suffix: { en: ' (⚠ {n} need review)', vi: ' (⚠ {n} cần review)' },
  overview_laws: {
    en: '**Standing laws of this project (read before editing):**',
    vi: '**Luật của dự án (đọc trước khi sửa):**',
  },
  overview_stale_cta: {
    en: '⚠ {n} notes need review — call the stale_memories tool when convenient.',
    vi: '⚠ {n} ghi chú đang cần review — gọi tool stale_memories khi rảnh.',
  },
  overview_trimmed: {
    en: '- … (trimmed to fit the token budget)',
    vi: '- … (rút gọn cho vừa ngân sách token)',
  },
  summary_cochange: {
    en: 'co-change: {pairs} file pairs that change together (scanned {commits} commits)',
    vi: 'co-change: {pairs} cặp file hay đổi cùng nhau (quét {commits} commit)',
  },
  stale_empty: {
    en: 'review queue is empty — every memory matches the code ✅',
    vi: 'hàng đợi review trống — mọi ghi chú đều khớp với code ✅',
  },
  memline_review: {
    en: ' ⚠️(needs review — code changed)',
    vi: ' ⚠️(cần review — code đã đổi)',
  },
  live_serving: {
    en: 'live map: {url} — the page updates itself as the repo changes (ctrl+c to stop)',
    vi: 'bản đồ trực tiếp: {url} — trang tự cập nhật khi repo thay đổi (ctrl+c để dừng)',
  },
  live_update: {
    en: 'map updated · files: {files} · notes: {mems} · viewers: {clients}',
    vi: 'đã cập nhật bản đồ · file: {files} · ghi chú: {mems} · người xem: {clients}',
  },
  hook_drift_warning: {
    en:
      '⚠ haido: note [{id}] anchored at `{qname}` just went {state} because of this change — ' +
      'if it no longer holds, use the reanchor tool (confirm/move/retire) or update the note.',
    vi:
      '⚠ haido: ghi chú [{id}] neo `{qname}` vừa chuyển {state} vì thay đổi này — ' +
      'nếu nó hết đúng, dùng tool reanchor (confirm/move/retire) hoặc sửa nội dung ghi chú.',
  },
} as const;

export type StrKey = keyof typeof STR;

export function t(key: StrKey, lang: Lang, vars?: Record<string, string | number>): string {
  let s: string = STR[key][lang];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
