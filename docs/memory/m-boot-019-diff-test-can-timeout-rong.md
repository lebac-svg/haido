---
id: m_boot_019
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'test/diff.test.ts' }
created: 2026-07-29
author: human:daiba + agent:claude
---

# `diff.test.ts` đặt timeout cho CẢ FILE, vì sửa từng test chỉ đẩy lỗi sang test bên cạnh

Mọi test trong file (trừ nhóm `tokenDiff` thuần hàm) làm I/O thật: mkdtemp, mở và migrate better-sqlite3, chạy một pass index. Trên runner Windows nguội đo được 8,0s cho test migration và 4,5s cho test drift, so với mặc định 5s của vitest.

**Why:** ngày 29/07/2026 đã nới timeout cho riêng test migration; lần chạy CI kế tiếp đỏ lại đúng file đó nhưng ở test drift — cái vốn nằm sát mép 5s. Sửa từng test là đuổi theo triệu chứng. `vi.setConfig` cấp file bao luôn mọi test viết sau này. Đừng hạ 30s xuống cho "gọn": đó là ngân sách đo trên máy chậm nhất.
