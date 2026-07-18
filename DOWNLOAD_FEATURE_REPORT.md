# Download Feature Report

## 目标

在 Mineradio 中新增音乐下载功能，支持多 Provider 音频流下载、FFmpeg 转码、格式选择。

## 约束

**禁止修改**:
- Provider 播放链路
- Auth / 登录流程
- 播放核心 (`audio` element)
- 已有 API 签名逻辑

## 架构概览

```
用户点击下载
    ↓
前端: POST /api/download/start
    ↓
Download Manager (server/download/download-manager.js)
    ↓
Provider.resolveUrl(id, quality)  ← 复用已有 handleSodaSongUrl / handleSongUrl / handleQQSongUrl
    ↓
Download Service (server/download/download-service.js)
    ├── 流式下载音频
    ├── FFmpeg 转码 (mp3/flac)
    └── 写入本地文件
    ↓
GET /api/download/status?id=xxx   ← 轮询进度
    ↓
下载完成 → GET /api/download/file?id=xxx → 触发浏览器保存
```

## 模块设计

### server/download/ 目录结构

```
server/download/
├── download-manager.js      # 下载任务管理
├── download-service.js      # 流式下载 + FFmpeg 转码
└── download-store.js        # 下载记录持久化
```

### download-manager.js

**职责**: 任务生命周期管理

```js
setup(deps)                    // 注入依赖
startDownload(song, opts)      // 创建下载任务
cancelDownload(jobId)          // 取消任务
getJobStatus(jobId)            // 查询状态
getAllJobs()                   // 查询全部任务
getFilePath(jobId)             // 获取文件路径
cleanup()                      // 清理过期任务
```

**任务状态机**:

```
queued → downloading → transcoding → completed
                  ↓            ↓
              failed       cancelled
```

**任务数据结构**:

```js
{
  id: string,              // UUID
  song: {                  // 歌曲元数据
    id, name, artist, album, cover,
    provider,              // 'netease' | 'qq' | 'soda'
    duration,
  },
  format: 'mp3' | 'flac', // 目标格式
  quality: string,         // 音质偏好
  status: string,          // 任务状态
  progress: {              // 进度
    phase: 'downloading' | 'transcoding' | 'writing',
    downloaded: number,    // 已下载字节
    total: number,         // 总字节
    percent: number,       // 0-100
  },
  filePath: string,        // 输出文件路径
  fileName: string,        // 输出文件名
  createdAt: number,       // 创建时间
  completedAt: number,     // 完成时间
  error: string,           // 错误信息
}
```

### download-service.js

**职责**: 流式下载 + FFmpeg 转码

```js
setup(deps)                    // 注入依赖
downloadAndTranscode(job)      // 执行下载+转码
```

**流程**:

```
1. 调用 Provider 获取音频 URL
   - soda: handleSodaSongUrl(id, quality)
   - netease: handleSongUrl(id, loginInfo, quality)
   - qq: handleQQSongUrl(mid, mediaMid, quality)

2. 流式下载原始音频
   - HTTP GET (支持 Range)
   - 写入临时文件

3. FFmpeg 转码
   - mp3: -codec:a libmp3lame -b:a 320k
   - flac: -codec:a flac

4. 写入目标文件
   - 文件名: {artist} - {name}.{format}
   - 目录: ~/Music/Mineradio/

5. 清理临时文件
```

**FFmpeg 参数**:

```js
// MP3
['-i', inputUrl, '-vn', '-codec:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3', outputPath]

// FLAC
['-i', inputUrl, '-vn', '-codec:a', 'flac', '-f', 'flac', outputPath]
```

**Soda 特殊处理**:
- 加密音频: 使用已有 `sodaPlaybackSessions` 获取解密密钥
- 临时复用: 创建临时播放会话 → 下载 → 销毁会话

### download-store.js

**职责**: 下载记录持久化

```js
load()                    // 加载记录
save(jobs)                // 保存记录
addJob(job)               // 添加记录
updateJob(jobId, patch)   // 更新记录
removeJob(jobId)          // 删除记录
getJob(jobId)             // 查询记录
getAllJobs()              // 查询全部
cleanup(maxAge)           // 清理过期
```

**存储位置**: `~/.mineradio/downloads.json`

## API 设计

### POST /api/download/start

**请求**:

```json
{
  "id": "track_id",
  "provider": "soda",
  "format": "mp3",
  "quality": "exhigh"
}
```

**响应**:

```json
{
  "jobId": "uuid",
  "status": "queued",
  "fileName": "Artist - Song.mp3"
}
```

### GET /api/download/status?id=jobId

**响应**:

```json
{
  "jobId": "uuid",
  "status": "downloading",
  "progress": {
    "phase": "downloading",
    "downloaded": 1048576,
    "total": 5242880,
    "percent": 20
  },
  "fileName": "Artist - Song.mp3"
}
```

### POST /api/download/cancel

**请求**:

```json
{
  "jobId": "uuid"
}
```

### GET /api/download/file?id=jobId

**响应**: 二进制文件流

```
Content-Type: audio/mpeg (mp3) / audio/flac (flac)
Content-Disposition: attachment; filename="Artist - Song.mp3"
```

### GET /api/download/list

**响应**:

```json
{
  "jobs": [
    {
      "jobId": "uuid",
      "fileName": "Artist - Song.mp3",
      "status": "completed",
      "provider": "soda",
      "createdAt": 1234567890,
      "completedAt": 1234567891
    }
  ]
}
```

## 前端集成

### 下载按钮位置

在 `PlayerControls.vue` 的 `actions` 区域，`collect-btn` 之后添加:

```html
<button id="download-btn" class="ctrl-btn" onclick="downloadCurrentTrack()" title="下载">
  <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
</button>
```

### 下载按钮逻辑 (mineradio.js)

```js
async function downloadCurrentTrack() {
  var song = playQueue[currentIdx];
  if (!song) return showToast('没有正在播放的歌曲');
  
  var provider = songProviderKey(song);
  if (provider === 'local') return showToast('本地文件不支持下载');
  
  var format = localStorage.getItem('mineradio-download-format') || 'mp3';
  var quality = effectivePlaybackQualityForProvider(playbackQuality, provider);
  
  // 弹出格式选择
  showDownloadFormatDialog(song, provider, format, quality);
}

async function startDownload(song, format, quality) {
  var data = await apiJson('/api/download/start', {
    method: 'POST',
    body: JSON.stringify({
      id: song.sodaId || song.mid || song.id,
      provider: songProviderKey(song),
      format: format,
      quality: quality
    })
  });
  
  if (data.error) return showToast(data.error);
  
  showToast('开始下载: ' + data.fileName);
  pollDownloadProgress(data.jobId);
}

function pollDownloadProgress(jobId) {
  var timer = setInterval(async function() {
    var status = await apiJson('/api/download/status?id=' + jobId);
    if (status.status === 'completed') {
      clearInterval(timer);
      showToast('下载完成: ' + status.fileName);
      // 触发浏览器保存
      window.open('/api/download/file?id=' + jobId, '_blank');
    } else if (status.status === 'failed') {
      clearInterval(timer);
      showToast('下载失败: ' + (status.error || '未知错误'));
    } else if (status.status === 'cancelled') {
      clearInterval(timer);
    }
    // 更新进度 UI
    updateDownloadProgressUI(status);
  }, 1000);
}
```

### 格式选择对话框

```js
function showDownloadFormatDialog(song, provider, currentFormat, quality) {
  // 弹出选择: MP3 (320kbps) / FLAC (无损)
  // 保存用户偏好到 localStorage
}
```

## 文件命名规则

```
~/Music/Mineradio/
├── Artist - Song.mp3
├── Artist - Song.flac
└── ...
```

**清理非法字符**: 文件名中移除 `\/:*?"<>|`

## 依赖注入

### download-manager.js

```js
const manager = require('./download-manager');

manager.setup({
  resolveUrl: resolveTrackUrl,      // 复用 Provider
  ffmpegPath: ffmpegBinaryPath,     // FFmpeg 路径
  musicDir: musicDirectory,         // 输出目录
  store: downloadStore,             // 存储层
});
```

### download-service.js

```js
const service = require('./download-service');

service.setup({
  fetch: globalThis.fetch,          // HTTP 请求
  spawn: require('child_process').spawn,  // FFmpeg
  ffmpegPath: ffmpegBinaryPath,
});
```

## 依赖方向

```
download-manager → download-service
                 → download-store
                 → Provider (复用已有)

download-service → FFmpeg
                 → fetch (HTTP)
```

**禁止**: download 模块反向依赖 server.js 或 Provider 内部实现

## 文件输出

### 默认目录

```
Windows: %USERPROFILE%\Music\Mineradio\
Mac/Linux: ~/Music/Mineradio/
```

### 自定义目录

通过环境变量:

```bash
MINERADIO_MUSIC_DIR=D:\Music\Mineradio
```

## 进度上报

### SSE 推送 (可选)

如果前端需要实时进度，可使用 Server-Sent Events:

```
GET /api/download/progress?id=jobId
```

```
event: progress
data: {"percent":45,"phase":"downloading","downloaded":2359296}

event: progress
data: {"percent":100,"phase":"transcoding"}

event: complete
data: {"fileName":"Artist - Song.mp3","filePath":"/path/to/file"}
```

### 轮询 (默认)

前端每秒轮询 `/api/download/status?id=jobId`，简单可靠。

## 安全

### 限制

- 单次下载超时: 300 秒
- 最大并发下载: 3
- 文件名长度限制: 200 字符
- 禁止路径穿越: `..` 过滤

### 日志脱敏

- 不输出完整音频 URL
- 不输出 cookie / token
- 文件路径使用相对路径

## 测试计划

### 单元测试

- download-manager: 任务状态机
- download-store: 持久化读写
- download-service: FFmpeg 参数构建

### 集成测试

- 免费歌曲下载 → MP3
- 免费歌曲下载 → FLAC
- 付费歌曲下载 → 失败处理
- 取消下载 → 资源清理
- 并发下载 → 队列管理

### E2E 测试

- `scripts/verify-download-e2e.js`
- 搜索 → 下载 → 验证文件存在 → 验证音频可播放

## 实现批次

### Batch F: Download Manager + Store

- 创建 `server/download/download-store.js`
- 创建 `server/download/download-manager.js`
- 添加 API 路由 (`/api/download/*`)
- 语法验证

### Batch G: Download Service + FFmpeg

- 创建 `server/download/download-service.js`
- 实现流式下载 + 转码
- Soda 加密音频处理
- 真实环境测试

### Batch H: UI 集成

- `PlayerControls.vue` 添加下载按钮
- `mineradio.js` 添加下载逻辑
- 格式选择对话框
- 进度显示

### Batch I: 收尾

- 文档更新
- E2E 测试脚本
- Release 打包

## 已知限制

- Soda 加密音频需临时创建播放会话
- FLAC 下载需要源音质足够高
- 下载进度依赖文件 Content-Length
- 部分歌曲可能因版权限制无法下载

## 与现有架构的关系

```
                    已有                              新增
                    ────                              ────
播放: Provider → audio element           下载: Provider → Download Service → 文件
缓存: 无                                 存储: download-store.js
UI: PlayerControls.vue                   UI: PlayerControls.vue + 下载按钮
API: /api/soda/song/url                  API: /api/download/*
```

**核心复用**: Provider.resolveUrl() 已实现，下载直接复用，不重复实现。
