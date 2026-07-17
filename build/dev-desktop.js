const { spawn, spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const skipBuild = process.argv.includes('--skip-build');
const vitePackagePath = require.resolve('vite/package.json');
const vitePackage = require(vitePackagePath);
const viteBin = path.join(path.dirname(vitePackagePath), vitePackage.bin.vite);
const electronBin = require('electron');

function exitFromResult(result) {
  if (result.error) {
    console.error(result.error.message || result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!skipBuild) {
  console.log('[dev:desktop] building renderer...');
  exitFromResult(spawnSync(process.execPath, [viteBin, 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
  }));
}

console.log('[dev:desktop] starting Electron with main-process inspector on port 9229...');
const child = spawn(electronBin, ['--inspect=9229', '.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    MINERADIO_DESKTOP_DEBUG: '1',
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_ENABLE_STACK_DUMPING: '1',
  },
});

child.on('error', (error) => {
  console.error(error.message || error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[dev:desktop] Electron exited by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code || 0);
});
