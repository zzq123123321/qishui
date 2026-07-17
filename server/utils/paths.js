const fs = require('fs');
const path = require('path');

function mineradioUserDataDir(fallbackDir) {
  if (process.env.MINERADIO_USER_DATA_DIR) return process.env.MINERADIO_USER_DATA_DIR;
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'Mineradio');
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'Mineradio');
  return fallbackDir || process.cwd();
}

function writePrivateStateFile(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  } catch (e) {}
}

module.exports = {
  mineradioUserDataDir,
  writePrivateStateFile,
};
