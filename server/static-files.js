const fs = require('fs');
const path = require('path');

function safeStaticPath(root, requestPath) {
  const rootPath = path.resolve(root);
  const cleanPath = decodeURIComponent(String(requestPath || '/'))
    .replace(/\\/g, '/')
    .replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(rootPath, cleanPath);
  if (target !== rootPath && !target.startsWith(rootPath + path.sep)) return '';
  return target;
}

function firstExisting(paths) {
  return paths.find(file => file && fs.existsSync(file)) || paths[0] || '';
}

function resolveStaticFile(appRoot, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const rendererRoot = path.join(appRoot, 'renderer-dist');
  const publicRoot = path.join(appRoot, 'public');
  return firstExisting([
    safeStaticPath(rendererRoot, requestPath),
    safeStaticPath(publicRoot, requestPath),
  ]);
}

module.exports = {
  resolveStaticFile,
};
