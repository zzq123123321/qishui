# Download Feature Architecture

## System Overview

```
UI (PlayerControls.vue / mineradio.js)
        │
        │ POST /api/download/start
        ▼
server.js (Router)
        │
        ├──► downloadManager.startDownload()
        │
        ▼
Download Manager (download-manager.js)
        │
        ├──► resolveUrlFn (Provider → audio URL)
        ├──► getCoverFn → cover URL
        ├──► getLyricsFn → lyric text
        │
        ▼
Download Service (download-service.js)
        │
        ├──► format=auto & no encryption → HTTP direct save
        ├──► format=auto & encrypted → FFmpeg transcode
        ├──► format=mp3 → FFmpeg transcode to 320kbps MP3
        └──► format=flac → FFmpeg transcode to FLAC
        │
        ▼
Asset Enhancement (download-asset.js)
        │
        ├──► metadata.json
        ├──► ID3 tags (node-id3)
        ├──► Cover art (HTTP download)
        └──► Lyrics (.lrc)
        │
        ▼
~/Music/Mineradio/{Source}/
```

## Module Details

### 1. Download Manager (`server/download/download-manager.js`)

**Lifecycle:**
```
queue → queued
          ↓
     resolving (Provider.resolveUrl)
          ↓
     getCover + getLyrics (auto-fetch)
          ↓
     downloading / transcoding
          ↓
     enhancing (asset enhancement)
          ↓
     completed / failed / cancelled
```

**Job Status Machine:**

| Status | Description |
|--------|-------------|
| `queued` | 任务已创建，等待调度 |
| `resolving` | 正在解析音频 URL |
| `downloading` | 正在下载/转码 |
| `completed` | 下载完成 |
| `failed` | 下载失败（含错误信息）|
| `cancelled` | 用户取消 |

**Concurrency:** 最多 3 个任务同时执行。

**Dependencies (via `setup()`):**

```js
downloadManager.setup({
  resolveUrl: resolveTrackUrlForDownload,   // Provider URL resolution
  ffmpegPath: () => ffmpegPath,             // FFmpeg binary path
  musicDir: () => musicDir,                  // Output base directory
  store: downloadStore,                      // Persistence store
  getCover: getDownloadCover,                // Auto-fetch cover
  getLyrics: getDownloadLyrics,              // Auto-fetch lyrics
});
```

### 2. Download Service (`server/download/download-service.js`)

Responsible for audio file acquisition:

**`execute(opts)`:**
```js
{
  audioUrl,        // Resolved audio URL
  format,          // 'auto' | 'mp3' | 'flac'
  filePath,        // Output path
  decryptionKey,   // Decryption key (encrypted streams)
  ffmpegPath,      // FFmpeg binary
  headers,         // HTTP headers (Cookie, etc.)
  ffmpegHeaderText,// FFmpeg -headers text
  userAgent,       // User-Agent
}
```

**Two paths:**

- **Direct save** (format=auto, no encryption) — HTTP GET → stream to file
- **FFmpeg transcode** (encrypted or format override) — `ffmpeg -i <url> -c:a libmp3lame -b:a 320k <output>`

**Format Resolution (`resolveOutputFormat`):**

```
format=flac     → { ext: 'flac', codec: 'flac', needsTranscode: true }
format=mp3      → { ext: 'mp3', codec: 'mp3', needsTranscode: true }
format=auto     →
  ├── URL ends in .flac, no key → { ext: 'flac', needsTranscode: false }
  ├── URL ends in .m4a, no key  → { ext: 'm4a', needsTranscode: false }
  ├── URL ends in .mp3, no key  → { ext: 'mp3', needsTranscode: false }
  └── encrypted (has key)       → { ext: 'mp3', needsTranscode: true }
```

### 3. Asset Enhancement (`server/download/download-asset.js`)

After audio download completes:

| Asset | Output | Method |
|-------|--------|--------|
| metadata.json | `{title, artist, album, source, sourceId, downloadTime, quality, conversion}` | `fs.writeFileSync` |
| ID3 tags | Embedded in MP3 (Title, Artist, Album, Cover, Lyrics) | `node-id3.write()` |
| Cover image | `.jpg` file + ID3 APIC frame | HTTP download via `downloadUrl()` |
| Lyrics | `.lrc` file + ID3 USLT frame | Text file + ID3 frame |

**Cover priority:**
1. `song.coverUrl` (from frontend or auto-fetch)
2. Provider API fallback (`getDownloadCover`)

**Lyrics priority:**
1. `song.lyricText` (from auto-fetch)
2. `song.lyricUrl` (download from URL)
3. Provider API fallback (`getDownloadLyrics`)

**metadata.json schema:**
```json
{
  "title": "string",
  "artist": "string",
  "album": "string",
  "source": "soda|netease|qq",
  "sourceId": "string",
  "downloadTime": "ISO 8601",
  "quality": {
    "requestedFormat": "auto|mp3|flac",
    "outputFormat": "mp3|flac|m4a",
    "sourceCodec": "mp3|flac|aac",
    "sourceBitrate": 320000,
    "outputBitrate": 320000
  },
  "conversion": {
    "converted": true|false,
    "from": "codec",
    "to": "codec"
  }
}
```

## API Reference

### `POST /api/download/start`

Start a new download job.

**Request:**
```json
{
  "id": "track_id",
  "source": "soda|netease|qq",
  "quality": "best|exhigh|standard",
  "format": "auto|mp3|flac",
  "name": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "coverUrl": "https://..."  // optional, auto-fetched if empty
}
```

**Response:**
```json
{
  "jobId": "dl_abc123",
  "status": "queued",
  "fileName": "Artist - Title.mp3"
}
```

### `GET /api/download/status?id={jobId}`

**Response:**
```json
{
  "id": "dl_abc123",
  "source": "soda",
  "title": "晴天女版",
  "artist": "张韶涵",
  "status": "completed",
  "progress": { "phase": "completed", "percent": 100 },
  "filePath": "~/Music/Mineradio/Soda/张韶涵 - 晴天女版.mp3",
  "fileSize": 6855718,
  "outputFormat": "mp3",
  "error": ""
}
```

### `POST /api/download/cancel`

Cancel an active job.

**Request:** `{ "jobId": "dl_abc123" }`
**Response:** `{ "success": true }`

### `GET /api/download/file?id={jobId}`

Download the completed audio file.

**Response:** Binary audio stream with `Content-Disposition: attachment`.

### `GET /api/download/list`

List all download jobs.

**Response:** `{ "jobs": [...] }`

## State Diagram

```
         ┌──────────┐
         │  queued   │
         └────┬─────┘
              │
         ┌────▼─────┐
         │ resolving│ ← Provider.resolveUrl()
         └────┬─────┘
              │
         ┌────▼────────┐
         │ downloading │ ← HTTP / FFmpeg
         │ transcoding │
         └────┬────────┘
              │
         ┌────▼────────┐
         │  enhancing  │ ← metadata + ID3 + cover + lyrics
         └────┬────────┘
              │
    ┌─────────┼──────────┐
    │         │          │
    ▼         ▼          ▼
 completed  failed   cancelled
```

## File Structure

```
server/download/
├── download-store.js       # Persistence (JSON file)
├── download-manager.js     # Task orchestration
├── download-service.js     # HTTP/FFmpeg execution
└── download-asset.js       # Asset enhancement

tests/
└── e2e-download.js         # E2E test (32 checks)

src/legacy/mineradio.js     # Frontend download modal UI
src/components/.../PlayerControls.vue  # Download button
```

## Key Design Decisions

1. **format=auto preserves source** — FLAC stays FLAC, AAC stays M4A; only encrypted streams are transcoded
2. **Cover/lyrics auto-fetch** — backend retrieves from Provider; frontend does not need to pass URLs
3. **Windows EXDEV handling** — `fs.renameSync` fallback to copy+delete across drives
4. **Quality=best** resolves to Provider's highest available (`hires` > `lossless` > `exhigh`)
5. **Node-id3 for ID3 tags** — writes Title, Artist, Album, Cover (APIC), Lyrics (USLT)
