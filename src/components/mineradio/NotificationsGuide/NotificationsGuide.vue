<template>
<div id="toast"></div>
<div id="source-fallback-notice" aria-live="polite">
  <div class="source-fallback-head">
    <div id="source-fallback-title" class="source-fallback-title">自动换源</div>
    <button class="source-fallback-close" type="button" onclick="closeSourceFallbackNotice()">×</button>
  </div>
  <div id="source-fallback-body" class="source-fallback-body"></div>
</div>

<div id="visual-guide" aria-live="polite" aria-hidden="true">
  <div class="visual-guide-scrim"></div>
  <div id="visual-guide-ring" class="visual-guide-ring"></div>
  <div id="visual-guide-card" class="visual-guide-card">
    <div id="visual-guide-kicker" class="visual-guide-kicker">Guide</div>
    <div id="visual-guide-title" class="visual-guide-title"></div>
    <div id="visual-guide-body" class="visual-guide-body"></div>
    <div id="visual-guide-hint" class="visual-guide-hint">页面可继续操作，也可以跳过引导</div>
    <div class="visual-guide-actions">
      <button type="button" onclick="closeVisualGuide(true)">跳过</button>
      <div id="visual-guide-progress" class="visual-guide-progress"></div>
      <button id="visual-guide-next" class="primary" type="button" onclick="nextVisualGuideStep()">下一步</button>
    </div>
  </div>
</div>
</template>
