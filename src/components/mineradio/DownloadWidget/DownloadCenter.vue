<template>
  <div id="download-center-modal" class="modal-mask" :class="{ show: visible }" @click.self="close">
    <div class="modal download-center-modal">
      <div class="dc-head">
        <h2>Download Center</h2>
        <div class="dc-head-actions">
          <button class="dc-settings-btn" @click="toggleSettings" title="下载设置">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </button>
          <button class="dc-close-btn" @click="close">×</button>
        </div>
      </div>

      <!-- Settings panel -->
      <div v-if="showSettings" class="dc-settings-panel">
        <div class="dc-settings-back" @click="showSettings = false">← 返回</div>
        <div class="dc-settings-body">
          <div class="download-option-group">
            <div class="download-option-label">音质</div>
            <div class="download-option-row">
              <label class="download-radio" :class="{ checked: settings.quality === 'best' }">
                <input type="radio" name="dc-quality" value="best" v-model="settings.quality"> 最佳
              </label>
              <label class="download-radio" :class="{ checked: settings.quality === 'high' }">
                <input type="radio" name="dc-quality" value="high" v-model="settings.quality"> 高
              </label>
              <label class="download-radio" :class="{ checked: settings.quality === 'medium' }">
                <input type="radio" name="dc-quality" value="medium" v-model="settings.quality"> 中
              </label>
              <label class="download-radio" :class="{ checked: settings.quality === 'low' }">
                <input type="radio" name="dc-quality" value="low" v-model="settings.quality"> 低
              </label>
            </div>
          </div>
          <div class="download-option-group">
            <div class="download-option-label">格式</div>
            <div class="download-option-row">
              <label class="download-radio" :class="{ checked: settings.format === 'auto' }">
                <input type="radio" name="dc-format" value="auto" v-model="settings.format"> 自动
              </label>
              <label class="download-radio" :class="{ checked: settings.format === 'mp3' }">
                <input type="radio" name="dc-format" value="mp3" v-model="settings.format"> MP3
              </label>
              <label class="download-radio" :class="{ checked: settings.format === 'flac' }">
                <input type="radio" name="dc-format" value="flac" v-model="settings.format"> FLAC
              </label>
              <label class="download-radio" :class="{ checked: settings.format === 'ogg' }">
                <input type="radio" name="dc-format" value="ogg" v-model="settings.format"> OGG
              </label>
            </div>
          </div>
          <div class="download-option-group">
            <div class="download-option-label">保存位置</div>
            <div class="download-location-row">
              <span class="download-location-path">{{ locationText }}</span>
              <button class="modal-btn download-location-btn" @click="pickLocation">选择目录</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Job list -->
      <div v-else class="dc-body">
        <div class="dc-tabs">
          <button v-for="tab in tabs" :key="tab.key" class="dc-tab" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">
            {{ tab.label }}
            <span v-if="tab.count" class="dc-tab-count">{{ tab.count }}</span>
          </button>
        </div>
        <div class="dc-list">
          <div v-if="filteredJobs.length === 0" class="dc-empty">
            <div class="dc-empty-icon">
              <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="color:rgba(255,255,255,.20)">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
            <div class="dc-empty-text">暂无下载任务</div>
          </div>
          <div v-for="job in filteredJobs" :key="job.id" class="dc-job" :class="'dc-job-' + job.status" @click="playJob(job)">
            <img :src="job.coverUrl" alt="" class="dc-job-cover" @error="onCoverError">
            <div class="dc-job-info">
              <div class="dc-job-title">{{ job.title }}</div>
              <div class="dc-job-artist">{{ job.artist }}</div>
              <div v-if="job.status === 'downloading' || job.status === 'transcoding'" class="dc-job-progress">
                <div class="dc-progress-track">
                  <div class="dc-progress-fill" :style="{ width: (job.progress.percent || 0) + '%' }"></div>
                </div>
                <span class="dc-progress-label">{{ statusLabel(job) }}</span>
              </div>
              <div v-else-if="job.status === 'queued'" class="dc-job-eta">排队中</div>
              <div v-else-if="job.status === 'completed' && job.fileSize" class="dc-job-size">{{ formatSize(job.fileSize) }}</div>
              <div v-else-if="job.status === 'failed'" class="dc-job-error">{{ job.error || '下载失败' }}</div>
            </div>
            <div class="dc-job-action" @click.stop>
              <button v-if="job.status === 'downloading' || job.status === 'transcoding' || job.status === 'queued'" class="dc-action-btn cancel" @click="cancelJob(job.id)" title="取消">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </button>
              <button v-if="job.status === 'failed'" class="dc-action-btn retry" @click="retryJob(job)" title="重试">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
              <button v-if="job.status === 'failed'" class="dc-action-btn del" @click="confirmDelete(job)" title="删除">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
              <button v-if="job.status === 'completed'" class="dc-action-btn open" @click="showItemInFolder(job)" title="打开所在位置">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
              <button v-if="job.status === 'completed'" class="dc-action-btn del" @click="confirmDelete(job)" title="删除">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
            <!-- Delete confirm -->
            <div v-if="showDeleteConfirm === job.id" class="dc-job-confirm" @click.stop>
              <span class="dc-confirm-text">确认删除文件？</span>
              <span class="dc-confirm-hint">（音频和专辑信息将被永久删除）</span>
              <div class="dc-confirm-actions">
                <button class="dc-confirm-btn cancel" @click="showDeleteConfirm = null">取消</button>
                <button class="dc-confirm-btn ok" @click="deleteJob(job)">确认删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDownloadState } from './download-state.js'

const { state, overallStatus, activeJobs, completedJobs, failedJobs } = useDownloadState()
const visible = ref(false)
const showSettings = ref(false)
const activeTab = ref('all')
const settings = ref({ quality: 'best', format: 'auto' })
const locationText = ref('正在获取…')
const locationLoading = ref(false)
const showDeleteConfirm = ref(null)
const deletingJobId = ref(null)

const tabs = computed(() => {
  const all = state.jobs.length
  const active = activeJobs.value.length
  const completed = completedJobs.value.length
  const failed = failedJobs.value.length
  return [
    { key: 'all', label: '全部', count: all || '' },
    { key: 'active', label: '活跃', count: active || '' },
    { key: 'completed', label: '已完成', count: completed || '' },
    { key: 'failed', label: '失败', count: failed || '' },
  ]
})

const filteredJobs = computed(() => {
  const tab = activeTab.value
  if (tab === 'all') return state.jobs
  if (tab === 'active') return activeJobs.value
  if (tab === 'completed') return completedJobs.value
  if (tab === 'failed') return failedJobs.value
  return state.jobs
})

function statusLabel(job) {
  if (job.status === 'queued') return '排队中'
  if (job.status === 'resolving') return '解析中'
  if (job.status === 'downloading') return '下载中 ' + (job.progress.percent || 0) + '%'
  if (job.status === 'transcoding') return '转码中'
  return job.status
}

function formatSize(bytes) {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb.toFixed(1) + ' MB'
}

function onCoverError(e) {
  e.target.style.display = 'none'
}

function playJob(job) {
  if (job.status === 'completed' && typeof window.playDownloadJob === 'function') {
    window.playDownloadJob(job)
    close()
  }
}

function open() {
  visible.value = true
  showSettings.value = false
  activeTab.value = 'all'
  document.body.classList.add('modal-open')
}

function close() {
  visible.value = false
  document.body.classList.remove('modal-open')
}

function toggleSettings() {
  showSettings.value = !showSettings.value
  if (showSettings.value) refreshLocation()
}

async function refreshLocation() {
  locationLoading.value = true
  locationText.value = '正在获取…'
  try {
    const resp = await fetch('/api/download/config')
    const data = await resp.json()
    locationText.value = data.musicDir || '使用默认位置'
  } catch (e) {
    locationText.value = '使用默认位置'
  } finally {
    locationLoading.value = false
  }
}

async function pickLocation() {
  if (window.desktopWindow && window.desktopWindow.pickDirectory) {
    const dir = await window.desktopWindow.pickDirectory()
    if (!dir) return
    try {
      const resp = await fetch('/api/download/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicDir: dir }),
      })
      const data = await resp.json()
      if (data.ok) refreshLocation()
    } catch (e) {
      locationText.value = '保存失败'
    }
  }
}

async function showItemInFolder(job) {
  if (job.filePath && window.desktopWindow && window.desktopWindow.showItemInFolder) {
    await window.desktopWindow.showItemInFolder(job.filePath)
  }
}

async function cancelJob(jobId) {
  try {
    await fetch('/api/download/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    })
    if (window.__downloadState) window.__downloadState.removeJob(jobId)
  } catch (e) {}
}

function confirmDelete(job) {
  showDeleteConfirm.value = job.id
}

async function deleteJob(job) {
  if (deletingJobId.value) return
  deletingJobId.value = job.id
  showDeleteConfirm.value = null
  try {
    await fetch('/api/download/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id }),
    })
    if (window.__downloadState) window.__downloadState.removeJob(job.id)
  } catch (e) {}
  deletingJobId.value = null
}

async function retryJob(job) {
  const body = {
    id: job.sourceId || job.id,
    source: job.source || 'soda',
    quality: settings.value.quality,
    format: settings.value.format,
    name: job.title,
    artist: job.artist,
    album: job.album || '',
    coverUrl: job.coverUrl || '',
  }
  try {
    const resp = await fetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (data.jobId && window.__downloadState) {
      window.__downloadState.removeJob(job.id)
      window.__downloadState.addJob(job, data.jobId)
      pollJob(data.jobId)
    }
  } catch (e) {}
}

async function pollJob(jobId) {
  const poll = async () => {
    try {
      const resp = await fetch('/api/download/status?id=' + jobId)
      const data = await resp.json()
      if (window.__downloadState) window.__downloadState.updateJob(jobId, data)
      if (data.status === 'completed' || data.status === 'failed') return
      setTimeout(poll, 800)
    } catch (e) {
      setTimeout(poll, 2000)
    }
  }
  poll()
}

onMounted(() => {
  settings.value = window.__downloadState ? window.__downloadState.getSettings() : { quality: 'best', format: 'auto' }
})

watch(settings, (val) => {
  if (window.__downloadState) {
    window.__downloadState.setSetting('quality', val.quality)
    window.__downloadState.setSetting('format', val.format)
  }
}, { deep: true })

watch(visible, (val) => {
  if (!val) showSettings.value = false
})

if (typeof window !== 'undefined') {
  window.openDownloadCenter = open
  window.closeDownloadCenter = close
}
</script>
