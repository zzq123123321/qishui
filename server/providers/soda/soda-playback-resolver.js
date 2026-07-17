'use strict';

let apiRequestFn = null;
let requestJsonFn = null;
let getUserAgentFn = null;
let debugDumpFn = null;
let freeBenefitSummaryFn = null;
let needsClientSignatureFn = null;
let playbackFeeFromBodyFn = null;
let apiErrorMessageFn = null;
let expectedDurationMsFn = null;
let resolvedQualityLevelFn = null;
let normalizeQualityPrefFn = null;
let limitedFreeParamFn = null;
let getLoginInfoFn = null;
let probeSodaMediaDurationMsFn = null;

function sodaPathLooksPreview(pathParts) {
  const pathText = (pathParts || []).join('.').toLowerCase();
  if (/limited_free|limitedfree/.test(pathText)) {
    const cleaned = pathText.replace(/limited_free|limitedfree/g, '');
    return /preview|audition|trial|try_|free_trial|freetrial|sample/.test(cleaned);
  }
  return /preview|audition|trial|try_|free_trial|freetrial|limited_free|limitedfree|sample|试听|試聽/.test(pathText);
}

function sodaUrlLooksNonAudioAsset(url, pathParts) {
  const pathText = (pathParts || []).join('.').toLowerCase();
  const lower = String(url || '').toLowerCase();
  return /cover|avatar|image|img|poster|background|bg|pic|thumbnail|thumb|sprite|banner|icon|lyric|json|url_player_info|urlplayerinfo/.test(pathText)
    || /\.(jpg|jpeg|png|webp|gif|bmp|svg|json|lrc)(?:[?#]|$)/i.test(lower)
    || /image\/|mime_type=image|mime=image|format=image/.test(lower);
}

function sodaUrlLooksPlayableAudio(url, pathParts) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  if (sodaUrlLooksNonAudioAsset(raw, pathParts)) return false;
  if (/\.(m4a|mp3|flac|aac|ogg|wav|mp4)(?:[?#]|$)/i.test(raw)) return true;
  const pathText = (pathParts || []).join('.').toLowerCase();
  if (/main[_-]?play[_-]?url|backup[_-]?play[_-]?url|play[_-]?url|main[_-]?url|backup[_-]?url|playurl|mainurl|backupurl/.test(pathText)) return true;
  let decoded = raw.toLowerCase();
  try { decoded = decodeURIComponent(decoded); } catch (e) {}
  if (/mime[_-]?type=audio|mime=audio|audio\/|format=(m4a|mp3|flac|aac|ogg|mp4)|codec=(aac|mp3|flac)|music|audio|tos-|byte|play/.test(decoded)) return true;
  return false;
}

function findSodaMediaUrl(value, depth, pathParts, opts) {
  opts = opts || {};
  pathParts = pathParts || [];
  if (!value || depth > 6) return '';
  if (typeof value === 'string') {
    if (opts.excludePreview !== false && sodaPathLooksPreview(pathParts)) return '';
    if (sodaUrlLooksPlayableAudio(value, pathParts)) return value;
    return '';
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findSodaMediaUrl(value[i], depth + 1, pathParts.concat('[' + i + ']'), opts);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const priorityKeys = ['play_url', 'playUrl', 'PlayUrl', 'main_url', 'mainUrl', 'MainUrl', 'MainPlayUrl', 'backup_url', 'backupUrl', 'BackupPlayUrl', 'url', 'Url', 'URL'];
  for (const key of priorityKeys) {
    const found = findSodaMediaUrl(value[key], depth + 1, pathParts.concat(key), opts);
    if (found) return found;
  }
  for (const key of Object.keys(value)) {
    const found = findSodaMediaUrl(value[key], depth + 1, pathParts.concat(key), opts);
    if (found) return found;
  }
  return '';
}

function parseSodaJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch (e) { return null; }
}

function sodaQualityScore(quality, requested) {
  const q = String(quality || '').toLowerCase();
  const wanted = String(requested || '').toLowerCase();
  const rank = {
    jymaster: 80,
    master: 78,
    hires: 70,
    lossless: 60,
    sq: 58,
    highest: 48,
    exhigh: 45,
    high: 40,
    higher: 36,
    medium: 24,
    standard: 20,
    low: 10,
  };
  let score = rank[q] || 0;
  if (wanted && q === wanted) score += 1000;
  if (wanted === 'jymaster' && /master|jymaster/.test(q)) score += 500;
  if (wanted === 'hires' && /hi-?res|hires/.test(q)) score += 500;
  if (wanted === 'lossless' && /lossless|sq/.test(q)) score += 500;
  return score;
}

function sodaMediaItemDurationMs(item) {
  item = item || {};
  const meta = item.video_meta || item.videoMeta || {};
  const raw = Number(item.Duration || item.duration || item.duration_ms || item.durationMs || meta.Duration || meta.duration || meta.duration_ms || meta.durationMs || 0) || 0;
  if (!raw) return 0;
  return raw > 10000 ? raw : raw * 1000;
}

function sodaMediaItemLooksPreview(item, expectedDurationMs) {
  item = item || {};
  const durationMs = sodaMediaItemDurationMs(item);
  const text = JSON.stringify({
    format: item.format,
    Format: item.Format,
    quality: item.quality || item.Quality,
    definition: item.definition || item.Definition,
    tag: item.tag || item.Tag,
    type: item.type || item.Type,
    video_meta: item.video_meta || item.videoMeta,
  }).toLowerCase();
  if (/limited_free|limitedfree/.test(text)) {
    const cleaned = text.replace(/limited_free|limitedfree/g, '');
    if (!/preview|audition|trial|try_|free_trial|freetrial|sample/.test(cleaned)) {
      return expectedDurationMs > 90000 && durationMs > 0 && durationMs < Math.min(70000, expectedDurationMs * 0.7);
    }
  }
  if (/preview|audition|trial|try_|free_trial|freetrial|limited_free|limitedfree|sample|试听|試聽/.test(text)) return true;
  if (expectedDurationMs > 90000 && durationMs > 0 && durationMs < Math.min(70000, expectedDurationMs * 0.7)) return true;
  return false;
}

function sodaMediaDurationIsTooShort(actualMs, expectedDurationMs) {
  actualMs = Number(actualMs || 0) || 0;
  expectedDurationMs = Number(expectedDurationMs || 0) || 0;
  if (expectedDurationMs <= 90000 || actualMs <= 0) return false;
  return actualMs < Math.min(70000, expectedDurationMs * 0.7);
}

function sodaVideoItemCandidates(videoList, qualityPreference, expectedDurationMs) {
  expectedDurationMs = Number(expectedDurationMs || 0) || 0;
  return (Array.isArray(videoList) ? videoList : [])
    .filter(item => item && sodaMediaInfoFromItem(item))
    .filter(item => !sodaMediaItemLooksPreview(item, expectedDurationMs))
    .map(item => {
      const meta = item.video_meta || item.videoMeta || {};
      const quality = item.Quality || item.quality || meta.quality || '';
      const bitrate = Number(item.Bitrate || item.bitrate || meta.bitrate || 0) || 0;
      const durationMs = sodaMediaItemDurationMs(item);
      let score = sodaQualityScore(quality, qualityPreference) + Math.min(999, Math.floor(bitrate / 1000));
      if (expectedDurationMs > 90000 && durationMs > 0) {
        if (sodaMediaDurationIsTooShort(durationMs, expectedDurationMs)) score -= 10000;
        else score += Math.min(3000, Math.floor(durationMs / 1000));
      }
      return { item, quality, bitrate, durationMs, score };
    })
    .sort((a, b) => b.score - a.score);
}

function pickSodaMediaUrlFromKeys(item, keys) {
  item = item || {};
  for (const key of keys) {
    const value = item[key];
    const found = findSodaMediaUrl(value, 0, [key], { excludePreview: true });
    if (found) return found;
  }
  return '';
}

function sodaMediaInfoFromItem(item) {
  if (!item) return null;
  const meta = item.video_meta || item.videoMeta || {};
  const encryptInfo = item.encrypt_info || item.encryptInfo || item.EncryptInfo || {};
  const url = pickSodaMediaUrlFromKeys(item, [
    'main_url', 'mainUrl', 'MainUrl', 'MainPlayUrl', 'main_play_url', 'mainPlayUrl',
    'play_url', 'playUrl', 'PlayUrl', 'url', 'Url', 'URL',
    'backup_url', 'backupUrl', 'BackupUrl', 'BackupPlayUrl', 'backup_play_url', 'backupPlayUrl',
  ]) || findSodaMediaUrl(item, 0, [], { excludePreview: true });
  if (!url) return null;
  const backupUrl = pickSodaMediaUrlFromKeys(item, ['backup_url', 'backupUrl', 'BackupUrl', 'BackupPlayUrl', 'backup_play_url', 'backupPlayUrl']);
  return {
    url,
    backupUrl,
    spade: encryptInfo.spade_a || encryptInfo.spadeA || item.PlayAuth || item.playAuth || item.play_auth || '',
    quality: item.Quality || item.quality || meta.quality || '',
    bitrate: Number(item.Bitrate || item.bitrate || meta.bitrate || 0) || 0,
    durationMs: sodaMediaItemDurationMs(item),
  };
}

function findSodaObjectWithAnyKey(value, keys, depth) {
  if (!value || depth > 6 || typeof value !== 'object') return null;
  if (!Array.isArray(value) && keys.some(key => value[key] !== undefined && value[key] !== null)) return value;
  const list = Array.isArray(value) ? value : Object.keys(value).map(key => value[key]);
  for (const item of list) {
    const found = findSodaObjectWithAnyKey(item, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function sodaPlayerCandidates(body) {
  const data = body && body.data && typeof body.data === 'object' ? body.data : {};
  const candidates = [
    body && body.track_player,
    body && body.player_info,
    body && body.trackPlayer,
    data.track_player,
    data.player_info,
    data.trackPlayer,
    findSodaObjectWithAnyKey(body, ['video_model', 'videoModel', 'url_player_info', 'urlPlayerInfo', 'video_list', 'videoList', 'VideoList', 'PlayInfoList'], 0),
  ];
  const seen = new Set();
  return candidates.filter(item => {
    if (!item || typeof item !== 'object') return false;
    const key = JSON.stringify(Object.keys(item).slice(0, 20));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sodaBodyHasOnlyPreviewMedia(body) {
  if (!body) return false;
  const anyMedia = findSodaMediaUrl(body, 0, [], { excludePreview: false });
  if (!anyMedia) return false;
  const fullMedia = findSodaMediaUrl(body, 0, [], { excludePreview: true });
  return !fullMedia;
}

async function sodaMediaCandidateIsUsable(media, expectedDurationMs, label) {
  if (!media || !media.url) return false;
  if (sodaMediaDurationIsTooShort(media.durationMs, expectedDurationMs)) {
    console.warn('[SodaPlayback] rejected short media metadata:', label || '', Math.round(media.durationMs / 1000) + 's', 'expected', Math.round(expectedDurationMs / 1000) + 's');
    return false;
  }
  if (expectedDurationMs > 90000 && !media.durationMs) {
    const probedMs = await probeSodaMediaDurationMsFn(media, 6500);
    if (probedMs) media.durationMs = probedMs;
    if (sodaMediaDurationIsTooShort(probedMs, expectedDurationMs)) {
      console.warn('[SodaPlayback] rejected short media probe:', label || '', Math.round(probedMs / 1000) + 's', 'expected', Math.round(expectedDurationMs / 1000) + 's');
      return false;
    }
  }
  return true;
}

async function sodaMediaInfoFromVideoList(videoList, qualityPreference, expectedDurationMs, label) {
  const candidates = sodaVideoItemCandidates(videoList, qualityPreference, expectedDurationMs).slice(0, 8);
  for (const candidate of candidates) {
    const media = sodaMediaInfoFromItem(candidate.item);
    if (await sodaMediaCandidateIsUsable(media, expectedDurationMs, (label || 'video_list') + ':' + (candidate.quality || media && media.quality || ''))) return media;
  }
  return null;
}

async function sodaMediaInfoFromVideoModel(videoModel, qualityPreference, expectedDurationMs) {
  const model = parseSodaJsonMaybe(videoModel);
  const videoList = model && (model.video_list || model.videoList || model.VideoList || model.play_info_list || model.PlayInfoList);
  return sodaMediaInfoFromVideoList(videoList, qualityPreference, expectedDurationMs, 'video_model');
}

async function sodaMediaInfoFromPlayerInfoUrl(url, qualityPreference, expectedDurationMs) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return null;
  const data = await requestJsonFn(target, {
    headers: {
      accept: 'application/json',
      'user-agent': getUserAgentFn ? getUserAgentFn() : '',
    },
  });
  const playInfoList = data && data.Result && data.Result.Data && data.Result.Data.PlayInfoList;
  const candidates = sodaVideoItemCandidates(playInfoList, qualityPreference, expectedDurationMs).slice(0, 8);
  for (const candidate of candidates) {
    const media = sodaMediaInfoFromItem(candidate.item);
    if (await sodaMediaCandidateIsUsable(media, expectedDurationMs, 'player_info:' + (candidate.quality || media && media.quality || ''))) return media;
  }
  return null;
}

async function resolveSodaMediaInfo(body, qualityPreference, options) {
  const expectedDurationMs = expectedDurationMsFn ? expectedDurationMsFn(body, options) : 0;
  const players = sodaPlayerCandidates(body);
  for (const player of players) {
    const direct = await sodaMediaInfoFromVideoModel(player.video_model || player.videoModel, qualityPreference, expectedDurationMs);
    if (direct) return direct;
    const listDirect = await sodaMediaInfoFromVideoList(player.video_list || player.videoList || player.VideoList || player.PlayInfoList || player.play_info_list, qualityPreference, expectedDurationMs, 'player_list');
    if (listDirect) return listDirect;
    if (player.url_player_info || player.urlPlayerInfo) {
      try {
        const fallback = await sodaMediaInfoFromPlayerInfoUrl(player.url_player_info || player.urlPlayerInfo, qualityPreference, expectedDurationMs);
        if (fallback) return fallback;
      } catch (e) {}
    }
  }
  const fallbackUrl = findSodaMediaUrl(body, 0, [], { excludePreview: true });
  if (!fallbackUrl) return null;
  const fallbackMedia = { url: fallbackUrl, backupUrl: '', spade: '', quality: '', bitrate: 0, durationMs: 0 };
  return await sodaMediaCandidateIsUsable(fallbackMedia, expectedDurationMs, 'fallback') ? fallbackMedia : null;
}

function sodaTrackV2Body(trackId, options, overrides) {
  options = options || {};
  overrides = overrides || {};
  const vid = String(options.sodaVid || options.vid || options.videoId || options.video_id || '').trim();
  const body = {
    track_id: String(trackId || ''),
    media_type: 'track',
    queue_type: '',
    enable_refresh_api: true,
    scene_name: '',
    play_count: {},
  };
  if (vid) {
    body.vid = vid;
    body.video_id = vid;
  }
  return { ...body, ...overrides };
}

function sodaApiQualityCandidates(qualityPreference) {
  const requested = normalizeQualityPrefFn ? normalizeQualityPrefFn(qualityPreference || 'hires') : (qualityPreference || 'hires');
  const loginInfo = getLoginInfoFn ? getLoginInfoFn() : {};
  const canUseLossless = !!(loginInfo && (loginInfo.isVip || loginInfo.isSvip || loginInfo.vipLevel === 'vip' || loginInfo.vipLevel === 'svip'));
  const order = [];
  function add(value) {
    if (value && !order.includes(value)) order.push(value);
  }
  if (canUseLossless && (requested === 'jymaster' || requested === 'hires' || requested === 'lossless')) add('lossless');
  if (requested === 'lossless' && canUseLossless) add('lossless');
  if (requested === 'standard') {
    add('higher');
    add('medium');
  } else {
    add('highest');
    add('higher');
    add('medium');
  }
  if (!canUseLossless && requested === 'lossless') add('lossless');
  return order;
}

function sodaTrackV2Attempts(trackId, options) {
  options = options || {};
  const qualities = sodaApiQualityCandidates(options.qualityPreference || options.quality || 'hires');
  const signedLimitedFreeParam = limitedFreeParamFn ? limitedFreeParamFn(options.limitedFreeInfo || options.limitedFreeParam) : null;
  const unsignedLimitedFreeParam = limitedFreeParamFn ? limitedFreeParamFn(null, { allowUnsignedFallback: true }) : null;
  const bodies = [];
  qualities.forEach((apiQuality, index) => {
    if (signedLimitedFreeParam) {
      bodies.push(sodaTrackV2Body(trackId, options, { audio_quality: apiQuality, quality: apiQuality, limited_free_param: signedLimitedFreeParam }));
    }
    bodies.push(sodaTrackV2Body(trackId, options, { audio_quality: apiQuality, quality: apiQuality }));
    if (!signedLimitedFreeParam) {
      bodies.push(sodaTrackV2Body(trackId, options, { audio_quality: apiQuality, quality: apiQuality, limited_free_param: unsignedLimitedFreeParam }));
    }
    if (index === 0) {
      if (signedLimitedFreeParam) {
        bodies.push(sodaTrackV2Body(trackId, options, { scene_name: 'search', queue_type: 'search', audio_quality: apiQuality, quality: apiQuality, limited_free_param: signedLimitedFreeParam }));
        bodies.push(sodaTrackV2Body(trackId, options, { need_play_url: true, with_play_url: true, need_video_model: true, need_player_info: true, audio_quality: apiQuality, quality: apiQuality, limited_free_param: signedLimitedFreeParam }));
      }
      bodies.push(sodaTrackV2Body(trackId, options, { scene_name: 'search', queue_type: 'search', audio_quality: apiQuality, quality: apiQuality }));
      bodies.push(sodaTrackV2Body(trackId, options, { scene_name: 'single', queue_type: 'single', audio_quality: apiQuality, quality: apiQuality }));
      bodies.push(sodaTrackV2Body(trackId, options, { scene_name: 'playlist', queue_type: 'playlist', audio_quality: apiQuality, quality: apiQuality }));
      bodies.push(sodaTrackV2Body(trackId, options, { need_play_url: true, with_play_url: true, need_video_model: true, need_player_info: true, audio_quality: apiQuality, quality: apiQuality }));
      if (!signedLimitedFreeParam) {
        bodies.push(sodaTrackV2Body(trackId, options, { scene_name: 'search', queue_type: 'search', audio_quality: apiQuality, quality: apiQuality, limited_free_param: unsignedLimitedFreeParam }));
        bodies.push(sodaTrackV2Body(trackId, options, { need_play_url: true, with_play_url: true, need_video_model: true, need_player_info: true, audio_quality: apiQuality, quality: apiQuality, limited_free_param: unsignedLimitedFreeParam }));
      }
    }
  });
  const paths = ['/luna/pc/track_v2', '/luna/pc/track_v2/', '/luna/track_v2/', '/luna/h5/track_v2/'];
  const attempts = [];
  paths.forEach((apiPath, pathIndex) => {
    bodies.forEach((body, bodyIndex) => {
      if (pathIndex > 0 && bodyIndex > 1) return;
      attempts.push({ path: apiPath, body });
    });
  });
  const seen = new Set();
  return attempts.filter(attempt => {
    const key = attempt.path + '|' + JSON.stringify(attempt.body);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
}

async function tryResolveSodaTrackV2(trackId, qualityPreference, options) {
  options = { ...(options || {}), qualityPreference };
  const attempts = sodaTrackV2Attempts(trackId, options);
  let bestBody = {};
  let bestBenefit = { hasFreeBenefit: false, freeBenefitLabel: '', freeBenefitExpiresAt: 0, freeBenefitSource: '' };
  let needsSignature = false;
  let onlyPreview = false;
  let fee = 0;
  let lastError = null;
  let skippedEncryptedMedia = false;
  for (const attempt of attempts) {
    let body = {};
    try {
      body = await apiRequestFn(attempt.path, {}, { method: 'POST', body: attempt.body, syncCookie: false });
    } catch (e) {
      lastError = e;
      if (debugDumpFn) debugDumpFn('track_v2_error', { attempt, error: e && e.message || String(e) });
      continue;
    }
    bestBody = body || bestBody;
    const bodyBenefit = freeBenefitSummaryFn ? freeBenefitSummaryFn([body]) : { hasFreeBenefit: false };
    if (bodyBenefit.hasFreeBenefit) bestBenefit = bodyBenefit;
    if (needsClientSignatureFn && needsClientSignatureFn(body)) needsSignature = true;
    if (sodaBodyHasOnlyPreviewMedia(body)) onlyPreview = true;
    fee = Math.max(fee, playbackFeeFromBodyFn ? playbackFeeFromBodyFn(body) : 0);
    const media = await resolveSodaMediaInfo(body, qualityPreference, options);
    if (debugDumpFn) {
      debugDumpFn('track_v2_attempt', {
        attempt,
        statusCode: Number(body && (body.status_code || body.statusCode || body.code || body.status) || 0),
        message: apiErrorMessageFn ? apiErrorMessageFn(body, '') : '',
        topKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 32) : [],
        body,
        media: media ? { ...media, url: '[detected]', backupUrl: media.backupUrl ? '[detected]' : '' } : null,
        bodyBenefit,
      });
    }
    if (media && media.url) {
      if (options.skipEncryptedMedia && media.spade) {
        skippedEncryptedMedia = true;
        continue;
      }
      return { body, media, bodyBenefit, needsSignature, onlyPreview, fee, attempt, lastError, skippedEncryptedMedia };
    }
  }
  return { body: bestBody, media: null, bodyBenefit: bestBenefit, needsSignature, onlyPreview, fee, attempt: null, lastError, skippedEncryptedMedia };
}

function setup(deps) {
  apiRequestFn = deps.apiRequest;
  requestJsonFn = deps.requestJson;
  getUserAgentFn = deps.getUserAgent;
  debugDumpFn = deps.debugDump;
  freeBenefitSummaryFn = deps.freeBenefitSummary;
  needsClientSignatureFn = deps.needsClientSignature;
  playbackFeeFromBodyFn = deps.playbackFeeFromBody;
  apiErrorMessageFn = deps.apiErrorMessage;
  expectedDurationMsFn = deps.expectedDurationMs;
  resolvedQualityLevelFn = deps.resolvedQualityLevel;
  normalizeQualityPrefFn = deps.normalizeQualityPreference;
  limitedFreeParamFn = deps.limitedFreeParam;
  getLoginInfoFn = deps.getLoginInfo;
  probeSodaMediaDurationMsFn = deps.probeSodaMediaDurationMs;
}

module.exports = {
  setup,
  sodaTrackV2Body,
  sodaTrackV2Attempts,
  tryResolveSodaTrackV2,
  resolveSodaMediaInfo,
  sodaMediaDurationIsTooShort,
  findSodaObjectWithAnyKey,
  sodaMediaCandidateIsUsable,
  sodaMediaInfoFromItem,
  sodaMediaInfoFromVideoList,
  sodaMediaInfoFromVideoModel,
  sodaMediaInfoFromPlayerInfoUrl,
  sodaPlayerCandidates,
  sodaVideoItemCandidates,
  sodaBodyHasOnlyPreviewMedia,
  findSodaMediaUrl,
  sodaMediaItemDurationMs,
  sodaMediaItemLooksPreview,
  sodaPathLooksPreview,
  sodaUrlLooksPlayableAudio,
  sodaUrlLooksNonAudioAsset,
  parseSodaJsonMaybe,
  sodaQualityScore,
  pickSodaMediaUrlFromKeys,
};
