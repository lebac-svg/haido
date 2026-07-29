---
id: m_boot_020
type: invariant
status: fresh
anchors:
  - { kind: file, path: 'src/integrations/claude-code/hook.ts' }
created: 2026-07-29
author: human:daiba + agent:claude
---

# Stop nudge phải đếm cả `updated_at`, không được rút gọn về mỗi `created_at`

Ghi chú import từ pack mang `created_at` là NGÀY trong frontmatter (0 giờ sáng), luôn nhỏ hơn `startedAt` của phiên. Đếm mỗi `created_at` thì nghi thức mà chính AGENTS.md quy định — viết `docs/memory/*.md` rồi `import --pack` — luôn bị tính là "chưa ghi gì".

**Why:** đã xảy ra thật 29/07/2026, hook mắng đúng phiên vừa ghi xong `m_boot_018`. Rollup staleness tự động cố ý KHÔNG đụng `updated_at` (staleness.ts), nên một lần index thường không thể làm hook câm — điều kiện này an toàn. Rút gọn về `created_at` cho "gọn" là tái tạo lại đúng lỗi cũ.
