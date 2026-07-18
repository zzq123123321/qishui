'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const MAX_CONCURRENT = 3;
const DOWNLOAD_TIMEOUT_MS = 300000;

let resolveUrlFn = null;
let ffmpegPathFn = null;
let musicDirFn = null;
let store = null;
let getCoverFn = null;
let getLyricsFn = null;

let activeJobs = new Map();
let queue = [];

function generateJobId() {
  return 'dl_' + crypto.randomBytes(8).toString('hex');
}

function safeFileName(name) {
  return String(name || 'Unknown')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function getOutputDir(source) {
  const base = musicDirFn ? musicDirFn() : path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    'Music', 'Mineradio'
  );
  const sourceDir = {
    soda: 'Soda',
    netease: 'NetEase',
    qq: 'QQ',
    local: 'Local',
  }[source] || 'Other';
  const dir = path.join(base, sourceDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function buildBaseName(song) {
  const artist = safeFileName(song.artist || 'Unknown');
  const title = safeFileName(song.name || 'Unknown');
  return `${artist} - ${title}`;
}

function setup(deps) {
  if (!deps) return;
  resolveUrlFn = deps.resolveUrl || null;
  ffmpegPathFn = deps.ffmpegPath || null;
  musicDirFn = deps.musicDir || null;
  store = deps.store || null;
  getCoverFn = deps.getCover || null;
  getLyricsFn = deps.getLyrics || null;
}

function getJobStatus(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    return {
      id: job.id,
      source: job.source,
      sourceId: job.sourceId,
      title: job.title,
      artist: job.artist,
      quality: job.quality,
      format: job.format,
      status: job.status,
      progress: { ...job.progress },
      fileName: job.fileName,
      filePath: job.filePath,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      fileSize: job.fileSize,
      error: job.error || '',
      sourceQuality: job.sourceQuality || null,
      outputFormat: job.outputFormat || '',
      level: job.level || '',
    };
  }
  if (store) {
    const saved = store.getJob(jobId);
    if (saved) {
      return {
        id: saved.id,
        source: saved.source,
        sourceId: saved.sourceId,
        title: saved.title,
        artist: saved.artist,
        quality: saved.quality || '',
        format: saved.format || '',
        status: saved.status,
        progress: { phase: saved.status, downloaded: 0, total: 0, percent: saved.status === 'completed' ? 100 : 0 },
        fileName: saved.fileName,
        filePath: saved.filePath,
        createdAt: saved.createdAt,
        completedAt: saved.completedAt,
        fileSize: saved.fileSize,
        error: saved.error || '',
        sourceQuality: saved.sourceQuality || null,
        outputFormat: saved.outputFormat || '',
        level: saved.level || '',
      };
    }
  }
  return null;
}

function getAllJobs() {
  if (!store) return [];
  return store.getAllJobs().map(j => ({
    id: j.id,
    source: j.source,
    sourceId: j.sourceId,
    title: j.title,
    artist: j.artist,
    quality: j.quality || '',
    format: j.format || '',
    status: j.status,
    fileName: j.fileName,
    filePath: j.filePath,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
    fileSize: j.fileSize,
    error: j.error || '',
  }));
}

function getFilePath(jobId) {
  const job = activeJobs.get(jobId);
  if (job && job.filePath && job.status === 'completed') return job.filePath;
  if (store) {
    const saved = store.getJob(jobId);
    if (saved && saved.filePath && saved.status === 'completed') return saved.filePath;
  }
  return null;
}

function startDownload(song, opts) {
  opts = opts || {};
  const format = opts.format || 'auto';
  const quality = opts.quality || 'best';
  const source = opts.source || '';

  const activeCount = Array.from(activeJobs.values()).filter(j => j.status === 'downloading' || j.status === 'resolving' || j.status === 'transcoding').length;
  if (activeCount >= MAX_CONCURRENT) {
    return { error: 'MAX_CONCURRENT_REACHED', message: '下载队列已满，请稍后重试' };
  }

  const jobId = generateJobId();
  const baseName = buildBaseName(song);
  const outputDir = getOutputDir(source);

  const job = {
    id: jobId,
    source,
    sourceId: song.sodaId || song.mid || song.id || '',
    title: song.name || '',
    artist: song.artist || '',
    album: song.album || '',
    quality,
    format,
    status: 'queued',
    progress: { phase: 'queued', downloaded: 0, total: 0, percent: 0 },
    baseName,
    fileName: baseName + '.mp3',
    filePath: path.join(outputDir, baseName + '.mp3'),
    createdAt: Date.now(),
    completedAt: 0,
    fileSize: 0,
    error: '',
    song,
    _abort: false,
    outputFormat: '',
    level: '',
  };

  activeJobs.set(jobId, job);

  if (store) {
    store.addJob({
      id: jobId,
      source,
      sourceId: job.sourceId,
      title: job.title,
      artist: job.artist,
      album: job.album,
      quality,
      format,
      status: 'queued',
      filePath: job.filePath,
      fileName: job.fileName,
      createdAt: job.createdAt,
    });
  }

  processNextJob(job);

  return {
    jobId,
    status: 'queued',
    fileName: job.fileName,
  };
}

function cancelDownload(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return false;
  job._abort = true;
  job.status = 'cancelled';
  job.error = 'Cancelled by user';
  if (store) store.updateJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
  return true;
}

function managerLog(jobId, tag, data) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[DL-MGR] ${ts} [${jobId}] ${tag}`, typeof data === 'string' ? data : JSON.stringify(data));
}

async function processNextJob(job) {
  try {
    job.status = 'resolving';
    job.progress = { phase: 'resolving', downloaded: 0, total: 0, percent: 0 };
    if (store) store.updateJob(job.id, { status: 'resolving' });
    managerLog(job.id, 'RESOLVE', { source: job.source, sourceId: job.sourceId, quality: job.quality, format: job.format });

    if (!resolveUrlFn) throw new Error('resolveUrl not configured');
    const urlResult = await resolveUrlFn(job.song, job.quality, job.format);

    if (!urlResult || !urlResult.url) {
      const errMsg = urlResult && urlResult.error ? urlResult.error : 'URL_UNAVAILABLE';
      managerLog(job.id, 'RESOLVE_FAIL', { error: errMsg });
      throw new Error(errMsg);
    }

    managerLog(job.id, 'RESOLVED', {
      urlLen: urlResult.url.length,
      urlPrefix: urlResult.url.substring(0, 80),
      format: urlResult.format,
      level: urlResult.level || '',
      rawQuality: urlResult.rawQuality || '',
      hasHeaders: !!(urlResult.headers && urlResult.headers['Cookie']),
    });

    if (job._abort) return;

    job.audioUrl = urlResult.url;
    job.totalBytes = urlResult.totalBytes || 0;
    job.audioFormat = urlResult.format || '';
    job.decryptionKey = urlResult.decryptionKey || '';
    job.headers = urlResult.headers || {};
    job.ffmpegHeaderText = urlResult.ffmpegHeaderText || '';
    job.userAgent = urlResult.userAgent || '';
    job.level = urlResult.level || '';

    if (!job.song.coverUrl && getCoverFn) {
      try {
        const coverUrl = await getCoverFn(job.song);
        if (coverUrl) {
          job.song.coverUrl = coverUrl;
          managerLog(job.id, 'COVER_FETCHED', { url: coverUrl.substring(0, 80) });
        }
      } catch (e) {
        managerLog(job.id, 'COVER_ERR', { error: e.message });
      }
    }

    if (!job.song.lyricUrl && getLyricsFn) {
      try {
        const lyricData = await getLyricsFn(job.song);
        if (lyricData && lyricData.lyric) {
          job.song.lyricText = lyricData.lyric;
          job.song.tlyricText = lyricData.tlyric || '';
          managerLog(job.id, 'LYRIC_FETCHED', { length: lyricData.lyric.length });
        }
      } catch (e) {
        managerLog(job.id, 'LYRIC_ERR', { error: e.message });
      }
    }

    if (typeof emitDownloadEvent === 'function') {
      emitDownloadEvent('start', job);
    }

    await downloadAndTranscode(job);

  } catch (e) {
    if (job._abort) return;
    job.status = 'failed';
    job.error = e.message || String(e);
    job.completedAt = Date.now();
    managerLog(job.id, 'FAILED', { error: job.error });
    if (store) store.updateJob(job.id, { status: 'failed', error: job.error, completedAt: job.completedAt });
  }
}

async function downloadAndTranscode(job) {
  const downloadService = require('./download-service');

  job.status = 'downloading';
  job.progress = { phase: 'downloading', downloaded: 0, total: job.totalBytes || 0, percent: 0 };
  if (store) store.updateJob(job.id, { status: 'downloading' });
  managerLog(job.id, 'DOWNLOAD_START', { url: job.audioUrl ? job.audioUrl.substring(0, 80) : 'null', format: job.format, level: job.level });

  const result = await downloadService.execute({
    audioUrl: job.audioUrl,
    format: job.format,
    filePath: job.filePath,
    baseName: job.baseName,
    decryptionKey: job.decryptionKey,
    ffmpegPath: ffmpegPathFn ? ffmpegPathFn() : '',
    headers: job.headers || {},
    ffmpegHeaderText: job.ffmpegHeaderText || '',
    userAgent: job.userAgent || '',
    onProgress: (progress) => {
      job.progress = progress;
      if (progress.sourceQuality) {
        job.sourceQuality = progress.sourceQuality;
      }
    },
    abortCheck: () => job._abort,
  });

  if (job._abort) return;

  if (result && result.success) {
    job.status = 'completed';
    job.completedAt = Date.now();
    job.fileSize = result.fileSize || 0;
    job.sourceQuality = result.sourceQuality || job.sourceQuality || null;
    job.outputFormat = result.outputFormat || '';
    job.filePath = result.filePath || job.filePath;
    job.fileName = path.basename(job.filePath);
    job.progress = { phase: 'completed', downloaded: result.fileSize || 0, total: result.fileSize || 0, percent: 100 };
    managerLog(job.id, 'DOWNLOAD_OK', {
      fileSize: job.fileSize,
      filePath: job.filePath,
      outputFormat: job.outputFormat,
      sourceCodec: job.sourceQuality ? job.sourceQuality.codec : 'unknown',
    });

    try {
      const assetEnhancer = require('./download-asset');
      const assetResult = await assetEnhancer.enhanceDownload({
        song: job.song,
        filePath: job.filePath,
        source: job.source,
        sourceQuality: job.sourceQuality,
        format: job.format,
        converted: result.converted || false,
        outputFormat: result.outputFormat || '',
        headers: job.headers || {},
      });
      if (assetResult && assetResult.success) {
        managerLog(job.id, 'ASSET_OK', {
          metadata: assetResult.metadataPath ? 'YES' : 'NO',
          cover: assetResult.coverPath ? 'YES' : 'NO',
          lyric: assetResult.lyricPath ? 'YES' : 'NO',
        });
      }
    } catch (assetErr) {
      managerLog(job.id, 'ASSET_ERR', { error: assetErr.message });
    }

    if (store) store.updateJob(job.id, {
      status: 'completed',
      completedAt: job.completedAt,
      fileSize: job.fileSize,
      sourceQuality: job.sourceQuality,
      outputFormat: job.outputFormat,
      filePath: job.filePath,
      fileName: job.fileName,
    });
  } else {
    const errMsg = result && result.error ? result.error : 'DOWNLOAD_FAILED';
    managerLog(job.id, 'DOWNLOAD_FAIL', { error: errMsg });
    throw new Error(errMsg);
  }
}

function cleanup(maxAgeMs) {
  if (store) store.cleanup(maxAgeMs);
  for (const [id, job] of activeJobs) {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      activeJobs.delete(id);
    }
  }
}

function emitDownloadEvent(type, job) {
}

module.exports = {
  setup,
  startDownload,
  cancelDownload,
  getJobStatus,
  getAllJobs,
  getFilePath,
  cleanup,
};
