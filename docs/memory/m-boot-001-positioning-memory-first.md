---
id: m_boot_001
type: decision
status: fresh
anchors:
  - { kind: file, path: 'docs/vi/SURVEY.md' }
created: 2026-07-10
author: human:daiba + agent:claude
---

# Định vị memory-first, không cạnh tranh code-graph

haido KHÔNG phải code-graph MCP server. Lớp bản đồ cấu trúc chỉ giữ mức tối thiểu (symbol + hash + import) làm giá đỡ neo; toàn bộ giá trị dồn vào vòng đời trí nhớ: remember → tự stale → review → reanchor.

**Why:** khảo sát 10/07/2026: `codebase-memory-mcp` (29.5k⭐, MIT, 158 ngôn ngữ, có embeddings + viz) đã chiếm trọn lớp bản đồ; cạnh tranh trực diện là thua từ đầu. Kẻ thù của haido là "sự quên", không phải tool khác.
