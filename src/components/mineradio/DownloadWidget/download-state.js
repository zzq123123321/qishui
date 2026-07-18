import { reactive, computed } from 'vue'

const state = reactive({
  jobs: [],
  coverFly: null,
  settings: {
    quality: 'best',
    format: 'auto',
  },
  _completedTimer: null,
})

function now() { return Date.now() }

export function useDownloadState() {
  const overallStatus = computed(() => {
    const jobs = state.jobs
    if (jobs.length === 0) return 'idle'
    const active = jobs.some(j => j.status === 'queued' || j.status === 'downloading' || j.status === 'resolving' || j.status === 'transcoding')
    if (active) return 'downloading'
    if (jobs.some(j => j.status === 'failed')) return 'failed'
    const allCompleted = jobs.every(j => j.status === 'completed')
    if (allCompleted) return 'completed'
    return 'idle'
  })

  const activeJobs = computed(() => state.jobs.filter(j =>
    j.status === 'queued' || j.status === 'downloading' || j.status === 'resolving' || j.status === 'transcoding'
  ))

  const completedJobs = computed(() => state.jobs.filter(j => j.status === 'completed'))
  const failedJobs = computed(() => state.jobs.filter(j => j.status === 'failed'))

  return { state, overallStatus, activeJobs, completedJobs, failedJobs }
}

const bridge = {
  addJob(song, jobId) {
    const job = {
      id: jobId,
      source: song.source || '',
      title: song.name || 'Unknown',
      artist: song.artist || 'Unknown',
      album: song.album || '',
      coverUrl: song.cover || '',
      sourceId: song.sodaId || song.mid || song.id || '',
      status: 'queued',
      progress: { phase: 'queued', downloaded: 0, total: 0, percent: 0 },
      fileSize: 0,
      error: '',
      createdAt: now(),
      completedAt: 0,
    }
    state.jobs.unshift(job)
    if (state._completedTimer) { clearTimeout(state._completedTimer); state._completedTimer = null }
  },

  updateJob(jobId, data) {
    const idx = state.jobs.findIndex(j => j.id === jobId)
    if (idx === -1) return
    const job = state.jobs[idx]
    if (data.status) job.status = data.status
    if (data.progress) Object.assign(job.progress, data.progress)
    if (data.fileSize != null) job.fileSize = data.fileSize
    if (data.error) job.error = data.error
    if (data.completedAt) job.completedAt = data.completedAt
    if (data.title) job.title = data.title
    if (data.artist) job.artist = data.artist
    if (data.filePath) job.filePath = data.filePath
  },

  removeJob(jobId) {
    const idx = state.jobs.findIndex(j => j.id === jobId)
    if (idx !== -1) state.jobs.splice(idx, 1)
  },

  triggerCoverFly(coverUrl, fromX, fromY) {
    state.coverFly = { coverUrl, fromX, fromY, startTime: now() }
  },

  clearCoverFly() {
    state.coverFly = null
  },

  clearCompletedSoon() {
    if (state._completedTimer) clearTimeout(state._completedTimer)
    state._completedTimer = setTimeout(() => {
    }, 3000)
  },

  setSetting(key, value) {
    state.settings[key] = value
  },

  getSettings() {
    return { ...state.settings }
  },
}

if (typeof window !== 'undefined') {
  window.__downloadState = bridge
}

export default bridge
