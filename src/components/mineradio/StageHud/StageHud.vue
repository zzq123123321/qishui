<template>
<!-- 试听提醒 -->
<div id="trial-banner">
  <svg class="ic" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <span id="trial-text">仅播放试听片段</span>
  <span id="trial-login-btn" class="login-link" onclick="showLoginModal()">扫码登录</span>
  <span class="close" onclick="document.getElementById('trial-banner').classList.remove('show')">×</span>
</div>

<!-- AI 深度加载角标 -->
<div id="ai-depth-chip"><div class="mini-spin"></div><span id="ai-depth-text">AI 深度估计…</span></div>

<!-- 节拍分析角标 -->
<div id="beat-chip"><div class="mini-spin"></div><span id="beat-text">分析节奏…</span></div>

<!-- 舞台歌词 (大字 3D, 由 JS 动态填充) -->
<div id="bubble-danmaku-layer" aria-live="polite" aria-hidden="true"></div>
<div id="stage-lyrics"></div>

<!-- 手势 HUD + 手骨架 -->
<div id="gesture-hud" class="gesture-hud">
  <div>手势：<b id="gesture-label">待命</b></div>
  <div id="gesture-confirm" class="gesture-confirm">将手放进摄像头视野</div>
  <div class="gesture-meter"><span id="gesture-fill"></span></div>
  <div class="gesture-legend">手掌推开粒子 · 捏合旋转 · 握拳收束</div>
</div>
<canvas id="hand-canvas"></canvas>

<!-- 左下小封面 -->
<div id="thumb-wrap">
  <img id="thumb-cover" src="" alt="">
  <div id="thumb-info">
    <div id="thumb-title" onclick="openTrackDetailModal('song')" title="歌曲详情"></div>
    <div id="thumb-artist" onclick="openTrackDetailModal('artist')" title="歌手详情"></div>
  </div>
</div>
</template>
