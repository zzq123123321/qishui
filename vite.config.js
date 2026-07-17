import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import net from 'node:net';

const mineradioApiPort = Number.parseInt(process.env.MINERADIO_API_PORT || '3000', 10) || 3000;
const mineradioApiHost = '127.0.0.1';

let apiProbe = {
  checkedAt: 0,
  available: false,
};

function probeApiServer() {
  const now = Date.now();
  if (now - apiProbe.checkedAt < 900) {
    return Promise.resolve(apiProbe.available);
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: mineradioApiHost, port: mineradioApiPort });
    let settled = false;

    const finish = (available) => {
      if (settled) return;
      settled = true;
      apiProbe = { checkedAt: Date.now(), available };
      socket.destroy();
      resolve(available);
    };

    socket.setTimeout(180);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function writeJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function offlineApiResponse(req) {
  const path = (req.url || '').split('?')[0].replace(/^\/api(?=\/|$)/, '');
  if (path === '/login/status') return { loggedIn: false, offline: true };
  if (path === '/qq/login/status') return { provider: 'qq', loggedIn: false, offline: true, preview: false };
  if (path === '/soda/login/status') return { provider: 'soda', loggedIn: false, offline: true };
  if (path === '/discover/home') {
    return {
      loggedIn: false,
      offline: true,
      recommendations: [],
      dailySongs: [],
      dailyByProvider: {},
      playlists: [],
      songs: [],
    };
  }
  return null;
}

function mineradioOfflineApiFallback() {
  return {
    name: 'mineradio-offline-api-fallback',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        if (await probeApiServer()) {
          next();
          return;
        }

        const body = offlineApiResponse(req);
        if (body) {
          writeJson(res, 200, body);
          return;
        }

        writeJson(res, 503, {
          error: 'MINERADIO_API_OFFLINE',
          offline: true,
          message: 'Mineradio local API is not running',
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [mineradioOfflineApiFallback(), vue()],
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://${mineradioApiHost}:${mineradioApiPort}`,
        changeOrigin: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    outDir: 'renderer-dist',
    emptyOutDir: true,
    assetsDir: 'vite-assets',
    sourcemap: false,
  },
}));
