---
id: m_boot_010
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'docs/vi/QUALITY.md' }
created: 2026-07-11
author: agent:claude
---

# Lệnh commit phải bị điều kiện hoá theo exit code của gate — không chain bằng ';'

Đã xảy ra thật HAI lần: (1) commit b52c3b3 — `npm run check; git commit` trên PowerShell, check đỏ nhưng commit vẫn lọt; (2) commit 08fba8f — `npm run check | tail -4 && git commit` trên bash, `&&` có đó nhưng PIPE nuốt exit code (tail trả 0) nên gate đỏ vẫn không chặn được. Quy tắc: commit chỉ chạy khi gate xanh, VÀ không được pipe lệnh gate (hoặc phải `set -o pipefail` / kiểm tra `PIPESTATUS[0]`); chắc nhất là chạy check và commit ở hai bước tách biệt có nhìn kết quả ở giữa.

**Why:** gate chỉ có giá trị khi nó thực sự chặn được; một lần lọt là tiền lệ cho mọi lần sau — và biến thể pipe cho thấy "có && rồi" chưa phải là đã an toàn.
