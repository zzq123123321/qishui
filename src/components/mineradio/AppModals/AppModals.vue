<template>
<div id="weather-region-modal" class="modal-mask">
  <div class="modal region-modal">
    <div class="region-modal-head">
      <div>
        <div class="region-modal-kicker">WEATHER LOCATION</div>
        <h2>切换省市区</h2>
      </div>
      <button class="region-close-btn" type="button" onclick="closeWeatherRegionModal()" aria-label="关闭">×</button>
    </div>
    <label class="region-search-wrap">
      <input id="weather-region-search" type="search" autocomplete="off" spellcheck="false" placeholder="搜省 / 市 / 区">
    </label>
    <div id="weather-region-status" class="region-picker-status"></div>
    <div class="region-picker-columns">
      <section class="region-picker-column" aria-label="省份">
        <div class="region-picker-column-head">PROVINCE</div>
        <div id="weather-region-province-list" class="region-picker-list"></div>
      </section>
      <section class="region-picker-column" aria-label="城市">
        <div class="region-picker-column-head">CITY</div>
        <div id="weather-region-city-list" class="region-picker-list"></div>
      </section>
      <section class="region-picker-column" aria-label="区县">
        <div class="region-picker-column-head">DISTRICT</div>
        <div id="weather-region-district-list" class="region-picker-list"></div>
      </section>
    </div>
    <div id="weather-region-current" class="region-current-line"></div>
    <div class="btn-row">
      <button class="modal-btn" type="button" onclick="closeWeatherRegionModal()">取消</button>
      <button id="weather-region-apply" class="modal-btn primary" type="button" onclick="applyWeatherRegionSelection()">使用这个位置</button>
    </div>
  </div>
</div>

<!-- 登录模态 -->
<div id="login-modal" class="modal-mask">
  <div class="modal dual-login-modal">
      <div class="login-platform-tabs" id="login-platform-tabs">
        <button id="login-provider-netease" class="netease active" type="button" onclick="setLoginProvider('netease')">网易云</button>
        <button id="login-provider-qq" class="qq" type="button" onclick="setLoginProvider('qq')">QQ 音乐</button>
        <button id="login-provider-soda" class="soda" type="button" onclick="setLoginProvider('soda')">汽水音乐</button>
      </div>
    <div class="login-intro">
      <div class="login-intro-kicker">Mineradio</div>
      <div class="login-intro-title">音乐播放器，也是一座视觉舞台</div>
      <div class="login-intro-body">搜索或导入一首歌即可播放；登录后会同步歌单、红心和播客，让封面、歌词和粒子跟着音乐动起来。</div>
    </div>
    <h2 id="login-modal-title">扫码登录网易云音乐</h2>
    <div id="login-modal-desc" class="desc">使用 <b>网易云音乐 App</b> 扫码，可同步歌单、红心与播客。</div>
    <div id="qr-shell" class="qr-shell">
      <img id="qr-img" src="" alt="">
      <button id="qq-web-login-card" class="qq-login-mark" type="button" onclick="openProviderWebLogin()"><b>QQ</b><span>打开官方扫码窗口</span></button>
    </div>
    <div id="qr-status">正在生成二维码…</div>
    <div class="btn-row">
      <button class="modal-btn" onclick="closeLoginModal()">取消</button>
      <button class="modal-btn" onclick="skipLoginAndFocusSearch()">先搜索一首歌</button>
      <button id="login-both-btn" class="modal-btn" onclick="requestDualLoginMode()">我两个都要</button>
      <button id="refresh-qr-btn" class="modal-btn primary" onclick="refreshQr()">刷新二维码</button>
    </div>
  </div>
</div>

<!-- 用户模态 -->
<div id="user-modal" class="modal-mask">
  <div class="modal dual-user-modal">
    <h2>账号信息</h2>
    <div id="account-provider-chip" class="account-provider-chip netease"><span class="account-source-dot netease"></span><span>网易云音乐</span></div>
    <img id="user-modal-avatar" src="" style="width:72px;height:72px;border-radius:50%;margin:0 auto 12px;object-fit:cover;background:rgba(255,255,255,0.1);display:block">
    <div id="user-modal-name" style="font-size:15px;margin-bottom:4px"></div>
    <div id="user-modal-vip" style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:20px;letter-spacing:.5px"></div>
    <div class="user-platform-tabs" id="user-platform-tabs">
      <button id="user-provider-netease" class="netease active" type="button" onclick="setActiveAccountProvider('netease')">网易云</button>
      <button id="user-provider-qq" class="qq" type="button" onclick="setActiveAccountProvider('qq')">QQ 音乐</button>
      <button id="user-provider-soda" class="soda" type="button" onclick="setActiveAccountProvider('soda')">汽水音乐</button>
      <button id="user-provider-both" class="both" type="button" onclick="enableDualAccountView()">全部同步</button>
    </div>
    <div class="account-modal-actions">
      <button id="account-add-netease" class="modal-btn" onclick="openProviderLogin('netease')">补登网易云</button>
      <button id="account-add-qq" class="modal-btn" onclick="openProviderLogin('qq')">补登 QQ 音乐</button>
      <button id="account-add-soda" class="modal-btn" onclick="openProviderLogin('soda')">补登汽水音乐</button>
    </div>
    <div id="account-hint" class="account-hint">可在这里切换或补登音乐平台，首页、歌单和红心会按当前平台同步。</div>
    <div class="btn-row">
      <button id="account-refresh-btn" class="modal-btn" onclick="refreshActiveAccountInfo()">刷新账号信息</button>
      <button class="modal-btn" onclick="closeUserModal()">关闭</button>
      <button id="account-logout-btn" class="modal-btn primary" onclick="logoutActiveAccount()">退出当前平台</button>
    </div>
  </div>
</div>

<!-- 封面裁剪模态 -->
<div id="cover-crop-modal" class="modal-mask">
  <div class="modal cover-crop-modal">
    <h2>裁剪封面</h2>
    <div class="cover-crop-layout">
      <div id="cover-crop-stage" class="cover-crop-stage">
        <img id="cover-crop-img" alt="">
      </div>
      <div class="cover-crop-side">
        <canvas id="cover-crop-preview" width="160" height="160"></canvas>
        <label class="cover-zoom-control">
          <span>缩放</span>
          <input id="cover-crop-zoom" type="range" min="1" max="3.2" step="0.01" value="1">
        </label>
      </div>
    </div>
    <div class="btn-row">
      <button class="modal-btn" onclick="closeCoverCropModal()">取消</button>
      <button class="modal-btn primary" onclick="commitCoverCrop()">使用封面</button>
    </div>
  </div>
</div>

<!-- 收藏到歌单模态 -->
<div id="collect-modal" class="modal-mask">
  <div class="modal collect-modal">
    <h2>收藏到歌单</h2>
    <div id="collect-current" class="collect-current"></div>
    <div class="collect-create">
      <input id="collect-new-name" type="text" placeholder="新建歌单名称" autocomplete="off" maxlength="40">
      <button class="modal-btn primary" onclick="createPlaylistFromCollect()">创建</button>
    </div>
    <div id="collect-list" class="collect-list"></div>
    <div class="btn-row">
      <button class="modal-btn" onclick="closeCollectModal()">关闭</button>
    </div>
  </div>
</div>

<div id="local-beat-modal" class="modal-mask">
  <div class="modal local-beat-modal">
    <h2>本地节奏分析</h2>
    <div class="local-beat-track">
      <div id="local-beat-title" class="local-beat-track-title">本地歌曲</div>
      <div id="local-beat-sub" class="local-beat-track-sub">选择一种电影视角分析方式</div>
    </div>
    <div class="local-beat-tabs">
      <button id="local-beat-tab-mr" class="local-beat-tab active" type="button" onclick="selectLocalBeatMode('mr')">
        <b>MR 分析</b><span>日常电影视角</span>
      </button>
      <button id="local-beat-tab-dj" class="local-beat-tab" type="button" onclick="selectLocalBeatMode('dj')">
        <b>DJ 分析</b><span>长混音/强节奏</span>
      </button>
    </div>
    <div id="local-beat-desc" class="local-beat-desc"></div>
    <div id="local-beat-status" class="local-beat-status"></div>
    <div class="btn-row">
      <button id="local-beat-later-btn" class="modal-btn" onclick="closeLocalBeatModal()">暂不分析</button>
      <button id="local-beat-cancel-btn" class="modal-btn" onclick="cancelLocalBeatAnalysis()" style="display:none">取消</button>
      <button id="local-beat-start-btn" class="modal-btn primary" onclick="startLocalBeatAnalysis()">开始分析</button>
    </div>
  </div>
</div>

<div id="custom-lyric-modal" class="modal-mask">
  <div class="modal custom-lyric-modal">
    <h2>自定义歌词</h2>
    <div class="custom-lyric-track">
      <div id="custom-lyric-title" class="custom-lyric-title">当前歌曲</div>
      <div id="custom-lyric-sub" class="custom-lyric-sub">支持 LRC 时间轴，也可以直接输入纯文本歌词</div>
    </div>
    <textarea id="custom-lyric-input" class="custom-lyric-input" spellcheck="false" placeholder="[00:12.00] 第一行歌词&#10;[00:16.50] 第二行歌词&#10;&#10;没有时间轴也可以，每一行会按歌曲时长自动铺开"></textarea>
    <div id="custom-lyric-status" class="custom-lyric-status"></div>
    <div class="btn-row">
      <button class="modal-btn" onclick="deleteCustomLyricForCurrent()">删除</button>
      <button class="modal-btn" onclick="closeCustomLyricModal()">关闭</button>
      <button class="modal-btn primary" onclick="saveCustomLyricForCurrent()">保存使用</button>
    </div>
  </div>
</div>

<div id="track-detail-modal" class="modal-mask">
  <div class="modal track-detail-modal">
    <h2 id="track-detail-heading">歌曲详情</h2>
    <div id="track-detail-body"></div>
    <div class="btn-row">
      <button class="modal-btn" onclick="closeTrackDetailModal()">关闭</button>
    </div>
  </div>
</div>

<div id="bubble-reply-modal" class="modal-mask">
  <div class="modal bubble-reply-modal">
    <h2>气泡弹幕</h2>
    <div class="bubble-preview-card">
      <div id="bubble-preview-meta" class="bubble-preview-meta"></div>
      <div id="bubble-preview-text" class="bubble-preview-text"></div>
      <button id="bubble-preview-like-btn" class="bubble-preview-like" type="button" onclick="toggleBubbleCommentLikeFromModal()"></button>
    </div>
    <textarea id="bubble-reply-input" class="bubble-reply-input" maxlength="160" placeholder="回复这条弹幕"></textarea>
    <div id="bubble-reply-status" class="bubble-reply-status"></div>
    <div class="btn-row">
      <button class="modal-btn" onclick="closeBubbleReplyModal()">关闭</button>
      <button id="bubble-reply-submit" class="modal-btn primary" onclick="submitBubbleReply()">同步回复</button>
    </div>
  </div>
</div>

<div id="home-list-modal" class="modal-mask">
  <div class="modal home-list-modal">
    <div class="home-list-head">
      <div>
        <div id="home-list-kicker" class="home-list-kicker">NETEASE</div>
        <div id="home-list-title" class="home-list-title">每日推荐</div>
        <div id="home-list-sub" class="home-list-sub">点击歌曲即可播放</div>
      </div>
      <button class="home-list-close" type="button" onclick="closeHomeListModal()">×</button>
    </div>
    <div id="home-list-body" class="home-list-body"></div>
  </div>
</div>

<div id="update-modal" class="modal-mask">
  <div class="modal update-modal">
    <div class="update-panel-inner">
      <div class="update-panel-head">
        <div>
          <div class="update-kicker">MINERADIO</div>
          <div id="update-modal-title" class="update-title">New release</div>
          <div id="update-modal-version" class="update-version">v1.0.10</div>
        </div>
      </div>
      <div class="update-hero">
        <div id="update-hero-main" class="update-hero-main">电影镜头更稳，音源兜底更顺。</div>
        <div id="update-hero-sub" class="update-hero-sub"></div>
      </div>
      <div id="update-list" class="update-list"></div>
      <div class="update-actions">
        <button id="update-primary-btn" class="update-primary-btn" type="button" onclick="startUpdatePreviewDownload()">
          <span id="update-btn-fill" class="update-btn-fill"></span>
          <span id="update-btn-label" class="update-btn-label">立即更新</span>
        </button>
        <button id="update-secondary-btn" class="update-secondary-btn" type="button" onclick="closeUpdatePanel()">暂不更新</button>
      </div>
      <div id="update-footnote" class="update-footnote">预览版只演示更新手感，不会真的下载安装。</div>
    </div>
  </div>
</div>
</template>
