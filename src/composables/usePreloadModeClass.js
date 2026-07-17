const SIMPLE_MODE_CLASS = 'simple-mode-preload';
const DIY_MODE_CLASS = 'diy-mode-preload';
const DIY_MODE_STORE_KEY = 'mineradio-diy-player-mode-v1';

export function applyMineradioPreloadModeClass(storage = window.localStorage) {
  try {
    document.documentElement.classList.add(storage.getItem(DIY_MODE_STORE_KEY) === '1' ? DIY_MODE_CLASS : SIMPLE_MODE_CLASS);
  } catch (error) {
    document.documentElement.classList.add(SIMPLE_MODE_CLASS);
  }
}
