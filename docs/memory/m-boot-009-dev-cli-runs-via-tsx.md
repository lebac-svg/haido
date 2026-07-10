---
id: m_boot_009
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'src/cli.ts' }
  - { kind: file, path: 'package.json' }
created: 2026-07-10
author: agent:claude
---

# CLI dev chạy bằng tsx, KHÔNG chạy được `node src/cli.ts` trực tiếp

Code dùng import kiểu NodeNext (`./x.js` trỏ tới file `.ts`); type-stripping native của Node KHÔNG rewrite `.js → .ts` nên `node src/cli.ts` fail resolve. Dev dùng `npm run cli -- <lệnh>` (tsx); phân phối thật cho user cần build `dist/` + bin (kế hoạch Sprint 4/packaging).

**Why:** ai (kể cả agent phiên sau) thử `node src/cli.ts` sẽ gặp lỗi resolve khó hiểu và tưởng CLI hỏng — trong khi chỉ là chọn sai runner.
