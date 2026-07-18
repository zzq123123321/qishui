<template>
  <div
    id="download-float"
    class="download-float"
    :class="[statusClass, { 'has-jobs': state.jobs.length > 0 }]"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @click="handleClick"
  >
    <!-- Cover fly animation -->
    <div v-if="state.coverFly" class="cover-fly"
      ref="coverFlyEl"
      :style="coverFlyStyle"
      @animationend="clearCoverFly">
      <img :src="state.coverFly.coverUrl" class="cover-fly-img" alt="">
    </div>

    <!-- Dot -->
    <div class="float-dot">
      <!-- Idle (no jobs): download arrow -->
      <svg v-if="overallStatus === 'idle' && state.jobs.length === 0" class="dot-icon idle-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>

      <!-- Idle with completed jobs: subtle check -->
      <svg v-if="overallStatus === 'completed' && !checkmarkVisible" class="dot-icon idle-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>

      <!-- Downloading: circular ring -->
      <svg v-if="overallStatus === 'downloading'" class="dot-icon ring-icon" width="20" height="20" viewBox="0 0 24 24">
        <circle class="ring-bg" cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="2.5"/>
        <circle
          class="ring-fill"
          cx="12" cy="12" r="9"
          fill="none"
          stroke="#f4d28a"
          stroke-width="2.5"
          stroke-linecap="round"
          :stroke-dasharray="ringCircumference"
          :stroke-dashoffset="ringOffset"
          transform="rotate(-90 12 12)"
        />
        <polyline class="ring-arrow" points="7 12 12 16 17 12" fill="none" stroke="#f4d28a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line class="ring-arrow-stem" x1="12" y1="6" x2="12" y2="14" stroke="#f4d28a" stroke-width="2" stroke-linecap="round"/>
      </svg>

      <!-- Completed: checkmark -->
      <svg v-if="checkmarkVisible" class="dot-icon check-icon" width="20" height="20" fill="none" stroke="#4ade80" stroke-width="3" viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"/>
      </svg>

      <!-- Failed: x -->
      <svg v-if="overallStatus === 'failed'" class="dot-icon fail-icon" width="18" height="18" fill="none" stroke="#ff8f9d" stroke-width="3" viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>

      <!-- Mini count badge -->
      <span v-if="state.jobs.length > 0" class="dot-badge">{{ state.jobs.length }}</span>
    </div>

    <!-- Hover card -->
    <div v-if="hovered && state.jobs.length > 0" class="float-hover-card" @click.stop>
      <div class="hover-card-header">
        <span class="hover-card-title">下载任务</span>
        <span v-if="overallStatus === 'downloading'" class="hover-card-count">进行中</span>
        <span v-else-if="overallStatus === 'completed'" class="hover-card-count done">全部完成</span>
        <span v-else-if="overallStatus === 'failed'" class="hover-card-count fail">{{ failedJobs.length }} 个失败</span>
        <span v-else class="hover-card-count">{{ state.jobs.length }} 个任务</span>
      </div>
      <!-- Current active job highlighted -->
      <div v-if="currentJob" class="hover-current-job">
        <img :src="currentJob.coverUrl" alt="" class="hover-current-cover" @error="onCoverError">
        <div class="hover-current-info">
          <div class="hover-current-name">{{ currentJob.title }}</div>
          <div class="hover-current-artist">{{ currentJob.artist }}</div>
        </div>
        <div class="hover-current-status">
          <template v-if="currentJob.status === 'downloading' || currentJob.status === 'transcoding'">
            <div class="hover-progress-track">
              <div class="hover-progress-fill" :style="{ width: (currentJob.progress.percent || 0) + '%' }"></div>
            </div>
          </template>
          <span v-else-if="currentJob.status === 'queued'" class="status-label queued">等待</span>
          <span v-else-if="currentJob.status === 'completed'" class="status-label done">完成</span>
          <span v-else-if="currentJob.status === 'failed'" class="status-label fail">失败</span>
        </div>
      </div>
      <!-- Other recent jobs -->
      <div v-for="job in otherJobs" :key="job.id" class="hover-job-row">
        <img :src="job.coverUrl" alt="" class="hover-job-cover" @error="onCoverError">
        <div class="hover-job-info">
          <div class="hover-job-name">{{ job.title }}</div>
          <div class="hover-job-artist">{{ job.artist }}</div>
        </div>
        <div class="hover-job-status">
          <span v-if="job.status === 'completed'" class="status-label done">完成</span>
          <span v-else-if="job.status === 'failed'" class="status-label fail">失败</span>
          <span v-else-if="job.status === 'queued'" class="status-label queued">等待</span>
        </div>
      </div>
      <div class="hover-card-footer">点击查看全部</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useDownloadState } from './download-state.js'

const { state, overallStatus, activeJobs, completedJobs, failedJobs } = useDownloadState()
const hovered = ref(false)
const coverFlyEl = ref(null)
const checkmarkVisible = ref(false)

const ringCircumference = 2 * Math.PI * 9
const ringOffset = computed(() => {
  const jobs = state.jobs
  const downloading = jobs.find(j => j.status === 'downloading' || j.status === 'transcoding')
  const pct = downloading ? (downloading.progress.percent || 0) : 0
  return ringCircumference * (1 - pct / 100)
})

const statusClass = computed(() => {
  const s = overallStatus.value
  if (s === 'downloading') return 'is-downloading'
  if (s === 'completed') return 'is-completed'
  if (s === 'failed') return 'is-failed'
  return 'is-idle'
})

const visibleJobs = computed(() => {
  return state.jobs.slice(0, 5)
})

const currentJob = computed(() => {
  return activeJobs.value[0] || completedJobs.value[0] || failedJobs.value[0] || null
})

const otherJobs = computed(() => {
  if (!currentJob.value) return visibleJobs.value
  return state.jobs.filter(j => j.id !== currentJob.value.id).slice(0, 4)
})

const coverFlyStyle = computed(() => {
  if (!state.coverFly) return {}
  const dotEl = document.querySelector('.float-dot')
  if (!dotEl) return {}
  const dotRect = dotEl.getBoundingClientRect()
  const dx = dotRect.left + dotRect.width / 2 - state.coverFly.fromX
  const dy = dotRect.top + dotRect.height / 2 - state.coverFly.fromY
  return {
    left: state.coverFly.fromX + 'px',
    top: state.coverFly.fromY + 'px',
    '--fly-dx': dx + 'px',
    '--fly-dy': dy + 'px',
  }
})

function handleClick() {
  if (typeof window.openDownloadCenter === 'function') {
    window.openDownloadCenter()
  }
}

function clearCoverFly() {
  if (window.__downloadState) {
    window.__downloadState.clearCoverFly()
  }
}

function onCoverError(e) {
  e.target.style.display = 'none'
}

let completedTimer = null
let checkmarkTimer = null
watch(overallStatus, (val) => {
  if (val === 'completed') {
    checkmarkVisible.value = true
    if (checkmarkTimer) clearTimeout(checkmarkTimer)
    checkmarkTimer = setTimeout(() => {
      checkmarkVisible.value = false
    }, 3000)
    if (completedTimer) clearTimeout(completedTimer)
    completedTimer = setTimeout(() => {
      if (state.jobs.length === 0) return
    }, 4000)
  } else if (val === 'downloading') {
    checkmarkVisible.value = false
  }
})

onUnmounted(() => {
  if (completedTimer) clearTimeout(completedTimer)
  if (checkmarkTimer) clearTimeout(checkmarkTimer)
})
</script>
