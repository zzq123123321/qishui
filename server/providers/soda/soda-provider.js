'use strict';

let refreshCookieFn = null;
let ensureSignatureFn = null;
let getSodaLimitedFreeInfoFn = null;
let trySodaMCheckMediaFn = null;
let tryResolveSodaTrackV2Fn = null;
let tryResolveUnencryptedFallbackFn = null;
let playbackNativeStatusFn = null;
let normalizeLimitedFreeInfoFn = null;
let cachedLimitedFreeInfoFn = null;
let debugDumpFn = null;

async function resolvePlayback(id, qualityPreference, options) {
  options = options || {};
  const trackId = String(id || '').trim();
  if (!trackId) return { resolved: null, body: {}, playbackLimitedFreeInfo: null, signatureRetried: false, limitedFreeSynced: false, error: 'MISSING_ID' };

  let body = {};
  let signatureRetried = false;
  let limitedFreeSynced = false;
  let playbackLimitedFreeInfo = normalizeLimitedFreeInfoFn ? normalizeLimitedFreeInfoFn(options.limitedFreeInfo || options.limitedFreeParam) : null;
  if (!playbackLimitedFreeInfo && cachedLimitedFreeInfoFn) playbackLimitedFreeInfo = cachedLimitedFreeInfoFn(trackId);

  try {
    if (refreshCookieFn) refreshCookieFn(false);
    if (ensureSignatureFn) await ensureSignatureFn({ allowGlobalScan: false, syncLocal: false });

    if (!playbackLimitedFreeInfo && getSodaLimitedFreeInfoFn) {
      try { playbackLimitedFreeInfo = await getSodaLimitedFreeInfoFn(trackId, options); }
      catch (e) { if (debugDumpFn) debugDumpFn('limited_free_prefetch_error', { error: e && e.message || String(e) }); }
    }
    if (playbackLimitedFreeInfo) {
      limitedFreeSynced = true;
      options = { ...options, limitedFreeInfo: playbackLimitedFreeInfo };
      if (trySodaMCheckMediaFn) await trySodaMCheckMediaFn(trackId, playbackLimitedFreeInfo, options);
    }

    let resolved = await tryResolveSodaTrackV2Fn(trackId, qualityPreference, options);
    let resolvedBody = resolved.body || {};
    let bodyBenefit = resolved.bodyBenefit || { hasFreeBenefit: false };
    let media = resolved.media;

    if (!media && !playbackLimitedFreeInfo && (resolved.onlyPreview || bodyBenefit.hasFreeBenefit || resolved.fee > 0)) {
      if (getSodaLimitedFreeInfoFn) {
        try { playbackLimitedFreeInfo = await getSodaLimitedFreeInfoFn(trackId, { ...options, trackBody: resolvedBody, body: resolvedBody }); }
        catch (e) { if (debugDumpFn) debugDumpFn('limited_free_retry_prefetch_error', { error: e && e.message || String(e) }); }
      }
      if (playbackLimitedFreeInfo) {
        limitedFreeSynced = true;
        options = { ...options, limitedFreeInfo: playbackLimitedFreeInfo, trackBody: resolvedBody };
        if (trySodaMCheckMediaFn) await trySodaMCheckMediaFn(trackId, playbackLimitedFreeInfo, options);
        resolved = await tryResolveSodaTrackV2Fn(trackId, qualityPreference, options);
        resolvedBody = resolved.body || {};
        bodyBenefit = resolved.bodyBenefit || { hasFreeBenefit: false };
        media = resolved.media;
      }
    }

    if (!media && !signatureRetried && (resolved.needsSignature || resolved.onlyPreview || bodyBenefit.hasFreeBenefit || resolved.fee > 0)) {
      signatureRetried = true;
      if (ensureSignatureFn) await ensureSignatureFn({ allowGlobalScan: true, syncLocal: true });
      if (!playbackLimitedFreeInfo && getSodaLimitedFreeInfoFn) {
        try { playbackLimitedFreeInfo = await getSodaLimitedFreeInfoFn(trackId, { ...options, trackBody: resolvedBody, body: resolvedBody }); }
        catch (e) { if (debugDumpFn) debugDumpFn('limited_free_signature_retry_prefetch_error', { error: e && e.message || String(e) }); }
        if (playbackLimitedFreeInfo) {
          limitedFreeSynced = true;
          options = { ...options, limitedFreeInfo: playbackLimitedFreeInfo, trackBody: resolvedBody };
          if (trySodaMCheckMediaFn) await trySodaMCheckMediaFn(trackId, playbackLimitedFreeInfo, options);
        }
      }
      resolved = await tryResolveSodaTrackV2Fn(trackId, qualityPreference, options);
      resolvedBody = resolved.body || {};
      bodyBenefit = resolved.bodyBenefit || { hasFreeBenefit: false };
      media = resolved.media;
    }

    return {
      resolved,
      body: resolvedBody,
      media,
      bodyBenefit,
      playbackLimitedFreeInfo,
      signatureRetried,
      limitedFreeSynced,
      error: null,
    };
  } catch (e) {
    return {
      resolved: null,
      body,
      media: null,
      bodyBenefit: { hasFreeBenefit: false },
      playbackLimitedFreeInfo,
      signatureRetried,
      limitedFreeSynced,
      error: e,
    };
  }
}

function setup(deps) {
  refreshCookieFn = deps.refreshCookie;
  ensureSignatureFn = deps.ensureSignature;
  getSodaLimitedFreeInfoFn = deps.getSodaLimitedFreeInfo;
  trySodaMCheckMediaFn = deps.trySodaMCheckMedia;
  tryResolveSodaTrackV2Fn = deps.tryResolveSodaTrackV2;
  tryResolveUnencryptedFallbackFn = deps.tryResolveUnencryptedFallback;
  playbackNativeStatusFn = deps.playbackNativeStatus;
  normalizeLimitedFreeInfoFn = deps.normalizeLimitedFreeInfo;
  cachedLimitedFreeInfoFn = deps.cachedLimitedFreeInfo;
  debugDumpFn = deps.debugDump;
}

module.exports = { setup, resolvePlayback };
