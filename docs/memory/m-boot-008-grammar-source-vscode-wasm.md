---
id: m_boot_008
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'src/indexer/parser.ts' }
  - { kind: file, path: 'experiments/grammar-probe.mjs' }
created: 2026-07-10
author: agent:claude
---

# Grammar wasm phải lấy từ @vscode/tree-sitter-wasm — KHÔNG dùng tree-sitter-wasms

Package `tree-sitter-wasms` (0.1.13, bản mới nhất) build bằng ABI cũ: `Language.load` fail ở `getDylinkMetadata` với message RỖNG trên web-tree-sitter 0.26 — lỗi câm rất khó đoán. Nguồn đã kiểm chứng chạy tốt: `@vscode/tree-sitter-wasm` (16 grammar, ABI 14–15, Microsoft duy trì). Tái kiểm nhanh khi nâng version: `node experiments/grammar-probe.mjs <wasm>`.

**Why:** đã mất một vòng debug vì lỗi không message; grammar load là móng của toàn bộ indexer — nâng cấp web-tree-sitter hoặc đổi nguồn grammar mà không chạy probe là tự chuốc lấy lỗi câm.
