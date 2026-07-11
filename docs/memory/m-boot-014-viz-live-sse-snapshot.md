---
id: m_boot_014
type: decision
status: fresh
anchors:
  - { kind: file, path: 'src/viz/live.ts' }
  - { kind: file, path: 'src/viz/html.ts' }
  - { kind: file, path: 'src/indexer/watch.ts' }
created: 2026-07-11
author: human:daiba + agent:claude
---

# Viz sống: SSE snapshot đầy đủ + data_version cho writer ngoài process

`haido viz --live` phát mỗi frame = snapshot ĐẦY ĐỦ + `hot{files,mems}`; client `applyData()` reconcile tại chỗ nên reconnect chỉ việc áp lại — không có giao thức diff để mà sai. Hai nguồn thay đổi bắt buộc tách: code save đi qua `watchRepo` (đường dẫn thô của fs event = hot list, nhờ đó sửa comment-only vẫn phát sáng dù JSON không đổi); memory từ process khác (MCP server, terminal thứ hai) dò bằng `PRAGMA data_version` — chỉ nhảy khi connection KHÁC commit, write của chính server không tự kích lại. Server phải `await watcher.ready` trước khi nhận khách: save trong lúc initial scan sẽ bị chokidar nuốt (đã sập thật trong test).

**Why:** ba quyết định này dễ bị "tối ưu hoá nhầm" về sau — đổi sang diff protocol, gộp hai nguồn thay đổi làm một, hay bỏ await ready đều tạo bug câm (mất frame khi reconnect, mất glow comment-only, nuốt save đầu tiên) mà test thường không bắt được.
