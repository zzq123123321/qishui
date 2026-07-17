<template>
  <!-- 控制台 (右侧贴边自动显示, 无关闭按钮) -->
  <div id="fx-panel">
    <div class="fx-head">
      <div>
        <div class="fx-title">视觉控制台</div>
        <div class="fx-sub">MINERADIO VISUALS · 鼠标移开自动隐藏</div>
      </div>
    </div>

    <div class="fx-section-label">视觉预设</div>
    <div class="preset-grid" id="preset-grid"></div>
    <div class="fx-section-label">用户存档</div>
    <div class="user-archive-grid" id="user-archive-grid"></div>
    <div class="fx-section-label">自定义颜色</div>
    <div class="lyric-color-row">
      <input
        id="ui-accent-picker"
        class="lyric-color-picker"
        type="color"
        value="#00f5d4"
        title="界面高亮色"
      />
      <div class="fx-color-row-label">
        界面高亮<small id="ui-accent-value">#00F5D4</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetUiAccentColor()"
      >
        默认
      </button>
    </div>
    <div class="lyric-color-row visual-tint-row">
      <input
        id="visual-tint-picker"
        class="lyric-color-picker"
        type="color"
        value="#9db8cf"
        title="视觉主色"
      />
      <div class="fx-color-row-label">
        视觉主色<small id="visual-tint-value">封面取色</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        id="visual-tint-auto-btn"
        type="button"
        onclick="openCoverColorPicker('visualTint')"
      >
        封面
      </button>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetVisualTintColor()"
      >
        默认
      </button>
    </div>
    <div class="cover-color-pop" id="cover-color-pop">
      <div class="cover-color-head">
        <span>Cover Picker</span
        ><button
          class="cover-color-close"
          type="button"
          onclick="closeCoverColorPicker()"
        >
          ×
        </button>
      </div>
      <div class="cover-color-body">
        <div
          class="cover-color-art"
          id="cover-color-art"
          onclick="pickCoverColorFromArt(event)"
          onmousemove="moveCoverColorLoupe(event)"
          onmouseleave="hideCoverColorLoupe()"
        ></div>
        <div class="cover-color-side">
          <div class="cover-color-preview" id="cover-color-preview"></div>
          <div class="cover-color-hint" id="cover-color-hint">
            点击专辑封面任意位置取色，或使用下方推荐色。
          </div>
          <div class="cover-color-swatches" id="cover-color-swatches"></div>
        </div>
      </div>
    </div>
    <div class="color-lab-pop" id="color-lab-pop">
      <div class="color-lab-head">
        <span id="color-lab-title">Color</span
        ><button
          class="color-lab-close"
          type="button"
          onclick="closeColorLab()"
        >
          ×
        </button>
      </div>
      <div class="color-lab-sv" id="color-lab-sv">
        <div class="color-lab-cursor" id="color-lab-cursor"></div>
      </div>
      <div class="color-lab-row">
        <div class="color-lab-preview" id="color-lab-preview"></div>
        <input
          class="color-lab-hue"
          id="color-lab-hue"
          type="range"
          min="0"
          max="360"
          step="1"
        />
        <input
          class="color-lab-hex"
          id="color-lab-hex"
          type="text"
          value="#F00000"
          maxlength="7"
        />
      </div>
      <div class="color-lab-presets" id="color-lab-presets"></div>
    </div>
    <div class="cover-color-loupe" id="cover-color-loupe"></div>
    <div class="lyric-color-row">
      <input
        id="home-accent-picker"
        class="lyric-color-picker"
        type="color"
        value="#00f5d4"
        title="Home 填充色"
      />
      <div class="fx-color-row-label">
        Home 填充<small id="home-accent-value">#00F5D4</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetHomeAccentColor()"
      >
        默认
      </button>
    </div>
    <div class="lyric-color-row">
      <input
        id="home-icon-picker"
        class="lyric-color-picker"
        type="color"
        value="#f4d28a"
        title="主页图标"
      />
      <div class="fx-color-row-label">
        主页图标<small id="home-icon-value">#F4D28A</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetHomeIconColor()"
      >
        默认
      </button>
    </div>
    <div class="lyric-color-row">
      <input
        id="visual-icon-picker"
        class="lyric-color-picker"
        type="color"
        value="#7fd8ff"
        title="视觉图标"
      />
      <div class="fx-color-row-label">
        视觉图标<small id="visual-icon-value">#7FD8FF</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetVisualIconColor()"
      >
        默认
      </button>
    </div>
    <div class="fx-section-label">Home 问候卡</div>
    <div
      class="lyric-color-row home-greeting-config-row"
      id="home-greeting-title-row"
    >
      <div class="fx-color-row-label">
        主标题<small id="home-greeting-title-value">自动问候</small>
      </div>
      <div class="home-greeting-mode-row two">
        <button
          id="home-greeting-title-auto"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingTitleMode('auto')"
        >
          自动
        </button>
        <button
          id="home-greeting-title-custom"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingTitleMode('custom')"
        >
          自定义
        </button>
      </div>
      <input
        id="home-greeting-title-input"
        class="fx-text-input"
        type="text"
        maxlength="28"
        placeholder="例如：今天也要自由"
        oninput="setHomeGreetingText('title', this.value, true)"
        onchange="setHomeGreetingText('title', this.value)"
      />
    </div>
    <div
      class="lyric-color-row home-greeting-config-row"
      id="home-greeting-sub-row"
    >
      <div class="fx-color-row-label">
        副标题<small id="home-greeting-sub-value">自动播放状态</small>
      </div>
      <div class="home-greeting-mode-row">
        <button
          id="home-greeting-sub-auto"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingSubMode('auto')"
        >
          自动
        </button>
        <button
          id="home-greeting-sub-custom"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingSubMode('custom')"
        >
          自定义
        </button>
        <button
          id="home-greeting-sub-hide"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingSubMode('hide')"
        >
          隐藏
        </button>
      </div>
      <input
        id="home-greeting-sub-input"
        class="fx-text-input"
        type="text"
        maxlength="64"
        placeholder="例如：让今天慢慢亮起来"
        oninput="setHomeGreetingText('sub', this.value, true)"
        onchange="setHomeGreetingText('sub', this.value)"
      />
    </div>
    <div
      class="lyric-color-row home-greeting-config-row"
      id="home-greeting-note-row"
    >
      <div class="fx-color-row-label">
        右侧符号<small id="home-greeting-note-value">默认音符</small>
      </div>
      <div class="home-greeting-mode-row">
        <button
          id="home-greeting-note-default"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingNoteMode('default')"
        >
          默认
        </button>
        <button
          id="home-greeting-note-custom"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingNoteMode('custom')"
        >
          自定义
        </button>
        <button
          id="home-greeting-note-hide"
          class="fx-mini-btn ghost"
          type="button"
          onclick="setHomeGreetingNoteMode('hide')"
        >
          隐藏
        </button>
      </div>
      <input
        id="home-greeting-note-input"
        class="fx-text-input"
        type="text"
        maxlength="4"
        placeholder="♪"
        oninput="setHomeGreetingText('note', this.value, true)"
        onchange="setHomeGreetingText('note', this.value)"
      />
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetHomeGreetingConfig()"
      >
        恢复问候默认
      </button>
    </div>
    <div class="fx-section-label">背景媒体</div>
    <div class="lyric-color-row">
      <input
        id="bg-color-picker"
        class="lyric-color-picker"
        type="color"
        value="#000000"
        title="背景颜色"
      />
      <div class="fx-color-row-label">
        背景颜色<small id="bg-color-value">#000000</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="resetCustomBackgroundColor()"
      >
        &#23553;&#38754;
      </button>
    </div>
    <div class="lyric-color-row image-pick-row">
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="document.getElementById('background-image-input').click()"
      >
        选择
      </button>
      <div class="fx-color-row-label">
        背景媒体<small id="bg-image-value">未设置</small>
      </div>
      <button
        class="fx-mini-btn ghost"
        type="button"
        onclick="clearCustomBackgroundImage()"
      >
        清除
      </button>
    </div>
    <div class="fx-slider">
      <label>背景透明度</label
      ><input
        id="fx-bgopacity"
        type="range"
        min="0"
        max="1"
        step="0.01"
      /><output></output>
    </div>
    <div class="fx-toggle-grid">
      <div
        class="fx-toggle"
        id="t-bubbleDanmaku"
        onclick="toggleFx('bubbleDanmaku')"
        title="播放当前歌曲评论气泡"
      >
        <span>气泡弹幕</span><span class="dot"></span>
      </div>
    </div>
    <div class="fx-slider">
      <label>控制台玻璃色差</label
      ><input
        id="fx-glassaberration"
        type="range"
        min="0"
        max="140"
        step="1"
      /><output></output>
    </div>

    <div class="fx-section-label">主控</div>
    <div class="fx-slider">
      <label>律动强度</label
      ><input
        id="fx-intensity"
        type="range"
        min="0.2"
        max="1.6"
        step="0.01"
      /><output></output>
    </div>
    <div class="fx-slider">
      <label>立体感</label
      ><input
        id="fx-depth"
        type="range"
        min="0.2"
        max="1.8"
        step="0.01"
      /><output></output>
    </div>
    <div class="fx-slider">
      <label>封面清晰度</label
      ><input
        id="fx-coverres"
        type="range"
        min="0.75"
        max="1.55"
        step="0.01"
      /><output></output>
    </div>
    <div class="fx-slider">
      <label>镜头晃动</label
      ><input
        id="fx-cineshake"
        type="range"
        min="0"
        max="1.8"
        step="0.01"
      /><output></output>
    </div>
    <div class="fx-slider">
      <label>歌词溢光</label
      ><input
        id="fx-lyricglow"
        type="range"
        min="0"
        max="0.85"
        step="0.01"
      /><output></output>
    </div>

    <div class="fx-fold" id="fx-lyric-fold">
      <div
        class="fx-fold-head"
        onclick="
          document.getElementById('fx-lyric-fold').classList.toggle('open')
        "
      >
        <span class="fx-fold-title"
          ><strong>歌词外观</strong><small>颜色 / 来源 / 位置</small></span
        ><span class="arrow">▶</span>
      </div>
      <div class="fx-fold-body">
        <div class="fx-section-label">歌词颜色</div>
        <div class="lyric-color-grid" id="lyric-color-grid"></div>
        <div class="lyric-color-row">
          <input
            id="lyric-color-picker"
            class="lyric-color-picker"
            type="color"
            value="#a9b8c8"
            title="色轮取色"
          />
          <div class="lyric-color-value" id="lyric-color-value">封面取色</div>
          <button
            class="fx-mini-btn ghost"
            id="lyric-auto-btn"
            type="button"
            onclick="setLyricColorAuto()"
          >
            封面
          </button>
        </div>
        <div class="fx-section-label">高亮颜色</div>
        <div class="lyric-color-row">
          <input
            id="lyric-highlight-picker"
            class="lyric-color-picker"
            type="color"
            value="#fff0b8"
            title="高亮取色"
          />
          <div class="lyric-color-value" id="lyric-highlight-value">
            跟随歌词
          </div>
          <button
            class="fx-mini-btn ghost"
            id="lyric-highlight-auto-btn"
            type="button"
            onclick="setLyricHighlightAuto()"
          >
            跟随
          </button>
        </div>
        <div class="fx-section-label">溢光颜色</div>
        <div
          class="lyric-color-row linked"
          id="lyric-glow-row"
          onclick="handleLyricGlowRowClick(event)"
        >
          <input
            id="lyric-glow-picker"
            class="lyric-color-picker"
            type="color"
            value="#9db8cf"
            title="溢光取色"
          />
          <div class="lyric-color-value" id="lyric-glow-value">跟随高亮</div>
          <button
            class="fx-mini-btn ghost active"
            id="lyric-glow-link-btn"
            type="button"
            onclick="toggleLyricGlowLink(event)"
          >
            链接
          </button>
        </div>
        <div class="fx-section-label">歌词源</div>
        <div class="lyric-source-row">
          <div class="fx-seg lyric-source-seg" id="lyric-source-seg">
            <button
              id="lyric-source-original"
              type="button"
              class="active"
              onclick="setLyricSourceMode('original')"
            >
              原词
            </button>
            <button
              id="lyric-source-custom"
              type="button"
              onclick="setLyricSourceMode('custom')"
            >
              自定义
            </button>
          </div>
        </div>
        <div class="fx-section-label">歌词字体</div>
        <div class="fx-font-grid expanded" id="lyric-font-grid">
          <button type="button" data-font="sans" onclick="setLyricFont('sans')">
            默认
          </button>
          <button type="button" data-font="hei" onclick="setLyricFont('hei')">
            黑体
          </button>
          <button type="button" data-font="song" onclick="setLyricFont('song')">
            宋体
          </button>
          <button
            type="button"
            data-font="bold-song"
            onclick="setLyricFont('bold-song')"
          >
            粗宋
          </button>
          <button
            type="button"
            data-font="stone-song"
            onclick="setLyricFont('stone-song')"
          >
            石印宋
          </button>
          <button
            type="button"
            data-font="kai-song"
            onclick="setLyricFont('kai-song')"
          >
            楷宋
          </button>
          <button
            type="button"
            data-font="serif-en"
            onclick="setLyricFont('serif-en')"
          >
            Serif
          </button>
          <button
            type="button"
            data-font="gothic"
            onclick="setLyricFont('gothic')"
          >
            Gothic
          </button>
          <button
            type="button"
            data-font="editorial"
            onclick="setLyricFont('editorial')"
          >
            Editorial
          </button>
          <button
            type="button"
            data-font="humanist"
            onclick="setLyricFont('humanist')"
          >
            Humanist
          </button>
          <button type="button" data-font="mono" onclick="setLyricFont('mono')">
            等宽
          </button>
          <button
            type="button"
            data-font="display"
            onclick="setLyricFont('display')"
          >
            标题
          </button>
        </div>
        <div class="fx-slider">
          <label>字间距</label
          ><input
            id="fx-lyricspacing"
            type="range"
            min="-0.04"
            max="0.18"
            step="0.005"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>行距</label
          ><input
            id="fx-lyriclineheight"
            type="range"
            min="0.86"
            max="1.35"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>字重</label
          ><input
            id="fx-lyricweight"
            type="range"
            min="500"
            max="900"
            step="50"
          /><output></output>
        </div>
        <div class="fx-section-label">歌词布局</div>
        <div class="fx-slider">
          <label>歌词大小</label
          ><input
            id="fx-lyricscale"
            type="range"
            min="0.35"
            max="1.65"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>水平位置</label
          ><input
            id="fx-lyricx"
            type="range"
            min="-2.0"
            max="2.0"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>垂直位置</label
          ><input
            id="fx-lyricy"
            type="range"
            min="-1.2"
            max="1.35"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>景深位置</label
          ><input
            id="fx-lyricz"
            type="range"
            min="-1.6"
            max="1.6"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>上下角度</label
          ><input
            id="fx-lyrictiltx"
            type="range"
            min="-42"
            max="42"
            step="1"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>左右角度</label
          ><input
            id="fx-lyrictilty"
            type="range"
            min="-42"
            max="42"
            step="1"
          /><output></output>
        </div>
      </div>
    </div>

    <div class="fx-fold" id="fx-overlay-fold">
      <div
        class="fx-fold-head"
        onclick="
          document.getElementById('fx-overlay-fold').classList.toggle('open')
        "
      >
        <span class="fx-fold-title"
          ><strong>叠加效果</strong><small>粒子 / 镜头 / 溢光</small></span
        ><span class="arrow">▶</span>
      </div>
      <div class="fx-fold-body">
        <div class="fx-toggle-grid">
          <div class="fx-toggle" id="t-float" onclick="toggleFx('floatLayer')">
            <span>浮空粒子层</span><span class="dot"></span>
          </div>
          <div class="fx-toggle" id="t-cinema" onclick="toggleFx('cinema')">
            <span>电影镜头</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-lyricGlow"
            onclick="toggleFx('lyricGlow')"
          >
            <span>歌词溢光</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-lyricGlowBeat"
            onclick="toggleFx('lyricGlowBeat')"
          >
            <span>鼓点溢光</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-lyricGlowParticles"
            onclick="toggleFx('lyricGlowParticles')"
          >
            <span>歌词光粒</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-lyricCameraLock"
            onclick="toggleFx('lyricCameraLock')"
          >
            <span>歌词镜头绑定</span><span class="dot"></span>
          </div>
          <div class="fx-toggle" id="t-bloom" onclick="toggleFx('bloom')">
            <span>粒子溢光</span><span class="dot"></span>
          </div>
          <div class="fx-toggle" id="t-edge" onclick="toggleFx('edge')">
            <span>轮廓高亮</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-desktopLyrics"
            onclick="toggleFx('desktopLyrics')"
            title="全屏幕置顶歌词"
          >
            <span>桌面歌词</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-desktopLyricsClickThrough"
            onclick="toggleFx('desktopLyricsClickThrough')"
            title="锁定后防误触；鼠标移到桌面歌词上按中键可锁定/解锁"
          >
            <span>桌面歌词锁定</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-desktopLyricsCinema"
            onclick="toggleFx('desktopLyricsCinema')"
            title="桌面歌词绑定鼓点电影震动，基础漂浮始终保留"
          >
            <span>桌面歌词电影震动</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-desktopLyricsHighlight"
            onclick="toggleFx('desktopLyricsHighlight')"
            title="桌面歌词按播放进度高亮"
          >
            <span>桌面歌词高亮跟随</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-wallpaperMode"
            onclick="toggleFx('wallpaperMode')"
            title="只透明底层应用背景，保留视觉和控制区域"
          >
            <span>壁纸模式</span><span class="dot"></span>
          </div>
        </div>
        <div class="fx-section-label">桌面 / 壁纸</div>
        <div class="fx-slider">
          <label>桌面歌词大小</label
          ><input
            id="fx-desktoplyricssize"
            type="range"
            min="0.72"
            max="1.55"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>桌面歌词透明</label
          ><input
            id="fx-desktoplyricsopacity"
            type="range"
            min="0.28"
            max="1"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>桌面歌词高度</label
          ><input
            id="fx-desktoplyricsy"
            type="range"
            min="0.08"
            max="0.92"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-section-label">桌面帧数</div>
        <div class="fx-seg" id="desktop-lyrics-fps-seg">
          <button data-desktop-lyrics-fps="24">24</button>
          <button data-desktop-lyrics-fps="30">30</button>
          <button data-desktop-lyrics-fps="60">60</button>
          <button data-desktop-lyrics-fps="120">120</button>
          <button data-desktop-lyrics-fps="0">无上限</button>
        </div>
        <div class="fx-slider">
          <label>壁纸透明度</label
          ><input
            id="fx-wallpaperopacity"
            type="range"
            min="0.35"
            max="1"
            step="0.01"
          /><output></output>
        </div>
      </div>
    </div>

    <div class="fx-fold" id="fx-stage-fold">
      <div
        class="fx-fold-head"
        onclick="
          document.getElementById('fx-stage-fold').classList.toggle('open')
        "
      >
        <span class="fx-fold-title"
          ><strong>3D / 手势</strong><small>歌单架 / 摄像头交互</small></span
        ><span class="arrow">▶</span>
      </div>
      <div class="fx-fold-body">
        <div class="fx-section-label">3D 歌单架</div>
        <div class="fx-seg" id="shelf-seg">
          <button data-shelf="off">关闭</button>
          <button data-shelf="side" class="active">侧栏</button>
          <button data-shelf="stage">舞台</button>
        </div>

        <div class="fx-section-label">歌单架镜头</div>
        <div class="fx-seg" id="shelf-camera-seg">
          <button data-shelf-camera="dynamic" class="active">动态镜头</button>
          <button data-shelf-camera="static">静态镜头</button>
        </div>
        <div class="fx-section-label">歌单架显示</div>
        <div class="fx-seg" id="shelf-presence-seg">
          <button data-shelf-presence="auto" class="active">自动隐藏</button>
          <button data-shelf-presence="always">常驻</button>
        </div>
        <div class="fx-section-label">歌单架内容</div>
        <div class="fx-toggle-grid">
          <div
            class="fx-toggle"
            id="t-shelfShowPodcasts"
            onclick="toggleFx('shelfShowPodcasts')"
            title="关闭后 3D 歌单架不显示播客收藏"
          >
            <span>显示播客歌单</span><span class="dot"></span>
          </div>
          <div
            class="fx-toggle"
            id="t-shelfMergeCollections"
            onclick="toggleFx('shelfMergeCollections')"
            title="开启后我的歌单与收藏歌单按一条线连续滚动"
          >
            <span>合并收藏歌单</span><span class="dot"></span>
          </div>
        </div>
        <div class="fx-section-label">歌单架外观</div>
        <div class="lyric-color-row">
          <input
            id="shelf-accent-picker"
            class="lyric-color-picker"
            type="color"
            value="#f4d28a"
            title="歌单架颜色"
          />
          <div class="fx-color-row-label">
            歌单架颜色<small id="shelf-accent-value">#F4D28A</small>
          </div>
          <button
            class="fx-mini-btn ghost"
            type="button"
            onclick="resetShelfAccentColor()"
          >
            默认
          </button>
        </div>
        <div class="fx-slider">
          <label>歌单架大小</label
          ><input
            id="fx-shelfsize"
            type="range"
            min="0.65"
            max="1.45"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>左右位置</label
          ><input
            id="fx-shelfx"
            type="range"
            min="-1.2"
            max="1.2"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>上下位置</label
          ><input
            id="fx-shelfy"
            type="range"
            min="-0.9"
            max="0.9"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>前后景深</label
          ><input
            id="fx-shelfz"
            type="range"
            min="-0.9"
            max="0.9"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>侧向角度</label
          ><input
            id="fx-shelfangle"
            type="range"
            min="-30"
            max="30"
            step="1"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>整体透明度</label
          ><input
            id="fx-shelfopacity"
            type="range"
            min="0.25"
            max="1"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>背景透明度</label
          ><input
            id="fx-shelfbgalpha"
            type="range"
            min="0.25"
            max="0.98"
            step="0.01"
          /><output></output>
        </div>

        <div class="fx-section-label">摄像头交互</div>
        <div class="fx-seg" id="cam-seg">
          <button data-cam="off" class="active">关闭</button>
          <button data-cam="gesture">手势触碰</button>
        </div>
      </div>
    </div>

    <div class="fx-advanced" id="fx-advanced">
      <div
        class="fx-advanced-head"
        onclick="
          document.getElementById('fx-advanced').classList.toggle('open')
        "
      >
        <span>高级参数</span><span class="arrow">▶</span>
      </div>
      <div class="fx-advanced-body">
        <div class="fx-section-label">直播 / 后台</div>
        <div
          class="fx-seg"
          id="performance-background-seg"
          title="控制窗口隐藏、最小化或后台运行时的渲染策略"
        >
          <button data-performance-background="auto">自动优化</button>
          <button data-performance-background="keep">保持运行</button>
          <button data-performance-background="release">停止释放</button>
        </div>
        <div class="fx-section-label">画质档位</div>
        <div
          class="fx-seg"
          id="performance-quality-seg"
          title="控制可见状态下的渲染像素预算，重启后保留"
        >
          <button data-performance-quality="eco">低</button>
          <button data-performance-quality="balanced">中</button>
          <button data-performance-quality="high">高</button>
          <button data-performance-quality="ultra">超高</button>
        </div>
        <div class="fx-toggle-grid">
          <div
            class="fx-toggle"
            id="t-liveBackgroundKeep"
            onclick="toggleFx('liveBackgroundKeep')"
            title="开启后后台或最小化时保持视觉渲染，不进入低占用暂停"
          >
            <span>直播后台保持</span><span class="dot"></span>
          </div>
        </div>
        <div class="fx-slider">
          <label>粒子尺寸</label
          ><input
            id="fx-point"
            type="range"
            min="0.5"
            max="2.2"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>流速</label
          ><input
            id="fx-speed"
            type="range"
            min="0.2"
            max="2.5"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>扭曲</label
          ><input
            id="fx-twist"
            type="range"
            min="0"
            max="0.6"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>色彩张力</label
          ><input
            id="fx-color"
            type="range"
            min="0.5"
            max="2.0"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>溢光强度</label
          ><input
            id="fx-bloom"
            type="range"
            min="0"
            max="1.6"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>离散感</label
          ><input
            id="fx-scatter"
            type="range"
            min="0"
            max="0.5"
            step="0.01"
          /><output></output>
        </div>
        <div class="fx-slider">
          <label>背景压缩</label
          ><input
            id="fx-bgfade"
            type="range"
            min="0"
            max="1.2"
            step="0.01"
          /><output></output>
        </div>
      </div>
    </div>

    <div class="fx-actions">
      <button class="fx-mini-btn" onclick="resetFx()">恢复默认</button>
    </div>
  </div>
</template>
