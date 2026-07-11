---
id: m_boot_013
type: gotcha
status: fresh
anchors:
  - { kind: file, path: 'src/memory/pack.ts' }
  - { kind: file, path: 'src/cli.ts' }
created: 2026-07-11
author: human:daiba + agent:claude
---

# Nội dung tiếng Việt: ghi qua MCP hoặc pack file, KHÔNG qua tham số dòng lệnh PowerShell

Đã xảy ra thật: seed memory cho rong-choi bằng `haido remember --body "..."` trên PowerShell, phải gõ không dấu để né rủi ro encoding console Windows → dữ liệu không dấu lọt vào bộ nhớ, user bắt lỗi. Đường an toàn: agent ghi qua MCP (JSON UTF-8) hoặc sửa file pack rồi `haido import --pack` (import đè theo id). FTS đã bật remove_diacritics nên tìm kiếm không phân biệt dấu, nhưng dữ liệu hiển thị phải có dấu chuẩn.

**Why:** memory là dữ liệu cho người đọc — sai chính tả/mất dấu làm mất uy tín của chính hệ thống trí nhớ.
