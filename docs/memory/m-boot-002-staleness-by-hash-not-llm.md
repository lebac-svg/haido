---
id: m_boot_002
type: invariant
status: fresh
anchors:
  - { kind: file, path: 'docs/vi/ARCHITECTURE.md' }
created: 2026-07-10
author: human:daiba + agent:claude
---

# Staleness luôn dựa trên hash khách quan, không bao giờ để LLM tự phản tư

Trạng thái stale của memory chỉ được quyết định bởi so sánh content-hash của code tại neo (+ diff kèm theo). Cấm mọi cơ chế "LLM tự soi rồi tự sửa/tự sinh memory" không có bằng chứng.

**Why:** self-correction không neo đã được chứng minh là yếu (Huang et al. 2024); memory rác tự sinh nguy hiểm hơn không có memory. Đây cũng chính là điểm khác biệt của haido so với self-editing memory của codemem/Letta và memify của cognee.
