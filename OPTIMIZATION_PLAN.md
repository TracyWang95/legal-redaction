# Legal-Redaction 终极优化方案 v3

> 本地 4090 单机 · 聚焦可维护性 · 不增加复杂度
> 基于：全面代码审查 + 76 项 E2E 测试 + 5 项手动痛点 + Codex GPT-5.4 审核 + 多轮排版迭代

---

## 一、已完成的修复（12 commits）

### 测试基础设施
| # | 内容 | 验证 |
|---|------|------|
| ✅ | E2E 测试套件 76 项（导航/API/Playground/Batch 全链路/排队/GPU） | 69 基础 + 1 全链路通过 |
| ✅ | `npm run test:e2e` 命令 + Playwright 配置 | 2.2 分钟跑完 |
| ✅ | 全链路测试覆盖 5 步（真实 3 文件混合上传） | 含图片+docx 混合 |

### 批量流程修复（用户 5 项痛点）
| # | 内容 |
|---|------|
| ✅ | Step3 去掉"开始批量识别"，只保留"提交后台队列" |
| ✅ | Step3 "下一步"按钮始终显示（灰色+进度），全部完成变绿 |
| ✅ | Step3 提交按钮即时反馈（"提交中…"） |
| ✅ | Step4 逐份锁定：未确认脱敏不能切下一张 |
| ✅ | Step4 去掉"返回识别"冗余按钮 |
| ✅ | Step4 图像三列布局（原图+标注 | 脱敏预览 | 检测区域） |
| ✅ | 全部文件完成才能进入审核（canGoStep 从 anyDone→allDone） |

### 后端修复
| # | 内容 |
|---|------|
| ✅ | 任务队列 item 去重（防重复处理） |
| ✅ | 队列 worker 失败兜底（unhandled exception → FAILED） |
| ✅ | 队列取消检测（job cancelled 时跳过 item） |
| ✅ | 队列状态聚合修复（全部终态→AWAITING_REVIEW） |
| ✅ | 文件上传时设置 isImageMode（根因修复） |
| ✅ | 轮询更新时补设 isImageMode（防图片走文字 UI） |
| ✅ | Compare 接口输出类型不匹配时抛明确错误 |

---

## 二、Codex GPT-5.4 审核发现的回归 Bug（必修）

> 两轮 Codex review 共发现 8 个问题，去重后 8 项。

### 第一轮（审核 uncommitted diff）

| # | 等级 | 问题 | 文件 | 修复方案 |
|---|------|------|------|----------|
| CR-1 | P1 | JSON→SQLite 迁移丢失历史文件 | `files.py:229` | 迁移前 `os.path.realpath()` 规范化路径 |
| CR-2 | P1 | `skip_item_review=true` 任务卡死 | `task_queue.py:212` | 识别完成后检查配置，自动入队 redaction |
| CR-3 | P1 | 重启恢复入队逻辑错误 | `main.py:146-157` | `review_approved` 入队为 redaction，不重跑识别 |
| CR-4 | P2 | requeue-failed 状态转换失败 | `jobs.py:472` | `QUEUED` → `PENDING` |
| CR-5 | P2 | 文件注册 400 被吞为 500 | `files.py:690` | `isinstance(e, HTTPException)` 先 re-raise |

### 第二轮（审核 v3 方案后的 diff）

| # | 等级 | 问题 | 文件 | 修复方案 |
|---|------|------|------|----------|
| CR-6 | P1 | 重启时 `processing` 状态的 job 不被重新调度 | `job_store.py:327-330` | `list_schedulable_jobs()` 加入 `processing` 状态 |
| CR-7 | P1 | 全部 item 失败时 job 状态被标为 awaiting_review 而非 failed | `task_queue.py:338-346` | `_refresh_job_status` 中全失败→FAILED，混合→AWAITING_REVIEW |
| CR-8 | P2 | `_progress_from_items()` 不统计 `processing` 状态 | `jobs.py:136-149` | 加入 PROCESSING 到进度计算 |
| CR-9 | P2 | JWT revoke-all 环境变量模式下重启后失效 | `auth.py:99-108` | 写文件时同步清除环境变量覆盖，或启动时优先读文件 |

> CR-4 和第二轮的 requeue 问题相同（已合并）。

---

## 三、待实施优化项

### P0 — 快速修复（每项 < 30 分钟）

| # | 内容 | 文件 | 改动量 |
|---|------|------|--------|
| P0-1 | 微服务 CORS `["*"]` → localhost | `ocr_server.py:31`, `has_image_server.py:36` | 2 行 |
| P0-2 | 添加 404 路由 | `router.tsx` | 1 组件 + 1 行 |
| P0-3 | OnboardingGuide 国际化 | `OnboardingGuide.tsx` | ~20 行 |
| P0-4 | OnboardingGuide 键盘支持 | `OnboardingGuide.tsx` | ~15 行 |
| P0-5 | 清理 console.log | `Playground.tsx:650,958` | 删 3-5 行 |

### P0-B — Step4 图像审阅排版完善

| # | 内容 | 说明 |
|---|------|------|
| P0-B1 | 列 1 bbox 交互验证 | 当前 bbox 在三列布局下可能因容器高度问题不渲染，需验证 `height:100%` 方案是否生效 |
| P0-B2 | 列 2 脱敏预览与列 1 尺寸一致 | 脱敏预览图的标题栏需与 ImageBBoxEditor 内部工具栏同高 |
| P0-B3 | 三列顶部对齐 | 列 1 工具栏 / 列 2 标题栏 / 列 3 标题栏起始高度一致 |

---

### P1 — 可维护性改善（每项 1-2 小时）

| # | 内容 | 目标 |
|---|------|------|
| P1-1 | **拆分 Batch.tsx（~3600 行）** | < 800 行/文件 |
| | → `hooks/useBatchWizardState.ts` | wizard 状态（cfg, rows, step） |
| | → `hooks/useBatchRecognition.ts` | 识别/轮询逻辑 |
| | → `hooks/useBatchReview.ts` | 审阅状态（undo/redo, boxes, entities） |
| | → `batch/BatchStep4ImageReview.tsx` | 图像审阅三列 UI |
| | → `batch/BatchStep4TextReview.tsx` | 文本审阅 UI |
| | → `batch/BatchStep5Export.tsx` | 导出 UI |
| P1-2 | 拆分 Playground.tsx（~1600 行） | 提取 `usePlaygroundRecognition` hook |
| P1-3 | 提取魔法数字为常量 | `constants/timeouts.ts`, `constants/thresholds.py` |
| P1-4 | 消除 `any` 类型（9 处） | 新增 2 个 interface |

---

### P2 — 后端代码质量（每项 2-4 小时）

| # | 内容 | 现状 → 目标 |
|---|------|-------------|
| P2-1 | 重构 `_match_entities_to_ocr()` | 144 行 → 3 个 <50 行子函数 |
| P2-2 | 重构 `_replace_in_paragraph()` | 118 行 → 2 个子函数 |
| P2-3 | 细化异常处理（5 处裸 Exception） | → 具体异常类型 |
| P2-4 | 去重类型映射（3 处重复） | → `type_config.py` 统一 |

---

### P3 — 测试补充（持续）

| # | 内容 |
|---|------|
| P3-1 | `hybrid_vision_service.py` 核心函数单元测试 |
| P3-2 | `redactor.py` 各脱敏模式测试 |
| P3-3 | ImageBBoxEditor 在三列布局下的交互 E2E |

---

## 四、不做的项

| 项目 | 原因 |
|------|------|
| CSRF 保护 | 本地单用户 |
| Rate Limit X-Forwarded-For | 无反向代理 |
| JWT 密钥 ACL | 本地 hidden 足够 |
| WCAG 审计 | 个人工具 |
| Celery + Redis | asyncio 队列够用 |

---

## 五、实施顺序

```
Phase 0 (1天)   CR-1~CR-9     Codex 发现的 8 个回归 Bug（两轮审核合并）
Phase 1 (半天)  P0-1~P0-5     快速修复
                P0-B1~P0-B3   Step4 排版完善
Phase 2 (2-3天) P1-1          拆分 Batch.tsx（最大改动，逐步拆+跑 E2E）
Phase 3 (1天)   P1-2~P1-4     Playground + 常量 + 类型
Phase 4 (2天)   P2-1~P2-4     后端重构
Phase 5 (持续)  P3-1~P3-3     补测试
```

每个 Phase 完成后：
```bash
cd frontend && PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e
```

---

## 六、E2E 测试安全网（当前状态）

| 测试文件 | 覆盖 | 数量 | 状态 |
|----------|------|------|------|
| api-health.spec.ts | 后端 10 个 API | 10 | ✅ |
| navigation.spec.ts | 侧边栏+暗色+响应式 | 14 | ✅ |
| playground.spec.ts | 单文件完整流程 | 7 | ✅ |
| batch-smoke.spec.ts | BatchHub 基本 | 7 | ✅ |
| batch.spec.ts | 批量创建+API | 7 | ✅ |
| batch-fullchain.spec.ts | **全链路 5 步** | 1 | ✅ |
| batch-workflow.spec.ts | 排队+GPU 显存 | 5 | ✅ |
| history.spec.ts | 处理历史 | 6 | ✅ |
| jobs.spec.ts | 任务中心 | 8 | ✅ |
| settings.spec.ts | 识别项+脱敏清单 | 7 | ✅ |
| model-settings.spec.ts | 模型配置 | 4 | ✅ |
| **合计** | | **76** | **全部通过** |

---

## 七、已知待观察项

1. **Step4 图像 bbox 在三列布局下可能不显示** — `height:100%` 方案依赖浏览器对 flex child 高度继承的实现，需在不同分辨率下验证
2. **全链路测试 Step4 确认按钮偶现"未就绪"** — `reviewLoading` 或 `reviewExecuteLoading` 在图片文件首次加载时可能阻塞，需排查 loadReviewData 时序
3. **历史记录已有脏数据** — 之前 isImageMode 缺失导致部分 docx 的 output_path 指向 .png，这些文件需重新脱敏
