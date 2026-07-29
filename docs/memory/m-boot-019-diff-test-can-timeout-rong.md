---
id: m_boot_019
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'test/diff.test.ts' }
created: 2026-07-29
author: human:daiba + agent:claude
---

# `diff.test.ts` cần timeout 30s: nó làm I/O thật, 5s mặc định không đủ trên CI Windows

Test `schema migration v1 → v2` chạy mkdtemp + mở better-sqlite3 + migrate. Đo được ~8s trên runner Windows nguội. Ngày 29/07/2026 nó đỏ trên `windows-latest, 22` nhưng xanh trên `windows-latest, 24` cùng lần chạy, và xanh cả 4/4 ở một PR khác chứa đúng commit ấy — sai ngân sách thời gian, không sai assertion.

**Why:** CI đỏ trong khi máy mình xanh khiến người ta đi tìm lỗi trong thay đổi của chính mình; đã mất một vòng kéo log, đối chiếu lịch sử run trên main và so hai runner mới kết luận được. Đừng hạ con số 30s xuống cho "gọn": nó là ngân sách đo được trên máy chậm nhất, không phải số tuỳ tiện.
