---
id: m_boot_017
type: decision
status: fresh
anchors:
  - { kind: file, path: 'src/indexer/indexer.ts' }
created: 2026-07-15
author: human:daiba + agent:codex
---

# GDScript được index cấp file cho tới khi có grammar đã kiểm chứng

Tệp .gd và project.godot phải xuất hiện trên bản đồ, được theo dõi thay đổi và dùng làm file anchor, nhưng chưa trích symbol. Chỉ nâng .gd lên symbol-level sau khi có tree-sitter grammar tương thích ABI và bộ test vàng.

**Why:** dự án Godot đầu tiên dùng haido đã cho thấy bản đồ chỉ có docs dù code game thay đổi; bỏ qua .gd làm live map sai thực tế, còn parser tự chế sẽ phá nguyên tắc tín hiệu khách quan.
