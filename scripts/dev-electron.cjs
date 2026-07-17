const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const electronPath = require('electron')

const watchedDir = path.resolve(__dirname, '../electron')
const rendererUrl = process.env.ELECTRON_RENDERER_URL
let electronProcess = null
let restartTimer = null
let isStopping = false
let pendingRestart = false
let watcher = null

if (!rendererUrl) {
  console.error('ELECTRON_RENDERER_URL is missing. Run npm run dev so Vite can provide the actual dev server URL.')
  process.exit(1)
}

function startElectron() {
  electronProcess = spawn(electronPath, ['.'], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  })

  electronProcess.on('exit', (code) => {
    electronProcess = null

    if (pendingRestart && !isStopping) {
      pendingRestart = false
      startElectron()
      return
    }

    if (!isStopping) {
      process.exit(code ?? 0)
    }
  })
}

function restartElectron() {
  if (isStopping) {
    return
  }

  if (electronProcess == null) {
    startElectron()
    return
  }

  pendingRestart = true
  electronProcess.kill()
}

function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(restartElectron, 200)
}

function stopElectron() {
  isStopping = true
  clearTimeout(restartTimer)
  watcher?.close()

  if (electronProcess != null) {
    electronProcess.kill()
  }

  setTimeout(() => process.exit(0), 100)
}

startElectron()

watcher = fs.watch(watchedDir, { recursive: true }, (eventType, filename) => {
  if (!filename || !/\.(cjs|js|json)$/.test(filename)) {
    return
  }

  scheduleRestart()
})

process.on('SIGINT', stopElectron)
process.on('SIGTERM', stopElectron)
