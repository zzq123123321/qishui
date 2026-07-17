<template>
<!-- 歌单/队列面板 (左侧贴边自动显示, 无关闭按钮) -->
<div id="playlist-panel">
  <div class="queue-head">
    <div><div class="fx-title">歌单 / 历史</div><div class="fx-sub">HISTORY · 按当前端自动切换</div></div>
    <div class="queue-head-act">
      <button id="playlist-pin-btn" class="fx-mini-btn ghost playlist-pin-btn" onclick="togglePlaylistPanelPinned()" title="常开歌单" aria-label="常开歌单"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6"/><path d="M5 15l4 4"/><path d="M14 4l-2 5-4 4-3 2 4 4 2-3 4-4 5-2z"/><path d="M9 19l-4 4"/></svg></button>
    </div>
  </div>
  <div class="panel-tabs">
    <button id="tab-queue" class="panel-tab active" onclick="switchPlaylistTab('queue')">历史播放</button>
    <button id="tab-pl" class="panel-tab" onclick="switchPlaylistTab('playlists')">我的歌单</button>
    <button id="tab-podcast" class="panel-tab" onclick="switchPlaylistTab('podcasts')">我的播客</button>
  </div>
  <div id="queue-pane">
    <div class="queue-toolbar">
      <div id="history-scope-chip" class="queue-chip">播放历史</div>
      <div style="display:flex;gap:6px">
        <button class="fx-mini-btn ghost" onclick="renderQueuePanel({ animate: true })" style="height:26px;padding:0 10px;font-size:11px">刷新</button>
      </div>
    </div>
    <div id="queue-list" class="queue-list"></div>
  </div>
  <div id="pl-pane" style="display:none">
    <div id="playlist-toolbar" class="queue-toolbar playlist-toolbar">
      <div id="playlist-sync-chip" class="queue-chip playlist-sync-chip">登录后同步各平台歌单</div>
      <div class="playlist-floating-tools">
        <button id="playlist-refresh-btn" class="fx-mini-btn ghost playlist-refresh-btn" onclick="refreshUserPlaylists(true)" title="刷新歌单" aria-label="刷新歌单">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18.5 2.8v3h-3"/><path d="M5.5 21.2v-3h3"/></svg>
          <span>刷新</span>
        </button>
        <button id="playlist-top-btn" class="fx-mini-btn ghost playlist-top-btn" onclick="scrollPlaylistPanelToTop()" title="返回顶部" aria-label="返回顶部">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>
          <span>返回顶部</span>
        </button>
      </div>
    </div>
    <div id="pl-list" style="margin-top:6px"></div>
  </div>
  <div id="podcast-pane" style="display:none">
    <div class="queue-toolbar">
      <div class="queue-chip">收藏 / 创建 / 喜欢</div>
      <button class="fx-mini-btn ghost" onclick="refreshUserPlaylists(true)" style="height:26px;padding:0 10px;font-size:11px">刷新</button>
    </div>
    <div id="podcast-list"></div>
  </div>
</div>
</template>
