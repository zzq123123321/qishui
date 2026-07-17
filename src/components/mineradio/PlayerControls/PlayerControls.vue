<template>
<!-- 底部控件 -->
<svg id="control-glass-svg" class="control-glass-filter-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <filter id="mineradio-control-glass-filter" color-interpolation-filters="sRGB" x="-12%" y="-28%" width="124%" height="156%">
      <feImage id="control-glass-map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"></feImage>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="180" xChannelSelector="R" yChannelSelector="B" result="dispRed"></feDisplacementMap>
      <feOffset in="dispRed" dx="-90" dy="0" result="dispRedShifted"></feOffset>
      <feMerge result="dispRedAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispRedShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispRedAligned" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="170" xChannelSelector="R" yChannelSelector="B" result="dispGreen"></feDisplacementMap>
      <feOffset in="dispGreen" dx="-90" dy="0" result="dispGreenShifted"></feOffset>
      <feMerge result="dispGreenAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispGreenShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispGreenAligned" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="160" xChannelSelector="R" yChannelSelector="B" result="dispBlue"></feDisplacementMap>
      <feOffset in="dispBlue" dx="-90" dy="0" result="dispBlueShifted"></feOffset>
      <feMerge result="dispBlueAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispBlueShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispBlueAligned" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"></feColorMatrix>
      <feBlend in="red" in2="green" mode="screen" result="rg"></feBlend>
      <feBlend in="rg" in2="blue" mode="screen" result="output"></feBlend>
      <feGaussianBlur in="output" stdDeviation="0.5"></feGaussianBlur>
    </filter>
    <filter id="mineradio-search-box-glass-filter" color-interpolation-filters="sRGB" x="-24%" y="-34%" width="158%" height="168%">
      <feImage id="search-box-glass-map" x="-10%" y="-4%" width="120%" height="108%" preserveAspectRatio="none" result="map"></feImage>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="180" xChannelSelector="R" yChannelSelector="B" result="dispRed"></feDisplacementMap>
      <feOffset in="dispRed" dx="-90" dy="0" result="dispRedShifted"></feOffset>
      <feMerge result="dispRedAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispRedShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispRedAligned" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="170" xChannelSelector="R" yChannelSelector="B" result="dispGreen"></feDisplacementMap>
      <feOffset in="dispGreen" dx="-90" dy="0" result="dispGreenShifted"></feOffset>
      <feMerge result="dispGreenAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispGreenShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispGreenAligned" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="160" xChannelSelector="R" yChannelSelector="B" result="dispBlue"></feDisplacementMap>
      <feOffset in="dispBlue" dx="-90" dy="0" result="dispBlueShifted"></feOffset>
      <feMerge result="dispBlueAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispBlueShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispBlueAligned" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"></feColorMatrix>
      <feBlend in="red" in2="green" mode="screen" result="rg"></feBlend>
      <feBlend in="rg" in2="blue" mode="screen" result="output"></feBlend>
      <feGaussianBlur in="output" stdDeviation="0.5"></feGaussianBlur>
    </filter>
    <filter id="mineradio-search-pill-glass-filter" color-interpolation-filters="sRGB" x="-48%" y="-68%" width="210%" height="236%">
      <feImage id="search-pill-glass-map" x="-24%" y="-14%" width="148%" height="128%" preserveAspectRatio="none" result="map"></feImage>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="118" xChannelSelector="R" yChannelSelector="B" result="dispRed"></feDisplacementMap>
      <feOffset in="dispRed" dx="-34" dy="0" result="dispRedShifted"></feOffset>
      <feMerge result="dispRedAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispRedShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispRedAligned" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="108" xChannelSelector="R" yChannelSelector="B" result="dispGreen"></feDisplacementMap>
      <feOffset in="dispGreen" dx="-34" dy="0" result="dispGreenShifted"></feOffset>
      <feMerge result="dispGreenAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispGreenShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispGreenAligned" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"></feColorMatrix>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="100" xChannelSelector="R" yChannelSelector="B" result="dispBlue"></feDisplacementMap>
      <feOffset in="dispBlue" dx="-34" dy="0" result="dispBlueShifted"></feOffset>
      <feMerge result="dispBlueAligned"><feMergeNode in="SourceGraphic"></feMergeNode><feMergeNode in="dispBlueShifted"></feMergeNode></feMerge>
      <feColorMatrix in="dispBlueAligned" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"></feColorMatrix>
      <feBlend in="red" in2="green" mode="screen" result="rg"></feBlend>
      <feBlend in="rg" in2="blue" mode="screen" result="output"></feBlend>
      <feGaussianBlur in="output" stdDeviation="0.35"></feGaussianBlur>
    </filter>
  </defs>
</svg>
<button id="bottom-handle" type="button" aria-label="展开播放器控制台" title="播放器控制台"><span></span></button>
<div id="bottom-bar">
  <div id="mini-queue-popover" class="mini-queue-popover" onclick="event.stopPropagation()">
    <div class="mini-queue-head">
      <div>
        <div class="mini-queue-title">当前队列</div>
        <div id="mini-queue-count" class="mini-queue-count">0 首</div>
      </div>
      <button class="fx-mini-btn ghost" onclick="closeMiniQueue()" title="关闭" style="height:26px;padding:0 9px;font-size:13px">×</button>
    </div>
    <div id="mini-queue-list" class="mini-queue-list"></div>
  </div>
  <div id="progress-bar"><div id="progress-fill"></div><div id="progress-thumb" aria-hidden="true"></div></div>
  <div id="controls">
    <div class="control-cluster actions">
      <div class="control-track">
        <div id="control-cover" class="control-cover cover-empty" aria-hidden="true"></div>
        <div class="control-meta">
          <div id="control-title" class="control-title" onclick="openTrackDetailModal('song')" title="歌曲详情"></div>
          <div id="control-artist" class="control-artist" onclick="openTrackDetailModal('artist')" title="歌手详情"></div>
        </div>
      </div>
      <div id="quality-control" class="quality-control">
        <button id="quality-btn" class="ctrl-btn quality-pill" onclick="toggleQualityPanel(event)" title="音质"><span id="quality-btn-label">臻音</span></button>
        <div class="quality-popover" onclick="event.stopPropagation()">
          <button class="quality-option svip-only" data-quality="jymaster" data-svip="1" onclick="setPlaybackQuality('jymaster')"><span>超清母带</span><small>SVIP / 最高规格</small></button>
          <button class="quality-option" data-quality="hires" onclick="setPlaybackQuality('hires')"><span>高清臻音</span><small>默认 / 细节优先</small></button>
          <button class="quality-option" data-quality="lossless" onclick="setPlaybackQuality('lossless')"><span>无损 SQ</span><small>FLAC 优先</small></button>
          <button class="quality-option" data-quality="exhigh" onclick="setPlaybackQuality('exhigh')"><span>极高 HQ</span><small>320kbps</small></button>
          <button class="quality-option" data-quality="standard" onclick="setPlaybackQuality('standard')"><span>标准</span><small>128kbps</small></button>
        </div>
      </div>
      <button id="heart-btn" class="ctrl-btn" onclick="toggleLikeCurrent()" title="红心喜欢"><svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.45c-.32 0-.62-.12-.86-.34l-1.23-1.12C5.54 16.03 2.25 13.05 2.25 8.9 2.25 5.48 4.88 2.9 8.28 2.9c1.7 0 3.35.72 4.52 1.96C13.97 3.62 15.62 2.9 17.32 2.9c3.4 0 6.03 2.58 6.03 6 0 4.15-3.29 7.13-7.66 11.09l-1.23 1.12c-.24.22-.54.34-.86.34z"/></svg></button>
      <button id="collect-btn" class="ctrl-btn" onclick="openCollectModalForCurrent()" title="收藏到歌单"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
    </div>
    <div class="control-cluster transport">
    <button id="play-mode-btn" class="ctrl-btn" onclick="cyclePlayMode()" title="播放顺序"><svg id="play-mode-icon" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></button>
    <button id="prev-btn" class="ctrl-btn" onclick="prevTrack()" title="上一首"><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
    <button id="play-btn" class="ctrl-btn" onclick="togglePlay()" title="播放/暂停"><svg id="play-icon" width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
    <button id="next-btn" class="ctrl-btn" onclick="nextTrack()" title="下一首"><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
    <button id="mini-queue-btn" class="ctrl-btn" onclick="toggleMiniQueue(event)" title="当前队列"><svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg></button>
    </div>
    <div class="control-cluster modes">
    <button class="ctrl-btn lyrics-toggle-btn" onclick="toggleLyricsPanel()" title="歌词"><span class="lyrics-word-icon">词</span></button>
    <div id="speed-control" class="speed-control">
      <button id="speed-btn" class="ctrl-btn speed-pill" onclick="toggleSpeedPanel(event)" title="播放倍速"><span id="speed-btn-label">1x</span></button>
      <div class="speed-popover" onclick="event.stopPropagation()">
        <button class="speed-option" data-rate="0.5" onclick="setPlaybackRate(0.5)">0.5x</button>
        <button class="speed-option" data-rate="0.75" onclick="setPlaybackRate(0.75)">0.75x</button>
        <button class="speed-option" data-rate="1" onclick="setPlaybackRate(1)">1x</button>
        <button class="speed-option" data-rate="1.25" onclick="setPlaybackRate(1.25)">1.25x</button>
        <button class="speed-option" data-rate="1.5" onclick="setPlaybackRate(1.5)">1.5x</button>
        <button class="speed-option" data-rate="2" onclick="setPlaybackRate(2)">2x</button>
      </div>
    </div>
    <div id="volume-control" class="volume-control">
      <button id="volume-btn" class="ctrl-btn" onclick="toggleVolumePanel(event)" title="音量 / 静音"><svg id="volume-icon" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 9.5a4 4 0 0 1 0 5"/></svg></button>
      <div class="volume-popover" onclick="event.stopPropagation()">
        <input id="volume-slider" type="range" min="0" max="1" step="0.01" value="1" aria-label="音量">
        <span id="volume-value">100%</span>
      </div>
    </div>
    <button id="controls-hide-btn" class="ctrl-btn active" onclick="toggleControlsAutoHide()" title="控制条自动隐藏"><svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 8h14"/><path d="M8 12h8"/><path d="M10 16h4"/></svg></button>
    <button id="immersive-btn" class="ctrl-btn" onclick="toggleImmersiveMode()" title="全沉浸式" aria-label="全沉浸式" aria-pressed="false"><svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M15 4h4a1 1 0 0 1 1 1v4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/><path d="M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.2"/></svg></button>
    <button class="ctrl-btn fullscreen-toggle-btn" onclick="toggleFullscreen()" title="全屏 (F)"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7V3h4"/><path d="M21 7V3h-4"/><path d="M3 17v4h4"/><path d="M21 17v4h-4"/></svg></button>
    <div id="time-display">0:00 / 0:00</div>
    </div>
  </div>
</div>
</template>
