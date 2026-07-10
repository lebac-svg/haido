# haido — Spec sản phẩm MVP v0.1

**Trạng thái:** ✅ Các quyết định mở đã được chốt ngày 10/07/2026 (§14) — sẵn sàng bắt đầu Sprint 0 khi có lệnh
**Đọc trước:** [SURVEY.md](SURVEY.md) — spec này viết theo kết luận khảo sát (định vị memory-first).

> **Một câu:** haido là cuốn *nhật ký hải trình* cho AI coding agent — mọi ghi chú đều có toạ độ trên code, và khi code tại toạ độ đó thay đổi, ghi chú tự giơ tay xin review.

---

## 1. Vấn đề

Ba hiện tượng, một gốc rễ:

1. **Quên trong phiên** — context window có hạn; hội thoại dài bị tóm tắt; chi tiết và quyết định đầu phiên mất dần ("làm trước quên sau").
2. **Quên giữa các phiên** — phiên mới bắt đầu từ số không; tri thức chỉ sống sót nếu được ghi ra, mà ghi thì thường không ai ghi, hoặc ghi vào CLAUDE.md rồi… mục nát.
3. **Trôi kiến trúc (architectural drift)** — agent chỉ thấy mẩu code đang sửa, vô tình phá bất biến/quy ước đặt ra từ trước; dự án càng lớn càng loạn.

Gốc rễ: **bộ nhớ làm việc của agent là tạm thời, tri thức dự án cần bền vững** — và tri thức bền vững hiện không có cơ chế nào tự phát hiện mình đã sai so với code.

Bằng chứng thị trường (từ khảo sát): cấu trúc giúp agent thật (RepoGraph +32.8% SWE-bench-Lite; codebase-memory-mcp tiết kiệm 10× token) — nhưng toàn bộ làn sóng đó chỉ giải "agent *thấy* code", chưa ai giải "agent *nhớ vì sao* code như vậy, và trí nhớ đó *còn đúng* không".

## 2. Nguyên lý thiết kế (5 điều)

1. **Neo hoặc là rác.** Ghi chú không gắn vào chỗ code cụ thể sẽ thành rác — không ai biết nó nói về cái gì và bao giờ hết hạn. Mọi memory trong haido bắt buộc có ≥ 1 anchor.
2. **Tự biết lỗi thời.** Code là chân lý nền kiểm chứng được: hash nội dung symbol tại thời điểm ghi; hash lệch → memory chuyển `stale` kèm diff. Không tin vào TTL hay "để LLM tự dọn".
3. **Nhớ đúng lúc hơn nhớ nhiều.** Recall tự động qua hooks tại đúng khoảnh khắc agent chạm vào code liên quan, trong ngân sách token cố định. Agent không phải "nhớ ra là mình cần nhớ".
4. **Rẻ và đoán được.** Không LLM call ẩn, không embeddings bắt buộc, không network. Mọi hành vi giải thích được bằng thuật toán đọc được trong 1 trang.
5. **Người giám sát phải nhìn thấy.** Tri thức của dự án phải xem được: nằm đâu, tươi hay ôi, dày hay mỏng (viz v0.2 — lời hứa "hệ trục" của ý tưởng gốc).

## 3. Định vị

| haido **LÀ** | haido **KHÔNG LÀ** |
|---|---|
| Memory layer neo vào code, cho mọi agent (MCP + hooks) | Code-graph server thứ N (nhường codebase-memory-mcp) |
| Local-first, 1 file SQLite, zero cloud | RAG/semantic search codebase (nhường embeddings tools) |
| Cơ chế khách quan: hash, diff, review queue | Task manager / issue tracker / TODO app |
| Format mở: export markdown pack commit vào git | Bộ máy "trí nhớ thần kinh học" tự tiến hoá khó đoán |

**Đối tượng:** solo dev / team nhỏ dùng AI coding agent (Claude Code trước tiên) trên dự án sống lâu hơn một phiên chat.

## 4. User stories (agent là người dùng chính)

- **US1 — Đừng phá bất biến:** Agent chuẩn bị sửa `computePrice()`. Hook tiêm vào context: *"INVARIANT: mọi số tiền là số nguyên (xu), không dùng float — quyết định 03/2026, lý do: sai số làm lệch tổng hoá đơn."* Agent giữ nguyên kiểu int. ✅ Nghiệm thu: memory xuất hiện trong context trước khi agent hoàn tất lượt sửa, tốn ≤ 800 token.
- **US2 — Trả lời "tại sao":** User hỏi "sao chỗ này không dùng thư viện X?". Agent gọi `recall(query hoặc file)` → nhận decision kèm `why` và ngày ghi. ✅ Trả lời đúng mà không phải đào lại git log.
- **US3 — Code đổi, ghi chú giơ tay:** Ai đó refactor `Board.move()`. Trong lần index kế tiếp, memory neo vào đó chuyển `stale(content_drift)` kèm hash cũ/mới; xuất hiện trong `haido stale`. Agent (hoặc user) review: còn đúng → `reanchor`; hết đúng → sửa nội dung hoặc `retire`. ✅ Không memory nào sai âm thầm quá 1 lần index.
- **US4 — Khởi động ấm:** Phiên mới, SessionStart hook tiêm `map_overview` (cây thư mục gọn + đếm memory + danh sách invariant hàng đầu). ✅ Agent mới biết ngay "vùng cấm" của dự án trong ≤ 1.5k token.
- **US5 — Ghi có kỷ luật:** Agent vừa chốt một quyết định với user → gọi `remember(type=decision, anchors=[...], why=...)`. Tool từ chối nếu thiếu anchor hoặc thiếu `why`. ✅ Không thể tạo memory rác.
- **US6 — (v0.2) Nhìn toàn cục:** User mở `haido viz` → bản đồ 2D repo, màu theo mật độ memory, viền đỏ chỗ stale, cụm theo import/co-change. Thấy ngay "khu này agent sửa nhiều mà chưa có ghi chú nào".

## 5. Phạm vi v0.1 (tính năng & tiêu chí nghiệm thu)

| # | Tính năng | Mô tả | Nghiệm thu |
|---|---|---|---|
| F1 | **Indexer symbol** | tree-sitter (WASM) trích function/class/method/exported const cho **TypeScript/TSX/JS + Python**; qualified name + vị trí + `body_hash` (hash nội dung đã chuẩn hoá — bỏ comment/whitespace) | Index đúng ≥ 95% symbol trên repo fixture; format-only change (prettier) **không** đổi hash |
| F2 | **Import & contains edges** | Cạnh `imports` mức file (resolve tương đối + tsconfig paths cơ bản); `contains` file→symbol | `find_related` trả file import/được-import đúng |
| F3 | **Co-change miner** | Đào `git log --name-only` (mặc định 2000 commit gần nhất, bỏ commit >30 file); pair có `together ≥ 3` và `confidence ≥ 0.3` thành cạnh `co_change(weight)` | Chạy trên rong-choi ra các cặp hợp lý; incremental theo commit đã đào |
| F4 | **Memory store + anchors** | Loại: `decision · invariant · gotcha · convention · todo`; trường bắt buộc: `title, body, why, ≥1 anchor`; anchor lưu `qualified_name + body_hash + path` tại thời điểm ghi | `remember` thiếu anchor/why → lỗi rõ ràng |
| F5 | **Staleness engine** | Khi reindex file: hash lệch → anchor `stale(content_drift)`; symbol biến mất → `stale(missing)`; file đổi tên cùng nội dung → tự `moved` (auto-reanchor). Memory có ≥1 anchor stale → trạng thái `needs_review` | Sửa body hàm → stale trong lần index kế tiếp (watch: < 5s); đổi tên file giữ nội dung → không stale |
| F6 | **Recall engine** | Xếp hạng: khoảng cách neo (đúng symbol > cùng file > hàng xóm import/co-change) + FTS5 + loại memory + recency − phạt stale; cắt theo token budget; output markdown gọn kèm nhãn ⚠ stale | Truy vấn theo file trả đúng memory neo + hàng xóm; < 100ms |
| F7 | **MCP server** | stdio, 6 tools (§7) qua `@modelcontextprotocol/sdk` | Claude Code kết nối, gọi được cả 6 tool |
| F8 | **Cài đặt & hooks** | `haido install claude-code` (MCP + hooks: `SessionStart` → overview; `PostToolUse(Read·Edit·Write)` → tiêm memory của file vừa chạm, chống lặp trong phiên, budget 800 token/lần) và `haido install claude-desktop` (MCP on-demand, §8) | US1 + US4 chạy thật trên rong-choi; Claude Desktop gọi được 6 tool |
| F9 | **CLI** | `init · index [--watch] · serve · install · recall · remember · stale · reanchor · export · doctor` | `haido doctor` tự chẩn đoán (git? node? db? hooks?) |
| F10 | **Watch mode** | chokidar, debounce, chỉ re-index file đổi | Sửa 1 file → chỉ 1 file re-index, < 300ms |

## 6. Non-goals của v0.1 (chủ đích, không phải quên)

- ❌ **Call graph** — không cần cho anchoring; đã có tool khác làm; hàng xóm qua import + co-change là đủ cho recall.
- ❌ **Embeddings/semantic search** — commodity, thêm dependency nặng; FTS5 + graph proximity trước. Chừa interface `RecallSignal` để cắm sau (v0.3).
- ❌ **Viz** — v0.2, sau khi lõi memory chứng minh giá trị (nhưng `export --viz` JSON có sẵn từ v0.1).
- ❌ Team sync/cloud, multi-repo, ngôn ngữ ngoài TS/Py, VS Code extension, Windows-service.
- ❌ Tự động *sinh* memory bằng LLM (agent là người ghi; haido chỉ là sổ — giữ ranh giới trách nhiệm rõ).

## 7. MCP tools (bề mặt API cho agent)

Nguyên tắc viết description: nói rõ **khi nào nên gọi** — agent chỉ dùng tool nếu description thuyết phục tại đúng khoảnh khắc.

| Tool | Tham số chính | Hành vi |
|---|---|---|
| `recall` | `file?· symbol?· query?· budget_tokens=800` | Trả memory xếp hạng cho vị trí/câu hỏi. *"Gọi TRƯỚC khi sửa file quan trọng hoặc khi cần biết 'tại sao code thế này'."* |
| `remember` | `type· title· body· why· anchors[]· session?` | Tạo memory. Từ chối nếu thiếu anchor/why; cảnh báo nếu trùng (FTS similarity) → gợi ý update thay vì tạo mới |
| `find_related` | `file \| symbol· limit` | Hàng xóm qua imports + co-change + cùng thư mục, kèm lý do ("hay đổi cùng nhau 7 lần") |
| `map_overview` | `budget_tokens=1500` | Cây thư mục nén + số symbol/memory/stale mỗi vùng + top invariants toàn dự án |
| `stale_memories` | `limit` | Hàng đợi review: memory + anchor cũ/mới + diff tóm tắt. *"Gọi khi user nhờ dọn dẹp tri thức hoặc đầu phiên làm việc lớn."* |
| `reanchor` | `memory_id· action: confirm \| move(new_anchor) \| retire· edit_body?` | Chốt kết quả review; `confirm` cập nhật hash mới (nội dung vẫn đúng) |

## 8. Hooks UX (sản phẩm thật sự)

- `haido install claude-code [--global]` — đăng ký MCP server + thêm hooks vào `.claude/settings.json` (hỏi trước khi ghi đè):
  - **SessionStart** → `haido hook session-start` → in `map_overview` (≤ 1.5k token).
  - **PostToolUse** matcher `Read|Edit|Write|MultiEdit` → `haido hook post-tool` → đọc JSON stdin lấy `file_path`, tra memory neo file đó + hàng xóm; **mỗi memory chỉ tiêm 1 lần/phiên** (state tại `.haido/session/`); im lặng nếu không có gì (exit 0, không output).
- Cơ chế đưa context: dùng output additionalContext của hook (kiểm chứng lại API chính xác của Claude Code khi implement — ghi ở ARCHITECTURE §9).
- **Claude Desktop** (bổ sung theo yêu cầu 10/07/2026): `haido install claude-desktop` ghi entry MCP server vào `claude_desktop_config.json`, trỏ tới thư mục dự án (Desktop không "đứng trong" repo như Claude Code nên phải khai báo path khi cài). Desktop không có hooks → chỉ recall/remember khi được gọi qua tool; phù hợp để hỏi-đáp về dự án và review stale-queue ngoài IDE. Cân nhắc đóng gói `.mcpb` (Desktop Extension, cài 1 click) ở v0.2.
- **Fallback cho agent không có hooks** (Cursor, Codex CLI…): chỉ MCP + đoạn khuyến nghị dán vào AGENTS.md/rules: *"Trước khi sửa file, gọi `recall(file)`; sau khi chốt quyết định với user, gọi `remember`."*

## 9. Quy ước vệ sinh trí nhớ (memory hygiene)

Được in trong description của `remember` + docs; tool cưỡng chế được phần cứng (†):

1. † Bắt buộc `why` và ≥ 1 anchor.
2. † `body ≤ 700` ký tự — một memory một fact.
3. Chỉ ghi thứ **không suy ra được từ code**: quyết định (chọn A bỏ B vì…), bất biến (điều phải luôn đúng), gotcha (bẫy đã sập), quy ước (cách đặt tên/cấu trúc). **Không chép code, không tóm tắt file, không ghi trạng thái task** (đó là việc của git/issue tracker).
4. Ví dụ tốt: *"INVARIANT · Toạ độ bàn cờ luôn là (col,row) 0-based; UI mới đổi sang 1-based khi render. Why: đã sập bug lệch 1 hai lần (#12)."* — Ví dụ xấu: *"File board.ts chứa class Board có các hàm move, undo…"* (suy ra được từ code → rác).

## 10. Số phận dữ liệu

- `.haido/haido.db` (SQLite, WAL) — **gitignore**. Máy ai người nấy index.
- `haido export --pack docs/memory/` — xuất memory (không xuất index) thành markdown pack **commit được vào git**: tri thức đi theo repo, review qua PR, máy mới `haido init` sẽ nhập lại pack và re-anchor. → Đây là hào nước "format mở" (§SURVEY 11.4).

## 11. Thước đo thành công (dogfood trên `rong-choi`)

| Metric | Mục tiêu |
|---|---|
| Index lạnh repo rong-choi | < 10s |
| Re-index 1 file khi save (watch) | < 300ms |
| `recall` p95 | < 100ms |
| Token tiêm mỗi lần hook | ≤ 800 (overview ≤ 1500) |
| Sau 2 tuần dogfood | ≥ 30 memory sống, ≥ 5 lần stale-queue bắt đúng drift, 0 memory sai âm thầm |
| Trải nghiệm chủ quan | Agent ngừng tái phạm ≥ 3 lỗi "kinh điển" của rong-choi (đo bằng nhật ký đối chiếu) |

## 12. Roadmap sau v0.1

- **v0.2 — Bản đồ tri thức** (`haido viz`): 1 file HTML tự chứa, canvas 2D (treemap theo thư mục + force layout theo import/co-change), overlay mật độ memory/stale/tuổi; click → panel memory. Zero-dependency, mở bằng `file://`.
- **v0.2 — Stop-hook reflection:** hook `Stop` cuối phiên nhắc agent tự vấn *"phiên này có quyết định/bẫy nào đáng ghi không?"* → gọi `remember`. (Reflection có kỷ luật, phục vụ việc ghi; KHÔNG phải để LLM tự sinh/tự sửa memory không bằng chứng — vẫn là non-goal §6.)
- **v0.3 — Tín hiệu cắm thêm:** interface `RecallSignal` cho embeddings (tuỳ chọn, local ONNX hoặc API); co-change mức symbol (map diff hunk → symbol).
- **v0.4 — Interop & team:** adapter đọc graph `codebase-memory-mcp` làm nguồn hàng xóm (chạy *trên* thay vì *đối đầu*); memory pack merge/conflict; thêm ngôn ngữ (Go, Rust, Java — chỉ cần grammar + query file).

## 13. Naming

- **ĐÃ CHỐT (10/07/2026): `haido` (Hải Đồ)** — hải đồ = bản đồ đi biển; cặp ẩn dụ *hải đồ (map) + nhật ký hải trình (log)* ôm trọn 2 khái niệm của sản phẩm; mang bản sắc Việt như kiểu `ollama`/`kibana`.
- ✅ npm: `haido` còn trống (registry trả 404, kiểm 10/07/2026). Việc cần làm sớm: **publish npm placeholder để giữ tên**, tạo GitHub repo; PyPI/domain tính sau nếu cần.

## 14. Quyết định đã chốt (bạn duyệt ngày 10/07/2026)

| # | Vấn đề | Quyết định |
|---|---|---|
| 1 | Tên dự án | **`haido`** — chốt; publish npm placeholder sớm để giữ tên |
| 2 | Ngôn ngữ docs public | **Tiếng Anh chính + bản Việt song song** (`docs/vi/`) khi open-source; giai đoạn phát triển giữ tiếng Việt để duyệt nhanh |
| 3 | Dữ liệu & git | **DB gitignore + markdown pack commit vào repo** (§10) |
| 4 | Agent đầu tiên | **Claude Code** (hooks); agent khác dùng MCP fallback ở v0.1 |
| 5 | License | **MIT** |
| 6 | Demo | **Có** — GIF/video 30s "sửa hàm → ghi chú tự stale → agent đề nghị cập nhật" ngay tuần đầu sau khi MVP chạy, đặt làm mặt tiền README |
