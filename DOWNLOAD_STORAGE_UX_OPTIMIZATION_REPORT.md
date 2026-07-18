# 下载存储与 UX 优化报告

## 变更概述

### Part 1: Music/ 与 Songs/ 目录分离

**目标**: 音频文件与歌曲信息文件分离存储。

**变更文件**:
- `server/download/download-asset.js`
  - 新增 `getSongsDir()`、`songAssetDir()` 函数，基于音频路径和 `sourceId` 计算 Songs 目录路径
  - 封面 → `{baseDir}/Songs/{sourceId}/cover.jpg`
  - 歌词 → `{baseDir}/Songs/{sourceId}/lyrics.lrc`
  - metadata.json → `{baseDir}/Songs/{sourceId}/metadata.json`
  - 音频保持 `{baseDir}/Music/{Artist} - {Title}.mp3`，ID3 标签仍写入音频文件自身
- 未修改: `download-manager.js`（enhanceDownload 调用签名为 `{ song, filePath, ... }`，无需外部传参）

**目录结构**:
```
{baseDir}/
├── Music/
│   └── {Artist} - {Title}.mp3     ← 纯音频
└── Songs/
    └── {sourceId}/
        ├── cover.jpg
        ├── lyrics.lrc
        └── metadata.json
```

**兼容性**: 仅对新下载生效。旧版 v1.4 文件保持原地不动。

---

### Part 2: 删除按钮 + 确认弹窗

**目标**: 用户可从下载列表中删除已完成任务，同时清理磁盘文件。

**后端变更** (`server/download/download-manager.js`):
- 新增 `deleteDownload(jobId)` 函数:
  1. 删除音频文件 (`filePath`)
  2. 删除 `Songs/{sourceId}/` 整目录
  3. 从 store 移除下载记录
- 新增 `POST /api/download/delete` 路由 (`server.js`)

**前端变更** (`DownloadCenter.vue`, `DownloadCenter.scss`):
- 已完成任务行右侧新增 🗑 删除按钮
- 点击后弹出确认弹窗（`dc-job-confirm`）:
  - 文字: "确认删除文件？" + "（音频和专辑信息将被永久删除）"
  - 按钮: "取消" / "确认删除"
- 调用 `POST /api/download/delete`，成功后 `removeJob()` 从本地状态移除

**兼容性**: 
- 旧版 v1.4 文件（`{baseDir}/Music/{SourceId}/{Artist}/{Album}/{baseName}.mp3`）的删除: 由于 audio file 存在，直接删除音频；Songs dir 不存在时静默跳过（`try/catch`）。
- 旧版 flat 布局（`{baseDir}/Music/{baseName}.mp3` + co-located `.json/.jpg/.lrc`）的删除: 只删除 `filePath`，不删除 co-located assets（它们和音频同目录，deliberately not touched）。

---

### Save-location 异步加载

已于上一轮完成并验证:
- 设置面板中 `locationText` 使用 `async/await` + `fetch('/api/download/config')` 异步加载
- 加载中显示 "正在获取…"
- 失败回退 "使用默认位置"
- 打开设置面板时自动 `refreshLocation()`

---

## 验证结果

| 功能 | 结果 |
|------|------|
| `POST /api/download/delete` | ✅ 返回 `{"success":true}` |
| 文件删除 | ✅ 音频文件已从磁盘移除 |
| 记录删除 | ✅ 列表已移除对应 jobId |
| 保留同 sourceId 其他任务 | ✅ 不同的 jobId 不受影响 |
| 不存在的 Songs 目录 | ✅ 静默跳过（try/catch） |
| 语法检查 (`node --check`) | ✅ 全部通过 |
| Build | ✅ vite 编译成功 |
| Install | ✅ NSIS 安装成功 |
| Launch | ✅ Mineradio 启动正常 |
| 服务器 API | ✅ 端口 3000 正常运行 |

## 未修改区域

- Provider、Auth、Download API（`startDownload`/`cancelDownload`/`status`）
- FFmpeg 转码流程
- 播放核心
- `electron/main.cjs` IPC（新增 `mineradio-delete-download` IPC 不需要，使用 HTTP API）
- `electron/preload.js`
- 旧版下载文件（不移动、不删除、不迁移）
