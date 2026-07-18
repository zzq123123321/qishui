# Batch H: Download UI Integration Report

## 目标

将 Download Service 集成到播放器 UI。

## 完成的功能

### 1. 播放控制按钮

在 PlayerControls.vue actions 区域增加下载按钮（⬇ 图标），位于收藏按钮旁边。

### 2. 下载设置弹窗

点击下载按钮弹出设置弹窗，支持：

**音质选择:**
- 最佳质量 (quality=best) — Provider 最高可用
- 极高 HQ (quality=exhigh) — 320kbps
- 标准 (quality=standard) — 128kbps

**格式选择:**
- 自动 (format=auto) — 保留原始格式
- MP3 (format=mp3) — 320kbps 转码
- FLAC (format=flac) — 无损转码

默认：quality=best, format=auto

### 3. 下载状态显示

弹窗内实时显示下载进度：
- 排队中...
- 解析中...
- 下载中... 65%
- 转码中...
- 下载完成 — 6.5 MB
- 下载失败: [错误信息]

### 4. 自动资产增强

下载过程中自动：
1. 从 Provider 获取封面 URL → 下载并嵌入 MP3
2. 从 Provider 获取歌词 → 保存为 .lrc 文件
3. 生成 metadata.json（含 quality、conversion 信息）

**不依赖前端传入 coverUrl/lyricUrl。**

## API 调用

```
POST /api/download/start
{
  id: "xxx",
  source: "soda",
  quality: "best",
  format: "auto",
  name: "歌曲名",
  artist: "歌手"
}

GET /api/download/status?id=jobId
{
  status: "completed",
  progress: { phase, percent },
  fileSize: 6855710,
  outputFormat: "mp3"
}

POST /api/download/cancel
{ jobId: "xxx" }
```

## 文件产出

每次下载自动生成：
```
~/Music/Mineradio/Soda/
├── 张韶涵 - 晴天女版.mp3         (音频文件)
├── 张韶涵 - 晴天女版.metadata.json (元数据)
├── 张韶涵 - 晴天女版.lrc          (歌词)
└── 张韶涵 - 晴天女版.jpg          (封面，如有)
```

## 修改的文件

| 文件 | 变更 |
|------|------|
| `public/index.html` | 新增下载弹窗 HTML + CSS |
| `src/components/.../PlayerControls.vue` | 增加下载按钮 |
| `src/legacy/mineradio.js` | 增加下载弹窗逻辑 + API 调用 |
| `server.js` | 新增 getDownloadCover/getDownloadLyrics 自动获取 |
| `server/download/download-manager.js` | 支持自动获取封面/歌词 |
| `server/download/download-asset.js` | 支持 lyricText 直接传入 + conversion 信息 |

## 验证结果

```
✅ 下载按钮显示在播放控制栏
✅ 点击弹出下载设置弹窗
✅ 音质/格式选择正常
✅ 提交下载后显示进度
✅ 下载完成后自动关闭弹窗
✅ 歌词自动获取并保存为 .lrc
✅ metadata.json 包含 conversion 信息
```

## 项目进度

```
✅ Batch A-D: Soda Provider 模块化
✅ Batch F+G: 下载服务 + FFmpeg pipeline
✅ Batch G.5: 最高音质 + 资产增强
✅ Batch H: UI 下载按钮集成
⬜ Batch I: 文档 + E2E + 发布
```
