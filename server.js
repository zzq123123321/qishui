// ====================================================================
//  粒子音乐可视化播放器 — Server v2
//  - 网易云搜索 / 歌曲URL / 封面/音频代理
//  - 扫码登录 (login_qr_*) + cookie 持久化 (./.cookie)
//  - 试听检测 (freeTrialInfo) + 全 quality 探测
//  - 所有受保护 API 都会带上已登录用户的 cookie
// ====================================================================
const {
  search,
  cloudsearch,
  song_detail,
  song_url,
  song_url_v1,
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  logout,
  user_account,
  user_playlist,
  comment: comment_action,
  comment_like,
  comment_music,
  artist_detail,
  artist_top_song,
  artist_songs,
  like: like_song,
  likelist,
  song_like_check,
  playlist_tracks,
  playlist_track_add,
  playlist_create,
  playlist_detail,
  playlist_track_all,
  personalized,
  personalized_newsong,
  recommend_resource,
  recommend_songs,
  personal_fm,
  playmode_intelligence_list,
  simi_song,
  top_song,
  dj_detail,
  dj_program,
  dj_hot,
  dj_sublist,
  user_audio,
  dj_paygift,
  record_recent_voice,
  sati_resource_sub_list,
  lyric,
  lyric_new,
  vip_info,
  vip_info_v2,
} = require('NeteaseCloudMusicApi');
const http = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const zlib = require('zlib');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const { once } = require('events');
const { fileURLToPath } = require('url');
const { analyzePodcastDjStream, analyzePodcastDjIntro } = require('./dj-analyzer');
const { readPackageInfo, readUpdateConfig } = require('./server/config/app-config');
const { resolveStaticFile } = require('./server/static-files');
const { collectCookiePair, normalizeCookieHeader, rawCookieFallback } = require('./server/utils/cookies');
const { serveStatic, sendJSON } = require('./server/utils/http');
const { mineradioUserDataDir, writePrivateStateFile } = require('./server/utils/paths');
const sodaSigning = require('./server/providers/soda/soda-signing');
const sodaApiClient = require('./server/providers/soda/soda-api-client');
const sodaResolver = require('./server/providers/soda/soda-playback-resolver');
const sodaProvider = require('./server/providers/soda/soda-provider');
const downloadStore = require('./server/download/download-store');
const downloadManager = require('./server/download/download-manager');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const COOKIE_FILE = process.env.COOKIE_FILE || path.join(__dirname, '.cookie');
const QQ_COOKIE_FILE = process.env.QQ_COOKIE_FILE || path.join(__dirname, '.qq-cookie');
const SODA_COOKIE_FILE = process.env.SODA_COOKIE_FILE || path.join(mineradioUserDataDir(__dirname), '.soda-cookie');
const UPDATE_WORK_DIR = process.env.MINERADIO_UPDATE_DIR || path.join(__dirname, 'updates');
const UPDATE_DOWNLOAD_DIR = process.env.MINERADIO_UPDATE_DOWNLOAD_DIR || path.join(UPDATE_WORK_DIR, 'downloads');
const UPDATE_PATCH_BACKUP_DIR = process.env.MINERADIO_PATCH_BACKUP_DIR || path.join(UPDATE_WORK_DIR, 'backups', 'patches');
const BEATMAP_CACHE_DIR = process.env.MINERADIO_BEAT_CACHE_DIR || 'D:\\MineradioCache\\beatmaps';
const APP_PACKAGE = readPackageInfo(__dirname);
const APP_VERSION = process.env.MINERADIO_VERSION || APP_PACKAGE.version || '0.9.11';
const UPDATE_CONFIG = readUpdateConfig(APP_PACKAGE);
const PATCH_MAX_BYTES = 12 * 1024 * 1024;
const PATCH_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build', 'server', 'renderer-dist', 'src']);
const PATCH_ALLOWED_FILES = new Set(['server.js', 'dj-analyzer.js', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html']);
const UPDATE_FALLBACK_NOTES = [
  '电影镜头节奏更松',
  '音源失败自动换源',
  '右上角更新提示',
];
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'http://ip-api.com/json/';
const WEATHER_REVERSE_LOCATION_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};

const updateDownloadJobs = new Map();

let ffmpegBinaryPath = process.env.FFMPEG_PATH || '';
try {
  if (!ffmpegBinaryPath) ffmpegBinaryPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (e) {
  ffmpegBinaryPath = '';
}

function applySystemCertificateAuthorities() {
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    if (!system.length) return;
    const seen = new Set();
    const merged = [];
    bundled.concat(system).forEach(cert => {
      if (!cert || seen.has(cert)) return;
      seen.add(cert);
      merged.push(cert);
    });
    if (merged.length > bundled.length) tls.setDefaultCACertificates(merged);
  } catch (e) {
    console.warn('[TLS] system CA merge skipped:', e.message);
  }
}

applySystemCertificateAuthorities();

function watchParentProcess() {
  const parentPid = Number.parseInt(process.env.MINERADIO_PARENT_PID || '', 10);
  if (!parentPid || parentPid === process.pid) return;
  const timer = setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch (e) { process.exit(0); }
  }, 5000);
  if (timer.unref) timer.unref();
}

watchParentProcess();

// ---------- Cookie 持久化 ----------
let userCookie = '';
try { if (fs.existsSync(COOKIE_FILE)) userCookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim(); }
catch (e) { userCookie = ''; }
function saveCookie(c) {
  userCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  try { fs.writeFileSync(COOKIE_FILE, userCookie); } catch (e) {}
}

let qqCookie = '';
try { if (fs.existsSync(QQ_COOKIE_FILE)) qqCookie = fs.readFileSync(QQ_COOKIE_FILE, 'utf8').trim(); }
catch (e) { qqCookie = ''; }
function saveQQCookie(c) {
  qqCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  try { fs.writeFileSync(QQ_COOKIE_FILE, qqCookie); } catch (e) {}
}

let sodaCookie = '';
try { if (fs.existsSync(SODA_COOKIE_FILE)) sodaCookie = fs.readFileSync(SODA_COOKIE_FILE, 'utf8').trim(); }
catch (e) { sodaCookie = ''; }
function saveSodaCookie(c) {
  sodaCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  writePrivateStateFile(SODA_COOKIE_FILE, sodaCookie);
}

// ---------- 工具 ----------
function normalizeDigest(value, algorithm) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefix = new RegExp('^' + algorithm + ':', 'i');
  return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}
function assetDigestInfo(asset) {
  const digest = String(asset && asset.digest || '').trim();
  return {
    sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
    sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  };
}
function buildMirrorUrl(originalUrl, mirror) {
  const source = String(originalUrl || '').trim();
  const base = String(mirror || '').trim();
  if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return '';
  if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source));
  if (base.includes('{url}')) return base.replace(/\{url\}/g, source);
  return base.replace(/\/+$/, '/') + source;
}
function updateMirrorUrlPrefix(mirror) {
  const base = String(mirror || '').trim();
  if (!/^https?:\/\//i.test(base)) return '';
  return base.split('{')[0].replace(/\/+$/, '/').toLowerCase();
}
function isConfiguredUpdateMirrorUrl(url, mirrors) {
  const lower = String(url || '').trim().toLowerCase();
  if (!lower) return false;
  return (mirrors || []).some(mirror => {
    const prefix = updateMirrorUrlPrefix(mirror);
    return prefix && lower.startsWith(prefix);
  });
}
function isGitHubReleaseUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /(^|\.)github\.com$/i.test(u.hostname) && /\/releases\/download\//i.test(u.pathname);
  } catch (_) {
    return false;
  }
}
function isGiteeReleaseUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /(^|\.)gitee\.com$/i.test(u.hostname) && /\/releases\/download\//i.test(u.pathname);
  } catch (_) {
    return false;
  }
}
function uniqueDownloadCandidates(urls, opts) {
  opts = opts || {};
  const directUrls = (Array.isArray(urls) ? urls : [urls])
    .map(url => String(url || '').trim())
    .filter(url => /^https?:\/\//i.test(url));
  const directSet = new Set(directUrls.map(url => url.toLowerCase()));
  const mirrors = opts.useMirrors === false ? [] : (UPDATE_CONFIG.mirrors || []);
  const mirrored = [];
  directUrls.filter(source => isGitHubReleaseUrl(source) && !isConfiguredUpdateMirrorUrl(source, mirrors)).forEach(source => {
    mirrors.forEach((mirror, index) => {
      const url = buildMirrorUrl(source, mirror);
      if (url) mirrored.push({
        url,
        label: '国内加速线路 ' + (index + 1),
        mirrored: true,
      });
    });
  });
  const direct = directUrls.map(url => ({
    url,
    label: isGiteeReleaseUrl(url) ? 'Gitee 国内源' : (directSet.has(url.toLowerCase()) ? 'GitHub 直连' : '下载线路'),
    mirrored: isConfiguredUpdateMirrorUrl(url, mirrors),
  }));
  const giteeDirect = direct.filter(item => isGiteeReleaseUrl(item.url));
  const otherDirect = direct.filter(item => !isGiteeReleaseUrl(item.url));
  const ordered = UPDATE_CONFIG.preferMirrors === false
    ? direct.concat(mirrored)
    : giteeDirect.concat(mirrored).concat(otherDirect);
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function publicDownloadUrls(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(item => item && item.url)
    .filter(Boolean);
}
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
}
function compareVersions(a, b) {
  const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}
function releaseVersionValue(release) {
  return normalizeVersion(release && (release.tag_name || release.name || release.version) || '');
}
function releaseTimeValue(release) {
  const raw = release && (release.published_at || release.created_at || release.updated_at) || '';
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}
function selectLatestStableRelease(releases) {
  const list = (Array.isArray(releases) ? releases : [])
    .filter(item => item && item.prerelease !== true && item.draft !== true);
  const candidates = list.length ? list : (Array.isArray(releases) ? releases.filter(Boolean) : []);
  candidates.sort((a, b) => {
    const byVersion = compareVersions(releaseVersionValue(b), releaseVersionValue(a));
    if (byVersion) return byVersion;
    return releaseTimeValue(b) - releaseTimeValue(a);
  });
  return candidates[0] || null;
}
function cleanReleaseLine(line) {
  return String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}
function extractReleaseNotes(body) {
  const notes = [];
  String(body || '').split(/\r?\n/).forEach(line => {
    const text = cleanReleaseLine(line);
    if (!text) return;
    if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return;
    if (/^https?:\/\//i.test(text)) return;
    if (text.length > 72) return;
    notes.push(text);
  });
  return notes.slice(0, 4);
}
function pickReleaseAsset(assets, latestVersion) {
  const list = Array.isArray(assets) ? assets : [];
  const preferred = list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
    || list[0];
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const sourceUrl = preferred.browser_download_url || preferred.download_url || preferred.downloadUrl || preferred.url || '';
  const candidates = uniqueDownloadCandidates(releaseAssetDownloadUrls(latestVersion || APP_VERSION, sourceUrl, preferred.name || ''));
  const downloadUrl = sourceUrl || (candidates[0] && candidates[0].url) || '';
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function patchAssetVersions(name) {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
  return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
}
function pickPatchAsset(assets, currentVersion, latestVersion) {
  const list = Array.isArray(assets) ? assets : [];
  const current = normalizeVersion(currentVersion || APP_VERSION);
  const latest = normalizeVersion(latestVersion || '');
  const preferred = list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const sourceUrl = preferred.browser_download_url || preferred.download_url || preferred.downloadUrl || preferred.url || '';
  const candidates = uniqueDownloadCandidates(releaseAssetDownloadUrls(latestVersion || APP_VERSION, sourceUrl, preferred.name || ''));
  const downloadUrl = sourceUrl || (candidates[0] && candidates[0].url) || '';
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function updateAssetNameFromUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const base = path.basename(decodeURIComponent(u.pathname || ''));
    if (base) return base;
  } catch (_) {}
  return path.basename(String(value || '').split('?')[0]) || '';
}
function normalizeManifestUpdateInfo(data) {
  data = data || {};
  const release = data.release || {};
  const asset = release.asset || data.asset || {};
  const latestVersion = normalizeVersion(
    data.latestVersion
    || data.version
    || release.version
    || release.tagName
    || release.tag_name
    || release.name
    || APP_VERSION
  ) || APP_VERSION;
  const downloadUrl = release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || '';
  const patch = release.patch || data.patch || null;
  const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []);
  const patchUrls = patch ? [patch.downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []) : [];
  const patchInfo = patch && patch.downloadUrl ? {
    name: patch.name || updateAssetNameFromUrl(patch.downloadUrl) || `Mineradio-${APP_VERSION}→${latestVersion}.patch.json`,
    size: Number(patch.size || 0) || 0,
    contentType: patch.contentType || patch.content_type || 'application/json',
    downloadUrl: patch.downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
    from: normalizeVersion(patch.from || APP_VERSION),
    to: normalizeVersion(patch.to || latestVersion),
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
  } : null;
  const notes = Array.isArray(release.notes) && release.notes.length
    ? release.notes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
    : (extractReleaseNotes(release.body || data.body).length ? extractReleaseNotes(release.body || data.body) : UPDATE_FALLBACK_NOTES);
  const assetInfo = downloadUrl ? {
    name: asset.name || updateAssetNameFromUrl(downloadUrl) || `Mineradio-${latestVersion}-Setup.exe`,
    size: Number(asset.size || 0) || 0,
    contentType: asset.contentType || asset.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
    sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
  } : null;
  return {
    configured: true,
    preview: false,
    updateAvailable: data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: release.tagName || release.tag_name || data.tagName || ('v' + latestVersion),
      name: release.name || data.name || ('Mineradio v' + latestVersion),
      version: latestVersion,
      publishedAt: release.publishedAt || release.published_at || data.publishedAt || '',
      htmlUrl: release.htmlUrl || release.html_url || data.htmlUrl || '',
      downloadUrl,
      asset: assetInfo,
      patch: patchInfo,
      patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
      summary: release.summary || data.summary || notes[0] || '发现新版本，建议更新。',
      notes,
    },
    source: 'manifest',
  };
}
async function readUpdateManifest(ref) {
  const value = String(ref || '').trim();
  if (!value) throw new Error('UPDATE_MANIFEST_MISSING');
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Update manifest ' + resp.status);
    return resp.json();
  }
  const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function fetchManifestUpdateInfo(ref) {
  try {
    const data = await readUpdateManifest(ref);
    return normalizeManifestUpdateInfo(data);
  } catch (err) {
    return localUpdateFallback(err.message || 'Update manifest failed', { configured: true });
  }
}
function beatCacheRootInfo() {
  const dir = path.resolve(BEATMAP_CACHE_DIR);
  const root = path.parse(dir).root;
  const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
  const allowed = !!root && !/^C:$/i.test(drive);
  const available = allowed && fs.existsSync(root);
  return { dir, root, drive, allowed, available };
}
function ensureBeatMapCacheDir() {
  const info = beatCacheRootInfo();
  if (!info.allowed) {
    const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
    err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
    err.info = info;
    throw err;
  }
  if (!info.available) {
    const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
    err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
    err.info = info;
    throw err;
  }
  fs.mkdirSync(info.dir, { recursive: true });
  return info.dir;
}
function safeBeatMapCacheFile(key) {
  const raw = String(key || '').trim();
  if (!raw || raw.length > 240) return null;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap';
  return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
}
function compactBeatMapCachePayload(body) {
  const key = String(body && body.key || '').trim();
  const map = body && body.map;
  if (!key || !map || typeof map !== 'object') return null;
  return {
    v: 1,
    key,
    savedAt: Date.now(),
    meta: {
      provider: String(body.provider || '').slice(0, 32),
      title: String(body.title || '').slice(0, 160),
      artist: String(body.artist || '').slice(0, 160),
      mode: String(body.mode || 'mr').slice(0, 32),
    },
    map,
  };
}
function readBeatMapCache(key) {
  const file = safeBeatMapCacheFile(key);
  if (!file || !fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw && raw.map ? raw : null;
}
function writeBeatMapCache(body) {
  const payload = compactBeatMapCachePayload(body);
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
  const file = safeBeatMapCacheFile(payload.key);
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) };
}
function localUpdateFallback(reason, opts) {
  opts = opts || {};
  const configured = !!(opts.configured != null ? opts.configured : false);
  return {
    configured,
    preview: UPDATE_CONFIG.preview,
    updateAvailable: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    release: {
      tagName: 'v' + APP_VERSION,
      name: 'Mineradio v' + APP_VERSION,
      version: APP_VERSION,
      htmlUrl: '',
      downloadUrl: '',
      summary: '当前版本，更新检测已就绪。',
      notes: UPDATE_FALLBACK_NOTES,
    },
    reason: reason || '',
  };
}
function updateError(code, message, cause) {
  const err = new Error(message || code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}
function classifyUpdateError(err) {
  const code = String(err && err.code || '').trim();
  const message = String(err && err.message || err || '').trim();
  const detail = message || code || '未知错误';
  if (/HASH|DIGEST|CHECKSUM/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail };
  }
  if (/SIZE_MISMATCH|content length/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_SIZE_MISMATCH', reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。', detail };
  }
  if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail };
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail };
  }
  if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail };
  }
  const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/);
  if (http) {
    const status = Number(http[1]);
    if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail };
    if (status === 404) return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail };
    if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail };
    return { code: code || ('UPDATE_HTTP_' + status), reason: '更新线路返回 HTTP ' + status + '。', detail };
  }
  return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail };
}
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
async function fetchTextFromCandidates(candidates, timeoutMs) {
  const list = Array.isArray(candidates) && candidates.length ? candidates : [];
  const failures = [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    try {
      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, timeoutMs || 6500);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
      return { text: await resp.text(), candidate };
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push(candidate.label + ': ' + info.reason);
    }
  }
  throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed');
}
function yamlScalar(text, key) {
  const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm');
  const match = String(text || '').match(pattern);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}
function githubReleaseDownloadUrl(version, fileName) {
  const tag = 'v' + normalizeVersion(version);
  const encodedOwner = encodeURIComponent(UPDATE_CONFIG.owner);
  const encodedRepo = encodeURIComponent(UPDATE_CONFIG.repo);
  const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
}
function giteeReleaseDownloadUrl(version, fileName) {
  const cfg = UPDATE_CONFIG.gitee || {};
  if (!cfg.configured) return '';
  const tag = 'v' + normalizeVersion(version);
  const encodedOwner = encodeURIComponent(cfg.owner);
  const encodedRepo = encodeURIComponent(cfg.repo);
  const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://gitee.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
}
function isHttpUpdateUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}
function primaryReleaseDownloadUrl(version, fileName) {
  if (isHttpUpdateUrl(fileName)) return String(fileName || '').trim();
  if (UPDATE_CONFIG.provider === 'gitee') {
    return giteeReleaseDownloadUrl(version, fileName) || githubReleaseDownloadUrl(version, fileName);
  }
  return githubReleaseDownloadUrl(version, fileName);
}
function releaseHtmlUrl(version) {
  const latestVersion = normalizeVersion(version || APP_VERSION);
  if (UPDATE_CONFIG.provider === 'gitee') {
    const cfg = UPDATE_CONFIG.gitee || {};
    if (cfg.configured) return `https://gitee.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/releases/tag/v${latestVersion}`;
  }
  return `https://github.com/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`;
}
function releaseAssetDownloadUrls(version, primaryUrl, assetName) {
  const name = assetName || updateAssetNameFromUrl(primaryUrl);
  const directUrl = String(primaryUrl || '').trim();
  if (isHttpUpdateUrl(directUrl) && !isGiteeReleaseUrl(directUrl)) return [directUrl];
  return [giteeReleaseDownloadUrl(version, name), directUrl, githubReleaseDownloadUrl(version, name)].filter(Boolean);
}
function parseLatestYmlUpdateInfo(text, reason) {
  const latestVersion = normalizeVersion(yamlScalar(text, 'version') || APP_VERSION) || APP_VERSION;
  const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `Mineradio-${latestVersion}-Setup.exe`;
  const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512');
  const size = Number(yamlScalar(text, 'size') || 0) || 0;
  const releaseDate = yamlScalar(text, 'releaseDate');
  const downloadUrl = primaryReleaseDownloadUrl(latestVersion, assetPath);
  const candidates = uniqueDownloadCandidates(releaseAssetDownloadUrls(latestVersion, downloadUrl, assetPath));
  const asset = {
    name: updateAssetNameFromUrl(downloadUrl) || assetPath,
    size,
    contentType: 'application/octet-stream',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: '',
    sha512,
  };
  return {
    configured: true,
    preview: false,
    updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
        tagName: 'v' + latestVersion,
        name: 'Mineradio v' + latestVersion,
        version: latestVersion,
        publishedAt: releaseDate,
        htmlUrl: releaseHtmlUrl(latestVersion),
        downloadUrl,
        asset,
      patch: null,
      patchAvailable: false,
      summary: '发现新版本，已启用备用更新线路。',
      notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
    },
    source: 'latest-yml',
    reason: reason || '',
  };
}
async function fetchLatestYmlUpdateInfo(reason, timeoutMs, version) {
  let latestYmlUrl = '';
  const targetVersion = normalizeVersion(version || '');
  if (UPDATE_CONFIG.provider === 'gitee') {
    const cfg = UPDATE_CONFIG.gitee || {};
    if (!cfg.configured) throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
    const tag = targetVersion ? 'v' + targetVersion : 'latest';
    latestYmlUrl = `https://gitee.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/releases/download/${tag}/latest.yml`;
  } else {
    if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
    latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest/download/latest.yml`;
  }
  const candidates = uniqueDownloadCandidates(latestYmlUrl);
  const result = await fetchTextFromCandidates(candidates, timeoutMs || 6500);
  return parseLatestYmlUpdateInfo(result.text, reason);
}
function normalizeGiteeReleaseAssets(release, version) {
  const lists = [
    release && release.attach_files,
    release && release.assets,
    release && release.attachments,
  ].filter(Array.isArray);
  return lists.flat().map(item => {
    const sourceUrl = item && (item.browser_download_url || item.download_url || item.downloadUrl || item.url || '');
    const name = item && (item.name || item.file_name || item.filename || updateAssetNameFromUrl(sourceUrl)) || '';
    return {
      name,
      size: Number(item && (item.size || item.file_size || item.filesize) || 0) || 0,
      content_type: item && (item.content_type || item.contentType || '') || '',
      browser_download_url: sourceUrl || (name ? giteeReleaseDownloadUrl(version || APP_VERSION, name) : ''),
      sha256: item && item.sha256 || '',
      sha512: item && item.sha512 || '',
      digest: item && item.digest || '',
    };
  }).filter(item => item.name || item.browser_download_url);
}
async function fetchGiteeLatestUpdateInfo() {
  const cfg = UPDATE_CONFIG.gitee || {};
  if (!cfg.configured) return localUpdateFallback('Gitee repository not configured', { configured: false });
  const apiUrl = `https://gitee.com/api/v5/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/releases`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) {
      try { return await fetchLatestYmlUpdateInfo('Gitee Releases ' + resp.status); }
      catch (_) { return localUpdateFallback('Gitee Releases ' + resp.status, { configured: true }); }
    }
    const data = await resp.json();
    const releases = Array.isArray(data) ? data : (data ? [data] : []);
    const release = selectLatestStableRelease(releases);
    if (!release) return localUpdateFallback('Gitee release empty', { configured: true });
    const latestVersion = normalizeVersion(release.tag_name || release.name || APP_VERSION) || APP_VERSION;
    const notes = extractReleaseNotes(release.body || release.description).length
      ? extractReleaseNotes(release.body || release.description)
      : UPDATE_FALLBACK_NOTES;
    try {
      const ymlInfo = await fetchLatestYmlUpdateInfo('gitee latest.yml', 5000, latestVersion);
      if (ymlInfo && ymlInfo.release && ymlInfo.release.asset && ymlInfo.release.asset.downloadUrl) {
        ymlInfo.release.tagName = release.tag_name || ('v' + latestVersion);
        ymlInfo.release.name = release.name || ('Mineradio v' + latestVersion);
        ymlInfo.release.publishedAt = release.published_at || release.created_at || release.updated_at || ymlInfo.release.publishedAt || '';
        ymlInfo.release.htmlUrl = release.html_url || releaseHtmlUrl(latestVersion);
        ymlInfo.release.summary = notes[0] || ymlInfo.release.summary;
        ymlInfo.release.notes = notes;
        ymlInfo.source = 'gitee-latest-yml';
        return ymlInfo;
      }
    } catch (_) {}
    const assets = normalizeGiteeReleaseAssets(release, latestVersion);
    const asset = pickReleaseAsset(assets, latestVersion);
    const patch = pickPatchAsset(assets, APP_VERSION, latestVersion);
    const info = {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: release.tag_name || ('v' + latestVersion),
        name: release.name || ('Mineradio v' + latestVersion),
        version: latestVersion,
        publishedAt: release.published_at || release.created_at || release.updated_at || '',
        htmlUrl: release.html_url || releaseHtmlUrl(latestVersion),
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
      source: 'gitee',
    };
    try {
      return mergeLatestYmlInstallerDigest(info, await fetchLatestYmlUpdateInfo('installer digest', 5000, latestVersion));
    } catch (_) {
      return info;
    }
  } catch (err) {
    const reason = err && err.message || 'Gitee update check failed';
    try { return await fetchLatestYmlUpdateInfo(reason); }
    catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
  } finally {
    clearTimeout(timer);
  }
}
async function fetchLatestUpdateInfo() {
  if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest);
  if (UPDATE_CONFIG.provider === 'gitee') return fetchGiteeLatestUpdateInfo();
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (!resp.ok) {
      try { return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status); }
      catch (_) { return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true }); }
    }
    const data = await resp.json();
    const latestVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION;
    const asset = pickReleaseAsset(data.assets, latestVersion);
    const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion);
    const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES;
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: data.tag_name || ('v' + latestVersion),
        name: data.name || ('Mineradio v' + latestVersion),
        version: latestVersion,
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || '',
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
    };
  } catch (err) {
    const reason = err && err.message || 'Update check failed';
    try { return await fetchLatestYmlUpdateInfo(reason); }
    catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
  } finally {
    clearTimeout(timer);
  }
}

function updateAssetBaseName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return path.basename(parsed.pathname || '').toLowerCase();
  } catch (e) {
    return path.basename(raw).toLowerCase();
  }
}

function mergeLatestYmlInstallerDigest(info, latestYmlInfo) {
  if (!info || !latestYmlInfo) return info;
  if (normalizeVersion(info.latestVersion) !== normalizeVersion(latestYmlInfo.latestVersion)) return info;
  const release = info.release || {};
  const asset = release.asset || {};
  const ymlRelease = latestYmlInfo.release || {};
  const ymlAsset = ymlRelease.asset || {};
  if (!asset.downloadUrl || !ymlAsset.downloadUrl) return info;
  const assetName = updateAssetBaseName(asset.name || asset.downloadUrl);
  const ymlName = updateAssetBaseName(ymlAsset.name || ymlAsset.downloadUrl);
  if (assetName && ymlName && assetName !== ymlName) return info;

  if (!asset.sha256 && ymlAsset.sha256) asset.sha256 = ymlAsset.sha256;
  if (!asset.sha512 && ymlAsset.sha512) asset.sha512 = ymlAsset.sha512;
  if (!asset.size && ymlAsset.size) asset.size = ymlAsset.size;
  if (!release.downloadUrl && ymlRelease.downloadUrl) release.downloadUrl = ymlRelease.downloadUrl;
  const urls = [asset.downloadUrl]
    .concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : [])
    .concat(ymlAsset.downloadUrl || '')
    .concat(Array.isArray(ymlAsset.downloadUrls) ? ymlAsset.downloadUrls : []);
  asset.downloadUrls = publicDownloadUrls(uniqueDownloadCandidates(urls));
  release.asset = asset;
  info.release = release;
  return info;
}

async function ensureUpdateInstallerDigest(info) {
  const release = info && info.release ? info.release : {};
  const asset = release.asset || {};
  if (!info || !info.updateAvailable || asset.sha256 || asset.sha512) return info;
  try {
    const latestYmlInfo = await fetchLatestYmlUpdateInfo('installer digest', 5000);
    return mergeLatestYmlInstallerDigest(info, latestYmlInfo);
  } catch (e) {
    return info;
  }
}
function safeUpdateFileName(name, version) {
  const raw = String(name || '').trim() || `Mineradio-${version || APP_VERSION}.exe`;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `Mineradio-${version || APP_VERSION}.exe`;
}
function publicUpdateJob(job) {
  if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' };
  return {
    ok: job.status !== 'error',
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    received: job.received || 0,
    total: job.total || 0,
    speedBps: job.speedBps || 0,
    etaSeconds: job.etaSeconds || 0,
    sourceLabel: job.sourceLabel || '',
    attempt: job.attempt || 0,
    attempts: job.attempts || 0,
    mode: job.mode || 'installer',
    message: job.message || '',
    restartRequired: !!job.restartRequired,
    cached: !!job.cached,
    fileName: job.fileName || '',
    filePath: job.status === 'ready' ? job.filePath : '',
    version: job.version || '',
    releaseUrl: job.releaseUrl || '',
    error: job.error || '',
    errorReason: job.errorReason || '',
    errorDetail: job.errorDetail || '',
    failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function activeUpdateJobFor(version) {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jobs.find(job => job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
}
function trimUpdateJobs() {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  jobs.slice(8).forEach(job => updateDownloadJobs.delete(job.id));
}
async function downloadUpdateAsset(job) {
  const tmpPath = job.filePath + '.download';
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
      },
    });
    if (!resp.ok) throw new Error('Download failed ' + resp.status);

    const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
    job.total = totalHeader || job.total || 0;
    job.received = 0;
    job.progress = 0;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';
    job.updatedAt = Date.now();
    let speedWindowAt = Date.now();
    let speedWindowBytes = 0;

    const writer = fs.createWriteStream(tmpPath);
    const reader = resp.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const buf = Buffer.from(chunk.value);
        job.received += buf.length;
        speedWindowBytes += buf.length;
        const now = Date.now();
        if (now - speedWindowAt >= 900) {
          job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
          speedWindowAt = now;
          speedWindowBytes = 0;
        }
        if (job.total > 0) {
          job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
          job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
        } else {
          const kb = Math.max(1, job.received / 1024);
          job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
        }
        job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
        job.updatedAt = Date.now();
        if (!writer.write(buf)) await once(writer, 'drain');
      }
    } finally {
      writer.end();
      await once(writer, 'finish').catch(() => {});
    }

    if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
    fs.renameSync(tmpPath, job.filePath);
    job.status = 'ready';
    job.progress = 100;
    job.message = '安装包已下载';
    job.updatedAt = Date.now();
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    job.status = 'error';
    job.error = e.message || 'UPDATE_DOWNLOAD_FAILED';
    job.updatedAt = Date.now();
  }
}
function sha512Base64(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}
function sha512Hex(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}
function verifyUpdateBuffer(buffer, job) {
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`);
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
  if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
    throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
  if (expectedSha512) {
    const actualBase64 = sha512Base64(buffer);
    const actualHex = sha512Hex(buffer).toLowerCase();
    if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
    }
  }
}
function verifyUpdateFile(filePath, job) {
  verifyUpdateBuffer(fs.readFileSync(filePath), job);
}
function moveInvalidUpdateFile(filePath, reason) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`);
    fs.renameSync(filePath, invalidPath);
    console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath);
  } catch (e) {
    console.warn('[UpdateDownload] failed to move invalid cached installer:', e.message);
  }
}
function reuseVerifiedInstallerJob(opts) {
  if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null;
  if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null;
  const now = Date.now();
  const stat = fs.statSync(opts.filePath);
  const job = {
    id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'ready',
    progress: 100,
    received: stat.size || 0,
    total: opts.expectedSize || stat.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '本地缓存',
    attempt: 0,
    attempts: opts.attempts || 0,
    mode: 'installer',
    message: '安装包已下载，可直接打开安装',
    fileName: opts.fileName || path.basename(opts.filePath),
    filePath: opts.filePath,
    version: opts.version || '',
    downloadUrl: opts.downloadUrl || '',
    downloadCandidates: opts.downloadCandidates || [],
    expectedSize: opts.expectedSize || 0,
    sha256: opts.sha256 || '',
    sha512: opts.sha512 || '',
    releaseUrl: opts.releaseUrl || '',
    failedAttempts: [],
    cached: true,
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  try {
    verifyUpdateFile(opts.filePath, job);
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    return job;
  } catch (err) {
    moveInvalidUpdateFile(opts.filePath, (err && err.message) || 'cache verification failed');
    return null;
  }
}
function setUpdateJobError(job, err, fallbackMessage) {
  const info = classifyUpdateError(err);
  job.status = 'error';
  job.error = info.code;
  job.errorReason = info.reason;
  job.errorDetail = info.detail;
  job.message = fallbackMessage || info.reason;
  job.updatedAt = Date.now();
}
function prepareUpdateJobAttempt(job, candidate, index, total) {
  job.status = 'downloading';
  job.sourceLabel = candidate.label || '下载线路';
  job.attempt = index + 1;
  job.attempts = total;
  job.received = 0;
  job.speedBps = 0;
  job.etaSeconds = 0;
  job.error = '';
  job.errorReason = '';
  job.errorDetail = '';
  job.updatedAt = Date.now();
}
function ensureMirrorCanBeVerified(job, candidate) {
  if (!candidate || !candidate.mirrored) return;
  if (job.sha256 || job.sha512) return;
  throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available');
}
async function downloadUpdateAssetWithMirrors(job) {
  const tmpPath = job.filePath + '.download';
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      ensureMirrorCanBeVerified(job, candidate);
      prepareUpdateJobAttempt(job, candidate, i, candidates.length);
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';

      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, 14000);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      job.total = totalHeader || job.expectedSize || job.total || 0;
      job.progress = 0;
      job.updatedAt = Date.now();
      let speedWindowAt = Date.now();
      let speedWindowBytes = 0;

      const writer = fs.createWriteStream(tmpPath);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value);
          job.received += buf.length;
          speedWindowBytes += buf.length;
          const now = Date.now();
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
            speedWindowAt = now;
            speedWindowBytes = 0;
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
          } else {
            const kb = Math.max(1, job.received / 1024);
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
          job.updatedAt = Date.now();
          if (!writer.write(buf)) await once(writer, 'drain');
        }
      } finally {
        writer.end();
        await once(writer, 'finish').catch(() => {});
      }

      verifyUpdateFile(tmpPath, job);
      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      fs.renameSync(tmpPath, job.filePath);
      job.status = 'ready';
      job.progress = 100;
      job.etaSeconds = 0;
      job.message = '安装包已下载';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason);
    }
  }
}
function startUpdateDownloadJob(info) {
  const release = info && info.release ? info.release : {};
  const asset = release.asset || {};
  const downloadUrl = release.downloadUrl || asset.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' };

  const version = info.latestVersion || release.version || '';
  const existing = activeUpdateJobFor(version);
  if (existing) return publicUpdateJob(existing);

  const fileName = safeUpdateFileName(asset.name || '', version);
  const filePath = path.join(UPDATE_DOWNLOAD_DIR, fileName);
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []));
  const expectedSize = asset.size || 0;
  const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase();
  const sha512 = normalizeDigest(asset.sha512 || '', 'sha512');
  const cached = reuseVerifiedInstallerJob({
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    attempts: downloadCandidates.length,
  });
  if (cached) return publicUpdateJob(cached);

  const now = Date.now();
  const job = {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: expectedSize,
    mode: 'installer',
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadUpdateAssetWithMirrors(job);
  return publicUpdateJob(job);
}
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function safePatchRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel.includes('\0')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  const root = parts[0];
  if (PATCH_ALLOWED_FILES.has(rel)) return rel;
  if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
  if (/\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i.test(rel)) return '';
  return parts.join('/');
}
function patchTargetPath(rel) {
  const safeRel = safePatchRelativePath(rel);
  if (!safeRel) return null;
  const target = path.resolve(__dirname, safeRel);
  const root = path.resolve(__dirname);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
function decodePatchFile(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
  if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
  return null;
}
function backupPatchTarget(job, rel, target) {
  if (!fs.existsSync(target)) return;
  const backup = path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
}
function writePatchFile(job, file) {
  const rel = safePatchRelativePath(file.path || file.name);
  const target = rel ? patchTargetPath(rel) : null;
  const content = decodePatchFile(file);
  if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
  if (content.length > PATCH_MAX_BYTES) throw new Error('PATCH_FILE_TOO_LARGE');
  const expected = String(file.sha256 || '').trim().toLowerCase();
  const actual = sha256Hex(content);
  if (expected && expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
  backupPatchTarget(job, rel, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.mineradio-patch';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  if (expected && sha256Hex(fs.readFileSync(target)) !== expected) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + rel);
  return rel;
}
function normalizePatchPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
  const type = String(payload.type || payload.kind || '');
  if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
  const from = normalizeVersion(payload.from || payload.baseVersion || '');
  const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH');
  if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID');
  if (!files.length) throw new Error('PATCH_EMPTY');
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
  return { from, to, files, restartRequired: payload.restartRequired !== false };
}
async function downloadAndApplyPatch(job) {
  const chunks = [];
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.mode = 'patch';
    job.message = '正在下载快速补丁';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Patch download failed ' + resp.status);

    job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.total || 0;
    job.received = 0;
    const reader = resp.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buf = Buffer.from(chunk.value);
      job.received += buf.length;
      if (job.received > PATCH_MAX_BYTES) throw new Error('PATCH_TOO_LARGE');
      chunks.push(buf);
      job.progress = job.total > 0
        ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
        : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
      job.updatedAt = Date.now();
    }

    const raw = Buffer.concat(chunks);
    const expectedPatchHash = String(job.sha256 || '').trim().toLowerCase();
    if (expectedPatchHash && sha256Hex(raw) !== expectedPatchHash) throw new Error('PATCH_PACKAGE_HASH_MISMATCH');
    const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    job.version = patch.to;
    job.message = '正在应用快速补丁';
    job.progress = 88;
    job.updatedAt = Date.now();
    const changed = [];
    patch.files.forEach(file => changed.push(writePatchFile(job, file)));
    job.changedFiles = changed;
    job.status = 'ready';
    job.progress = 100;
    job.restartRequired = patch.restartRequired;
    job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
    job.updatedAt = Date.now();
  } catch (e) {
    job.status = 'error';
    job.error = e.message || 'PATCH_APPLY_FAILED';
    job.message = '快速补丁失败，可改用完整安装包';
    job.updatedAt = Date.now();
  }
}
async function downloadPatchBufferFromCandidate(job, candidate, index, total) {
  ensureMirrorCanBeVerified(job, candidate);
  prepareUpdateJobAttempt(job, candidate, index, total);
  job.mode = 'patch';
  job.message = '正在下载快速补丁';
  job.progress = 0;
  job.updatedAt = Date.now();

  const resp = await fetchWithTimeout(candidate.url, {
    headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
  }, 12000);
  if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

  job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0;
  job.received = 0;
  const chunks = [];
  const reader = resp.body.getReader();
  let speedWindowAt = Date.now();
  let speedWindowBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const buf = Buffer.from(chunk.value);
    job.received += buf.length;
    speedWindowBytes += buf.length;
    if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large');
    chunks.push(buf);
    const now = Date.now();
    if (now - speedWindowAt >= 700) {
      job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
      speedWindowAt = now;
      speedWindowBytes = 0;
    }
    job.progress = job.total > 0
      ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
      : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
    job.etaSeconds = job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
    job.updatedAt = Date.now();
  }
  const raw = Buffer.concat(chunks);
  verifyUpdateBuffer(raw, job);
  return raw;
}
async function downloadAndApplyPatchWithMirrors(job) {
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length);
      const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
      job.version = patch.to;
      job.message = '正在应用快速补丁';
      job.progress = 88;
      job.etaSeconds = 0;
      job.updatedAt = Date.now();
      const changed = [];
      patch.files.forEach(file => changed.push(writePatchFile(job, file)));
      job.changedFiles = changed;
      job.status = 'ready';
      job.progress = 100;
      job.restartRequired = patch.restartRequired;
      job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason);
    }
  }
}
function startUpdatePatchJob(info) {
  const release = info && info.release ? info.release : {};
  const patch = release.patch || {};
  const downloadUrl = patch.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' };

  const version = info.latestVersion || release.version || patch.to || '';
  const existing = Array.from(updateDownloadJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .find(job => job.mode === 'patch' && job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
  if (existing) return publicUpdateJob(existing);

  const now = Date.now();
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []));
  const job = {
    id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: patch.size || 0,
    mode: 'patch',
    fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
    filePath: '',
    version,
    downloadUrl,
    downloadCandidates,
    releaseUrl: release.htmlUrl || '',
    expectedSize: patch.size || 0,
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    restartRequired: true,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    message: '等待下载快速补丁',
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadAndApplyPatchWithMirrors(job);
  return publicUpdateJob(job);
}
function readRequestBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) {
        const params = new URLSearchParams(raw);
        const out = {};
        params.forEach((v, k) => { out[k] = v; });
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}
function normalizeApiCode(payload) {
  const body = payload && (payload.body || payload);
  return Number((body && body.code) || (body && body.body && body.body.code) || (payload && payload.status) || 0);
}
function normalizeApiMessage(payload) {
  const body = payload && (payload.body || payload);
  return (body && (body.message || body.msg || body.error)) || (body && body.body && (body.body.message || body.body.msg || body.body.error)) || '';
}
function parseCookieString(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach(part => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}
function serializeCookieObject(obj) {
  return Object.keys(obj || {})
    .filter(k => obj[k] != null && String(obj[k]) !== '')
    .map(k => k + '=' + String(obj[k]))
    .join('; ');
}
function qqCookieObject() {
  return parseCookieString(qqCookie);
}
function normalizeQQUin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
}
function qqCookieUin(obj) {
  obj = obj || qqCookieObject();
  const raw = Number(obj.login_type) === 2 ? (obj.wxuin || obj.uin || obj.p_uin) : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin);
  return normalizeQQUin(raw);
}
function qqCookieMusicKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
}
function qqCookiePlaybackKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
}
function decodeQQCookieValue(value) {
  try { return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim(); }
  catch (e) { return String(value || '').trim(); }
}
function qqCookieNickname(obj, uin) {
  obj = obj || qqCookieObject();
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  const padded = uin ? '0' + uin : '';
  const keys = [
    uin && ('ptnick_' + uin),
    padded && ('ptnick_' + padded),
    'ptnick',
    'nick',
    'nickname',
    'qq_nickname'
  ].filter(Boolean);
  for (const key of keys) {
    if (obj[key]) {
      const nick = decodeQQCookieValue(obj[key]);
      if (nick) return nick;
    }
  }
  const ptnickKey = Object.keys(obj).find(key => /^ptnick_/i.test(key) && obj[key]);
  return ptnickKey ? decodeQQCookieValue(obj[ptnickKey]) : '';
}
function qqCookieAvatar(obj, uin) {
  obj = obj || qqCookieObject();
  const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || '';
  if (direct) return decodeQQCookieValue(direct);
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : '';
}
function normalizeQQCookieInput(cookieText) {
  const obj = parseCookieString(cookieText);
  if (Number(obj.login_type) === 2 && obj.wxuin && !obj.uin) obj.uin = obj.wxuin;
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin;
  if (obj.uin) obj.uin = normalizeQQUin(obj.uin);
  return serializeCookieObject(obj);
}
function playbackRestriction(provider, category, message, action, extra) {
  return {
    provider,
    category,
    action: action || '',
    message,
    ...(extra || {}),
  };
}
function parsePlaybackFlag(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return null;
}
function parsePlaybackNumber(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}
function playbackRequestOptionsFromSearchParams(params) {
  params = params || new URLSearchParams();
  const fee = parsePlaybackNumber(params.get('fee') || params.get('songFee') || params.get('payFee'));
  const previewDuration = parsePlaybackNumber(params.get('previewDuration') || params.get('auditionDuration'));
  const duration = parsePlaybackNumber(params.get('duration') || params.get('durationMs') || params.get('dt') || params.get('expectedDuration') || params.get('expectedDurationMs'));
  return {
    songFee: Number.isFinite(fee) ? Math.max(0, fee) : 0,
    songPlayable: parsePlaybackFlag(params.get('songPlayable') || params.get('playable')),
    trialHint: parsePlaybackFlag(params.get('trialHint') || params.get('trial')) === true,
    previewDuration: Number.isFinite(previewDuration) ? Math.max(0, previewDuration) : 0,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    qqTrialMid: String(params.get('trialMid') || params.get('trialMediaMid') || params.get('qqTrialMid') || '').trim(),
    sodaVid: String(params.get('vid') || params.get('sodaVid') || params.get('videoId') || params.get('video_id') || '').trim(),
  };
}
function playbackRequestFee(options, data) {
  options = options || {};
  data = data || {};
  const values = [
    options.songFee,
    options.fee,
    data.fee,
    data.payFee,
    data.pay_fee,
    data.feeType,
    data.fee_type,
  ];
  let fee = 0;
  for (const value of values) {
    const n = parsePlaybackNumber(value);
    if (Number.isFinite(n) && n > fee) fee = n;
  }
  return fee;
}
function providerHasMembership(provider, status) {
  status = status || {};
  if (provider === 'soda' && (status.hasFreeBenefit || status.has_free_benefit || status.freeBenefit || status.free_benefit)) return true;
  const raw = String(status.vipLevel || status.vip_level || '').toLowerCase();
  const vipType = Number(status.vipType || status.vip_type || status.vip || status.musicVipLevel || status.music_vip_level || status.greenVipLevel || status.green_vip_level || status.luxuryVipLevel || status.luxury_vip_level || status.memberType || status.member_type || status.membershipType || status.membership_type || 0) || 0;
  if (raw === 'vip' || raw === 'svip') return true;
  if (status.isVip === true || status.is_vip === true || status.isSvip === true || status.is_svip === true) return true;
  return vipType > 0;
}
function shouldMarkPlayableAsTrial(provider, options, status, data) {
  options = options || {};
  data = data || {};
  const fee = playbackRequestFee(options, data);
  const hinted = !!options.trialHint || fee > 0 || Number(options.previewDuration || 0) > 0;
  if (!hinted) return false;
  if (provider === 'soda' && status && status.loggedIn && (status.stale || status.quick || status.profileUnavailable)) return false;
  return !providerHasMembership(provider, status);
}
function playableTrialRestriction(provider, fee, status, extra) {
  const label = provider === 'qq' ? 'QQ 音乐' : (provider === 'soda' ? '汽水音乐' : '网易云音乐');
  return playbackRestriction(
    provider,
    'trial_only',
    label + '当前账号未识别到会员，正在播放试听片段',
    'upgrade',
    { fee: Number(fee) || 0, loggedIn: !!(status && status.loggedIn), ...(extra || {}) }
  );
}
function classifyNeteasePlaybackRestriction(lastData, loginInfo) {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn);
  const fee = Number(lastData && lastData.fee);
  const code = Number(lastData && lastData.code);
  const freeTrial = lastData && lastData.freeTrialInfo;
  if (!loggedIn) {
    return playbackRestriction('netease', 'login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee });
  }
  if (freeTrial) {
    return playbackRestriction('netease', 'trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee });
  }
  if (fee === 1) {
    return playbackRestriction('netease', 'vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee });
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('netease', 'paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee });
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('netease', 'copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee });
  }
  return playbackRestriction('netease', 'url_unavailable', '网易云没有返回可播放地址，可能是版权、会员或地区限制', loggedIn ? 'switch_source' : 'login', { code, fee });
}
function classifyQQPlaybackRestriction(info, session) {
  const hasSession = typeof session === 'object' ? !!session.hasSession : !!session;
  const hasPlaybackKey = typeof session === 'object' ? !!session.hasPlaybackKey : hasSession;
  const songFee = Number(session && session.songFee || 0) || 0;
  const hasVip = !!(session && session.hasVip);
  const hasTrial = !!(session && session.hasTrial);
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim();
  const code = Number((info && (info.result || info.code || info.errtype)) || 0);
  const lower = rawMsg.toLowerCase();
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', { code, rawMessage: rawMsg });
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权', 'login', { code, rawMessage: rawMsg, missingPlaybackKey: true });
  }
  if ((code === 104003 || code === 104009 || !code) && songFee > 0 && hasTrial && !hasVip) {
    return playbackRestriction('qq', 'trial_ticket_unavailable', '检测到 QQ 音乐有试听片段，但当前接口没有返回试听播放票据，请重新登录 QQ 音乐后再试', 'login', { code, rawMessage: rawMsg, songFee, hasTrial: true });
  }
  if (code === 104003 && songFee > 0 && !hasVip) {
    return playbackRestriction('qq', 'paid_required', 'QQ 音乐当前版本没有返回完整或试听地址，正在尝试同平台可播版本', 'upgrade', { code, rawMessage: rawMsg, songFee });
  }
  if (code === 104003) {
    return playbackRestriction('qq', 'copyright_unavailable', 'QQ 音乐当前版本没有返回完整或试听地址，已尝试查找同平台可播版本', 'switch_source', { code, rawMessage: rawMsg });
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', { code, rawMessage: rawMsg });
  }
  if (code && code !== 0) {
    return playbackRestriction('qq', 'copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', { code, rawMessage: rawMsg });
  }
  return playbackRestriction('qq', 'url_unavailable', 'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制', 'switch_source', { code, rawMessage: rawMsg });
}
const NETEASE_QUALITY_CANDIDATES = [
  { level: 'jymaster', br: 1999000, label: '超清母带', svip: true },
  { level: 'hires',    br: 1999000, label: '高清臻音' },
  { level: 'lossless', br: 1411000, label: '无损' },
  { level: 'exhigh',   br: 999000,  label: '极高' },
  { level: 'standard', br: 128000,  label: '标准' },
];
const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC', br: 1999000 },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC', br: 1411000 },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3', br: 320000 },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3', br: 128000 },
  { prefix: 'C400', ext: '.m4a', level: 'standard', label: 'AAC/M4A', br: 128000 },
  { prefix: 'RS02', ext: '.mp3', level: 'standard', label: 'QQ 试听 MP3', br: 96000, trial: true },
  { prefix: 'C100', ext: '.m4a', level: 'standard', label: '试听 AAC', br: 96000, trial: true },
  { prefix: 'C200', ext: '.m4a', level: 'standard', label: '试听 AAC', br: 96000, trial: true },
];
function normalizeQualityPreference(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (['jymaster', 'master', 'studio', 'svip'].includes(raw)) return 'jymaster';
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires';
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless';
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh';
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard';
  return 'hires';
}
function qualityCandidatesFrom(target, candidates) {
  target = normalizeQualityPreference(target);
  let start = candidates.findIndex(item => item.level === target);
  if (start < 0) start = 0;
  return candidates.slice(start);
}
function qualityPreferenceRank(level) {
  level = normalizeQualityPreference(level);
  if (level === 'jymaster') return 5;
  if (level === 'hires') return 4;
  if (level === 'lossless') return 3;
  if (level === 'exhigh') return 2;
  if (level === 'standard') return 1;
  return 0;
}
function qualityLevelsAtOrBelow(level) {
  const rank = qualityPreferenceRank(level);
  return ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'].filter(item => qualityPreferenceRank(item) <= rank);
}
function resolvedQualityFromLevelAndBitrate(requestedLevel, br, metaText) {
  const text = String(metaText || '').toLowerCase();
  if (/jy|master|母带|臻品|studio/.test(text)) return 'jymaster';
  if (/hi[-_ ]?res|hires|高解析/.test(text)) return 'hires';
  if (/lossless|flac|sq|无损/.test(text)) return 'lossless';
  if (/exhigh|320|hq|极高|高品/.test(text)) return 'exhigh';
  if (/standard|normal|128|std|标准|aac|m4a/.test(text)) return 'standard';
  br = Number(br) || 0;
  if (br >= 1800000) return 'hires';
  if (br >= 900000) return 'lossless';
  if (br >= 256000) return 'exhigh';
  if (br > 0) return 'standard';
  return normalizeQualityPreference(requestedLevel);
}
function hasNeteaseSvip(loginInfo) {
  return !!(loginInfo && loginInfo.loggedIn && (loginInfo.vipLevel === 'svip' || loginInfo.isSvip || Number(loginInfo.vipType || 0) >= 10));
}
function mapArtists(raw) {
  return (raw || [])
    .map(a => ({ id: a && a.id, name: (a && a.name) || '' }))
    .filter(a => a.name);
}
function mapSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: s.id,
    name: s.name,
    artist: artists.map(a => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: s.dt || s.duration || 0,
    fee: s.fee,
  };
}
function mapNeteaseSongCandidate(item) {
  item = item || {};
  const raw = item.songInfo || item.songData || item.song || item.resource || item.data || item;
  return mapSongRecord(raw);
}
function mapNeteaseSongList(raw, limit) {
  return (Array.isArray(raw) ? raw : [])
    .map(mapNeteaseSongCandidate)
    .filter(song => song.id && song.name)
    .slice(0, limit || 50);
}
function dedupeSongsById(lists, limit) {
  const seen = new Set();
  const out = [];
  lists.forEach(list => {
    (Array.isArray(list) ? list : []).forEach(song => {
      const id = song && song.id;
      if (!id || seen.has(String(id))) return;
      seen.add(String(id));
      out.push(song);
    });
  });
  return out.slice(0, limit || out.length);
}
function shuffledSample(list, limit) {
  const arr = (Array.isArray(list) ? list : []).slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, limit || arr.length);
}
function stableDailySample(list, limit, seed) {
  const now = new Date();
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].join('-');
  return (Array.isArray(list) ? list : [])
    .slice()
    .sort((a, b) => {
      const ak = String((a && (a.provider || a.source || a.type)) || '') + ':' + String((a && (a.sodaId || a.mid || a.id || a.name)) || '');
      const bk = String((b && (b.provider || b.source || b.type)) || '') + ':' + String((b && (b.sodaId || b.mid || b.id || b.name)) || '');
      const ah = crypto.createHash('sha1').update(String(seed || '') + ':' + day + ':' + ak).digest('hex');
      const bh = crypto.createHash('sha1').update(String(seed || '') + ':' + day + ':' + bk).digest('hex');
      return ah.localeCompare(bh);
    })
    .slice(0, limit || 30);
}
function mapDiscoverPlaylist(pl, tag) {
  pl = pl || {};
  const creator = pl.creator || pl.user || {};
  const id = pl.id || pl.resourceId || pl.creativeId;
  return {
    provider: 'netease',
    source: 'netease',
    type: 'playlist',
    id,
    name: pl.name || pl.title || '',
    cover: pl.picUrl || pl.coverImgUrl || pl.coverUrl || pl.uiElement && pl.uiElement.image && pl.uiElement.image.imageUrl || '',
    trackCount: pl.trackCount || pl.songCount || pl.programCount || 0,
    playCount: pl.playCount || pl.playcount || 0,
    creator: creator.nickname || creator.name || '',
    tag: tag || pl.alg || '',
  };
}
function isNeteaseLikedPlaylist(pl) {
  const name = String(pl && pl.name || '').toLowerCase();
  return Number(pl && pl.specialType || 0) === 5 || /我喜欢|喜欢的音乐|liked|favorite/.test(name);
}
async function isUserNeteaseLikedPlaylistId(pid, info) {
  if (!pid || !info || !info.userId) return false;
  try {
    const r = await user_playlist({ uid: info.userId, limit: 100, cookie: userCookie, timestamp: Date.now() });
    const list = (r.body && r.body.playlist) || [];
    return list.some(pl => String(pl && pl.id || '') === String(pid) && isNeteaseLikedPlaylist(pl));
  } catch (err) {
    console.warn('[PlaylistAddSong] liked playlist probe failed:', err.message);
    return false;
  }
}
function chooseRadarPlaylist(playlists) {
  const list = Array.isArray(playlists) ? playlists : [];
  return list.find(pl => /雷达|radar/i.test(String(pl && pl.name || ''))) || list[0] || null;
}

function lowSignalText(value) {
  return String(value || '').trim().toLowerCase();
}

function isLowSignalPodcastItem(item) {
  const name = lowSignalText(item && (item.name || item.title || item.radioName));
  const sub = lowSignalText(item && (item.djName || item.category || item.desc || item.sub));
  const text = name + ' ' + sub;
  return /购买播客|付费精品|qzone|空间背景音乐|背景音乐|四只烤翅|试纸烤翅/i.test(text);
}

function isProviderFavoritePlaylistName(value) {
  const name = String(value || '').trim().toLowerCase();
  return /liked|favorite|heart|love/i.test(name)
    || /\u6211\u559c\u6b22|\u559c\u6b22\u7684\u97f3\u4e50|\u7ea2\u5fc3/.test(name);
}

function isProviderReadonlyPlaylistName(value) {
  const name = String(value || '').trim().toLowerCase();
  return /local\s*upload|douyin|tiktok/i.test(name)
    || /\u672c\u5730\u4e0a\u4f20|\u6296\u97f3\u6536\u85cf\u7684\u97f3\u4e50/.test(name);
}

function isQQFavoritePlaylist(pl) {
  if (!pl) return false;
  if (pl.favorite === true || Number(pl.specialType || pl.special_type || 0) === 5) return true;
  const rawDirId = String(pl.dirid || pl.dir_id || pl.writeId || '').trim();
  if (rawDirId === '201') return true;
  const normalizedQQFavoriteName = String(pl.name || pl.diss_name || pl.dissname || pl.title || '').trim().toLowerCase();
  if (isProviderFavoritePlaylistName(normalizedQQFavoriteName)) return true;
  if (/我喜欢|我的喜欢|喜欢的音乐|liked|favorite|heart/i.test(normalizedQQFavoriteName)) return true;
  const name = String(pl.name || pl.diss_name || pl.dissname || pl.title || '').trim();
  return /我喜欢|我的喜欢|喜欢的音乐/i.test(name);
}

function isQzoneBackgroundPlaylist(pl) {
  const text = String((pl && pl.name || '') + ' ' + (pl && pl.creator || '')).toLowerCase();
  return /qzone|空间|背景音乐/i.test(text);
}

function isPlayableQQMappedSong(song) {
  if (!song || !song.name) return false;
  if (song.provider !== 'qq' && song.source !== 'qq' && song.type !== 'qq') return !!song.id;
  if (song.mid || song.songmid) return true;
  const id = String(song.id || '').trim();
  return !!(id && !/^\d+$/.test(id));
}

function dedupeQQSongLists(lists, limit) {
  const seen = new Set();
  const out = [];
  lists.forEach(list => {
    (Array.isArray(list) ? list : []).forEach(song => {
      if (!isPlayableQQMappedSong(song)) return;
      const key = String(song.mid || song.songmid || song.id || song.name + '|' + song.artist);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(song);
    });
  });
  return out.slice(0, limit || out.length);
}

function qqMusicComm(withAuth) {
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj) || '0';
  const musicKey = qqCookieMusicKey(cookieObj);
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (withAuth && musicKey) comm.authst = musicKey;
  return comm;
}

function qqCSRFToken(withAuth) {
  const cookieObj = qqCookieObject();
  const key = withAuth
    ? (qqCookieMusicKey(cookieObj) || cookieObj.p_skey || cookieObj.skey || cookieObj.p_lkey || cookieObj.lskey || '')
    : (cookieObj.skey || qqCookieMusicKey(cookieObj) || '');
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash += (hash << 5) + key.charCodeAt(i);
  return hash & 0x7fffffff;
}

function looksLikeQQSongItem(item) {
  if (!item || typeof item !== 'object') return false;
  const raw = item.data || item.track_info || item.songInfo || item.songinfo || item.song || item.musicData || item;
  return !!(raw && (
    raw.mid || raw.songmid || raw.songMid ||
    ((raw.songname || raw.name || raw.title) && (raw.singer || raw.singers || raw.singerName || raw.singername || raw.album || raw.albummid || raw.albumMid))
  ));
}

function mapQQSongCandidate(item) {
  item = item || {};
  const raw = item.data || item.track_info || item.songInfo || item.songinfo || item.song || item.musicData || item.track || item;
  return mapQQPlaylistTrack(raw);
}

function mapQQSongList(raw, limit) {
  return (Array.isArray(raw) ? raw : [])
    .map(mapQQSongCandidate)
    .filter(isPlayableQQMappedSong)
    .slice(0, limit || 50);
}

function extractQQSongItemsFromValue(value, limit) {
  const out = [];
  const seen = new Set();
  const max = Math.max(10, (limit || 30) * 4);
  function visit(node, depth) {
    if (!node || out.length >= max || depth > 5) return;
    if (Array.isArray(node)) {
      if (node.some(looksLikeQQSongItem)) {
        node.forEach(item => {
          if (!looksLikeQQSongItem(item)) return;
          const raw = item.data || item.track_info || item.songInfo || item.songinfo || item.song || item.musicData || item;
          const key = String(raw.mid || raw.songmid || raw.songMid || raw.id || raw.songid || raw.songId || raw.name || raw.title || '');
          if (!key || seen.has(key)) return;
          seen.add(key);
          out.push(item);
        });
      } else {
        node.forEach(child => visit(child, depth + 1));
      }
      return;
    }
    if (typeof node !== 'object') return;
    [
      'songlist', 'songList', 'songs', 'song', 'v_song', 'v_songs',
      'list', 'items', 'tracks', 'recommend', 'data', 'vecSong', 'vec_song'
    ].forEach(key => visit(node[key], depth + 1));
  }
  visit(value, 0);
  return out.slice(0, max);
}
async function requireLogin(res) {
  const info = await getLoginInfo();
  if (!info.loggedIn || !info.userId) {
    sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
    return null;
  }
  return info;
}

// ---------- 业务: 搜索 ----------
//   优先用 cloudsearch (新接口, 字段更全, picUrl 更稳定)
//   对于仍然缺失封面的歌曲, 用 song_detail 批量补齐
async function handleSearch(keywords, limit) {
  console.log('[Search]', keywords, 'limit:', limit);
  const result = await cloudsearch({ keywords, limit, cookie: userCookie });
  const songs = result.body && result.body.result && result.body.result.songs ? result.body.result.songs : [];

  let mapped = songs.map(s => {
    return mapSongRecord(s);
  });

  // 兜底: 补齐缺失的封面
  const missing = mapped.filter(s => !s.cover).map(s => s.id);
  if (missing.length) {
    try {
      console.log('[Search] backfilling covers for', missing.length, 'songs');
      const dd = await song_detail({ ids: missing.join(','), cookie: userCookie });
      const songsArr = (dd.body && dd.body.songs) || [];
      const idToPic = {};
      songsArr.forEach(s => {
        const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '';
        if (pic) idToPic[s.id] = pic;
      });
      mapped = mapped.map(s => s.cover ? s : { ...s, cover: idToPic[s.id] || '' });
    } catch (e) { console.warn('[Search] backfill failed:', e.message); }
  }

  return mapped;
}

function mergeDiscoverLists(lists, limit, keyFn) {
  const seen = new Set();
  const merged = [];
  lists.forEach(list => {
    (Array.isArray(list) ? list : []).forEach(item => {
      const key = keyFn ? keyFn(item) : (item && (item.provider || item.source || '') + ':' + (item.id || item.mid || item.name || ''));
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  });
  return merged.slice(0, limit || merged.length);
}

async function handleNeteaseDiscoverHome() {
  const info = await getLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  if (!loggedIn) {
    return {
      provider: 'netease',
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  const tasks = [
    personalized({ limit: 8, cookie: userCookie, timestamp: Date.now() }),
    dj_hot({ limit: 6, offset: 0, cookie: userCookie, timestamp: Date.now() }),
    recommend_resource({ cookie: userCookie, timestamp: Date.now() }),
    recommend_songs({ cookie: userCookie, timestamp: Date.now() }),
    user_playlist({ uid: info.userId, limit: 30, cookie: userCookie, timestamp: Date.now() }),
    personalized_newsong({ limit: 24, cookie: userCookie, timestamp: Date.now() }),
    personal_fm({ cookie: userCookie, timestamp: Date.now() }),
    top_song({ type: 0, cookie: userCookie, timestamp: Date.now() }),
  ];
  const result = await Promise.allSettled(tasks);

  const personalizedBody = result[0].status === 'fulfilled' && result[0].value && result[0].value.body || {};
  const publicPlaylists = (personalizedBody.result || personalizedBody.data || [])
    .map(pl => mapDiscoverPlaylist(pl, '推荐歌单'))
    .filter(pl => pl.id && pl.name)
    .slice(0, 8);

  const podcastBody = result[1].status === 'fulfilled' && result[1].value && result[1].value.body || {};
  const podcastRaw = podcastBody.djRadios || podcastBody.djradios || podcastBody.radios || podcastBody.data || [];
  const podcasts = (Array.isArray(podcastRaw) ? podcastRaw : [])
    .map(mapPodcastRadio)
    .filter(p => p.id && !isLowSignalPodcastItem(p))
    .slice(0, 6);

  let privatePlaylists = [];
  if (result[2].status === 'fulfilled' && result[2].value) {
    const body = result[2].value.body || {};
    const raw = body.recommend || body.data || [];
    privatePlaylists = (Array.isArray(raw) ? raw : [])
      .map(pl => mapDiscoverPlaylist(pl, '私人推荐'))
      .filter(pl => pl.id && pl.name)
      .slice(0, 6);
  }

  let dailySongs = [];
  if (result[3].status === 'fulfilled' && result[3].value) {
    const body = result[3].value.body || {};
    const raw = body.data && (body.data.dailySongs || body.data.recommend) || body.recommend || [];
    dailySongs = mapNeteaseSongList(raw, 30);
  }

  const userPlaylistBody = result[4].status === 'fulfilled' && result[4].value && result[4].value.body || {};
  const userPlaylists = ((userPlaylistBody.playlist || []) || [])
    .map(pl => mapDiscoverPlaylist(pl, '我的歌单'))
    .filter(pl => pl.id && pl.name);
  const likedPlaylist = userPlaylists.find(isNeteaseLikedPlaylist) || null;

  const newsongBody = result[5].status === 'fulfilled' && result[5].value && result[5].value.body || {};
  const personalizedNewSongs = mapNeteaseSongList(newsongBody.result || newsongBody.data || [], 24);

  const fmBody = result[6].status === 'fulfilled' && result[6].value && result[6].value.body || {};
  const fmSongs = mapNeteaseSongList(fmBody.data || fmBody.songs || [], 12);

  const topSongBody = result[7].status === 'fulfilled' && result[7].value && result[7].value.body || {};
  const topNewSongs = mapNeteaseSongList(topSongBody.data || topSongBody.songs || [], 24);
  const newSongs = dedupeSongsById([personalizedNewSongs, topNewSongs], 24);

  const radarPlaylist = chooseRadarPlaylist(privatePlaylists.concat(publicPlaylists));
  let radarSongs = [];
  if (radarPlaylist && radarPlaylist.id) {
    radarSongs = await fetchWeatherPlaylistSongs(radarPlaylist, 36);
  }
  if (!radarSongs.length) radarSongs = dedupeSongsById([dailySongs, fmSongs, newSongs], 24);

  const seedSong = dailySongs[0] || fmSongs[0] || newSongs[0] || radarSongs[0] || null;
  let heartSongs = [];
  let similarSongs = [];
  if (seedSong && seedSong.id) {
    const detailTasks = [
      likedPlaylist && likedPlaylist.id
        ? playmode_intelligence_list({ id: seedSong.id, sid: seedSong.id, pid: likedPlaylist.id, count: 24, cookie: userCookie, timestamp: Date.now() })
        : Promise.resolve(null),
      simi_song({ id: seedSong.id, limit: 24, offset: 0, cookie: userCookie, timestamp: Date.now() }),
    ];
    const detailResult = await Promise.allSettled(detailTasks);
    if (detailResult[0].status === 'fulfilled' && detailResult[0].value) {
      const body = detailResult[0].value.body || {};
      heartSongs = mapNeteaseSongList(body.data || body.recommend || body.songs || [], 24);
    }
    if (detailResult[1].status === 'fulfilled' && detailResult[1].value) {
      const body = detailResult[1].value.body || {};
      similarSongs = mapNeteaseSongList(body.songs || body.data || [], 24);
    }
  }
  if (!heartSongs.length) heartSongs = dedupeSongsById([fmSongs, dailySongs, radarSongs], 24);
  if (!similarSongs.length) similarSongs = dedupeSongsById([dailySongs.slice(1), newSongs, radarSongs], 24);

  const recommendationSongs = shuffledSample(
    dedupeSongsById([dailySongs, radarSongs, newSongs, heartSongs, similarSongs, fmSongs], 90),
    5
  );

  return {
    provider: 'netease',
    loggedIn,
    user: loggedIn ? { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' } : null,
    dailySongs,
    playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
    podcasts,
    radarPlaylist: radarPlaylist || null,
    radarSongs,
    newSongs,
    heartSongs,
    similarSongs,
    recommendationSongs,
    updatedAt: Date.now(),
  };
}

async function handleQQDiscoverHome() {
  const info = await getQQLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  if (!loggedIn) {
    return {
      provider: 'qq',
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      radarSongs: [],
      newSongs: [],
      millionPlaylist: null,
      millionSongs: [],
      artistRoamSongs: [],
      recommendationSongs: [],
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  let playlists = [];
  let dailySongs = [];
  let millionPlaylist = null;
  let millionSongs = [];
  let radarSongs = [];
  let newSongs = [];
  let artistRoamSongs = [];
  try {
    const [listResult, dailyResult, publicPlaylistResult, newSongResult] = await Promise.allSettled([
      handleQQUserPlaylists(),
      qqDailyRecommendSongs(30),
      qqHotPublicPlaylists(16),
      qqToplistSongs(27, 30),
    ]);
    if (listResult.status === 'fulfilled') {
      playlists = (listResult.value && listResult.value.playlists || []).slice(0, 10);
    }
    const favorite = playlists.find(pl => isQQFavoritePlaylist(pl)) || playlists[0] || null;
    if (dailyResult.status === 'fulfilled') dailySongs = dailyResult.value || [];
    if (newSongResult.status === 'fulfilled') newSongs = newSongResult.value || [];

    const publicPlaylists = publicPlaylistResult.status === 'fulfilled' ? (publicPlaylistResult.value || []) : [];
    millionPlaylist = publicPlaylists.find(pl => Number(pl.playCount || 0) >= 1000000) || publicPlaylists[0] || null;
    if (millionPlaylist && millionPlaylist.id) {
      millionSongs = await qqPlaylistSongsById(millionPlaylist.id, 36);
    }

    if (!dailySongs.length && favorite && favorite.id) dailySongs = await qqPlaylistSongsById(favorite.id, 30);
    if (!dailySongs.length) dailySongs = dedupeQQSongLists([newSongs, millionSongs], 30);
    if (!millionSongs.length) millionSongs = dedupeQQSongLists([dailySongs, newSongs], 30);
    if (!newSongs.length) newSongs = await qqSearchSongPool(['QQ音乐 新歌', '新歌推荐'], 24);

    radarSongs = shuffledSample(dedupeQQSongLists([dailySongs.slice(1), millionSongs, newSongs], 80), 30);
    if (!radarSongs.length) radarSongs = dedupeQQSongLists([dailySongs, newSongs, millionSongs], 30);

    artistRoamSongs = await qqArtistRoamSongs([dailySongs[0], radarSongs[0], newSongs[0], millionSongs[0]], 30);
    if (!artistRoamSongs.length) artistRoamSongs = dedupeQQSongLists([radarSongs, newSongs, dailySongs], 30);
  } catch (err) {
    console.warn('[QQDiscoverHome]', err && err.message || err);
  }
  const recommendationSongs = shuffledSample(
    dedupeQQSongLists([dailySongs, millionSongs, radarSongs, newSongs, artistRoamSongs], 100),
    5
  );
  return {
    provider: 'qq',
    loggedIn,
    user: { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' },
    dailySongs,
    playlists,
    podcasts: [],
    radarSongs,
    newSongs,
    millionPlaylist,
    millionSongs,
    artistRoamSongs,
    recommendationSongs,
    mode: 'member',
    updatedAt: Date.now(),
  };
}

async function handleDiscoverHome(provider) {
  provider = String(provider || 'netease').toLowerCase();
  if (provider === 'qq') return handleQQDiscoverHome();
  if (provider === 'soda') return handleSodaDiscoverHome();
  if (provider !== 'all') return handleNeteaseDiscoverHome();
  const [neteaseResult, qqResult, sodaResult] = await Promise.allSettled([
    handleNeteaseDiscoverHome(),
    handleQQDiscoverHome(),
    handleSodaDiscoverHome(),
  ]);
  const ne = neteaseResult.status === 'fulfilled' ? neteaseResult.value : { loggedIn: false, dailySongs: [], playlists: [], podcasts: [], radarSongs: [], newSongs: [], heartSongs: [], similarSongs: [], recommendationSongs: [] };
  const qq = qqResult.status === 'fulfilled' ? qqResult.value : { loggedIn: false, dailySongs: [], playlists: [], podcasts: [], radarSongs: [], newSongs: [], millionSongs: [], artistRoamSongs: [], recommendationSongs: [] };
  const soda = sodaResult.status === 'fulfilled' ? sodaResult.value : { loggedIn: false, dailySongs: [], playlists: [], podcasts: [], radarSongs: [], newSongs: [], heartSongs: [], similarSongs: [], recommendationSongs: [] };
  const loggedIn = !!(ne.loggedIn || qq.loggedIn || soda.loggedIn);
  return {
    provider: 'all',
    loggedIn,
    user: null,
    users: [ne, qq, soda].filter(item => item && item.loggedIn).map(item => item.user).filter(Boolean),
    dailySongs: mergeDiscoverLists([ne.dailySongs, qq.dailySongs, soda.dailySongs], 16),
    dailyByProvider: {
      netease: ne.dailySongs || [],
      qq: qq.dailySongs || [],
      soda: soda.dailySongs || [],
    },
    providerLoggedIn: {
      netease: !!ne.loggedIn,
      qq: !!qq.loggedIn,
      soda: !!soda.loggedIn,
    },
    playlists: mergeDiscoverLists([ne.playlists, qq.playlists, soda.playlists], 14),
    podcasts: mergeDiscoverLists([ne.podcasts, qq.podcasts, soda.podcasts], 8),
    radarSongs: mergeDiscoverLists([ne.radarSongs, qq.radarSongs, soda.radarSongs], 24),
    newSongs: mergeDiscoverLists([ne.newSongs, qq.newSongs, soda.newSongs], 24),
    heartSongs: mergeDiscoverLists([ne.heartSongs, qq.millionSongs, soda.heartSongs], 24),
    similarSongs: mergeDiscoverLists([ne.similarSongs, qq.artistRoamSongs, soda.similarSongs], 24),
    millionSongs: qq.millionSongs || [],
    artistRoamSongs: qq.artistRoamSongs || [],
    recommendationSongs: shuffledSample(mergeDiscoverLists([ne.recommendationSongs, qq.recommendationSongs, soda.recommendationSongs], 40), 5),
    mode: loggedIn ? 'synced' : 'starter',
    updatedAt: Date.now(),
  };
}

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
};

function requestTextDetailed(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const requestOptions = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    if (opts.rejectUnauthorized === false) requestOptions.rejectUnauthorized = false;
    const req = lib.request(u, requestOptions, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400 && !opts.allowHttpError) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          err.headers = response.headers || {};
          reject(err);
          return;
        }
        resolve({
          statusCode: response.statusCode,
          headers: response.headers || {},
          text,
        });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestText(targetUrl, opts, body) {
  return requestTextDetailed(targetUrl, opts, body).then(result => result.text);
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON from ' + targetUrl);
    err.cause = e;
    throw err;
  }
}

const SODA_API_BASE = 'https://api.qishui.com';
const SODA_APP_ID = '386088';
const SODA_APP_NAME = 'luna_pc';
const SODA_APP_VERSION = process.env.SODA_APP_VERSION || '3.5.1';
const SODA_VERSION_CODE = process.env.SODA_VERSION_CODE || '30501';
const SODA_DEFAULT_BUILD_ID = '36.4.0-rs.29.release.main.0';
const SODA_COOKIE_HOST_PATTERNS = [
  '%qishui.com%',
  '%snssdk.com%',
  '%douyin.com%',
  '%bytedance.com%',
  '%iesdouyin.com%',
  '%amemv.com%',
];
const SODA_LOGIN_COOKIE_NAMES = [
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'sid_guard',
  'uid_tt',
  'uid_tt_ss',
  'sid_ucp_v1',
  'ssid_ucp_v1',
  'passport_csrf_token',
  'passport_csrf_token_default',
  'passport_auth_status',
  'passport_auth_status_ss',
  'passport_assist_user',
  'ttwid',
  'odin_tt',
  'n_mh',
  'session_tlb_tag',
  'has_biz_token',
  'is_staff_user',
  'store-region',
  'store-region-src',
  'msToken',
  's_v_web_id',
  'd_ticket',
  'multi_sids',
  'cmpl_token',
];
const SODA_PLAYBACK_SESSION_TTL_MS = 10 * 60 * 1000;
const SODA_LOGIN_INFO_CACHE_MS = 8000;
const SODA_CLIENT_SCAN_CACHE_FILE = process.env.SODA_CLIENT_SCAN_CACHE_FILE || path.join(mineradioUserDataDir(__dirname), 'soda-client-dir.json');
const SODA_CLIENT_SCAN_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const SODA_CLIENT_NEGATIVE_SCAN_CACHE_MS = 60 * 1000;
const SODA_CLIENT_GLOBAL_SCAN_MS = Math.max(3000, Math.min(30000, Number(process.env.SODA_CLIENT_GLOBAL_SCAN_MS) || 12000));
const SODA_USER_DATA_SCAN_CACHE_MS = 60 * 1000;
const SODA_USER_DATA_SCAN_MAX_FILES = Math.max(180, Math.min(600, Number(process.env.SODA_USER_DATA_SCAN_MAX_FILES) || 360));
const SODA_USER_DATA_SCAN_MAX_MS = Math.max(1000, Math.min(15000, Number(process.env.SODA_USER_DATA_SCAN_MAX_MS) || 9000));
const SODA_LOCAL_SYNC_WORKER_TIMEOUT_MS = Math.max(6000, Math.min(45000, Number(process.env.SODA_LOCAL_SYNC_WORKER_TIMEOUT_MS) || 22000));
const SODA_LIMITED_FREE_SCENE_DIVERSION_COLD_START = 2;
let sodaAutoSyncEnabled = true;
let sodaDeviceInfoCache = null;
let sodaNativeSecurity = null;
let sodaLoginInfoCache = null;
let sodaLoginInfoCacheAt = 0;
let sodaLastLocalSync = { checkedAt: 0, clientDir: '', userDataDirs: [], cookieDbs: [], cookieRows: 0, decryptFailures: 0, cookies: 0, localStateCount: 0, encryptedPrefixes: {}, error: '' };
let sodaLastLoginProbe = null;
let sodaOfficialClientDirCache = null;
let sodaUserDataDiscoveryCache = { scannedAt: 0, dirs: [], cookieDbs: [] };
let sodaLocalSyncWorkerPromise = null;
const sodaPlaybackSessions = new Map();
const sodaMediaDurationProbeCache = new Map();
const sodaLimitedFreeInfoCache = new Map();

function sodaErrorMessage(err, fallback) {
  return String(err && (err.message || err.code) || fallback || '').trim();
}

function clearSodaRuntimeCaches(opts) {
  opts = opts || {};
  sodaLoginInfoCache = null;
  sodaLoginInfoCacheAt = 0;
  sodaDeviceInfoCache = null;
  sodaNativeSecurity = null;
  sodaOfficialClientDirCache = null;
  sodaUserDataDiscoveryCache = { scannedAt: 0, dirs: [], cookieDbs: [] };
  sodaLimitedFreeInfoCache.clear();
  sodaLastLocalSync = { checkedAt: 0, clientDir: '', userDataDirs: [], cookieDbs: [], cookieRows: 0, decryptFailures: 0, cookies: 0, localStateCount: 0, encryptedPrefixes: {}, error: '' };
  try { if (typeof sodaChromiumKeyCache !== 'undefined') sodaChromiumKeyCache.clear(); } catch (e) {}
  try { if (typeof sodaDpapiCache !== 'undefined') sodaDpapiCache.clear(); } catch (e) {}
  if (opts.removeStateFiles) {
    for (const file of [SODA_CLIENT_SCAN_CACHE_FILE, SODA_COOKIE_FILE]) {
      try { if (pathExistsFile(file)) fs.unlinkSync(file); } catch (e) {}
    }
  }
}

function uniqueExistingOrder(items) {
  const out = [];
  const seen = new Set();
  (items || []).forEach(item => {
    const value = String(item || '').trim();
    if (!value) return;
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

function expandWindowsEnvVars(value) {
  return String(value || '').replace(/%([^%]+)%/g, (all, name) => process.env[name] || process.env[String(name).toUpperCase()] || all);
}

function normalizeWindowsPathHint(value) {
  let raw = expandWindowsEnvVars(value).trim();
  if (!raw) return '';
  const quoted = raw.match(/^"([^"]+)"/);
  if (quoted) raw = quoted[1];
  else {
    const exe = raw.match(/^([A-Za-z]:\\.*?\.exe)(?:[\s,]|$)/i);
    if (exe) raw = exe[1];
  }
  raw = raw.replace(/^file:\/+/i, '').trim();
  return raw.replace(/[\\/]+$/, '');
}

function installRootFromPathHint(value) {
  const normalized = normalizeWindowsPathHint(value);
  if (!normalized) return '';
  const ext = path.extname(normalized).toLowerCase();
  return ext === '.exe' || ext === '.lnk' ? path.dirname(normalized) : normalized;
}

function sodaExplicitUserDataDirs() {
  const dirs = [];
  function pushDir(dir) {
    if (dir) dirs.push(dir);
  }
  pushDir(process.env.SODA_USER_DATA_DIR);
  return uniqueExistingOrder(dirs);
}

function sodaDefaultUserDataDirs() {
  const dirs = [];
  function pushDir(dir) {
    if (dir) dirs.push(dir);
  }
  if (process.env.APPDATA) pushDir(path.join(process.env.APPDATA, 'SodaMusic'));
  if (process.env.LOCALAPPDATA) pushDir(path.join(process.env.LOCALAPPDATA, 'SodaMusic'));
  if (process.env.USERPROFILE) {
    pushDir(path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'SodaMusic'));
    pushDir(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'SodaMusic'));
  }
  return uniqueExistingOrder(dirs);
}

function sodaStaticUserDataDirs() {
  return uniqueExistingOrder(sodaExplicitUserDataDirs().concat(sodaDefaultUserDataDirs()));
}

function sodaKnownUserDataDirs(opts) {
  opts = opts || {};
  const dirs = sodaStaticUserDataDirs();
  if (opts.discover) {
    dirs.push(...readRunningSodaUserDataDirs());
    dirs.push(...sodaPackagedUserDataDirs());
  }
  if (opts.discover) dirs.push(...sodaDiscoveredUserDataDirs());
  return uniqueExistingOrder(dirs);
}

function sodaUserDataDir() {
  const dirs = sodaKnownUserDataDirs();
  const withDevice = dirs.find(dir => {
    try { return dir && pathExistsFile(path.join(dir, 'DeviceV1')); }
    catch (e) { return false; }
  });
  if (withDevice) return withDevice;
  return dirs.find(dir => {
    try { return dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory(); }
    catch (e) { return false; }
  }) || dirs[0] || '';
}

function readSodaRegistryInstallRoots() {
  if (process.platform !== 'win32') return [];
  const roots = [];
  const hives = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const nameRe = /sodamusic/i;
  function flush(values) {
    const displayName = values.DisplayName || values.Publisher || '';
    const combined = [displayName, values.InstallLocation, values.DisplayIcon, values.UninstallString].filter(Boolean).join(' ');
    if (!nameRe.test(combined)) return;
    [values.InstallLocation, values.DisplayIcon, values.UninstallString].forEach(value => {
      const root = installRootFromPathHint(value);
      if (root) roots.push(root);
    });
  }
  for (const hive of hives) {
    let out = '';
    try {
      out = execFileSync('reg', ['query', hive, '/s'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      continue;
    }
    let values = {};
    String(out || '').split(/\r?\n/).forEach(line => {
      if (/^HKEY_/i.test(line.trim())) {
        flush(values);
        values = {};
        return;
      }
      const match = line.match(/^\s{2,}([^\s]+)\s+REG_\w+\s+(.*)$/);
      if (match) values[match[1]] = match[2].trim();
    });
    flush(values);
  }
  return roots;
}

function readRunningSodaProcessRoots() {
  if (process.platform !== 'win32') return [];
  try {
    const script = "$ErrorActionPreference='SilentlyContinue'; Get-Process | Where-Object { $_.ProcessName -match 'sodamusic' -or $_.Path -match 'SodaMusic' } | ForEach-Object { $_.Path }";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out || '').split(/\r?\n/).map(installRootFromPathHint).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function readRunningSodaUserDataDirs() {
  if (process.platform !== 'win32') return [];
  try {
    const script = "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'sodamusic' -or $_.ExecutablePath -match 'SodaMusic' -or $_.CommandLine -match 'SodaMusic' } | ForEach-Object { $_.CommandLine }";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dirs = [];
    const re = /--(?:user-data-dir|userDataDir|user-data-path)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/ig;
    String(out || '').split(/\r?\n/).forEach(line => {
      let match;
      while ((match = re.exec(line))) {
        const dir = normalizeWindowsPathHint(match[1] || match[2] || match[3] || '');
        if (dir) dirs.push(dir);
      }
      re.lastIndex = 0;
    });
    return uniqueExistingOrder(dirs).filter(pathExistsDir);
  } catch (e) {
    return [];
  }
}

function sodaPackagedUserDataDirs() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return [];
  const packagesRoot = path.join(process.env.LOCALAPPDATA, 'Packages');
  if (!pathExistsDir(packagesRoot)) return [];
  const dirs = [];
  let entries = [];
  try { entries = fs.readdirSync(packagesRoot, { withFileTypes: true }); }
  catch (e) { return []; }
  entries
    .filter(entry => entry.isDirectory() && /soda|luna|qishui|bytedance|douyin|music/i.test(entry.name))
    .slice(0, 24)
    .forEach(entry => {
      const root = path.join(packagesRoot, entry.name);
      [
        ['LocalCache', 'Roaming', 'SodaMusic'],
        ['LocalCache', 'Local', 'SodaMusic'],
        ['RoamingState', 'SodaMusic'],
        ['LocalState', 'SodaMusic'],
      ].forEach(rel => dirs.push(path.join(root, ...rel)));
    });
  return uniqueExistingOrder(dirs).filter(pathExistsDir);
}

function sodaKnownInstallRoots() {
  const roots = [];
  function pushRoot(root) {
    if (root) roots.push(root);
  }
  pushRoot(process.env.SODA_INSTALL_DIR);
  pushRoot(process.env.SODA_CLIENT_DIR);
  const installName = 'SodaMusic';
  if (process.env.LOCALAPPDATA) {
    pushRoot(path.join(process.env.LOCALAPPDATA, 'Programs', installName));
    pushRoot(path.join(process.env.LOCALAPPDATA, installName));
  }
  for (const programRoot of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
    if (!programRoot) continue;
    pushRoot(path.join(programRoot, installName));
  }
  readSodaRegistryInstallRoots().forEach(pushRoot);
  readRunningSodaProcessRoots().forEach(pushRoot);
  return uniqueExistingOrder(roots);
}

function compareVersionText(a, b) {
  const aa = String(a || '').split(/[^\d]+/).map(n => Number(n) || 0);
  const bb = String(b || '').split(/[^\d]+/).map(n => Number(n) || 0);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    if ((aa[i] || 0) !== (bb[i] || 0)) return (aa[i] || 0) - (bb[i] || 0);
  }
  return String(a || '').localeCompare(String(b || ''));
}

function sodaBdticketNodePath(versionDir) {
  return versionDir ? path.join(versionDir, 'resources', 'app.asar.unpacked', 'bdticket.node') : '';
}

function sodaBdmsNodePath(versionDir) {
  return versionDir ? path.join(versionDir, 'resources', 'app.asar.unpacked', 'bdms.node') : '';
}

function sodaDeviceNodePath(versionDir) {
  return versionDir ? path.join(versionDir, 'resources', 'app.asar.unpacked', 'device.node') : '';
}

function isSodaOfficialClientDir(versionDir) {
  try {
    return !!versionDir
      && fs.existsSync(sodaBdticketNodePath(versionDir))
      && fs.existsSync(sodaBdmsNodePath(versionDir));
  } catch (e) {
    return false;
  }
}

function isSodaNativeModuleDir(nativeDir) {
  try {
    return !!nativeDir
      && fs.existsSync(path.join(nativeDir, 'bdticket.node'))
      && fs.existsSync(path.join(nativeDir, 'bdms.node'));
  } catch (e) {
    return false;
  }
}

function sodaClientDirFromNativeModuleDir(nativeDir) {
  const normalized = normalizeWindowsPathHint(nativeDir);
  if (!normalized) return '';
  const unpacked = normalized;
  const resources = path.dirname(unpacked);
  return path.dirname(resources);
}

function sodaClientDirFromNativeNodePath(nodePath) {
  const normalized = normalizeWindowsPathHint(nodePath);
  return normalized ? sodaClientDirFromNativeModuleDir(path.dirname(normalized)) : '';
}

function readSodaClientScanCache() {
  try {
    if (!fs.existsSync(SODA_CLIENT_SCAN_CACHE_FILE)) return '';
    const data = JSON.parse(fs.readFileSync(SODA_CLIENT_SCAN_CACHE_FILE, 'utf8'));
    const dir = String(data && data.clientDir || '');
    const scannedAt = Number(data && data.scannedAt) || 0;
    if (!dir || Date.now() - scannedAt > SODA_CLIENT_SCAN_CACHE_MS) return '';
    return isSodaOfficialClientDir(dir) ? dir : '';
  } catch (e) {
    return '';
  }
}

function writeSodaClientScanCache(clientDir) {
  try {
    writePrivateStateFile(SODA_CLIENT_SCAN_CACHE_FILE, JSON.stringify({
      clientDir: clientDir || '',
      scannedAt: Date.now(),
    }, null, 2));
  } catch (e) {}
}

function windowsFixedDriveRoots() {
  if (process.platform !== 'win32') return [];
  let roots = [];
  try {
    const script = "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 -or $_.DriveType -eq 2 } | ForEach-Object { $_.DeviceID + '\\' }";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    roots = String(out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (e) {}
  if (!roots.length) {
    for (let code = 67; code <= 90; code++) {
      const root = String.fromCharCode(code) + ':\\';
      try { if (fs.existsSync(root)) roots.push(root); } catch (e) {}
    }
  }
  return uniqueExistingOrder(roots).sort((a, b) => {
    const ac = /^c:\\?$/i.test(a) ? 1 : 0;
    const bc = /^c:\\?$/i.test(b) ? 1 : 0;
    return ac - bc || a.localeCompare(b);
  });
}

function shouldSkipSodaGlobalScanDir(dir, name) {
  const lower = String(name || path.basename(dir) || '').toLowerCase();
  if (!lower) return false;
  if (lower === '$recycle.bin' || lower === 'system volume information' || lower === 'recovery') return true;
  if (lower === 'windows' || lower === 'node_modules' || lower === '.git' || lower === '.svn') return true;
  return false;
}

function sodaScanPriority(name) {
  const lower = String(name || '').toLowerCase();
  if (lower === 'sodamusic') return 0;
  if (lower === 'resources') return 1;
  if (/program|install|app|music|soft|software|\u8f6f\u4ef6|\u97f3\u4e50/.test(lower)) return 2;
  return 5;
}

function findSodaClientDirsByGlobalScan() {
  if (process.platform !== 'win32') return [];
  const deadline = Date.now() + SODA_CLIENT_GLOBAL_SCAN_MS;
  const candidates = [];
  const seenCandidates = new Set();
  const roots = windowsFixedDriveRoots();
  function pushCandidate(dir) {
    if (!dir) return;
    const key = path.resolve(dir).toLowerCase();
    if (seenCandidates.has(key)) return;
    if (!isSodaOfficialClientDir(dir)) return;
    seenCandidates.add(key);
    candidates.push(dir);
  }
  function pushNativeModuleCandidate(nativeDir) {
    if (!isSodaNativeModuleDir(nativeDir)) return;
    pushCandidate(sodaClientDirFromNativeModuleDir(nativeDir));
  }
  const queuedDirs = new Set();
  const urgentQueue = [];
  const normalQueue = [];
  let urgentCursor = 0;
  let normalCursor = 0;
  function enqueue(dir, urgent) {
    if (!dir) return;
    let key = '';
    try { key = path.resolve(dir).toLowerCase(); }
    catch (e) { return; }
    if (queuedDirs.has(key)) return;
    queuedDirs.add(key);
    (urgent ? urgentQueue : normalQueue).push(dir);
  }
  roots.forEach(root => enqueue(root, false));
  while ((urgentCursor < urgentQueue.length || normalCursor < normalQueue.length) && Date.now() <= deadline && !candidates.length) {
    const dir = urgentCursor < urgentQueue.length ? urgentQueue[urgentCursor++] : normalQueue[normalCursor++];
    if (!dir) continue;
    pushCandidate(dir);
    pushNativeModuleCandidate(dir);
    if (candidates.length) break;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { continue; }
    const dirs = [];
    let hasBdticket = false;
    let hasBdms = false;
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (entry.isFile()) {
        if (lower === 'bdticket.node') hasBdticket = true;
        else if (lower === 'bdms.node') hasBdms = true;
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (shouldSkipSodaGlobalScanDir(path.join(dir, entry.name), entry.name)) continue;
      dirs.push(entry.name);
    }
    if (hasBdticket && hasBdms) pushNativeModuleCandidate(dir);
    if (candidates.length) break;
    dirs.sort((a, b) => sodaScanPriority(a) - sodaScanPriority(b) || a.localeCompare(b));
    for (const name of dirs) {
      const child = path.join(dir, name);
      const lower = name.toLowerCase();
      if (lower === 'resources') pushCandidate(dir);
      else if (lower === 'app.asar.unpacked') pushNativeModuleCandidate(child);
      if (candidates.length) break;
      enqueue(child, sodaScanPriority(name) <= 1);
    }
  }
  candidates.sort((a, b) => compareVersionText(path.basename(b), path.basename(a)));
  return candidates;
}

function resolveSodaOfficialClientDir(opts) {
  opts = opts || {};
  const explicitNode = process.env.SODA_BDTICKET_NODE || process.env.SODA_BDMS_NODE;
  if (explicitNode) {
    const versionDir = sodaClientDirFromNativeNodePath(explicitNode);
    if (isSodaOfficialClientDir(versionDir)) return versionDir;
  }
  if (sodaOfficialClientDirCache) {
    const cachedAge = Date.now() - (sodaOfficialClientDirCache.scannedAt || 0);
    if (sodaOfficialClientDirCache.clientDir && isSodaOfficialClientDir(sodaOfficialClientDirCache.clientDir)) return sodaOfficialClientDirCache.clientDir;
    if (!sodaOfficialClientDirCache.clientDir && opts.allowGlobalScan === false && cachedAge < SODA_CLIENT_NEGATIVE_SCAN_CACHE_MS) return '';
  }
  const persistentCache = readSodaClientScanCache();
  if (persistentCache) {
    sodaOfficialClientDirCache = { clientDir: persistentCache, scannedAt: Date.now() };
    return persistentCache;
  }
  const candidates = [];
  for (const root of sodaKnownInstallRoots()) {
    try {
      if (!root || !fs.existsSync(root)) continue;
      if (isSodaOfficialClientDir(root)) candidates.push(root);
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        if (isSodaOfficialClientDir(dir)) candidates.push(dir);
      }
    } catch (e) {}
  }
  if (!candidates.length && opts.allowGlobalScan !== false) {
    findSodaClientDirsByGlobalScan().forEach(dir => candidates.push(dir));
  }
  candidates.sort((a, b) => compareVersionText(path.basename(b), path.basename(a)));
  const resolved = candidates[0] || '';
  sodaOfficialClientDirCache = { clientDir: resolved, scannedAt: Date.now() };
  if (resolved) writeSodaClientScanCache(resolved);
  return resolved;
}

function readSodaBuildId(versionDir) {
  const file = versionDir ? path.join(versionDir, 'version') : '';
  try {
    const text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    return text || SODA_DEFAULT_BUILD_ID;
  } catch (e) {
    return SODA_DEFAULT_BUILD_ID;
  }
}

function sodaUserAgent(opts) {
  opts = opts || {};
  const versionDir = sodaNativeSecurity && sodaNativeSecurity.clientDir || (opts.noClientScan ? '' : resolveSodaOfficialClientDir({ allowGlobalScan: false }));
  const buildId = process.env.SODA_BUILD_ID || readSodaBuildId(versionDir);
  return `LunaPC/${SODA_APP_VERSION}(${buildId || SODA_DEFAULT_BUILD_ID})`;
}

function sodaBdticketSettings() {
  const reePath = [
    '/luna/pc/track_v2/',
    '/luna/track_v2/',
    '/luna/h5/track_v2/',
    '/luna/pc/me/collection/media/',
    '/luna/pc/user/me/privacy/setting/',
    '/luna/pc/me/collection/playlist/',
    '/luna/pc/me/collection/album/',
    '/luna/pc/me/follow/',
    '/luna/pc/me/collection/artist/',
    '/webcast/room/create/',
    '/web/api/media/user/info/',
    '/passport/token/beat/web/',
  ];
  return {
    session_guard_config: {
      enable: true,
      ree_path: reePath,
      ree_path_prefix: [],
      ree_exclude_path: [],
      ree_exclude_path_prefix: [],
      ree_enable_symmetric: true,
      config_version: '20251029.1',
    },
    enable_full_path_track: true,
  };
}

function readSodaDeviceInfoFresh() {
  const dirs = uniqueExistingOrder(
    (sodaLastLocalSync.userDataDirs || [])
      .concat(sodaUserDataDiscoveryCache.dirs || [])
      .concat(sodaKnownUserDataDirs({ discover: false }))
  );
  for (const dir of dirs) {
    const file = dir ? path.join(dir, 'DeviceV1') : '';
    if (!pathExistsFile(file)) continue;
    try {
      const raw = fs.readFileSync(file);
      let text = '';
      try { text = zlib.gunzipSync(raw).toString('utf8'); }
      catch (e1) {
        try { text = zlib.inflateSync(raw).toString('utf8'); }
        catch (e2) { text = raw.toString('utf8'); }
      }
      return JSON.parse(text.replace(/\u0000/g, '').trim());
    } catch (e) {
      continue;
    }
  }
  return {};
}

function initSodaNativeSecurity() {
  if (sodaNativeSecurity && sodaNativeSecurity.ready) return sodaNativeSecurity;
  const state = sodaNativeSecurity || { ready: false, bdms: null, bdticket: null, device: null, clientDir: '', bdticketStarted: false, bdmsInitedForDevice: '', errors: {} };
  state.errors = {};
  sodaNativeSecurity = state;
  const clientDir = resolveSodaOfficialClientDir({ allowGlobalScan: false });
  state.clientDir = clientDir;
  if (!clientDir) {
    state.errors.clientDir = 'SODA_CLIENT_NOT_FOUND';
    return state;
  }
  try {
    if (!state.bdms) state.bdms = require(sodaBdmsNodePath(clientDir));
  } catch (e) {
    state.bdms = null;
    state.errors.bdms = sodaErrorMessage(e, 'BDMS_LOAD_FAILED');
  }
  try {
    if (!state.bdticket) {
      state.bdticket = require(sodaBdticketNodePath(clientDir));
      state.bdticket.registerEventEmitter((name, data, callback) => {
        if (name === 'pc_request_cert') {
          sodaRequestClientCert(data, callback).catch(err => {
            try {
              if (typeof callback === 'function') callback({ data: {} }, '', { httpStatusCode: 500, message: err && err.message || 'client cert failed' });
            } catch (e) {}
          });
        }
      });
    }
    if (state.bdticket && !state.bdticketStarted) {
      state.bdticket.startBDTicket(sodaUserDataDir());
      state.bdticketStarted = true;
    }
    if (state.bdticket) state.bdticket.refreshSettings(sodaBdticketSettings());
  } catch (e) {
    state.bdticket = null;
    state.errors.bdticket = sodaErrorMessage(e, 'BDTICKET_LOAD_FAILED');
  }
  try {
    const devicePath = sodaDeviceNodePath(clientDir);
    if (!fs.existsSync(devicePath)) {
      state.errors.device = 'DEVICE_NODE_NOT_FOUND';
    } else if (!state.device) {
      state.device = require(devicePath);
    }
  } catch (e) {
    state.device = null;
    state.errors.device = sodaErrorMessage(e, 'DEVICE_LOAD_FAILED');
  }
  state.ready = !!(state.bdms || state.bdticket || state.device);
  return state;
}

function sodaPlaybackSignatureReady(native) {
  native = native || initSodaNativeSecurity();
  const device = readSodaDeviceInfo();
  return !!(native && native.bdms && device && device.did);
}

async function ensureSodaPlaybackSignatureReady(opts) {
  opts = opts || {};
  let native = initSodaNativeSecurity();
  if (sodaPlaybackSignatureReady(native)) return true;
  resolveSodaOfficialClientDir({ allowGlobalScan: opts.allowGlobalScan !== false });
  sodaNativeSecurity = null;
  native = initSodaNativeSecurity();
  if (sodaPlaybackSignatureReady(native)) return true;
  if (opts.syncLocal !== false) {
    await refreshSodaCookieFromClientAsync(true, {
      detectClient: true,
      allowGlobalScan: opts.allowGlobalScan !== false,
    });
    sodaDeviceInfoCache = null;
    sodaNativeSecurity = null;
    native = initSodaNativeSecurity();
    if (sodaPlaybackSignatureReady(native)) return true;
  }
  return false;
}

function sodaTrackV2NeedsClientSignature(body) {
  const code = Number(body && (body.status_code || body.statusCode || body.code || body.status));
  if (code === 1000062) return true;
  const msg = sodaApiErrorMessage(body, '').toLowerCase();
  return /signature|bdms|bdticket|official client|client signature/.test(msg);
}

function sodaNativeDevice() {
  const native = initSodaNativeSecurity();
  if (native.device && typeof native.device.decodeSpade === 'function') return native.device;
  const clientDir = native.clientDir || resolveSodaOfficialClientDir({ allowGlobalScan: false });
  try {
    const devicePath = clientDir ? sodaDeviceNodePath(clientDir) : '';
    native.errors = native.errors || {};
    if (!devicePath || !fs.existsSync(devicePath)) {
      native.errors.device = 'DEVICE_NODE_NOT_FOUND';
    } else {
      native.device = require(devicePath);
      if (!native.device || typeof native.device.decodeSpade !== 'function') native.errors.device = 'DEVICE_DECODER_API_MISSING';
    }
  } catch (e) {
    native.device = null;
    native.errors = native.errors || {};
    native.errors.device = sodaErrorMessage(e, 'DEVICE_LOAD_FAILED');
  }
  return native.device && typeof native.device.decodeSpade === 'function' ? native.device : null;
}

function sodaPlaybackNativeStatus(opts) {
  opts = opts || {};
  if (opts.forceScan) {
    resolveSodaOfficialClientDir({ allowGlobalScan: true });
    sodaNativeSecurity = null;
  }
  const native = initSodaNativeSecurity();
  const clientDir = native.clientDir || resolveSodaOfficialClientDir({ allowGlobalScan: false });
  const devicePath = clientDir ? sodaDeviceNodePath(clientDir) : '';
  const deviceInfo = readSodaDeviceInfo();
  const decoder = sodaNativeDevice();
  const errors = { ...(native.errors || {}) };
  const clientDetected = !!(clientDir && isSodaOfficialClientDir(clientDir));
  const status = {
    clientDetected,
    clientDirDetected: clientDetected,
    clientDir: clientDir || '',
    bdmsReady: !!native.bdms,
    bdticketReady: !!native.bdticket,
    deviceNodeDetected: !!(devicePath && fs.existsSync(devicePath)),
    deviceDecoderReady: !!decoder,
    deviceInfoReady: !!(deviceInfo && deviceInfo.did),
    apiSignatureReady: !!(native.bdms && deviceInfo && deviceInfo.did),
    errors,
  };
  status.playbackKeyReady = !!(status.apiSignatureReady && status.deviceDecoderReady);
  status.ready = status.playbackKeyReady;
  if (status.playbackKeyReady) status.message = '';
  else if (!status.clientDetected) status.message = '\u672a\u68c0\u6d4b\u5230\u6c7d\u6c34\u97f3\u4e50\u5b98\u65b9\u5ba2\u6237\u7aef\uff0c\u8bf7\u5148\u5b89\u88c5\u5e76\u6253\u5f00\u6c7d\u6c34\u97f3\u4e50';
  else if (!status.deviceInfoReady) status.message = '\u5df2\u68c0\u6d4b\u5230\u6c7d\u6c34\u5ba2\u6237\u7aef\uff0c\u4f46\u672a\u8bfb\u5230\u672c\u673a\u8bbe\u5907\u4fe1\u606f\uff0c\u8bf7\u6253\u5f00\u6c7d\u6c34\u97f3\u4e50\u540e\u91cd\u65b0\u540c\u6b65';
  else if (!status.bdmsReady) status.message = '\u5df2\u8bc6\u522b\u6c7d\u6c34\u8d26\u53f7\uff0c\u4f46\u5b98\u65b9\u5ba2\u6237\u7aef\u64ad\u653e\u7b7e\u540d\u6a21\u5757\u672a\u5c31\u7eea';
  else if (!status.deviceNodeDetected) status.message = '\u5df2\u8bc6\u522b\u6c7d\u6c34\u8d26\u53f7\uff0c\u4f46\u5b98\u65b9\u5ba2\u6237\u7aef\u7f3a\u5c11\u64ad\u653e\u89e3\u7801\u6a21\u5757';
  else if (!status.deviceDecoderReady) status.message = '\u5df2\u8bc6\u522b\u6c7d\u6c34\u8d26\u53f7\uff0c\u4f46\u672c\u673a\u6c7d\u6c34\u64ad\u653e\u89e3\u7801\u6a21\u5757\u672a\u5c31\u7eea';
  else status.message = '\u6c7d\u6c34\u64ad\u653e\u6388\u6743\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65\u6c7d\u6c34\u97f3\u4e50\u8d26\u53f7';
  return status;
}

function appendSodaPlaybackStatus(info, opts) {
  const playback = sodaPlaybackNativeStatus({ forceScan: !!(opts && opts.forceScan) });
  return {
    ...(info || {}),
    playbackKeyReady: !!playback.playbackKeyReady,
    playbackReady: !!playback.ready,
    playbackMessage: playback.message || '',
    playbackDiagnostics: playback,
  };
}

function sodaDecoderUnavailableError(status) {
  status = status || sodaPlaybackNativeStatus({ forceScan: true });
  const err = new Error(status.message || '\u6c7d\u6c34\u64ad\u653e\u89e3\u7801\u6a21\u5757\u672a\u5c31\u7eea');
  err.code = 'SODA_DECODER_UNAVAILABLE';
  err.category = 'soda_decoder_unavailable';
  err.sodaPlaybackStatus = status;
  return err;
}

function isSodaDecoderUnavailableError(err) {
  const text = String(err && (err.code || err.category || err.message) || '').toLowerCase();
  return text.includes('soda_decoder_unavailable') || text.includes('soda device decoder is unavailable') || text.includes('device decoder');
}

function sodaCookieObject() {
  return parseCookieString(sodaCookie);
}

function sodaCookieHasLoginTicket(obj) {
  obj = obj || sodaCookieObject();
  return !!(
    obj.sessionid
    || obj.sessionid_ss
    || obj.sid_tt
    || obj.uid_tt
    || obj.uid_tt_ss
    || obj.sid_guard
    || obj.sid_ucp_v1
    || obj.ssid_ucp_v1
    || obj.passport_auth_status
    || obj.passport_auth_status_ss
    || obj.passport_assist_user
    || obj.multi_sids
    || obj.cmpl_token
    || obj.n_mh
    || obj.session_tlb_tag
    || obj.odin_tt
    || obj.d_ticket
  );
}

function pathExistsFile(file) {
  try { return !!file && fs.existsSync(file) && fs.statSync(file).isFile(); }
  catch (e) { return false; }
}

function pathExistsDir(dir) {
  try { return !!dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory(); }
  catch (e) { return false; }
}

function fileNameEquals(a, b) {
  return process.platform === 'win32'
    ? String(a || '').toLowerCase() === String(b || '').toLowerCase()
    : String(a || '') === String(b || '');
}

function findFilesByName(root, fileName, maxDepth, maxResults, out, deadline) {
  out = out || [];
  if (deadline && Date.now() > deadline) return out;
  if (!pathExistsDir(root) || maxDepth < 0 || out.length >= maxResults) return out;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return out; }
  entries.sort((a, b) => sodaUserDataPathScore(path.join(root, a.name)) - sodaUserDataPathScore(path.join(root, b.name)) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (deadline && Date.now() > deadline) break;
    if (out.length >= maxResults) break;
    const full = path.join(root, entry.name);
    if (entry.isFile() && fileNameEquals(entry.name, fileName)) {
      out.push(full);
      continue;
    }
    if (!entry.isDirectory() || maxDepth <= 0) continue;
    if (/^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|blob_storage|Service Worker|Session Storage|TTNet|TTNetCache|logs?|Temp|Crashpad|Crash Reports)$/i.test(entry.name)) continue;
    findFilesByName(full, fileName, maxDepth - 1, maxResults, out, deadline);
  }
  return out;
}

function sodaUserDataScanRoots() {
  const roots = [];
  function pushRoot(root) {
    if (root && pathExistsDir(root)) roots.push(root);
  }
  pushRoot(process.env.SODA_USER_DATA_ROOT);
  for (const dir of sodaStaticUserDataDirs()) pushRoot(dir);
  if (process.env.APPDATA) pushRoot(process.env.APPDATA);
  if (process.env.LOCALAPPDATA) pushRoot(process.env.LOCALAPPDATA);
  readRunningSodaUserDataDirs().forEach(pushRoot);
  sodaPackagedUserDataDirs().forEach(pushRoot);
  const clientDir = sodaOfficialClientDirCache && sodaOfficialClientDirCache.clientDir || '';
  if (clientDir) {
    pushRoot(clientDir);
    pushRoot(path.dirname(clientDir));
    pushRoot(path.dirname(path.dirname(clientDir)));
  }
  return uniqueExistingOrder(roots);
}

function sodaUserDataPathScore(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (/[\\/]appdata[\\/]roaming[\\/]sodamusic[\\/]/.test(lower) || /[\\/]appdata[\\/]roaming[\\/]sodamusic$/.test(lower)) return 0;
  if (/bytedance|douyin|electron|appdata[\\/]local[\\/]programs/.test(lower)) return 1;
  if (/chrome|edge|brave|vivaldi|firefox|browser/.test(lower)) return 6;
  return 3;
}

function sodaUserDataDirFromCookieDb(dbPath) {
  const dbDir = path.dirname(dbPath || '');
  let cursor = dbDir;
  for (let i = 0; cursor && i < 9; i++) {
    if (pathExistsFile(path.join(cursor, 'DeviceV1')) || pathExistsFile(path.join(cursor, 'Local State')) || pathExistsDir(path.join(cursor, 'LunaCacheV2'))) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (!parent || parent === cursor) break;
    cursor = parent;
  }
  if (/^network$/i.test(path.basename(dbDir))) {
    const profileDir = path.dirname(dbDir);
    const profileName = path.basename(profileDir).toLowerCase();
    if (/^(default|profile\s*\d+|persist|persist_|persist:)/i.test(profileName)) {
      const parent = path.dirname(profileDir);
      if (/^partitions$/i.test(path.basename(parent))) return path.dirname(parent);
      return parent;
    }
    return profileDir;
  }
  return dbDir;
}

function sodaCookieDbHasSodaRows(dbPath) {
  try {
    return readSodaCookieRows(dbPath).length > 0;
  } catch (e) {
    return false;
  }
}

function scanSodaUserDataLocationsFresh() {
  const deadline = Date.now() + SODA_USER_DATA_SCAN_MAX_MS;
  const cookieDbs = [];
  const dirs = [];
  const seenCookieDbs = new Set();
  const seenDirs = new Set();
  function pushDir(dir) {
    if (!dir || !pathExistsDir(dir)) return;
    const key = path.resolve(dir).toLowerCase();
    if (seenDirs.has(key)) return;
    seenDirs.add(key);
    dirs.push(dir);
  }
  function pushCookieDb(dbPath) {
    if (!dbPath || !pathExistsFile(dbPath)) return;
    const key = path.resolve(dbPath).toLowerCase();
    if (seenCookieDbs.has(key)) return;
    seenCookieDbs.add(key);
    if (!sodaCookieDbHasSodaRows(dbPath)) return;
    cookieDbs.push(dbPath);
    pushDir(sodaUserDataDirFromCookieDb(dbPath));
  }
  for (const root of sodaUserDataScanRoots()) {
    if (Date.now() > deadline) break;
    for (const dbPath of findFilesByName(root, 'Cookies', 5, SODA_USER_DATA_SCAN_MAX_FILES, [], deadline)) pushCookieDb(dbPath);
    if (Date.now() > deadline) break;
    for (const deviceFile of findFilesByName(root, 'DeviceV1', 4, 48, [], deadline)) pushDir(path.dirname(deviceFile));
  }
  cookieDbs.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; }
    catch (e) { return 0; }
  }).sort((a, b) => sodaUserDataPathScore(a) - sodaUserDataPathScore(b));
  dirs.sort((a, b) => {
    const ad = pathExistsFile(path.join(a, 'DeviceV1')) ? 0 : 1;
    const bd = pathExistsFile(path.join(b, 'DeviceV1')) ? 0 : 1;
    return ad - bd || sodaUserDataPathScore(a) - sodaUserDataPathScore(b);
  });
  return { dirs, cookieDbs };
}

function sodaUserDataDiscovery() {
  const now = Date.now();
  if (sodaUserDataDiscoveryCache.scannedAt && now - sodaUserDataDiscoveryCache.scannedAt < SODA_USER_DATA_SCAN_CACHE_MS) {
    return sodaUserDataDiscoveryCache;
  }
  const fresh = scanSodaUserDataLocationsFresh();
  sodaUserDataDiscoveryCache = {
    scannedAt: now,
    dirs: fresh.dirs || [],
    cookieDbs: fresh.cookieDbs || [],
  };
  return sodaUserDataDiscoveryCache;
}

function sodaDiscoveredUserDataDirs() {
  return sodaUserDataDiscovery().dirs || [];
}

function sodaDiscoveredCookieDbs() {
  return sodaUserDataDiscovery().cookieDbs || [];
}

function sodaCookieDbCandidates(opts) {
  opts = opts || {};
  const includeDiscovery = !!opts.discover;
  const directRelatives = [
    ['Network', 'Cookies'],
    ['Default', 'Network', 'Cookies'],
    ['User Data', 'Default', 'Network', 'Cookies'],
  ];
  const candidates = [];
  if (includeDiscovery) sodaDiscoveredCookieDbs().forEach(dbPath => candidates.push(dbPath));
  for (const dir of sodaKnownUserDataDirs({ discover: includeDiscovery })) {
    for (const rel of directRelatives) candidates.push(path.join(dir, ...rel));
    findFilesByName(dir, 'Cookies', 4, 16, candidates);
  }
  return uniqueExistingOrder(candidates)
    .filter(pathExistsFile)
    .sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; }
      catch (e) { return 0; }
    })
    .sort((a, b) => sodaUserDataPathScore(a) - sodaUserDataPathScore(b));
}

const sodaChromiumKeyCache = new Map();
const sodaDpapiCache = new Map();

function bufferFromSqliteBlob(value) {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.alloc(0);
}

function bufferFromHex(value) {
  const hex = String(value || '').trim();
  if (!hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return Buffer.alloc(0);
  return Buffer.from(hex, 'hex');
}

function windowsDpapiUnprotect(input) {
  const encrypted = bufferFromSqliteBlob(input);
  if (process.platform !== 'win32' || !encrypted.length) return null;
  const cacheKey = encrypted.toString('base64');
  if (sodaDpapiCache.has(cacheKey)) return sodaDpapiCache.get(cacheKey);
  try {
    const script = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.Security",
      "$bytes=[Convert]::FromBase64String($args[0])",
      "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Console]::Out.Write([Convert]::ToBase64String($plain))"
    ].join('; ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, cacheKey], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const plain = out ? Buffer.from(out, 'base64') : null;
    if (plain && plain.length) sodaDpapiCache.set(cacheKey, plain);
    return plain && plain.length ? plain : null;
  } catch (e) {
    return null;
  }
}

function sodaLocalStateCandidatesForCookieDb(dbPath) {
  const candidates = [];
  let dir = path.dirname(dbPath || '');
  for (let i = 0; dir && i < 8; i++) {
    candidates.push(path.join(dir, 'Local State'));
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  const roots = uniqueExistingOrder([sodaUserDataDirFromCookieDb(dbPath)].concat(sodaStaticUserDataDirs()));
  for (const userDataDir of roots) {
    candidates.push(path.join(userDataDir, 'Local State'));
    findFilesByName(userDataDir, 'Local State', 4, 16, candidates);
  }
  return uniqueExistingOrder(candidates).filter(pathExistsFile);
}

function readChromiumOsCryptKey(localStatePath) {
  if (!localStatePath) return null;
  if (sodaChromiumKeyCache.has(localStatePath)) return sodaChromiumKeyCache.get(localStatePath);
  try {
    const data = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const encoded = data && data.os_crypt && data.os_crypt.encrypted_key;
    if (!encoded) return null;
    let encryptedKey = Buffer.from(String(encoded), 'base64');
    if (encryptedKey.slice(0, 5).toString('ascii') === 'DPAPI') encryptedKey = encryptedKey.slice(5);
    const key = windowsDpapiUnprotect(encryptedKey);
    if (key && key.length) {
      sodaChromiumKeyCache.set(localStatePath, key);
      return key;
    }
  } catch (e) {}
  return null;
}

function stripChromiumCookieHostHash(plain, hostKey) {
  const data = bufferFromSqliteBlob(plain);
  const host = String(hostKey || '');
  if (!host || data.length <= 32) return data;
  try {
    const expected = crypto.createHash('sha256').update(host).digest();
    if (data.subarray(0, 32).equals(expected)) return data.subarray(32);
  } catch (e) {}
  return data;
}

function decryptChromiumAesCookie(encryptedValue, dbPath, hostKey) {
  const encrypted = bufferFromSqliteBlob(encryptedValue);
  if (encrypted.length < 3 || !/^v(?:1[01]|20)$/i.test(encrypted.subarray(0, 3).toString('ascii'))) return '';
  for (const localStatePath of sodaLocalStateCandidatesForCookieDb(dbPath)) {
    const key = readChromiumOsCryptKey(localStatePath);
    if (!key || key.length !== 32 || encrypted.length <= 31) continue;
    try {
      const nonce = encrypted.subarray(3, 15);
      const tag = encrypted.subarray(encrypted.length - 16);
      const cipherText = encrypted.subarray(15, encrypted.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
      return stripChromiumCookieHostHash(plain, hostKey).toString('utf8');
    } catch (e) {}
  }
  return '';
}

function decryptSodaCookieValue(row, dbPath) {
  if (!row) return '';
  const plainValue = String(row.value || '').trim();
  if (plainValue) return plainValue;
  const encrypted = row.encrypted_value ? bufferFromSqliteBlob(row.encrypted_value) : bufferFromHex(row.encrypted_value_hex);
  if (!encrypted.length) return '';
  const aesValue = decryptChromiumAesCookie(encrypted, dbPath, row.host_key);
  if (aesValue) return aesValue.trim();
  const dpapiValue = windowsDpapiUnprotect(encrypted);
  return dpapiValue ? stripChromiumCookieHostHash(dpapiValue, row.host_key).toString('utf8').trim() : '';
}

function sodaEncryptedCookiePrefix(row) {
  if (!row) return 'empty';
  const encrypted = row.encrypted_value ? bufferFromSqliteBlob(row.encrypted_value) : bufferFromHex(row.encrypted_value_hex);
  if (!encrypted.length) return row.value ? 'plain' : 'empty';
  if (encrypted.length >= 3) {
    const prefix = encrypted.subarray(0, 3).toString('ascii');
    if (/^v\d\d$/i.test(prefix)) return prefix.toLowerCase();
  }
  if (encrypted.length >= 5 && encrypted.subarray(0, 5).toString('ascii') === 'DPAPI') return 'dpapi';
  return 'other';
}

function sodaCookieWhereSql(parameterized) {
  const hostClauses = SODA_COOKIE_HOST_PATTERNS.map(() => 'host_key like ?').join(' or ');
  const nameClauses = SODA_LOGIN_COOKIE_NAMES.map(() => 'name = ?').join(' or ');
  if (parameterized) return `(${hostClauses} or ${nameClauses})`;
  const hostSql = SODA_COOKIE_HOST_PATTERNS.map(sqliteStringLiteral).map(value => `host_key like ${value}`).join(' or ');
  const nameSql = SODA_LOGIN_COOKIE_NAMES.map(sqliteStringLiteral).map(value => `name = ${value}`).join(' or ');
  return `(${hostSql} or ${nameSql})`;
}

function sodaCookieQueryParams() {
  return SODA_COOKIE_HOST_PATTERNS.concat(SODA_LOGIN_COOKIE_NAMES);
}

function sqliteStringLiteral(value) {
  return "'" + String(value || '').replace(/'/g, "''") + "'";
}

function readCookieRowsWithNodeSqlite(dbPath) {
  try {
    const sqlite = require('node:sqlite');
    if (!sqlite || !sqlite.DatabaseSync) return null;
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(
        `select host_key,name,value,encrypted_value,path,last_update_utc,creation_utc from cookies where ${sodaCookieWhereSql(true)} and (value != '' or length(encrypted_value) > 0) order by last_update_utc asc, creation_utc asc`
      ).all(...sodaCookieQueryParams());
    } finally {
      try { db.close(); } catch (e) {}
    }
  } catch (e) {
    return null;
  }
}

function readCookieRowsWithSqliteCli(dbPath) {
  try {
    const sql = `select host_key,name,value,hex(encrypted_value),path,last_update_utc,creation_utc from cookies where ${sodaCookieWhereSql(false)} and (value != '' or length(encrypted_value) > 0) order by last_update_utc asc, creation_utc asc`;
    const out = execFileSync('sqlite3', ['-separator', '\t', dbPath, sql], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out || '').split(/\r?\n/).map(line => {
      const parts = line.split('\t');
      return parts.length >= 4 ? { host_key: parts[0], name: parts[1], value: parts[2], encrypted_value_hex: parts[3], path: parts[4] || '' } : null;
    }).filter(Boolean);
  } catch (e) {
    return null;
  }
}

function readSqliteVarint(buf, offset, limit) {
  limit = Math.min(limit || buf.length, buf.length);
  let value = 0n;
  for (let i = 0; i < 9 && offset + i < limit; i++) {
    const byte = buf[offset + i];
    if (i === 8) {
      value = (value << 8n) | BigInt(byte);
      return { value: Number(value), next: offset + i + 1 };
    }
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: Number(value), next: offset + i + 1 };
  }
  return null;
}

function sqliteSerialTypeSize(type) {
  if (type === 0 || type === 8 || type === 9) return 0;
  if (type === 1) return 1;
  if (type === 2) return 2;
  if (type === 3) return 3;
  if (type === 4) return 4;
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  if (type >= 12) return Math.floor((type - (type % 2 ? 13 : 12)) / 2);
  return -1;
}

function readSqliteInt(buf, offset, size) {
  let value = 0n;
  for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(buf[offset + i] || 0);
  const signBit = 1n << BigInt(size * 8 - 1);
  if (value & signBit) value -= 1n << BigInt(size * 8);
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}

function readSqliteRecord(buf, offset, size) {
  const end = Math.min(offset + size, buf.length);
  const header = readSqliteVarint(buf, offset, end);
  if (!header || header.value <= 0) return null;
  const headerEnd = offset + header.value;
  if (headerEnd > end) return null;
  const types = [];
  let cursor = header.next;
  while (cursor < headerEnd) {
    const item = readSqliteVarint(buf, cursor, headerEnd);
    if (!item) return null;
    types.push(item.value);
    cursor = item.next;
  }
  cursor = headerEnd;
  return types.map(type => {
    const fieldSize = sqliteSerialTypeSize(type);
    if (fieldSize < 0 || cursor + fieldSize > end) return null;
    let value = null;
    if (type === 8) value = 0;
    else if (type === 9) value = 1;
    else if (type >= 1 && type <= 6) value = readSqliteInt(buf, cursor, fieldSize);
    else if (type === 7) value = buf.readDoubleBE(cursor);
    else if (type >= 12 && type % 2 === 0) value = Buffer.from(buf.subarray(cursor, cursor + fieldSize));
    else if (type >= 13 && type % 2 === 1) value = buf.subarray(cursor, cursor + fieldSize).toString('utf8');
    cursor += fieldSize;
    return value;
  });
}

function readSqliteTableRowsFromPage(buf, pageNo, pageSize, out, visited, maxRows) {
  if (!pageNo || out.length >= maxRows) return;
  if (visited.has(pageNo)) return;
  visited.add(pageNo);
  const pageBase = (pageNo - 1) * pageSize;
  if (pageBase < 0 || pageBase >= buf.length) return;
  const headerOffset = pageNo === 1 ? 100 : 0;
  const pageHeader = pageBase + headerOffset;
  const type = buf[pageHeader];
  if (type !== 0x0d && type !== 0x05) return;
  const cellCount = buf.readUInt16BE(pageHeader + 3);
  const cellPtrStart = pageHeader + (type === 0x05 ? 12 : 8);
  if (type === 0x05) {
    for (let i = 0; i < cellCount && out.length < maxRows; i++) {
      const cellPtr = pageBase + buf.readUInt16BE(cellPtrStart + i * 2);
      const childPage = buf.readUInt32BE(cellPtr);
      readSqliteTableRowsFromPage(buf, childPage, pageSize, out, visited, maxRows);
    }
    readSqliteTableRowsFromPage(buf, buf.readUInt32BE(pageHeader + 8), pageSize, out, visited, maxRows);
    return;
  }
  for (let i = 0; i < cellCount && out.length < maxRows; i++) {
    const cellPtr = pageBase + buf.readUInt16BE(cellPtrStart + i * 2);
    const payload = readSqliteVarint(buf, cellPtr, pageBase + pageSize);
    if (!payload) continue;
    const rowid = readSqliteVarint(buf, payload.next, pageBase + pageSize);
    if (!rowid) continue;
    const payloadStart = rowid.next;
    if (payloadStart + payload.value > pageBase + pageSize) continue;
    const record = readSqliteRecord(buf, payloadStart, payload.value);
    if (record) out.push(record);
  }
}

function readSqliteDatabaseImage(dbPath) {
  const main = fs.readFileSync(dbPath);
  if (main.length < 100 || main.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') return { buf: main, pageSize: 0 };
  let pageSize = main.readUInt16BE(16);
  if (pageSize === 1) pageSize = 65536;
  if (!pageSize || pageSize < 512) return { buf: main, pageSize: 0 };
  const walPath = dbPath + '-wal';
  if (!pathExistsFile(walPath)) return { buf: main, pageSize };
  let image = main;
  try {
    const wal = fs.readFileSync(walPath);
    if (wal.length < 32) return { buf: image, pageSize };
    const magicBE = wal.readUInt32BE(0);
    const magicLE = wal.readUInt32LE(0);
    const beMagic = magicBE === 0x377f0682 || magicBE === 0x377f0683;
    const leMagic = magicLE === 0x377f0682 || magicLE === 0x377f0683;
    if (!beMagic && !leMagic) return { buf: image, pageSize };
    const read32 = leMagic && !beMagic ? (offset) => wal.readUInt32LE(offset) : (offset) => wal.readUInt32BE(offset);
    let walPageSize = read32(8);
    if (walPageSize === 1) walPageSize = 65536;
    if (!walPageSize) walPageSize = pageSize;
    if (walPageSize !== pageSize || walPageSize < 512) return { buf: image, pageSize };
    function ensureSize(size) {
      if (image.length >= size) return;
      const next = Buffer.alloc(size);
      image.copy(next);
      image = next;
    }
    const frameSize = 24 + pageSize;
    const frames = [];
    let committedFrames = 0;
    for (let offset = 32; offset + frameSize <= wal.length; offset += frameSize) {
      const pageNo = read32(offset);
      if (!pageNo) continue;
      frames.push({ pageNo, pageOffset: offset + 24 });
      if (read32(offset + 4) > 0) committedFrames = frames.length;
    }
    for (let i = 0; i < committedFrames; i++) {
      const frame = frames[i];
      const pageNo = frame.pageNo;
      const pageStart = (pageNo - 1) * pageSize;
      ensureSize(pageStart + pageSize);
      wal.copy(image, pageStart, frame.pageOffset, frame.pageOffset + pageSize);
    }
  } catch (e) {}
  return { buf: image, pageSize };
}

function readSqliteTableRowsWithJs(dbPath, rootPage, maxRows) {
  const image = readSqliteDatabaseImage(dbPath);
  const buf = image.buf;
  const pageSize = image.pageSize;
  if (!pageSize) return [];
  const rows = [];
  readSqliteTableRowsFromPage(buf, rootPage || 1, pageSize, rows, new Set(), maxRows || 20000);
  return rows;
}

function splitSqliteColumnDefs(sql) {
  const start = String(sql || '').indexOf('(');
  const end = String(sql || '').lastIndexOf(')');
  if (start < 0 || end <= start) return [];
  const body = sql.slice(start + 1, end);
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote && body[i + 1] === quote) current += body[++i];
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function sqliteUnquoteIdentifier(value) {
  value = String(value || '').trim();
  if (!value) return '';
  if ((value[0] === '"' && value.endsWith('"')) || (value[0] === '`' && value.endsWith('`')) || (value[0] === '[' && value.endsWith(']'))) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value.split(/\s+/)[0].replace(/^["'`\[]|["'`\]]$/g, '');
}

function parseSqliteCreateTableColumns(sql) {
  const constraints = /^(constraint|primary|unique|check|foreign|exclude)\b/i;
  return splitSqliteColumnDefs(sql)
    .filter(part => part && !constraints.test(part))
    .map(part => sqliteUnquoteIdentifier(part))
    .filter(Boolean);
}

function sodaCookieRowMatches(row) {
  const host = String(row && row.host_key || '').toLowerCase();
  const name = String(row && row.name || '');
  const hasValue = !!String(row && row.value || '').trim() || bufferFromSqliteBlob(row && row.encrypted_value).length > 0 || !!String(row && row.encrypted_value_hex || '').trim();
  if (!hasValue) return false;
  const hostMatched = SODA_COOKIE_HOST_PATTERNS.some(pattern => host.includes(String(pattern || '').replace(/%/g, '').toLowerCase()));
  const nameMatched = SODA_LOGIN_COOKIE_NAMES.includes(name);
  return hostMatched || nameMatched;
}

function readCookieRowsWithJsSqlite(dbPath) {
  try {
    const schemaRows = readSqliteTableRowsWithJs(dbPath, 1, 2000);
    const cookiesSchema = schemaRows.find(row => String(row && row[0] || '').toLowerCase() === 'table' && String(row && row[1] || '').toLowerCase() === 'cookies');
    if (!cookiesSchema) return null;
    const rootPage = Number(cookiesSchema[3]) || 0;
    const columns = parseSqliteCreateTableColumns(String(cookiesSchema[4] || ''));
    if (!rootPage || !columns.length) return null;
    const rows = readSqliteTableRowsWithJs(dbPath, rootPage, 30000);
    function valueOf(row, column) {
      const index = columns.findIndex(item => item.toLowerCase() === column);
      return index >= 0 ? row[index] : null;
    }
    return rows.map(row => ({
      host_key: valueOf(row, 'host_key') || '',
      name: valueOf(row, 'name') || '',
      value: valueOf(row, 'value') || '',
      encrypted_value: bufferFromSqliteBlob(valueOf(row, 'encrypted_value')),
      path: valueOf(row, 'path') || '',
      last_update_utc: valueOf(row, 'last_update_utc') || 0,
      creation_utc: valueOf(row, 'creation_utc') || 0,
    })).filter(sodaCookieRowMatches).sort((a, b) => Number(a.last_update_utc || a.creation_utc || 0) - Number(b.last_update_utc || b.creation_utc || 0));
  } catch (e) {
    return null;
  }
}

function copyFileSharedReadSync(source, dest) {
  try {
    fs.copyFileSync(source, dest);
    return true;
  } catch (firstErr) {
    if (process.platform !== 'win32') return false;
    try {
      const script = [
        '& {',
        'param($src,$dst)',
        "$ErrorActionPreference='Stop'",
        "$inputStream=[System.IO.File]::Open($src,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)",
        'try {',
        "$outputStream=[System.IO.File]::Open($dst,[System.IO.FileMode]::Create,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)",
        'try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }',
        '} finally { $inputStream.Dispose() }',
        '}',
      ].join('; ');
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, source, dest], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return pathExistsFile(dest);
    } catch (e) {
      return false;
    }
  }
}

function readCookieRowsFromSnapshot(dbPath) {
  let tmpDir = '';
  try {
    if (!pathExistsFile(dbPath)) return null;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-soda-cookies-'));
    const tmpDb = path.join(tmpDir, 'Cookies');
    if (!copyFileSharedReadSync(dbPath, tmpDb)) return null;
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const source = dbPath + suffix;
      if (pathExistsFile(source)) copyFileSharedReadSync(source, tmpDb + suffix);
    }
    return readCookieRowsWithNodeSqlite(tmpDb) || readCookieRowsWithJsSqlite(tmpDb) || readCookieRowsWithSqliteCli(tmpDb);
  } catch (e) {
    return null;
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

function readSodaCookieRows(dbPath) {
  const direct = readCookieRowsWithNodeSqlite(dbPath);
  if (direct && direct.length) return direct;
  const js = readCookieRowsWithJsSqlite(dbPath);
  if (js && js.length) return js;
  const cli = readCookieRowsWithSqliteCli(dbPath);
  if (cli && cli.length) return cli;
  const snapshot = readCookieRowsFromSnapshot(dbPath);
  if (snapshot && snapshot.length) return snapshot;
  return direct || js || cli || snapshot || [];
}

function sodaClientDetected(forceScan) {
  if (forceScan) return !!resolveSodaOfficialClientDir();
  if (sodaOfficialClientDirCache && sodaOfficialClientDirCache.clientDir && isSodaOfficialClientDir(sodaOfficialClientDirCache.clientDir)) return true;
  return !!readSodaClientScanCache();
}

function sodaLocalSyncMessage() {
  if (!sodaLastLocalSync.userDataDirs.length) return '\u672a\u627e\u5230\u6c7d\u6c34\u97f3\u4e50\u672c\u673a\u6570\u636e\u76ee\u5f55\uff0c\u8bf7\u5148\u5b89\u88c5\u5e76\u6253\u5f00\u6c7d\u6c34\u97f3\u4e50\u5ba2\u6237\u7aef\u5b8c\u6210\u767b\u5f55';
  if (!sodaLastLocalSync.cookieDbs.length) return '\u5df2\u627e\u5230\u6c7d\u6c34\u97f3\u4e50\u6570\u636e\u76ee\u5f55\uff0c\u4f46\u6ca1\u6709\u53d1\u73b0\u767b\u5f55 Cookie \u6570\u636e\u5e93\uff0c\u8bf7\u5148\u6253\u5f00\u6c7d\u6c34\u97f3\u4e50\u5ba2\u6237\u7aef\u5b8c\u6210\u767b\u5f55';
  if (sodaLastLocalSync.cookieRows > 0 && sodaLastLocalSync.decryptFailures >= sodaLastLocalSync.cookieRows) return '\u5df2\u627e\u5230\u6c7d\u6c34\u97f3\u4e50\u767b\u5f55 Cookie\uff0c\u4f46\u672c\u673a\u7cfb\u7edf\u6ca1\u6709\u89e3\u5bc6\u6210\u529f\uff1b\u8bf7\u786e\u8ba4 Mineradio \u548c\u6c7d\u6c34\u97f3\u4e50\u4f7f\u7528\u540c\u4e00\u4e2a Windows \u7528\u6237\u542f\u52a8\uff0c\u5e76\u91cd\u65b0\u6253\u5f00\u6c7d\u6c34\u97f3\u4e50\u540e\u518d\u540c\u6b65';
  if (!sodaLastLocalSync.cookies) return '\u5df2\u627e\u5230\u6c7d\u6c34\u97f3\u4e50 Cookie \u6570\u636e\u5e93\uff0c\u4f46\u6ca1\u6709\u8bfb\u53d6\u5230\u6709\u6548\u767b\u5f55\u4f1a\u8bdd\uff0c\u8bf7\u786e\u8ba4\u6c7d\u6c34\u97f3\u4e50\u5ba2\u6237\u7aef\u5df2\u767b\u5f55';
  if (!sodaLastLocalSync.clientDir) return '\u5df2\u8bfb\u5230\u6c7d\u6c34\u97f3\u4e50\u767b\u5f55\u6570\u636e\uff0c\u4f46\u672a\u5b9a\u4f4d\u5ba2\u6237\u7aef\u5b89\u88c5\u76ee\u5f55\uff1b\u4e0d\u5f71\u54cd\u767b\u5f55\u540c\u6b65\uff0c\u64ad\u653e\u7b7e\u540d\u4f1a\u7ee7\u7eed\u81ea\u52a8\u5c1d\u8bd5\u68c0\u6d4b';
  return '';
  if (!sodaLastLocalSync.clientDir) return '未检测到已安装的汽水音乐客户端，请先安装汽水音乐并完成登录';
  if (!sodaLastLocalSync.userDataDirs.length) return '未找到汽水音乐本机数据目录，请先安装并打开汽水音乐客户端完成登录';
  if (!sodaLastLocalSync.cookieDbs.length) return '已找到汽水音乐数据目录，但没有发现登录 Cookie 数据库，请先打开汽水音乐客户端完成登录';
  if (!sodaLastLocalSync.cookies) return '已找到汽水音乐 Cookie 数据库，但没有读取到有效登录会话，请确认汽水音乐客户端已登录';
  return '';
}

function sodaLocalSyncDiagnostics() {
  const playback = sodaPlaybackNativeStatus({ forceScan: false });
  return {
    userDataDirCount: sodaLastLocalSync.userDataDirs.length,
    cookieDbCount: sodaLastLocalSync.cookieDbs.length,
    cookieRowCount: sodaLastLocalSync.cookieRows || 0,
    decryptFailureCount: sodaLastLocalSync.decryptFailures || 0,
    decryptedCookieCount: sodaLastLocalSync.cookies || 0,
    localStateCount: sodaLastLocalSync.localStateCount || 0,
    encryptedPrefixes: sodaLastLocalSync.encryptedPrefixes || {},
    clientDirDetected: !!sodaLastLocalSync.clientDir,
    playbackKeyReady: !!playback.playbackKeyReady,
    playbackMessage: playback.message || '',
    playbackDiagnostics: playback,
    error: sodaLastLocalSync.error || '',
  };
}

function sodaLoginDebugSnapshot() {
  const cookieObj = sodaCookieObject();
  const probeBody = sodaLastLoginProbe && sodaLastLoginProbe.body;
  const probeInfo = sodaLastLoginProbe && sodaLastLoginProbe.info;
  const probeData = probeBody && probeBody.data && typeof probeBody.data === 'object' ? probeBody.data : null;
  return {
    hasCookie: !!sodaCookie,
    cookieLength: sodaCookie ? sodaCookie.length : 0,
    cookieNames: Object.keys(cookieObj).sort(),
    hasLoginTicket: sodaCookieHasLoginTicket(cookieObj),
    clientDetected: sodaClientDetected(false),
    lastLocalSync: {
      checkedAt: sodaLastLocalSync.checkedAt || 0,
      clientDirDetected: !!sodaLastLocalSync.clientDir,
      userDataDirCount: sodaLastLocalSync.userDataDirs.length,
      cookieDbCount: sodaLastLocalSync.cookieDbs.length,
      cookieRowCount: sodaLastLocalSync.cookieRows || 0,
      decryptFailureCount: sodaLastLocalSync.decryptFailures || 0,
      decryptedCookieCount: sodaLastLocalSync.cookies,
      localStateCount: sodaLastLocalSync.localStateCount || 0,
      encryptedPrefixes: sodaLastLocalSync.encryptedPrefixes || {},
      error: sodaLastLocalSync.error || '',
    },
    apiProbe: sodaLastLoginProbe ? {
      ok: !!sodaLastLoginProbe.ok,
      error: sodaLastLoginProbe.error || '',
      code: probeBody ? normalizeApiCode(probeBody) : 0,
      message: probeBody ? sodaApiErrorMessage(probeBody, '') : '',
      topKeys: probeBody ? Object.keys(probeBody).slice(0, 24) : [],
      dataKeys: probeData ? Object.keys(probeData).slice(0, 24) : [],
      userInfoKeys: probeInfo ? Object.keys(probeInfo).slice(0, 24) : [],
    } : null,
  };
}

function readSodaCookieFromClient(opts) {
  opts = opts || {};
  const shouldDiscover = opts.discover != null ? !!opts.discover : opts.allowGlobalScan !== false;
  const staticUserDataDirs = sodaKnownUserDataDirs({ discover: false }).filter(pathExistsDir);
  const discoveredUserDataDirs = shouldDiscover ? sodaKnownUserDataDirs({ discover: true }).filter(pathExistsDir) : [];
  const userDataDirs = uniqueExistingOrder(staticUserDataDirs.concat(discoveredUserDataDirs));
  const cookieDbs = uniqueExistingOrder(
    sodaCookieDbCandidates({ discover: false }).concat(shouldDiscover ? sodaCookieDbCandidates({ discover: true }) : [])
  ).filter(pathExistsFile);
  const picked = new Map();
  let lastError = '';
  let cookieRows = 0;
  let decryptFailures = 0;
  let localStateCount = 0;
  const localStateSeen = new Set();
  const encryptedPrefixes = {};
  for (const dbPath of cookieDbs) {
    try {
      for (const file of sodaLocalStateCandidatesForCookieDb(dbPath)) {
        const key = path.resolve(file).toLowerCase();
        if (!localStateSeen.has(key)) {
          localStateSeen.add(key);
          localStateCount++;
        }
      }
      for (const row of readSodaCookieRows(dbPath)) {
        cookieRows++;
        const prefix = sodaEncryptedCookiePrefix(row);
        encryptedPrefixes[prefix] = (encryptedPrefixes[prefix] || 0) + 1;
        const value = decryptSodaCookieValue(row, dbPath);
        if (!value) decryptFailures++;
        if (value) collectCookiePair(picked, row && row.name, value);
      }
    } catch (e) {
      lastError = e.message || String(e);
    }
  }
  const clientDir = opts.detectClient === false
    ? (sodaOfficialClientDirCache && sodaOfficialClientDirCache.clientDir || readSodaClientScanCache())
    : resolveSodaOfficialClientDir({ allowGlobalScan: opts.allowGlobalScan !== false });
  sodaLastLocalSync = {
    checkedAt: Date.now(),
    clientDir: clientDir || '',
    userDataDirs,
    cookieDbs,
    cookieRows,
    decryptFailures,
    cookies: picked.size,
    localStateCount,
    encryptedPrefixes,
    error: lastError,
  };
  return Array.from(picked.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function refreshSodaCookieFromClient(force, opts) {
  if (!force || !sodaAutoSyncEnabled) return sodaCookie;
  const clientCookie = readSodaCookieFromClient(opts);
  if (clientCookie && clientCookie !== sodaCookie) {
    saveSodaCookie(clientCookie);
    sodaLoginInfoCache = null;
    sodaLoginInfoCacheAt = 0;
    sodaDeviceInfoCache = null;
  }
  return sodaCookie;
}

function applySodaLocalSyncResult(result) {
  result = result || {};
  if (result.lastLocalSync && typeof result.lastLocalSync === 'object') {
    sodaLastLocalSync = {
      checkedAt: Number(result.lastLocalSync.checkedAt) || Date.now(),
      clientDir: String(result.lastLocalSync.clientDir || ''),
      userDataDirs: Array.isArray(result.lastLocalSync.userDataDirs) ? result.lastLocalSync.userDataDirs : [],
      cookieDbs: Array.isArray(result.lastLocalSync.cookieDbs) ? result.lastLocalSync.cookieDbs : [],
      cookieRows: Number(result.lastLocalSync.cookieRows) || 0,
      decryptFailures: Number(result.lastLocalSync.decryptFailures) || 0,
      cookies: Number(result.lastLocalSync.cookies) || 0,
      localStateCount: Number(result.lastLocalSync.localStateCount) || 0,
      encryptedPrefixes: result.lastLocalSync.encryptedPrefixes && typeof result.lastLocalSync.encryptedPrefixes === 'object' ? result.lastLocalSync.encryptedPrefixes : {},
      error: String(result.lastLocalSync.error || ''),
    };
  }
  if (result.clientDir || sodaLastLocalSync.clientDir) {
    sodaOfficialClientDirCache = { clientDir: String(result.clientDir || sodaLastLocalSync.clientDir || ''), scannedAt: Date.now() };
    if (sodaOfficialClientDirCache.clientDir) writeSodaClientScanCache(sodaOfficialClientDirCache.clientDir);
  }
  if (result.userDataDiscoveryCache && typeof result.userDataDiscoveryCache === 'object') {
    sodaUserDataDiscoveryCache = {
      scannedAt: Number(result.userDataDiscoveryCache.scannedAt) || Date.now(),
      dirs: Array.isArray(result.userDataDiscoveryCache.dirs) ? result.userDataDiscoveryCache.dirs : [],
      cookieDbs: Array.isArray(result.userDataDiscoveryCache.cookieDbs) ? result.userDataDiscoveryCache.cookieDbs : [],
    };
  } else if (sodaLastLocalSync.userDataDirs.length || sodaLastLocalSync.cookieDbs.length) {
    sodaUserDataDiscoveryCache = {
      scannedAt: Date.now(),
      dirs: sodaLastLocalSync.userDataDirs,
      cookieDbs: sodaLastLocalSync.cookieDbs,
    };
  }
  if (result.cookie && result.cookie !== sodaCookie) {
    saveSodaCookie(result.cookie);
    sodaLoginInfoCache = null;
    sodaLoginInfoCacheAt = 0;
    sodaDeviceInfoCache = null;
  }
}

function runSodaCookieWorker(opts) {
  if (sodaLocalSyncWorkerPromise) return sodaLocalSyncWorkerPromise;
  sodaLocalSyncWorkerPromise = new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [__filename], {
      cwd: __dirname,
      env: {
        ...process.env,
        MINERADIO_SODA_COOKIE_WORKER: '1',
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sodaLocalSyncWorkerPromise = null;
      resolve({
        ...(result || {}),
        workerDurationMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      finish({
        ok: false,
        error: 'SODA_LOCAL_SYNC_TIMEOUT',
        message: '汽水音乐本机登录读取超时，请确认客户端已打开并完成登录后重试',
        stderr,
      });
    }, SODA_LOCAL_SYNC_WORKER_TIMEOUT_MS);
    child.stdout.on('data', chunk => {
      stdout += String(chunk || '');
      if (stdout.length > 4 * 1024 * 1024) stdout = stdout.slice(-4 * 1024 * 1024);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk || '');
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
    });
    child.on('error', err => {
      finish({ ok: false, error: err.message || 'SODA_LOCAL_SYNC_WORKER_FAILED', stderr });
    });
    child.on('close', code => {
      if (settled) return;
      try {
        const text = stdout.trim();
        const parsed = JSON.parse(text);
        finish({ ...parsed, exitCode: code, stderr });
      } catch (e) {
        finish({
          ok: false,
          exitCode: code,
          error: e.message || 'SODA_LOCAL_SYNC_WORKER_BAD_OUTPUT',
          stdout: stdout.slice(-2000),
          stderr,
        });
      }
    });
    try {
      child.stdin.end(JSON.stringify(opts || {}));
    } catch (e) {
      try { child.kill(); } catch (_) {}
      finish({ ok: false, error: e.message || 'SODA_LOCAL_SYNC_WORKER_INPUT_FAILED' });
    }
  });
  return sodaLocalSyncWorkerPromise;
}

async function refreshSodaCookieFromClientAsync(force, opts) {
  if (!force || !sodaAutoSyncEnabled) return sodaCookie;
  if (process.env.MINERADIO_DISABLE_SODA_COOKIE_WORKER === '1' || process.env.MINERADIO_SODA_COOKIE_WORKER === '1') {
    return refreshSodaCookieFromClient(force, opts);
  }
  const result = await runSodaCookieWorker(opts);
  if (result && result.ok) {
    applySodaLocalSyncResult(result);
  } else {
    sodaLastLocalSync = {
      ...sodaLastLocalSync,
      checkedAt: Date.now(),
      error: result && (result.message || result.error) || 'SODA_LOCAL_SYNC_FAILED',
    };
  }
  return sodaCookie;
}

function readSodaDeviceInfo() {
  if (!sodaDeviceInfoCache) sodaDeviceInfoCache = readSodaDeviceInfoFresh();
  return sodaDeviceInfoCache || {};
}

sodaSigning.setup({
  getState: () => sodaNativeSecurity,
  setState: (s) => { sodaNativeSecurity = s; },
  readDeviceInfo: readSodaDeviceInfo,
  cookieObjectFn: sodaCookieObject,
});

sodaApiClient.setup({
  readDeviceInfo: readSodaDeviceInfo,
  getUserAgent: sodaUserAgent,
  getCookie: () => sodaCookie,
  refreshCookie: refreshSodaCookieFromClient,
  request: requestTextDetailed,
  mergeCookie: mergeSodaSetCookie,
});

sodaResolver.setup({
  apiRequest: sodaApiRequest,
  requestJson,
  getUserAgent: sodaUserAgent,
  debugDump: sodaPlaybackDebugDump,
  freeBenefitSummary: sodaFreeBenefitSummary,
  needsClientSignature: sodaTrackV2NeedsClientSignature,
  playbackFeeFromBody: sodaPlaybackFeeFromBody,
  apiErrorMessage: sodaApiErrorMessage,
  expectedDurationMs: sodaExpectedDurationMs,
  resolvedQualityLevel: sodaResolvedQualityLevel,
  normalizeQualityPreference,
  limitedFreeParam: sodaLimitedFreeParam,
  getLoginInfo: () => (sodaLoginInfoCache && sodaLoginInfoCache.info) || {},
  probeSodaMediaDurationMs,
});

sodaProvider.setup({
  refreshCookie: refreshSodaCookieFromClient,
  ensureSignature: ensureSodaPlaybackSignatureReady,
  getSodaLimitedFreeInfo,
  trySodaMCheckMedia,
  tryResolveSodaTrackV2,
  tryResolveUnencryptedFallback: tryResolveSodaUnencryptedPlaybackFallback,
  playbackNativeStatus: sodaPlaybackNativeStatus,
  normalizeLimitedFreeInfo: normalizeSodaLimitedFreeInfo,
  cachedLimitedFreeInfo: cachedSodaLimitedFreeInfo,
  debugDump: sodaPlaybackDebugDump,
});

downloadStore.reset();
downloadManager.setup({
  resolveUrl: resolveTrackUrlForDownload,
  ffmpegPath: () => ffmpegBinaryPath,
  musicDir: () => process.env.MINERADIO_MUSIC_DIR || '',
  store: downloadStore,
});

async function resolveTrackUrlForDownload(song, quality, format) {
  const provider = song && (song.provider || song.source || song.type || '');
  const isSoda = provider === 'soda' || song.sodaId || song.vid;
  const isQQ = provider === 'qq' || song.mid || song.songmid;
  const isBest = quality === 'best';
  const effectiveQuality = isBest ? 'hires' : (quality || 'exhigh');
  console.log(`[DL-RESOLVE] provider=${provider} isSoda=${isSoda} isQQ=${isQQ} id=${song && (song.sodaId || song.mid || song.id || '')} q=${effectiveQuality} fmt=${format} best=${isBest}`);
  try {
    if (isSoda) {
      const info = await handleSodaSongUrl(song.sodaId || song.id || '', effectiveQuality, {});
      console.log(`[DL-RESOLVE] soda result: playable=${info && info.playable} url=${info && info.url ? info.url.substring(0, 80) : 'null'} level=${info && info.level} quality=${info && info.quality} rawQuality=${info && info.rawQuality} error=${info && info.error || 'none'}`);
      if (info && info.url && info.playable) {
        let audioUrl = info.url;
        let headers = {};
        let decryptionKey = '';
        if (audioUrl.startsWith('/api/soda/audio?token=')) {
          const token = audioUrl.split('token=')[1];
          const session = sodaPlaybackSessions.get(token);
          if (session) {
            const sources = sodaPlaybackSourceList(session);
            if (sources.length > 0) {
              audioUrl = sources[0];
              console.log(`[DL-RESOLVE] soda session resolved: ${audioUrl.substring(0, 100)}`);
            }
            if (session.decodedKey) {
              decryptionKey = session.decodedKey;
              console.log(`[DL-RESOLVE] soda decodedKey found`);
            }
          } else {
            console.log(`[DL-RESOLVE] soda session not found for token=${token.substring(0, 20)}...`);
          }
        }
        headers = sodaAudioRequestHeadersFor(audioUrl, '', { includeCookie: true });
        const ffmpegHeaderText = sodaFfmpegHeaderText(audioUrl);
        const ua = sodaUserAgent();
        return { url: audioUrl, format: format || 'auto', totalBytes: 0, decryptionKey, headers, ffmpegHeaderText, userAgent: ua, level: info.level || '', rawQuality: info.rawQuality || '' };
      }
      return { error: info && info.error || 'SODA_URL_UNAVAILABLE' };
    }
    if (isQQ) {
      const qqQuality = isBest ? 'lossless' : effectiveQuality;
      const info = await handleQQSongUrl(song.mid || song.songmid || song.id || '', song.mediaMid || song.media_mid || '', qqQuality, {});
      console.log(`[DL-RESOLVE] qq result: playable=${info && info.playable} url=${info && info.url ? info.url.substring(0, 80) : 'null'}`);
      if (info && info.url && info.playable) return { url: info.url, format: format || 'auto', totalBytes: 0, decryptionKey: '', headers: {}, ffmpegHeaderText: '', userAgent: '', level: info.level || '', rawQuality: info.rawQuality || '' };
      return { error: info && info.error || 'QQ_URL_UNAVAILABLE' };
    }
    const neQuality = isBest ? 'hires' : effectiveQuality;
    const info = await handleSongUrl(song.id || '', {}, neQuality, {});
    console.log(`[DL-RESOLVE] netease result: playable=${info && info.playable} url=${info && info.url ? info.url.substring(0, 80) : 'null'}`);
    if (info && info.url && info.playable) return { url: info.url, format: format || 'auto', totalBytes: 0, decryptionKey: '', headers: {}, ffmpegHeaderText: '', userAgent: '', level: info.level || '', rawQuality: info.rawQuality || '' };
    return { error: info && info.error || 'NETEASE_URL_UNAVAILABLE' };
  } catch (e) {
    console.error(`[DL-RESOLVE] error:`, e.message);
    return { error: e.message || String(e) };
  }
}

function sodaCommonParams(extra) {
  return sodaApiClient.sodaCommonParams(extra);
}

function applySodaBdmsSignature(targetUrl, headers) {
  sodaSigning.applySodaBdmsSignature(targetUrl, headers);
}

function applySodaBdticketSignature(targetUrl, headers) {
  return sodaSigning.applySodaBdticketSignature(targetUrl, headers);
}

function handleSodaBdticketResponse(ctx, targetUrl, responseHeaders) {
  sodaSigning.handleSodaBdticketResponse(ctx, targetUrl, responseHeaders);
}

function mergeSodaSetCookie(setCookieHeaders) {
  if (!setCookieHeaders) return;
  const picked = new Map(Object.entries(parseCookieString(sodaCookie)));
  collectCookieInput(setCookieHeaders, picked);
  const next = Array.from(picked.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  if (next && next !== sodaCookie) {
    saveSodaCookie(next);
    sodaLoginInfoCache = null;
    sodaLoginInfoCacheAt = 0;
  }
}

async function sodaRequestClientCert(data, callback) {
  const u = new URL('/passport/ticket_guard/get_client_cert/', SODA_API_BASE);
  const params = sodaCommonParams({ is_from_ttaccountsdk: '1' });
  Object.keys(params).forEach(key => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') u.searchParams.set(key, String(value));
  });
  const form = new URLSearchParams(data && Object.keys(data).length ? data : { server_data: '1' }).toString();
  const headers = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'content-length': String(Buffer.byteLength(form)),
    'user-agent': sodaUserAgent(),
  };
  const response = await requestTextDetailed(u.toString(), { method: 'POST', headers, allowHttpError: true }, form);
  let body = {};
  try { body = response.text ? JSON.parse(response.text) : {}; } catch (e) { body = {}; }
  if (typeof callback === 'function') {
    callback(
      { data: body },
      String(response.headers && response.headers['x-tt-logid'] || ''),
      {
        httpStatusCode: response.statusCode === 200 ? 0 : response.statusCode,
        message: response.statusCode === 200 ? '' : ('get_client_cert failed with status: ' + response.statusCode),
      }
    );
  }
}

async function sodaApiRequest(apiPath, params, opts) {
  return sodaApiClient.sodaApiRequest(apiPath, params, opts);
}

function sodaApiErrorMessage(body, fallback) {
  return (body && body.status_info && (body.status_info.status_msg || body.status_info.message))
    || (body && (body.message || body.msg || body.error))
    || (body && body.data && (body.data.message || body.data.msg || body.data.error))
    || fallback
    || '';
}

function firstObjectWithAnyKey(list, keys) {
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (keys.some(key => item[key] !== undefined && item[key] !== null && String(item[key]) !== '')) return item;
  }
  return null;
}

function sodaLoginUserInfoFromBody(body) {
  const data = body && body.data && typeof body.data === 'object' ? body.data : {};
  return firstObjectWithAnyKey([
    body && body.my_info,
    body && body.user,
    body && body.user_info,
    body && body.profile,
    data.my_info,
    data.user,
    data.user_info,
    data.profile,
    data.account,
    data,
  ], ['id', 'id_str', 'user_id', 'user_id_str', 'uid', 'uid_str', 'userId', 'user_id_str', 'nickname', 'name', 'avatar', 'avatar_url']) || {};
}

function sodaLoginUserId(info, body) {
  const data = body && body.data && typeof body.data === 'object' ? body.data : {};
  const sources = [info || {}, body || {}, data || {}];
  const keys = ['id', 'id_str', 'user_id', 'user_id_str', 'uid', 'uid_str', 'userId', 'userID'];
  for (const source of sources) {
    for (const key of keys) {
      const value = source && source[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  }
  return '';
}

function isSodaKrcText(text) {
  return typeof text === 'string'
    && /^\[\d+,\d+\]/m.test(text)
    && /<\d+,\d+,\d+>/.test(text);
}

function isSodaYrcText(text) {
  return typeof text === 'string'
    && /^\[\d+,\d+\]/m.test(text)
    && /\(\d+,\d+,\d+\)/.test(text);
}

function isSodaLrcText(text) {
  return typeof text === 'string' && /\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/.test(text);
}

function sodaMsToLrcTime(ms) {
  ms = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + String(centiseconds).padStart(2, '0');
}

function sodaTimedLyricToYrc(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      const m = String(line || '').match(/^\[(\d+),(\d+)\](.*)$/);
      if (!m) return '';
      const body = (m[3] || '').replace(/<(\d+),(\d+),(\d+)>/g, '($1,$2,$3)');
      return `[${m[1]},${m[2]}]${body}`;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function sodaTimedLyricToLrc(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      const m = String(line || '').match(/^\[(\d+),(\d+)\](.*)$/);
      if (!m) return '';
      const plain = (m[3] || '')
        .replace(/<\d+,\d+,\d+>/g, '')
        .replace(/\(\d+,\d+,\d+\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return plain ? '[' + sodaMsToLrcTime(Number(m[1]) || 0) + ']' + plain : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function collectSodaLyricCandidates(value, pathParts, out, depth) {
  if (value == null || depth > 9) return;
  const pathText = (pathParts || []).join('.').toLowerCase();
  if (typeof value === 'string') {
    const text = value.replace(/^\uFEFF/, '').trim();
    if (!text) return;
    let score = 0;
    let format = '';
    if (isSodaKrcText(text)) { score = 110; format = 'krc'; }
    else if (isSodaYrcText(text)) { score = 100; format = 'yrc'; }
    else if (isSodaLrcText(text)) { score = 90; format = 'lrc'; }
    if (!score) return;
    if (pathText === 'lyric.content') score += 40;
    else if (pathText.includes('lyric')) score += 18;
    if (/translation|translated|trans|tlyric/.test(pathText)) score -= 8;
    out.push({ text, score, format, path: pathText });
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item, index) => collectSodaLyricCandidates(item, (pathParts || []).concat('[' + index + ']'), out, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  Object.keys(value).forEach(key => {
    collectSodaLyricCandidates(value[key], (pathParts || []).concat(key), out, depth + 1);
  });
}

function extractSodaLyricParts(body) {
  const candidates = [];
  collectSodaLyricCandidates(body, [], candidates, 0);
  candidates.sort((a, b) => b.score - a.score);
  const original = candidates.find(item => !/translation|translated|trans|tlyric/.test(item.path)) || candidates[0] || null;
  const translated = candidates.find(item => /translation|translated|trans|tlyric/.test(item.path) && item !== original) || null;
  function convert(candidate) {
    if (!candidate) return { lyric: '', yrc: '', format: '' };
    if (candidate.format === 'lrc') return { lyric: candidate.text, yrc: '', format: 'lrc' };
    return {
      lyric: sodaTimedLyricToLrc(candidate.text),
      yrc: sodaTimedLyricToYrc(candidate.text),
      format: candidate.format,
    };
  }
  const main = convert(original);
  const trans = convert(translated);
  return {
    lyric: main.lyric,
    yrc: main.yrc,
    tlyric: trans.lyric,
    format: main.format,
    sourcePath: original && original.path || '',
  };
}

function sodaImageUrl(image) {
  if (!image) return '';
  if (typeof image === 'string') return /^https?:\/\//i.test(image) ? image : '';
  const urls = Array.isArray(image.urls) ? image.urls : (Array.isArray(image.url_list) ? image.url_list : []);
  const first = String(urls[0] || image.url || '').trim();
  if (first && /^https?:\/\//i.test(first) && !/\/img\/?$/i.test(first)) return first;
  const uri = String(image.uri || '').trim();
  if (uri && /^https?:\/\//i.test(uri)) return uri;
  if (first && uri) {
    const suffix = image.template_prefix ? ('~' + String(image.template_prefix).replace(/^~/, '') + '-image.image') : '';
    return first.replace(/\/?$/, '/') + uri.replace(/^\/+/, '') + suffix;
  }
  return '';
}

function sodaArtistList(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(a => ({
      id: a && a.id || '',
      name: a && (a.name || a.simple_display_name || a.display_name) || '',
    }))
    .filter(a => a.name);
}

function mapSodaTrack(raw) {
  raw = raw || {};
  const track = raw.track || raw.track_info || raw.song || raw;
  const album = track.album || {};
  const artists = sodaArtistList(track.artists || track.singers || []);
  const id = String(track.id || track.track_id || raw.id || '');
  const preview = track.preview || {};
  const audition = track.audition_info || {};
  return {
    provider: 'soda',
    source: 'soda',
    type: 'soda',
    id,
    sodaId: id,
    vid: track.vid || preview.vid || audition.vid || '',
    name: track.name || track.title || '',
    artist: artists.map(a => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || album.title || '',
    cover: sodaImageUrl(track.url_cover || track.cover || album.url_cover || album.cover || track.url_player_bg),
    duration: Number(track.duration || track.duration_ms || 0) || 0,
    fee: sodaTrackRequiresAccess(track) ? 1 : 0,
    playable: true,
    previewStart: Number(preview.start || audition.start_time_ms || 0) || 0,
    previewDuration: Number(preview.duration || audition.duration_ms || 0) || 0,
  };
}

function mapSodaTrackCandidate(item) {
  item = item || {};
  const entity = item.entity || item.data || item;
  const track = entity.track_wrapper || entity.track || entity.track_info || entity.song || entity;
  return mapSodaTrack(track);
}

function mapSodaPlaylist(pl) {
  pl = pl || {};
  const owner = pl.owner || pl.creator || {};
  const id = String(pl.id || pl.playlist_id || '');
  const name = pl.title || pl.name || '';
  const favorite = isProviderFavoritePlaylistName(name);
  const readOnly = !favorite && isProviderReadonlyPlaylistName(name);
  return {
    provider: 'soda',
    source: 'soda',
    id,
    name,
    cover: sodaImageUrl(pl.url_cover || pl.cover || pl.cover_url),
    trackCount: Number(pl.count_tracks || pl.track_count || pl.song_count || 0) || 0,
    playCount: Number(pl.play_count || pl.play_count_show || 0) || 0,
    creator: owner.nickname || owner.name || 'Soda Music',
    subscribed: !!pl.subscribed,
    favorite,
    readOnly,
    writable: !pl.subscribed && !readOnly,
    specialType: favorite ? 5 : 0,
  };
}

function readSodaCachedVipLevel(userId) {
  const id = String(userId || '').replace(/\D/g, '');
  if (!id) return '';
  const files = sodaKnownUserDataDirs()
    .map(dir => dir ? path.join(dir, 'LunaCacheV2', 'entries.db') : '')
    .filter(pathExistsFile);
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file).toString('utf8').toLowerCase();
      const needles = [`"user_id":${id}`, `"user_id":"${id}"`];
      for (const needle of needles) {
        let idx = -1;
        while ((idx = text.indexOf(needle, idx + 1)) >= 0) {
          const nearby = text.slice(Math.max(0, idx - 520), Math.min(text.length, idx + 520));
          const match = nearby.match(/"vip"\s*:\s*"([^"]+)"/i);
          if (!match) continue;
          const level = String(match[1] || '').toLowerCase();
          if (/svip|supervip|super_vip/.test(level)) return 'svip';
          if (/\bvip\b/.test(level)) return 'vip';
        }
      }
    } catch (e) {}
  }
  return '';
}

function sodaTextLooksFreeBenefit(text) {
  text = String(text || '').toLowerCase();
  if (!text) return false;
  const hasFreeSignal = /limited[_\s-]?free|free[_\s-]?(vip|member|membership|right|rights|benefit|listen|play|access|time)|ad[_\s-]?(vip|member|membership|right|rights|benefit|free|reward)|rewarded[_\s-]?ad|watch[_\s-]?ad|ad[_\s-]?reward|temporary[_\s-]?free|\u9650\u65f6\u514d\u8d39|\u9650\u514d|\u514d\u8d39\u6743\u76ca|\u514d\u8d39\u4f1a\u5458|\u5e7f\u544a\u6743\u76ca|\u770b\u5e7f\u544a|\u514d\u8d39\u542c/.test(text);
  if (!hasFreeSignal) return false;
  const onlyPreview = /free[_\s-]?trial|preview|audition|sample|\u8bd5\u542c/.test(text)
    && !/limited[_\s-]?free|ad[_\s-]?|watch[_\s-]?ad|rewarded[_\s-]?ad|\u770b\u5e7f\u544a|\u9650\u514d|\u514d\u8d39\u6743\u76ca/.test(text);
  return !onlyPreview;
}

function sodaBenefitExpiryMs(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  const keys = ['expire_time', 'expireTime', 'expires_at', 'expiresAt', 'expire_at', 'expireAt', 'end_time', 'endTime', 'valid_until', 'validUntil', 'deadline'];
  for (const key of keys) {
    const raw = Number(obj[key]);
    if (Number.isFinite(raw) && raw > 0) return raw > 10000000000 ? raw : raw * 1000;
  }
  return 0;
}

function sodaBenefitLooksInactive(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const statusText = ['status', 'state', 'valid', 'available', 'enable', 'enabled', 'expired']
    .map(key => String(obj[key] == null ? '' : obj[key]))
    .join(' ')
    .toLowerCase();
  if (/active|valid|available|enabled|enable|usable|using|\u751f\u6548|\u53ef\u7528/.test(statusText)) return false;
  if (/expired|invalid|inactive|disabled|disable|used_up|finished|unavailable|\u8fc7\u671f|\u5931\u6548|\u4e0d\u53ef\u7528/.test(statusText)) return true;
  const expiresAt = sodaBenefitExpiryMs(obj);
  return !!(expiresAt && expiresAt <= Date.now());
}

function sodaBenefitLabelFromObject(obj, fallback) {
  if (obj && typeof obj === 'object') {
    const keys = ['benefit_name', 'benefitName', 'rights_name', 'rightsName', 'title', 'name', 'label', 'desc', 'description'];
    for (const key of keys) {
      const value = String(obj[key] || '').trim();
      if (sodaTextLooksFreeBenefit(value)) return value.slice(0, 24);
    }
  }
  return fallback || '\u9650\u65f6\u514d\u8d39\u6743\u76ca';
}

function sodaStageFreeBenefitSummary(rawStage, rawType) {
  const stage = String(rawStage || '').toLowerCase();
  const type = String(rawType || '').toLowerCase();
  const text = (stage + ' ' + type).trim();
  if (!text) return null;
  const hasFreeStage = stage === 'free'
    || type === 'free'
    || /limited[_\s-]?free|temporary[_\s-]?free|ad[_\s-]?free|rewarded[_\s-]?free|free[_\s-]?(vip|member|membership|right|rights|benefit|listen|play|access|time)/.test(text);
  if (!hasFreeStage) return null;
  if (/preview|audition|sample|trial|\u8bd5\u542c/.test(text) && !/limited|temporary|ad|reward|benefit|right|\u9650\u65f6|\u9650\u514d/.test(text)) return null;
  return {
    hasFreeBenefit: true,
    freeBenefitLabel: '\u9650\u65f6\u514d\u8d39\u6743\u76ca',
    freeBenefitExpiresAt: 0,
    freeBenefitSource: stage === 'free' ? 'vip_stage' : 'membership_type',
  };
}

function collectSodaFreeBenefits(value, out, path, depth) {
  out = out || [];
  path = path || [];
  if (!value || depth > 7) return out;
  if (typeof value !== 'object') {
    const text = String(value || '');
    if (sodaTextLooksFreeBenefit(text)) out.push({ label: '\u9650\u65f6\u514d\u8d39\u6743\u76ca', expiresAt: 0, source: path.join('.') });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSodaFreeBenefits(item, out, path.concat('[' + index + ']'), depth + 1));
    return out;
  }
  const keyText = path.join('.').toLowerCase();
  const ownText = Object.keys(value)
    .map(key => String(key) + '=' + (value[key] && typeof value[key] === 'object' ? '' : String(value[key] || '')))
    .join(' ')
    .toLowerCase();
  if ((sodaTextLooksFreeBenefit(keyText) || sodaTextLooksFreeBenefit(ownText)) && !sodaBenefitLooksInactive(value)) {
    out.push({
      label: sodaBenefitLabelFromObject(value),
      expiresAt: sodaBenefitExpiryMs(value),
      source: path.join('.'),
    });
  }
  Object.keys(value).forEach(key => collectSodaFreeBenefits(value[key], out, path.concat(key), depth + 1));
  return out;
}

function sodaFreeBenefitSummary(values) {
  const benefits = [];
  (Array.isArray(values) ? values : [values]).forEach(value => collectSodaFreeBenefits(value, benefits, [], 0));
  const active = benefits.filter(item => !item.expiresAt || item.expiresAt > Date.now());
  if (!active.length) return { hasFreeBenefit: false, freeBenefitLabel: '', freeBenefitExpiresAt: 0, freeBenefitSource: '' };
  active.sort((a, b) => (b.expiresAt || Number.MAX_SAFE_INTEGER) - (a.expiresAt || Number.MAX_SAFE_INTEGER));
  return {
    hasFreeBenefit: true,
    freeBenefitLabel: active[0].label || '\u9650\u65f6\u514d\u8d39\u6743\u76ca',
    freeBenefitExpiresAt: active[0].expiresAt || 0,
    freeBenefitSource: active[0].source || '',
  };
}

function rememberSodaFreeBenefit(benefit) {
  if (!benefit || !benefit.hasFreeBenefit) return;
  if (benefit.freeBenefitExpiresAt && benefit.freeBenefitExpiresAt <= Date.now()) return;
  if (!sodaLoginInfoCache || !sodaLoginInfoCache.info) return;
  const current = sodaLoginInfoCache.info || {};
  const merged = {
    ...current,
    hasFreeBenefit: true,
    freeBenefitLabel: benefit.freeBenefitLabel || current.freeBenefitLabel || '\u9650\u65f6\u514d\u8d39\u6743\u76ca',
    freeBenefitExpiresAt: benefit.freeBenefitExpiresAt || current.freeBenefitExpiresAt || 0,
    freeBenefitSource: benefit.freeBenefitSource || current.freeBenefitSource || '',
  };
  if (!providerHasMembership('soda', current) && merged.vipLevel === 'none') merged.vipLabel = merged.freeBenefitLabel;
  sodaLoginInfoCache = { ...sodaLoginInfoCache, info: merged };
  sodaLoginInfoCacheAt = Date.now();
}

function normalizeSodaVip(info, body, opts) {
  info = info || {};
  body = body || {};
  opts = opts || {};
  const rawCached = opts.allowCachedVip === true ? String(opts.cachedVipLevel || '').toLowerCase() : '';
  const rawStage = String(info.vip_stage || info.vipStage || info.vip_level || info.vipLevel || '').toLowerCase();
  const rawType = String(info.membership_type || info.membershipType || info.member_type || info.memberType || '').toLowerCase();
  const vipType = Number(info.vipType || info.vip_type || info.vip || 0) || 0;
  const vipFlag = info.is_vip === true || info.isVip === true || Number(info.is_vip || info.isVip || 0) > 0 || String(info.is_vip || info.isVip || '').toLowerCase() === 'true';
  const svipFlag = info.is_svip === true || info.isSvip === true || Number(info.is_svip || info.isSvip || 0) > 0 || String(info.is_svip || info.isSvip || '').toLowerCase() === 'true';
  const text = opts.allowTextVip === true ? collectVipStringValues({ info, body }, [], 0).join(' ').toLowerCase() : '';
  let freeBenefit = sodaFreeBenefitSummary([info, body].concat(Array.isArray(opts.extraBodies) ? opts.extraBodies : []));
  const stageBenefit = sodaStageFreeBenefitSummary(rawStage, rawType);
  if (!freeBenefit.hasFreeBenefit && stageBenefit) freeBenefit = stageBenefit;
  const isSvip = svipFlag || rawCached === 'svip' || rawStage === 'svip' || rawType === 'svip' || vipType >= 10 || (opts.allowTextVip === true && /svip|supervip|super_vip/.test(text));
  const isVip = isSvip
    || vipFlag
    || rawCached === 'vip'
    || rawStage === 'vip'
    || rawStage === 'svip'
    || rawType === 'vip'
    || rawType === 'svip'
    || vipType > 0
    || (opts.allowTextVip === true && /\bvip\b|member|membership/.test(text));
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    vipType: isSvip ? 10 : (isVip ? Math.max(1, vipType) : 0),
    vipStage: isSvip ? 'svip' : (rawStage || rawType || rawCached || ''),
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : (freeBenefit.hasFreeBenefit ? freeBenefit.freeBenefitLabel : '无VIP')),
    hasFreeBenefit: !!freeBenefit.hasFreeBenefit,
    freeBenefitLabel: freeBenefit.freeBenefitLabel || '',
    freeBenefitExpiresAt: freeBenefit.freeBenefitExpiresAt || 0,
    freeBenefitSource: freeBenefit.freeBenefitSource || '',
  };
}

function extractSodaSearchTracks(body, limit) {
  const groups = Array.isArray(body && body.result_groups) ? body.result_groups : [];
  const tracksGroup = groups.find(group => String(group && group.id || '').toLowerCase() === 'tracks') || groups[0] || {};
  const raw = Array.isArray(tracksGroup.data) ? tracksGroup.data : [];
  const seen = new Set();
  const songs = [];
  raw.forEach(item => {
    const song = mapSodaTrackCandidate(item);
    const key = song && (song.id || song.name + '|' + song.artist);
    if (!song || !song.name || !key || seen.has(key)) return;
    seen.add(key);
    songs.push(song);
  });
  return songs.slice(0, limit || 50);
}

async function handleSodaSearch(keywords, limit) {
  const q = String(keywords || '').trim();
  if (!q) return [];
  const count = Math.max(4, Math.min(30, Number(limit) || 12));
  const body = await sodaApiRequest('/luna/pc/search/track', {
    q,
    count,
    offset: 0,
    search_id: Date.now(),
    limited_free_scene: SODA_LIMITED_FREE_SCENE_DIVERSION_COLD_START,
  }, { syncCookie: false });
  rememberSodaLimitedFreeInfosFromValue(body, 'search', 0);
  return extractSodaSearchTracks(body, count);
}

async function getSodaLoginInfo(opts) {
  opts = opts || {};
  if (opts.sync) await refreshSodaCookieFromClientAsync(true, { detectClient: true, allowGlobalScan: false });
  const now = Date.now();
  const canUseCache = !opts.sync
    && sodaLoginInfoCache
    && sodaLoginInfoCache.cookie === sodaCookie
    && now - sodaLoginInfoCacheAt < SODA_LOGIN_INFO_CACHE_MS
    && (!(sodaLoginInfoCache.info && sodaLoginInfoCache.info.quick) || opts.skipLocalSync);
  if (canUseCache) return { ...sodaLoginInfoCache.info };
  const cookieObj = sodaCookieObject();
  const hasSavedLoginTicket = !!sodaCookie && sodaCookieHasLoginTicket(cookieObj);
  if (!opts.sync && opts.skipLocalSync && hasSavedLoginTicket) {
    const quickInfo = {
      provider: 'soda',
      loggedIn: true,
      nickname: '汽水音乐',
      userId: '',
      avatar: '',
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: '无VIP',
      hasCookie: true,
      clientDetected: sodaClientDetected(false),
      quick: true,
      stale: true,
      profileUnavailable: true,
      message: '已读取本机汽水音乐登录票据，稍后后台校验账号状态',
    };
    sodaLoginInfoCache = { cookie: sodaCookie, info: quickInfo };
    sodaLoginInfoCacheAt = now;
    return { ...quickInfo };
  }
  if (!opts.sync && !hasSavedLoginTicket) {
    const fastInfo = {
      provider: 'soda',
      loggedIn: false,
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: '无VIP',
      hasCookie: !!sodaCookie,
      clientDetected: sodaClientDetected(false),
      message: sodaCookieHasLoginTicket(cookieObj) ? '已保存汽水登录凭据，点击“读取本机登录”刷新状态' : sodaLocalSyncMessage(),
    };
    sodaLoginInfoCache = { cookie: sodaCookie, info: fastInfo };
    sodaLoginInfoCacheAt = now;
    return { ...fastInfo };
  }
  if (!hasSavedLoginTicket) {
    const emptyInfo = { provider: 'soda', loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', hasCookie: !!sodaCookie, clientDetected: false };
    emptyInfo.clientDetected = sodaClientDetected(false);
    emptyInfo.message = sodaLocalSyncMessage();
    emptyInfo.diagnostics = sodaLocalSyncDiagnostics();
    sodaLoginInfoCache = { cookie: sodaCookie, info: emptyInfo };
    sodaLoginInfoCacheAt = now;
    return { ...emptyInfo };
  }
  try {
    const body = await sodaApiRequest('/luna/pc/me', {}, { syncCookie: false, security: false, noClientScan: true });
    const info = sodaLoginUserInfoFromBody(body);
    sodaLastLoginProbe = { ok: true, body, info, checkedAt: Date.now(), error: '' };
    const id = sodaLoginUserId(info, body);
    if (!id) {
      const message = sodaApiErrorMessage(body, '汽水接口没有返回用户信息，登录票据可能已过期或接口字段发生变化');
      if (hasSavedLoginTicket) {
        const partialInfo = {
          provider: 'soda',
          loggedIn: true,
          nickname: '汽水音乐',
          userId: '',
          avatar: '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
          hasCookie: true,
          clientDetected: sodaClientDetected(false),
          stale: true,
          profileUnavailable: true,
          error: message,
          message: '已读取到汽水音乐本机登录票据，账号资料暂未返回；会继续使用本机会话尝试播放',
          diagnostics: sodaLocalSyncDiagnostics(),
        };
        sodaLoginInfoCache = { cookie: sodaCookie, info: partialInfo };
        sodaLoginInfoCacheAt = now;
        return { ...partialInfo };
      }
      const noUserInfo = {
        provider: 'soda',
        loggedIn: false,
        vipType: 0,
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        vipLabel: '无VIP',
        hasCookie: true,
        clientDetected: sodaClientDetected(false),
        error: message,
        message,
        diagnostics: sodaLocalSyncDiagnostics(),
      };
      sodaLoginInfoCache = { cookie: sodaCookie, info: noUserInfo };
      sodaLoginInfoCacheAt = now;
      return { ...noUserInfo };
    }
    const cachedVipLevel = opts.allowCachedVip === true ? readSodaCachedVipLevel(id) : '';
    const vip = normalizeSodaVip(info, body, { cachedVipLevel, allowCachedVip: opts.allowCachedVip === true });
    const result = {
      provider: 'soda',
      loggedIn: !!id,
      userId: id,
      nickname: info.nickname || info.name || (id ? ('Soda ' + id) : 'Soda Music'),
      avatar: sodaImageUrl(info.larger_avatar_url || info.medium_avatar_url || info.avatar || info.avatar_url),
      ...vip,
      hasCookie: true,
      clientDetected: sodaClientDetected(false),
    };
    sodaLoginInfoCache = { cookie: sodaCookie, info: result };
    sodaLoginInfoCacheAt = now;
    return { ...result };
  } catch (e) {
    sodaLastLoginProbe = { ok: false, body: null, info: null, checkedAt: Date.now(), error: e.message || String(e) };
    if (hasSavedLoginTicket) {
      const staleInfo = {
        provider: 'soda',
        loggedIn: true,
        nickname: '汽水音乐',
        userId: '',
        avatar: '',
        vipType: 0,
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        vipLabel: '无VIP',
        hasCookie: true,
        clientDetected: sodaClientDetected(false),
        stale: true,
        profileUnavailable: true,
        error: e.message,
        message: '已使用本机保存的汽水登录凭据，联网验证失败时保持登录状态',
        diagnostics: sodaLocalSyncDiagnostics(),
      };
      sodaLoginInfoCache = { cookie: sodaCookie, info: staleInfo };
      sodaLoginInfoCacheAt = now;
      return { ...staleInfo };
    }
    const errorInfo = { provider: 'soda', loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', hasCookie: !!sodaCookie, clientDetected: true, error: e.message };
    errorInfo.clientDetected = sodaClientDetected(false);
    errorInfo.message = e.message || sodaLocalSyncMessage();
    errorInfo.diagnostics = sodaLocalSyncDiagnostics();
    sodaLoginInfoCache = { cookie: sodaCookie, info: errorInfo };
    sodaLoginInfoCacheAt = now;
    return { ...errorInfo };
  }
}

async function handleSodaUserPlaylists() {
  const info = await getSodaLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'soda', playlists: [] };
  const pageSize = 200;
  let cursor = 0;
  const raw = [];
  const seenCursors = new Set();
  const seenPlaylistIds = new Set();
  for (let page = 0; page < 40; page++) {
    const cursorKey = String(cursor ?? '');
    if (seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey);
    const body = await sodaApiRequest('/luna/pc/me/playlist', { count: pageSize, cursor });
    const pageItems = Array.isArray(body.playlists) ? body.playlists : [];
    let added = 0;
    pageItems.forEach(item => {
      const mapped = mapSodaPlaylist(item);
      const key = String(mapped.id || item && (item.id || item.playlist_id || item.playlistId) || '');
      if (key && seenPlaylistIds.has(key)) return;
      if (key) seenPlaylistIds.add(key);
      raw.push(item);
      added += 1;
    });
    const data = body.data || body;
    const nextCursor = data.next_cursor ?? data.nextCursor ?? data.next_page_cursor ?? data.nextPageCursor ?? data.cursor_next ?? data.cursorNext;
    const hasMore = !!(data.has_more ?? data.hasMore ?? data.more ?? data.has_next ?? data.hasNext);
    if (nextCursor !== undefined && nextCursor !== null && String(nextCursor) !== cursorKey) {
      cursor = nextCursor;
    } else if (hasMore || pageItems.length >= pageSize) {
      const numericCursor = Number(cursor);
      if (!Number.isFinite(numericCursor)) break;
      cursor = numericCursor + pageItems.length;
    } else {
      break;
    }
    if (!pageItems.length || !added) break;
  }
  return {
    loggedIn: true,
    provider: 'soda',
    userId: info.userId,
    playlists: raw.map(mapSodaPlaylist).filter(pl => pl.id && pl.name),
  };
}

async function handleSodaPlaylistTracks(id) {
  const info = await getSodaLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'soda', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'soda', error: 'Missing Soda playlist id', tracks: [] };
  const pageSize = 500;
  let cursor = 0;
  let firstBody = null;
  const rawTracks = [];
  const seenCursors = new Set();
  const seenTrackKeys = new Set();
  while (true) {
    const cursorKey = String(cursor ?? '');
    if (seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey);
    const body = await sodaApiRequest('/luna/pc/playlist/detail', {
      playlist_id: pid,
      count: pageSize,
      cursor,
      limited_free_scene: SODA_LIMITED_FREE_SCENE_DIVERSION_COLD_START,
    });
    if (!firstBody) firstBody = body;
    rememberSodaLimitedFreeInfosFromValue(body, 'playlist_detail', 0);
    const pageTracks = Array.isArray(body.media_resources) ? body.media_resources : (Array.isArray(body.tracks) ? body.tracks : []);
    let added = 0;
    pageTracks.forEach(item => {
      const entity = item && (item.entity || item.data || item) || {};
      const track = entity.track_wrapper || entity.track || entity.track_info || entity.song || entity;
      const key = String(track && (track.id || track.track_id || track.trackId || track.vid || track.video_id) || '');
      if (key && seenTrackKeys.has(key)) return;
      if (key) seenTrackKeys.add(key);
      rawTracks.push(item);
      added += 1;
    });
    const data = body.data || body;
    const nextCursor = data.next_cursor ?? data.nextCursor ?? data.next_page_cursor ?? data.nextPageCursor ?? data.cursor_next ?? data.cursorNext;
    const hasMore = !!(data.has_more ?? data.hasMore ?? data.more ?? data.has_next ?? data.hasNext);
    if (nextCursor !== undefined && nextCursor !== null && String(nextCursor) !== cursorKey) {
      cursor = nextCursor;
    } else if (hasMore || pageTracks.length >= pageSize) {
      const numericCursor = Number(cursor);
      if (!Number.isFinite(numericCursor)) break;
      cursor = numericCursor + pageTracks.length;
    } else {
      break;
    }
    if (!pageTracks.length || !added) break;
  }
  const tracks = rawTracks
    .map(item => {
      const entity = item && (item.entity || item.data || item) || {};
      return mapSodaTrack(entity.track_wrapper || entity.track || entity.track_info || entity.song || entity);
    })
    .filter(song => song.id && song.name);
  const playlist = mapSodaPlaylist((firstBody && firstBody.playlist) || { id: pid });
  if (!playlist.trackCount) playlist.trackCount = tracks.length;
  return { loggedIn: true, provider: 'soda', playlist, tracks };
}

async function requireSodaLoginInfoForWrite() {
  const info = await getSodaLoginInfo({ sync: true });
  if (!info.loggedIn || !info.userId) {
    throw providerActionError('SODA_LOGIN_REQUIRED', '请先登录汽水音乐后再同步', 401);
  }
  return info;
}

function sodaSongActionId(input) {
  input = input || {};
  return String(input.sodaId || input.trackId || input.track_id || input.id || '').trim();
}

function sodaTrackMedia(id) {
  return { id: String(id || '').trim(), type: 'track' };
}

function isSodaFavoritePlaylist(pl) {
  if (isProviderFavoritePlaylistName(pl && pl.name)) return true;
  const name = String(pl && pl.name || '').trim().toLowerCase();
  return /我喜欢|我的喜欢|喜欢的音乐|liked|favorite|heart|love/i.test(name);
}

function sodaTrackMatchesId(song, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return false;
  return String(song && (song.sodaId || song.id || song.trackId || song.track_id) || '').trim() === wanted;
}

function sodaWriteOk(body) {
  body = body && (body.body || body);
  if (!body || typeof body !== 'object') return false;
  if (Number(body.httpStatusCode || 0) >= 400) return false;
  if (!Object.keys(body).length) return true;
  const statusInfo = body.status_info || body.statusInfo || {};
  const raw = body.code ?? body.status_code ?? body.statusCode ?? body.status ?? statusInfo.status_code ?? statusInfo.status;
  if (raw !== undefined && raw !== null && raw !== '') {
    const code = Number(raw);
    if (Number.isFinite(code)) return code === 0 || code === 200;
  }
  if (body.success === true || body.ok === true || statusInfo.success === true || statusInfo.ok === true) return true;
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  if (data.success === true || data.ok === true) return true;
  return false;
}

function sodaWriteMessage(body, fallback) {
  const statusCode = Number(body && body.httpStatusCode || 0) || 0;
  const msg = sodaApiErrorMessage(body, fallback) || fallback || '';
  if (statusCode >= 400) return 'HTTP ' + statusCode + (msg ? ': ' + msg : '');
  return msg;
}

function sodaWriteAttemptMessage(attempts, fallback) {
  const messages = (attempts || []).map(item => String(item && item.message || '').trim()).filter(Boolean);
  if (messages.length && messages.every(msg => /^HTTP 404\b/i.test(msg))) return 'SODA_PLAYLIST_WRITE_UNSUPPORTED';
  return messages.pop() || fallback || '';
}

function sodaShortErrorText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const max = Math.max(40, limit || 180);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function sodaParseErrorBody(err) {
  const text = err && err.body;
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function sodaAttemptErrorMessage(err, fallback) {
  const body = sodaParseErrorBody(err);
  const statusCode = Number(err && (err.statusCode || err.status) || 0) || 0;
  const parsedMsg = body ? sodaWriteMessage(body, '') : '';
  const rawMsg = sodaShortErrorText(err && err.body, 180);
  const msg = parsedMsg || rawMsg || err && err.message || fallback || '';
  if (statusCode >= 400 && !/^HTTP\s+\d+/i.test(msg)) return 'HTTP ' + statusCode + (msg ? ': ' + msg : '');
  return msg;
}

async function sodaFavoritePlaylistWithTracks() {
  const listResult = await handleSodaUserPlaylists();
  const playlists = listResult.playlists || [];
  const favorite = playlists.find(pl => isSodaFavoritePlaylist(pl)) || playlists[0] || null;
  if (!favorite || !favorite.id) return { playlist: null, tracks: [] };
  const tracksResult = await handleSodaPlaylistTracks(favorite.id);
  return { playlist: favorite, tracks: tracksResult.tracks || [] };
}

async function confirmSodaPlaylistContainsTrack(pid, id, opts) {
  opts = opts || {};
  const waits = opts.slow ? [0, 700, 1600, 3200, 5600] : [0, 500, 1300, 2600];
  for (const wait of waits) {
    if (wait) await delay(wait);
    try {
      const detail = await handleSodaPlaylistTracks(pid);
      const tracks = detail && detail.tracks || [];
      if (tracks.some(song => sodaTrackMatchesId(song, id))) return true;
    } catch (err) {
      console.warn('[SodaPlaylistVerify]', pid, err.message);
    }
  }
  return false;
}

async function confirmSodaFavoriteContainsTrack(id, opts) {
  try {
    const listResult = await handleSodaUserPlaylists();
    const favorite = (listResult.playlists || []).find(pl => isSodaFavoritePlaylist(pl)) || null;
    const verified = !!(favorite && favorite.id && await confirmSodaPlaylistContainsTrack(favorite.id, id, opts));
    return { favorite, verified };
  } catch (err) {
    console.warn('[SodaLikeVerify] favorite playlist read failed:', err.message);
    return { favorite: null, verified: false, error: err.message };
  }
}

async function handleSodaSongLikeCheck(ids) {
  await requireSodaLoginInfoForWrite();
  const requested = (ids || []).map(id => String(id || '').trim()).filter(Boolean);
  if (!requested.length) return { provider: 'soda', loggedIn: true, ids: [], liked: {} };
  let tracks = [];
  try {
    const favorite = await sodaFavoritePlaylistWithTracks();
    tracks = favorite.tracks || [];
  } catch (err) {
    console.warn('[SodaLikeCheck] favorite playlist read failed:', err.message);
  }
  const liked = {};
  requested.forEach(id => {
    liked[id] = tracks.some(song => sodaTrackMatchesId(song, id));
  });
  return { provider: 'soda', loggedIn: true, ids: requested, liked };
}

async function trySodaWriteAttempts(attempts) {
  const results = [];
  for (const attempt of attempts) {
    try {
      const body = await sodaApiRequest(attempt.path, attempt.params || {}, {
        method: attempt.method || 'POST',
        body: attempt.body || {},
        allowHttpError: true,
      });
      const ok = sodaWriteOk(body);
      results.push({ api: attempt.name || attempt.path, ok, statusCode: Number(body && body.httpStatusCode || 0) || 0, message: sodaWriteMessage(body), body });
      if (ok) return { success: true, body, attempts: results };
    } catch (err) {
      results.push({ api: attempt.name || attempt.path, ok: false, statusCode: Number(err && (err.statusCode || err.status) || 0) || 0, message: sodaAttemptErrorMessage(err, 'SODA_WRITE_FAILED'), body: sodaParseErrorBody(err) || undefined });
    }
  }
  return { success: false, attempts: results, error: sodaWriteAttemptMessage(results, 'SODA_WRITE_FAILED') };
}

async function handleSodaSongLike(input, like) {
  await requireSodaLoginInfoForWrite();
  const id = sodaSongActionId(input);
  if (!id) throw providerActionError('SODA_MISSING_SONG_ID', '缺少汽水音乐歌曲 ID', 400);
  const nextLike = like !== false && String(like) !== 'false' && String(like) !== '0';
  const media = [sodaTrackMedia(id)];
  const attempts = nextLike ? [
    { name: 'CollectMediaList_pc', path: '/luna/pc/me/collection/media', method: 'POST', body: { scene: '', media } },
    { name: 'CollectMediaList', path: '/luna/me/collection/media', method: 'POST', body: { scene: '', media } },
    { name: 'CollectMediaList_pc_action_1', path: '/luna/pc/me/collection/media', method: 'POST', body: { scene: '', collect_action: 1, media } },
    { name: 'CollectMediaList_action', path: '/luna/pc/me/collection/media', method: 'POST', body: { scene: '', collect_action: 4, media } },
    { name: 'CollectMediaList_slash', path: '/luna/pc/me/collection/media/', method: 'POST', body: { scene: '', media } },
  ] : [
    { name: 'DeleteCollectedMediaList_pc', path: '/luna/pc/me/collection/media/delete', method: 'POST', body: { media } },
    { name: 'DeleteCollectedMediaList', path: '/luna/me/collection/media/delete', method: 'POST', body: { media } },
    { name: 'DeleteCollectedMediaList_slash', path: '/luna/pc/me/collection/media/delete/', method: 'POST', body: { media } },
  ];
  const result = await trySodaWriteAttempts(attempts);
  if (result.success) {
    let verified = !nextLike;
    if (nextLike) {
      const confirm = await confirmSodaFavoriteContainsTrack(id);
      verified = confirm.verified;
    }
    return { provider: 'soda', loggedIn: true, success: true, verified, pendingVerify: nextLike && !verified, id, liked: nextLike, body: result.body, attempts: result.attempts };
  }
  if (nextLike) {
    const confirm = await confirmSodaFavoriteContainsTrack(id, { slow: true });
    if (confirm.verified) {
      return { provider: 'soda', loggedIn: true, success: true, verified: true, recoveredByVerify: true, id, liked: true, attempts: result.attempts };
    }
  }
  return { provider: 'soda', loggedIn: true, success: false, id, liked: !nextLike, error: result.error || 'SODA_LIKE_WRITE_FAILED', attempts: result.attempts };
}

async function handleSodaPlaylistAddSong(pid, input) {
  await requireSodaLoginInfoForWrite();
  const playlistId = String(pid || '').trim();
  const id = sodaSongActionId(input);
  if (!playlistId || !id) {
    return { provider: 'soda', loggedIn: true, success: false, error: 'Missing playlist id or song id', attempts: [] };
  }
  let targetPlaylist = null;
  try {
    const listResult = await handleSodaUserPlaylists();
    targetPlaylist = (listResult.playlists || []).find(pl => String(pl.id || '') === playlistId) || null;
  } catch (err) {
    console.warn('[SodaPlaylistAdd] playlist lookup failed:', err.message);
  }
  if (targetPlaylist && isSodaFavoritePlaylist(targetPlaylist)) {
    const liked = await handleSodaSongLike({ id }, true);
    return {
      provider: 'soda',
      loggedIn: true,
      success: !!(liked && liked.success),
      pid: playlistId,
      id,
      liked: true,
      favoriteFallback: true,
      verified: liked && liked.verified,
      pendingVerify: !!(liked && liked.pendingVerify),
      error: liked && liked.success ? '' : (liked && liked.error || 'SODA_PLAYLIST_WRITE_UNSUPPORTED'),
      attempts: liked && liked.attempts || [],
      body: liked && liked.body,
    };
  }
  if (targetPlaylist && targetPlaylist.readOnly) {
    return { provider: 'soda', loggedIn: true, success: false, pid: playlistId, id, error: 'SODA_PLAYLIST_READONLY', attempts: [] };
  }
  const media = [sodaTrackMedia(id)];
  const attempts = [
    { name: 'MAppendPlaylistMedia_pc', path: '/luna/pc/me/playlist/media/append', method: 'POST', body: { playlist_id: playlistId, media } },
    { name: 'MAppendPlaylistMedia', path: '/luna/me/playlist/media/append', method: 'POST', body: { playlist_id: playlistId, media } },
    { name: 'MAppendPlaylistMedia_pc_scene', path: '/luna/pc/me/playlist/media/append', method: 'POST', body: { playlist_id: playlistId, scene: '', media } },
    { name: 'MAppendPlaylistMedia_slash', path: '/luna/pc/me/playlist/media/append/', method: 'POST', body: { playlist_id: playlistId, media } },
    { name: 'MAppendPlaylistTracks', path: '/luna/me/playlist/track/append', method: 'POST', body: { playlist_id: playlistId, track_ids: [id] } },
  ];
  const result = await trySodaWriteAttempts(attempts);
  if (result.success) {
    const verified = await confirmSodaPlaylistContainsTrack(playlistId, id);
    return { provider: 'soda', loggedIn: true, success: true, verified, pendingVerify: !verified, pid: playlistId, id, body: result.body, attempts: result.attempts };
  }
  const recovered = await confirmSodaPlaylistContainsTrack(playlistId, id, { slow: true });
  if (recovered) {
    return { provider: 'soda', loggedIn: true, success: true, verified: true, recoveredByVerify: true, pid: playlistId, id, attempts: result.attempts };
  }
  return {
    provider: 'soda',
    loggedIn: true,
    success: false,
    pid: playlistId,
    id,
    error: result.error === 'SODA_WRITE_FAILED' ? 'SODA_PLAYLIST_WRITE_UNSUPPORTED' : (result.error || 'SODA_PLAYLIST_WRITE_UNSUPPORTED'),
    attempts: result.attempts,
  };
}

function sodaPathLooksPreview(pathParts) {
  return sodaResolver.sodaPathLooksPreview(pathParts);
}

function sodaUrlLooksNonAudioAsset(url, pathParts) {
  return sodaResolver.sodaUrlLooksNonAudioAsset(url, pathParts);
}

function sodaUrlLooksPlayableAudio(url, pathParts) {
  return sodaResolver.sodaUrlLooksPlayableAudio(url, pathParts);
}

function findSodaMediaUrl(value, depth, pathParts, opts) {
  return sodaResolver.findSodaMediaUrl(value, depth, pathParts, opts);
}

function parseSodaJsonMaybe(value) {
  return sodaResolver.parseSodaJsonMaybe(value);
}

function sodaQualityScore(quality, requested) {
  return sodaResolver.sodaQualityScore(quality, requested);
}

function sodaResolvedQualityLevel(quality, bitrate, fallback) {
  const q = String(quality || '').toLowerCase();
  if (/jy|master|母带|臻品|studio/.test(q)) return 'jymaster';
  if (/hi[-_ ]?res|hires|高解析/.test(q)) return 'hires';
  if (/lossless|flac|sq|无损/.test(q)) return 'lossless';
  if (/highest|exhigh|320|hq|高品|极高/.test(q)) return 'exhigh';
  if (/higher|medium|standard|normal|128|std|标准|aac|m4a/.test(q)) return 'standard';
  const br = Number(bitrate) || 0;
  if (br >= 1800000) return 'hires';
  if (br >= 900000) return 'lossless';
  if (br >= 256000) return 'exhigh';
  if (br > 0) return 'standard';
  return normalizeQualityPreference(fallback || 'hires');
}

function sodaMediaItemDurationMs(item) {
  return sodaResolver.sodaMediaItemDurationMs(item);
}

function sodaMediaItemLooksPreview(item, expectedDurationMs) {
  return sodaResolver.sodaMediaItemLooksPreview(item, expectedDurationMs);
}

function normalizeSodaDurationMs(value) {
  const raw = Number(value || 0) || 0;
  if (!raw) return 0;
  return raw > 10000 ? raw : raw * 1000;
}

function sodaTrackDurationMsFromBody(body) {
  const mapped = mapSodaTrack(body);
  return normalizeSodaDurationMs(mapped && mapped.duration || 0);
}

function sodaExpectedDurationMs(body, options) {
  options = options || {};
  return Math.max(
    sodaTrackDurationMsFromBody(body),
    normalizeSodaDurationMs(options.duration || options.durationMs || options.expectedDuration || options.expectedDurationMs || 0)
  );
}

function sodaBodyHasOnlyPreviewMedia(body) {
  return sodaResolver.sodaBodyHasOnlyPreviewMedia(body);
}

function sodaMediaDurationIsTooShort(actualMs, expectedDurationMs) {
  return sodaResolver.sodaMediaDurationIsTooShort(actualMs, expectedDurationMs);
}

function sodaVideoItemCandidates(videoList, qualityPreference, expectedDurationMs) {
  return sodaResolver.sodaVideoItemCandidates(videoList, qualityPreference, expectedDurationMs);
}

function chooseSodaVideoItem(videoList, qualityPreference, expectedDurationMs) {
  const list = sodaVideoItemCandidates(videoList, qualityPreference, expectedDurationMs);
  return list[0] && list[0].item || null;
}

function pickSodaMediaUrlFromKeys(item, keys) {
  return sodaResolver.pickSodaMediaUrlFromKeys(item, keys);
}

function sodaMediaInfoFromItem(item) {
  return sodaResolver.sodaMediaInfoFromItem(item);
}

function parseFfmpegDurationMs(text) {
  const match = String(text || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) return 0;
  return Math.round(((Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0)) * 1000);
}

function ffmpegDurationProbeKey(media) {
  return crypto.createHash('sha1').update(String(media && media.url || '') + '|' + String(media && media.spade || '')).digest('hex');
}

function probeSodaMediaDurationMs(media, timeoutMs) {
  if (!media || !media.url || !ffmpegAvailable()) return Promise.resolve(0);
  const key = ffmpegDurationProbeKey(media);
  const cached = sodaMediaDurationProbeCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return Promise.resolve(cached.durationMs || 0);
  return new Promise(resolve => {
    let settled = false;
    let stderr = '';
    let decodedKey = '';
    let timer = null;
    try {
      if (media.spade) decodedKey = decodeSodaSpade(media.spade);
    } catch (e) {
      decodedKey = '';
    }
    const args = ['-hide_banner', '-nostdin', ...sodaFfmpegInputArgs(media.url)];
    if (decodedKey) args.push('-decryption_key', decodedKey);
    args.push('-i', media.url);
    const child = spawn(ffmpegBinaryPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const finish = durationMs => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      durationMs = Math.max(0, Number(durationMs) || 0);
      sodaMediaDurationProbeCache.set(key, { at: Date.now(), durationMs });
      try { if (!child.killed) child.kill('SIGKILL'); } catch (e) {}
      resolve(durationMs);
    };
    timer = setTimeout(() => finish(parseFfmpegDurationMs(stderr)), Math.max(1800, Number(timeoutMs) || 6500));
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
      const durationMs = parseFfmpegDurationMs(stderr);
      if (durationMs) finish(durationMs);
    });
    child.on('error', () => finish(0));
    child.on('close', () => finish(parseFfmpegDurationMs(stderr)));
  });
}

async function sodaMediaCandidateIsUsable(media, expectedDurationMs, label) {
  return sodaResolver.sodaMediaCandidateIsUsable(media, expectedDurationMs, label);
}

async function sodaMediaInfoFromVideoList(videoList, qualityPreference, expectedDurationMs, label) {
  return sodaResolver.sodaMediaInfoFromVideoList(videoList, qualityPreference, expectedDurationMs, label);
}

async function sodaMediaInfoFromVideoModel(videoModel, qualityPreference, expectedDurationMs) {
  return sodaResolver.sodaMediaInfoFromVideoModel(videoModel, qualityPreference, expectedDurationMs);
}

async function sodaMediaInfoFromPlayerInfoUrl(url, qualityPreference, expectedDurationMs) {
  return sodaResolver.sodaMediaInfoFromPlayerInfoUrl(url, qualityPreference, expectedDurationMs);
}

function findSodaObjectWithAnyKey(value, keys, depth) {
  return sodaResolver.findSodaObjectWithAnyKey(value, keys, depth);
}

function sodaPlayerCandidates(body) {
  return sodaResolver.sodaPlayerCandidates(body);
}

async function resolveSodaMediaInfo(body, qualityPreference, options) {
  return sodaResolver.resolveSodaMediaInfo(body, qualityPreference, options);
}

function sodaCookieFingerprint() {
  return crypto.createHash('sha1').update(String(sodaCookie || 'guest')).digest('hex').slice(0, 16);
}

function sodaLimitedFreeCacheKey(trackId) {
  return sodaCookieFingerprint() + ':' + String(trackId || '').trim();
}

function sodaLimitedFreeExpireMs(value) {
  const n = Number(value || 0) || 0;
  if (!n) return 0;
  return n > 1000000000000 ? n : n * 1000;
}

function normalizeSodaLimitedFreeInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const sign = String(info.sign || info.Sign || '').trim();
  const signVersion = String(info.sign_version || info.signVersion || info.SignVersion || '').trim();
  const limitedFreeRaw = info.limited_free ?? info.limitedFree ?? info.LimitedFree;
  const limitedFree = limitedFreeRaw === true
    || limitedFreeRaw === 1
    || String(limitedFreeRaw || '').toLowerCase() === 'true'
    || !!sign;
  if (!limitedFree || !sign || !signVersion) return null;
  const expireTime = Number(info.expire_time || info.expireTime || info.ExpireTime || 0) || 0;
  const expireMs = sodaLimitedFreeExpireMs(expireTime);
  if (expireMs && expireMs <= Date.now()) return null;
  const out = {
    limited_free: true,
    expire_time: expireTime,
    sign,
    sign_version: signVersion,
  };
  const optionalKeys = [
    'limited_free_type',
    'config',
    'rewind_prev_intercept_type',
    'intercept_type',
    'limited_free_scene',
    'queue_types',
  ];
  optionalKeys.forEach(key => {
    if (info[key] !== undefined && info[key] !== null && info[key] !== '') out[key] = info[key];
  });
  if (!out.limited_free_type && info.limitedFreeType) out.limited_free_type = info.limitedFreeType;
  if (!out.rewind_prev_intercept_type && info.rewindPrevInterceptType) out.rewind_prev_intercept_type = info.rewindPrevInterceptType;
  if (!out.intercept_type && info.interceptType !== undefined) out.intercept_type = info.interceptType;
  if (!out.limited_free_scene && info.limitedFreeScene !== undefined) out.limited_free_scene = info.limitedFreeScene;
  if (!out.queue_types && Array.isArray(info.queueTypes)) out.queue_types = info.queueTypes;
  return out;
}

function sodaLimitedFreeParam(info, opts) {
  opts = opts || {};
  const signed = normalizeSodaLimitedFreeInfo(info);
  if (signed) {
    return {
      from_other_queue: false,
      is_login_support: opts.isLoginSupport !== false,
      is_logout_support: opts.isLogoutSupport !== false,
      ...signed,
    };
  }
  if (!opts.allowUnsignedFallback) return null;
  return {
    limited_free: true,
    from_other_queue: false,
    is_login_support: true,
    is_logout_support: true,
  };
}

function sodaMCheckLimitedFreeParam(info) {
  const signed = normalizeSodaLimitedFreeInfo(info);
  if (!signed) return null;
  const out = {
    limited_free: signed.limited_free,
    expire_time: signed.expire_time,
    sign: signed.sign,
    sign_version: signed.sign_version,
  };
  ['limited_free_type', 'rewind_prev_intercept_type'].forEach(key => {
    if (signed[key] !== undefined && signed[key] !== null && signed[key] !== '') out[key] = signed[key];
  });
  return out;
}

function sodaObjectTrackId(value) {
  if (!value || typeof value !== 'object') return '';
  const direct = value.id || value.track_id || value.trackId || value.media_id || value.mediaId || value.song_id || value.songId;
  if (direct) return String(direct);
  const track = value.track || value.track_info || value.trackInfo || value.song;
  if (track && typeof track === 'object') return sodaObjectTrackId(track);
  const wrapper = value.track_wrapper || value.trackWrapper;
  if (wrapper && typeof wrapper === 'object') return sodaObjectTrackId(wrapper);
  const entity = value.entity || value.data;
  if (entity && typeof entity === 'object') return sodaObjectTrackId(entity);
  return '';
}

function extractSodaLimitedFreeInfo(value, trackId, depth) {
  if (!value || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSodaLimitedFreeInfo(item, trackId, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const wanted = String(trackId || '').trim();
  const direct = value.limited_free_info || value.limitedFreeInfo;
  if (direct) {
    const ownerId = sodaObjectTrackId(value);
    if (!wanted || !ownerId || ownerId === wanted) {
      const normalized = normalizeSodaLimitedFreeInfo(direct);
      if (normalized) return normalized;
    }
  }
  for (const key of Object.keys(value)) {
    const found = extractSodaLimitedFreeInfo(value[key], wanted, depth + 1);
    if (found) return found;
  }
  return null;
}

function rememberSodaLimitedFreeInfo(trackId, info, source) {
  const id = String(trackId || '').trim();
  const normalized = normalizeSodaLimitedFreeInfo(info);
  if (!id || !normalized) return null;
  sodaLimitedFreeInfoCache.set(sodaLimitedFreeCacheKey(id), {
    info: normalized,
    source: source || '',
    cachedAt: Date.now(),
  });
  return normalized;
}

function rememberSodaLimitedFreeInfosFromValue(value, source, depth) {
  if (!value || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach(item => rememberSodaLimitedFreeInfosFromValue(item, source, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const direct = value.limited_free_info || value.limitedFreeInfo;
  if (direct) rememberSodaLimitedFreeInfo(sodaObjectTrackId(value), direct, source);
  Object.keys(value).forEach(key => rememberSodaLimitedFreeInfosFromValue(value[key], source, depth + 1));
}

function cachedSodaLimitedFreeInfo(trackId) {
  const cached = sodaLimitedFreeInfoCache.get(sodaLimitedFreeCacheKey(trackId));
  const info = cached && normalizeSodaLimitedFreeInfo(cached.info);
  if (!info) {
    sodaLimitedFreeInfoCache.delete(sodaLimitedFreeCacheKey(trackId));
    return null;
  }
  return info;
}

function sodaTrackCheckContextFromBody(body) {
  const found = findSodaObjectWithAnyKey(body, ['check_context', 'checkContext'], 0);
  return String(found && (found.check_context || found.checkContext) || '').trim();
}

function sodaMediaV2Attempts(trackId, options) {
  options = options || {};
  const id = String(trackId || '').trim();
  const checkContext = String(options.checkContext || options.check_context || sodaTrackCheckContextFromBody(options.trackBody || options.body) || '').trim();
  const item = { id, type: 'track' };
  if (checkContext) item.check_context = checkContext;
  const scenes = [
    { scene: '', scene_name: options.scene_name || '', queue_type: options.queue_type || '' },
    { scene: '', scene_name: 'search', queue_type: 'search' },
    { scene: 'search', scene_name: 'search', queue_type: 'search' },
    { scene: 'playlist', scene_name: 'playlist', queue_type: 'playlist' },
    { scene: 'music_mate_queue', scene_name: 'feed', queue_type: 'feed' },
  ];
  const attempts = [];
  scenes.forEach(scene => {
    const baseBody = {
      scene: scene.scene,
      scene_name: scene.scene_name,
      queue_type: scene.queue_type,
      limited_free_scene: SODA_LIMITED_FREE_SCENE_DIVERSION_COLD_START,
      media: [item],
    };
    attempts.push({ path: '/luna/media_v2', params: { scene: baseBody.scene }, body: baseBody });
    attempts.push({
      path: '/luna/media_v2',
      params: { scene: baseBody.scene },
      body: { ...baseBody, media: [{ ...item, track_param: { scene: baseBody.scene || baseBody.scene_name || '' } }] },
    });
  });
  const seen = new Set();
  return attempts.filter(attempt => {
    const key = JSON.stringify(attempt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

async function getSodaLimitedFreeInfo(trackId, options) {
  const cached = cachedSodaLimitedFreeInfo(trackId);
  if (cached) return cached;
  const attempts = sodaMediaV2Attempts(trackId, options);
  for (const attempt of attempts) {
    let body = {};
    try {
      body = await sodaApiRequest(attempt.path, attempt.params, { method: 'POST', body: attempt.body, syncCookie: false });
    } catch (e) {
      sodaPlaybackDebugDump('media_v2_error', { attempt, error: e && e.message || String(e) });
      continue;
    }
    rememberSodaLimitedFreeInfosFromValue(body, 'media_v2', 0);
    const info = extractSodaLimitedFreeInfo(body, trackId, 0);
    sodaPlaybackDebugDump('media_v2_attempt', {
      attempt,
      statusCode: Number(body && (body.status_code || body.statusCode || body.code || body.status) || 0),
      message: sodaApiErrorMessage(body, ''),
      foundLimitedFreeInfo: !!info,
      topKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 32) : [],
      body,
    });
    if (info) return rememberSodaLimitedFreeInfo(trackId, info, 'media_v2');
  }
  return null;
}

async function trySodaMCheckMedia(trackId, limitedFreeInfo, options) {
  const param = sodaMCheckLimitedFreeParam(limitedFreeInfo);
  if (!param) return null;
  const id = String(trackId || '').trim();
  const duration = normalizeSodaDurationMs(options && (options.duration || options.durationMs || options.expectedDuration || options.expectedDurationMs) || 0);
  const mediaItem = { type: 'track', id };
  if (duration) mediaItem.attr = { duration };
  const body = {
    media_list: [mediaItem],
    limited_free_param_map: { [id]: param },
    scene: 1,
    queue_type: options && options.queue_type || '',
    scene_name: options && options.scene_name || '',
  };
  for (const apiPath of ['/luna/pc/mcheck', '/luna/mcheck']) {
    try {
      const result = await sodaApiRequest(apiPath, {}, { method: 'POST', body, syncCookie: false });
      rememberSodaLimitedFreeInfosFromValue(result, 'mcheck', 0);
      sodaPlaybackDebugDump('mcheck_attempt', {
        path: apiPath,
        statusCode: Number(result && (result.status_code || result.statusCode || result.code || result.status) || 0),
        message: sodaApiErrorMessage(result, ''),
        body: result,
      });
      return result;
    } catch (e) {
      sodaPlaybackDebugDump('mcheck_error', { path: apiPath, error: e && e.message || String(e) });
    }
  }
  return null;
}

function sodaTrackV2Body(trackId, options, overrides) {
  return sodaResolver.sodaTrackV2Body(trackId, options, overrides);
}

function sodaApiQualityCandidates(qualityPreference) {
  return sodaResolver.sodaApiQualityCandidates(qualityPreference);
}

function sodaTrackV2Attempts(trackId, options) {
  return sodaResolver.sodaTrackV2Attempts(trackId, options);
}

function sodaPlaybackDebugDump(label, payload) {
  const file = process.env.SODA_PLAYBACK_DEBUG_FILE;
  if (!file) return;
  try {
    const safe = JSON.stringify({ label, at: new Date().toISOString(), ...(payload || {}) }, (key, value) => {
      if (typeof value !== 'string') return value;
      if (/cookie|ticket|token|session|auth|sign|spade|ptoken/i.test(key)) return value ? '[redacted]' : '';
      return value.length > 1200 ? value.slice(0, 1200) + '...[truncated]' : value;
    }, 2);
    fs.appendFileSync(file, safe + '\n', 'utf8');
  } catch (e) {}
}

async function tryResolveSodaTrackV2(trackId, qualityPreference, options) {
  return sodaResolver.tryResolveSodaTrackV2(trackId, qualityPreference, options);
}

function normalizeSodaDecryptionKey(value) {
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex');
  if (Array.isArray(value)) return Buffer.from(value).toString('hex');
  let text = String(value || '').trim();
  if (!text) return '';
  if (/^0x[0-9a-f]+$/i.test(text)) text = text.slice(2);
  if (/^[0-9a-f]{32,64}$/i.test(text)) return text.toLowerCase();
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.key) return normalizeSodaDecryptionKey(parsed.key);
    if (parsed && parsed.decryption_key) return normalizeSodaDecryptionKey(parsed.decryption_key);
  } catch (e) {}
  try {
    const buf = Buffer.from(text, 'base64');
    if (buf.length === 16 || buf.length === 32) return buf.toString('hex');
  } catch (e) {}
  return text;
}

function decodeSodaSpade(spade) {
  const raw = String(spade || '').trim();
  if (!raw) return '';
  const device = sodaNativeDevice();
  if (!device) throw sodaDecoderUnavailableError(sodaPlaybackNativeStatus({ forceScan: true }));
  return normalizeSodaDecryptionKey(device.decodeSpade(raw));
}

function cleanupSodaPlaybackSessions() {
  const now = Date.now();
  for (const [token, item] of sodaPlaybackSessions) {
    if (!item || now - (item.createdAt || 0) > SODA_PLAYBACK_SESSION_TTL_MS) sodaPlaybackSessions.delete(token);
  }
}

function createSodaPlaybackSession(trackId, media, qualityPreference, playbackOptions) {
  cleanupSodaPlaybackSessions();
  if (!media || !media.url) throw new Error('Missing Soda media URL');
  if (!media.spade) return null;
  const decodedKey = decodeSodaSpade(media.spade);
  if (!decodedKey) throw new Error('Missing Soda decryption key');
  playbackOptions = playbackOptions || {};
  const token = crypto.randomBytes(18).toString('base64url');
  sodaPlaybackSessions.set(token, {
    token,
    createdAt: Date.now(),
    trackId: String(trackId || ''),
    url: media.url,
    backupUrl: media.backupUrl || '',
    spade: media.spade,
    decodedKey,
    quality: media.quality || normalizeQualityPreference(qualityPreference),
    qualityPreference: normalizeQualityPreference(qualityPreference),
    bitrate: media.bitrate || 0,
    expectedDurationMs: Number(playbackOptions.expectedDurationMs || 0) || 0,
    limitedFreeInfo: normalizeSodaLimitedFreeInfo(playbackOptions.limitedFreeInfo) || null,
  });
  return sodaPlaybackSessions.get(token);
}

function sodaPlaybackUrlForToken(token) {
  return '/api/soda/audio?token=' + encodeURIComponent(token);
}

function ffmpegAvailable() {
  return !!(ffmpegBinaryPath && fs.existsSync(ffmpegBinaryPath));
}

function sodaAudioMediaHost(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function sodaAudioCookieAllowed(sourceUrl) {
  const host = sodaAudioMediaHost(sourceUrl);
  return !!host && (host === 'qishui.com' || host.endsWith('.qishui.com'));
}

function sodaAudioRequestHeadersFor(sourceUrl, range, opts) {
  opts = opts || {};
  const headers = {
    'User-Agent': sodaUserAgent(),
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: 'https://www.qishui.com/',
    Origin: 'https://www.qishui.com',
    Connection: 'keep-alive',
  };
  if (range) headers.Range = range;
  if (opts.includeCookie && sodaCookie && sodaAudioCookieAllowed(sourceUrl)) headers.Cookie = sodaCookie;
  return headers;
}

function sodaFfmpegHeaderText(sourceUrl) {
  const headers = sodaAudioRequestHeadersFor(sourceUrl, '', { includeCookie: true });
  delete headers['User-Agent'];
  delete headers.Referer;
  return Object.keys(headers)
    .filter(key => headers[key] !== undefined && headers[key] !== null && headers[key] !== '')
    .map(key => `${key}: ${String(headers[key])}`)
    .join('\r\n') + '\r\n';
}

function sodaFfmpegInputArgs(sourceUrl) {
  return [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-user_agent', sodaUserAgent(),
    '-referer', 'https://www.qishui.com/',
    '-headers', sodaFfmpegHeaderText(sourceUrl),
  ];
}

function sodaPlaybackSourceList(session) {
  const seen = new Set();
  const sources = [];
  [session && session.url, session && session.backupUrl].forEach(item => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    sources.push(value);
  });
  return sources;
}

function applySodaPlaybackSessionMedia(session, media, qualityPreference) {
  if (!session || !media || !media.url) return false;
  let decodedKey = '';
  if (media.spade) decodedKey = decodeSodaSpade(media.spade);
  session.createdAt = Date.now();
  session.url = media.url;
  session.backupUrl = media.backupUrl || '';
  session.spade = media.spade || '';
  session.decodedKey = decodedKey;
  session.quality = media.quality || session.quality || normalizeQualityPreference(qualityPreference);
  session.qualityPreference = normalizeQualityPreference(qualityPreference || session.qualityPreference || session.quality);
  session.bitrate = media.bitrate || session.bitrate || 0;
  return true;
}

async function refreshSodaPlaybackSessionMedia(session) {
  if (!session || !session.trackId) return false;
  const qualityPreference = session.qualityPreference || session.quality || 'hires';
  const options = {};
  if (session.expectedDurationMs) {
    options.expectedDurationMs = session.expectedDurationMs;
    options.durationMs = session.expectedDurationMs;
  }
  if (session.limitedFreeInfo) {
    options.limitedFreeInfo = session.limitedFreeInfo;
    try { await trySodaMCheckMedia(session.trackId, session.limitedFreeInfo, options); } catch (e) {}
  }
  try {
    let resolved = await tryResolveSodaTrackV2(session.trackId, qualityPreference, options);
    let media = resolved && resolved.media;
    if (!media && !session.limitedFreeInfo) {
      const limitedFreeInfo = await getSodaLimitedFreeInfo(session.trackId, options).catch(() => null);
      if (limitedFreeInfo) {
        session.limitedFreeInfo = limitedFreeInfo;
        options.limitedFreeInfo = limitedFreeInfo;
        try { await trySodaMCheckMedia(session.trackId, limitedFreeInfo, options); } catch (e) {}
        resolved = await tryResolveSodaTrackV2(session.trackId, qualityPreference, options);
        media = resolved && resolved.media;
      }
    }
    if (!media || !media.url) return false;
    return applySodaPlaybackSessionMedia(session, media, qualityPreference);
  } catch (err) {
    console.warn('[SodaAudio] refresh source failed:', err && err.message || err);
    return false;
  }
}

function sodaAudioFailureMessage(stderr, fallback) {
  const text = String(stderr || '').replace(/\s+/g, ' ').trim();
  if (/403|Forbidden|access denied/i.test(text)) return 'source 403';
  if (/404|Not Found/i.test(text)) return 'source 404';
  if (/timed? out|timeout/i.test(text)) return 'source timeout';
  return fallback || 'source failed';
}

function streamSodaDecodedAudio(req, res, token) {
  cleanupSodaPlaybackSessions();
  const session = sodaPlaybackSessions.get(String(token || ''));
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('Soda playback session expired');
    return;
  }
  if (!ffmpegAvailable()) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('FFmpeg is unavailable');
    return;
  }
  const attemptedSources = new Set();
  let pendingSources = sodaPlaybackSourceList(session);
  let currentChild = null;
  let clientClosed = false;
  let refreshTried = false;
  let totalBytesSent = 0;
  let lastFailure = '';

  function writeAudioHeaders() {
    if (res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Accel-Buffering': 'no',
    });
  }

  function stopCurrentChild() {
    try { if (currentChild && !currentChild.killed) currentChild.kill('SIGKILL'); } catch (e) {}
  }

  function finishWithoutSource() {
    if (clientClosed || res.writableEnded) return;
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(lastFailure || 'Soda audio source unavailable');
    } else {
      res.end();
    }
  }

  function queueSessionSources() {
    sodaPlaybackSourceList(session).forEach(sourceUrl => {
      if (!attemptedSources.has(sourceUrl) && !pendingSources.includes(sourceUrl)) pendingSources.push(sourceUrl);
    });
  }

  function startNextSource(reason) {
    if (clientClosed || res.writableEnded) return;
    if (!pendingSources.length) {
      if (!refreshTried) {
        refreshTried = true;
        refreshSodaPlaybackSessionMedia(session)
          .then(ok => {
            if (ok) queueSessionSources();
            startNextSource(ok ? 'refreshed source' : reason);
          })
          .catch(err => {
            lastFailure = err && err.message || String(err || reason || 'source refresh failed');
            startNextSource(lastFailure);
          });
        return;
      }
      finishWithoutSource();
      return;
    }

    const sourceUrl = pendingSources.shift();
    attemptedSources.add(sourceUrl);
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      ...sodaFfmpegInputArgs(sourceUrl),
    ];
    if (session.decodedKey) args.push('-decryption_key', session.decodedKey);
    args.push(
      '-i', sourceUrl,
      '-vn',
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      '-f', 'mp3',
      'pipe:1',
    );
    let stderr = '';
    let sourceBytes = 0;
    const child = spawn(ffmpegBinaryPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentChild = child;
    let sourceSettled = false;
    function settleSource() {
      if (sourceSettled) return false;
      sourceSettled = true;
      return true;
    }
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.stdout.on('data', chunk => {
      sourceBytes += chunk.length;
      totalBytesSent += chunk.length;
      writeAudioHeaders();
      if (!res.write(chunk)) {
        child.stdout.pause();
        res.once('drain', () => {
          try { child.stdout.resume(); } catch (e) {}
        });
      }
    });
    child.on('error', err => {
      if (!settleSource()) return;
      if (currentChild === child) currentChild = null;
      lastFailure = err && err.message || 'ffmpeg start failed';
      console.error('[SodaAudio] ffmpeg start failed:', lastFailure);
      if (!sourceBytes && !clientClosed) startNextSource(lastFailure);
      else if (!res.writableEnded) res.end();
    });
    child.on('close', code => {
      if (!settleSource()) return;
      if (currentChild === child) currentChild = null;
      if (clientClosed) return;
      if (code && code !== 0) {
        lastFailure = sodaAudioFailureMessage(stderr, 'ffmpeg exited ' + code);
        console.error('[SodaAudio] ffmpeg exited:', code, lastFailure);
      }
      if (code && code !== 0 && !sourceBytes && !totalBytesSent) {
        startNextSource(lastFailure);
        return;
      }
      if (!res.writableEnded) {
        if (totalBytesSent) res.end();
        else finishWithoutSource();
      }
    });
  }

  req.on('close', () => {
    clientClosed = true;
    stopCurrentChild();
  });
  res.on('close', () => {
    clientClosed = true;
    stopCurrentChild();
  });
  startNextSource('initial source');
}

function sodaSignalHasContent(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(sodaSignalHasContent);
  if (typeof value === 'object') return Object.keys(value).some(key => sodaSignalHasContent(value[key]));
  return String(value).trim() !== '' && String(value).trim() !== '0' && String(value).trim().toLowerCase() !== 'false';
}

function sodaAccessSignalValue(value, mode) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(item => sodaAccessSignalValue(item, mode));
  if (typeof value !== 'object') {
    const text = String(value || '').trim().toLowerCase();
    return mode !== 'pay'
      ? !!text && text !== '0' && text !== 'false'
      : /vip|svip|member|pay|paid|purchase|limited|trial|audition|会员|付费|购买|试听|限免/.test(text);
  }
  const text = JSON.stringify(value).toLowerCase();
  const numericKeys = [
    'pay_play', 'payplay', 'pay_play_flag', 'pay_type', 'paytype', 'price', 'fee',
    'vip', 'vip_type', 'viptype', 'need_vip', 'needvip', 'need_pay', 'needpay',
    'member_type', 'membertype', 'membership_type', 'membershiptype',
  ];
  for (const key of numericKeys) {
    const n = Number(value[key]);
    if (Number.isFinite(n) && n > 0) return true;
  }
  const flagKeys = ['is_vip', 'isVip', 'vipOnly', 'needVip', 'needPay', 'requiresVip', 'paymentRequired'];
  for (const key of flagKeys) {
    const flag = parsePlaybackFlag(value[key]);
    if (flag === true) return true;
  }
  if (mode !== 'pay' && sodaSignalHasContent(value)) return true;
  if (mode === 'pay') {
    const valueText = Object.keys(value)
      .map(key => (value[key] && typeof value[key] === 'object') ? '' : String(value[key] || ''))
      .join(' ')
      .toLowerCase();
    return /vip|svip|member|pay_required|paid|purchase|audition|trial|会员|付费|购买|试听|限免/.test(valueText);
  }
  return /vip|svip|member|pay_required|paid|purchase|audition|trial|会员|付费|购买|试听|限免/.test(text);
}

function sodaTrackRequiresAccess(track) {
  track = track || {};
  return sodaAccessSignalValue(track.audition_info || track.auditionInfo || track.preview, 'trial')
    || sodaAccessSignalValue(track.pay_info || track.payInfo, 'pay');
}

function hasSodaPlaybackTrialSignal(value, depth) {
  if (!value || depth > 6) return false;
  if (Array.isArray(value)) return value.some(item => hasSodaPlaybackTrialSignal(item, depth + 1));
  if (typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    const lower = key.toLowerCase();
    if (['pay_info', 'payinfo'].includes(lower)) {
      if (sodaAccessSignalValue(value[key], 'pay')) return true;
    }
    if (['audition_info', 'auditioninfo', 'free_trial_info', 'freetrialinfo', 'trial_info', 'trialinfo'].includes(lower)) {
      const item = value[key];
      if (sodaAccessSignalValue(item, 'trial')) return true;
    }
  }
  return Object.keys(value).some(key => hasSodaPlaybackTrialSignal(value[key], depth + 1));
}

function sodaPlaybackFeeFromBody(body) {
  const candidates = [
    body && body.track,
    body && body.track_info,
    body && body.track_wrapper,
    body && body.song,
    body,
  ];
  for (const candidate of candidates) {
    try {
      const mapped = mapSodaTrack(candidate);
      if (mapped && Number(mapped.fee) > 0) return 1;
    } catch (e) {}
  }
  return hasSodaPlaybackTrialSignal(body, 0) ? 1 : 0;
}

async function tryResolveSodaUnencryptedPlaybackFallback(trackId, options) {
  const tried = new Set();
  const qualities = ['standard'];
  for (const quality of qualities) {
    const normalized = normalizeQualityPreference(quality);
    if (tried.has(normalized)) continue;
    tried.add(normalized);
    const resolved = await tryResolveSodaTrackV2(trackId, normalized, {
      ...(options || {}),
      qualityPreference: normalized,
      skipEncryptedMedia: true,
    });
    if (resolved && resolved.media && resolved.media.url && !resolved.media.spade) {
      return { ...resolved, fallbackQuality: normalized };
    }
  }
  return null;
}

async function handleSodaSongUrl(id, qualityPreference, options) {
  options = options || {};
  const trackId = String(id || '').trim();
  if (!trackId) return { provider: 'soda', url: '', error: 'MISSING_ID', message: 'Missing Soda track id' };

  const resolution = await sodaProvider.resolvePlayback(trackId, qualityPreference, options);
  let body = resolution.body || {};
  let media = resolution.media;
  let bodyBenefit = resolution.bodyBenefit || sodaFreeBenefitSummary([body]);
  let playbackLimitedFreeInfo = resolution.playbackLimitedFreeInfo;
  let signatureRetried = resolution.signatureRetried || false;
  let limitedFreeSynced = resolution.limitedFreeSynced || false;
  let playbackError = resolution.error;

  if (resolution.error && resolution.error === 'MISSING_ID') return { provider: 'soda', url: '', error: 'MISSING_ID', message: 'Missing Soda track id' };

  try {
    if (media && media.url) {
      let playUrl = media.url;
      let localTranscode = false;
      let encrypted = !!media.spade;
      let decoderFallbackQuality = '';
      if (encrypted) {
        const playbackStatus = sodaPlaybackNativeStatus({ forceScan: false });
        if (!playbackStatus.deviceDecoderReady) {
          const fallback = await tryResolveSodaUnencryptedPlaybackFallback(trackId, options);
          if (fallback && fallback.media && fallback.media.url) {
            body = fallback.body || body;
            bodyBenefit = fallback.bodyBenefit || sodaFreeBenefitSummary([body]);
            media = fallback.media;
            playUrl = media.url;
            encrypted = !!media.spade;
            decoderFallbackQuality = fallback.fallbackQuality || '';
          }
        }
      }
      const expectedDurationMsForPlayback = sodaExpectedDurationMs(body, options);
      if (encrypted) {
        const playbackStatus = sodaPlaybackNativeStatus({ forceScan: true });
        if (!playbackStatus.deviceDecoderReady) throw sodaDecoderUnavailableError(playbackStatus);
        const session = createSodaPlaybackSession(trackId, media, qualityPreference, {
          expectedDurationMs: expectedDurationMsForPlayback,
          limitedFreeInfo: playbackLimitedFreeInfo,
        });
        playUrl = sodaPlaybackUrlForToken(session.token);
        localTranscode = true;
      }
      const resolvedLevel = sodaResolvedQualityLevel(media.quality, media.bitrate, qualityPreference);
      const fee = Math.max(playbackRequestFee(options), sodaPlaybackFeeFromBody(body));
      let loginInfo = {};
      if (fee > 0 || options.trialHint || Number(options.previewDuration || 0) > 0) {
        try {
          loginInfo = await getSodaLoginInfo();
          if (loginInfo && loginInfo.loggedIn && !providerHasMembership('soda', loginInfo) && (loginInfo.stale || loginInfo.quick || loginInfo.profileUnavailable)) {
            loginInfo = await getSodaLoginInfo({ sync: true });
          }
        } catch (e) { loginInfo = {}; }
      }
      const playbackBenefit = sodaFreeBenefitSummary([body, loginInfo]);
      if (playbackBenefit.hasFreeBenefit) {
        rememberSodaFreeBenefit(playbackBenefit);
        loginInfo = { ...loginInfo, ...playbackBenefit };
      }
      const playbackStatusForResult = sodaPlaybackNativeStatus({ forceScan: false });
      const expectedDurationMs = expectedDurationMsForPlayback;
      const verifiedFullLength = expectedDurationMs > 90000 && media.durationMs > 0 && !sodaMediaDurationIsTooShort(media.durationMs, expectedDurationMs);
      const metadataTrial = verifiedFullLength ? false : shouldMarkPlayableAsTrial('soda', { ...options, songFee: fee }, loginInfo, { fee });
      const result = {
        provider: 'soda',
        url: playUrl,
        playable: true,
        trial: metadataTrial,
        loggedIn: !!loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
        hasFreeBenefit: !!loginInfo.hasFreeBenefit,
        freeBenefitLabel: loginInfo.freeBenefitLabel || '',
        freeBenefitExpiresAt: loginInfo.freeBenefitExpiresAt || 0,
        playbackKeyReady: !!playbackStatusForResult.playbackKeyReady,
        playbackDiagnostics: playbackStatusForResult,
        level: resolvedLevel,
        quality: media.quality ? ('Soda Music ' + media.quality) : 'Soda Music',
        br: media.bitrate || 0,
        fee,
        rawQuality: media.quality || '',
        maxAvailableQuality: resolvedLevel,
        availableQualities: qualityLevelsAtOrBelow(resolvedLevel),
        previewDuration: Number(options.previewDuration || 0) || 0,
        mediaDuration: media.durationMs || 0,
        expectedDuration: expectedDurationMs || 0,
        verifiedFullLength,
        trialHint: !!options.trialHint,
        localTranscode,
        encrypted,
        signatureRetried,
        limitedFreeSynced,
        decoderFallbackQuality,
      };
      if (metadataTrial) {
        result.restriction = playableTrialRestriction('soda', fee, loginInfo, { code: 0 });
        result.reason = result.restriction.category;
        result.message = result.restriction.message;
      }
      return result;
    }
  } catch (e) {
    playbackError = e;
    body = { status_info: { status_msg: e.message } };
  }
  const code = Number(body && body.status_code || 0);
  const rawMessage = sodaApiErrorMessage(body, '');
  const failedBenefit = sodaFreeBenefitSummary([body, sodaLoginInfoCache && sodaLoginInfoCache.info]);
  rememberSodaFreeBenefit(failedBenefit);
  const decoderUnavailable = isSodaDecoderUnavailableError(playbackError);
  const playbackStatus = decoderUnavailable
    ? (playbackError && playbackError.sodaPlaybackStatus || sodaPlaybackNativeStatus({ forceScan: false }))
    : sodaPlaybackNativeStatus({ forceScan: false });
  const category = decoderUnavailable ? 'soda_decoder_unavailable' : (code === 1000062 ? 'client_signature_required' : 'url_unavailable');
  const action = (decoderUnavailable || code === 1000062) ? 'official_client_required' : 'switch_source';
  const fallbackMessage = decoderUnavailable
    ? (playbackStatus.message || '\u5df2\u8bc6\u522b\u6c7d\u6c34\u8d26\u53f7\uff0c\u4f46\u672c\u673a\u6c7d\u6c34\u64ad\u653e\u89e3\u7801\u6a21\u5757\u672a\u5c31\u7eea')
    : (failedBenefit.hasFreeBenefit
      ? '\u5df2\u8bc6\u522b\u5230\u6c7d\u6c34\u9650\u65f6\u514d\u8d39\u6743\u76ca\uff0c\u4f46\u6c7d\u6c34\u97f3\u4e50\u4ecd\u672a\u8fd4\u56de\u53ef\u64ad\u653e\u5730\u5740\uff0c\u8bf7\u5237\u65b0\u8d26\u53f7\u4fe1\u606f\u540e\u91cd\u8bd5'
      : code === 1000062
      ? '\u6c7d\u6c34\u97f3\u4e50\u9700\u8981\u672c\u673a\u5b98\u65b9\u5ba2\u6237\u7aef\u64ad\u653e\u7b7e\u540d\uff0c\u5df2\u81ea\u52a8\u91cd\u8bd5\u4f46\u4ecd\u672a\u62ff\u5230\u53ef\u64ad\u653e\u5730\u5740'
      : '\u6c7d\u6c34\u97f3\u4e50\u6ca1\u6709\u8fd4\u56de\u53ef\u64ad\u653e\u5730\u5740');
  const restriction = playbackRestriction(
    'soda',
    category,
    decoderUnavailable ? fallbackMessage : (rawMessage || fallbackMessage),
    action,
    { code, rawMessage, signatureRetried, clientDetected: sodaClientDetected(false), playbackKeyReady: playbackStatus.playbackKeyReady, playbackDiagnostics: playbackStatus, diagnostics: sodaLocalSyncDiagnostics() }
  );
  return {
    provider: 'soda',
    url: '',
    playable: false,
    error: decoderUnavailable ? 'SODA_DECODER_UNAVAILABLE' : 'SODA_URL_UNAVAILABLE',
    restriction,
    reason: restriction.category,
    message: restriction.message,
    sodaCode: code,
    rawMessage,
    hasFreeBenefit: !!failedBenefit.hasFreeBenefit,
    freeBenefitLabel: failedBenefit.freeBenefitLabel || '',
    freeBenefitExpiresAt: failedBenefit.freeBenefitExpiresAt || 0,
    signatureRetried,
    limitedFreeSynced,
    clientDetected: sodaClientDetected(false),
    playbackKeyReady: !!playbackStatus.playbackKeyReady,
    playbackDiagnostics: playbackStatus,
    requestedQuality: normalizeQualityPreference(qualityPreference),
  };
}

async function handleSodaLyric(id) {
  const trackId = String(id || '').trim();
  if (!trackId) return { provider: 'soda', error: 'Missing Soda track id', lyric: '' };
  try {
    const body = await sodaApiRequest('/luna/pc/track_v2', {}, { method: 'POST', body: sodaTrackV2Body(trackId) });
    const parts = extractSodaLyricParts(body);
    const hasLyric = !!(parts.lyric || parts.yrc || parts.tlyric);
    return {
      provider: 'soda',
      id: trackId,
      lyric: parts.lyric || '',
      tlyric: parts.tlyric || '',
      yrc: parts.yrc || '',
      source: hasLyric ? ('soda-' + (parts.format || 'lyric')) : 'soda-empty',
      sourcePath: parts.sourcePath || '',
    };
  } catch (e) {
    return { provider: 'soda', id: trackId, lyric: '', tlyric: '', yrc: '', source: 'soda-empty', error: e.message };
  }
}

async function handleSodaDiscoverHome() {
  const info = await getSodaLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  if (!loggedIn) {
    return {
      provider: 'soda',
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      radarSongs: [],
      newSongs: [],
      recommendationSongs: [],
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  let playlists = [];
  let dailySongs = [];
  let favoriteSongs = [];
  let newSongs = [];
  try {
    const listResult = await handleSodaUserPlaylists();
    playlists = (listResult.playlists || []).slice(0, 12);
    const favorite = playlists[0] || null;
    if (favorite && favorite.id) {
      const tracksResult = await handleSodaPlaylistTracks(favorite.id);
      favoriteSongs = (tracksResult.tracks || []).slice(0, 60);
    }
    try { newSongs = await handleSodaSearch('\u65b0\u6b4c', 24); }
    catch (e) { newSongs = []; }
  } catch (e) {
    console.warn('[SodaDiscoverHome]', e && e.message || e);
  }
  dailySongs = stableDailySample(mergeDiscoverLists([newSongs, favoriteSongs], 80), 30, 'soda-daily:' + (info.userId || 'guest'));
  const radarSongs = shuffledSample(mergeDiscoverLists([dailySongs, favoriteSongs, newSongs], 60), 30);
  return {
    provider: 'soda',
    loggedIn,
    user: { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' },
    dailySongs: dailySongs.length ? dailySongs : newSongs.slice(0, 20),
    playlists,
    podcasts: [],
    radarSongs,
    newSongs,
    heartSongs: favoriteSongs.length ? favoriteSongs.slice(0, 30) : radarSongs,
    similarSongs: newSongs,
    recommendationSongs: shuffledSample(mergeDiscoverLists([dailySongs, favoriteSongs, newSongs, radarSongs], 40), 5),
    mode: 'member',
    updatedAt: Date.now(),
  };
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function openMeteoWeatherLabel(code) {
  code = Number(code);
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '少云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code === 51 || code === 53 || code === 55) return '毛毛雨';
  if (code === 56 || code === 57) return '冻雨';
  if (code === 61 || code === 63 || code === 65) return '雨';
  if (code === 66 || code === 67) return '冻雨';
  if (code === 71 || code === 73 || code === 75 || code === 77) return '雪';
  if (code === 80 || code === 81 || code === 82) return '阵雨';
  if (code === 85 || code === 86) return '阵雪';
  if (code === 95 || code === 96 || code === 99) return '雷雨';
  return '天气';
}

function buildWeatherMood(weather, date) {
  const now = date || new Date();
  const hour = now.getHours();
  const code = Number(weather && weather.weatherCode);
  const temp = Number(weather && weather.temperature);
  const apparent = Number(weather && weather.apparentTemperature);
  const rain = Number(weather && weather.precipitation) || 0;
  const humidity = Number(weather && weather.humidity) || 0;
  const wind = Number(weather && weather.windSpeed) || 0;
  const isNight = weather && weather.isDay === 0 || hour < 6 || hour >= 20;
  const isMorning = hour >= 5 && hour < 11;
  const isDusk = hour >= 17 && hour < 20;
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code);
  const isCloud = [2, 3, 45, 48].includes(code);
  const isStorm = [95, 96, 99].includes(code);
  const feels = Number.isFinite(apparent) ? apparent : temp;

  let mood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  };
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    };
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    };
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    };
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.30,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    };
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.40,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    };
  }

  if (isNight) {
    mood.key += '-night';
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听');
    mood.tagline = '音量放低一点，让夜色参与编曲';
    mood.energy = Math.min(mood.energy, 0.42);
    mood.focus = Math.max(mood.focus, 0.68);
    mood.melancholy = Math.max(mood.melancholy, 0.52);
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3));
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台';
    mood.energy = Math.max(mood.energy, 0.52);
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3));
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台';
    mood.melancholy = Math.max(mood.melancholy, 0.48);
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3));
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56);
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4));
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7);
  return mood;
}

function compactChinaLocationName(name) {
  return String(name || '').trim()
    .replace(/\s+/g, '')
    .replace(/特别行政区$/g, '')
    .replace(/维吾尔自治区$/g, '')
    .replace(/壮族自治区$/g, '')
    .replace(/回族自治区$/g, '')
    .replace(/自治区$/g, '')
    .replace(/自治州$/g, '')
    .replace(/地区$/g, '')
    .replace(/市辖区$/g, '')
    .replace(/[省市区县旗]$/g, '');
}

function chinaLocationLooseMatch(a, b) {
  const left = compactChinaLocationName(a);
  const right = compactChinaLocationName(b);
  return !!left && !!right && (left === right || left.includes(right) || right.includes(left));
}

function scoreOpenMeteoLocation(item, hints, query) {
  hints = hints || {};
  const country = String(item && (item.country || item.country_code) || '');
  const admin1 = String(item && item.admin1 || '');
  const admin2 = String(item && item.admin2 || '');
  const admin3 = String(item && item.admin3 || '');
  const name = String(item && item.name || '');
  let score = 0;
  if (country === 'CN' || country === '中国' || /China/i.test(country)) score += 30;
  else score -= 30;
  if (chinaLocationLooseMatch(name, query)) score += 8;
  if (hints.regionProvince && chinaLocationLooseMatch(admin1, hints.regionProvince)) score += 14;
  if (hints.regionCity && (chinaLocationLooseMatch(admin2, hints.regionCity) || chinaLocationLooseMatch(name, hints.regionCity))) score += 14;
  if (hints.regionDistrict && (chinaLocationLooseMatch(name, hints.regionDistrict) || chinaLocationLooseMatch(admin2, hints.regionDistrict) || chinaLocationLooseMatch(admin3, hints.regionDistrict))) score += 10;
  return score;
}

function uniqueWeatherLocationQueries(query, hints) {
  hints = hints || {};
  const values = [
    query,
    compactChinaLocationName(query),
    hints.regionDistrict,
    compactChinaLocationName(hints.regionDistrict),
    hints.regionCity,
    compactChinaLocationName(hints.regionCity),
    hints.regionProvince,
    compactChinaLocationName(hints.regionProvince),
  ];
  const seen = new Set();
  return values.map(value => String(value || '').trim()).filter(value => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function isCurrentWeatherLocationLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  return !raw || raw === '当前位置' || raw === '定位中' || raw === 'current location';
}

async function resolveCurrentWeatherLocation() {
  const loc = await fetchIpWeatherLocation();
  return {
    name: loc.city || loc.region || '当前位置',
    country: loc.country || '',
    admin1: loc.region || '',
    latitude: loc.latitude,
    longitude: loc.longitude,
    timezone: loc.timezone || 'auto',
  };
}

async function resolveOpenMeteoLocation(query, hints) {
  hints = hints || {};
  const raw = String(query || hints.regionCity || hints.regionProvince || '').trim();
  if (!raw) return WEATHER_DEFAULT_LOCATION;
  let best = null;
  for (const q of uniqueWeatherLocationQueries(raw, hints)) {
    const u = new URL(OPEN_METEO_GEOCODE_URL);
    u.searchParams.set('name', q);
    u.searchParams.set('count', '20');
    u.searchParams.set('language', 'zh');
    u.searchParams.set('format', 'json');
    const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
    const results = body && Array.isArray(body.results) ? body.results : [];
    for (const item of results) {
      const score = scoreOpenMeteoLocation(item, hints, q);
      if (!best || score > best.score) best = { item, score, query: q };
    }
  }
  const first = best && best.item;
  if (!first) return { ...WEATHER_DEFAULT_LOCATION, query: raw, fallback: true };
  return {
    name: hints.regionLabel || first.name || raw,
    country: first.country || '',
    admin1: first.admin1 || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto',
  };
}

async function fetchOpenMeteoWeather(params) {
  params = params || {};
  let location;
  const lat = clampNumber(params.lat, -90, 90, NaN);
  const lon = clampNumber(params.lon, -180, 180, NaN);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    location = {
      name: String(params.city || params.name || '当前位置').trim() || '当前位置',
      country: '',
      latitude: lat,
      longitude: lon,
      timezone: params.timezone || 'auto',
    };
  } else {
    const query = params.city || params.q || params.location;
    if (isCurrentWeatherLocationLabel(query)) {
      location = await resolveCurrentWeatherLocation();
    } else {
      location = await resolveOpenMeteoLocation(query, {
        regionProvince: params.regionProvince,
        regionCity: params.regionCity,
        regionDistrict: params.regionDistrict,
        regionLabel: params.regionLabel,
      });
    }
  }
  const u = new URL(OPEN_METEO_FORECAST_URL);
  u.searchParams.set('latitude', String(location.latitude));
  u.searchParams.set('longitude', String(location.longitude));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m');
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', location.timezone || 'auto');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const cur = body && body.current || {};
  const weather = {
    provider: 'open-meteo',
    location: {
      name: location.name,
      country: location.country || '',
      admin1: location.admin1 || '',
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: body.timezone || location.timezone || '',
      fallback: !!location.fallback,
    },
    label: openMeteoWeatherLabel(cur.weather_code),
    weatherCode: Number(cur.weather_code),
    temperature: Number(cur.temperature_2m),
    apparentTemperature: Number(cur.apparent_temperature),
    humidity: Number(cur.relative_humidity_2m),
    precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
    cloudCover: Number(cur.cloud_cover),
    windSpeed: Number(cur.wind_speed_10m),
    windGusts: Number(cur.wind_gusts_10m),
    isDay: Number(cur.is_day),
    time: cur.time || '',
    updatedAt: Date.now(),
  };
  weather.mood = buildWeatherMood(weather);
  return weather;
}

async function fetchIpWeatherLocation() {
  const u = new URL(WEATHER_IP_LOCATION_URL);
  u.searchParams.set('fields', 'status,message,country,regionName,city,lat,lon,timezone,query');
  u.searchParams.set('lang', 'zh-CN');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  if (!body || body.status !== 'success' || !Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lon))) {
    const err = new Error(body && body.message || 'IP_LOCATION_FAILED');
    err.body = body;
    throw err;
  }
  return {
    provider: 'ip-api',
    city: body.city || WEATHER_DEFAULT_LOCATION.name,
    region: body.regionName || '',
    country: body.country || '',
    latitude: Number(body.lat),
    longitude: Number(body.lon),
    timezone: body.timezone || 'auto',
    ip: body.query || '',
  };
}

function compactWeatherCityName(name) {
  return String(name || '').trim()
    .replace(/\s+/g, '')
    .replace(/市辖区$/g, '')
    .replace(/特别行政区$/g, '')
    .replace(/[市区县旗]$/g, '');
}

async function reverseWeatherLocation(lat, lon) {
  const latitude = clampNumber(lat, -90, 90, NaN);
  const longitude = clampNumber(lon, -180, 180, NaN);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const err = new Error('INVALID_COORDINATES');
    err.statusCode = 400;
    throw err;
  }
  const fallback = {
    provider: 'coordinate',
    city: '当前位置',
    region: '',
    country: '',
    latitude,
    longitude,
    timezone: 'auto',
    fallback: true,
  };
  const u = new URL(WEATHER_REVERSE_LOCATION_URL);
  u.searchParams.set('latitude', String(latitude));
  u.searchParams.set('longitude', String(longitude));
  u.searchParams.set('localityLanguage', 'zh');
  let body = null;
  try {
    body = await requestJson(u.toString(), {
      headers: { 'User-Agent': UA },
      rejectUnauthorized: false,
    });
  } catch (e) {
    return fallback;
  }
  const city = compactWeatherCityName(body && (body.city || body.locality || body.principalSubdivision));
  const region = compactWeatherCityName(body && body.principalSubdivision);
  return {
    provider: 'bigdatacloud',
    city: city || region || '当前位置',
    region: region || '',
    country: body && (body.countryName || body.countryCode) || '',
    latitude,
    longitude,
    timezone: 'auto',
  };
}

function weatherRadioSeedQueries(mood) {
  const key = String(mood && mood.key || '');
  if (key.includes('rain') || key.includes('storm')) return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁'];
  if (key.includes('snow') || key.includes('cloudy')) return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文'];
  if (key.includes('humid')) return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise'];
  if (key.includes('night')) return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"];
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲'];
}

function fallbackWeatherForRadio(params, err) {
  params = params || {};
  const name = String(params.regionLabel || params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() || WEATHER_DEFAULT_LOCATION.name;
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    isDay: null,
    time: '',
    updatedAt: Date.now(),
    error: err && err.message || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  };
}

function uniqueSongsByKey(songs) {
  const seen = new Set();
  const out = [];
  (songs || []).forEach(song => {
    const key = String(song && (song.id || song.name + '|' + song.artist) || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function tagWeatherPoolSongs(songs, source) {
  return (songs || []).map(song => ({ ...song, weatherSource: source }));
}

async function fetchWeatherPlaylistSongs(playlist, limit) {
  const id = playlist && playlist.id;
  if (!id) return [];
  let rawTracks = [];
  try {
    if (typeof playlist_track_all === 'function') {
      const all = await playlist_track_all({ id, limit: limit || 36, offset: 0, cookie: userCookie, timestamp: Date.now() });
      rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
    }
  } catch (e) {
    console.warn('[WeatherRadio] playlist_track_all failed:', playlist && playlist.name, e.message);
  }
  if (!rawTracks.length && typeof playlist_detail === 'function') {
    try {
      const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
      const pl = (detail.body && detail.body.playlist) || {};
      rawTracks = pl.tracks || [];
    } catch (e) {
      console.warn('[WeatherRadio] playlist_detail failed:', playlist && playlist.name, e.message);
    }
  }
  return rawTracks.map(mapSongRecord).filter(song => song.id && song.name).slice(0, limit || 36);
}

async function filterLikelyPlayableWeatherSongs(songs) {
  const source = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .slice(0, 24);
  const playable = [];
  const fallback = source.slice(0, 24);
  for (let i = 0; i < source.length; i += 4) {
    const chunk = source.slice(i, i + 4);
    const settled = await Promise.allSettled(chunk.map(async song => {
      const info = await handleSongUrl(song.id, { loggedIn: !!userCookie }, 'standard');
      return info && info.url ? song : null;
    }));
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) playable.push(result.value);
      else if (result.status === 'rejected') console.warn('[WeatherRadio] playable probe failed:', chunk[idx] && chunk[idx].name, result.reason && result.reason.message);
    });
    if (playable.length >= 12) break;
  }
  return (playable.length ? playable : fallback).slice(0, 24);
}

function isLowSignalWeatherSong(song) {
  const text = String([
    song && song.name,
    song && song.artist,
    song && song.album,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (!text) return true;
  if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声)|$|[\s\-_/）)])/i.test(text)) return true;
  if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|demo|beat\s*maker/i.test(text)) return true;
  if (/翻自|翻唱|cover|remix|伴奏|纯音乐|钢琴|dj|live\s*版|live版|唯美钢琴|karaoke|instrumental/i.test(text)) return true;
  if (/白噪音|雨声|睡眠|助眠|冥想|疗愈频率|环境音|自然声音|asmr/i.test(text)) return true;
  if (/[（(](r&b|lofi|jazz|dj|edm|trap|remix|伴奏|纯音乐|钢琴|电子|治愈|古风|女声|男声|英文|中文版|抖音|ai)[）)]/i.test(text)) return true;
  if (/^(纯音乐|轻音乐|治愈系|放松|睡眠|雨天|阴天|夜晚|夏日|海边)$/i.test(String(song.name || '').trim())) return true;
  return false;
}

function scoreWeatherSong(song, mood) {
  const text = String((song && song.name || '') + ' ' + (song && song.artist || '') + ' ' + (song && song.album || '')).toLowerCase();
  let score = 0;
  if (song && song.cover) score += 4;
  if (song && song.duration) score += 2;
  if (song && song.weatherSource === 'daily') score += 6;
  if (song && song.weatherSource === 'private') score += 4;
  if (/周杰伦|陈奕迅|孙燕姿|五月天|王菲|陶喆|方大同|林宥嘉|蔡健雅|莫文蔚|李健|毛不易|告五人|落日飞车|陈绮贞|朴树/.test(text)) score += 10;
  const key = String(mood && mood.key || '');
  if (key.includes('rain') && /雨|阴|夜|慢|r&b|soul|陈奕迅|林宥嘉|孙燕姿/.test(text)) score += 5;
  if (key.includes('humid') && /夏|海|city|pop|落日|告五人|方大同|陶喆/.test(text)) score += 5;
  if (key.includes('night') && /夜|moon|jazz|soul|r&b|方大同|陶喆|王菲/.test(text)) score += 5;
  if (key.includes('cloudy') && /阴|民谣|indie|陈绮贞|朴树|李健/.test(text)) score += 5;
  return score;
}

function weatherArtistKey(song) {
  const raw = String(song && song.artist || song && song.name || '').split(/\s*\/\s*|、|,|&/)[0] || '';
  return raw.trim().toLowerCase() || 'unknown';
}

function weatherTitleKey(song) {
  return String(song && song.name || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '')
    .trim();
}

function uniqueWeatherTitles(sorted) {
  const seen = new Set();
  const out = [];
  (sorted || []).forEach(song => {
    const key = weatherTitleKey(song);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(song);
  });
  return out;
}

function diversifyWeatherSongs(sorted, artistLimit) {
  const primary = [];
  const deferred = [];
  const counts = new Map();
  (sorted || []).forEach(song => {
    const key = weatherArtistKey(song);
    const count = counts.get(key) || 0;
    if (count < artistLimit) {
      primary.push(song);
      counts.set(key, count + 1);
    } else {
      deferred.push(song);
    }
  });
  return primary.length >= 8 ? primary : primary.concat(deferred.slice(0, 8 - primary.length));
}

function orderWeatherSongs(songs, mood) {
  const sorted = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .sort((a, b) => scoreWeatherSong(b, mood) - scoreWeatherSong(a, mood));
  return diversifyWeatherSongs(uniqueWeatherTitles(sorted), 2);
}

async function buildWeatherRadio(params) {
  let weather;
  try {
    weather = await fetchOpenMeteoWeather(params);
  } catch (e) {
    console.warn('[WeatherRadio] weather provider failed, using fallback radio:', e.message);
    weather = fallbackWeatherForRadio(params, e);
  }
  const queries = weatherRadioSeedQueries(weather.mood);
  let songs = [];
  const settled = await Promise.allSettled(queries.slice(0, 4).map(q => handleSearch(q, 6)));
  settled.forEach(result => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
  });
  if (songs.length < 10 && weather.mood && Array.isArray(weather.mood.keywords)) {
    const more = await Promise.allSettled(weather.mood.keywords.slice(0, 2).map(q => handleSearch(q, 6)));
    more.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
    });
  }
  songs = orderWeatherSongs(songs, weather.mood);
  return {
    ok: true,
    weather,
    radio: {
      title: weather.mood.title,
      subtitle: weather.mood.tagline,
      seedQueries: queries.slice(0, 4),
      songs: songs.slice(0, 18),
      updatedAt: Date.now(),
    },
  };
}

function parseJSONText(text) {
  const raw = String(text || '').trim();
  const json = raw.replace(/^callback\(([\s\S]*)\);?$/, '$1');
  return JSON.parse(json);
}

async function qqMusicRequest(payload, opts) {
  opts = opts || {};
  const body = JSON.stringify(payload);
  const headers = {
    ...QQ_HEADERS,
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (opts.cookie && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(QQ_MUSICU_URL, {
    method: 'POST',
    headers,
  }, body);
  return parseJSONText(text);
}

function normalizeQQProfile(body, cookieObj) {
  cookieObj = cookieObj || qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const vipInfo = data.vipInfo || data.vipinfo || data.vip || data.vip_info || creator.vipInfo || creator.vipinfo || creator.vip_info || {};
  const profileNick = creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '';
  const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
  const cookieNick = qqCookieNickname(cookieObj, uin);
  const nick = profileNick || cookieNick || '';
  const avatar = profileAvatar || qqCookieAvatar(cookieObj, uin);
  const objects = [cookieObj, data, creator, vipInfo];
  let vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipLevel', 'music_vip_level',
    'greenVipLevel', 'green_vip_level', 'green_vip_level',
    'luxuryVipLevel', 'luxury_vip_level', 'superVipLevel', 'super_vip_level',
    'svipType', 'svip_type', 'memberType', 'member_type', 'membershipType', 'membership_type',
  ]);
  const text = collectVipStringValues({ cookieObj, data, creator, vipInfo }, [], 0).join(' ').toLowerCase();
  const svipFlag = objects.some(obj => obj && (
    obj.isSvip === true || obj.is_svip === true || obj.svip === true ||
    Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || obj.luxury_vip_level || 0) > 0
  )) || /svip|supervip|super_vip|luxury|豪华绿钻|超级会员/.test(text);
  const vipFlag = objects.some(obj => obj && (
    obj.isVip === true || obj.is_vip === true || obj.vip === true ||
    Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || obj.green_vip_level || obj.music_vip_level || 0) > 0
  )) || /vip|绿钻|会员/.test(text);
  const isSvip = svipFlag || vipType >= 10;
  const isVip = isSvip || vipFlag || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieObj)),
    preview: false,
    userId: uin,
    nickname: nick || (uin ? ('QQ ' + uin) : 'QQ 音乐'),
    avatar,
    vipType: isSvip ? Math.max(10, vipType) : (isVip ? Math.max(1, vipType) : 0),
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无VIP'),
    hasCookie: !!qqCookie,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieObj),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
  };
}

async function getQQLoginInfo(opts) {
  opts = opts || {};
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const musicKey = qqCookieMusicKey(cookieObj);
  if (!uin || !musicKey) return { provider: 'qq', loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', hasCookie: !!qqCookie };
  const fallback = normalizeQQProfile(null, cookieObj);
  if (opts.quick) return { ...fallback, quick: true, profileUnavailable: true };
  try {
    const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
    u.searchParams.set('cid', '205360838');
    u.searchParams.set('userid', uin);
    u.searchParams.set('reqfrom', '1');
    u.searchParams.set('g_tk', '5381');
    u.searchParams.set('loginUin', uin);
    u.searchParams.set('hostUin', '0');
    u.searchParams.set('format', 'json');
    u.searchParams.set('inCharset', 'utf8');
    u.searchParams.set('outCharset', 'utf-8');
    u.searchParams.set('notice', '0');
    u.searchParams.set('platform', 'yqq.json');
    u.searchParams.set('needNewCode', '0');
    const text = await requestText(u.toString(), {
      headers: { ...QQ_HEADERS, Cookie: qqCookie },
    });
    const body = parseJSONText(text);
    const info = normalizeQQProfile(body, cookieObj);
    if (body && (body.code === 1000 || body.result === 301)) {
      return { ...fallback, profileUnavailable: true };
    }
    return info;
  } catch (e) {
    console.warn('[QQLogin] profile check failed:', e.message);
    return { ...fallback, profileUnavailable: true };
  }
}

async function qqGetJSON(targetUrl, params, opts) {
  opts = opts || {};
  const u = new URL(targetUrl);
  Object.keys(params || {}).forEach(k => {
    if (params[k] != null) u.searchParams.set(k, String(params[k]));
  });
  const headers = { ...QQ_HEADERS, ...(opts.headers || {}) };
  if (opts.cookie !== false && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(u.toString(), { headers });
  return parseJSONText(text);
}

function audioProxyHeadersFor(audioUrl, range) {
  let headers = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host.includes('qq.com') || host.includes('qpic.cn')) headers.Referer = 'https://y.qq.com/';
    if (host.includes('douyinvod.com') || host.includes('bytevod.com') || host.includes('qishui.com') || host.includes('bdcgslb.com')) {
      headers = sodaAudioRequestHeadersFor(audioUrl, range, { includeCookie: false });
      return headers;
    }
  } catch (e) {}
  if (range) headers.Range = range;
  return headers;
}

function audioContentTypeForUrl(audioUrl, upstreamType) {
  let pathname = '';
  try { pathname = new URL(audioUrl).pathname.toLowerCase(); } catch (e) {}
  if (/\.flac$/.test(pathname)) return 'audio/flac';
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg';
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4';
  if (/\.ogg$/.test(pathname)) return 'audio/ogg';
  if (/\.wav$/.test(pathname)) return 'audio/wav';
  return upstreamType || 'audio/mpeg';
}

function mapQQPlaylist(pl, kind) {
  pl = pl || {};
  const tid = pl.tid || pl.dirid || pl.dir_id || '';
  const id = pl.dissid || tid || pl.id || pl.diss_id;
  const dissid = pl.dissid || pl.diss_id || pl.disstid || pl.id || '';
  const dirid = pl.dirid || pl.dir_id || tid || '';
  const creator = pl.creator || {};
  const name = pl.diss_name || pl.dissname || pl.name || pl.title || '';
  const favorite = isQQFavoritePlaylist({ ...pl, name, dirid, dissid });
  const readOnly = !favorite && isProviderReadonlyPlaylistName(name);
  return {
    provider: 'qq',
    source: 'qq',
    id: id ? String(id) : '',
    dissid: dissid ? String(dissid) : '',
    dirid: dirid ? String(dirid) : '',
    tid: tid ? String(tid) : '',
    writeId: (dirid || id) ? String(dirid || id) : '',
    name,
    cover: pl.diss_cover || pl.imgurl || pl.logo || pl.picurl || pl.cover || '',
    trackCount: pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count || pl.song_count_all || 0,
    playCount: pl.listen_num || pl.listennum || pl.visitnum || pl.play_count || 0,
    creator: pl.hostname || pl.nick || creator.name || creator.nick || pl.creator || 'QQ 音乐',
    subscribed: kind === 'collect',
    favorite,
    readOnly,
    writable: kind !== 'collect' && !readOnly,
    specialType: favorite ? 5 : 0,
  };
}

function mapQQPlaylistTrack(raw) {
  raw = raw || {};
  const track = raw.songid || raw.songmid || raw.mid || raw.name || raw.songname || raw.title
    ? raw
    : (raw.track_info || raw.songInfo || raw.songinfo || raw.song || raw.data || raw.musicData || raw.track || {});
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || track.singers || []);
  const mid = track.mid || track.songmid || track.songMid || raw.mid || raw.songmid || raw.songMid || '';
  const albumMid = album.mid || album.pmid || track.albummid || track.albumMid || raw.albummid || raw.albumMid || '';
  const singerName = track.singerName || track.singername || raw.singerName || raw.singername || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid || String(track.id || track.songid || raw.id || raw.songid || ''),
    qqId: track.id || track.songid || track.songId || raw.id || raw.songid || raw.songId || '',
    songType: qqSongActionType({ songType: track.songType ?? track.songtype ?? track.type ?? raw.songType ?? raw.songtype ?? raw.type }),
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || raw.strMediaMid || '',
    name: track.name || track.songname || track.title || raw.songname || raw.title || '',
    artist: artists.map(a => a.name).join(' / ') || singerName || '',
    artists: artists.length ? artists : (singerName ? [{ name: singerName, mid: track.singerMid || raw.singerMid || '' }] : []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid || track.singerMid || raw.singerMid || '',
    album: album.name || album.title || track.albumname || raw.albumname || '',
    albumMid,
    cover: track.cover || raw.cover || qqAlbumCover(albumMid, 300),
    duration: (Number(track.interval || raw.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play || track.pay.payplay) ? 1 : 0,
    playable: false,
  };
}

async function handleQQUserPlaylists() {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] };
  const uin = info.userId;
  const created = [];
  const collected = [];
  const createdPageSize = 100;
  const collectedPageSize = 100;
  try {
    for (let sin = 0; sin < 5000; sin += createdPageSize) {
      const raw = await qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
        hostUin: 0,
        hostuin: uin,
        sin,
        size: createdPageSize,
        g_tk: 5381,
        loginUin: uin,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 0,
      }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
      const page = raw && raw.data && Array.isArray(raw.data.disslist) ? raw.data.disslist : [];
      created.push(...page.map(pl => mapQQPlaylist(pl, 'created')));
      if (page.length < createdPageSize) break;
    }
  } catch (err) {
    console.warn('[QQUserPlaylists] created pages failed:', err.message);
  }
  try {
    for (let sin = 0; sin < 5000; sin += collectedPageSize) {
      const raw = await qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
        ct: 20,
        cid: 205360956,
        userid: uin,
        reqtype: 3,
        sin,
        ein: sin + collectedPageSize - 1,
      }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
      const page = raw && raw.data && Array.isArray(raw.data.cdlist) ? raw.data.cdlist : [];
      collected.push(...page.map(pl => mapQQPlaylist(pl, 'collect')));
      if (page.length < collectedPageSize) break;
    }
  } catch (err) {
    console.warn('[QQUserPlaylists] collected pages failed:', err.message);
  }
  const seen = new Set();
  const playlists = created.concat(collected).filter(pl => {
    if (!pl.id || !pl.name || seen.has(pl.id)) return false;
    if (isQzoneBackgroundPlaylist(pl)) return false;
    seen.add(pl.id);
    return true;
  }).sort((a, b) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)));
  return { loggedIn: true, provider: 'qq', userId: uin, playlists };
}

async function handleQQPlaylistTracks(id) {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] };
  const result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    utf8: 1,
    disstid: pid,
    song_begin: 0,
    song_num: 100000,
    loginUin: info.userId,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } });
  const detail = result && result.cdlist && result.cdlist[0] ? result.cdlist[0] : {};
  const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter(s => s.name && (s.mid || s.id));
  const playlist = {
    provider: 'qq',
    id: pid,
    name: detail.dissname || detail.diss_name || detail.name || '',
    cover: detail.logo || detail.diss_cover || '',
    trackCount: tracks.length,
  };
  return { loggedIn: true, provider: 'qq', playlist, tracks };
}

function providerActionError(errorCode, message, statusCode) {
  const err = new Error(message || errorCode || 'PROVIDER_ACTION_FAILED');
  err.errorCode = errorCode || 'PROVIDER_ACTION_FAILED';
  err.statusCode = statusCode || 500;
  return err;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requireQQLoginInfoForWrite() {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) {
    throw providerActionError('QQ_LOGIN_REQUIRED', '请先登录 QQ 音乐后再同步', 401);
  }
  return info;
}

function qqSongActionIdentity(input) {
  input = input || {};
  const rawMid = String(input.mid || input.songmid || input.songMid || '').trim();
  const rawId = String(input.qqId || input.songId || input.songid || input.id || '').trim();
  const idLooksMid = rawId && !/^\d+$/.test(rawId);
  const mid = rawMid || (idLooksMid ? rawId : '');
  const qqId = /^\d+$/.test(rawId) ? rawId : '';
  return { id: mid || qqId, mid, songmid: mid, qqId, songType: qqSongActionType(input) };
}

function qqSongActionType(input) {
  input = input || {};
  const keys = ['songType', 'songtype', 'qqSongType', 'qqType'];
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    const text = String(value).trim();
    if (!/^-?\d+$/.test(text)) continue;
    const type = Number(text);
    if (Number.isFinite(type) && type >= 0) return type;
  }
  const rawType = input.type;
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== '' && /^-?\d+$/.test(String(rawType).trim())) {
    const type = Number(rawType);
    if (Number.isFinite(type) && type >= 0) return type;
  }
  return 0;
}

function qqSongMatchesIdentity(song, identity) {
  song = song || {};
  identity = identity || {};
  const mid = String(song.mid || song.songmid || song.songMid || song.id || '').trim();
  const numericId = String(song.qqId || song.songId || song.songid || '').trim();
  return !!(
    (identity.mid && mid && identity.mid === mid) ||
    (identity.qqId && numericId && identity.qqId === numericId) ||
    (identity.id && (identity.id === mid || identity.id === numericId))
  );
}

function qqWriteCommonParams(info) {
  return {
    g_tk: qqCSRFToken(true) || 5381,
    loginUin: info.userId,
    hostUin: 0,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  };
}

function qqWriteOk(body) {
  body = body && (body.body || body);
  const data = body && (body.data || body.Data) || {};
  const raw = body && (body.code ?? body.retcode ?? body.ret ?? body.result ?? data.code ?? data.retcode);
  if (raw === undefined || raw === null || raw === '') return !(body && (body.error || body.message || body.msg));
  const code = Number(raw);
  return code === 0 || code === 200;
}

function qqWriteMessage(body, fallback) {
  body = body && (body.body || body);
  const data = body && (body.data || body.Data) || {};
  return (body && (body.message || body.msg || body.error)) || data.msg || data.message || fallback || '';
}

function qqWriteAttemptMessage(attempts, fallback) {
  const messages = (attempts || []).map(item => String(item && item.message || '').trim()).filter(Boolean);
  if (!messages.length) return fallback || '';
  const useful = messages.filter(msg => !/^HTTP 404\b/i.test(msg));
  return useful.pop() || messages.pop() || fallback || '';
}

function providerAttemptErrorMessage(err, fallback) {
  return err && (err.errorCode || err.message) || fallback || '';
}

function qqWriteDirId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (Number.isSafeInteger(num)) return num;
  }
  return text;
}

function qqWriteSongTypeAttempts(input) {
  const primary = qqSongActionType(input);
  const out = [];
  [primary, 0, 13].forEach(value => {
    const type = Number(value);
    if (Number.isFinite(type) && type >= 0 && !out.includes(type)) out.push(type);
  });
  return out;
}

async function qqWriteSongInfo(identity, songType) {
  identity = identity || {};
  let songId = String(identity.qqId || '').trim();
  let resolvedType = Number.isFinite(Number(songType)) ? Number(songType) : qqSongActionType(identity);
  if ((!songId || !Number.isFinite(Number(resolvedType))) && identity.mid) {
    try {
      const detail = await qqSongRawDetail(identity.mid);
      if (detail) {
        if (!songId && detail.id != null) songId = String(detail.id);
        if (!Number.isFinite(Number(resolvedType)) && detail.type != null) resolvedType = Number(detail.type);
      }
    } catch (err) {
      console.warn('[QQPlaylistDetailWrite] song detail resolve failed:', err.message);
    }
  }
  if (!songId || !/^\d+$/.test(songId)) {
    throw providerActionError('QQ_MISSING_NUMERIC_SONG_ID', 'Missing QQ numeric song id', 400);
  }
  if (!Number.isFinite(Number(resolvedType)) || Number(resolvedType) < 0) resolvedType = 0;
  return { songId: Number(songId), songType: Number(resolvedType) };
}

async function qqPlaylistDetailWriteSong(dirId, identity, op, songType) {
  const info = await qqWriteSongInfo(identity, songType);
  const payload = {
    comm: qqMusicComm(true),
    req_0: {
      module: 'music.musicasset.PlaylistDetailWrite',
      method: op === 'del' ? 'DelSonglist' : 'AddSonglist',
      param: {
        dirId: qqWriteDirId(dirId),
        v_songInfo: [{ songType: info.songType, songId: info.songId }],
      },
    },
  };
  const json = await qqMusicRequest(payload, { cookie: true });
  return json && (json.req_0 || json.req0) || json;
}

async function resolveQQPlaylistWriteId(pid, explicitWriteId) {
  const direct = String(explicitWriteId || '').trim();
  if (direct) return direct;
  const target = String(pid || '').trim();
  if (!target) return '';
  try {
    const listResult = await handleQQUserPlaylists();
    const playlists = listResult.playlists || [];
    const hit = playlists.find(pl => {
      return String(pl.id || '') === target ||
        String(pl.dissid || '') === target ||
        String(pl.dirid || '') === target ||
        String(pl.tid || '') === target ||
        String(pl.writeId || '') === target;
    });
    if (hit && hit.writeId) return String(hit.writeId);
    if (hit && hit.dirid) return String(hit.dirid);
  } catch (err) {
    console.warn('[QQPlaylistWrite] resolve dirid failed:', err.message);
  }
  return target;
}

function pushQQWriteIdCandidate(candidates, value) {
  const text = String(value || '').trim();
  if (!text || candidates.includes(text)) return;
  candidates.push(text);
}

function qqPlaylistWriteIdCandidates(playlistId, explicitWriteId, targetPlaylist, resolvedWriteId) {
  const candidates = [];
  pushQQWriteIdCandidate(candidates, explicitWriteId);
  if (targetPlaylist) {
    pushQQWriteIdCandidate(candidates, targetPlaylist.dirid);
    pushQQWriteIdCandidate(candidates, targetPlaylist.tid);
    pushQQWriteIdCandidate(candidates, targetPlaylist.writeId);
  }
  pushQQWriteIdCandidate(candidates, resolvedWriteId);
  if (targetPlaylist) {
    pushQQWriteIdCandidate(candidates, targetPlaylist.id);
    pushQQWriteIdCandidate(candidates, targetPlaylist.dissid);
  }
  pushQQWriteIdCandidate(candidates, playlistId);
  return candidates;
}

async function handleQQPlaylistWriteSong(pid, input, op) {
  const info = await requireQQLoginInfoForWrite();
  const playlistId = String(pid || '').trim();
  const identity = qqSongActionIdentity(input);
  if (!playlistId || !identity.id) {
    return { provider: 'qq', loggedIn: true, success: false, error: 'Missing playlist id or song id', attempts: [] };
  }
  const attempts = [];
  let targetPlaylist = null;
  try {
    const listResult = await handleQQUserPlaylists();
    targetPlaylist = (listResult.playlists || []).find(pl => {
      return String(pl.id || '') === playlistId ||
        String(pl.dissid || '') === playlistId ||
        String(pl.dirid || '') === playlistId ||
        String(pl.tid || '') === playlistId ||
        String(pl.writeId || '') === playlistId;
    }) || null;
  } catch (err) {
    console.warn('[QQPlaylistWrite] playlist lookup failed:', err.message);
  }
  if (targetPlaylist && isQQFavoritePlaylist(targetPlaylist)) {
    const songTypes = qqWriteSongTypeAttempts(input || identity);
    for (const songType of songTypes) {
      try {
        const body = await qqPlaylistDetailWriteSong(201, identity, op, songType);
        const ok = qqRpcBlockOk(body);
        attempts.push({ api: op === 'del' ? 'PlaylistDetailWrite_DelSonglist_201' : 'PlaylistDetailWrite_AddSonglist_201', ok, code: qqRpcBlockCode(body), songType, message: qqRpcBlockMessage(body), body });
        if (ok) {
          if (op === 'add') {
            const verified = await confirmQQPlaylistContainsSong(targetPlaylist.id || playlistId, identity);
            if (!verified) {
              return { provider: 'qq', loggedIn: true, success: true, pid: playlistId, id: identity.id, verified: false, pendingVerify: true, liked: true, favoriteFallback: true, body, attempts };
            }
          }
          return { provider: 'qq', loggedIn: true, success: true, verified: op === 'add', pid: playlistId, id: identity.id, liked: op !== 'del', favoriteFallback: true, body, attempts };
        }
      } catch (err) {
        attempts.push({ api: op === 'del' ? 'PlaylistDetailWrite_DelSonglist_201' : 'PlaylistDetailWrite_AddSonglist_201', ok: false, songType, message: providerAttemptErrorMessage(err) });
      }
    }
    try {
      const body = await qqFavoriteSongWrite(identity, op !== 'del', info);
      const ok = qqWriteOk(body);
      attempts.push({ api: op === 'del' ? 'fcg_del_song_from_fav' : 'fcg_add_song2fav', ok, code: normalizeApiCode(body), message: qqWriteMessage(body), body });
      if (ok) {
        if (op === 'add') {
          const verified = await confirmQQPlaylistContainsSong(targetPlaylist.id || playlistId, identity);
          if (!verified) {
            return { provider: 'qq', loggedIn: true, success: true, pid: playlistId, id: identity.id, verified: false, pendingVerify: true, liked: true, favoriteFallback: true, body, attempts };
          }
        }
        return { provider: 'qq', loggedIn: true, success: true, verified: op === 'add', pid: playlistId, id: identity.id, liked: op !== 'del', favoriteFallback: true, body, attempts };
      }
    } catch (err) {
      attempts.push({ api: op === 'del' ? 'fcg_del_song_from_fav' : 'fcg_add_song2fav', ok: false, message: err.message });
    }
    return {
      provider: 'qq',
      loggedIn: true,
      success: false,
      pid: playlistId,
      id: identity.id,
      error: qqWriteAttemptMessage(attempts, 'QQ_LIKE_WRITE_FAILED'),
      attempts,
    };
  }
  if (targetPlaylist && targetPlaylist.readOnly) {
    return { provider: 'qq', loggedIn: true, success: false, pid: playlistId, id: identity.id, error: 'QQ_PLAYLIST_READONLY', attempts: [] };
  }
  const explicitWriteId = input && (input.writeId || input.dirid);
  const resolvedWriteId = String(targetPlaylist && (targetPlaylist.dirid || targetPlaylist.tid || targetPlaylist.writeId) || '')
    || await resolveQQPlaylistWriteId(playlistId, explicitWriteId);
  const writeIds = qqPlaylistWriteIdCandidates(playlistId, explicitWriteId, targetPlaylist, resolvedWriteId);
  const songTypes = qqWriteSongTypeAttempts(input || identity);
  for (const writeId of writeIds) {
    for (const songType of songTypes) {
      try {
        const body = await qqPlaylistDetailWriteSong(writeId, identity, op, songType);
        const ok = qqRpcBlockOk(body);
        attempts.push({ api: op === 'del' ? 'PlaylistDetailWrite_DelSonglist' : 'PlaylistDetailWrite_AddSonglist', ok, code: qqRpcBlockCode(body), writeId, songType, message: qqRpcBlockMessage(body), body });
        if (ok) {
          if (op === 'add') {
            const verified = await confirmQQPlaylistContainsSong(playlistId, identity);
            if (!verified) {
              return { provider: 'qq', loggedIn: true, success: true, pid: playlistId, writeId, id: identity.id, verified: false, pendingVerify: true, body, attempts };
            }
          }
          return { provider: 'qq', loggedIn: true, success: true, verified: op === 'add', pid: playlistId, writeId, id: identity.id, body, attempts };
        }
      } catch (err) {
        attempts.push({ api: op === 'del' ? 'PlaylistDetailWrite_DelSonglist' : 'PlaylistDetailWrite_AddSonglist', ok: false, writeId, songType, message: providerAttemptErrorMessage(err) });
      }
    }
  }
  const endpoint = op === 'del'
    ? 'https://c.y.qq.com/qzone/fcg-bin/fcg_music_delbatchsong.fcg'
    : 'https://c.y.qq.com/qzone/fcg-bin/fcg_music_add2songdir.fcg';
  for (const writeId of writeIds) {
    const params = {
      ...qqWriteCommonParams(info),
      uin: info.userId,
      dirid: writeId,
      disstid: playlistId,
      songmid: identity.mid || identity.id,
      songmidlist: identity.mid || identity.id,
      songid: identity.qqId || '',
      songlist: identity.mid || identity.qqId || identity.id,
      typelist: 13,
      formsender: 4,
      source: 153,
      r2: 0,
      r3: 1,
    };
    try {
      const body = await qqGetJSON(endpoint, params, {
        headers: { Referer: 'https://y.qq.com/n/ryqq/profile/like/song' },
      });
      const ok = qqWriteOk(body);
      attempts.push({ api: op === 'del' ? 'fcg_music_delbatchsong' : 'fcg_music_add2songdir', ok, code: normalizeApiCode(body), writeId, message: qqWriteMessage(body), body });
      if (ok) {
        if (op === 'add') {
          const verified = await confirmQQPlaylistContainsSong(playlistId, identity);
          if (!verified) {
            return { provider: 'qq', loggedIn: true, success: true, pid: playlistId, writeId, id: identity.id, verified: false, pendingVerify: true, body, attempts };
          }
        }
        return { provider: 'qq', loggedIn: true, success: true, verified: op === 'add', pid: playlistId, writeId, id: identity.id, body, attempts };
      }
    } catch (err) {
      attempts.push({ api: op === 'del' ? 'fcg_music_delbatchsong' : 'fcg_music_add2songdir', ok: false, writeId, message: err.message });
    }
  }
  return {
    provider: 'qq',
    loggedIn: true,
    success: false,
    pid: playlistId,
    writeId: writeIds[0] || '',
    id: identity.id,
    error: qqWriteAttemptMessage(attempts, 'QQ_PLAYLIST_WRITE_FAILED'),
    attempts,
  };
}

async function qqFavoriteSongWrite(identity, nextLike, info) {
  const endpoint = nextLike
    ? 'https://c.y.qq.com/fav/fcgi-bin/fcg_add_song2fav.fcg'
    : 'https://c.y.qq.com/fav/fcgi-bin/fcg_del_song_from_fav.fcg';
  const params = {
    ...qqWriteCommonParams(info),
    uin: info.userId,
    songid: identity.qqId || '',
    songmid: identity.mid || identity.id,
    songtype: 13,
  };
  const body = await qqGetJSON(endpoint, params, {
    headers: { Referer: 'https://y.qq.com/n/ryqq/profile/like/song' },
  });
  return body;
}

async function qqFavoritePlaylistWithTracks() {
  const listResult = await handleQQUserPlaylists();
  const playlists = listResult.playlists || [];
  const favorite = playlists.find(pl => isQQFavoritePlaylist(pl)) || null;
  if (!favorite || !favorite.id) return { playlist: null, tracks: [] };
  const tracksResult = await handleQQPlaylistTracks(favorite.id);
  return { playlist: favorite, tracks: tracksResult.tracks || [] };
}

async function confirmQQPlaylistContainsSong(pid, identity) {
  const waits = [450, 1100, 2200];
  for (const wait of waits) {
    if (wait) await delay(wait);
    try {
      const detail = await handleQQPlaylistTracks(pid);
      const tracks = detail && detail.tracks || [];
      if (tracks.some(song => qqSongMatchesIdentity(song, identity))) return true;
    } catch (err) {
      console.warn('[QQPlaylistVerify]', pid, err.message);
    }
  }
  return false;
}

async function handleQQSongLikeCheck(ids) {
  await requireQQLoginInfoForWrite();
  const requested = (ids || []).map(id => ({ id: String(id), identity: qqSongActionIdentity({ id }) })).filter(item => item.id);
  if (!requested.length) return { provider: 'qq', loggedIn: true, ids: [], liked: {} };
  let tracks = [];
  try {
    const favorite = await qqFavoritePlaylistWithTracks();
    tracks = favorite.tracks || [];
  } catch (err) {
    console.warn('[QQLikeCheck] favorite playlist read failed:', err.message);
  }
  const liked = {};
  requested.forEach(item => {
    liked[item.id] = tracks.some(song => qqSongMatchesIdentity(song, item.identity));
  });
  return { provider: 'qq', loggedIn: true, ids: requested.map(item => item.id), liked };
}

async function handleQQSongLike(input, like) {
  const info = await requireQQLoginInfoForWrite();
  const identity = qqSongActionIdentity(input);
  if (!identity.id) throw providerActionError('QQ_MISSING_SONG_ID', '缺少 QQ 音乐歌曲 ID', 400);
  const nextLike = like !== false && String(like) !== 'false' && String(like) !== '0';
  const attempts = [];
  try {
    const favorite = await qqFavoritePlaylistWithTracks();
    if (favorite.playlist && favorite.playlist.id) {
      const playlistResult = await handleQQPlaylistWriteSong(favorite.playlist.id, identity, nextLike ? 'add' : 'del');
      attempts.push(...(playlistResult.attempts || []));
      if (playlistResult.success) {
        return { provider: 'qq', loggedIn: true, success: true, id: identity.id, liked: nextLike, attempts };
      }
    }
  } catch (err) {
    attempts.push({ api: 'favorite_playlist', ok: false, message: err.message });
  }
  if (!attempts.some(item => String(item && item.api || '').indexOf('PlaylistDetailWrite') >= 0)) {
    const songTypes = qqWriteSongTypeAttempts(input || identity);
    for (const songType of songTypes) {
      try {
        const body = await qqPlaylistDetailWriteSong(201, identity, nextLike ? 'add' : 'del', songType);
        const ok = qqRpcBlockOk(body);
        attempts.push({ api: nextLike ? 'PlaylistDetailWrite_AddSonglist_201' : 'PlaylistDetailWrite_DelSonglist_201', ok, code: qqRpcBlockCode(body), songType, message: qqRpcBlockMessage(body), body });
        if (ok) {
          if (nextLike) {
            let verified = false;
            try {
              const favorite = await qqFavoritePlaylistWithTracks();
              verified = !!(favorite.playlist && favorite.playlist.id && (favorite.tracks || []).some(song => qqSongMatchesIdentity(song, identity)));
            } catch (verifyErr) {
              attempts.push({ api: 'favorite_verify', ok: false, message: verifyErr.message });
            }
            if (!verified) {
              return { provider: 'qq', loggedIn: true, success: true, id: identity.id, liked: nextLike, verified: false, pendingVerify: true, body, attempts };
            }
          }
          return { provider: 'qq', loggedIn: true, success: true, verified: nextLike, id: identity.id, liked: nextLike, body, attempts };
        }
      } catch (err) {
        attempts.push({ api: nextLike ? 'PlaylistDetailWrite_AddSonglist_201' : 'PlaylistDetailWrite_DelSonglist_201', ok: false, songType, message: providerAttemptErrorMessage(err) });
      }
    }
  }
  try {
    const body = await qqFavoriteSongWrite(identity, nextLike, info);
    const ok = qqWriteOk(body);
    attempts.push({ api: nextLike ? 'fcg_add_song2fav' : 'fcg_del_song_from_fav', ok, code: normalizeApiCode(body), message: qqWriteMessage(body), body });
    if (ok) {
      if (nextLike) {
        let verified = false;
        try {
          const listResult = await handleQQUserPlaylists();
          const favorite = (listResult.playlists || []).find(pl => isQQFavoritePlaylist(pl)) || null;
          verified = !!(favorite && favorite.id && await confirmQQPlaylistContainsSong(favorite.id, identity));
        } catch (verifyErr) {
          attempts.push({ api: 'favorite_verify', ok: false, message: verifyErr.message });
        }
        if (!verified) {
          return { provider: 'qq', loggedIn: true, success: true, id: identity.id, liked: nextLike, verified: false, pendingVerify: true, body, attempts };
        }
      }
      return { provider: 'qq', loggedIn: true, success: true, verified: nextLike, id: identity.id, liked: nextLike, body, attempts };
    }
  } catch (err) {
    attempts.push({ api: nextLike ? 'fcg_add_song2fav' : 'fcg_del_song_from_fav', ok: false, message: err.message });
  }
  return {
    provider: 'qq',
    loggedIn: true,
    success: false,
    id: identity.id,
    liked: !nextLike,
    error: qqWriteAttemptMessage(attempts, 'QQ_LIKE_WRITE_FAILED'),
    attempts,
  };
}

function qqAlbumCover(albumMid, size) {
  if (!albumMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T002R' + px + 'x' + px + 'M000' + albumMid + '.jpg?max_age=2592000';
}

function qqSingerAvatar(singerMid, size) {
  if (!singerMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T001R' + px + 'x' + px + 'M000' + singerMid + '.jpg?max_age=2592000';
}

function mapQQArtists(raw) {
  return (raw || [])
    .map(a => ({
      id: a && a.id,
      mid: a && a.mid,
      name: (a && (a.name || a.title)) || '',
    }))
    .filter(a => a.name);
}

function mapQQSmartSong(item) {
  item = item || {};
  const mid = item.mid || item.songmid || item.id || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    songType: qqSongActionType({ songType: item.songType ?? item.songtype ?? item.type }),
    mid,
    songmid: mid,
    name: item.name || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: '',
    cover: '',
    duration: 0,
    fee: 0,
    playable: false,
  };
}

function decodeQQActionSwitch(track) {
  track = track || {};
  const action = track.action || {};
  const rawSwitch = Number(action.switch || action.switches || track.switch || 0) || 0;
  const bits = rawSwitch ? rawSwitch.toString(2).split('') : [];
  bits.pop();
  bits.reverse();
  const names = ['play_lq', 'play_hq', 'play_sq', 'down_lq', 'down_hq', 'down_sq', 'soso', 'fav', 'share', 'bgm', 'ring', 'sing', 'radio', 'try', 'give', 'poster', 'play_5_1', 'down_5_1', 'bullet', 'cache_lq', 'cache_hq', 'cache_sq', 'cache_dts', 'track_pay'];
  const out = {};
  names.forEach((name, idx) => { out[name] = Number(bits[idx] || 0) || 0; });
  out.play = out.play_lq || out.play_hq || out.play_sq || out.play_5_1 ? 1 : 0;
  return out;
}

function qqTrackTrialInfo(track) {
  track = track || {};
  const file = track.file || {};
  const action = decodeQQActionSwitch(track);
  const sizeTry = Number(file.size_try || file.sizeTry || 0) || 0;
  const tryBegin = Number(file.try_begin || file.tryBegin || file.b_30s || 0) || 0;
  const tryEnd = Number(file.try_end || file.tryEnd || file.e_30s || 0) || 0;
  const duration = tryEnd > tryBegin ? tryEnd - tryBegin : (Number(file.e_30s || 0) > Number(file.b_30s || 0) ? Number(file.e_30s || 0) - Number(file.b_30s || 0) : 0);
  const trialMid = Array.isArray(track.vs) && track.vs[0] ? track.vs[0] : (file.media_mid || '');
  return {
    hasTrial: sizeTry > 0 || (action.try && duration > 0),
    trialMid,
    previewStart: tryBegin,
    previewDuration: duration,
    sizeTry,
    action,
  };
}

function mapQQTrack(track, fallback) {
  track = track || {};
  fallback = fallback || {};
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || []);
  const mid = track.mid || fallback.mid || fallback.songmid || '';
  const albumMid = album.mid || album.pmid || '';
  const trial = qqTrackTrialInfo(track);
  const playable = !!(trial.action.play || trial.hasTrial || fallback.playable);
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: track.id || fallback.qqId || fallback.id || '',
    songType: qqSongActionType({ songType: track.songType ?? track.songtype ?? track.type ?? fallback.songType ?? fallback.songtype }),
    mid,
    songmid: mid,
    mediaMid: track.file && track.file.media_mid,
    trialMid: trial.trialMid,
    name: track.name || track.title || fallback.name || '',
    artist: artists.map(a => a.name).join(' / ') || fallback.artist || '',
    artists: artists.length ? artists : (fallback.artists || []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || fallback.album || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || fallback.cover || '',
    duration: (Number(track.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable,
    trialHint: trial.hasTrial,
    previewStart: trial.previewStart,
    previewDuration: trial.previewDuration,
  };
}

async function qqSmartboxSearch(keywords, limit) {
  const u = new URL(QQ_SMARTBOX_URL);
  u.searchParams.set('format', 'json');
  u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', '0');
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  const text = await requestText(u.toString(), { headers: QQ_HEADERS });
  const json = parseJSONText(text);
  const items = json && json.data && json.data.song && json.data.song.itemlist;
  return (Array.isArray(items) ? items : []).slice(0, Math.max(1, Math.min(limit || 6, 10))).map(mapQQSmartSong);
}

async function qqSongRawDetail(mid) {
  if (!mid) return null;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid },
    },
  });
  const data = json && json.songinfo && json.songinfo.data;
  return data && data.track_info || null;
}

async function qqSongDetail(mid, fallback) {
  if (!mid) return fallback;
  const track = await qqSongRawDetail(mid);
  return mapQQTrack(track, fallback);
}

async function handleQQArtistDetail(mid, limit) {
  const singerMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(80, parseInt(limit || '36', 10) || 36));
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid: singerMid, sin: 0, num },
    },
  }, { cookie: true });
  const block = json && json.singer;
  if (!block || Number(block.code || 0) !== 0) {
    return { provider: 'qq', error: block && (block.message || block.msg || block.code) || 'QQ_ARTIST_DETAIL_FAILED', artist: null, songs: [] };
  }
  const data = block.data || {};
  const info = data.singer_info || data.singerInfo || {};
  const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = rawSongs
    .map(raw => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter(song => song && song.name && (song.mid || song.id));
  const matchedSongArtist = songs[0] && (songs[0].artists || []).find(a => a && a.mid === singerMid);
  const artistMid = info.mid || singerMid;
  const artistName = info.name || info.title || (matchedSongArtist && matchedSongArtist.name) || '';
  const totalSong = Number(data.total_song || data.song_count || 0) || songs.length;
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      id: info.id || '',
      mid: artistMid,
      name: artistName,
      avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
      fans: Number(info.fans || 0) || 0,
      musicSize: totalSong,
      albumSize: Number(data.total_album || 0) || 0,
      mvSize: Number(data.total_mv || 0) || 0,
    },
    total: totalSong,
    songs,
  };
}

async function handleQQSearch(keywords, limit) {
  const kw = String(keywords || '').trim();
  if (!kw) return [];
  console.log('[QQSearch]', kw, 'limit:', limit);
  const base = await qqSmartboxSearch(kw, limit);
  const detailed = await Promise.all(base.map(async item => {
    try { return await qqSongDetail(item.mid, item); }
    catch (e) {
      console.warn('[QQSearch] detail failed:', item.mid, e.message);
      return item;
    }
  }));
  const seen = new Set();
  return detailed.filter(song => {
    const key = song && (song.mid || song.id || (song.name + '|' + song.artist));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!song.name;
  });
}

async function qqToplistSongs(topId, limit) {
  const count = Math.max(6, Math.min(60, Number(limit) || 30));
  const body = await qqGetJSON('https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg', {
    topid: topId || 27,
    page: 'detail',
    type: 'top',
    tpl: 3,
    song_begin: 0,
    song_num: count,
    g_tk: 5381,
    loginUin: qqCookieUin() || 0,
    hostUin: 0,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { cookie: false, headers: { Referer: 'https://y.qq.com/n/ryqq/toplist/' + encodeURIComponent(topId || 27) } });
  const raw = body && Array.isArray(body.songlist) ? body.songlist : [];
  return mapQQSongList(raw.map(item => item && (item.data || item)), count);
}

async function qqHotPublicPlaylists(limit) {
  const pageSize = Math.max(8, Math.min(40, Number(limit) || 16));
  const maxOffset = 36;
  const sin = Math.floor(Math.random() * Math.max(1, maxOffset / pageSize)) * pageSize;
  const body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg', {
    hostUin: 0,
    sin,
    ein: sin + pageSize - 1,
    sortId: 5,
    categoryId: 10000000,
    rnd: Math.random(),
    g_tk: 5381,
    loginUin: qqCookieUin() || 0,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { cookie: false, headers: { Referer: 'https://y.qq.com/n/ryqq/category' } });
  const raw = body && body.data && Array.isArray(body.data.list) ? body.data.list : [];
  return raw.map(pl => mapQQPlaylist(pl, 'public')).filter(pl => pl.id && pl.name);
}

async function qqPlaylistSongsById(id, limit) {
  if (!id) return [];
  try {
    const data = await handleQQPlaylistTracks(id);
    return mapQQSongList(data && data.tracks || [], limit || 36);
  } catch (e) {
    console.warn('[QQDiscover] playlist tracks failed:', id, e && e.message || e);
    return [];
  }
}

async function qqDailyRecommendSongs(limit) {
  const count = Math.max(10, Math.min(40, Number(limit) || 30));
  const attempts = [
    { key: 'daily', module: 'music.recommend.DailyRecommendFeed', method: 'get_daily_recommend', param: { cmd: 1, page: 0, num: count } },
    { key: 'daily_v2', module: 'music.recommend.DailyRecommendServer', method: 'get_daily_recommend', param: { cmd: 1, page: 0, num: count } },
    { key: 'daily_feed', module: 'music.recommend.RecommendFeedServer', method: 'get_recommend_feed', param: { cmd: 1, page: 0, num: count } },
  ];
  const payload = { comm: qqMusicComm(true) };
  attempts.forEach(item => {
    payload[item.key] = { module: item.module, method: item.method, param: item.param };
  });
  try {
    const json = await qqMusicRequest(payload, { cookie: true });
    const lists = attempts.map(item => {
      const block = json && json[item.key];
      if (!block || Number(block.code || 0) !== 0) return [];
      return mapQQSongList(extractQQSongItemsFromValue(block.data || block), count);
    });
    return dedupeQQSongLists(lists, count);
  } catch (e) {
    console.warn('[QQDiscover] daily recommend failed:', e && e.message || e);
    return [];
  }
}

async function qqSearchSongPool(queries, limit) {
  const out = [];
  for (const q of (queries || [])) {
    if (!q) continue;
    try {
      out.push(await handleQQSearch(q, Math.max(6, Math.min(12, limit || 8))));
    } catch (e) {
      console.warn('[QQDiscover] search seed failed:', q, e && e.message || e);
    }
    if (dedupeQQSongLists(out, limit || 24).length >= (limit || 24)) break;
  }
  return dedupeQQSongLists(out, limit || 24);
}

async function qqArtistRoamSongs(seedSongs, limit) {
  const count = Math.max(10, Math.min(50, Number(limit) || 30));
  const seeds = (Array.isArray(seedSongs) ? seedSongs : []).filter(Boolean);
  const seed = seeds.find(song => song && (song.artistMid || (song.artists || []).some(a => a && a.mid))) || seeds.find(song => song && song.artist);
  if (!seed) return [];
  const artistMid = seed.artistMid || ((seed.artists || []).find(a => a && a.mid) || {}).mid || '';
  if (artistMid) {
    try {
      const data = await handleQQArtistDetail(artistMid, count);
      const songs = mapQQSongList(data && data.songs || [], count);
      if (songs.length) return songs;
    } catch (e) {
      console.warn('[QQDiscover] artist roam failed:', artistMid, e && e.message || e);
    }
  }
  const artistName = String(seed.artist || '').split(/\s*\/\s*|、|,|&/)[0] || '';
  return artistName ? qqSearchSongPool([artistName], count) : [];
}

async function handleQQSongUrl(mid, mediaMid, qualityPreference, options) {
  options = options || {};
  const songmid = String(mid || '').trim();
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj) || '0';
  const musicKey = qqCookieMusicKey(cookieObj);
  const playbackKey = qqCookiePlaybackKey(cookieObj);
  const fileMediaMid = String(mediaMid || '').trim();
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  let detailTrack = null;
  if (!fileMediaMid || options.qqTrialMid || options.trialHint || playbackRequestFee(options) > 0 || Number(options.previewDuration || 0) > 0) {
    try { detailTrack = await qqSongRawDetail(songmid); }
    catch (e) { detailTrack = null; }
  }
  const detailTrial = qqTrackTrialInfo(detailTrack || {});
  const mediaIds = [];
  [fileMediaMid, options.qqTrialMid, detailTrack && detailTrack.file && detailTrack.file.media_mid, detailTrial.trialMid, songmid].forEach(mediaId => {
    mediaId = String(mediaId || '').trim();
    if (mediaId && !mediaIds.includes(mediaId)) mediaIds.push(mediaId);
  });
  const fileCandidates = mediaIds.flatMap(mediaId =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
  );
  const filenames = fileCandidates.map(item => item.filename);
  const param = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  };
  if (filenames.length) param.filename = filenames;
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  const json = await qqMusicRequest({
    comm,
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param,
    },
  }, { cookie: true });
  const data = json && json.req_0 && json.req_0.data;
  const infos = (data && Array.isArray(data.midurlinfo)) ? data.midurlinfo : [];
  const info = infos.find(item => item && item.purl) || infos[0];
  const purl = info && info.purl;
  if (purl) {
    const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/';
    const fileMeta = fileCandidates.find(item => item.filename === info.filename) || {};
    let loginInfo = null;
    if (fileMeta.trial || options.trialHint || playbackRequestFee(options) > 0) {
      try { loginInfo = await getQQLoginInfo(); }
      catch (e) { loginInfo = {}; }
    }
    const metadataTrial = shouldMarkPlayableAsTrial('qq', options, loginInfo || {}, { fee: playbackRequestFee(options) });
    const isTrial = !!fileMeta.trial || metadataTrial;
    const fee = playbackRequestFee(options);
    const result = {
      provider: 'qq',
      url: sip + purl,
      trial: isTrial,
      playable: true,
      loggedIn: loginInfo ? !!loginInfo.loggedIn : !!(uin && musicKey),
      vipType: loginInfo && loginInfo.vipType || 0,
      vipLevel: loginInfo && loginInfo.vipLevel || 'none',
      isVip: !!(loginInfo && loginInfo.isVip),
      isSvip: !!(loginInfo && loginInfo.isSvip),
      vipLabel: loginInfo && loginInfo.vipLabel || '无VIP',
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      br: fileMeta.br || 0,
      maxAvailableQuality: fileMeta.level || '',
      availableQualities: qualityLevelsAtOrBelow(fileMeta.level || 'standard'),
      filename: info.filename || '',
      fee,
      trialMid: detailTrial.trialMid || '',
      previewStart: detailTrial.previewStart || 0,
      previewDuration: detailTrial.previewDuration || Number(options.previewDuration || 0) || 0,
      trialSize: detailTrial.sizeTry || 0,
      requestedQuality,
    };
    if (isTrial) {
      result.restriction = metadataTrial
        ? playableTrialRestriction('qq', fee, loginInfo || {}, { code: info.result || 0 })
        : playbackRestriction('qq', 'trial_only', 'QQ 音乐仅返回试听片段，完整播放需要会员、购买或更高权限', 'upgrade', { code: info.result || 0, fee });
      result.reason = result.restriction.category;
      result.message = result.restriction.message;
    }
    return result;
  }
  let failedSongMeta = {};
  let failedLoginInfo = {};
  try { failedSongMeta = detailTrack ? mapQQTrack(detailTrack, { mid: songmid, mediaMid: fileMediaMid }) : await qqSongDetail(songmid, { mid: songmid, mediaMid: fileMediaMid }); }
  catch (e) { failedSongMeta = {}; }
  try { failedLoginInfo = await getQQLoginInfo(); }
  catch (e) { failedLoginInfo = {}; }
  const restriction = classifyQQPlaybackRestriction(info, {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
    songFee: playbackRequestFee(options, failedSongMeta),
    hasTrial: !!(failedSongMeta && (failedSongMeta.trialHint || Number(failedSongMeta.previewDuration || 0) > 0)),
    hasVip: !!(failedLoginInfo && (failedLoginInfo.isVip || failedLoginInfo.isSvip || Number(failedLoginInfo.vipType || 0) > 0)),
  });
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: !!(uin && musicKey),
    playbackKeyReady: !!(uin && playbackKey),
    restriction,
    reason: restriction.category,
    message: restriction.message,
    fee: playbackRequestFee(options, failedSongMeta),
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    trialHint: !!(failedSongMeta && failedSongMeta.trialHint),
    trialMid: failedSongMeta && failedSongMeta.trialMid || detailTrial.trialMid || '',
    previewStart: failedSongMeta && failedSongMeta.previewStart || detailTrial.previewStart || 0,
    previewDuration: failedSongMeta && failedSongMeta.previewDuration || detailTrial.previewDuration || 0,
    tried: fileCandidates.map(item => item.label + ' · ' + item.filename),
    requestedQuality,
  };
}

const QQ_COMMENT_BIZ_TYPE_SONG = 1;
const QQ_COMMENT_PRAISE = 3;
const QQ_COMMENT_CANCEL_PRAISE = 4;

function qqRpcBlockCode(block) {
  return Number(block && (
    block.code != null ? block.code
      : block.Code != null ? block.Code
        : block.retcode != null ? block.retcode
          : block.ret != null ? block.ret
            : block.result
  ) || 0);
}
function qqRpcBlockMessage(block, fallback) {
  const data = block && (block.data || block.Data) || {};
  return (block && (block.message || block.msg || block.Msg || block.retmsg || block.errmsg)) ||
    data.Msg || data.msg || data.Message || data.message || data.retmsg || data.errmsg || fallback || '';
}
function qqRpcBlockOk(block) {
  return !!block && qqRpcBlockCode(block) === 0;
}
function qqRpcError(block, fallback) {
  const code = qqRpcBlockCode(block);
  const err = new Error(qqRpcBlockMessage(block, fallback) || (code ? ('QQ_MUSIC_CODE_' + code) : fallback || 'QQ_MUSIC_REQUEST_FAILED'));
  err.qqCode = code;
  err.statusCode = code === 1000 ? 401 : 409;
  err.errorCode = code === 1000 ? 'QQ_LOGIN_REQUIRED' : 'QQ_COMMENT_SYNC_FAILED';
  return err;
}
function requireQQLogin(res) {
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const musicKey = qqCookieMusicKey(cookieObj);
  if (!uin || !musicKey) {
    sendJSON(res, {
      provider: 'qq',
      loggedIn: false,
      error: 'QQ_LOGIN_REQUIRED',
      message: '请先登录 QQ 音乐后再操作评论。',
    }, 401);
    return null;
  }
  return { cookieObj, uin, musicKey };
}

function mapQQComment(raw) {
  raw = raw || {};
  const user = raw.user || raw.uin || {};
  const nickname = raw.Nick || raw.nick || raw.nickname || raw.EncryptUin || raw.encrypt_uin || user.nick || user.nickname || user.name || 'QQ 音乐用户';
  const avatar = raw.Avatar || raw.avatarurl || raw.avatar || user.avatarurl || user.avatar || '';
  const timeRaw = Number(raw.PubTime || raw.time || raw.commenttime || raw.createTime || 0) || 0;
  const liked = raw.IsPraised === 1 || raw.IsPraised === true || raw.ispraise === 1 || raw.ispraise === '1' || raw.praised === 1 || raw.praised === true || raw.liked === true;
  return {
    id: raw.CmId || raw.commentid || raw.commentId || raw.id || '',
    content: decodeHtmlEntities(raw.Content || raw.rootcommentcontent || raw.content || raw.comment || ''),
    likedCount: Number(raw.PraiseNum || raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    liked,
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: raw.EncryptUin || raw.encrypt_uin || raw.uin || user.uin || '',
      nickname,
      avatar,
    },
  };
}

async function resolveQQSongCommentBizId(id, mid) {
  let topid = String(id || '').replace(/\D/g, '');
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid });
      topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
    } catch (e) {
      console.warn('[QQComments] detail fallback failed:', e.message);
    }
  }
  return topid;
}

function qqCommentListFromData(data) {
  data = data || {};
  const lists = [data.CommentList, data.CommentList2, data.CommentList3].filter(Boolean);
  return lists.find(list => Array.isArray(list.Comments) && list.Comments.length) || lists[0] || {};
}

async function handleQQLegacySongComments(topid, mid, limit, offset) {
  const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
  const uin = qqCookieUin() || '0';
  const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
    g_tk: '5381',
    loginUin: uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
    cid: '205360772',
    reqtype: '2',
    biztype: '1',
    topid,
    cmd: '8',
    needmusiccrit: '0',
    pagenum: String(page),
    pagesize: String(limit || 20),
  }, { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } });
  const hotList = body && body.hot_comment && body.hot_comment.commentlist;
  const normalList = body && body.comment && body.comment.commentlist;
  const raw = (offset === 0 && Array.isArray(hotList) && hotList.length) ? hotList : (normalList || []);
  const comments = (raw || []).map(mapQQComment).filter(c => c.content);
  const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
  return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length), legacy: true };
}

async function handleQQSongComments(id, mid, limit, offset) {
  const topid = await resolveQQSongCommentBizId(id, mid);
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
  const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
  try {
    const json = await qqMusicRequest({
      comm: qqMusicComm(true),
      req_0: {
        module: 'music.globalComment.CommentRead',
        method: 'GetNewCommentList',
        param: {
          BizType: QQ_COMMENT_BIZ_TYPE_SONG,
          BizId: topid,
          LastCommentSeqNo: '',
          PageSize: limit || 20,
          PageNum: page,
          FromCommentId: '',
          WithHot: 0,
          PicEnable: 1,
          LastTotal: 0,
          LastTotalVer: '0',
        },
      },
    }, { cookie: true });
    const block = json && json.req_0;
    if (!qqRpcBlockOk(block)) throw qqRpcError(block, 'QQ_COMMENT_READ_FAILED');
    const data = block.data || {};
    const list = qqCommentListFromData(data);
    const comments = (list.Comments || []).map(mapQQComment).filter(c => c.content);
    const total = Number(list.Total || data.Total || comments.length) || comments.length;
    return { provider: 'qq', id: topid, total, comments, hot: false, body: block };
  } catch (e) {
    console.warn('[QQComments] global comment rpc fallback:', e && e.message || e);
    return handleQQLegacySongComments(topid, mid, limit, offset);
  }
}

async function handleQQSongCommentLike(commentId, like) {
  const id = String(commentId || '').trim();
  if (!id) {
    const err = new Error('Missing comment id');
    err.statusCode = 400;
    throw err;
  }
  const nextLike = like !== false && String(like) !== 'false' && String(like) !== '0';
  const json = await qqMusicRequest({
    comm: qqMusicComm(true),
    req_0: {
      module: 'GlobalComment.GlobalCommentWriteServer',
      method: 'UpdateHotComment',
      param: {
        comment_id: id,
        type: nextLike ? QQ_COMMENT_PRAISE : QQ_COMMENT_CANCEL_PRAISE,
        uin: String(qqCookieUin() || '0'),
      },
    },
  }, { cookie: true });
  const block = json && json.req_0;
  if (!qqRpcBlockOk(block)) throw qqRpcError(block, 'QQ 评论点赞同步失败');
  return { provider: 'qq', loggedIn: true, commentId: id, liked: nextLike, code: qqRpcBlockCode(block), body: block };
}

async function handleQQSongCommentReply(id, mid, commentId, content) {
  const topid = await resolveQQSongCommentBizId(id, mid);
  const replyId = String(commentId || '').trim();
  const text = String(content || '').trim().slice(0, 300);
  if (!topid) {
    const err = new Error('Missing QQ song id');
    err.statusCode = 400;
    throw err;
  }
  if (!replyId) {
    const err = new Error('Missing comment id');
    err.statusCode = 400;
    throw err;
  }
  if (!text) {
    const err = new Error('Missing reply content');
    err.statusCode = 400;
    throw err;
  }
  const json = await qqMusicRequest({
    comm: qqMusicComm(true),
    req_0: {
      module: 'music.globalComment.CommentWriteServer',
      method: 'AddComment',
      param: {
        BizType: QQ_COMMENT_BIZ_TYPE_SONG,
        BizId: topid,
        Content: text,
        RepliedCmId: replyId,
      },
    },
  }, { cookie: true });
  const block = json && json.req_0;
  if (!qqRpcBlockOk(block)) throw qqRpcError(block, 'QQ 评论回复同步失败');
  const data = block.data || {};
  return {
    provider: 'qq',
    loggedIn: true,
    id: topid,
    commentId: replyId,
    replyId: data.AddedCmId || data.CmId || '',
    code: qqRpcBlockCode(block),
    body: block,
  };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function decodeQQLyricText(text) {
  let raw = decodeHtmlEntities(String(text || '').trim());
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const looksBase64 = compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '');
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
    } catch (e) {
      console.warn('[QQLyric] base64 decode failed:', e.message);
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
}

function normalizeQQSongId(id) {
  const n = String(id || '').replace(/\D/g, '');
  return n ? Number(n) : 0;
}

async function handleQQLyric(mid, id) {
  const songMID = String(mid || '').trim();
  const songID = normalizeQQSongId(id);
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };

  let lyricText = '';
  let transText = '';
  let qrcText = '';
  let romaText = '';
  let source = 'qq-musicu';

  try {
    const param = {};
    if (songMID) param.songMID = songMID;
    if (songID) param.songID = songID;
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param,
      },
    }, { cookie: true });
    const data = json && json.lyric && json.lyric.data;
    lyricText = decodeQQLyricText(data && data.lyric);
    transText = decodeQQLyricText(data && data.trans);
    qrcText = decodeQQLyricText(data && data.qrc);
    romaText = decodeQQLyricText(data && data.roma);
  } catch (e) {
    console.warn('[QQLyric] musicu failed:', e.message);
  }

  if (!lyricText && songMID) {
    try {
      const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        songmid: songMID,
        songtype: '0',
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: qqCookieUin() || '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, { headers: { Referer: 'https://y.qq.com/portal/player.html' } });
      lyricText = decodeQQLyricText(body && body.lyric);
      transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
      source = 'qq-legacy';
    } catch (e) {
      console.warn('[QQLyric] legacy failed:', e.message);
    }
  }

  return {
    provider: 'qq',
    id: songID || '',
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    qrc: qrcText,
    roma: romaText,
    source: lyricText ? source : 'qq-empty',
  };
}

function mapPodcastRadio(r) {
  r = r || {};
  const dj = r.dj || r.djSimple || r.djUser || r.creator || {};
  const id = r.id || r.rid || r.radioId;
  return {
    id,
    rid: id,
    name: r.name || r.radioName || '',
    cover: r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl || '',
    desc: r.desc || r.description || r.rcmdText || '',
    djName: dj.nickname || r.djName || r.nickname || '',
    category: r.category || r.categoryName || '',
    programCount: r.programCount || r.programNum || r.programCnt || 0,
    subCount: r.subCount || r.subedCount || r.subscriberCount || 0,
  };
}

function mapPodcastProgram(p, fallbackRadio) {
  p = p || {};
  const mainSong = p.mainSong || p.song || p.mainTrack || {};
  const radio = p.radio || fallbackRadio || {};
  const mappedRadio = mapPodcastRadio(radio);
  const artists = mapArtists(mainSong.ar || mainSong.artists || []);
  const album = mainSong.al || mainSong.album || {};
  const dj = p.dj || radio.dj || {};
  const playableId = mainSong.id || p.mainSongId || p.songId;
  return {
    type: 'podcast',
    source: 'podcast',
    id: playableId,
    programId: p.id || p.programId,
    radioId: mappedRadio.id,
    name: p.name || mainSong.name || '',
    artist: mappedRadio.name || dj.nickname || artists.map(a => a.name).join(' / ') || mappedRadio.djName || '',
    artists,
    artistId: artists[0] && artists[0].id,
    album: mappedRadio.name || album.name || 'Podcast',
    cover: p.coverUrl || p.cover || p.blurCoverUrl || mappedRadio.cover || album.picUrl || '',
    duration: p.duration || mainSong.dt || mainSong.duration || 0,
    fee: mainSong.fee,
    djName: mappedRadio.djName || dj.nickname || '',
    radioName: mappedRadio.name || '',
    desc: p.description || p.desc || '',
    createTime: p.createTime || 0,
    serialNum: p.serialNum || p.serial || 0,
  };
}

function firstArrayFrom(obj, keys) {
  obj = obj || {};
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.list)) return value.list;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.resources)) return value.resources;
  }
  return [];
}

function mapPodcastVoice(v) {
  v = v || {};
  const raw = v.resource || v.voice || v.data || v.program || v;
  const mainSong = raw.mainSong || raw.song || raw.track || {};
  const radio = raw.radio || raw.djRadio || raw.voiceList || raw.podcast || {};
  const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id;
  return {
    type: 'podcast',
    source: 'podcast',
    sourceType: 'podcast-voice',
    id: playableId,
    programId: raw.programId || raw.voiceId || raw.id,
    radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
    name: raw.name || raw.songName || raw.title || mainSong.name || '',
    artist: (radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName || 'Voice'),
    album: radio.name || radio.radioName || raw.podcastName || 'Podcast',
    cover: raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl || '',
    duration: raw.duration || raw.durationMs || mainSong.dt || mainSong.duration || 0,
    djName: raw.djName || (radio.dj && radio.dj.nickname) || '',
    radioName: radio.name || radio.radioName || raw.podcastName || '',
    desc: raw.desc || raw.description || '',
  };
}

function mapPodcastCollectionRadio(r, key) {
  const radio = mapPodcastRadio(r);
  return {
    ...radio,
    type: 'podcast-radio',
    sourceType: 'podcast-radio',
    collectionKey: key || '',
    radioId: radio.id,
    name: radio.name,
    artist: radio.djName || radio.category || 'Podcast',
    album: radio.category || 'Podcast',
  };
}

function podcastCollectionMeta(key, items) {
  const meta = {
    collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
    created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
    liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
  }[key] || { key, title: key, sub: '', itemType: 'radio' };
  const first = (items || [])[0] || {};
  return {
    ...meta,
    count: (items || []).length,
    cover: first.cover || first.picUrl || first.coverUrl || '',
  };
}

async function fetchMyPodcastItems(key, info, limit, offset) {
  limit = Math.max(8, Math.min(60, Number(limit) || 30));
  offset = Math.max(0, Number(offset) || 0);
  if (key === 'collect') {
    const r = await dj_sublist({ limit, offset, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['djRadios', 'djradios', 'radios', 'data']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'created') {
    const r = await user_audio({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'paid') {
    const r = await dj_paygift({ limit, offset, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'liked') {
    let raw = [];
    try {
      const sati = await sati_resource_sub_list({ cookie: userCookie, timestamp: Date.now() });
      raw = firstArrayFrom(sati.body, ['data', 'resources', 'list']);
    } catch (e) {
      console.warn('[MyPodcastLiked] sati sub list failed:', e.message);
    }
    if (!raw.length) {
      try {
        const recent = await record_recent_voice({ limit, cookie: userCookie, timestamp: Date.now() });
        raw = firstArrayFrom(recent.body, ['data', 'list', 'resources']);
      } catch (e) {
        console.warn('[MyPodcastLiked] recent voice fallback failed:', e.message);
      }
    }
    return { itemType: 'voice', items: raw.map(mapPodcastVoice).filter(x => x.id && x.name) };
  }
  return { itemType: 'radio', items: [] };
}

// ---------- 业务: 取歌曲URL (探测试听) ----------
//   返回 { url, trial, level, br }
//   trial=true 表示这是试听片段 (freeTrialInfo 非空)
async function handleSongUrl(id, loginInfo, qualityPreference, options) {
  options = options || {};
  console.log('[SongUrl] id:', id, 'logged-in:', !!userCookie);
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const svipReady = hasNeteaseSvip(loginInfo);
  const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES)
    .filter(q => !q.svip || svipReady);

  let trialFallback = null; // 兜底: 即使是试听也要能播
  let lastData = null;
  let lastError = null;

  for (const q of qualities) {
    try {
      // 优先用 v1 接口 (支持更高音质 level 字段)
      let result;
      try {
        result = await song_url_v1({ id, level: q.level, cookie: userCookie });
      } catch (e) {
        result = await song_url({ id, br: q.br, cookie: userCookie });
      }
      const d = result.body && result.body.data && result.body.data[0];
      if (d) lastData = d;
      const url = d && d.url;
      const freeTrial = d && d.freeTrialInfo;
      const fee = playbackRequestFee(options, d);
      const metadataTrial = shouldMarkPlayableAsTrial('netease', options, loginInfo, d);
      const resolvedLevel = resolvedQualityFromLevelAndBitrate(q.level, d && d.br, [d && d.level, d && d.type, d && d.encodeType, d && d.format].filter(Boolean).join(' '));
      console.log('[SongUrl]', q.level, '->', url ? 'OK' : 'no url', freeTrial ? '(TRIAL)' : '');
      if (url && !freeTrial && !metadataTrial) {
        return {
          url,
          trial: false,
          playable: true,
          level: resolvedLevel,
          quality: q.label,
          br: d.br,
          fee,
          requestedQuality,
          maxAvailableQuality: resolvedLevel,
          availableQualities: qualityLevelsAtOrBelow(resolvedLevel),
        };
      }
      if (url && (freeTrial || metadataTrial) && !trialFallback) {
        const restriction = freeTrial
          ? classifyNeteasePlaybackRestriction(d, loginInfo)
          : playableTrialRestriction('netease', fee, loginInfo, { code: d && d.code });
        trialFallback = {
          url,
          trial: true,
          playable: true,
          level: resolvedLevel,
          quality: q.label,
          br: d.br,
          fee,
          requestedQuality,
          maxAvailableQuality: resolvedLevel,
          availableQualities: qualityLevelsAtOrBelow(resolvedLevel),
          trialInfo: freeTrial,
          restriction,
          reason: restriction.category,
          message: restriction.message,
        };
      }
    } catch (err) {
      lastError = err;
      console.log('[SongUrl]', q.level, 'failed:', err.message);
    }
  }
  if (trialFallback) return trialFallback;
  const restriction = classifyNeteasePlaybackRestriction(lastData || { fee: playbackRequestFee(options) }, loginInfo);
  return {
    url: null,
    trial: false,
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction,
    lastCode: lastData && lastData.code,
    fee: playbackRequestFee(options, lastData),
    error: lastError && lastError.message,
    requestedQuality,
  };
}

// ---------- 业务: 登录态/用户信息 ----------
function readCookieFromResponse(resp) {
  const candidates = [
    resp && resp.cookie,
    resp && resp.body && resp.body.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookies,
  ];
  for (const candidate of candidates) {
    const cookie = normalizeCookieHeader(candidate);
    if (cookie) return cookie;
  }
  return '';
}
function firstPositiveNumberFrom(objects, keys) {
  const keySet = new Set(keys || []);
  function visit(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 5) return 0;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return 0;
    }
    for (const key of Object.keys(obj)) {
      if (keySet.has(key)) {
        const value = Number(obj[key]);
        if (Number.isFinite(value) && value > 0) return value;
      }
    }
    for (const key of Object.keys(obj)) {
      const found = visit(obj[key], depth + 1);
      if (found) return found;
    }
    return 0;
  }
  for (const obj of objects) {
    const found = visit(obj, 0);
    if (found) return found;
  }
  return 0;
}
function collectStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') {
    if (value) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(key => collectStringValues(value[key], out, depth + 1));
  }
  return out;
}
function collectVipStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectVipStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  Object.keys(value).forEach(key => {
    const child = value[key];
    if (/vip|svip|member|associator|privilege|right|level|package|label|title|type/i.test(key)) {
      collectStringValues(child, out, depth + 1);
    } else if (child && typeof child === 'object') {
      collectVipStringValues(child, out, depth + 1);
    }
  });
  return out;
}
function firstPositiveNumberDirect(obj, keys) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const key of keys || []) {
    const value = Number(obj[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}
function explicitTruthy(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}
function normalizeExpireTimeMs(value) {
  const time = Number(value || 0);
  if (!Number.isFinite(time) || time <= 0) return 0;
  return time < 100000000000 ? time * 1000 : time;
}
function readNeteaseVipExpiresAt(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Math.max(
    normalizeExpireTimeMs(obj.expireTime),
    normalizeExpireTimeMs(obj.expire_time),
    normalizeExpireTimeMs(obj.expireAt),
    normalizeExpireTimeMs(obj.expire_at),
    normalizeExpireTimeMs(obj.endTime),
    normalizeExpireTimeMs(obj.end_time),
    normalizeExpireTimeMs(obj.validTime),
    normalizeExpireTimeMs(obj.valid_time),
    normalizeExpireTimeMs(obj.vipExpireTime),
    normalizeExpireTimeMs(obj.vip_expire_time)
  );
}
function collectActiveNeteaseVipPackages(value, pathParts, out, depth, now) {
  if (!value || typeof value !== 'object' || depth > 7) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectActiveNeteaseVipPackages(item, pathParts.concat(String(index)), out, depth + 1, now));
    return out;
  }
  const expiresAt = readNeteaseVipExpiresAt(value);
  const level = firstPositiveNumberDirect(value, [
    'vipLevel', 'vip_level', 'vipCode', 'vip_code', 'vipType', 'vip_type',
    'level', 'type', 'redVipLevel', 'red_vip_level', 'musicVipLevel',
    'music_vip_level', 'blackVipLevel', 'black_vip_level', 'svipType',
    'svip_type',
  ]);
  if (expiresAt > now && level > 0) {
    out.push({ path: pathParts.join('.'), expiresAt, level });
  }
  Object.keys(value).forEach(key => {
    collectActiveNeteaseVipPackages(value[key], pathParts.concat(key), out, depth + 1, now);
  });
  return out;
}
function emptyNeteaseVip(extra) {
  extra = extra || {};
  return {
    vipType: 0,
    vipLevel: 'none',
    isVip: false,
    isSvip: false,
    vipLabel: '无VIP',
    vipExpiresAt: 0,
    vipCheckedAt: extra.vipCheckedAt || Date.now(),
    vipSource: extra.vipSource || 'netease',
  };
}
function normalizeNeteaseVipPayloads(payloads) {
  const now = Date.now();
  const active = collectActiveNeteaseVipPackages(payloads, ['vipPayloads'], [], 0, now);
  if (!active.length) return emptyNeteaseVip({ vipCheckedAt: now, vipSource: 'netease-vip-api' });
  const isSvip = active.some(item => /svip|super|redplus|luxury/i.test(item.path));
  const expiresAt = Math.max(...active.map(item => item.expiresAt));
  return {
    vipType: isSvip ? 10 : 1,
    vipLevel: isSvip ? 'svip' : 'vip',
    isVip: true,
    isSvip,
    vipLabel: isSvip ? 'SVIP' : 'VIP',
    vipExpiresAt: expiresAt,
    vipCheckedAt: now,
    vipSource: 'netease-vip-api',
  };
}
function normalizeNeteaseVip(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  extra = extra || {};
  if (Array.isArray(extra.vipPayloads)) {
    return normalizeNeteaseVipPayloads(extra.vipPayloads);
  }
  const vipInfo = profile.vipInfo || profile.vipinfo || account.vipInfo || account.vipinfo || extra.vipInfo || extra.vipinfo || {};
  const objects = [account, profile, vipInfo, extra];
  const vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'musicVipLevel', 'music_vip_level', 'blackVipLevel', 'black_vip_level',
    'luxuryVipLevel', 'luxury_vip_level',
    'svipType', 'svip_type', 'vipCode', 'vip_code', 'associatorVipCode', 'associator_vip_code',
    'memberType', 'member_type', 'membershipType', 'membership_type',
  ]);
  const text = '';
  const svipFlag = objects.some(obj => obj && (
    obj.isSvip === true || obj.is_svip === true || obj.svip === true ||
    Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || 0) > 0
  )) || /svip|supervip|super_vip|blackvip|black_vip|黑胶svip|超级会员/.test(text);
  const vipFlag = objects.some(obj => obj && (
    obj.isVip === true || obj.is_vip === true || obj.vip === true ||
    Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || 0) > 0
  )) || /vip|黑胶|会员/.test(text);
  const isSvip = svipFlag || vipType >= 10;
  const isVip = isSvip || vipFlag || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无VIP'),
  };
}
function normalizeLoginInfo(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  const userId = profile.userId || profile.user_id || profile.id || account.userId || account.id || '';
  if (!(userId || userId === 0)) return { loggedIn: false };
  const vip = normalizeNeteaseVip(profile, account, extra);
  return {
    loggedIn: true,
    userId,
    nickname: profile.nickname || profile.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || '',
    ...vip,
  };
}
async function enrichNeteaseLoginVip(info) {
  if (!info || !info.loggedIn || !info.userId) return info;
  const tasks = [];
  if (typeof vip_info_v2 === 'function') tasks.push(vip_info_v2({ uid: info.userId, cookie: userCookie, timestamp: Date.now() }));
  if (typeof vip_info === 'function') tasks.push(vip_info({ uid: info.userId, cookie: userCookie, timestamp: Date.now() }));
  if (!tasks.length) return info;
  try {
    const results = await Promise.allSettled(tasks);
    const vipPayloads = results
      .filter(item => item.status === 'fulfilled' && item.value)
      .map(item => item.value.body || item.value)
      .filter(Boolean);
    if (!vipPayloads.length) return info;
    const vip = normalizeNeteaseVip({}, {}, { vipPayloads });
    return { ...info, ...vip };
  } catch (e) {
    console.warn('[Login] vip info failed:', e.message);
    return info;
  }
}
function isNeteaseAuthInvalidPayload(payload) {
  const code = normalizeApiCode(payload);
  if (code === 301 || code === 401) return true;
  const msg = normalizeApiMessage(payload);
  return /未登录|需要登录|请先登录|login/i.test(msg) && code >= 300;
}
async function getLoginInfo() {
  if (!userCookie) return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };

  // login_status 对二维码 cookie 的资料刷新通常更及时；失败时再降级到 user_account。
  try {
    const st = await login_status({ cookie: userCookie, timestamp: Date.now() });
    const body = st.body || {};
    const data = body.data || body;
    const info = normalizeLoginInfo(data.profile || body.profile, data.account || body.account, data);
    if (info.loggedIn) return await enrichNeteaseLoginVip(info);
  } catch (e) {
    console.warn('[Login] login_status failed:', e.message);
  }

  try {
    const acc = await user_account({ cookie: userCookie, timestamp: Date.now() });
    const body = acc.body || {};
    const info = normalizeLoginInfo(body.profile, body.account, body);
    if (info.loggedIn) return await enrichNeteaseLoginVip(info);
    if (isNeteaseAuthInvalidPayload(acc)) saveCookie('');
    return { loggedIn: false, hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  } catch (e) {
    console.warn('[Login] account check failed:', e.message);
    return { loggedIn: false, hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  }
}

// ====================================================================
//  HTTP Server
// ====================================================================
function readWorkerStdin(timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    let text = '';
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(text);
    };
    const timer = setTimeout(finish, timeoutMs || 1200);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      text += String(chunk || '');
      if (text.length > 256 * 1024) text = text.slice(-256 * 1024);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

async function runSodaCookieWorkerCli() {
  let opts = {};
  try {
    const raw = await readWorkerStdin(1200);
    opts = raw ? JSON.parse(raw) : {};
  } catch (e) {
    opts = {};
  }
  try {
    const cookie = readSodaCookieFromClient(opts || {});
    process.stdout.write(JSON.stringify({
      ok: true,
      cookie,
      clientDir: sodaLastLocalSync.clientDir || '',
      lastLocalSync: sodaLastLocalSync,
      userDataDiscoveryCache: sodaUserDataDiscoveryCache,
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: e.message || String(e),
      lastLocalSync: {
        ...sodaLastLocalSync,
        checkedAt: Date.now(),
        error: e.message || String(e),
      },
      userDataDiscoveryCache: sodaUserDataDiscoveryCache,
    }));
  }
}

if (process.env.MINERADIO_SODA_COOKIE_WORKER === '1') {
  runSodaCookieWorkerCli()
    .then(() => process.exit(0))
    .catch(err => {
      try {
        process.stdout.write(JSON.stringify({ ok: false, error: err && err.message || String(err) }));
      } catch (e) {}
      process.exit(1);
    });
  return;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

  if (pn === '/api/app/version') {
    sendJSON(res, {
      name: APP_PACKAGE.name || 'mineradio',
      productName: APP_PACKAGE.productName || 'Mineradio',
      version: APP_VERSION,
      update: {
        provider: UPDATE_CONFIG.provider,
        configured: UPDATE_CONFIG.configured,
        owner: UPDATE_CONFIG.owner,
        repo: UPDATE_CONFIG.repo,
        gitee: UPDATE_CONFIG.gitee || {},
        preview: UPDATE_CONFIG.preview,
        manifestOverride: !!UPDATE_CONFIG.manifest,
      },
    });
    return;
  }

  if (pn === '/api/update/latest') {
    try {
      sendJSON(res, await fetchLatestUpdateInfo());
    } catch (err) {
      sendJSON(res, {
        ...localUpdateFallback(err.message || 'Update check failed', { configured: UPDATE_CONFIG.configured }),
        error: err.message || 'Update check failed',
      });
    }
    return;
  }

  if (pn === '/api/update/download') {
    try {
      const info = await ensureUpdateInstallerDigest(await fetchLatestUpdateInfo());
      const job = startUpdateDownloadJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdateDownload]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_DOWNLOAD_START_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/download/status') {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
    return;
  }

  if (pn === '/api/update/patch') {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdatePatchJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdatePatch]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_PATCH_START_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/patch/status') {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find(item => item.mode === 'patch');
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
    return;
  }

  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
    return;
  }

  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      try {
        const entry = readBeatMapCache(key);
        sendJSON(res, entry
          ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
          : { ok: true, hit: false, key });
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        sendJSON(res, writeBeatMapCache(body));
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return;
  }

  if (pn === '/api/discover/home') {
    try {
      sendJSON(res, await handleDiscoverHome(url.searchParams.get('provider') || 'netease'));
    } catch (err) {
      console.error('[DiscoverHome]', err);
      sendJSON(res, { error: err.message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/weather/radio') {
    try {
      const data = await buildWeatherRadio({
        city: url.searchParams.get('city') || url.searchParams.get('q') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        timezone: url.searchParams.get('timezone') || '',
        regionProvince: url.searchParams.get('regionProvince') || '',
        regionCity: url.searchParams.get('regionCity') || '',
        regionDistrict: url.searchParams.get('regionDistrict') || '',
        regionLabel: url.searchParams.get('regionLabel') || '',
      });
      sendJSON(res, data);
    } catch (err) {
      console.error('[WeatherRadio]', err);
      sendJSON(res, {
        ok: false,
        error: err.message,
        weather: null,
        radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
      }, 500);
    }
    return;
  }

  if (pn === '/api/weather/ip-location') {
    try {
      sendJSON(res, { ok: true, location: await fetchIpWeatherLocation() });
    } catch (err) {
      console.error('[WeatherIpLocation]', err);
      sendJSON(res, { ok: false, error: err.message, location: null }, 500);
    }
    return;
  }

  if (pn === '/api/weather/reverse-location') {
    try {
      sendJSON(res, { ok: true, location: await reverseWeatherLocation(url.searchParams.get('lat'), url.searchParams.get('lon')) });
    } catch (err) {
      console.error('[WeatherReverseLocation]', err);
      sendJSON(res, { ok: false, error: err.message, location: null }, err.statusCode || 500);
    }
    return;
  }

  // ---------- 搜索 ----------
  if (pn === '/api/search') {
    try {
      const kw    = url.searchParams.get('keywords') || '';
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const songs = await handleSearch(kw, limit);
      sendJSON(res, { songs });
    } catch (err) { console.error('[Search]', err); sendJSON(res, { error: err.message, songs: [] }, 500); }
    return;
  }

  if (pn === '/api/qq/search') {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8));
      const songs = await handleQQSearch(kw, limit);
      sendJSON(res, { provider: 'qq', songs });
    } catch (err) {
      console.error('[QQSearch]', err);
      sendJSON(res, { provider: 'qq', error: err.message, songs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/song/url') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('id') || '';
      const mediaMid = url.searchParams.get('mediaMid') || url.searchParams.get('media_mid') || '';
      const quality = url.searchParams.get('quality') || '';
      const info = await handleQQSongUrl(mid, mediaMid, quality, playbackRequestOptionsFromSearchParams(url.searchParams));
      sendJSON(res, info);
    } catch (err) {
      console.error('[QQSongUrl]', err);
      sendJSON(res, { provider: 'qq', url: '', playable: false, error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/qq/lyric') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      if (!mid && !id) { sendJSON(res, { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400); return; }
      const data = await handleQQLyric(mid, id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQLyric]', err);
      sendJSON(res, { provider: 'qq', error: err.message, lyric: '' }, 500);
    }
    return;
  }

  // ---------- 歌曲URL ----------
  if (pn === '/api/qq/login/status') {
    try {
      const quick = url.searchParams.get('quick') === '1' || url.searchParams.get('quick') === 'true';
      const info = await getQQLoginInfo({ quick });
      sendJSON(res, info);
    } catch (err) {
      console.error('[QQLoginStatus]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/qq/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeQQCookieInput(raw);
      const obj = parseCookieString(normalized);
      if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
        sendJSON(res, { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' }, 400);
        return;
      }
      saveQQCookie(normalized);
      const info = await getQQLoginInfo();
      sendJSON(res, { ...info, saved: true });
    } catch (err) {
      console.error('[QQLoginCookie]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/qq/logout') {
    saveQQCookie('');
    sendJSON(res, { provider: 'qq', ok: true, loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' });
    return;
  }

  if (pn === '/api/qq/user/playlists') {
    try {
      const data = await handleQQUserPlaylists();
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQUserPlaylists]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message, playlists: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/playlist/tracks') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('disstid') || '';
      const data = await handleQQPlaylistTracks(id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQPlaylistTracks]', err);
      sendJSON(res, { provider: 'qq', error: err.message, tracks: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/song/like/check') {
    try {
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const data = await handleQQSongLikeCheck(ids);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQLikeCheck]', err);
      sendJSON(res, { provider: 'qq', loggedIn: err && err.statusCode !== 401, error: err.errorCode || err.message, message: err.message, liked: {} }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/qq/song/like') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const likeValue = body.like != null ? body.like : url.searchParams.get('like');
      const data = await handleQQSongLike({
        id: body.id || url.searchParams.get('id'),
        mid: body.mid || body.songmid || url.searchParams.get('mid') || url.searchParams.get('songmid'),
        qqId: body.qqId || body.songId || body.songid || url.searchParams.get('qqId') || url.searchParams.get('songId'),
        songType: body.songType ?? body.songtype ?? body.qqSongType ?? body.qqType ?? url.searchParams.get('songType') ?? url.searchParams.get('songtype'),
      }, likeValue);
      sendJSON(res, data, data.success === false ? 409 : 200);
    } catch (err) {
      console.error('[QQLike]', err);
      sendJSON(res, { provider: 'qq', loggedIn: err && err.statusCode !== 401, error: err.errorCode || err.message, message: err.message }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/qq/playlist/add-song') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid') || url.searchParams.get('dirid') || url.searchParams.get('disstid');
      const data = await handleQQPlaylistWriteSong(pid, {
        id: body.id || url.searchParams.get('id'),
        mid: body.mid || body.songmid || url.searchParams.get('mid') || url.searchParams.get('songmid'),
        qqId: body.qqId || body.songId || body.songid || url.searchParams.get('qqId') || url.searchParams.get('songId'),
        songType: body.songType ?? body.songtype ?? body.qqSongType ?? body.qqType ?? url.searchParams.get('songType') ?? url.searchParams.get('songtype'),
        writeId: body.writeId || body.dirid || url.searchParams.get('writeId') || url.searchParams.get('dirid'),
      }, 'add');
      sendJSON(res, data, data.success === false ? 409 : 200);
    } catch (err) {
      console.error('[QQPlaylistAddSong]', err);
      sendJSON(res, { provider: 'qq', loggedIn: err && err.statusCode !== 401, success: false, error: err.errorCode || err.message, message: err.message }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/soda/search') {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(18, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
      const songs = await handleSodaSearch(kw, limit);
      sendJSON(res, { provider: 'soda', songs });
    } catch (err) {
      console.error('[SodaSearch]', err);
      sendJSON(res, { provider: 'soda', error: err.message, songs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/soda/song/url') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('trackId') || url.searchParams.get('sodaId') || '';
      const quality = url.searchParams.get('quality') || '';
      const info = await handleSodaSongUrl(id, quality, playbackRequestOptionsFromSearchParams(url.searchParams));
      sendJSON(res, info);
    } catch (err) {
      console.error('[SodaSongUrl]', err);
      sendJSON(res, { provider: 'soda', url: '', playable: false, error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/soda/audio') {
    try {
      streamSodaDecodedAudio(req, res, url.searchParams.get('token') || '');
    } catch (err) {
      console.error('[SodaAudio]', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(err.message || 'Soda audio failed');
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  if (pn === '/api/soda/lyric') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('trackId') || url.searchParams.get('sodaId') || '';
      if (!id) { sendJSON(res, { provider: 'soda', error: 'Missing Soda track id', lyric: '' }, 400); return; }
      const data = await handleSodaLyric(id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[SodaLyric]', err);
      sendJSON(res, { provider: 'soda', error: err.message, lyric: '' }, 500);
    }
    return;
  }

  if (pn === '/api/soda/login/status') {
    try {
      const sync = url.searchParams.get('sync') === '1' || url.searchParams.get('sync') === 'true';
      const quick = url.searchParams.get('quick') === '1' || url.searchParams.get('quick') === 'true';
      const debug = url.searchParams.get('debug') === '1' || url.searchParams.get('debug') === 'true';
      if (sync) sodaAutoSyncEnabled = true;
      const info = appendSodaPlaybackStatus(await getSodaLoginInfo({ sync, skipLocalSync: quick }), { forceScan: sync });
      if (debug) info.debug = sodaLoginDebugSnapshot();
      sendJSON(res, info);
    } catch (err) {
      console.error('[SodaLoginStatus]', err);
      sendJSON(res, appendSodaPlaybackStatus({ provider: 'soda', loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', error: err.message }), 500);
    }
    return;
  }

  if (pn === '/api/soda/logout') {
    sodaAutoSyncEnabled = false;
    saveSodaCookie('');
    clearSodaRuntimeCaches({ removeStateFiles: true });
    sendJSON(res, { provider: 'soda', ok: true, loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' });
    return;
  }

  if (pn === '/api/soda/user/playlists') {
    try {
      const data = await handleSodaUserPlaylists();
      sendJSON(res, data);
    } catch (err) {
      console.error('[SodaUserPlaylists]', err);
      sendJSON(res, { provider: 'soda', loggedIn: false, error: err.message, playlists: [] }, 500);
    }
    return;
  }

  if (pn === '/api/soda/playlist/tracks') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('playlist_id') || '';
      const data = await handleSodaPlaylistTracks(id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[SodaPlaylistTracks]', err);
      sendJSON(res, { provider: 'soda', error: err.message, tracks: [] }, 500);
    }
    return;
  }

  if (pn === '/api/soda/song/like/check') {
    try {
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const data = await handleSodaSongLikeCheck(ids);
      sendJSON(res, data);
    } catch (err) {
      console.error('[SodaLikeCheck]', err);
      sendJSON(res, { provider: 'soda', loggedIn: err && err.statusCode !== 401, error: err.errorCode || err.message, message: err.message, liked: {} }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/soda/song/like') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const likeValue = body.like != null ? body.like : url.searchParams.get('like');
      const data = await handleSodaSongLike({
        id: body.id || url.searchParams.get('id'),
        sodaId: body.sodaId || url.searchParams.get('sodaId'),
        trackId: body.trackId || body.track_id || url.searchParams.get('trackId') || url.searchParams.get('track_id'),
      }, likeValue);
      sendJSON(res, data, data.success === false ? 409 : 200);
    } catch (err) {
      console.error('[SodaLike]', err);
      sendJSON(res, { provider: 'soda', loggedIn: err && err.statusCode !== 401, error: err.errorCode || err.message, message: err.message }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/soda/playlist/add-song') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid') || url.searchParams.get('playlist_id');
      const data = await handleSodaPlaylistAddSong(pid, {
        id: body.id || url.searchParams.get('id'),
        sodaId: body.sodaId || url.searchParams.get('sodaId'),
        trackId: body.trackId || body.track_id || url.searchParams.get('trackId') || url.searchParams.get('track_id'),
      });
      sendJSON(res, data, data.success === false ? 409 : 200);
    } catch (err) {
      console.error('[SodaPlaylistAddSong]', err);
      sendJSON(res, { provider: 'soda', loggedIn: err && err.statusCode !== 401, success: false, error: err.errorCode || err.message, message: err.message }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/qq/artist/detail') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('singermid') || '';
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '36', 10) || 36));
      if (!mid) {
        sendJSON(res, { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }, 400);
        return;
      }
      const data = await handleQQArtistDetail(mid, limit);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQArtistDetail]', err);
      sendJSON(res, { provider: 'qq', error: err.message, artist: null, songs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/song/comments') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const data = await handleQQSongComments(id, mid, limit, offset);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQSongComments]', err);
      sendJSON(res, { provider: 'qq', error: err.message, comments: [] }, 500);
    }
    return;
  }

  if (pn === '/api/qq/song/comment/like') {
    try {
      const session = requireQQLogin(res);
      if (!session) return;
      const body = await readRequestBody(req);
      const commentId = body.commentId || body.cid || url.searchParams.get('commentId') || url.searchParams.get('cid');
      const likeValue = body.like != null ? body.like : url.searchParams.get('like');
      const data = await handleQQSongCommentLike(commentId, likeValue);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQCommentLike]', err);
      sendJSON(res, {
        provider: 'qq',
        loggedIn: err && err.statusCode !== 401,
        error: err.errorCode || err.message,
        message: err.message || 'QQ 评论点赞同步失败',
        code: err.qqCode,
      }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/qq/song/comment/reply') {
    try {
      const session = requireQQLogin(res);
      if (!session) return;
      const body = await readRequestBody(req);
      const id = body.id || body.qqId || url.searchParams.get('id') || url.searchParams.get('qqId');
      const mid = body.mid || body.songmid || url.searchParams.get('mid') || url.searchParams.get('songmid');
      const commentId = body.commentId || body.cid || url.searchParams.get('commentId') || url.searchParams.get('cid');
      const content = body.content || url.searchParams.get('content');
      const data = await handleQQSongCommentReply(id, mid, commentId, content);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQCommentReply]', err);
      sendJSON(res, {
        provider: 'qq',
        loggedIn: err && err.statusCode !== 401,
        error: err.errorCode || err.message,
        message: err.message || 'QQ 评论回复同步失败',
        code: err.qqCode,
      }, err.statusCode || 500);
    }
    return;
  }

  if (pn === '/api/podcast/search') {
    try {
      const kw = String(url.searchParams.get('keywords') || '').trim();
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      if (!kw) { sendJSON(res, { podcasts: [] }); return; }
      const r = await cloudsearch({ keywords: kw, type: 1009, limit, cookie: userCookie, timestamp: Date.now() });
      const result = (r.body && r.body.result) || {};
      const raw = result.djRadios || result.djradios || result.radios || [];
      const podcasts = raw.map(mapPodcastRadio).filter(p => p.id);
      sendJSON(res, { podcasts, total: result.djRadiosCount || result.djradiosCount || podcasts.length });
    } catch (err) {
      console.error('[PodcastSearch]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/hot') {
    try {
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const r = await dj_hot({ limit, offset, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || {};
      const raw = body.djRadios || body.djradios || body.radios || body.data || [];
      const podcasts = (Array.isArray(raw) ? raw : []).map(mapPodcastRadio).filter(p => p.id);
      sendJSON(res, { podcasts, more: !!body.hasMore });
    } catch (err) {
      console.error('[PodcastHot]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/detail') {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid');
      if (!rid) { sendJSON(res, { error: 'Missing podcast id' }, 400); return; }
      const r = await dj_detail({ rid, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || {};
      const radio = mapPodcastRadio(body.data || body.djRadio || body.radio || body);
      sendJSON(res, { podcast: radio });
    } catch (err) {
      console.error('[PodcastDetail]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/programs') {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid');
      if (!rid) { sendJSON(res, { error: 'Missing podcast id', programs: [] }, 400); return; }
      const limit = Math.max(10, Math.min(60, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const r = await dj_program({ rid, limit, offset, asc: false, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || {};
      const raw = body.programs || (body.data && (body.data.list || body.data.programs)) || [];
      const radio = raw[0] && raw[0].radio ? mapPodcastRadio(raw[0].radio) : { id: rid, rid };
      const programs = (Array.isArray(raw) ? raw : [])
        .map(p => mapPodcastProgram(p, radio))
        .filter(p => p.id && p.name);
      sendJSON(res, { radio, programs, more: !!body.more, total: body.count || programs.length });
    } catch (err) {
      console.error('[PodcastPrograms]', err);
      sendJSON(res, { error: err.message, programs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/my') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) {
        const empty = ['collect', 'created', 'liked'].map(k => podcastCollectionMeta(k, []));
        sendJSON(res, { loggedIn: false, collections: empty });
        return;
      }
      const keys = ['collect', 'created', 'liked'];
      const collections = await Promise.all(keys.map(async key => {
        try {
          const data = await fetchMyPodcastItems(key, info, 12, 0);
          return podcastCollectionMeta(key, data.items || []);
        } catch (e) {
          console.warn('[MyPodcast]', key, e.message);
          return podcastCollectionMeta(key, []);
        }
      }));
      sendJSON(res, { loggedIn: true, collections });
    } catch (err) {
      console.error('[MyPodcast]', err);
      sendJSON(res, { error: err.message, collections: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/my/items') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, items: [] }); return; }
      const key = String(url.searchParams.get('key') || 'collect');
      const limit = parseInt(url.searchParams.get('limit') || '36', 10) || 36;
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      const data = await fetchMyPodcastItems(key, info, limit, offset);
      sendJSON(res, { loggedIn: true, key, ...podcastCollectionMeta(key, data.items || []), itemType: data.itemType, items: data.items || [] });
    } catch (err) {
      console.error('[MyPodcastItems]', err);
      sendJSON(res, { error: err.message, items: [] }, 500);
    }
    return;
  }

  if (pn === '/api/song/url') {
    try {
      const sid = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      const loginInfo = await getLoginInfo();
      const info = await handleSongUrl(sid, loginInfo, quality, playbackRequestOptionsFromSearchParams(url.searchParams));
      sendJSON(res, {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      });
    } catch (err) { console.error('[SongUrl]', err); sendJSON(res, { error: err.message }, 500); }
    return;
  }

  if (pn === '/api/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeCookieHeader(raw);
      const obj = parseCookieString(normalized);
      if (!obj.MUSIC_U) {
        sendJSON(res, { loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400);
        return;
      }
      saveCookie(normalized);
      let info = await getLoginInfo();
      if (!info.loggedIn && userCookie) {
        info = {
          loggedIn: true,
          pendingProfile: true,
          nickname: '网易云用户',
          avatar: '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
        };
      }
      sendJSON(res, { ...info, saved: true, hasCookie: !!userCookie });
    } catch (err) {
      console.error('[LoginCookie]', err);
      sendJSON(res, { loggedIn: false, error: err.message }, 500);
    }
    return;
  }

  // ---------- 登录: QR Key ----------
  // ---------- 播客 DJ 长音频后端离线锁拍 ----------
  if (pn === '/api/podcast/dj-beatmap') {
    try {
      const audioUrl = url.searchParams.get('url');
      const durationSec = Math.max(0, Number(url.searchParams.get('duration') || 0) || 0);
      if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
        sendJSON(res, { error: 'Invalid audio url' }, 400);
        return;
      }
      console.log('[PodcastDjBeatmap] start', Math.round(durationSec || 0) + 's');
      const started = Date.now();
      const introSec = Math.max(0, Number(url.searchParams.get('intro') || 0) || 0);
      const map = introSec
        ? await analyzePodcastDjIntro(audioUrl, { durationSec, introSec, userAgent: UA })
        : await analyzePodcastDjStream(audioUrl, { durationSec, userAgent: UA });
      console.log('[PodcastDjBeatmap] done beats:', map.visualBeatCount || 0, 'ms:', Date.now() - started, 'decode:', map.decode || {});
      sendJSON(res, { ok: true, map });
    } catch (err) {
      console.error('[PodcastDjBeatmap]', err);
      sendJSON(res, { ok: false, error: err.message || String(err) }, 500);
    }
    return;
  }

  if (pn === '/api/login/qr/key') {
    try {
      const r = await login_qr_key({ timestamp: Date.now() });
      const key = r.body && r.body.data && r.body.data.unikey;
      sendJSON(res, { key });
    } catch (err) { sendJSON(res, { error: err.message }, 500); }
    return;
  }

  // ---------- 登录: QR 二维码图片 ----------
  if (pn === '/api/login/qr/create') {
    try {
      const key = url.searchParams.get('key');
      const r = await login_qr_create({ key, qrimg: true, timestamp: Date.now() });
      const d = r.body && r.body.data;
      sendJSON(res, { img: d && d.qrimg, url: d && d.qrurl });
    } catch (err) { sendJSON(res, { error: err.message }, 500); }
    return;
  }

  // ---------- 登录: 轮询扫码状态 ----------
  if (pn === '/api/login/qr/check') {
    try {
      const key = url.searchParams.get('key');
      let r = await login_qr_check({ key, noCookie: true, timestamp: Date.now() });
      let body = r.body || {};
      let code = Number(body.code || r.code);
      let msg  = body.message || r.message || '';
      let cookie = readCookieFromResponse(r);
      if (code === 803 && !cookie) {
        try {
          const retry = await login_qr_check({ key, timestamp: Date.now() });
          const retryCookie = readCookieFromResponse(retry);
          if (retryCookie) {
            r = retry;
            body = retry.body || body;
            code = Number(body.code || retry.code || code);
            msg = body.message || retry.message || msg;
            cookie = retryCookie;
          }
        } catch (retryErr) {
          console.warn('[Login] qr cookie retry failed:', retryErr.message);
        }
      }
      // 803 = 授权成功, 802 = 已扫待确认, 801 = 等待扫码, 800 = 二维码过期
      if (code === 803) {
        if (cookie) saveCookie(cookie);
        let info = await getLoginInfo();
        if (!info.loggedIn) {
          const profile = body.profile || (body.data && body.data.profile) || {};
          info = normalizeLoginInfo(profile, body.account || (body.data && body.data.account), body.data || body);
        }
        if (!info.loggedIn && cookie) {
          info = {
            loggedIn: true,
            pendingProfile: true,
            nickname: (body.nickname || (body.profile && body.profile.nickname) || '网易云用户'),
            avatar: body.avatarUrl || (body.profile && body.profile.avatarUrl) || '',
            vipType: 0,
            vipLevel: 'none',
            isVip: false,
            isSvip: false,
            vipLabel: '无VIP',
          };
        }
        sendJSON(res, { code, message: msg, ...info, hasCookie: !!cookie });
        return;
      }
      sendJSON(res, { code, message: msg, nickname: body.nickname, avatar: body.avatarUrl });
    } catch (err) { sendJSON(res, { error: err.message }, 500); }
    return;
  }

  // ---------- 登录态查询 ----------
  if (pn === '/api/login/status') {
    const info = await getLoginInfo();
    sendJSON(res, info);
    return;
  }

  // ---------- 登出 ----------
  if (pn === '/api/logout') {
    try { await logout({ cookie: userCookie }); } catch (e) {}
    saveCookie('');
    sendJSON(res, { ok: true });
    return;
  }

  // ---------- 用户歌单 ----------
  if (pn === '/api/user/playlists') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, playlists: [] }); return; }
      const pageSize = 100;
      const raw = [];
      const seenIds = new Set();
      for (let offset = 0; offset < 5000; offset += pageSize) {
        const r = await user_playlist({ uid: info.userId, limit: pageSize, offset, cookie: userCookie, timestamp: Date.now() });
        const page = (r.body && r.body.playlist) || [];
        let added = 0;
        page.forEach(pl => {
          const key = String(pl && pl.id || '');
          if (key && seenIds.has(key)) return;
          if (key) seenIds.add(key);
          raw.push(pl);
          added += 1;
        });
        const total = Number(r.body && (r.body.total || r.body.more === false && raw.length) || 0);
        if (!page.length || !added || page.length < pageSize) break;
        if (total && raw.length >= total) break;
      }
      const list = raw.map(pl => ({
        id: pl.id,
        name: pl.name,
        cover: pl.coverImgUrl || '',
        trackCount: pl.trackCount || 0,
        playCount: pl.playCount || 0,
        creator: (pl.creator && pl.creator.nickname) || '',
        subscribed: !!pl.subscribed,
        specialType: pl.specialType || 0,
      }));
      sendJSON(res, { loggedIn: true, userId: info.userId, playlists: list });
    } catch (err) {
      console.error('[UserPlaylists]', err);
      sendJSON(res, { error: err.message, loggedIn: false, playlists: [] }, 500);
    }
    return;
  }

  // ---------- 红心状态 ----------
  if (pn === '/api/song/like/check') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (!ids.length) { sendJSON(res, { error: 'Missing song id', liked: {}, ids: [] }, 400); return; }
      let likedIds = [];
      try {
        if (typeof song_like_check === 'function') {
          const checked = await song_like_check({ ids: JSON.stringify(ids.map(Number).filter(Boolean)), cookie: userCookie, timestamp: Date.now() });
          const data = (checked.body && (checked.body.data || checked.body.ids)) || checked.body || {};
          if (Array.isArray(data)) likedIds = data.map(String);
          else if (data && typeof data === 'object') {
            ids.forEach(id => {
              if (data[id] || data[String(id)] || data[Number(id)]) likedIds.push(String(id));
            });
          }
        }
      } catch (e) {
        console.warn('[LikeCheck] direct check failed:', e.message);
      }
      if (!likedIds.length) {
        const r = await likelist({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
        likedIds = ((r.body && r.body.ids) || []).map(String);
      }
      const set = new Set(likedIds);
      const liked = {};
      ids.forEach(id => { liked[id] = set.has(String(id)); });
      sendJSON(res, { loggedIn: true, ids, liked });
    } catch (err) {
      console.error('[LikeCheck]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 红心/取消红心 ----------
  if (pn === '/api/song/like') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { error: 'Missing song id' }, 400); return; }
      const r = await like_song({ id, like: String(nextLike), cookie: userCookie, timestamp: Date.now() });
      const code = (r.body && r.body.code) || r.code || 200;
      sendJSON(res, { loggedIn: true, id, liked: nextLike, code, body: r.body || r });
    } catch (err) {
      console.error('[Like]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 创建歌单 ----------
  if (pn === '/api/playlist/create') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const name = String(body.name || url.searchParams.get('name') || '').trim();
      const privacy = String(body.privacy || url.searchParams.get('privacy') || '0');
      if (!name) { sendJSON(res, { error: 'Missing playlist name' }, 400); return; }
      const r = await playlist_create({ name, privacy, cookie: userCookie, timestamp: Date.now() });
      const created = (r.body && (r.body.playlist || r.body.data)) || {};
      sendJSON(res, { loggedIn: true, playlist: created, body: r.body || r });
    } catch (err) {
      console.error('[PlaylistCreate]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 收藏歌曲到歌单 ----------
  if (pn === '/api/playlist/add-song') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid');
      const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids');
      if (!pid || !id) { sendJSON(res, { error: 'Missing playlist id or song id' }, 400); return; }
      const attempts = [];
      let finalBody = null;
      let finalCode = 0;
      let finalMessage = '';
      let success = false;

      const primary = await playlist_tracks({ op: 'add', pid, tracks: String(id), cookie: userCookie, timestamp: Date.now() });
      finalBody = primary.body || primary;
      finalCode = normalizeApiCode(primary);
      finalMessage = normalizeApiMessage(primary);
      success = finalCode === 200 && !(finalBody && finalBody.error);
      attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody });

      if (!success && typeof playlist_track_add === 'function') {
        try {
          const fallback = await playlist_track_add({ pid, ids: String(id), cookie: userCookie, timestamp: Date.now() });
          finalBody = fallback.body || fallback;
          finalCode = normalizeApiCode(fallback);
          finalMessage = normalizeApiMessage(fallback);
          success = finalCode === 200 && !(finalBody && finalBody.error);
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody });
        } catch (fallbackErr) {
          const errBody = fallbackErr.body || fallbackErr.response || {};
          finalBody = errBody;
          finalCode = normalizeApiCode(errBody);
          finalMessage = normalizeApiMessage(errBody) || fallbackErr.message || '';
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody });
        }
      }

      if (!success && await isUserNeteaseLikedPlaylistId(pid, info)) {
        const likeId = String(id).split(',').map(s => s.trim()).filter(Boolean)[0];
        if (likeId) {
          const liked = await like_song({ id: likeId, like: 'true', cookie: userCookie, timestamp: Date.now() });
          finalBody = liked.body || liked;
          finalCode = normalizeApiCode(liked);
          finalMessage = normalizeApiMessage(liked);
          success = finalCode === 200 && !(finalBody && finalBody.error);
          attempts.push({ api: 'like_song', code: finalCode, message: finalMessage, body: finalBody });
          if (success) {
            sendJSON(res, { loggedIn: true, pid, id: likeId, success: true, likedFallback: true, verified: true, code: finalCode, body: finalBody, attempts });
            return;
          }
        }
      }

      if (!success) {
        sendJSON(res, { loggedIn: true, pid, id, success: false, code: finalCode, error: finalMessage || 'PLAYLIST_ADD_FAILED', attempts }, finalCode === 401 ? 401 : 409);
        return;
      }
      sendJSON(res, { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody, attempts });
    } catch (err) {
      console.error('[PlaylistAddSong]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 歌词 ----------
  if (pn === '/api/lyric') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing song id', lyric: '' }, 400); return; }
      let body = {};
      let source = 'lyric';
      try {
        if (typeof lyric_new === 'function') {
          const nr = await lyric_new({ id, cookie: userCookie, timestamp: Date.now() });
          body = nr.body || {};
          source = 'lyric_new';
        }
      } catch (errNew) {
        console.warn('[LyricNew]', errNew.message);
      }
      if (!((body.lrc && body.lrc.lyric) || (body.yrc && body.yrc.lyric))) {
        const r = await lyric({ id, cookie: userCookie, timestamp: Date.now() });
        body = r.body || body || {};
        source = 'lyric';
      }
      sendJSON(res, {
        lyric: (body.lrc && body.lrc.lyric) || '',
        tlyric: (body.tlyric && body.tlyric.lyric) || '',
        yrc: (body.yrc && body.yrc.lyric) || '',
        source,
      });
    } catch (err) {
      console.error('[Lyric]', err);
      sendJSON(res, { error: err.message, lyric: '' }, 500);
    }
    return;
  }

  // ---------- 歌曲评论 ----------
  if (pn === '/api/song/comments') {
    try {
      const id = url.searchParams.get('id');
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      if (!id) { sendJSON(res, { error: 'Missing song id', comments: [] }, 400); return; }
      const r = await comment_music({ id, limit, offset, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || r || {};
      const raw = body.hotComments && offset === 0 ? body.hotComments : (body.comments || []);
      const comments = (raw || []).map(c => ({
        id: c.commentId,
        content: c.content || '',
        likedCount: c.likedCount || 0,
        liked: !!c.liked,
        time: c.time || 0,
        user: c.user ? { id: c.user.userId, nickname: c.user.nickname || '', avatar: c.user.avatarUrl || '' } : null,
      })).filter(c => c.content);
      sendJSON(res, { id, total: body.total || 0, comments, hot: !!(body.hotComments && offset === 0), body });
    } catch (err) {
      console.error('[SongComments]', err);
      sendJSON(res, { error: err.message, comments: [] }, 500);
    }
    return;
  }

  if (pn === '/api/song/comment/reply') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const commentId = body.commentId || body.cid || url.searchParams.get('commentId') || url.searchParams.get('cid');
      const content = String(body.content || url.searchParams.get('content') || '').trim();
      if (!id) { sendJSON(res, { error: 'Missing song id' }, 400); return; }
      if (!commentId) { sendJSON(res, { error: 'Missing comment id' }, 400); return; }
      if (!content) { sendJSON(res, { error: 'Missing reply content' }, 400); return; }
      const r = await comment_action({
        t: 2,
        type: 0,
        id,
        commentId,
        content: content.slice(0, 140),
        cookie: userCookie,
        timestamp: Date.now(),
      });
      const code = normalizeApiCode(r) || 200;
      sendJSON(res, { provider: 'netease', loggedIn: true, id, commentId, code, body: r.body || r });
    } catch (err) {
      console.error('[SongCommentReply]', err);
      sendJSON(res, { provider: 'netease', error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/song/comment/like') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const commentId = body.commentId || body.cid || url.searchParams.get('commentId') || url.searchParams.get('cid');
      const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { error: 'Missing song id' }, 400); return; }
      if (!commentId) { sendJSON(res, { error: 'Missing comment id' }, 400); return; }
      const r = await comment_like({
        t: nextLike ? 1 : 0,
        type: 0,
        id,
        cid: commentId,
        cookie: userCookie,
        timestamp: Date.now(),
      });
      const code = normalizeApiCode(r) || 200;
      sendJSON(res, { provider: 'netease', loggedIn: true, id, commentId, liked: nextLike, code, body: r.body || r });
    } catch (err) {
      console.error('[SongCommentLike]', err);
      sendJSON(res, { provider: 'netease', error: err.message }, 500);
    }
    return;
  }

  // ---------- 歌手主页 / 热门歌曲 ----------
  if (pn === '/api/artist/detail') {
    try {
      const id = url.searchParams.get('id');
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      if (!id) { sendJSON(res, { error: 'Missing artist id', songs: [] }, 400); return; }
      let detailBody = {};
      try {
        const detail = await artist_detail({ id, cookie: userCookie, timestamp: Date.now() });
        detailBody = detail.body || detail || {};
      } catch (e) {
        console.warn('[ArtistDetail] detail failed:', e.message);
      }
      let rawSongs = [];
      try {
        const list = await artist_songs({ id, order: 'hot', limit, offset: 0, cookie: userCookie, timestamp: Date.now() });
        const b = list.body || list || {};
        rawSongs = (b.songs || (b.data && b.data.songs) || []);
      } catch (e) {
        console.warn('[ArtistSongs] hot failed:', e.message);
      }
      if (!rawSongs.length) {
        const top = await artist_top_song({ id, cookie: userCookie, timestamp: Date.now() });
        const b = top.body || top || {};
        rawSongs = b.songs || [];
      }
      const artist = detailBody.artist || (detailBody.data && (detailBody.data.artist || detailBody.data)) || {};
      const songs = rawSongs.map(mapSongRecord).filter(s => s.id).slice(0, limit);
      sendJSON(res, {
        id,
        artist: {
          id: artist.id || id,
          name: artist.name || artist.artistName || '',
          avatar: artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url || '',
          brief: artist.briefDesc || artist.description || artist.desc || '',
          musicSize: artist.musicSize || artist.songSize || 0,
          albumSize: artist.albumSize || 0,
        },
        songs,
        body: detailBody,
      });
    } catch (err) {
      console.error('[ArtistDetail]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
    return;
  }

  // ---------- 歌单曲目详情 ----------
  if (pn === '/api/playlist/tracks') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing playlist id', tracks: [] }, 400); return; }

      let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
      let rawTracks = [];
      let detailTracks = [];
      if (typeof playlist_detail === 'function') {
        const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
        const pl = (detail.body && detail.body.playlist) || {};
        playlistMeta = { id: pl.id || id, name: pl.name || '', cover: pl.coverImgUrl || '', trackCount: pl.trackCount || 0 };
        detailTracks = pl.tracks || [];
      }

      // 新版本 NeteaseCloudMusicApi 通常提供 playlist_track_all；旧版本退回 playlist_detail。
      if (typeof playlist_track_all === 'function') {
        try {
          const pageSize = 1000;
          const seenTrackIds = new Set();
          let offset = 0;
          while (true) {
            const all = await playlist_track_all({ id, limit: pageSize, offset, cookie: userCookie, timestamp: Date.now() });
            const pageTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
            let added = 0;
            pageTracks.forEach(track => {
              const key = String(track && (track.id || track.songId || track.songid) || '');
              if (key && seenTrackIds.has(key)) return;
              if (key) seenTrackIds.add(key);
              rawTracks.push(track);
              added += 1;
            });
            if (!pageTracks.length || !added || pageTracks.length < pageSize) break;
            if (playlistMeta.trackCount && rawTracks.length >= playlistMeta.trackCount) break;
            offset += pageTracks.length;
          }
        } catch (err) {
          console.warn('[PlaylistTracks] playlist_track_all failed, fallback to detail:', err.message);
        }
      }

      if (!rawTracks.length) rawTracks = detailTracks;

      const tracks = rawTracks.map(mapSongRecord).filter(t => t.id);

      if (!playlistMeta.trackCount) playlistMeta.trackCount = tracks.length;
      sendJSON(res, { playlist: playlistMeta, tracks });
    } catch (err) {
      console.error('[PlaylistTracks]', err);
      sendJSON(res, { error: err.message, tracks: [] }, 500);
    }
    return;
  }

  // ---------- 封面代理 (带 CORS 头, 给 canvas 提取像素用) ----------
  if (pn === '/api/cover') {
    try {
      const coverUrl = url.searchParams.get('url');
      // URL 校验: 必须是 http(s) 开头, 否则直接 404 (不要让 fetch 抛错)
      if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Invalid cover url');
        return;
      }
      const resp = await fetch(coverUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } });
      const ct  = resp.headers.get('content-type') || 'image/jpeg';
      const cl  = resp.headers.get('content-length');
      const hdr = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      };
      if (cl) hdr['Content-Length'] = cl;
      res.writeHead(resp.status, hdr);
      const reader = resp.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) { console.error('[Cover]', err); res.writeHead(500); res.end(); }
    return;
  }

  // ---------- 音频代理 (支持 Range) ----------
  if (pn === '/api/audio') {
    try {
      const audioUrl = url.searchParams.get('url');
      if (!audioUrl) { res.writeHead(400); res.end('Missing url'); return; }
      const range = req.headers.range || '';
      const hdr = audioProxyHeadersFor(audioUrl, range);
      const up = await fetch(audioUrl, { headers: hdr });
      const out = {
        'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
      const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
      res.writeHead(up.status, out);
      const reader = up.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) { console.error('[Audio]', err); res.writeHead(500); res.end(); }
    return;
  }

  // ---------- 下载 API ----------
  if (pn === '/api/download/start') {
    try {
      if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
      const body = await readRequestBody(req);
      const song = {
        id: body.id || '',
        sodaId: body.sodaId || body.id || '',
        mid: body.mid || '',
        songmid: body.songmid || '',
        mediaMid: body.mediaMid || '',
        name: body.name || 'Unknown',
        artist: body.artist || 'Unknown',
        album: body.album || '',
        coverUrl: body.coverUrl || body.cover || '',
        lyricUrl: body.lyricUrl || '',
      };
      const format = body.format || 'auto';
      const quality = body.quality || 'best';
      const source = body.source || (song.sodaId ? 'soda' : (song.mid ? 'qq' : 'netease'));
      const result = downloadManager.startDownload(song, { format, quality, source });
      sendJSON(res, result);
    } catch (err) { console.error('[DownloadStart]', err); sendJSON(res, { error: err.message }, 500); }
    return;
  }

  if (pn === '/api/download/status') {
    try {
      const jobId = url.searchParams.get('id') || '';
      if (!jobId) { sendJSON(res, { error: 'Missing id' }, 400); return; }
      const status = downloadManager.getJobStatus(jobId);
      if (!status) { sendJSON(res, { error: 'Job not found' }, 404); return; }
      sendJSON(res, status);
    } catch (err) { console.error('[DownloadStatus]', err); sendJSON(res, { error: err.message }, 500); }
    return;
  }

  if (pn === '/api/download/cancel') {
    try {
      if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
      const body = await readRequestBody(req);
      const jobId = body.jobId || '';
      if (!jobId) { sendJSON(res, { error: 'Missing jobId' }, 400); return; }
      const ok = downloadManager.cancelDownload(jobId);
      sendJSON(res, { success: ok });
    } catch (err) { console.error('[DownloadCancel]', err); sendJSON(res, { error: err.message }, 500); }
    return;
  }

  if (pn === '/api/download/file') {
    try {
      const jobId = url.searchParams.get('id') || '';
      if (!jobId) { res.writeHead(400); res.end('Missing id'); return; }
      const filePath = downloadManager.getFilePath(jobId);
      if (!filePath) { res.writeHead(404); res.end('File not found'); return; }
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('File missing on disk'); return; }
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.flac' ? 'audio/flac' : 'audio/mpeg';
      const fileName = path.basename(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fileName) + '"',
        'Access-Control-Allow-Origin': '*',
      });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    } catch (err) { console.error('[DownloadFile]', err); res.writeHead(500); res.end(); }
    return;
  }

  if (pn === '/api/download/list') {
    try {
      const jobs = downloadManager.getAllJobs();
      sendJSON(res, { jobs });
    } catch (err) { console.error('[DownloadList]', err); sendJSON(res, { error: err.message }, 500); }
    return;
  }

  // ---------- 静态资源 ----------
  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  serveStatic(res, resolveStaticFile(__dirname, pn));
});

server.listen(PORT, HOST, () => {
  console.log('======================================================');
  console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
  console.log(' 登录态: ' + (userCookie ? '已登录(cookie已加载)' : '未登录'));
  console.log('======================================================');
});

module.exports = server;
