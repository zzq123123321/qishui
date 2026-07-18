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

function detectSourceQuality(headers, contentType) {
  const cl = parseInt(headers['content-length'] || '0', 10);
  const ct = String(contentType || headers['content-type'] || '').toLowerCase();
  let codec = 'unknown';
  let estimatedBitrate = 0;

  if (ct.includes('flac')) {
    codec = 'flac';
    estimatedBitrate = 1000000;
  } else if (ct.includes('mpeg') || ct.includes('mp3')) {
    codec = 'mp3';
    estimatedBitrate = 320000;
  } else if (ct.includes('ogg')) {
    codec = 'ogg';
    estimatedBitrate = 256000;
  } else if (ct.includes('aac') || ct.includes('m4a')) {
    codec = 'aac';
    estimatedBitrate = 256000;
  } else if (ct.includes('wav')) {
    codec = 'wav';
    estimatedBitrate = 1411000;
  } else {
    codec = 'unknown';
    estimatedBitrate = 320000;
  }

  return {
    codec,
    estimatedBitrate,
    contentLength: cl,
    contentType: ct,
    isLossless: codec === 'flac' || codec === 'wav',
  };
}

function canProduceLossless(sourceQuality) {
  return sourceQuality && sourceQuality.isLossless;
}

function downloadLog(tag, data) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[DL-${tag}] ${ts}`, JSON.stringify(data, null, 2));
}

function buildFfmpegArgsFromUrl(audioUrl, outputPath, format, decryptionKey, opts) {
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

  if (format === 'flac') {
    args.push('-codec:a', 'flac');
    args.push('-f', 'flac');
  } else {
    args.push('-codec:a', 'libmp3lame');
    args.push('-b:a', '320k');
    args.push('-f', 'mp3');
  }

  args.push(outputPath);
  return args;
}

function execute(opts) {
  const {
    audioUrl,
    format,
    filePath,
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

  const tmpOutput = tmpFilePath() + '.' + (format === 'flac' ? 'flac' : 'mp3');
  const finalPath = filePath;

  downloadLog('START', {
    audioUrl: audioUrl.substring(0, 120) + (audioUrl.length > 120 ? '...' : ''),
    format,
    output: finalPath,
    headers: headers ? { Cookie: headers['Cookie'] ? 'YES' : 'NO' } : 'NONE',
    ffmpegPath,
  });

  return new Promise((resolve) => {
    if (abortCheck && abortCheck()) {
      downloadLog('ABORT', { phase: 'pre-start' });
      resolve({ success: false, error: 'ABORTED' });
      return;
    }

    const args = buildFfmpegArgsFromUrl(audioUrl, tmpOutput, format, decryptionKey, { ffmpegHeaderText, userAgent });

    downloadLog('FFMPEG', {
      args: args.slice(0, 5).join(' ') + ' ...',
      urlLen: audioUrl.length,
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

        const dir = path.dirname(finalPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        try {
          fs.renameSync(tmpOutput, finalPath);
        } catch (renameErr) {
          if (renameErr && renameErr.code === 'EXDEV') {
            fs.copyFileSync(tmpOutput, finalPath);
            safeUnlink(tmpOutput);
          } else {
            throw renameErr;
          }
        }

        downloadLog('SUCCESS', {
          filePath: finalPath,
          fileSize,
          format,
        });

        if (onProgress) {
          onProgress({
            phase: 'completed',
            downloaded: fileSize,
            total: fileSize,
            percent: 100,
            sourceQuality: null,
            converted: false,
          });
        }

        resolve({
          success: true,
          filePath: finalPath,
          fileSize,
          sourceQuality: { codec: 'unknown', bitrate: 0, isLossless: false },
          converted: false,
        });
      } catch (e) {
        safeUnlink(tmpOutput);
        downloadLog('ERROR', { error: e.message });
        resolve({ success: false, error: e.message || String(e) });
      }
    });
  });
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}

module.exports = {
  execute,
  buildFfmpegArgsFromUrl,
  detectSourceQuality,
  canProduceLossless,
};
