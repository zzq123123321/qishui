'use strict';

const fs = require('fs');
const path = require('path');

let getState = null;
let setState = null;
let readDeviceInfo = null;
let cookieObjectFn = null;

function toHeaderValueList(value) {
  if (Array.isArray(value)) return value.map(item => String(item));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function lowerCaseHeaderObject(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(key => {
    const value = headers[key];
    if (value === undefined || value === null) return;
    out[String(key).toLowerCase()] = String(value);
  });
  return out;
}

function normalizeResponseHeadersForBdticket(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(key => {
    const values = toHeaderValueList(headers[key]);
    if (values.length) out[String(key).toLowerCase()] = values;
  });
  return out;
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

function applySodaBdmsSignature(targetUrl, headers) {
  const state = getState ? getState() : null;
  const device = readDeviceInfo ? readDeviceInfo() : {};
  if (!state || !state.bdms || !device.did) return;
  try {
    if (state.bdmsInitedForDevice !== device.did) {
      state.bdms.init({ deviceId: device.did });
      state.bdmsInitedForDevice = device.did;
    }
    const headerLines = [];
    Object.keys(headers || {}).forEach(key => {
      for (const value of toHeaderValueList(headers[key])) {
        headerLines.push(`${String(key).toLowerCase()}\r\n${value}`);
      }
    });
    const signatureData = String(state.bdms.generateHttpSignatureHeaders(targetUrl, headerLines.join('\r\n')) || '')
      .split('\r\n')
      .filter(item => item && item.trim());
    for (let i = 0; i < signatureData.length / 2; i++) {
      headers[signatureData[i * 2]] = signatureData[i * 2 + 1];
    }
  } catch (e) {}
}

function applySodaBdticketSignature(targetUrl, headers) {
  const state = getState ? getState() : null;
  if (!state || !state.bdticket) return null;
  try {
    const u = new URL(targetUrl);
    const cookieObj = cookieObjectFn ? cookieObjectFn() : {};
    const sessionID = String(cookieObj.sessionid || '');
    const sessionSS = String(cookieObj.sessionid_ss || '');
    const requestHeaders = lowerCaseHeaderObject(headers);
    const result = state.bdticket.handleRequest(u.host, u.pathname, requestHeaders, sessionID, sessionSS) || {};
    Object.keys(result.headers || {}).forEach(key => {
      headers[key] = result.headers[key];
    });
    return {
      host: u.host,
      pathname: u.pathname,
      requestHeaders,
      sessionID,
      sessionSS,
      associated: result.associated || {},
    };
  } catch (e) {
    return null;
  }
}

function handleSodaBdticketResponse(ctx, targetUrl, responseHeaders) {
  if (!ctx) return;
  const state = getState ? getState() : null;
  if (!state || !state.bdticket) return;
  try {
    const headers = normalizeResponseHeadersForBdticket(responseHeaders);
    let responseSessionId = '';
    const setCookies = headers['set-cookie'] || [];
    for (const item of setCookies) {
      const raw = String(item || '').split(';')[0];
      const idx = raw.indexOf('=');
      if (idx > 0) {
        const key = raw.slice(0, idx).trim();
        const value = raw.slice(idx + 1).trim();
        if (key === 'sessionid') {
          responseSessionId = value;
          break;
        }
      }
    }
    state.bdticket.handleResponse(ctx.host, ctx.pathname, headers, responseSessionId, ctx.requestHeaders, ctx.sessionID, ctx.sessionSS, ctx.associated || {});
  } catch (e) {}
}

function setup(deps) {
  getState = deps.getState;
  setState = deps.setState;
  readDeviceInfo = deps.readDeviceInfo;
  cookieObjectFn = deps.cookieObjectFn;
}

module.exports = {
  setup,
  applySodaBdmsSignature,
  applySodaBdticketSignature,
  handleSodaBdticketResponse,
  sodaBdticketSettings,
};
