<template>
<!-- 启动页 -->
<div id="splash">
  <canvas id="splash-canvas"></canvas>
  <div class="splash-bg-noise"></div>

  <!-- 主内容 -->
  <div class="splash-content">
    <div class="splash-wordmark" id="splash-wordmark" aria-label="Mineradio">
      <span class="splash-word-mine">Mine</span>
      <span class="splash-word-radio" aria-label="radio">rad<span class="splash-word-i" aria-hidden="true"></span><span class="splash-word-o">o</span></span>
    </div>
    <div class="splash-signal-line"></div>
    <div class="splash-sub">private visual radio</div>
    <div class="splash-enter" aria-hidden="true">点击进入</div>
  </div>
</div>

<div id="hint" aria-hidden="true"></div>

<!-- 顶部搜索 -->
<div id="search-area">
  <div id="search-stack">
    <div id="search-box">
      <svg id="search-icon" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input id="search-input" type="text" placeholder="搜索歌曲、歌手..." autocomplete="off" spellcheck="false">
    </div>
    <div id="search-mode-tabs" class="search-mode-tabs" role="tablist" aria-label="搜索来源">
      <button id="search-mode-song" type="button" onclick="setSearchMode('song')">综合</button>
      <button id="search-mode-netease" type="button" onclick="setSearchMode('netease')">网易云</button>
      <button id="search-mode-qq" type="button" onclick="setSearchMode('qq')">QQ</button>
      <button id="search-mode-soda" type="button" onclick="setSearchMode('soda')">汽水</button>
      <button id="search-mode-podcast" type="button" onclick="setSearchMode('podcast')">播客</button>
    </div>
    <div id="search-results"></div>
  </div>
  <div id="upload-actions">
    <button id="upload-btn" class="icon-btn" onclick="document.getElementById('file-input').click()" title="导入音乐或封面">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </button>
    <button id="clear-cover-btn" class="icon-btn" onclick="clearCustomCoverForCurrent()" title="取消自定义封面" aria-label="取消自定义封面">×</button>
    <div id="upload-tip" role="status" aria-live="polite">
      <button class="upload-tip-close" onclick="closeUploadTip(true)" aria-label="关闭提示">×</button>
      <span class="upload-tip-title">导入入口</span>
      这里支持上传歌曲，也可以给当前曲目换自定义封面。
    </div>
  </div>
</div>
</template>
