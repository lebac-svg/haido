---
id: m_boot_015
type: decision
status: fresh
anchors:
  - { kind: file, path: 'src/indexer/indexer.ts' }
  - { kind: file, path: 'src/memory/staleness.ts' }
  - { kind: file, path: 'src/core/db.ts' }
created: 2026-07-11
author: agent:claude
---

# Backfill dữ liệu dẫn xuất bằng tự-lành trong pass thường kỳ, không dùng mẹo migration một phát

Dữ liệu dẫn xuất bị thiếu (norm_text, anchor snapshot…) được backfill kiểu TỰ LÀNH: indexer re-parse hàng có `norm_text IS NULL` bất kể mtime; reconcile đắp snapshot cho anchor fresh còn thiếu. KHÔNG dùng mẹo một phát: riêng 11/07/2026 đã có HAI mẹo thất bại — (1) `UPDATE files SET mtime=0` trong migration bị short-circuit content-hash của indexer chặn (file chỉ bị "touch", không re-parse); (2) trông cậy `import --pack` thì nhánh "unchanged" bỏ qua writeAnchors. Migration schema chỉ ALTER cấu trúc, không đụng dữ liệu.

**Why:** mẹo một phát phải đoán đúng MỌI đường ngắn-mạch phía sau nó mới chạy; tự-lành thì hội tụ dần và sửa được cả hàng hỏng vì lý do chưa biết — hai cú trượt cùng một ngày là đủ bằng chứng.
