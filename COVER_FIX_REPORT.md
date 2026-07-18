# Cover Fix Report

## Problem

下载资产增强阶段 ID3 Cover art 缺失。

## Root Cause

两个原因：

### 1. 前端未传递 coverUrl

`startDownloadFromModal()` 发送的请求体中缺少 `coverUrl`。歌曲对象 (`currentCoverSong()`) 的 `cover` 字段已包含封面 URL（来自搜索结果），但未传给后端。

**修复**: `mineradio.js` 增加 `coverUrl: song.cover || ''`

### 2. getDownloadCover 后端 API 调用参数不足

`getDownloadCover()` 调用 `/luna/pc/track_v2` 时使用了默认 `sodaTrackV2Body(trackId)`，生成的请求体不包含 `scene_name` / `queue_type` 参数，导致 API 返回不完整的 track 数据。

同时，`sodaFindCoverUrl()` 的递归搜索策略：
- 未优先搜索 `track` / `album` 等关键字段
- 未过滤掉 `/img/` 结尾的非图片 URL（如 `https://p3-luna.douyinpic.com/img/`）
- 未要求 URL 包含图片扩展名

**修复**:
- `getDownloadCover()`: 使用 `sodaTrackV2Body(trackId, {}, { scene_name: 'search', queue_type: 'search' })` 请求完整数据
- `sodaFindCoverUrl()`: 
  - 优先搜索 `track` → `album` → cover 字段
  - 要求 URL 匹配 `/\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i`
  - 过滤 `/img`、`/img/` 结尾的无效 URL

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/legacy/mineradio.js` | 前端发送 `coverUrl: song.cover` |
| `server.js` | 修复 `getDownloadCover()` API 参数 + `sodaFindCoverUrl()` 搜索策略 |

## 验证

E2E 测试结果:

```
Auth:              ✅ PASS
Download:          ✅ PASS
  - File exists       ✅
  - Format detect     ✅
  - metadata.json     ✅
  - Lyrics .lrc       ✅
  - ID3 Title         ✅
  - ID3 Artist        ✅
  - ID3 Cover art     ✅ (23954 bytes)
Failure case:      ✅ PASS
```

**32/32 PASS**
