# haido — Kiến trúc kỹ thuật v0.1

**Trạng thái:** 🚧 Bản nháp · các quyết định nền tảng đã chốt 10/07/2026 ([SPEC.md §14](SPEC.md)) · Đọc sau [SPEC.md](SPEC.md).

## 0. Quyết định kiến trúc (ADR) — tóm tắt

| ADR | Quyết định | Lý do chính | Đánh đổi chấp nhận |
|---|---|---|---|
| 001 | **TypeScript / Node ≥ 20** | Stack quen của chủ dự án (rong-choi); MCP SDK TS trưởng thành; phân phối `npx` không cần cài đặt | Chậm hơn Rust (codemem) — bù bằng phạm vi index tối thiểu |
| 002 | **web-tree-sitter (WASM)** thay vì binding native | Không đau build native trên Windows; grammar tải theo ngôn ngữ | Chậm hơn native ~2-3× — chấp nhận vì chỉ parse file thay đổi |
| 003 | **better-sqlite3**, 1 file DB, WAL | Sync API đơn giản, prebuilt binaries, FTS5 sẵn; `node:sqlite` còn non | Native module — khoá phiên bản Node trong engines |
| 004 | **Không call graph** ở v0.1 | Anchor không cần; đắt và đã có tool khác; hàng xóm = import + co-change | `impact_of` chưa có — bù một phần bằng co-change |
| 005 | **Không embeddings** ở v0.1 | Commodity; nặng dependency; recall cần *đúng chỗ* hơn *giống nghĩa* | Query mơ hồ kém hơn — chừa interface `RecallSignal` |
| 006 | **Hash = SHA-1 của body chuẩn hoá** | Built-in `node:crypto`, zero-dep; mục đích là phát hiện thay đổi, không phải bảo mật | — |
| 007 | **Hooks-first UX** (Claude Code trước) | "Tự nhớ" là giá trị lõi; MCP thuần phụ thuộc agent tự giác gọi | Gắn với API hooks của 1 vendor — cô lập trong module `integrations/` |
| 008 | **Định vị memory-first** — không cạnh tranh code-graph | Kết luận SURVEY §9 | Từ bỏ tham vọng "bản đồ 3 lớp" ban đầu ở tầng sản phẩm |

## 1. Tổng quan thành phần

```
                 save file                git log
                     │                       │
              ┌──────▼──────┐        ┌───────▼────────┐
              │   Watcher    │        │ Co-change      │
              │  (chokidar)  │        │ Miner          │
              └──────┬──────┘        └───────┬────────┘
                     ▼                        ▼
              ┌─────────────┐  symbols  ┌──────────────────┐
              │   Indexer   │──────────▶│      SQLite      │◀────┐
              │ tree-sitter │  + hash   │    .haido/       │     │ memories
              │   (WASM)    │           │    haido.db      │     │ + anchors
              └──────┬──────┘           └───┬──────────┬───┘     │
                     │ diff hash            │          │         │
              ┌──────▼──────┐               │   ┌──────▼───────┐ │
              │  Staleness  │───────────────┘   │ Recall/Query │ │
              │   Engine    │  mark stale       │    Engine    │ │
              └─────────────┘                   └──────┬───────┘ │
                                                       │         │
                    ┌──────────────┬───────────────────┼─────────┘
                    ▼              ▼                   ▼
              ┌──────────┐  ┌────────────┐   ┌──────────────────┐
              │   CLI    │  │ MCP server │   │ Hook runner      │
              │  haido … │  │  (stdio)   │   │ session-start /  │
              └──────────┘  └────────────┘   │ post-tool        │
                    │                        └──────────────────┘
                    ▼
              export: --pack (markdown) · --viz (JSON cho v0.2)
```

**Stack:** Node ≥ 20, TypeScript, `web-tree-sitter`, `better-sqlite3`, `@modelcontextprotocol/sdk`, `chokidar`, `commander`. Zero network call, zero telemetry.

**Bố cục package (monorepo đơn giản, 1 package):**

```
haido/
├─ src/
│  ├─ core/        # db.ts, schema.sql, types.ts
│  ├─ indexer/     # parser.ts, normalize.ts, languages/{ts,py}.ts (queries)
│  ├─ git/         # cochange.ts
│  ├─ memory/      # store.ts, staleness.ts, reanchor.ts
│  ├─ recall/      # rank.ts, format.ts, overview.ts
│  ├─ mcp/         # server.ts, tools/*.ts
│  ├─ integrations/# claude-code/ (hook runner + installer)
│  └─ cli.ts
└─ test/fixtures/  # golden repos nhỏ (ts + py)
   (grammar .wasm lấy từ package @vscode/tree-sitter-wasm — không vendor trong repo)
```

## 2. Data model (SQLite)

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE files (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,   -- POSIX-normalized, relative to repo root
  lang         TEXT NOT NULL,          -- 'ts' | 'py' | ...
  content_hash TEXT NOT NULL,          -- sha1 toàn file (rename detection)
  mtime        INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  indexed_at   INTEGER NOT NULL,
  deleted_at   INTEGER                 -- soft delete
);

CREATE TABLE symbols (
  id           INTEGER PRIMARY KEY,
  file_id      INTEGER NOT NULL REFERENCES files(id),
  kind         TEXT NOT NULL,          -- function|method|class|const|type
  name         TEXT NOT NULL,
  qname        TEXT NOT NULL,          -- 'src/engine/board.ts#Board.move'
  start_line   INTEGER, end_line INTEGER,
  signature    TEXT,                   -- 1 dòng, cho overview
  body_hash    TEXT NOT NULL,          -- sha1(normalize(body))
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER                 -- giữ 30 ngày cho reanchor
);
CREATE UNIQUE INDEX idx_symbols_qname ON symbols(qname) WHERE deleted_at IS NULL;
CREATE INDEX idx_symbols_bodyhash ON symbols(body_hash);

CREATE TABLE edges (                    -- imports | contains | co_change
  src_kind TEXT NOT NULL, src_id INTEGER NOT NULL,   -- 'file'|'symbol'
  dst_kind TEXT NOT NULL, dst_id INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  weight   REAL DEFAULT 1.0,           -- co_change: confidence
  meta     TEXT,                        -- JSON: {"together":7,...}
  PRIMARY KEY (src_kind, src_id, dst_kind, dst_id, kind)
);

CREATE TABLE memories (
  id         TEXT PRIMARY KEY,          -- ulid
  type       TEXT NOT NULL CHECK (type IN ('decision','invariant','gotcha','convention','todo')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) <= 700),
  why        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'fresh',   -- fresh|needs_review|retired
  author     TEXT NOT NULL,             -- 'agent:claude-code' | 'human:<name>'
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE anchors (
  id            INTEGER PRIMARY KEY,
  memory_id     TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_kind   TEXT NOT NULL,          -- 'symbol' | 'file'
  qname         TEXT NOT NULL,          -- snapshot lúc ghi (không FK cứng — symbol có thể biến mất)
  path          TEXT NOT NULL,
  hash_at_link  TEXT NOT NULL,          -- body_hash (symbol) hoặc content_hash (file) lúc ghi/confirm
  status        TEXT NOT NULL DEFAULT 'fresh',  -- fresh|drift|missing|moved
  stale_since   INTEGER,
  meta          TEXT                    -- JSON: {"old_hash":..,"new_hash":..,"moved_to":..}
);
CREATE INDEX idx_anchors_qname ON anchors(qname);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, body, why, content='memories', content_rowid='rowid',
  tokenize = 'unicode61 remove_diacritics 2'   -- thân thiện tiếng Việt
);

CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT );  -- schema_version, cochange_last_run...
```

Ghi chú thiết kế:

- **Anchor snapshot thay vì FK cứng** vào `symbols`: symbol có thể bị xoá/đổi tên; anchor phải sống sót để kể lại "tôi từng trỏ vào đâu" — resolve qua `qname` khi truy vấn.
- `body ≤ 700` cưỡng chế hygiene ngay tầng DB.
- FTS5 `remove_diacritics` để tìm tiếng Việt không dấu vẫn khớp.

## 3. Indexer

**Pipeline mỗi file:** đọc → parse (tree-sitter) → chạy query trích symbol → chuẩn hoá body → hash → diff với DB → upsert + trả danh sách `(qname, old_hash, new_hash)` cho Staleness Engine.

**Trích symbol** — dùng tree-sitter queries khai báo, mỗi ngôn ngữ 1 file:

```scheme
;; languages/ts.scm (rút gọn)
(function_declaration name: (identifier) @name) @def
(class_declaration name: (type_identifier) @name) @def
(method_definition name: (property_identifier) @name) @def
(lexical_declaration (variable_declarator
  name: (identifier) @name
  value: [(arrow_function) (function_expression)])) @def
;; python.scm: (function_definition), (class_definition)
```

`qname` = `path#Outer.Inner` (lồng class/method bằng cách leo cây cha). Không resolve import cho qname — path-based là đủ ổn định và rẻ.

**Chuẩn hoá trước khi hash** (quyết định chất lượng staleness — đây là "bí quyết" số 1):

```
normalize(node):
  1. Duyệt AST con của symbol, BỎ node loại comment
  2. Lấy text các token còn lại, nối bằng 1 space
     (mọi whitespace/xuống dòng/indent biến mất)
  3. sha1(utf8(text))
```

→ Format code (prettier/black), đổi comment: **hash không đổi** → không stale oan. Đổi bất kỳ token code nào: hash đổi → stale đúng. Đổi tên biến cục bộ vẫn stale (chấp nhận: đổi tên *là* thay đổi ngữ nghĩa tiềm tàng).

**Hash của symbol chứa symbol khác (class):** node class bao trùm body các method, nên sửa ruột một method sẽ đổi hash của cả method lẫn class → anchor trên class cũng vào diện review. Chủ đích v0.1 ("thà nhạy còn hơn câm", xem §15); nếu dogfood cho thấy quá ồn thì v0.2 chuyển class sang *shape-hash* (chỉ chữ ký + tên member, bỏ body).

**Incremental:** fast-path so `mtime+size`; nghi ngờ thì so `content_hash` file. File mới có `content_hash` trùng file vừa `deleted` → **rename**: cập nhật `path`, giữ symbol, anchor chuyển `moved` và tự re-anchor (không làm phiền người dùng).

**Import edges:** regex + AST cho `import ... from '...'` (TS/JS, kèm resolve `./`, `../`, alias cơ bản từ tsconfig `paths`) và `import`/`from` (Python, resolve theo package dir). Không theo đuổi độ chính xác tuyệt đối — đây chỉ là tín hiệu hàng xóm.

## 4. Co-change Miner

```
git log --pretty=%H%x09%ct --name-only -n 2000   # config: haido.toml
```

- Bỏ commit chạm > 30 file (merge/format/lockfile sweep) và file ngoài include globs.
- Đếm `together(a,b)` trên các cặp file trong cùng commit; `confidence = together / min(count(a), count(b))`.
- Giữ cạnh khi `together ≥ 3 AND confidence ≥ 0.3` → `edges(kind='co_change', weight=confidence, meta={together})`.
- Incremental: lưu `last_mined_commit`, lần sau chỉ `git log <hash>..HEAD`. Chi phí O(commits × files/commit), chạy nền sau index.

## 5. Staleness Engine — máy trạng thái của anchor

```
            hash khớp khi reindex
  ┌─────────────────────────────────────┐
  ▼                                     │
fresh ── hash lệch ──────────────▶ drift ──┐
  │                                        │  reanchor:
  ├── symbol biến mất ───────────▶ missing ─┤  confirm → fresh (cập nhật hash_at_link)
  │                                        │  move(new) → fresh (đổi qname/path)
  └── file rename (hash file khớp) ▶ moved ─┘  retire → memory.status=retired
         (tự động confirm, không hỏi)
```

- Memory có ≥ 1 anchor `drift|missing` → `memories.status = needs_review` (vẫn được recall, kèm nhãn ⚠ — "biết là đang nghi ngờ" tốt hơn im lặng).
- `stale_memories` trả kèm ngữ cảnh phán xử: `old_hash/new_hash`, signature mới, và (nếu lấy được nhanh qua `git log -L`) commit chạm gần nhất.
- **Reanchor heuristics** khi `missing`: (1) tìm `qname` y hệt ở file khác (file split) → gợi ý move; (2) tìm symbol có `body_hash` trùng (move nguyên vẹn) → auto move; (3) không thấy → để người/agent quyết.

## 6. Recall Engine

**Sinh ứng viên** (theo thứ tự, dừng khi đủ): anchor đúng symbol → anchor cùng file → anchor ở hàng xóm (import 1 bước, co_change, cùng thư mục) → FTS5 toàn cục theo `query`.

**Chấm điểm:**

```
score = 3.0 * proximity      # exact=1.0, same-file=0.6, neighbor=0.35, global-fts=0.2
      + 1.0 * bm25_norm      # 0..1 nếu có query, else 0.5
      + 0.6 * type_prior     # invariant 1.0 · gotcha 0.9 · decision 0.8 · convention 0.6 · todo 0.3
      + 0.3 * recency        # exp(-age_days/180)
      - 0.8 * is_needs_review  # phạt nhưng KHÔNG loại (trừ khi proximity=exact thì giảm phạt nửa)
```

Trọng số là hằng số đặt tên trong `rank.ts` — chỉnh bằng dogfood, không machine-learning. Cắt kết quả theo `budget_tokens` (ước lượng ≈ chars/3.5 cho tiếng Việt lẫn Anh).

**Format output** (gọn, agent-friendly):

```markdown
### Trí nhớ liên quan (.haido)
- ⛔ INVARIANT [m_01H..] `src/engine/board.ts#Board.move` — Toạ độ (col,row) 0-based…
  vì: đã sập bug lệch-1 hai lần (#12)
- ⚠️ DECISION (cần review — code đã đổi) [m_01J..] `src/audio.ts` — Dùng WebAudio, không <audio>…
```

ID hiện diện để agent có thể `reanchor`/update chính xác.

## 7. MCP server

`@modelcontextprotocol/sdk`, transport stdio, đăng ký 6 tool (SPEC §7). Schema ví dụ cho tool then chốt:

```jsonc
// recall
{ "file": {"type":"string"}, "symbol": {"type":"string"},
  "query": {"type":"string"}, "budget_tokens": {"type":"number","default":800} }
// remember
{ "type": {"enum":["decision","invariant","gotcha","convention","todo"]},
  "title": {"type":"string","maxLength":100},
  "body":  {"type":"string","maxLength":700},
  "why":   {"type":"string","minLength":10},
  "anchors": {"type":"array","minItems":1,
    "items": {"anyOf":[{"properties":{"symbol":{"type":"string"}}},
                        {"properties":{"file":{"type":"string"}}}]}} }
```

Hành vi đáng chú ý:

- `remember` chạy FTS check trước khi insert; nếu similarity cao trả về `duplicate_of` + hướng dẫn update — chống memory rác kiểu "ghi lại lần 2 hơi khác chữ".
- Mọi tool read-only trả lời từ DB, không đụng filesystem → nhanh và an toàn; server yêu cầu index tồn tại (`haido doctor` nhắc nếu chưa `init`).
- Description của tool viết theo nguyên tắc "khi nào gọi" (SPEC §7) — đây là UX quyết định agent có dùng hay không.

## 8. Hook runner (Claude Code)

- `haido install claude-code`: đăng ký MCP server + chèn hooks vào `.claude/settings.json` (project) — hiện diff, hỏi xác nhận:

```jsonc
{
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "npx haido hook session-start" } ] } ],
    "PostToolUse":  [ { "matcher": "Read|Edit|Write|MultiEdit",
                        "hooks": [ { "type": "command", "command": "npx haido hook post-tool" } ] } ]
  }
}
```

- `post-tool`: đọc JSON stdin (lấy `tool_input.file_path`), truy `recall(file, budget=800)`, lọc memory **chưa tiêm trong phiên** (state file `.haido/session/<session_id>.json`), trả context qua **additionalContext** trong `hookSpecificOutput`; không có gì → exit 0 im lặng. Tổng chi phí mục tiêu < 500ms (process spawn + query).
- ✅ **Đã kiểm chứng bằng thí nghiệm thật (10/07/2026 — [experiments/hooks-probe/FINDINGS.md](../../experiments/hooks-probe/FINDINGS.md)):** `hookSpecificOutput.additionalContext` tới được model ở cả `SessionStart` lẫn `PostToolUse` (kể cả headless `-p`; canary test 2/2). Lưu ý rút ra: PostToolUse **bắt buộc JSON** (stdout thuần không tới model); `tool_input.file_path` là đường dẫn **tuyệt đối Windows** → chuẩn hoá về repo-relative POSIX trước khi tra anchor; `session_id` có trong mọi event → làm khoá dedup; hook chạy với cwd = repo root nên dùng lệnh tương đối. Mọi phụ thuộc API này vẫn cô lập trong `integrations/claude-code/`.
- Warm process (tránh spawn Node ~100-200ms mỗi hook): nếu đo thấy chậm, nâng cấp hook thành client mỏng gọi qua unix socket/named pipe tới `haido serve` — quyết định sau khi có số đo, không tối ưu sớm.

## 9. CLI

```
haido init                 # tạo .haido/, haido.toml, index lần đầu, mine git, gợi ý install
haido index [--watch]      # re-index (watch: chokidar, debounce 300ms)
haido serve                # MCP stdio server
haido install claude-code|claude-desktop
                           # claude-code: MCP + hooks vào .claude/settings.json
                           # claude-desktop: entry MCP (kèm path dự án) vào claude_desktop_config.json
haido recall <query|--file p> [--budget n]
haido remember             # nhập tương tác (cho human)
haido stale [--json]       # hàng đợi review
haido reanchor <id> --confirm|--move <qname>|--retire
haido export --pack <dir> | --viz <file.json>
haido import --pack <dir>  # nhập + re-anchor theo qname/hash
haido doctor               # git? node? grammar? db schema? hooks đã cài?
```

Config `haido.toml` (✅ implement 11/07/2026 — `src/core/config.ts`, TOML subset tự parse không dependency): `include`/`exclude` globs (kèm prune thư mục khi an toàn), `max_file_kb`, `purge_deleted_days` (dọn soft-delete cũ), tham số co-change, budget recall/overview cho hooks. `haido init` sinh file mẫu; file hỏng → âm thầm dùng mặc định (hook không được chết), `haido doctor` báo lỗi parse.

## 10. Markdown memory pack (format mở)

`export --pack` ghi mỗi memory 1 file:

```markdown
---
id: m_01HXYZ...
type: invariant
status: fresh
anchors:
  - { kind: symbol, qname: "src/engine/board.ts#Board.move", hash: "3fa1…" }
created: 2026-07-10
author: agent:claude-code
---
# Toạ độ bàn cờ 0-based
Mọi toạ độ nội bộ là (col,row) 0-based; chỉ UI đổi sang 1-based khi render.

**Why:** đã sập bug lệch-1 hai lần (#12).
```

`import --pack` đối chiếu `qname` + `hash` với index hiện tại → anchor `fresh` hoặc vào thẳng stale-queue. Pack commit vào git → tri thức theo repo, review qua PR, không lock-in.

## 11. Viz (v0.2 — thiết kế trước để `export --viz` ổn định từ v0.1)

- `export --viz` → JSON: `{files[], symbols_count, memories[{anchors,status,type}], edges[imports,co_change]}`.
- 1 file HTML tự chứa, canvas 2D thuần (không lib — đúng sở trường canvas của chủ dự án):
  - **Chế độ treemap**: ô = file, gom theo thư mục; màu nền = mật độ memory; viền đỏ = có stale; chấm = loại memory.
  - **Chế độ lực**: node = file, cạnh = imports (xám) + co_change (cam, đậm theo weight) — đây là phần "hệ trục/liên kết" của ý tưởng gốc.
  - Click node → panel liệt kê memory + trạng thái. Chạy `file://`, không server, không network.

## 12. Mục tiêu hiệu năng

| Thao tác | Mục tiêu | Ghi chú |
|---|---|---|
| Index lạnh 100k LOC (TS+Py) | < 60s | WASM parser, chạy tuần tự; worker_threads nếu cần |
| Re-index 1 file (watch) | < 300ms | parse + hash + diff + staleness |
| `recall` p95 | < 100ms | index sẵn, FTS5 |
| Hook end-to-end | < 500ms | gồm spawn Node; xem §8 warm-process |
| DB size / 100k LOC + 500 memories | < 20MB | |

## 13. Kiểm thử

- **Unit:** `normalize()` (bảng vàng: format-only → hash bất biến; đổi token → hash đổi); ranking (case cố định); co-change math.
- **Fixture golden repos** (`test/fixtures/ts-mini`, `py-mini`): index → snapshot symbols/qname/hash; kịch bản kịch tính: rename file, split file, đổi body, prettier toàn repo.
- **Integration:** vòng đời đầy đủ — `init → remember → sửa code → index → stale → reanchor` bằng repo git tạm.
- **MCP contract:** client SDK gọi 6 tool, so schema.
- **Hook e2e:** giả lập stdin JSON của Claude Code, so output.
- CI: Windows + Linux (đường dẫn là nguồn bug số 1 — normalize POSIX nội bộ ngay từ đầu).

## 14. Bảo mật & riêng tư

100% local; không network call nào trong mọi lệnh; không telemetry. Hook output chỉ chứa dữ liệu do người dùng tự ghi vào DB của họ. `haido doctor --privacy` in cam kết này để user tự kiểm.

## 15. Rủi ro kỹ thuật & đối sách

| Rủi ro | Đối sách |
|---|---|
| API hooks Claude Code đổi | Cô lập trong `integrations/claude-code/`; kiểm chứng đầu sprint 1 (task #1 khi code) |
| WASM parse chậm trên repo lớn | Chỉ parse file đổi; worker_threads; ngưỡng file-size bỏ qua minified |
| Anchor "nhạy" quá (đổi tên biến nội bộ → stale) | Chấp nhận ở v0.1 (thà nhạy còn hơn câm); cân nhắc hash 2 tầng (structure-hash vs token-hash) ở v0.2 nếu dogfood thấy phiền |
| Monorepo lớn / file sinh tự động | include/exclude globs bắt buộc trong `haido.toml`, mặc định bỏ `node_modules`, `dist`, `*.min.*`, lockfiles |
| better-sqlite3 lệch ABI khi user đổi Node | `engines` chặt + `haido doctor` phát hiện và hướng dẫn rebuild |
| Agent không chịu gọi `remember` | Hook `Stop` (v0.2 cân nhắc): nhắc agent tổng kết quyết định cuối phiên; đo bằng dogfood trước khi thêm |

## 16. Trình tự implement đề xuất (khi spec được duyệt)

> ✅ 10/07/2026 — Bộ khung chất lượng đã dựng xong trước Sprint 0: rig (tsc strict/eslint/prettier/vitest, `npm run check` xanh), CI Windows+Linux, hiến pháp [QUALITY.md](QUALITY.md), memory pack viết tay `docs/memory/` (6 ghi chú nền tảng, gồm gotcha m_boot_006 về giả định hooks).

1. **Sprint 0 (1 buổi):** xác minh giả định hooks Claude Code bằng prototype 20 dòng (in "hello" vào context qua additionalContext) — rủi ro lớn nhất, kiểm trước tiên.
2. **Sprint 1:** core DB + indexer TS/Py + normalize/hash + tests vàng (F1, F2).
3. **Sprint 2:** memory store + staleness + reanchor + CLI recall/remember/stale (F4, F5, F9).
4. **Sprint 3:** recall ranking + MCP server 6 tools (F6, F7).
5. **Sprint 4:** hook runner + installer + co-change miner + watch (F3, F8, F10) → **dogfood rong-choi 2 tuần** → chỉnh trọng số → v0.1 công bố.
