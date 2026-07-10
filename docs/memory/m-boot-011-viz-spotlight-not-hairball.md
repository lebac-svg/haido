---
id: m_boot_011
type: decision
status: fresh
anchors:
  - { kind: file, path: 'src/viz/html.ts' }
created: 2026-07-11
author: human:daiba + agent:claude
---

# Viz: spotlight khi trỏ/click, KHÔNG vẽ rõ mọi cạnh cùng lúc

Feedback user 11/07: bản đồ 2D "rất rối, không chia rõ cái nào liên kết với cái nào". Quy tắc chống hairball: cạnh mặc định chỉ là nền mờ; trỏ/click một node thì CHỈ liên kết của nó sáng lên (kèm mũi tên chiều import), phần còn lại chìm; mỗi thư mục có "vùng lãnh thổ" mờ để cụm tách nhau. Checkbox "hiện rõ mọi liên kết" dành cho ai thật sự muốn xem tất cả.

**Why:** với >100 node, force layout vẽ đủ cạnh là không đọc nổi — người dùng cần trả lời "file NÀY nối với ai", không phải nhìn toàn bộ mạng cùng lúc.
