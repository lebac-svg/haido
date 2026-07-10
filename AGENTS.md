# Luật làm việc cho AI agent trong repo haido

Repo này xây một công cụ trí nhớ cho AI — nên chính agent làm việc ở đây phải là hình mẫu của kỷ luật đó.

## Đọc trước khi làm (theo thứ tự)

1. `docs/SPEC.md` — sản phẩm là gì, phạm vi v0.1, các quyết định đã chốt (§14).
2. `docs/ARCHITECTURE.md` — thiết kế kỹ thuật + ADR; đừng phát minh lại điều đã quyết.
3. `docs/QUALITY.md` — hiến pháp chất lượng: 3 vòng phản chiếu, definition of done.
4. `docs/memory/` — nhật ký hải trình: quyết định/bất biến/bẫy còn hiệu lực. **Đọc hết trước khi sửa code.**

## Luật cứng

- **`npm run check` phải xanh trước khi kết thúc mọi phiên có sửa code.** Đỏ thì đọc output thật rồi sửa tận gốc — không sửa test cho qua, không skip.
- **Tự phê phải có neo:** chỉ kết luận "sai/đúng" dựa trên tín hiệu khách quan (test, tsc, eslint, số đo, hành vi chạy thật) — không "soi chay" rồi viết lại theo cảm giác.
- **Spec là luật:** làm lệch SPEC/ARCHITECTURE thì hoặc sửa code cho khớp, hoặc đề xuất diff sửa spec để user duyệt. Không lệch âm thầm, không tự sửa quyết định ở SPEC §14.
- **Nghi thức cuối phiên** (QUALITY §4): tự vấn có quyết định/bẫy/bất biến mới không → ghi vào `docs/memory/` đúng format (frontmatter + why + anchor). Đây là bản thủ công của tính năng Stop-hook tương lai.
- **Không tạo file `CLAUDE.md`** trong repo này (yêu cầu riêng của chủ dự án — file này gây trùng khi mở terminal).
- Trao đổi với user bằng **tiếng Việt** (xưng "tôi", gọi "bạn"). Code, comment, commit message bằng tiếng Anh.
- Commit chỉ khi user yêu cầu. Không push/publish (npm, GitHub) khi chưa được lệnh.

## Bối cảnh cạnh tranh (để khỏi đi lạc hướng)

Không biến haido thành code-graph server — mảng đó đã có `codebase-memory-mcp` (29.5k⭐) làm tốt. Giá trị của haido nằm ở **vòng đời trí nhớ**: neo bằng hash → tự phát hiện lỗi thời → review → reanchor. Chi tiết: `docs/SURVEY.md` §9–11.
