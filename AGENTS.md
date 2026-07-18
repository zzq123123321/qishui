# AGENTS.md

本文件记录开发规范和模块架构，供 AI 助手和开发者参考。

## 架构概览

```
server.js (主服务器)
├── server/providers/soda/
│   ├── soda-signing.js         # 签名层
│   ├── soda-api-client.js      # API 客户端
│   ├── soda-playback-resolver.js  # 播放解析
│   └── soda-provider.js        # 门面层
└── src/legacy/mineradio.js     # 前端逻辑
```

## 汽水音乐模块 (server/providers/soda/)

### soda-signing.js

**职责**: 签名生成和验证

- `setup(deps)` - 注入依赖（一次性调用）
- `applySodaBdmsSignature(url, headers)` - 添加 BDMS 签名
- `applySodaBdticketSignature(url)` - 添加 BDTicket 签名
- `ensureSodaPlaybackSignatureReady(opts)` - 确保签名就绪
- `sodaPlaybackNativeStatus(opts)` - 获取播放器状态

**依赖**: sodaApiClient, requestJson, getUserAgent

### soda-api-client.js

**职责**: 汽水 API 请求

- `setup(deps)` - 注入依赖
- `sodaApiRequest(path, body, opts)` - 发送 API 请求
- `sodaCommonParams(extra)` - 生成通用参数

**依赖**: sodaSigning, requestJson, getUserAgent

### soda-playback-resolver.js

**职责**: 播放地址解析

- `setup(deps)` - 注入依赖
- `tryResolveSodaTrackV2(trackId, quality, options)` - 解析播放地址
- 内部函数: `buildTrackV2Body`, `parseTrackV2Response`, `selectPlayableMedia`

**依赖**: sodaApiClient, sodaSigning, requestJson

### soda-provider.js

**职责**: 播放编排门面

- `setup(deps)` - 注入依赖
- `resolvePlayback(trackId, quality, options)` - 编排完整播放流程

**流程**:
1. 刷新 Cookie
2. 确保签名就绪
3. 获取限免信息
4. 调用 resolver
5. 处理重试（限免/签名）

**依赖**: server.js 注入的函数

## 依赖方向

```
soda-provider → soda-playback-resolver → soda-api-client → soda-signing
```

**禁止**: 模块间循环依赖，soda 模块反向依赖 server.js

## 开发规范

### 修改原则

1. **提取而非重构**: 保持 server.js 路由入口不变
2. **行为保持**: 每个 Batch 必须通过真实环境验证
3. **依赖注入**: 模块通过 `setup()` 接收依赖，不直接 require server.js

### 测试流程

1. `node --check` 语法验证
2. 真实环境播放测试（免费/付费歌曲）
3. Git diff 确认无意外删除

### Git 规范

- 增量 commit，不重写历史
- 每个 Batch 一个 commit
- Commit message 格式: `type: description`

## 已知限制

- 汽水登录依赖本地客户端
- 加密歌曲需要解密模块就绪
- 部分歌曲因版权限制无法播放

## 文件说明

- `server.js` - 主服务器，路由和业务逻辑
- `server/providers/soda/*.js` - 汽水音乐模块
- `src/legacy/mineradio.js` - 前端主逻辑
- `scripts/verify-soda-e2e.js` - 汽水链路验证脚本
