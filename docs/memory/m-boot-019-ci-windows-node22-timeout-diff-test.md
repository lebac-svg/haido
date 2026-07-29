---
id: m_boot_019
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'test/diff.test.ts' }
created: 2026-07-29
author: human:daiba + agent:claude
---

# CI `windows-latest, Node 22` rớt `diff.test.ts` vì timeout, không phải vì thay đổi của bạn

Test `schema migration v1 → v2` làm I/O thật (mkdtemp + sqlite + index lại) và mất ~8s trên runner Windows chậm, trong khi vitest mặc định cho 5s. Ngày 29/07/2026 nó rớt ở PR #1 nhưng xanh trên windows Node 24 cùng lần chạy đó, và xanh cả 4/4 ở PR #2 vốn chứa đúng commit ấy. Chưa đặt `testTimeout` riêng cho nó.

**Why:** CI đỏ trong khi máy mình xanh làm người ta đi tìm lỗi trong thay đổi của chính mình. Đã mất một vòng kéo log, đối chiếu lịch sử run trên main và so hai runner mới kết luận được. Ghi lại để lần sau nhìn tên test là biết ngay hướng nào đúng.
