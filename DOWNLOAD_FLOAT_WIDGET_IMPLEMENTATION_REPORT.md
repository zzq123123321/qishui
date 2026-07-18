# 下载浮标组件 UI 优化报告

## 变更概述

对现有的下载浮标组件进行交互和视觉增强，保持后端服务不变。

### 变更文件

**`src/components/mineradio/DownloadWidget/DownloadWidget.vue`**
- **Cover Fly 定位修复**: 从 `triggerCoverFly(fromX, fromY)` 获取点击位置，计算到右下角浮标的位移 `--fly-dx`/`--fly-dy`，实现精准飞入动画
- **下载中状态增强**: 进度环内部增加下载箭头动画（箭头 + 竖线脉冲）
- **完成状态**: 新增 `checkmarkVisible` 控制 ✓ 图标显示 3 秒后淡出；完成后恢复为下载箭头（颜色变淡），浮标保留完成微光动画
- **Hover 卡片重构**:
  - 顶部状态文字随当前状态变化（进行中 / 全部完成 / N 个失败）
  - 第一个卡片展示当前主任务（active > completed > failed），更大封面、粗体标题
  - 下方排列其他最近任务
- **空闲有任务状态**: 当所有任务完成但列表非空时，显示下载箭头 + 淡化颜色，而非完全隐藏

**`src/components/mineradio/DownloadWidget/DownloadWidget.scss`**
- 新增 `.hover-current-job` 系列样式，突出当前任务
- 新增 `arrow-pulse` 动画，下载箭头呼吸效果
- 新增 `completed-heartbeat` 动画，完成瞬间涟漪扩散效果
- 更新 `.is-completed .idle-icon` 颜色（淡化）

### 未修改

- server / download API / Provider / 文件结构
- Download Manager
- Download Center 数据逻辑
- 下载存储路径

### 交互流程

```
点击下载
  ↓
封面飞入右下角（从当前歌曲封面位置）
  ↓
浮标显示进度环 + 下载箭头脉冲
  ↓
下载完成 → ✓ 动画 + 涟漪扩散（3s）
  ↓
3s 后 ✓ 淡出 → 显示淡色下载箭头
  ↓
悬停 → 卡片显示当前任务 + 其他任务
  ↓
点击 → 打开 Download Center
```

### 浮标状态

| 状态 | 图标 | 颜色 | 动画 |
|------|------|------|------|
| 空闲（无任务） | 下载箭头 | 白色 70% | 无 |
| 空闲（有完成） | 下载箭头 | 白色 35% | 无 |
| 下载中 | 进度环 + 箭头 | 金色 #f4d28a | 呼吸 + 脉冲 |
| 完成（3s） | ✓ | 绿色 #4ade80 | check-pop + 涟漪 |
| 失败 | ✕ | 红色 #ff8f9d | shake |
| 悬停 | 卡片 | — | fade-in |

### 验证
- Build 通过
- 安装运行正常
- 下载测试通过
- `mediaPath`/`assetPath` 已写入 metadata.json
- Songs 目录命名格式为 `{sourceId}_{safeTitle}`

### 下一步建议
- v1.4.x 打 tag 稳定
- 回到 develop-ai 分支
- 继续 Embedding / User State / AI 层开发
