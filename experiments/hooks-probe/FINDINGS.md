# Sprint 0 — Kết quả kiểm chứng hooks Claude Code

**Ngày:** 10/07/2026 · **Trạng thái:** ✅ Giả định nền của UX auto-inject ĐÚNG · Giải quyết gotcha `m_boot_006`.

## Câu hỏi cần trả lời

Hook của Claude Code có đưa được nội dung vào context của model qua `hookSpecificOutput.additionalContext` không — ở cả `SessionStart` lẫn `PostToolUse`? (Toàn bộ thiết kế hook runner ARCHITECTURE §8 đứng trên giả định này.)

## Cách thí nghiệm (tái chạy được)

1. `settings.probe.json` (chép vào `.claude/settings.json`) đăng ký `probe.mjs` cho `SessionStart` và `PostToolUse` (matcher `Read`).
2. `probe.mjs`: ghi nguyên văn stdin vào `log.jsonl` (bằng chứng schema) rồi in JSON `additionalContext` chứa canary token. Token không tồn tại ở bất kỳ đâu khác (không trong file, không trong prompt) — model chỉ có thể thấy nó nếu cơ chế inject hoạt động.
3. Chạy 2 phiên con headless (`claude -p … --model haiku`) trong thư mục repo:
   - **Test A:** hỏi model có thấy token `HAIDO_SESSION_CANARY_*` không.
   - **Test B:** bảo model Read `sample.txt` rồi hỏi có thấy token `HAIDO_POST_CANARY_*` cạnh kết quả tool không (`--allowedTools Read`).

## Kết quả

| Test                       | Kỳ vọng                 | Kết quả                                          |
| -------------------------- | ----------------------- | ------------------------------------------------ |
| A — SessionStart           | model trả về đúng token | ✅ `HAIDO_SESSION_CANARY_73194`                  |
| B — PostToolUse(Read)      | model trả về đúng token | ✅ `HAIDO_POST_CANARY_88251`                     |
| Hooks chạy ở headless `-p` | có                      | ✅ (cả 2 test đều headless)                      |
| Matcher `Read`             | chỉ bắn khi Read        | ✅ (log chỉ có 1 PostToolUse, đúng phiên test B) |

## Schema stdin bắt được (Windows, Claude Code 07/2026)

`SessionStart`:

```json
{
  "session_id": "b68e5789-…",
  "transcript_path": "C:\\Users\\dev\\.claude\\projects\\C--D---n-haido\\….jsonl",
  "cwd": "C:\\Dự án\\haido",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

`PostToolUse` (tool `Read`):

```json
{
  "session_id": "9df4ab0c-…",
  "cwd": "C:\\Dự án\\haido",
  "prompt_id": "6dca1f70-…",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": { "file_path": "C:\\Dự án\\haido\\experiments\\hooks-probe\\sample.txt" },
  "tool_response": { "type": "text", "file": { "filePath": "…", "content": "…", "numLines": 3 } },
  "tool_use_id": "toolu_…",
  "duration_ms": 10
}
```

## Hệ quả cho thiết kế hook runner (ARCHITECTURE §8)

1. **PostToolUse bắt buộc dùng JSON** `hookSpecificOutput.additionalContext` — stdout thuần không tới model (đối chiếu docs chính thức; test B dùng JSON và thành công).
2. **`tool_input.file_path` là đường dẫn TUYỆT ĐỐI kiểu Windows** (backslash, có Unicode `Dự án`) → hook runner phải chuẩn hoá `absolute → repo-relative POSIX` trước khi tra anchor. Sai bước này là recall câm lặng.
3. **`session_id` có trong mọi event** → dùng làm tên state file chống tiêm lặp: `.haido/session/<session_id>.json`.
4. Hook command chạy với **cwd = thư mục dự án** → dùng lệnh tương đối (`node experiments/…`) là đủ, tránh rắc rối quote đường dẫn Unicode.
5. Payload thực tế không có field `model` ở SessionStart (docs có nhắc) — không được phụ thuộc field này.

## Ghi chú vận hành

- `.claude/settings.json` (bản probe) đã được gỡ sau thí nghiệm để phiên dev sau không chạy nhầm; muốn tái chạy: chép `settings.probe.json` → `.claude/settings.json`.
- `log.jsonl` là output runtime, đã gitignore; schema tiêu biểu chép ở trên.
