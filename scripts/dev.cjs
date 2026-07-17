const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

let viteServer = null
let electronProcess = null
let isStopping = false

function spawnChild(command, args, env) {
  return spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
}

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer()

      tester.once('error', (error) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          tryPort(port + 1)
          return
        }

        reject(error)
      })

      tester.once('listening', () => {
        tester.close(() => resolve(port))
      })

      tester.listen(port, '127.0.0.1')
    }

    tryPort(startPort)
  })
}

function getRendererUrl(server) {
  const localUrl = server.resolvedUrls?.local?.[0]

  if (localUrl) {
    return localUrl.replace(/\/$/, '')
  }

  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : server.config.server.port
  const configuredHost = server.config.server.host
  const host = configuredHost === true || !configuredHost ? '127.0.0.1' : configuredHost
  const protocol = server.config.server.https ? 'https' : 'http'

  return `${protocol}://${host}:${port}`
}

async function stop() {
  if (isStopping) {
    return
  }

  isStopping = true
  electronProcess?.kill()
  await viteServer?.close()
}

async function main() {
  const { createServer } = await import('vite')
  const apiPort = await findOpenPort(Number.parseInt(process.env.MINERADIO_API_PORT || '', 10) || 3000)

  process.env.MINERADIO_API_PORT = String(apiPort)

  viteServer = await createServer({
    root: projectRoot,
    configFile: path.join(projectRoot, 'vite.config.js'),
  })

  await viteServer.listen()
  viteServer.printUrls()

  electronProcess = spawnChild(process.execPath, [path.join('scripts', 'dev-electron.cjs')], {
    ELECTRON_RENDERER_URL: getRendererUrl(viteServer),
    MINERADIO_API_PORT: String(apiPort),
  })

  electronProcess.on('exit', async (code) => {
    if (!isStopping) {
      await stop()
      process.exit(code ?? 0)
    }
  })
}

process.on('SIGINT', async () => {
  await stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await stop()
  process.exit(0)
})

main().catch(async (error) => {
  await stop()
  console.error(error)
  process.exit(1)
})
