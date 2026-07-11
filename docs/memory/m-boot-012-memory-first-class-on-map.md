---
id: m_boot_012
type: decision
status: fresh
anchors:
  - { kind: file, path: 'src/viz/html.ts' }
created: 2026-07-11
author: human:daiba + agent:claude
---

# Trên bản đồ, trí nhớ là thực thể hạng nhất — kim cương ⬥ có dây neo, không chỉ là cái vòng

Feedback user 11/07 ("trí nhớ thể hiện ở đâu?"): mỗi memory được vẽ là một node kim cương riêng, dây đứt nối tới MỌI file nó neo (ghi chú neo code + docs hiện nguyên hình cây cầu code↔docs); vàng ⚠ = needs_review; hover đọc được body/why; click mở panel đầy đủ; spotlight hoạt động hai chiều (soi file → sáng ghi chú của nó, soi ghi chú → sáng các file neo). Viz JSON phải mang body/why.

**Why:** trí nhớ là linh hồn sản phẩm — nếu trên bản đồ nó chỉ là một cái vòng mảnh quanh node thì người dùng không thấy giá trị cốt lõi; bản đồ phải trả lời được "tri thức của dự án NẰM Ở ĐÂU" ngay từ cái nhìn đầu tiên.
