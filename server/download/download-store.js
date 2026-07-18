'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STORE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.mineradio',
  'downloads.json'
);

const MAX_HISTORY = 200;
const CLEANUP_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let storePath = DEFAULT_STORE_PATH;
let cache = null;

function ensureDir() {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf8');
      const data = JSON.parse(raw);
      cache = Array.isArray(data) ? data : [];
    } else {
      cache = [];
    }
  } catch (e) {
    console.error('[DownloadStore] load failed:', e.message);
    cache = [];
  }
  return cache;
}

function save() {
  if (!cache) return;
  ensureDir();
  try {
    fs.writeFileSync(storePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[DownloadStore] save failed:', e.message);
  }
}

function addJob(job) {
  const jobs = load();
  jobs.unshift({
    id: job.id,
    source: job.source || '',
    sourceId: job.sourceId || '',
    title: job.title || '',
    artist: job.artist || '',
    album: job.album || '',
    quality: job.quality || '',
    format: job.format || 'mp3',
    status: job.status || 'queued',
    filePath: job.filePath || '',
    fileName: job.fileName || '',
    createdAt: job.createdAt || Date.now(),
    completedAt: job.completedAt || 0,
    fileSize: job.fileSize || 0,
    error: job.error || '',
  });
  if (jobs.length > MAX_HISTORY) jobs.length = MAX_HISTORY;
  cache = jobs;
  save();
}

function updateJob(jobId, patch) {
  const jobs = load();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return null;
  Object.assign(job, patch);
  save();
  return job;
}

function removeJob(jobId) {
  const jobs = load();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx < 0) return false;
  jobs.splice(idx, 1);
  save();
  return true;
}

function getJob(jobId) {
  const jobs = load();
  return jobs.find(j => j.id === jobId) || null;
}

function getAllJobs() {
  return load().slice();
}

function cleanup(maxAgeMs) {
  maxAgeMs = maxAgeMs || CLEANUP_AGE_MS;
  const jobs = load();
  const cutoff = Date.now() - maxAgeMs;
  const before = jobs.length;
  const filtered = jobs.filter(j => {
    if (j.status === 'completed' || j.status === 'failed') {
      return (j.completedAt || j.createdAt || 0) > cutoff;
    }
    return true;
  });
  if (filtered.length < before) {
    cache = filtered;
    save();
    console.log(`[DownloadStore] cleaned ${before - filtered.length} old jobs`);
  }
}

function reset(newPath) {
  if (newPath) storePath = newPath;
  cache = null;
}

module.exports = {
  load,
  save,
  addJob,
  updateJob,
  removeJob,
  getJob,
  getAllJobs,
  cleanup,
  reset,
};
