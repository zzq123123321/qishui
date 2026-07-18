const fs = require('fs');
const path = require('path');
const { mineradioUserDataDir } = require('../utils/paths');

let configPath;
let cachedConfig = null;

function configFilePath() {
  if (!configPath) {
    configPath = path.join(mineradioUserDataDir(process.cwd()), 'config.json');
  }
  return configPath;
}

function readConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const data = fs.readFileSync(configFilePath(), 'utf-8');
    cachedConfig = JSON.parse(data);
  } catch (e) {
    cachedConfig = {};
  }
  return cachedConfig;
}

function writeConfig(config) {
  cachedConfig = config;
  const dir = path.dirname(configFilePath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf-8');
}

function getMusicDir() {
  const config = readConfig();
  return config.musicDir || process.env.MINERADIO_MUSIC_DIR || '';
}

function setMusicDir(dir) {
  const config = readConfig();
  config.musicDir = dir;
  writeConfig(config);
}

module.exports = { readConfig, writeConfig, getMusicDir, setMusicDir };
