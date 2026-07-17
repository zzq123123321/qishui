#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API_BASE = process.env.GITEE_API_BASE || 'https://gitee.com/api/v5';
const TOKEN = process.env.GITEE_TOKEN || process.env.GITEE_ACCESS_TOKEN || '';
const OWNER = process.env.GITEE_OWNER || 'xiao-majie';
const REPO = process.env.GITEE_REPO || 'mineradio';
const RELEASE_TAG = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
const RELEASE_NAME = process.env.RELEASE_NAME || `Mineradio ${RELEASE_TAG}`;
const TARGET_COMMITISH = process.env.RELEASE_TARGET || process.env.GITHUB_SHA || 'main';
const CLOBBER = process.env.GITEE_CLOBBER !== 'false';

function fail(message) {
  console.error('[GiteeRelease] ' + message);
  process.exit(1);
}

function readReleaseBody() {
  const bodyFile = process.env.RELEASE_BODY_FILE || '';
  if (bodyFile && fs.existsSync(bodyFile)) return fs.readFileSync(bodyFile, 'utf8');
  return process.env.RELEASE_BODY || `Mineradio ${RELEASE_TAG}`;
}

function splitAssetList(value) {
  return String(value || '')
    .split(/\r?\n|;/)
    .map(item => item.trim())
    .filter(Boolean);
}

function collectAssets() {
  const args = process.argv.slice(2).filter(Boolean);
  const envAssets = splitAssetList(process.env.GITEE_RELEASE_ASSETS || process.env.RELEASE_ASSETS || '');
  const seen = new Set();
  return args.concat(envAssets)
    .map(file => path.resolve(file))
    .filter(file => {
      if (seen.has(file)) return false;
      seen.add(file);
      return fs.existsSync(file) && fs.statSync(file).isFile();
    });
}

function apiPath(route) {
  return `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}${route}`;
}

async function giteeRequest(method, route, fields, options) {
  options = options || {};
  const url = new URL(API_BASE + apiPath(route));
  url.searchParams.set('access_token', TOKEN);
  const init = { method, headers: { Accept: 'application/json' } };
  if (fields) {
    const body = new URLSearchParams();
    Object.keys(fields).forEach(key => {
      if (fields[key] !== undefined && fields[key] !== null) body.set(key, String(fields[key]));
    });
    init.body = body;
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    if (options.allow404 && resp.status === 404) return null;
    throw new Error(`${method} ${route} failed: HTTP ${resp.status} ${text.slice(0, 300)}`);
  }
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_) { return { raw: text }; }
}

async function ensureRelease() {
  const existing = await giteeRequest('GET', `/releases/tags/${encodeURIComponent(RELEASE_TAG)}`, null, { allow404: true });
  const fields = {
    tag_name: RELEASE_TAG,
    name: RELEASE_NAME,
    body: readReleaseBody(),
    prerelease: 'false',
    target_commitish: TARGET_COMMITISH,
  };
  if (!existing) {
    console.log(`[GiteeRelease] create ${RELEASE_TAG}`);
    return await giteeRequest('POST', '/releases', fields);
  }
  console.log(`[GiteeRelease] update ${RELEASE_TAG}`);
  try {
    return await giteeRequest('PATCH', `/releases/${existing.id}`, fields);
  } catch (err) {
    console.warn('[GiteeRelease] update skipped:', err.message);
    return existing;
  }
}

function releaseFiles(release) {
  const lists = [
    release && release.attach_files,
    release && release.assets,
    release && release.attachments,
  ].filter(Array.isArray);
  return lists.flat();
}

function attachmentName(item) {
  return item && (item.name || item.file_name || item.filename || path.basename(item.url || item.browser_download_url || ''));
}

function attachmentId(item) {
  return item && (item.id || item.uuid || item.attach_file_id);
}

async function deleteDuplicateAttachments(release, fileName) {
  if (!CLOBBER) return;
  const matches = releaseFiles(release).filter(item => attachmentName(item) === fileName && attachmentId(item));
  for (const item of matches) {
    const id = attachmentId(item);
    try {
      await giteeRequest('DELETE', `/releases/${release.id}/attach_files/${id}`);
      console.log(`[GiteeRelease] removed old ${fileName}`);
    } catch (err) {
      console.warn(`[GiteeRelease] could not remove old ${fileName}: ${err.message}`);
    }
  }
}

function curlCommand() {
  return process.platform === 'win32' ? 'curl.exe' : 'curl';
}

function uploadAttachment(release, file) {
  const url = `${API_BASE}${apiPath(`/releases/${release.id}/attach_files`)}`;
  const args = [
    '-sS',
    '--fail',
    '-X', 'POST',
    '-F', `access_token=${TOKEN}`,
    '-F', `file=@${file}`,
    url,
  ];
  execFileSync(curlCommand(), args, { stdio: 'inherit' });
}

(async () => {
  if (!TOKEN) fail('missing GITEE_TOKEN');
  if (!RELEASE_TAG) fail('missing RELEASE_TAG');
  const assets = collectAssets();
  let release = await ensureRelease();
  for (const file of assets) {
    const name = path.basename(file);
    await deleteDuplicateAttachments(release, name);
    console.log(`[GiteeRelease] upload ${name}`);
    uploadAttachment(release, file);
    release = await giteeRequest('GET', `/releases/tags/${encodeURIComponent(RELEASE_TAG)}`);
  }
  console.log(`[GiteeRelease] done ${RELEASE_TAG}, assets=${assets.length}`);
})().catch(err => fail(err && err.message || String(err)));
