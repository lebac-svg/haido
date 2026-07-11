---
id: m_boot_016
type: convention
status: fresh
anchors:
  - { kind: file, path: 'src/viz/html.ts' }
  - { kind: file, path: 'src/viz/live.ts' }
created: 2026-07-11
author: human:daiba + agent:claude
---

# Đài chỉ huy: hợp đồng bố cục & hiển thị user đã duyệt từng bước bằng mắt

Bố cục chốt 11/07: địa cầu 3D là khung LỚN NHẤT (KHÔNG tự quay — chỉ xoay khi kéo; hover có tooltip kỹ thuật; chọn/hover spotlight dây liên kết + dây neo y như 2D), hải đồ 2D cỡ làm việc (tự căn khung tới khi user cầm lái), trạm review là cột phải 420px thường trực (lặng: ✅ + đếm tiêm; drift: viền hổ phách + diff màu + lệnh reanchor kèm nút chép), boong dưới chia đều feed/soi chi tiết/nhật ký. Recall phải NHÌN THẤY ĐƯỢC: hook đóng dấu `lastInject` → server phát `hot.injected` → kim cương nhấp lam + băng sự kiện `🤖 tiêm ghi chú`. Băng sự kiện có backlog bền từ `.haido/events.jsonl` — F5/restart không mất lịch sử.

**Why:** từng chi tiết ở đây là kết quả một vòng feedback user nhìn ảnh thật rồi chốt — phiên sau tự ý "tối ưu" bố cục, bật lại auto-rotate, hay bỏ backlog là phá hợp đồng UX đã ký.
