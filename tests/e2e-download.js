'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const REPORT_FILE = path.join(__dirname, '..', 'DOWNLOAD_E2E_TEST_REPORT.md');

const TEST_SONG = {
  id: '7661244872816330778',
  source: 'soda',
  name: '晴天女版',
  artist: '张韶涵',
  album: ''
};
const INVALID_SONG_ID = '9999999999999999999';

const FORMAT_MAGIC = {
  mp3: [
    { name: 'ID3v2', bytes: [0x49, 0x44, 0x33] },
    { name: 'MPEG sync', bytes: [0xFF, 0xFB] },
    { name: 'MPEG sync alt', bytes: [0xFF, 0xFA] },
    { name: 'MPEG sync 2', bytes: [0xFF, 0xF3] },
    { name: 'MPEG sync 3', bytes: [0xFF, 0xF2] },
  ],
  flac: [
    { name: 'fLaC', bytes: [0x66, 0x4C, 0x61, 0x43] },
  ],
  m4a: [
    { name: 'ftyp', bytes: [0x66, 0x74, 0x79, 0x70] },
  ],
  ogg: [
    { name: 'OggS', bytes: [0x4F, 0x67, 0x67, 0x53] },
  ],
};

let NodeID3 = null;
try { NodeID3 = require('node-id3'); } catch (e) {}

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlPath, BASE_URL);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectFormat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    for (const [fmt, signatures] of Object.entries(FORMAT_MAGIC)) {
      for (const sig of signatures) {
        const match = sig.bytes.every((b, i) => buf[i] === b);
        if (match) return { format: fmt, signature: sig.name };
      }
    }
    if (buf[0] === 0x4D && buf[1] === 0x54 && buf[2] === 0x68 && buf[3] === 0x64) {
      return { format: 'midi', signature: 'MThd' };
    }
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
      return { format: 'wav', signature: 'RIFF' };
    }
    return { format: 'unknown', signature: buf.slice(0, 4).toString('hex') };
  } catch (e) {
    return { format: 'error', signature: e.message };
  }
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function escMd(text) {
  if (typeof text !== 'string') return String(text || '');
  return text.replace(/\|/g, '\\|');
}

async function checkServerAlive() {
  try {
    await httpRequest('GET', '/api/download/list');
    return true;
  } catch (e) {
    return false;
  }
}

async function checkSodaAuth() {
  try {
    const result = await httpRequest('GET', '/api/soda/login/status?quick=true');
    return {
      ok: !!(result && result.loggedIn),
      loggedIn: !!(result && result.loggedIn),
      raw: result,
    };
  } catch (e) {
    return { ok: false, loggedIn: false, error: e.message };
  }
}

async function pollDownloadStatus(jobId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await httpRequest('GET', `/api/download/status?id=${jobId}`);
    if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
      return status;
    }
    await sleep(1000);
  }
  return { status: 'timeout', error: `Polling timeout after ${timeoutMs}ms` };
}

async function run() {
  console.log('');
  console.log('========================================');
  console.log('  Mineradio Download E2E Test');
  console.log('========================================');
  console.log('');

  const reportLines = [];
  const now = new Date().toISOString();
  reportLines.push('# Mineradio Download E2E Test Report');
  reportLines.push('');
  reportLines.push(`**Date**: ${now}`);
  reportLines.push('');
  reportLines.push('## 0. Pre-check');
  reportLines.push('');

  let serverAlive = false;
  try {
    serverAlive = await checkServerAlive();
  } catch (e) {}
  reportLines.push(`| Check | Result | Detail |`);
  reportLines.push(`|-------|--------|--------|`);
  reportLines.push(`| Server running | ${serverAlive ? '✅' : '❌'} | ${serverAlive ? BASE_URL : 'Server not reachable'} |`);

  if (!serverAlive) {
    reportLines.push('');
    reportLines.push('❌ **Server is not running. Start server with `node server.js` and retry.**');
    reportLines.push('');
    fs.writeFileSync(REPORT_FILE, reportLines.join('\n'), 'utf8');
    console.log('❌ Server not running at', BASE_URL);
    console.log('   Report written to', REPORT_FILE);
    console.log('');
    return;
  }
  console.log('✅ Server running at', BASE_URL);

  console.log('');
  console.log('--- Auth Check ---');
  const auth = await checkSodaAuth();
  console.log('   Soda loggedIn:', auth.loggedIn);
  reportLines.push(`| Soda Auth | ${auth.ok ? '✅' : '❌'} | ${auth.loggedIn ? 'Logged in' : 'Not logged in'}${auth.error ? ' (' + escMd(auth.error) + ')' : ''} |`);
  reportLines.push('');

  const results = {
    auth: auth.ok ? 'PASS' : 'FAIL',
    downloadComplete: 'SKIP',
    downloadFailure: 'SKIP',
    details: {},
  };

  reportLines.push('## 1. Download Complete Test');
  reportLines.push('');
  reportLines.push(`**Song**: ${TEST_SONG.artist} - ${TEST_SONG.name}`);
  reportLines.push(`**Source**: ${TEST_SONG.source}, ID: ${TEST_SONG.id}`);
  reportLines.push('');

  const details = {};

  console.log('');
  console.log('--- Download Complete Test ---');

  try {
    const startTime = Date.now();
    const startResult = await httpRequest('POST', '/api/download/start', {
      id: TEST_SONG.id,
      source: TEST_SONG.source,
      quality: 'best',
      format: 'auto',
      name: TEST_SONG.name,
      artist: TEST_SONG.artist,
      album: TEST_SONG.album,
    });
    const jobId = startResult.jobId;
    details.jobId = jobId;
    console.log('   Job submitted:', jobId);

    const finalStatus = await pollDownloadStatus(jobId, 180000);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    details.duration = duration + 's';
    console.log('   Duration:', duration + 's');
    console.log('   Status:', finalStatus.status);

    if (finalStatus.status === 'completed') {
      const filePath = finalStatus.filePath || '';
      details.filePath = filePath;
      console.log('   File:', filePath);

      const fileChecks = [];

      const fileExists = !!(filePath && fs.existsSync(filePath));
      fileChecks.push({ name: 'File exists', pass: fileExists, detail: fileExists ? filePath : 'N/A' });

      let fileSize = 0;
      if (fileExists) {
        fileSize = fs.statSync(filePath).size;
        fileChecks.push({ name: 'File size', pass: fileSize > 1048576, detail: formatBytes(fileSize) + ' (' + fileSize + ' bytes)' });
      } else {
        fileChecks.push({ name: 'File size', pass: false, detail: 'File not found' });
      }

      const fmt = fileExists ? detectFormat(filePath) : { format: 'unknown', signature: 'N/A' };
      const knownFormat = ['mp3', 'flac', 'm4a', 'ogg', 'wav'].includes(fmt.format);
      fileChecks.push({ name: 'Audio format', pass: knownFormat, detail: fmt.format + ' (' + fmt.signature + ')' });

      const ext = path.extname(filePath || '').toLowerCase().replace('.', '');
      const extMatch = ext === fmt.format || (fmt.format === 'mp3' && ext === 'mp3');
      if (ext) {
        fileChecks.push({ name: 'Extension matches magic', pass: extMatch, detail: ext + ' → ' + fmt.format });
      }

      reportLines.push('### File Verification');
      reportLines.push('');
      reportLines.push('| Check | Result | Detail |');
      reportLines.push('|-------|--------|--------|');
      for (const c of fileChecks) {
        reportLines.push(`| ${escMd(c.name)} | ${c.pass ? '✅' : '❌'} | ${escMd(c.detail)} |`);
      }
      reportLines.push('');
      details.fileChecks = fileChecks;
      const fileAllPass = fileChecks.every(c => c.pass);

      let metadataChecks = [];
      if (fileExists && filePath) {
        const dir = path.dirname(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));
        const metadataPath = path.join(dir, baseName + '.metadata.json');
        const lyricPath = path.join(dir, baseName + '.lrc');

        console.log('   Metadata:', metadataPath);
        console.log('   Lyrics:', lyricPath);

        const metadataExists = fs.existsSync(metadataPath);
        metadataChecks.push({ name: 'metadata.json', pass: metadataExists, detail: metadataExists ? metadataPath : 'Not found' });

        let metaOk = false;
        if (metadataExists) {
          try {
            const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            const hasTitle = !!(meta.title);
            const hasArtist = !!(meta.artist);
            const hasSource = !!(meta.source);
            const hasQuality = !!(meta.quality);
            const hasConversion = !!(meta.conversion);
            metaOk = hasTitle && hasArtist && hasSource && hasQuality && hasConversion;
            metadataChecks.push({ name: 'metadata.title', pass: hasTitle, detail: meta.title || '(empty)' });
            metadataChecks.push({ name: 'metadata.artist', pass: hasArtist, detail: meta.artist || '(empty)' });
            metadataChecks.push({ name: 'metadata.source', pass: hasSource, detail: meta.source || '(empty)' });
            metadataChecks.push({ name: 'metadata.quality', pass: hasQuality, detail: meta.quality ? JSON.stringify(meta.quality) : '(missing)' });
            metadataChecks.push({ name: 'metadata.conversion', pass: hasConversion, detail: meta.conversion ? JSON.stringify(meta.conversion) : '(missing)' });
          } catch (e) {
            metadataChecks.push({ name: 'metadata parse', pass: false, detail: e.message });
          }
        }

        const lyricExists = fs.existsSync(lyricPath);
        metadataChecks.push({ name: 'Lyrics file (.lrc)', pass: lyricExists, detail: lyricExists ? lyricPath : 'Not found' });

        if (lyricExists) {
          const lyricContent = fs.readFileSync(lyricPath, 'utf8');
          const hasTimestamp = /\[\d{2}:\d{2}/.test(lyricContent);
          metadataChecks.push({ name: 'Lyrics has timestamps', pass: hasTimestamp, detail: hasTimestamp ? lyricContent.length + ' bytes' : 'No [mm:ss] timestamps' });
          details.lyricLineCount = lyricContent.split('\n').length;
        }

        if (fmt.format === 'mp3' && NodeID3) {
          try {
            const id3 = NodeID3.read(filePath);
            const id3Title = !!(id3 && id3.title);
            const id3Artist = !!(id3 && id3.artist);
            const id3Cover = !!(id3 && id3.image && id3.image.imageBuffer);
            metadataChecks.push({ name: 'ID3: Title', pass: id3Title, detail: id3 && id3.title ? escMd(id3.title) : '(missing)' });
            metadataChecks.push({ name: 'ID3: Artist', pass: id3Artist, detail: id3 && id3.artist ? escMd(id3.artist) : '(missing)' });
            metadataChecks.push({ name: 'ID3: Cover art', pass: id3Cover, detail: id3Cover ? (id3.image.imageBuffer.length + ' bytes') : '(missing)' });
            if (id3 && id3.album) {
              metadataChecks.push({ name: 'ID3: Album', pass: true, detail: escMd(id3.album) });
            }
          } catch (e) {
            metadataChecks.push({ name: 'ID3 read', pass: false, detail: e.message });
          }
        } else if (fmt.format === 'mp3' && !NodeID3) {
          metadataChecks.push({ name: 'ID3 check', pass: false, detail: 'node-id3 not available' });
        } else {
          metadataChecks.push({ name: 'ID3 check', pass: true, detail: 'N/A (non-MP3 format)' });
        }

        reportLines.push('### Asset Verification');
        reportLines.push('');
        reportLines.push('| Check | Result | Detail |');
        reportLines.push('|-------|--------|--------|');
        for (const c of metadataChecks) {
          reportLines.push(`| ${escMd(c.name)} | ${c.pass ? '✅' : '❌'} | ${escMd(c.detail)} |`);
        }
        reportLines.push('');
        details.metadataChecks = metadataChecks;
      }

      const allPass = fileAllPass && metadataChecks.every(c => c.pass);
      results.downloadComplete = allPass ? 'PASS' : 'FAIL';

      if (allPass) {
        console.log('✅ All file/asset checks passed');
      } else {
        console.log('❌ Some checks failed');
      }
    } else if (finalStatus.status === 'failed') {
      results.downloadComplete = 'FAIL';
      const errMsg = finalStatus.error || 'Unknown error';
      console.log('❌ Download failed:', errMsg);
      reportLines.push('| Check | Result | Detail |');
      reportLines.push('|-------|--------|--------|');
      reportLines.push(`| Download job | ❌ | Failed: ${escMd(errMsg)} |`);
      reportLines.push('');
      details.failError = errMsg;
    } else {
      results.downloadComplete = 'SKIP';
      reportLines.push(`| Check | Result | Detail |`);
      reportLines.push(`|-------|--------|--------|`);
      reportLines.push(`| Download job | ⏭️ | ${finalStatus.status}: ${escMd(finalStatus.error || 'No error')} |`);
      reportLines.push('');
      details.timeout = true;
    }

    details.finalStatus = finalStatus.status;
  } catch (e) {
    results.downloadComplete = 'FAIL';
    console.log('❌ Download test error:', e.message);
    reportLines.push('| Check | Result | Detail |');
    reportLines.push('|-------|--------|--------|');
    reportLines.push(`| Download job | ❌ | Exception: ${escMd(e.message)} |`);
    reportLines.push('');
    details.error = e.message;
  }

  reportLines.push('## 2. Download Failure Test');
  reportLines.push('');
  reportLines.push(`**Invalid ID**: ${INVALID_SONG_ID}`);
  reportLines.push('');

  console.log('');
  console.log('--- Download Failure Test ---');

  try {
    const failResult = await httpRequest('POST', '/api/download/start', {
      id: INVALID_SONG_ID,
      source: 'soda',
      quality: 'best',
      format: 'auto',
      name: 'NonExistent',
      artist: 'Unknown',
    });
    const failJobId = failResult.jobId;
    console.log('   Fail job submitted:', failJobId);

    const failStatus = await pollDownloadStatus(failJobId, 60000);
    console.log('   Status:', failStatus.status);

    if (failStatus.status === 'failed') {
      const hasError = !!(failStatus.error);
      results.downloadFailure = hasError ? 'PASS' : 'FAIL';
      console.log('   Error:', failStatus.error || '(none)');
      reportLines.push('| Check | Result | Detail |');
      reportLines.push('|-------|--------|--------|');
      reportLines.push(`| Status becomes "failed" | ✅ | status: failed |`);
      reportLines.push(`| Error message present | ${hasError ? '✅' : '❌'} | ${escMd(failStatus.error || '(empty)')} |`);
      details.failCheckPass = true;
    } else {
      results.downloadFailure = 'FAIL';
      console.log('❌ Expected failure but got:', failStatus.status);
      reportLines.push('| Check | Result | Detail |');
      reportLines.push('|-------|--------|--------|');
      reportLines.push(`| Status becomes "failed" | ❌ | Got "${failStatus.status}" instead |`);
      details.failCheckPass = false;
    }
    reportLines.push('');
  } catch (e) {
    results.downloadFailure = 'FAIL';
    console.log('❌ Failure test error:', e.message);
    reportLines.push('| Check | Result | Detail |');
    reportLines.push('|-------|--------|--------|');
    reportLines.push(`| Failure test | ❌ | Exception: ${escMd(e.message)} |`);
    reportLines.push('');
    details.failError = e.message;
  }

  reportLines.push('## Summary');
  reportLines.push('');
  reportLines.push('| Check | Status |');
  reportLines.push('|-------|--------|');
  reportLines.push(`| Soda Auth | ${results.auth === 'PASS' ? '✅ PASS' : results.auth === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP'} |`);
  reportLines.push(`| Download Complete | ${results.downloadComplete === 'PASS' ? '✅ PASS' : results.downloadComplete === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP'} |`);
  reportLines.push(`| Download Failure | ${results.downloadFailure === 'PASS' ? '✅ PASS' : results.downloadFailure === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP'} |`);
  reportLines.push('');
  reportLines.push('## Details');
  reportLines.push('');
  reportLines.push('```json');
  reportLines.push(JSON.stringify(details, null, 2));
  reportLines.push('```');
  reportLines.push('');

  const allOk = results.auth === 'PASS' && results.downloadComplete === 'PASS' && results.downloadFailure === 'PASS';
  if (allOk) {
    reportLines.push('**All checks passed.**');
  } else {
    reportLines.push('**Some checks failed. Review above details.**');
  }
  reportLines.push('');

  fs.writeFileSync(REPORT_FILE, reportLines.join('\n'), 'utf8');
  console.log('');
  console.log('========================================');
  console.log(`  Auth:           ${results.auth === 'PASS' ? '✅ PASS' : results.auth === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP'}`);
  console.log(`  Download:       ${results.downloadComplete === 'PASS' ? '✅ PASS' : results.downloadComplete === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP'}`);
  console.log(`  Failure case:   ${results.downloadFailure === 'PASS' ? '✅ PASS' : results.downloadFailure === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP'}`);
  console.log('========================================');
  console.log('  Report:', REPORT_FILE);
  console.log('========================================');
  console.log('');
}

run().catch(e => {
  console.error('Fatal error:', e);
  const fallback = [
    '# Mineradio Download E2E Test Report',
    '',
    `**Date**: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    '| Check | Status |',
    '|-------|--------|',
    '| Soda Auth | ❌ FAIL |',
    '| Download Complete | ❌ FAIL |',
    '| Download Failure | ❌ FAIL |',
    '',
    '**Fatal error**: ' + e.message,
    '',
  ];
  fs.writeFileSync(REPORT_FILE, fallback.join('\n'), 'utf8');
  process.exit(1);
});
