---
id: m_boot_007
type: invariant
status: fresh
anchors:
  - { kind: file, path: 'experiments/hooks-probe/FINDINGS.md' }
  - { kind: file, path: 'docs/vi/ARCHITECTURE.md' }
created: 2026-07-10
author: agent:claude
---

# Hợp đồng hooks Claude Code (đã kiểm chứng thật 10/07/2026)

(1) `additionalContext` tới model ở cả SessionStart lẫn PostToolUse, kể cả headless `-p`. (2) PostToolUse BẮT BUỘC dạng JSON `hookSpecificOutput` — stdout thuần không tới model. (3) `tool_input.file_path` là đường dẫn TUYỆT ĐỐI kiểu Windows (backslash + Unicode) → hook runner phải chuẩn hoá về repo-relative POSIX trước khi tra anchor. (4) `session_id` có trong mọi event → khoá dedup `.haido/session/<id>.json`. (5) Hook chạy với cwd = repo root → dùng lệnh tương đối.

**Why:** đây là hợp đồng API nền của toàn bộ UX auto-inject; sai một điểm (nhất là path) là recall câm lặng không ai biết. Canary test tái chạy được: chép `settings.probe.json` → `.claude/settings.json`.
