# 下载失败任务删除支持

## 变更

在下载列表的失败状态行中增加删除按钮，与已完成任务删除使用同一逻辑。

### 变更文件

**`src/components/mineradio/DownloadWidget/DownloadCenter.vue`**
- 失败任务行末尾新增 🗑 删除按钮（与 🔄 重试并列）
- 点击后弹出和已完成相同的确认弹窗
- 确认后调用 `POST /api/download/delete`

**后端逻辑（无变更）**
- `deleteDownload(jobId)` 已正确处理失败任务：
  1. 从 store 移除下载记录
  2. 删除 `filePath`（如果存在）
  3. 删除 `Songs/{sourceId}/` 目录（如果存在）
  4. 从 `activeJobs` Map 中移除

### 操作统一

| 状态 | 操作 |
|------|------|
| 下载中 | 取消 |
| 完成 | 播放 / 打开 / 删除 |
| 失败 | 重试 / 删除 |

### 验证
- `POST /api/download/delete` 对失败 jobId 返回 `{"success":true}`
- 应用启动正常
- Build 通过
