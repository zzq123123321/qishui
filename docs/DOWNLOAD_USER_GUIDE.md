# Download Feature User Guide

## Overview

Mineradio 支持将在线歌曲下载到本地，自动保存为带完整元数据的音乐文件。
下载功能集成在播放器界面中，无需额外操作。

## How to Download

### Step 1: Play a Song

在播放列表中播放任何歌曲，播放控制栏会显示当前歌曲信息。

### Step 2: Click Download Button

点击播放控制栏右下角的 **⬇** 按钮，打开下载设置弹窗。

### Step 3: Select Quality

| Quality | Description |
|---------|-------------|
| 最佳质量 (Best) | 自动选择 Provider 最高可用音质（hires → lossless → exhigh） |
| 极高 HQ | 320kbps 高质量 |
| 标准 | 128kbps 标准质量 |

### Step 4: Select Format

| Format | Description |
|--------|-------------|
| 自动 (Auto) | 保留源文件编码格式（推荐）|
| MP3 | 统一转码为 320kbps MP3 |
| FLAC | 转码为无损 FLAC |

**Format=Auto behavior:**
- 源文件为 FLAC → 保存为 `.flac`
- 源文件为 M4A/AAC → 保存为 `.m4a`
- 源文件为 MP3 → 保存为 `.mp3`
- 加密流 → 自动转码为 MP3

### Step 5: Wait for Completion

弹窗会显示实时进度：
```
排队中... → 解析中... → 下载中... 65% → 完成
```

下载完成后弹窗自动关闭。

## File Structure

下载文件保存在 `~/Music/Mineradio/`，按来源分目录：

```
~/Music/Mineradio/
├── Soda/
│   ├── 张韶涵 - 晴天女版.mp3          # 音频文件
│   ├── 张韶涵 - 晴天女版.metadata.json # 元数据
│   ├── 张韶涵 - 晴天女版.lrc          # 歌词
│   └── 张韶涵 - 晴天女版.jpg          # 封面（如有）
├── NetEase/
│   └── ...
├── QQ/
│   └── ...
└── Local/
    └── ...
```

### File Naming

```
{Artist} - {Title}.{ext}
```

文件名中的非法字符（`\ / : * ? " < > |`）会被替换为 `_`。

## Output Files

### Audio File

格式取决于 `format` 选择和源文件编码。每个文件自动嵌入 ID3 标签：

| Tag | Source |
|-----|--------|
| Title | 歌曲名 |
| Artist | 歌手 |
| Album | 专辑名 |
| APIC (Cover) | Provider 封面 |
| USLT (Lyrics) | Provider 歌词 |

### metadata.json

```json
{
  "title": "晴天女版",
  "artist": "张韶涵",
  "album": "",
  "source": "soda",
  "sourceId": "7661244872816330778",
  "downloadTime": "2026-07-18T02:50:50.789Z",
  "quality": {
    "requestedFormat": "auto",
    "outputFormat": "mp3",
    "sourceCodec": "mp3",
    "sourceBitrate": 320000,
    "outputBitrate": 320000
  },
  "conversion": {
    "converted": true,
    "from": "mp3",
    "to": "mp3"
  }
}
```

### Lyrics (.lrc)

标准 LRC 格式时间戳歌词，同步显示。

## Supported Sources

| Source | Download | Quality |
|--------|----------|---------|
| Soda (汽水音乐) | ✅ | hires / lossless / exhigh |
| QQ Music | ✅ | lossless / exhigh |
| NetEase | ✅ | hires / exhigh |
| Local | ❌ (already local) | N/A |

## Notes

- 下载需要对应 Provider 的登录状态
- 加密流（Soda 部分歌曲）需要本地客户端解码器支持
- 转码是**有损不可逆**操作，推荐使用 `format=auto` 保留原始编码
