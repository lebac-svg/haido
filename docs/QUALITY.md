# haido — Hiến pháp chất lượng (Reflection có neo)

**Vì sao tài liệu này tồn tại:** haido là công cụ dạy AI kỷ luật trí nhớ. *Một dự án dạy kỷ luật mà bản thân ẩu thì mất tư cách quản lý dự án khác.* Vậy nên repo này phải là **hình mẫu sống** của chính triết lý nó bán: mọi lời tự phê có bằng chứng, mọi bài học được ghi lại, mọi ghi chú có neo.

**Nguyên tắc gốc — Reflection có neo:** AI (và người) được phép tự soi lỗi và viết lại, nhưng **mọi lời tự phê phải đối chiếu với một tín hiệu khách quan** — test đỏ, lỗi type, lỗi lint, số đo hiệu năng, kết quả dogfood. Cấm "soi chay" (tự phê không bằng chứng rồi tự sửa theo cảm giác) — nghiên cứu đã chỉ ra self-correction không neo thường làm sai thêm.

## 1. Ba vòng phản chiếu

### Vòng nhỏ — mỗi thay đổi code
1. Hành vi mới → **viết test trước** (đặc biệt: bảng vàng cho `normalize()`/staleness — trái tim của sản phẩm).
2. Chạy `npm run check` (typecheck + lint + format + test). **Đỏ thì đọc output thật rồi mới sửa** — không đoán, không sửa test cho "qua chuyện".
3. Xanh = xong vòng. Không xanh = chưa tồn tại.

### Vòng giữa — mỗi tính năng (F1–F10 trong SPEC §5)
Checklist Definition of Done:
- [ ] Test vàng phủ đúng **tiêu chí nghiệm thu** ghi trong SPEC §5 (không phải test tự nghĩ ra cho dễ).
- [ ] Chạy xác minh **end-to-end thật** (CLI/MCP thật trên repo fixture), không chỉ unit test.
- [ ] Code review một lượt (`/code-review`) — sửa hoặc phản biện từng finding, không lờ.
- [ ] Hành vi lệch spec → sửa **một trong hai** (code hoặc spec) một cách *có chủ đích*, ghi rõ lý do. Spec là luật; lệch âm thầm là bug quy trình.
- [ ] Có quyết định/bẫy mới? → ghi vào `docs/memory/` (xem §3).

### Vòng lớn — cuối mỗi sprint
- **Dogfood kép:** chạy haido trên chính repo haido (ngay khi F1 chạy được) và trên `rong-choi`. Đo các metric SPEC §11, ghi số thật.
- **Retro 3 câu** (ghi vào `docs/memory/` nếu đáng nhớ):
  1. Điều gì diễn ra *khác* dự đoán trong ARCHITECTURE?
  2. Bài học nào sẽ khiến ta đỡ ngu hơn ở sprint sau?
  3. Spec/kiến trúc nào cần sửa — và đã sửa chưa?
- **Stale-review thủ công:** đọc lướt `docs/memory/` — ghi chú nào đã sai so với hiện trạng thì sửa/khai tử ngay. (Khi haido tự chạy được trên chính nó, việc này tự động hoá — đó là ngày "self-hosting".)

## 2. Bộ máy kiểm chứng khách quan (the rig)

| Tầng | Công cụ | Luật |
|---|---|---|
| Kiểu | TypeScript `strict` + `noUncheckedIndexedAccess` | Không `any` trần; `// @ts-expect-error` phải kèm lý do |
| Lint | eslint flat + typescript-eslint | Cảnh báo cũng phải xử lý trước khi xong tính năng |
| Format | prettier (code; docs miễn — xem `.prettierignore`) | Không tranh cãi về format |
| Test | vitest + coverage v8 | Core (`src/core`, `src/indexer`, `src/memory`, `src/recall`) hướng tới ≥ 80% lines khi module ra đời; **bảng vàng normalize/staleness là bất khả xâm phạm** |
| CI | GitHub Actions: ubuntu + windows × Node 20/22 | **Không xanh không merge.** Windows là first-class (chủ dự án dùng Windows) |
| Lệnh tổng | `npm run check` | Phải xanh trước khi kết thúc bất kỳ phiên làm việc nào có sửa code |

Luật cứng bổ sung:
- **Giả định về API bên ngoài phải có prototype kiểm chứng trước khi xây lên trên.** Ví dụ số 1: cơ chế `additionalContext` của hooks Claude Code (ARCHITECTURE §8) — đây là việc đầu tiên của Sprint 0, có ghi chú riêng trong `docs/memory/`.
- Dependency native phải có prebuilt cho Windows + Linux + macOS (bài học chọn `better-sqlite3`, `web-tree-sitter`).
- Không skip test/gate để "đi nhanh" — cửa sổ cạnh tranh 6–12 tháng (SURVEY §10) được đối phó bằng **cắt scope**, không bằng cắt chất lượng.

## 3. Nhật ký hải trình viết tay — `docs/memory/`

Cho tới khi haido tự phục vụ được chính nó, repo này ghi trí nhớ **bằng tay, đúng format pack của sản phẩm** (ARCHITECTURE §10). Đây vừa là kỷ luật, vừa là dogfood sớm nhất có thể: ta *sống trong* format của mình trước khi bắt user sống trong đó.

- Ghi gì: quyết định (decision), bất biến (invariant), bẫy đã sập (gotcha), quy ước (convention) — kèm **why** và **anchor**. Không chép code, không ghi trạng thái task.
- Khi nào ghi: ngay lúc chốt quyết định, và trong **nghi thức cuối phiên** (§4).
- Giai đoạn spec: anchor trỏ vào file docs (tài liệu *là* code lúc này). Khi code ra đời, move anchor sang symbol thật — chính là tập dượt quy trình `reanchor` của sản phẩm.
- Ngày haido chạy được `import --pack docs/memory/`: pack này trở thành bộ nhớ khởi động của chính nó. **Self-hosting là một mốc phát hành** (ghi vào README khi đạt).

## 4. Nghi thức cuối phiên (Stop-reflection thủ công)

Bản chạy-bằng-cơm của tính năng Stop-hook (SPEC §12 v0.2). Cuối mỗi phiên làm việc, agent (hoặc người) tự vấn — và chỉ hành động khi có bằng chứng đi kèm:

1. `npm run check` xanh chưa? (chưa xanh → chưa được kết thúc phiên)
2. Phiên này có **quyết định** nào user đã chốt, **bẫy** nào đã sập, **bất biến** nào lộ ra không? → ghi `docs/memory/`, đúng format, có why + anchor.
3. Có làm gì **lệch spec** không? → sửa spec hoặc sửa code, nói rõ với user.
4. Có hứa gì trong hội thoại mà chưa làm không? → làm hoặc ghi lại thành việc rõ ràng.

## 5. Định nghĩa "xong" (tổng)

Một thứ chỉ được gọi là *xong* khi: test vàng phủ tiêu chí nghiệm thu ✚ `npm run check` xanh trên máy dev ✚ CI xanh cả Windows lẫn Linux ✚ chạy được end-to-end bằng tay ít nhất một lần ✚ bài học (nếu có) đã nằm trong `docs/memory/`. Thiếu một vế = chưa xong, nói "chưa xong".
