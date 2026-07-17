<template>
<!-- 顶部右侧 (只保留用户) -->
<div id="top-right">
  <button id="user-capsule-hide-btn" class="user-capsule-hide-btn" type="button" onclick="toggleUserCapsuleAutoHide(event)" title="自动隐藏账号胶囊">‹</button>
  <button id="home-btn" class="icon-btn" onclick="goHome()" title="回到 Home" aria-label="回到 Home">
    <svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M3 10.8 12 3l9 7.8"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-5h5v5"/></svg>
  </button>
  <div id="fullscreen-diy-zone">
    <button id="fullscreen-diy-btn" class="desktop-mode-btn" type="button" onclick="toggleDiyMode()" title="DIY" aria-label="DIY" aria-pressed="false">DIY</button>
  </div>
  <button id="user-btn" class="icon-btn logged-out" onclick="onUserBtnClick()" title="登录账号">
    <span class="login-word">登录</span>
  </button>
</div>

<button id="fx-fab" title="视觉控制台">
  <svg width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M4 7h8"/><path d="M16 7h4"/><circle cx="14" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/></svg>
</button>
<button id="fx-fab-hide-btn" type="button" onclick="toggleFxFabAutoHide(event)" title="自动隐藏视觉控制台">‹</button>
</template>
