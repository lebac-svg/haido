---
id: m_boot_003
type: invariant
status: fresh
anchors:
  - { kind: file, path: 'docs/vi/ARCHITECTURE.md' }
created: 2026-07-10
author: human:daiba + agent:claude
---

# Hash symbol phải chuẩn hoá: bỏ comment + whitespace trước khi băm

`body_hash = sha1(normalize(body))`, trong đó normalize duyệt AST bỏ node comment rồi nối token bằng 1 space. Format code (prettier/black) hay sửa comment KHÔNG được làm đổi hash.

**Why:** nếu format-only làm stale hàng loạt thì hàng đợi review thành spam và user mất niềm tin vào tín hiệu stale — chết tính năng lõi. Bảng test vàng cho normalize là bất khả xâm phạm (QUALITY §2).
