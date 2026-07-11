# Hải Đồ (`haido`)

> **Nhật ký hải trình cho AI coding agent.**
> Ghi quyết định vào đúng toạ độ trên bản đồ code — và tự biết khi nào ghi chú đã lỗi thời.

*(Tên đã chốt ngày 10/07/2026 — `haido` còn trống trên npm. Các quyết định nền tảng: [SPEC.md §14](SPEC.md).)*

## Vấn đề

AI coding agent "làm trước quên sau": context window có hạn, hội thoại dài bị tóm tắt, phiên mới bắt đầu từ số không. Mỗi lần sửa code, agent chỉ nhìn thấy một mẩu dự án nên vá cục bộ, phá dần quy ước tổng thể — dự án càng lớn càng loạn.

Các công cụ hiện có giải được **một nửa** bài toán:

- **Bản đồ không có trí nhớ** — code-graph MCP server (codebase-memory-mcp, Serena, Aider repo map…) cho agent thấy *cấu trúc* code, nhưng không nhớ *tại sao* code như vậy.
- **Trí nhớ không có bản đồ** — memory layer (mem0, cognee, CLAUDE.md, Memory Bank…) lưu ghi chú, nhưng ghi chú trôi nổi: không gắn vào chỗ code cụ thể, và **không ai biết khi nào chúng lỗi thời**.

## Giải pháp

`haido` là một **memory layer neo vào code**, chạy local, giao tiếp qua MCP + hooks, dùng được với mọi agent (Claude Code trước tiên):

1. **Neo (anchor)** — mỗi ghi chú (quyết định, bất biến, gotcha) gắn vào một symbol/file cụ thể, kèm content-hash của symbol tại thời điểm ghi.
2. **Tự biết lỗi thời** — khi code tại neo thay đổi (hash lệch), memory tự chuyển trạng thái *stale* và vào hàng đợi review, kèm diff cũ/mới. Không còn CLAUDE.md mục nát.
3. **Gợi nhớ đúng lúc** — qua hooks, agent vừa chạm vào file nào thì các ghi chú neo quanh file đó tự được tiêm vào context (có ngân sách token). Agent không phải "nhớ ra là mình cần nhớ".
4. **Bản đồ cho người** *(v0.2)* — bản đồ 2D của repo với lớp phủ tri thức: chỗ nào dày memory, chỗ nào đang stale, chỗ nào hay thay đổi cùng nhau.

**Không phải** một code-graph server thứ N — lớp bản đồ cấu trúc đã có người làm rất tốt; `haido` chỉ giữ phần cấu trúc tối thiểu đủ để làm giá đỡ cho neo, và dồn toàn bộ sức vào vòng đời của trí nhớ.

## Trạng thái

✅ **Lõi MVP chạy được (10/07/2026):** indexer TS/Python + memory neo hash + staleness engine + recall xếp hạng + MCP server 6 tools + hooks auto-inject + installer + co-change + watch — 65 test xanh, đã verify sống trong phiên Claude Code thật (cả MCP lẫn hooks). Còn lại trước v0.1 public: `export/import --pack` (markdown pack), dogfood trên dự án thật, publish npm. Khi open-source, docs chính sẽ chuyển sang tiếng Anh (bản Việt song song tại `docs/vi/`).

| Tài liệu | Nội dung |
|---|---|
| [SURVEY.md](SURVEY.md) | Khảo sát thị trường 10/07/2026: hồ sơ ~25 công cụ, bảng so sánh, gap analysis, rủi ro cạnh tranh |
| [SPEC.md](SPEC.md) | Spec sản phẩm MVP v0.1: định vị, user stories, phạm vi, MCP tools, tiêu chí nghiệm thu |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc kỹ thuật: schema SQLite, thuật toán hash/staleness/recall, hooks, ADR |
| [QUALITY.md](QUALITY.md) | Hiến pháp chất lượng: Reflection-có-neo, 3 vòng phản chiếu, definition of done, quality gates |
| [docs/memory/](../memory/) | Nhật ký hải trình viết tay — trí nhớ của chính dự án, đúng format pack của sản phẩm (dogfood từ ngày 0) |
| [AGENTS.md](../../AGENTS.md) | Luật làm việc cho AI agent trong repo này |

Bộ khung kỹ thuật đã dựng và **xanh toàn bộ gate** (`npm run check`: TypeScript strict + eslint + prettier + vitest; CI GitHub Actions ma trận Windows/Linux × Node 20/22).

## Dùng thử (bản build local — chưa publish npm)

```bash
npm install && npm run build       # trong repo haido
cd <dự án của bạn>
node <haido>/dist/cli.js init
node <haido>/dist/cli.js install claude-code --command node <haido>/dist/cli.js
# mở phiên Claude Code mới trong dự án → agent tự nhận bản đồ + trí nhớ qua hooks

# Agent dùng qua MCP: remember / recall / find_related / map_overview / stale_memories / reanchor
# CLI cho người:  index [--watch] · recall · related · overview · stale · reanchor · doctor
node <haido>/dist/cli.js viz --open   # bản đồ tri thức 2D (1 file HTML tự chứa)
# haido.toml (init tự sinh file mẫu): include/exclude glob, tham số co-change, budget hooks
```

Sau khi publish npm, toàn bộ rút gọn thành `npx haido init && npx haido install claude-code`. Bản đồ 2D `haido viz` thuộc v0.2.

## License

MIT
