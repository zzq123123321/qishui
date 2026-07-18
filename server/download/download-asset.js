'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let NodeID3 = null;
try { NodeID3 = require('node-id3'); } catch (e) {}

function assetLog(tag, data) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[DL-ASSET] ${ts} [${tag}]`, typeof data === 'string' ? data : JSON.stringify(data));
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadUrl(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.qishui.com/',
        ...headers,
      },
      timeout: timeoutMs || 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadUrl(res.headers.location, headers, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP_' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        resolve({ data: Buffer.concat(chunks), contentType });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

function writeMetadataJson(dir, baseName, meta) {
  const filePath = path.join(dir, baseName + '.metadata.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf8');
    assetLog('METADATA', { path: filePath });
    return filePath;
  } catch (e) {
    assetLog('METADATA_ERR', { error: e.message });
    return '';
  }
}

function writeId3Tags(filePath, tags) {
  if (!NodeID3) {
    assetLog('ID3_SKIP', { reason: 'node-id3 not available' });
    return false;
  }
  try {
    const id3Tags = {};
    if (tags.title) id3Tags.title = tags.title;
    if (tags.artist) id3Tags.artist = tags.artist;
    if (tags.album) id3Tags.album = tags.album;
    if (tags.year) id3Tags.year = String(tags.year);
    if (tags.genre) id3Tags.genre = tags.genre;
    if (tags.comment) id3Tags.comment = { language: 'chi', shortText: '', text: tags.comment };
    if (tags.lyric) id3Tags.unsynchronizedLyrics = { language: 'chi', shortText: '', text: tags.lyric };
    if (tags.coverBuffer) {
      id3Tags.image = {
        mime: tags.coverContentType || 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: tags.coverBuffer,
      };
    }
    const result = NodeID3.write(id3Tags, filePath);
    assetLog('ID3', { path: filePath, fields: Object.keys(id3Tags).join(','), success: result === true || result === undefined });
    return result === true || result === undefined;
  } catch (e) {
    assetLog('ID3_ERR', { error: e.message });
    return false;
  }
}

async function downloadCover(coverUrl, headers) {
  if (!coverUrl) return null;
  try {
    const result = await downloadUrl(coverUrl, headers, 10000);
    if (result.data && result.data.length > 1000) {
      assetLog('COVER', { size: result.data.length, contentType: result.contentType });
      return { buffer: result.data, contentType: result.contentType || 'image/jpeg' };
    }
    return null;
  } catch (e) {
    assetLog('COVER_ERR', { error: e.message, url: coverUrl.substring(0, 80) });
    return null;
  }
}

async function downloadLyric(lyricUrl, headers) {
  if (!lyricUrl) return '';
  try {
    const result = await downloadUrl(lyricUrl, headers, 10000);
    if (result.data) {
      const text = result.data.toString('utf8');
      assetLog('LYRIC', { size: text.length });
      return text;
    }
    return '';
  } catch (e) {
    assetLog('LYRIC_ERR', { error: e.message });
    return '';
  }
}

function writeLyricFile(dir, baseName, lyricText) {
  if (!lyricText) return '';
  const filePath = path.join(dir, baseName + '.lrc');
  try {
    fs.writeFileSync(filePath, lyricText, 'utf8');
    assetLog('LYRIC_FILE', { path: filePath, size: lyricText.length });
    return filePath;
  } catch (e) {
    assetLog('LYRIC_FILE_ERR', { error: e.message });
    return '';
  }
}

function safeFileName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '';
}

function getBaseDir(filePath) {
  return path.dirname(path.dirname(filePath));
}

function songAssetDir(filePath, sourceId, title) {
  const baseDir = getBaseDir(filePath);
  const safeTitle = safeFileName(title);
  const dirName = sourceId ? (sourceId + (safeTitle ? '_' + safeTitle : '')) : (safeTitle || 'unknown');
  return path.join(baseDir, 'Songs', dirName);
}

async function enhanceDownload(job, opts) {
  opts = opts || {};
  const { song, filePath, source, sourceQuality, headers } = job;
  if (!filePath || !fs.existsSync(filePath)) {
    assetLog('SKIP', { reason: 'file not found', filePath });
    return { success: false, error: 'FILE_NOT_FOUND' };
  }

  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath);
  const outputExt = ext.replace('.', '');
  const audioHeaders = headers || {};
  const sourceId = (song && (song.sodaId || song.mid || song.id)) || '';

  const assetsDir = songAssetDir(filePath, sourceId, song.name);

  assetLog('START', { file: path.basename(filePath), dir, songsDir: assetsDir, source });

  const baseDir = getBaseDir(filePath);
  const mediaPath = path.relative(baseDir, filePath);
  const assetPath = path.relative(baseDir, assetsDir);

  const metadata = {
    title: song.name || 'Unknown',
    artist: song.artist || 'Unknown',
    album: song.album || '',
    source,
    sourceId: sourceId,
    mediaPath: mediaPath.replace(/\\/g, '/'),
    assetPath: assetPath.replace(/\\/g, '/') + '/',
    downloadTime: new Date().toISOString(),
    quality: {
      requestedFormat: job.format || 'auto',
      outputFormat: outputExt,
      sourceCodec: (sourceQuality && sourceQuality.codec) || 'unknown',
      sourceBitrate: (sourceQuality && sourceQuality.bitrate) || 0,
      outputBitrate: 320000,
    },
    conversion: {
      converted: job.converted || false,
      from: (sourceQuality && sourceQuality.codec) || 'unknown',
      to: outputExt,
    },
  };

  let coverInfo = null;
  if (song.coverUrl) {
    coverInfo = await downloadCover(song.coverUrl, audioHeaders);
  }

  let lyricText = '';
  if (song.lyricText) {
    lyricText = song.lyricText;
    assetLog('LYRIC', { source: 'inline', size: lyricText.length });
  } else if (song.lyricUrl) {
    lyricText = await downloadLyric(song.lyricUrl, audioHeaders);
  }

  if (ext === '.mp3') {
    const id3Tags = {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      comment: `Downloaded from ${source} by Mineradio`,
      lyric: lyricText || '',
    };
    if (coverInfo) {
      id3Tags.coverBuffer = coverInfo.buffer;
      id3Tags.coverContentType = coverInfo.contentType;
    }
    writeId3Tags(filePath, id3Tags);
  }

  ensureDir(assetsDir);

  let coverPath = '';
  if (coverInfo && coverInfo.buffer) {
    coverPath = path.join(assetsDir, 'cover.jpg');
    try {
      fs.writeFileSync(coverPath, coverInfo.buffer);
      assetLog('COVER_FILE', { path: coverPath, size: coverInfo.buffer.length });
    } catch (e) {
      assetLog('COVER_FILE_ERR', { error: e.message });
      coverPath = '';
    }
  }

  let lyricPath = '';
  if (lyricText) {
    lyricPath = path.join(assetsDir, 'lyrics.lrc');
    try {
      fs.writeFileSync(lyricPath, lyricText, 'utf8');
      assetLog('LYRIC_FILE', { path: lyricPath, size: lyricText.length });
    } catch (e) {
      assetLog('LYRIC_FILE_ERR', { error: e.message });
      lyricPath = '';
    }
  }

  let metaPath = '';
  try {
    metaPath = path.join(assetsDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
    assetLog('METADATA', { path: metaPath });
  } catch (e) {
    assetLog('METADATA_ERR', { error: e.message });
    metaPath = '';
  }

  assetLog('DONE', {
    audio: path.basename(filePath),
    metadata: metaPath ? 'YES' : 'NO',
    cover: coverPath ? 'YES' : 'NO',
    lyric: lyricPath ? 'YES' : 'NO',
    id3: ext === '.mp3' ? 'YES' : 'SKIPPED',
    songsDir: assetsDir,
  });

  return {
    success: true,
    metadataPath: metaPath,
    coverPath,
    lyricPath,
    metadata,
    songsDir: assetsDir,
  };
}

module.exports = {
  enhanceDownload,
  writeMetadataJson,
  writeId3Tags,
  downloadCover,
  downloadLyric,
  writeLyricFile,
};
