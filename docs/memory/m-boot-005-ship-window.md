---
id: m_boot_005
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'docs/SURVEY.md' }
created: 2026-07-10
author: human:daiba + agent:claude
---

# Cửa sổ cạnh tranh chỉ 6–12 tháng — đối phó bằng cắt scope, không cắt chất lượng

`codebase-memory-mcp` đã có `manage_adr` (ghi quyết định mức project) — họ cách tính năng anchored-memory đúng một bước. Khi thấy chậm tiến độ: bỏ bớt tính năng v0.1, giữ nguyên gate chất lượng (QUALITY §2).

**Why:** dự án dạy kỷ luật mà tự phá kỷ luật để chạy đua thì mất luôn cả tư cách lẫn chất lượng; còn scope thì cắt được vì kiến trúc đã chia lớp (embeddings, viz, call graph đều đã là non-goal/v0.2+).
