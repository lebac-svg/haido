# Nhật ký hải trình (memory pack viết tay)

Đây là trí nhớ của chính dự án haido, ghi **bằng tay theo đúng format pack của sản phẩm** (ARCHITECTURE §10) — dogfood triết lý từ ngày chưa có code. Khi lệnh `haido import --pack` ra đời, thư mục này trở thành bộ nhớ khởi động của chính haido (mốc *self-hosting*).

## Quy ước trong giai đoạn bootstrap

- Mỗi file = 1 memory, frontmatter: `id, type, status, anchors, created, author`; thân bài ngắn (≤ 700 ký tự) + dòng `**Why:**`.
- `type`: `decision` · `invariant` · `gotcha` · `convention` · `todo`.
- **Anchor giai đoạn spec trỏ vào file docs** (lúc này tài liệu *là* code) và chưa có trường `hash` — `haido import` sẽ tính hash lúc nhập. Khi code ra đời, move anchor sang symbol thật (tập dượt quy trình `reanchor`).
- Ghi chú sai so với hiện tại → sửa hoặc đổi `status: retired` ngay khi phát hiện (stale-review thủ công, QUALITY §1).
- Chỉ ghi thứ không suy ra được từ code/docs: quyết định + lý do, bất biến, bẫy đã sập, quy ước. Không chép nội dung, không ghi trạng thái task.
