---
id: m_boot_010
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'docs/QUALITY.md' }
created: 2026-07-11
author: agent:claude
---

# Lệnh commit phải bị điều kiện hoá theo exit code của gate — không chain bằng ';'

Đã xảy ra thật (commit b52c3b3): chạy `npm run check; git commit` trong một chuỗi PowerShell — check đỏ (prettier) nhưng commit vẫn lọt, vi phạm "không xanh không merge". Quy tắc: commit chỉ chạy khi gate xanh (`if ($LASTEXITCODE -eq 0) { git commit ... }` hoặc `&&`), hoặc chạy check và commit ở hai bước tách biệt có kiểm tra kết quả ở giữa.

**Why:** gate chỉ có giá trị khi nó thực sự chặn được; một lần lọt là tiền lệ cho mọi lần sau.
