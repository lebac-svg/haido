---
id: m_boot_018
type: invariant
status: fresh
anchors:
  - { kind: file, path: 'src/indexer/indexer.ts' }
created: 2026-07-29
author: human:daiba + agent:claude
---

# `TEXT_FILENAMES` không bao giờ được chứa tên file mang bí mật

Danh sách tên file không đuôi (`.gitignore`, `Dockerfile`, `LICENSE`…) mở đường cho anchor tới file không có phần mở rộng: `path.extname` trả về `''` cho cả dotfile lẫn `Dockerfile`, nên allowlist theo đuôi không bao giờ với tới chúng. `.env` và `.npmrc` bị loại có chủ ý, và có một test canh giữ điều đó.

**Why:** index không chỉ ghi tên file — nó chụp cả nội dung vào `files.norm_text` trong database cục bộ. Thêm một dòng vào danh sách này là quyết định về dữ liệu nhạy cảm, không phải chuyện thêm cho đủ bộ. Phát hiện khi dogfood 29/07/2026: ghi chú neo vào `.gitignore` của một dự án thật báo `missing`.
