'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpFilePath() {
  return path.join(os.tmpdir(), 'mineradio_dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
}

function ffmpegAvailable(ffmpegPath) {
  return !!(ffmpegPath && fs.existsSync(ffmpegPath));
}

function downloadLog(tag, data) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[DL-${tag}] ${ts}`, typeof data === 'string' ? data : JSON.stringify(data));
}

function detectSourceCodecFromUrl(audioUrl) {
  const lower = String(audioUrl || '').toLowerCase();
  if (/\.(flac)(?:[?#]|$)/i.test(lower)) return { codec: 'flac', ext: 'flac', isLossless: true };
  if (/\.(m4a|aac)(?:[?#]|$)/i.test(lower)) return { codec: 'aac', ext: 'm4a', isLossless: false };
  if (/\.(mp3)(?:[?#]|$)/i.test(lower)) return { codec: 'mp3', ext: 'mp3', isLossless: false };
  if (/\.(ogg)(?:[?#]|$)/i.test(lower)) return { codec: 'ogg', ext: 'ogg', isLossless: false };
  if (/\.(wav)(?:[?#]|$)/i.test(lower)) return { codec: 'wav', ext: 'wav', isLossless: true };
  if (/\.(mp4|m4v)(?:[?#]|$)/i.test(lower)) return { codec: 'aac', ext: 'm4a', isLossless: false };
  return null;
}

function resolveOutputFormat(requestedFormat, audioUrl, decryptionKey) {
  if (requestedFormat === 'flac') {
    return { ext: 'flac', codec: 'flac', container: 'flac', needsTranscode: true };
  }
  if (requestedFormat === 'mp3') {
    return { ext: 'mp3', codec: 'mp3', container: 'mp3', needsTranscode: true };
  }

  const detected = detectSourceCodecFromUrl(audioUrl);
  if (detected && !decryptionKey) {
    return {
      ext: detected.ext,
      codec: detected.codec,
      container: detected.ext,
      needsTranscode: false,
      isLossless: detected.isLossless,
    };
  }

  if (decryptionKey) {
    return { ext: 'mp3', codec: 'mp3', container: 'mp3', needsTranscode: true };
  }

  return { ext: 'mp3', codec: 'mp3', container: 'mp3', needsTranscode: true };
}

function buildFfmpegArgs(audioUrl, outputTmpPath, outputFormat, decryptionKey, opts) {
  const { ffmpegHeaderText, userAgent } = opts || {};
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-user_agent', userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '-referer', 'https://www.qishui.com/',
  ];

  if (ffmpegHeaderText) {
    args.push('-headers', ffmpegHeaderText);
  }

  if (decryptionKey) {
    args.push('-decryption_key', decryptionKey);
  }

  args.push('-i', audioUrl);
  args.push('-vn');

  if (outputFormat.needsTranscode) {
    if (outputFormat.codec === 'flac') {
      args.push('-codec:a', 'flac');
      args.push('-f', 'flac');
    } else {
      args.push('-codec:a', 'libmp3lame');
      args.push('-b:a', '320k');
      args.push('-f', 'mp3');
    }
  }

  args.push(outputTmpPath);
  return args;
}

function execute(opts) {
  const {
    audioUrl,
    format,
    filePath,
    baseName,
    decryptionKey,
    ffmpegPath,
    onProgress,
    abortCheck,
    headers,
    ffmpegHeaderText,
    userAgent,
  } = opts;

  if (!audioUrl) {
    downloadLog('ERROR', { error: 'NO_AUDIO_URL' });
    return Promise.resolve({ success: false, error: 'NO_AUDIO_URL' });
  }
  if (!ffmpegAvailable(ffmpegPath)) {
    downloadLog('ERROR', { error: 'FFMPEG_UNAVAILABLE', ffmpegPath });
    return Promise.resolve({ success: false, error: 'FFMPEG_UNAVAILABLE' });
  }

  const outputFormat = resolveOutputFormat(format || 'auto', audioUrl, decryptionKey);
  const finalExt = '.' + outputFormat.ext;
  const finalPath = filePath.replace(/\.[^.]+$/, finalExt);
  const tmpOutput = tmpFilePath() + '.' + outputFormat.ext;

  downloadLog('START', {
    audioUrl: audioUrl.substring(0, 120) + (audioUrl.length > 120 ? '...' : ''),
    requestedFormat: format,
    resolvedFormat: outputFormat.ext,
    needsTranscode: outputFormat.needsTranscode,
    output: finalPath,
    hasCookie: !!(headers && headers['Cookie']),
  });

  return new Promise((resolve) => {
    if (abortCheck && abortCheck()) {
      downloadLog('ABORT', { phase: 'pre-start' });
      resolve({ success: false, error: 'ABORTED' });
      return;
    }

    if (!outputFormat.needsTranscode) {
      downloadLog('DIRECT_SAVE', { reason: 'source format preserved', ext: outputFormat.ext });
      downloadDirect(audioUrl, tmpOutput, { ffmpegHeaderText, userAgent, decryptionKey }, onProgress, abortCheck)
        .then((result) => {
          if (abortCheck && abortCheck()) {
            safeUnlink(tmpOutput);
            resolve({ success: false, error: 'ABORTED' });
            return;
          }
          if (!result.success) {
            resolve(result);
            return;
          }
          moveFile(tmpOutput, finalPath);
          downloadLog('SUCCESS', { filePath: finalPath, fileSize: result.fileSize, format: outputFormat.ext });
          if (onProgress) {
            onProgress({
              phase: 'completed',
              downloaded: result.fileSize,
              total: result.fileSize,
              percent: 100,
              sourceQuality: result.sourceQuality,
              converted: false,
            });
          }
          resolve({
            success: true,
            filePath: finalPath,
            fileSize: result.fileSize,
            outputFormat: outputFormat.ext,
            sourceQuality: result.sourceQuality,
            converted: false,
          });
        })
        .catch((e) => {
          safeUnlink(tmpOutput);
          downloadLog('ERROR', { error: e.message });
          resolve({ success: false, error: e.message });
        });
      return;
    }

    const args = buildFfmpegArgs(audioUrl, tmpOutput, outputFormat, decryptionKey, { ffmpegHeaderText, userAgent });

    downloadLog('FFMPEG', {
      args: args.slice(0, 5).join(' ') + ' ...',
      outputFormat: outputFormat.ext,
    });

    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let killed = false;
    let totalBytesOutput = 0;

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.stdout.on('data', (chunk) => {
      totalBytesOutput += chunk.length;
      if (onProgress) {
        onProgress({
          phase: 'transcoding',
          downloaded: totalBytesOutput,
          total: 0,
          percent: 0,
        });
      }
    });

    if (abortCheck) {
      const checkTimer = setInterval(() => {
        if (abortCheck()) {
          killed = true;
          try { child.kill('SIGKILL'); } catch (e) {}
          clearInterval(checkTimer);
        }
      }, 500);
      child.on('close', () => clearInterval(checkTimer));
    }

    child.on('error', err => {
      safeUnlink(tmpOutput);
      downloadLog('ERROR', { error: err.message });
      if (!killed) resolve({ success: false, error: err.message });
    });

    child.on('close', code => {
      if (killed) {
        safeUnlink(tmpOutput);
        downloadLog('ABORT', { phase: 'transcoding' });
        resolve({ success: false, error: 'ABORTED' });
        return;
      }
      if (code && code !== 0) {
        safeUnlink(tmpOutput);
        downloadLog('FFMPEG_FAIL', { exitCode: code, stderr: stderr.slice(0, 300) });
        resolve({ success: false, error: 'FFMPEG_EXIT_' + code + ': ' + stderr.slice(0, 200) });
        return;
      }

      try {
        const stat = fs.statSync(tmpOutput);
        const fileSize = stat.size;

        moveFile(tmpOutput, finalPath);

        downloadLog('SUCCESS', { filePath: finalPath, fileSize, format: outputFormat.ext });

        if (onProgress) {
          onProgress({
            phase: 'completed',
            downloaded: fileSize,
            total: fileSize,
            percent: 100,
            sourceQuality: null,
            converted: true,
          });
        }

        resolve({
          success: true,
          filePath: finalPath,
          fileSize,
          outputFormat: outputFormat.ext,
          sourceQuality: { codec: outputFormat.codec, bitrate: 320000, isLossless: outputFormat.isLossless || false },
          converted: true,
        });
      } catch (e) {
        safeUnlink(tmpOutput);
        downloadLog('ERROR', { error: e.message });
        resolve({ success: false, error: e.message || String(e) });
      }
    });
  });
}

function downloadDirect(audioUrl, tmpPath, opts, onProgress, abortCheck) {
  return new Promise((resolve, reject) => {
    const url = new URL(audioUrl);
    const client = url.protocol === 'https:' ? require('https') : require('http');
    const req = client.get(audioUrl, {
      headers: {
        'User-Agent': opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.qishui.com/',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadDirect(res.headers.location, tmpPath, opts, onProgress, abortCheck).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP_' + res.statusCode));
        return;
      }
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      const ct = res.headers['content-type'] || '';
      let codec = 'unknown';
      let bitrate = 0;
      if (ct.includes('flac')) { codec = 'flac'; bitrate = 1000000; }
      else if (ct.includes('mpeg') || ct.includes('mp3')) { codec = 'mp3'; bitrate = 320000; }
      else if (ct.includes('aac') || ct.includes('m4a')) { codec = 'aac'; bitrate = 256000; }
      else if (ct.includes('ogg')) { codec = 'ogg'; bitrate = 256000; }
      else if (ct.includes('wav')) { codec = 'wav'; bitrate = 1411000; }

      let downloaded = 0;
      const fileStream = fs.createWriteStream(tmpPath);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress) {
          onProgress({
            phase: 'downloading',
            downloaded,
            total: totalBytes,
            percent: totalBytes > 0 ? Math.round((downloaded / totalBytes) * 100) : 0,
            sourceQuality: { codec, bitrate, isLossless: codec === 'flac' || codec === 'wav', contentType: ct },
          });
        }
      });

      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve({
          success: true,
          fileSize: downloaded,
          sourceQuality: { codec, bitrate: bitrate, isLossless: codec === 'flac' || codec === 'wav' },
        });
      });
      fileStream.on('error', (err) => { safeUnlink(tmpPath); reject(err); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DOWNLOAD_TIMEOUT')); });
  });
}

function moveFile(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      safeUnlink(src);
    } else {
      throw e;
    }
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}

module.exports = {
  execute,
  buildFfmpegArgs,
  detectSourceCodecFromUrl,
  resolveOutputFormat,
};
