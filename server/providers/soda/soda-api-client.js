'use strict';

const crypto = require('crypto');
const os = require('os');
const sodaSigning = require('./soda-signing');

const SODA_API_BASE = 'https://api.qishui.com';
const SODA_APP_ID = '386088';
const SODA_APP_NAME = 'luna_pc';
const SODA_APP_VERSION = process.env.SODA_APP_VERSION || '3.5.1';
const SODA_VERSION_CODE = process.env.SODA_VERSION_CODE || '30501';

let readDeviceInfoFn = null;
let getUserAgentFn = null;
let getCookieFn = null;
let refreshCookieFn = null;
let requestFn = null;
let mergeCookieFn = null;

function sodaCommonParams(extra) {
  const device = readDeviceInfoFn ? readDeviceInfoFn() : {};
  return {
    aid: SODA_APP_ID,
    app_name: SODA_APP_NAME,
    region: 'cn',
    geo_region: 'cn',
    os_region: 'cn',
    sim_region: '',
    device_id: device.did || process.env.SODA_DEVICE_ID || '',
    cdid: device.cdid || '',
    iid: device.iid || process.env.SODA_IID || '',
    version_name: SODA_APP_VERSION,
    version_code: SODA_VERSION_CODE,
    channel: '0',
    build_mode: 'release',
    network_carrier: '',
    ac: 'wifi',
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    resolution: '',
    device_platform: 'windows',
    device_type: 'Windows',
    os: 'windows',
    os_version: os.release(),
    fp: device.did || process.env.SODA_DEVICE_ID || '',
    ...(extra || {}),
  };
}

async function sodaApiRequest(apiPath, params, opts) {
  opts = opts || {};
  if (opts.syncCookie !== false && refreshCookieFn) refreshCookieFn(false);
  const u = new URL(apiPath, SODA_API_BASE);
  const merged = sodaCommonParams(params);
  Object.keys(merged).forEach(key => {
    const value = merged[key];
    if (value !== undefined && value !== null && value !== '') u.searchParams.set(key, String(value));
  });
  let body = null;
  const cookie = getCookieFn ? getCookieFn() : '';
  const headers = {
    accept: 'application/json',
    'user-agent': getUserAgentFn ? getUserAgentFn({ noClientScan: opts.noClientScan || opts.security === false }) : '',
  };
  if (cookie) headers.cookie = cookie;
  if (opts.body) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(Buffer.byteLength(body));
    headers['x-ss-stub'] = crypto.createHash('md5').update(body).digest('hex').toUpperCase();
  }
  if (opts.security !== false && u.hostname.endsWith('qishui.com') && !u.pathname.includes('/passport/') && !u.pathname.includes('/ttwid/')) {
    headers['x-luna-background-type'] = 'foreground';
    headers['x-luna-is-background-req'] = '0';
    headers['x-luna-is-local-user'] = cookie ? '1' : '0';
    sodaSigning.applySodaBdmsSignature(u.toString(), headers);
  }
  const bdticketCtx = opts.security === false ? null : sodaSigning.applySodaBdticketSignature(u.toString(), headers);
  const response = await requestFn(u.toString(), { method: opts.method || (body ? 'POST' : 'GET'), headers, allowHttpError: !!opts.allowHttpError }, body);
  sodaSigning.handleSodaBdticketResponse(bdticketCtx, u.toString(), response.headers);
  if (mergeCookieFn) mergeCookieFn(response.headers && response.headers['set-cookie']);
  let json = {};
  try {
    json = response.text ? JSON.parse(response.text) : {};
  } catch (err) {
    const parseErr = new Error('Invalid JSON from ' + apiPath);
    parseErr.statusCode = response.statusCode;
    parseErr.body = response.text || '';
    parseErr.cause = err;
    throw parseErr;
  }
  if (json && typeof json === 'object' && response.statusCode >= 400) {
    json.httpStatusCode = response.statusCode;
  }
  return json || {};
}

function setup(deps) {
  readDeviceInfoFn = deps.readDeviceInfo;
  getUserAgentFn = deps.getUserAgent;
  getCookieFn = deps.getCookie;
  refreshCookieFn = deps.refreshCookie;
  requestFn = deps.request;
  mergeCookieFn = deps.mergeCookie;
}

module.exports = {
  setup,
  sodaCommonParams,
  sodaApiRequest,
};
