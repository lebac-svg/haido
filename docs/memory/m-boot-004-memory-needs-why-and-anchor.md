---
id: m_boot_004
type: convention
status: fresh
anchors:
  - { kind: file, path: 'docs/SPEC.md' }
created: 2026-07-10
author: human:daiba + agent:claude
---

# Mọi memory bắt buộc có why + ≥1 anchor, thân ≤ 700 ký tự

Tool `remember` (và cả pack viết tay này) từ chối memory thiếu lý do hoặc không neo vào đâu. Một memory = một fact. Không chép code, không tóm tắt file, không ghi trạng thái task.

**Why:** ghi chú không neo là ghi chú sẽ thành rác — không ai biết nó nói về cái gì và bao giờ hết hạn; đây là nguyên nhân CLAUDE.md/Memory Bank mục nát theo thời gian (bài toán haido sinh ra để giải).
