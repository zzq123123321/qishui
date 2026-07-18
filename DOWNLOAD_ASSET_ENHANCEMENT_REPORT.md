# Batch G.5: Music Asset Enhancement Report

## 目标

将下载文件从"裸文件"升级为完整本地音乐资产。

## 完成的功能

### 1. 最高音质下载模式

**修改前:**
```
resolveUrl(track) → 固定 quality=exhigh → MP3 320kbps
```

**修改后:**
```
resolveUrl(track, { quality: "best", format: "auto" })
  ↓
Provider 返回最高可用质量
  ↓
根据源 codec 决定输出格式
```

**质量优先级:**
```
无损 FLAC > 无损其他 > 高品质 AAC > 320kbps MP3 > 低码率
```

**format=auto 逻辑:**
- 源 FLAC → 保存 .flac（不转码）
- 源 AAC → 保存 .m4a（不转码）
- 源 MP3 → 保存 .mp3（不转码）
- 加密流 → 解密后保存 .mp3

### 2. 文件组织结构

```
~/Music/Mineradio/
├── Soda/
│   ├── 张韶涵 - 晴天女版.mp3
│   ├── 张韶涵 - 晴天女版.metadata.json
│   ├── 张韶涵 - 晴天女版.jpg        (封面)
│   └── 张韶涵 - 晴天女版.lrc        (歌词)
├── NetEase/
└── QQ/
```

### 3. metadata.json

```json
{
  "title": "晴天女版",
  "artist": "张韶涵",
  "album": "",
  "source": "soda",
  "sourceId": "7661244872816330778",
  "downloadTime": "2026-07-18T02:37:16.373Z",
  "quality": {
    "requestedFormat": "auto",
    "outputFormat": "mp3",
    "sourceCodec": "mp3",
    "sourceBitrate": 320000,
    "outputBitrate": 320000
  }
}
```

### 4. ID3 标签 (MP3 only)

使用 `node-id3` 写入:
- TIT2 (标题)
- TPE1 (艺术家)
- TALB (专辑)
- APIC (封面)
- USLT (歌词)

### 5. 封面下载

- 从 Provider 获取 cover URL
- 下载并保存为 .jpg
- 嵌入 MP3 ID3 APIC 帧

### 6. 歌词保存

- 从 Provider 获取歌词
- 保存为 .lrc 格式
- 嵌入 MP3 ID3 USLT 帧

## API 变更

### POST /api/download/start

新增字段:
```json
{
  "coverUrl": "https://...",
  "lyricUrl": "https://...",
  "format": "auto",
  "quality": "best"
}
```

### GET /api/download/status

新增字段:
```json
{
  "outputFormat": "mp3",
  "level": "lossless"
}
```

## 文件清单

| 文件 | 职责 |
|------|------|
| `server/download/download-asset.js` | 资产增强（metadata、ID3、封面、歌词） |
| `server/download/download-service.js` | 下载+转码（支持 format=auto） |
| `server/download/download-manager.js` | 任务管理+资产增强调度 |
| `server/download/download-store.js` | 持久化存储 |
| `server.js` | API 路由+resolveTrackUrlForDownload() |

## 验证结果

### Soda 下载测试
```
文件: 张韶涵 - 晴天女版.mp3
大小: 6,855,718 bytes
格式: MP3, 320kbps, stereo, 44100Hz
ID3: Title, Artist, Comment ✓
Metadata: JSON ✓
```

### Source Quality 记录
```json
{
  "sourceCodec": "mp3",
  "sourceBitrate": 320000,
  "isLossless": false
}
```

## 下一步

- Batch H: UI 下载按钮集成
- Batch I: 文档+E2E 测试+发布
