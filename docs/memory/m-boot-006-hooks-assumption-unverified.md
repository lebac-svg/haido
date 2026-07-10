---
id: m_boot_006
type: gotcha
status: retired
anchors:
  - { kind: file, path: 'docs/ARCHITECTURE.md' }
created: 2026-07-10
author: agent:claude
---

# Giả định hooks Claude Code (additionalContext) CHƯA được kiểm chứng

Toàn bộ UX auto-inject (SessionStart/PostToolUse trả `additionalContext` trong `hookSpecificOutput`) mới là giả định từ tài liệu — chưa chạy thử thật. Không xây gì lên trên trước khi prototype 20 dòng xác nhận (việc số 1 của Sprint 0). Mọi giả định về API này phải cô lập trong `src/integrations/claude-code/`.

**Why:** đây là giả định rủi ro nhất của kiến trúc — nếu sai thì thiết kế hook runner (ARCHITECTURE §8) phải làm lại; phát hiện sớm rẻ hơn phát hiện muộn.

**Resolved (10/07/2026):** đã kiểm chứng bằng canary test 2/2 — xem `experiments/hooks-probe/FINDINGS.md` và ghi chú kế nhiệm [[m_boot_007]].
