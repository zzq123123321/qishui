# Mineradio

粒子音乐可视化播放器 + 多平台音乐聚合

## 功能特性

- 🎵 多平台音乐聚合：网易云音乐、QQ音乐、汽水音乐
- 🎨 粒子动画可视化
- 🎤 歌词同步显示
- 🎧 本地音频分析

## 汽水音乐支持

### 登录方式

1. 安装汽水音乐客户端（Windows）
2. 在客户端中登录账号
3. 启动 Mineradio，自动检测并同步登录状态

### 播放支持

- ✅ 免费歌曲完整播放
- ✅ 付费歌曲限时免费权益
- ✅ 加密音频本地解密
- ✅ 音质选择（标准/高品质/无损）

### Windows 环境要求

- Windows 10/11
- 汽水音乐客户端 3.5.x（用于登录和解密）
- Node.js 18+

### 已知限制

- 汽水音乐登录依赖本地客户端（需安装）
- 加密歌曲需要客户端解密模块就绪
- 部分歌曲可能因版权限制无法播放

## 快速开始

### 开发环境

```bash
npm install
npm run dev
```

### 构建

```bash
npm run build        # 构建前端
npm run pack         # 打包 Electron
npm run dist:win     # Windows 安装包
```

## 项目结构

```
Mineradio/
├── server.js                    # 主服务器
├── server/
│   └── providers/
│       └── soda/                # 汽水音乐模块
│           ├── soda-signing.js      # 签名层
│           ├── soda-api-client.js   # API 客户端
│           ├── soda-playback-resolver.js  # 播放解析
│           └── soda-provider.js     # 门面层
├── src/
│   └── legacy/
│       └── mineradio.js         # 前端主逻辑
├── electron/
│   ├── main.cjs                 # Electron 主进程
│   └── preload.cjs              # 预加载脚本
└── scripts/
    ├── dev.cjs                  # 开发脚本
    └── verify-soda-e2e.js       # 汽水链路验证
```

## API 接口

### 汽水音乐

- `GET /api/soda/search?keywords=xxx` - 搜索歌曲
- `GET /api/soda/song/url?id=xxx` - 获取播放地址
- `GET /api/soda/audio?token=xxx` - 音频流代理

### 网易云音乐

- `GET /api/search?keywords=xxx` - 搜索歌曲
- `GET /api/song/url?id=xxx` - 获取播放地址

### QQ 音乐

- `GET /api/qq/search?keywords=xxx` - 搜索歌曲
- `GET /api/qq/song/url?mid=xxx` - 获取播放地址

## 开发说明

详见 `AGENTS.md` 了解模块架构和开发规范。
