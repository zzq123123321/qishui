# Provider Download Extension Guide

This document explains how to enable download support for a new music Provider.

## Overview

Download support requires three functions per Provider, wired into the Download Manager via `setup()`. The system handles queuing, concurrency, transcode, and asset enhancement automatically — each Provider only needs to resolve the audio URL and provide cover/lyrics metadata.

## Required Functions

### 1. `resolveUrl(song, quality, format) → { url, ... }`

Get the playable/downloadable audio URL for a track.

**Input:**
```js
song = {
  id: 'track_id',        // Provider-specific track ID
  sodaId: '',            // (soda only)
  mid: '',               // (qq only)
  name: 'Song Title',
  artist: 'Artist Name',
  album: 'Album Name',
}
quality  // 'best' | 'exhigh' | 'standard'
format   // 'auto' | 'mp3' | 'flac'
```

**Return:**
```js
{
  url: 'https://...',         // Audio URL (required)
  format: 'auto',              // Preserved or overridden format
  totalBytes: 0,               // Content-Length (0 if unknown)
  decryptionKey: '',           // Decryption key for encrypted streams
  headers: { 'Cookie': '...' }, // HTTP headers for audio download
  ffmpegHeaderText: '',         // FFmpeg -headers parameter
  userAgent: 'Mozilla/5.0...', // User-Agent for audio request
  level: 'hires',               // Quality level label
  rawQuality: 'hires',          // Original quality string
}
```

**On failure:**
```js
{ error: 'ERROR_CODE' }
```

### 2. `getCover(song) → string`

Get the cover art URL for a track.

**Input:** `song` object (same as resolveUrl)

**Return:** Cover image URL (empty string if unavailable)
```js
'https://example.com/cover.jpg'
```

### 3. `getLyrics(song) → { lyric, tlyric }`

Get the lyrics for a track.

**Input:** `song` object

**Return:**
```js
{
  lyric: '[00:00.00]Lyric text...',  // LRC format lyrics (required)
  tlyric: '[00:00.00]翻译...',       // Translation lyrics (optional)
}
```

Return `null` if lyrics are unavailable.

## Wiring into Download Manager

In `server.js`, add the three functions and pass them via `downloadManager.setup()`:

```js
async function myProviderResolveUrl(song, quality, format) {
  // Provider-specific URL resolution
  // ...
  return { url, format, totalBytes, decryptionKey, headers, ffmpegHeaderText, userAgent, level, rawQuality };
}

async function myProviderGetCover(song) {
  // Provider-specific cover retrieval
  // ...
  return coverUrl;
}

async function myProviderGetLyrics(song) {
  // Provider-specific lyrics retrieval
  // ...
  return { lyric, tlyric };
}

// Setup download manager with Provider functions
downloadManager.setup({
  resolveUrl: async (song, quality, format) => {
    const provider = song.source || '';
    if (provider === 'myprovider') return myProviderResolveUrl(song, quality, format);
    if (provider === 'soda') return resolveTrackUrlForDownload(song, quality, format);
    // ... other providers
    return { error: 'UNSUPPORTED_SOURCE' };
  },
  getCover: async (song) => {
    const provider = song.source || '';
    if (provider === 'myprovider') return myProviderGetCover(song);
    if (provider === 'soda') return getDownloadCover(song);
    return '';
  },
  getLyrics: async (song) => {
    const provider = song.source || '';
    if (provider === 'myprovider') return myProviderGetLyrics(song);
    if (provider === 'soda') return getDownloadLyrics(song);
    return null;
  },
  ffmpegPath: () => ffmpegPath,
  musicDir: () => musicDir,
  store: downloadStore,
});
```

## Provider Detection in Server Router

In `server.js`, the download start handler routes by `source`:

```js
// POST /api/download/start
const source = body.source || 'soda';
const result = downloadManager.startDownload(song, { format, quality, source });
```

The `source` field selects the output directory:

```js
// download-manager.js: getOutputDir
const sourceDir = {
  soda: 'Soda',
  netease: 'NetEase',
  qq: 'QQ',
  local: 'Local',
  myprovider: 'MyProvider',  // ← Add your provider directory
}[source] || 'Other';
```

## Frontend Integration

To make a Provider available from the UI, ensure the song object has the correct `source` property:

```js
// In mineradio.js startDownloadFromModal()
var provider = songProviderKey(song);  // returns 'soda', 'qq', 'netease', etc.
var body = {
  id: song.sodaId || song.mid || song.id || '',
  source: provider,
  // ...
};
```

`songProviderKey()` at `mineradio.js` determines the provider:

```js
function songProviderKey(song) {
  if (!song) return '';
  if (song.provider === 'soda' || song.source === 'soda' || song.type === 'soda' || song.sodaId || song.vid) return 'soda';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq' || song.mid || song.songmid) return 'qq';
  if (song.type === 'local' || song.source === 'local') return 'local';
  return 'netease';
}
```

## Reference: Existing Implementations

### Soda (汽水音乐)

- **resolveUrl**: `server.js:4328` → `resolveTrackUrlForDownload()` → `handleSodaSongUrl()` → `sodaProvider.resolvePlayback()`
- **getCover**: `server.js:4288` → `getDownloadCover()` → `sodaApiRequest('/luna/pc/track_v2')` → `sodaFindCoverUrl()`
- **getLyrics**: `server.js:4318` → `getDownloadLyrics()` → `handleSodaLyric()`

### QQ Music

- **resolveUrl**: `server.js:4367` → `handleQQSongUrl()`
- **getCover**: `server.js:4271` → `qqGetJSON('https://u.y.qq.com/cgi-bin/musicu.fcg')`
- **getLyrics**: `server.js:4318` → `getDownloadLyrics()` → `handleQQLyric()`

### NetEase

- **resolveUrl**: `server.js:4374` → `handleSongUrl()`
- **getCover**: `server.js:4279` → `handleSongUrl()` (fallback)
- **getLyrics**: `server.js:4318` → `getDownloadLyrics()` → lyric API

## Data Flow Summary

```
POST /api/download/start
        │
        ▼
downloadManager.startDownload(song, { format, quality, source })
        │
        ▼
download-manager.js: resolveUrlFn(song, quality, format)
        │
        ├─► Provider.resolveUrl()       ← You implement this
        │
        ▼
download-manager.js: getCoverFn(song)   ← You implement this
getLyricsFn(song)                        ← You implement this
        │
        ▼
download-service.js: execute()
        ├─► Direct save (no transcode)
        └─► FFmpeg transcode
        │
        ▼
download-asset.js: enhanceDownload()
        ├─► metadata.json
        ├─► ID3 tags
        ├─► Cover art
        └─► Lyrics file
        │
        ▼
~/Music/Mineradio/{ProviderDir}/
```

## Checklist for New Provider

- [ ] Implement `resolveUrl()`: resolve audio URL
- [ ] Implement `getCover()`: return cover image URL
- [ ] Implement `getLyrics()`: return lyrics text
- [ ] Add output directory in `getOutputDir()`
- [ ] Add provider detection in `songProviderKey()` (frontend)
- [ ] Wire into `downloadManager.setup()` (server)
- [ ] Test: `node tests/e2e-download.js`
