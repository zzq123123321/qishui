<template>
<input type="file" id="file-input" accept=".mp3,.flac,.wav,.ogg,.m4a,.jpg,.jpeg,.png,.webp" multiple style="display:none">
<input type="file" id="background-image-input" accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" style="display:none">
<div id="drop-overlay"><div class="drop-text">拖放音乐或封面</div></div>
<div id="free-camera-hint"><b>自由镜头</b> R 固定/退出 · WASD 移动 · 鼠标转向 · Shift 加速 · Space/Ctrl 升降 · Q/E 轻微旋转 · 滚轮景深 · K 回正</div>
<div id="loading-overlay"><div class="spinner"></div></div>

<canvas id="login-guide-canvas" aria-hidden="true"></canvas>
</template>
