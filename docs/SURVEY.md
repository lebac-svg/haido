# Khảo sát thị trường: Code map & Persistent memory cho AI coding agent

**Ngày khảo sát:** 10/07/2026 · **Mục đích:** định vị dự án `haido` (graph 3 lớp: cấu trúc tree-sitter + ngữ nghĩa + ký ức quyết định neo vào symbol, staleness qua content-hash, co-change từ git, MCP-first, local-first SQLite, viz 2D cho người).

## 0. Phương pháp & độ tin cậy

Khảo sát chạy bằng deep-research workflow (5 hướng search song song → đọc nguồn → kiểm chứng chéo). Khâu kiểm chứng chéo tự động bị đứt giữa chừng do rate limit, nên **các thông tin quyết định định vị đã được kiểm chứng tay trực tiếp** trên repo/paper gốc trong ngày 10/07/2026. Mỗi thông tin trong tài liệu này mang một nhãn:

- ✅ **Kiểm chứng trực tiếp** (đọc repo GitHub / abstract paper ngày 10/07/2026)
- 🔎 **Từ search có nguồn** — trích từ nguồn cụ thể nhưng chưa kiểm chứng lần hai
- 📚 **Kiến thức nền** (đến 01/2026) — cần đối chiếu lại khi bắt tay implement

Số liệu stars/version là snapshot 10/07/2026, sẽ trôi.

## 1. TL;DR

1. **Lớp "bản đồ code qua MCP" đã bị chiếm và commodity hoá.** `codebase-memory-mcp` ✅ (29.5k⭐, MIT, 158 ngôn ngữ, single binary, SQLite, có cả embeddings + viz 3D, release 2 ngày trước) và Serena ✅ (26.3k⭐, LSP) thống trị. Xây "code-graph MCP server thứ N" là thua từ vạch xuất phát.
2. **Lớp "memory tổng quát" cũng đã đông:** mem0 ✅ 60.5k⭐, cognee ✅ 27.5k⭐, Letta, Zep/Graphiti. Nhưng **không cái nào neo memory vào code symbol**, và staleness (nếu có) xử lý bằng thời gian/LLM, không bằng nội dung code.
3. **Ý tưởng "memory neo vào symbol + auto-inject qua hooks" ĐÃ có người làm:** `cogniplex/codemem` ✅ — nhưng mới **18⭐**, và staleness của nó là TTL/expire-on-reindex, **chưa phải content-hash per-symbol với quy trình review**. Ý tưởng được xác nhận đúng hướng; thị phần còn bỏ ngỏ.
4. **Mảnh thực sự còn trống:** vòng đời trí nhớ hoàn chỉnh — neo bằng hash → phát hiện drift kèm diff → hàng đợi review → reanchor/retire — cộng với **bản đồ tri thức cho người** (knowledge heatmap). Chưa ai làm trọn.
5. **Khuyến nghị:** pivot định vị từ "bản đồ + trí nhớ" sang **"trí nhớ có neo, tự biết lỗi thời"** (memory-first). Chỉ giữ phần cấu trúc tối thiểu làm giá đỡ neo. Ship nhanh — đối thủ lớn nhất chỉ cách tính năng này một bước (họ đã có `manage_adr`).

---

## 2. Nhóm 1 — Bản đồ code (code map / code graph) cho agent

### 2.1 ⭐ codebase-memory-mcp (DeusData) — kẻ thống trị mới

✅ Kiểm chứng trực tiếp repo + paper:

- **29.5k stars**, MIT, release v0.9.0 ngày 08/07/2026. Phân phối: single static binary (macOS/Linux/Windows) + npm + PyPI + Homebrew + AUR.
- **158 ngôn ngữ** (vendored tree-sitter grammars). Storage: **SQLite** tại `~/.cache/codebase-memory-mcp/`.
- Graph: node Project/Package/Folder/File/Module/Class/Function/Method/Interface/Enum/Type/Route/Resource; edge `CALLS, IMPORTS, DEFINES, IMPLEMENTS, INHERITS, HTTP_CALLS, ASYNC_CALLS, DATA_FLOWS, SIMILAR_TO, SEMANTICALLY_RELATED`.
- **Có lớp embeddings**: bundled Nomic `nomic-embed-code` (768d, int8) + "11-signal combined scoring" (TF-IDF, RRI, chữ ký API/Type/Decorator, AST profile, data flow…) qua tool `semantic_query`.
- Incremental: **file watcher + git polling**; `detect_changes` map diff chưa commit → symbol bị ảnh hưởng.
- **Viz 3D built-in** tại `localhost:9749` (bản build kèm UI).
- **Memory quyết định: KHÔNG neo vào code.** Có tool `manage_adr` lưu Architecture Decision Records ở **mức project** — không anchor, không staleness. Đây là điểm họ đứng cách "ngách của haido" đúng một bước.
- Paper ✅ [arXiv 2603.27277](https://arxiv.org/abs/2603.27277) (nộp 28/03/2026, Vogel et al.): tại thời điểm viết là 66 ngôn ngữ; benchmark **31 repo thực**: 83% answer quality so với 92% của agent duyệt file thô, nhưng **ít hơn 10× token và 2.1× tool call**. 🔎 Search cho biết ~900⭐ sau 4 tuần ra mắt (25/02/2026) → 29.5k⭐ sau ~4.5 tháng: tăng trưởng bùng nổ.

**Bài học rút ra:** (a) nhu cầu thị trường có thật và rất lớn; (b) con số 83%-vs-92% cho thấy graph *tiết kiệm* hơn chứ không *thông minh* hơn duyệt file — giá trị nằm ở token economy; (c) không cạnh tranh trực diện với họ ở lớp cấu trúc.

### 2.2 Serena (oraios)

✅ **26.3k⭐**, MIT, Python, v1.5.3 (26/05/2026). MCP server cho semantic code retrieval/editing qua **LSP** (40+ ngôn ngữ) hoặc JetBrains plugin (trả phí). Đại diện nhánh "LSP chính xác theo yêu cầu" thay vì "graph dựng sẵn". Có tính năng "memories" — xem §4.4.

### 2.3 Aider repo map — ông tổ của thể loại

✅ **47.2k⭐**, Apache-2.0, **nhưng release cuối v0.86.0 từ 09/08/2025** (~11 tháng trước) — dự án đã chững. Repo map vẫn là tính năng lõi. 📚 Cơ chế: tree-sitter trích tags (định nghĩa/tham chiếu) → xây graph → **PageRank cá nhân hoá** theo file đang trong phiên chat → chọn top symbol vừa ngân sách token. Tĩnh, dựng lại mỗi lần chạy, không memory, không staleness.

**Tín hiệu thị trường:** tool AI-coding standalone thoái trào; hệ sinh thái dồn về **MCP server cắm vào agent lớn** (Claude Code, Cursor, Codex CLI…).

### 2.4 Cursor codebase indexing (+ first-party khác)

📚 Closed-source: Merkle tree đồng bộ thư mục → embeddings tính server-side, re-index incremental theo thay đổi. Kèm **Cursor Memories** (tự sinh từ hội thoại). Windsurf có Cascade Memories tương tự. GitHub Copilot: workspace index + `copilot-instructions.md`. Tất cả đóng, gắn chặt vào IDE của họ, không dùng được cho agent khác — đây chính là lý do tồn tại của một memory layer OSS trung lập.

### 2.5 Cụm "codegraph" nhỏ — ngách đang đông nhanh

- **codegraph-ai/CodeGraph** ✅: Apache-2.0 (open-core: 42 tool community + 27 pro + 17 security), RocksDB + HNSW, 38 ngôn ngữ, hoạt động tới 30/06/2026 nhưng mới **35⭐**. **Có "persistent memory layer"**: `memory_store/get/search` lưu insight debug/quyết định **ở mức project, KHÔNG neo vào symbol** (BM25 + semantic; có `memory_context` lọc theo file/function nhưng là *lọc liên quan*, không phải *anchor*).
- 🔎 Cùng cụm: colbymchenry/codegraph (auto-sync, đa agent), websines/codegraph-mcp ("persistent learning across teams"), sdsrss/code-graph-mcp, CodeGraphContext (Neo4j), GitNexus (LadybugDB/WASM), codanna, claude-context, grepai… — hàng chục repo na ná, đa số ít sao. **Ngách "code graph MCP" đã bão hoà về số lượng.**

### 2.6 potpie v2

✅ **5.5k⭐**, Apache-2.0, v2.0.0 (03/07/2026). Pivot thành "**living context graph** cho AI-native SDLC": index code + lịch sử + **decisions**, tích hợp GitHub/Linear/Jira/Confluence, cài "skills" cho Claude Code/Codex/Cursor/OpenCode, local-first CLI (có tầng account tuỳ chọn). Không thấy tài liệu về cơ chế neo memory vào symbol hay staleness. Đáng theo dõi: họ đi hướng "graph toàn SDLC" (rộng), haido đi hướng "trí nhớ sâu tại code" (sâu).

### 2.7 Hạ tầng công nghiệp & tool lân cận

📚 Sourcegraph (SCIP index, enterprise; Cody đã nhường chỗ cho Amp), Glean (Meta, OSS, Angle query), Kythe (Google, ít hoạt động) — chuẩn mực về độ chính xác nhưng nặng, không nhắm agent cá nhân. ast-grep: structural search/rewrite bằng tree-sitter, phổ biến, không phải map. Repomix/code2prompt: đóng gói repo thành prompt, dùng một lần, không có trạng thái.

---

## 3. Nhóm 2 — Persistent memory cho agent

### 3.1 Memory tổng quát (không hiểu code)

| Tool | Số liệu | Mô hình | Staleness | Neo vào code? |
|---|---|---|---|---|
| **mem0** | ✅ 60.5k⭐, Apache-2.0, SDK release 01/07/2026 | Vector multi-level (User/Session/Agent) + hybrid search (semantic + BM25 + entity); OpenMemory MCP trong repo | ✅ "temporal reasoning" xếp hạng theo thời gian — không theo nội dung code | ❌ |
| **cognee** | ✅ 27.5k⭐, Apache-2.0, v1.2.2.dev4 07/07/2026 | Hybrid graph + vector trên 1 Postgres/pgvector (swap được Neo4j/Kuzu/LanceDB); cognee-mcp | README không nêu; 🔎 blog: hash **mức file** khi ingest để re-process incremental, "memify" prune node stale | ❌ (🔎 blog có "diff-aware review: map changed lines → graph symbols" — đáng theo dõi nhất trong nhóm này) |
| **Letta (MemGPT)** | 📚 Apache-2.0 | Self-editing memory blocks (core/archival), kiểu hệ điều hành bộ nhớ | LLM tự sửa block — không cơ chế khách quan | ❌ |
| **Zep / Graphiti** | 🔎 | Temporal knowledge graph **bitemporal** (`valid_from/valid_to/invalid_at`) — fact mới supersede fact cũ | ✅ tốt nhất nhóm, nhưng theo *thời gian của fact*, không theo *nội dung code* | ❌ |

**Kết luận nhóm:** kỹ thuật staleness tiên tiến nhất hiện nay (bitemporal của Graphiti) vẫn trả lời câu hỏi "*fact này còn hiệu lực theo thời gian không*", chưa ai trả lời "*fact này còn khớp với code hiện tại không*". Code có một lợi thế đặc biệt mà chat không có: **chân lý nền kiểm chứng được bằng hash** — đây là nền tảng của haido.

### 3.2 Memory chuyên cho coding agent

- **ByteRover** 🔎 (paper [arXiv 2604.01599](https://arxiv.org/abs/2604.01599) + blog 06/2026): memory layer qua MCP cho 22 coding agent; "versioned context tree", versioning kiểu git (branch/merge/rollback), retrieval 5 tầng, RBAC + cloud sync cho team. **Memory là markdown thuần, không neo vào symbol; staleness quản bằng quy trình review của con người.** Thương mại, cloud-first.
- **Cline / Roo Code "Memory Bank"** 📚: *quy ước* markdown (projectbrief.md, activeContext.md, progress.md…) do agent tự đọc-ghi theo custom instructions. Phổ biến rộng vì đơn giản; không neo, không staleness, phình to dần và mục nát — chính là "CLAUDE.md problem" ở quy mô lớn hơn.
- **Claude Code** 📚: CLAUDE.md (+ auto-memory dạng thư mục file + MEMORY.md index), Skills, và **hooks** (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop…) — hooks chính là bề mặt tích hợp mà haido sẽ dùng. Memory không neo vào code, không staleness tự động.
- **Serena memories** ✅ có tính năng, docs không nêu chi tiết; 📚 là các file markdown trong `.serena/memories/`, agent đọc theo tên qua tool `read_memory` — không neo, không staleness.
- **mann1x/claude-hooks** 🔎: chứng minh mảnh "recall tự động qua hooks" đã có người làm — UserPromptSubmit inject memory từ Qdrant + KG, Stop lưu findings, có HyDE/attention decay. Staleness = **aging theo thời gian** (active → stale 30d → archived 90d), không theo nội dung code.
- **Cursor Memories / Windsurf Cascade Memories** 📚: tự sinh, đóng, gắn IDE.

---

## 4. Nhóm 3 — Đối thủ sát ngách nhất (map + memory kết hợp)

### 4.1 ⚠️ cogniplex/codemem — trùng ý tưởng nhất, chưa có thị phần

✅ Kiểm chứng trực tiếp: Rust, Apache-2.0, v0.18.0 (20/05/2026), 203 commits, **18⭐**.

Những gì codemem ĐÃ làm (trùng với ý tưởng ban đầu của haido):

- 3 lớp lưu trữ: HNSW 768d (vector) + petgraph knowledge graph (PageRank, Louvain, betweenness) + **memories dạng structured facts** (TTL, importance, temporal validity).
- **Memory neo vào graph node/symbol** (`sym:AuthService::validate` là first-class entity), lan truyền qua "direct and transitive dependents".
- **Temporal graph từ git**: commit/PR là node, cạnh `ModifiedBy` commit→symbol; tools `find_stale_files(stale_days)`, `symbol_history`, `detect_drift`.
- **9 lifecycle hooks với auto-inject** (SessionStart inject prior knowledge, UserPromptSubmit capture, PostToolUse, Stop, SessionEnd…) — đúng mô hình "gợi nhớ đúng lúc".
- 32 MCP tools, 14 ngôn ngữ tree-sitter, SQLite (trait-ready cho Postgres/Neo4j).

Những gì codemem CHƯA làm (khoảng trống còn lại):

- **Staleness không dựa content-hash per-symbol**: cơ chế là `expire_enrichments_on_reindex` (reindex thì *xoá/hết hạn* enrichment) + TTL theo giờ (168h) + `find_stale_files` theo *số ngày*. Không có: so hash nội dung symbol → đánh dấu *cần review* kèm diff cũ/mới → quy trình reanchor/retire. Expire ≠ review: expire *vứt* tri thức; review *cứu* tri thức.
- Không có viz cho người.
- Scope phình: "memory consolidation với 5 chu trình lấy cảm hứng thần kinh học", "self-editing memory", 9-component scoring — nhiều máy móc, khó đoán, khó tin tưởng trong khi bài toán cốt lõi (đừng để ghi chú mục nát) cần sự **đơn giản kiểm chứng được**.
- 18⭐ sau nhiều tháng → chưa chiếm mindshare; Rust codebase, rào cản đóng góp cao hơn TS.

**Ý nghĩa với haido:** hướng đi được xác nhận là đúng (người khác cũng nhìn thấy), thị phần chưa mất, và có một bài học định vị: *ít máy móc hơn, dễ hiểu hơn, cơ chế staleness khách quan hơn*. Cân nhắc trong tương lai: interop hoặc đóng góp chéo.

### 4.2 codebase-memory-mcp: `manage_adr`

✅ ADR ở mức project — không anchor, không hash, không review queue. Nhưng vì họ đã có toàn bộ hạ tầng (graph, watcher, hash file, 29.5k user), **khoảng cách từ `manage_adr` đến "anchored memory" chỉ là một release**. Đây là rủi ro cạnh tranh số 1 (xem §10).

### 4.3 codegraph-ai/CodeGraph memory layer

✅ Memory project-scoped, retrieval BM25+semantic, `memory_context` lọc theo file/function. Không anchor thật, không staleness. Open-core hướng thương mại.

---

## 5. Nhóm 4 — Visualization codebase cho người

- **Sourcetrail**: 🔎 gốc archive 14/12/2021; sống lay lắt qua fork (petermost/Sourcetrail build được với VS2026/Qt Creator 18; OpenSourceSourceTrail commit tới 02/2026; NumbatUI của Quarkslab WIP).
- **CodeSee**: 🔎 bị GitKraken mua 2024, phát triển standalone gần như dừng.
- **CodeCharta** (MaibornWolff): 🔎 còn sống, "city map" từ metrics + git. Không gắn AI/MCP.
- **GitHub Next repo-visualization**: 📚 thí nghiệm 2021, đã archive.
- **codebase-memory-mcp**: ✅ có viz 3D built-in — nhưng là viz *cấu trúc*, không phải viz *tri thức*.

**Kết luận nhóm:** thị trường "bản đồ code cho người" gần như bị bỏ hoang (các công ty chết/bị mua), chỉ còn viz cấu trúc. **Chưa tồn tại "bản đồ tri thức": nhìn thấy memory nằm đâu trên codebase, chỗ nào stale, chỗ nào là vùng nóng thiếu ghi chú.** Đây là đất riêng cho lớp viz của haido (v0.2) — và là phần "hệ trục" trong ý tưởng gốc.

## 6. Nhóm 5 — Co-change / git mining

- **CodeScene** ✅ có MCP server chính thức (codescene-oss/codescene-mcp-server, 54⭐, MCP-1.4.0 ngày 08/07/2026): phân tích chạy local nhưng full feature (hotspots, ownership, tech-debt goals) **cần subscription** + REST qua account token. Change coupling chưa xác nhận có trong tool list MCP.
- **code-maat** 🔎📚: CLI kinh điển của Adam Tornhill — change coupling, hotspot, knowledge map từ git log; mức file, offline, không MCP, ít phát triển.
- **codemem** ✅: cạnh `ModifiedBy` commit→symbol — một dạng git mining mức symbol.
- **codebase-memory-mcp** 🔎 (paper): có edge `FILE_CHANGES_WITH` (mức file, cách tính không được mô tả).

**Kết luận nhóm:** co-change **mức file** đã có rải rác; dùng co-change làm **tín hiệu xếp hạng recall memory** (file A đổi → nhắc ghi chú của file B hay đổi cùng) thì chưa ai làm. Với haido, co-change là gia vị xếp hạng chứ không phải món chính.

## 7. Nhóm 6 — Nền tảng học thuật (2024–2026)

- **RepoGraph** (ICLR 2025) 🔎 trích dẫn nguyên văn từ paper: graph mức *dòng* bằng tree-sitter (node def/ref, cạnh invoke/contain); cắm vào 4 framework (RAG, Agentless, AutoCodeRover, SWE-agent) cải thiện **trung bình +32.8% tương đối trên SWE-bench-Lite**; tích hợp qua action `search_repograph()` trả k-hop ego-graph. Paper không đề cập memory/staleness/incremental/git. OSS: github.com/ozyyshr/RepoGraph.
- **CodexGraph** (NAACL 2025) 🔎: agent tự viết Cypher trên Neo4j chứa code graph; motivation nêu rõ *embedding-only retrieval có recall thấp trong task phức tạp* — củng cố luận điểm cần cấu trúc.
- **LocAgent** (2503.09089) 🔎: graph-guided code localization. **ARISE** (2605.03117, 05/2026) 🔎: repo-graph + toolset cho fault localization/repair — học thuật đang chuyển từ "graph tĩnh" sang "graph + bộ công cụ agentic". **GraphCodeAgent** (2504.10046) 🔎: dual graph control/data-flow. Survey RACG (2510.04905) 🔎.

**Kết luận nhóm:** học thuật đã chứng minh *cấu trúc giúp agent* (con số +32.8% dùng được để thuyết phục trong README/pitch), nhưng **chưa có dòng nghiên cứu nào về vòng đời trí nhớ neo vào code** — nếu haido làm tốt, thậm chí có tiềm năng thành paper.

---

## 8. Bảng so sánh tổng

Chú thích: ●  có, đầy đủ · ◐ có một phần · ○ không. "Neo" = memory gắn vào symbol/file cụ thể. "Stale-hash" = phát hiện lỗi thời bằng nội dung code.

| Tool | Loại | ⭐ (10/07/26) | Local-first | MCP | Memory | Neo | Stale-hash | Co-change | Viz | Hooks inject |
|---|---|---|---|---|---|---|---|---|---|---|
| codebase-memory-mcp ✅ | map+semantic | 29.5k | ● SQLite | ● | ◐ ADR project-scope | ○ | ○ (hash chỉ cho index) | ◐ file | ● 3D cấu trúc | ○ |
| Serena ✅ | LSP tools | 26.3k | ● | ● | ◐ markdown | ○ | ○ | ○ | ○ | ○ |
| Aider repo map ✅ | map trong tool | 47.2k (chững) | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Cursor index/Memories 📚 | first-party | — | ○ cloud | ○ | ◐ | ○ | ○ | ○ | ○ | ○ |
| codegraph-ai/CodeGraph ✅ | map+memory | 35 | ● RocksDB | ● | ◐ project-scope | ○ | ○ | ○ | ○ | ○ |
| potpie v2 ✅ | SDLC graph | 5.5k | ◐ | ◐ skills | ◐ | ? | ○ | ◐ history | ○ | ○ |
| mem0 ✅ | memory chung | 60.5k | ◐ | ● | ● | ○ | ○ (temporal) | ○ | ○ | ○ |
| cognee ✅ | memory chung | 27.5k | ◐ | ● | ● | ○ | ◐ file-hash cho index | ○ | ○ | ○ |
| Zep/Graphiti 🔎 | memory chung | — | ◐ | ● | ● | ○ | ◐ bitemporal | ○ | ○ | ○ |
| ByteRover 🔎 | memory coding | — | ○ cloud | ● | ● markdown | ○ | ○ (human review) | ○ | ○ | ○ |
| Cline Memory Bank 📚 | quy ước md | — | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| Claude Code memory 📚 | first-party | — | ● | — | ● | ○ | ○ | ○ | ○ | ◐ hooks tự cấu hình |
| mann1x/claude-hooks 🔎 | hooks recall | — | ● | ○ | ● | ○ | ○ (time aging) | ○ | ○ | ● |
| **cogniplex/codemem** ✅ | **map+memory** | **18** | ● SQLite | ● 32 tools | ● | **●** | ◐ TTL/expire-on-reindex | ◐ ModifiedBy | ○ | **● 9 hooks** |
| CodeScene MCP ✅ | git analytics | 54 | ◐ cần sub | ● | ○ | ○ | ○ | ● (sản phẩm chính) | ● (web, sub) | ○ |
| code-maat 🔎 | git mining | — | ● | ○ | ○ | ○ | ○ | ● file | ○ | ○ |
| CodeCharta 🔎 | viz người | — | ● | ○ | ○ | ○ | ○ | ◐ | ● city map | ○ |
| **haido (đề xuất)** | **memory neo vào map** | — | ● SQLite | ● | ● | ● | **● per-symbol hash + review** | ● (tín hiệu recall) | ● knowledge heatmap (v0.2) | ● |

## 9. Gap analysis — 7 differentiator dự kiến, cái nào còn trống?

| # | Differentiator dự kiến ban đầu | Trạng thái thị trường | Kết luận cho haido |
|---|---|---|---|
| 1 | Lớp cấu trúc tree-sitter + MCP + SQLite local | **Mất.** codebase-memory-mcp làm xuất sắc, 29.5k⭐ | Không cạnh tranh. Chỉ giữ indexer tối thiểu (symbol + hash + import) làm giá đỡ neo |
| 2 | Lớp ngữ nghĩa embeddings | **Mất/commodity.** Bundled sẵn trong đối thủ | Loại khỏi MVP. Recall dùng graph proximity + FTS. Chừa cổng plugin (v0.3) |
| 3 | Memory neo vào symbol | **Gần trống.** Duy nhất codemem (18⭐) làm thật | Làm, và làm dễ hiểu hơn codemem |
| 4 | Staleness qua content-hash per-symbol **cho memory** (drift → review queue → reanchor) | **Trống hoàn toàn.** Hash hiện chỉ dùng cho index freshness (file-level); staleness memory nơi khác = TTL/time/human | **Differentiator số 1. Linh hồn của dự án** |
| 5 | Co-change từ git làm tín hiệu recall | File-level đã có nơi khác nhưng chưa ai dùng cho memory ranking | Làm ở mức file, trọng số nhỏ. Symbol-level để sau |
| 6 | Recall tự động qua hooks + token budget | Có rời rạc (codemem, mann1x) — chưa thành chuẩn | Làm, coi là UX chủ lực. "Nhớ đúng lúc > nhớ nhiều" |
| 7 | Viz 2D cho người | Viz cấu trúc có (3D); **viz tri thức/độ tươi chưa ai có** | Giữ, đẩy sang v0.2, làm điểm "wow" demo |

**Định vị rút gọn sau khảo sát:** haido không bán bản đồ — bán **trí nhớ đáng tin**: *ghi chú nào cũng có toạ độ, và toạ độ nào đổi thì ghi chú tự giơ tay xin review*. Bản đồ (của haido hay của tool khác) chỉ là giá treo.

## 10. Rủi ro cạnh tranh

| Rủi ro | Khả năng | Đối sách |
|---|---|---|
| **R1 — codebase-memory-mcp thêm anchored memory.** Họ có sẵn graph, watcher, hash, 29.5k user, và `manage_adr`; chỉ thiếu anchor + review workflow | Cao (6–12 tháng) | Ship v0.1 trong vài tuần; đào sâu *cơ chế* (review queue, reanchor, hygiene, markdown pack không lock-in); thiết kế để haido có thể chạy *trên* graph của họ (interop) thay vì đối đầu |
| **R2 — codemem trưởng thành** | Trung bình (18⭐, đà chậm) | Theo dõi release; khác biệt bằng sự đơn giản + TS ecosystem + viz; để ngỏ hợp tác |
| **R3 — First-party memory (Claude Code, Cursor) học cách neo vào code** | Trung bình, dài hạn | Giá trị của OSS trung lập đa-agent + format mở (markdown pack, SQLite) vẫn còn; hooks của chính họ là bề mặt ta tận dụng |
| **R4 — Bão hoà nhận diện:** hàng chục "codegraph MCP" khiến người dùng mệt | Cao | Không tự gọi là code graph. Kể chuyện bằng demo: *sửa hàm → ghi chú tự stale → agent tự đề nghị cập nhật* (video 30s); tên và ẩn dụ riêng (hải đồ / nhật ký hải trình) |

## 11. Khuyến nghị định vị MVP

1. **Memory-first, map-minimal.** Toàn bộ giá trị dồn vào vòng đời memory: `remember (có neo) → tự stale khi hash lệch → review queue → reanchor/retire`. Indexer chỉ cần: symbol + qualified name + body-hash + import edges. Không call graph, không embeddings.
2. **Kẻ thù là "sự quên", không phải codebase-memory-mcp.** Trong tài liệu/pitch, luôn so sánh với *CLAUDE.md mục nát* và *agent phá invariant*, không so với code-graph server.
3. **Hooks là sản phẩm, MCP là API.** Trải nghiệm "không phải làm gì mà agent tự nhớ" mới là thứ giữ user; tool MCP chỉ là đường ống.
4. **Format mở làm hào nước:** memory export được thành markdown pack commit vào git (review tri thức qua PR) — thứ mà mọi đối thủ đóng/cloud không muốn làm.
5. **Ship nhanh, demo mạnh:** cửa sổ R1 là 6–12 tháng. Dogfood ngay trên repo `rong-choi`.

## 12. Nguồn chính

- https://github.com/DeusData/codebase-memory-mcp ✅ · https://arxiv.org/abs/2603.27277 ✅
- https://github.com/cogniplex/codemem ✅
- https://github.com/codegraph-ai/CodeGraph ✅ · https://github.com/oraios/serena ✅ · https://github.com/topoteretes/cognee ✅ · https://github.com/mem0ai/mem0 ✅ · https://github.com/Aider-AI/aider ✅ · https://github.com/potpie-ai/potpie ✅ · https://github.com/codescene-oss/codescene-mcp-server ✅
- https://arxiv.org/html/2410.14684v1 (RepoGraph) 🔎 · https://aclanthology.org/2025.naacl-long.7/ (CodexGraph) 🔎 · arXiv 2503.09089 (LocAgent) 🔎 · arXiv 2605.03117 (ARISE) 🔎 · arXiv 2604.01599 (ByteRover) 🔎
- https://github.com/adamtornhill/code-maat 🔎 · https://github.com/maibornwolff/codecharta 🔎 · https://github.com/petermost/Sourcetrail 🔎 · https://github.com/mann1x/claude-hooks 🔎
- Roundups (đối chiếu thêm, độ tin cậy thấp hơn): rywalker.com/research/code-intelligence-tools · sverklo.com blog · chatforest.com reviews · cognee.ai blog · vectorize.io/articles/mem0-vs-zep · graphlit.com blog 🔎
