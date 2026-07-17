<template>
<div id="desktop-titlebar" aria-label="window controls">
  <div class="desktop-drag-region">
    <div class="desktop-app-mark" aria-hidden="true"></div>
    <div class="desktop-app-title" aria-hidden="true"></div>
  </div>
  <div class="desktop-window-controls">
    <button id="visual-guide-btn" class="icon-btn" type="button" onclick="startVisualGuide({ manual: true })" title="查看使用引导" aria-label="查看使用引导">?</button>
    <button id="update-entry" class="update-entry" type="button" onclick="openUpdatePanel()" title="检查更新" aria-label="检查更新">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle class="update-ring" cx="12" cy="12" r="8.8"></circle>
        <circle id="update-progress-ring" class="update-progress-ring" cx="12" cy="12" r="8.8"></circle>
        <path class="update-arrow" d="M12 16.5V7.5"></path>
        <path class="update-arrow" d="M8.7 10.7 12 7.4l3.3 3.3"></path>
      </svg>
    </button>
    <button id="diy-mode-btn" class="desktop-mode-btn" type="button" onclick="toggleDiyMode()" title="开启 DIY 玩家模式" aria-label="开启 DIY 玩家模式" aria-pressed="false">DIY</button>
    <button class="desktop-window-btn" data-window-action="minimize" title="最小化" aria-label="最小化">
      <svg viewBox="0 0 16 16"><path d="M3 8h10"/></svg>
    </button>
    <button class="desktop-window-btn" data-window-action="maximize" title="全屏" aria-label="全屏">
      <svg class="icon-maximize" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>
      <svg class="icon-restore" viewBox="0 0 16 16" style="display:none"><path d="M5 3.5h7.5v7.5"/><rect x="3.5" y="5.5" width="7" height="7" rx="1.3"/></svg>
    </button>
    <button class="desktop-window-btn close" data-window-action="close" title="关闭" aria-label="关闭">
      <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </button>
  </div>
</div>
<div id="custom-bg"><video id="custom-bg-video" muted loop playsinline preload="metadata"></video></div>
<div id="album-bg"></div>
<div id="canvas-container"></div>
<canvas id="idle-guide-canvas" aria-hidden="true"></canvas>
</template>
