# DataInfra RedactionEverything

DataInfra RedactionEverything 是一个本地优先的脱敏工作台，面向文本、DOCX、PDF、扫描件和图片匿名化。项目把“识别 → 复核 → 脱敏 → 导出”做成同一个可审阅流程，并支持任务中心、批量处理、OCR、HaS 语义模型、HaS Image YOLO 和可选 VLM 视觉补充。

[English](./README_en.md) | [首次使用指南](./docs/QUICKSTART_ZH.md) | [文档](./docs/README.md) | [API](./docs/API.md) | [模型说明](./docs/MODELS.md)

## 浏览器入口

只需要打开：

```text
http://localhost:3000
```

其他端口是本地服务端点，不是产品页面：

| 服务 | 端口 | 用途 |
| --- | --- | --- |
| API | `8000` | FastAPI 后端、上传、任务、导出、健康检查 |
| HaS Text | `8080` | OpenAI 兼容文本语义识别服务 |
| HaS Image | `8081` | YOLO 视觉目标检测服务 |
| OCR | `8082` | OCR 和版面结构识别服务 |
| VLM | 按配置 | 可选视觉 checklist 补充，例如签字、手写内容 |

## 快速启动

推荐 Node.js 24；项目约束为 `>=20 <25`，`.nvmrc` 和 `.node-version` 已同步。

```bash
git clone https://github.com/TracyWang95/DataInfra-RedactionEverything.git
cd DataInfra-RedactionEverything
npm run setup
npm run dev
```

Windows 用户可以在仓库根目录双击：

```text
start-dev.bat
```

如果服务已经启动，只想复用现有后端、前端和模型服务：

```bash
npm run dev:attach
```

轻量 UI/API 或 Docker 模式参考：

```bash
cp .env.docker.example .env
docker compose up -d
```

完整 GPU 模型服务：

```bash
docker compose --profile gpu up -d
```

## 服务检查

```bash
npm run doctor
curl http://127.0.0.1:8000/health/services
```

状态含义：

- `online`：服务可用。
- `degraded`：服务已启动但仍在加载或预热。
- `offline`：服务不可用，不能作为真实识别能力判断。

## 使用流程

### 单次处理

1. 打开 `http://localhost:3000`。
2. 上传 TXT、DOCX、PDF、扫描 PDF、PNG 或 JPG。
3. 选择配置清单并运行识别。
4. 在同一页复核文本实体、OCR 框、HaS Image 框和可选 VLM 框。
5. 确认脱敏并导出文件。

### 批量处理

- 任务中心用于管理批量任务、进度、状态和继续审阅。
- 批量任务支持混合文件：DOCX、PDF、扫描件和图片可以在同一批次处理。
- 运行中任务需要先取消再删除。
- 处理结果页用于查看已处理文件、对比结果，并导出打包文件。

### 配置清单

配置清单把文本识别项、图像 OCR+HaS 识别项、视觉目标识别项和可选 VLM checklist 组合起来，供单次处理和批量处理复用。

默认策略：

- 文本识别默认交给 HaS 语义模型。
- 正则只作为明确 bad case 的自定义兜底项，默认不启用。
- 图像管道由 OCR+HaS、HaS Image YOLO 和可选 VLM 组成，不引入图像正则。
- 行业预设面向通用、法律、金融、医疗场景，标签尽量保持最小单元和低重叠。

## 模型边界

HaS Image 当前是固定 21-class visual target contract：

`face`, `fingerprint`, `palmprint`, `id_card`, `hk_macau_permit`, `passport`,
`employee_badge`, `license_plate`, `bank_card`, `physical_key`, `receipt`,
`shipping_label`, `official_seal`, `whiteboard`, `sticky_note`, `mobile_screen`,
`monitor_screen`, `medical_wristband`, `qr_code`, `barcode`, `paper`

默认关闭 `paper`，避免整页容器框过多。签字、手写字、签批意见等不属于当前 HaS Image 固定类别，建议由 OCR 证据、保守 fallback 或 VLM checklist 补充。
Signature, handwriting, and VLM-based signature evidence are not HaS Image classes; fallback or OCR visual labels should be reported separately.

模型权重不提交到仓库。路径、显存预算和来源说明见 [docs/MODELS.md](./docs/MODELS.md) 与 [docs/MODEL_PROVENANCE.md](./docs/MODEL_PROVENANCE.md)。

## 模型预热

`backend/scripts/warmup_models.py` 只调用已经启动的服务，不会启动或停止模型进程。

```bash
curl http://127.0.0.1:8080/v1/models
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8082/health
WARMUP_MAX_WAIT_SECONDS=180 node scripts/run-python.mjs backend/scripts/warmup_models.py
```

如果模型服务通过 Docker 发布到宿主机，建议从 WSL 或宿主 shell 运行预热脚本，不要在普通 `docker compose exec backend` 里直接跑，因为容器内 `127.0.0.1` 指向 backend 容器自身。

## 质量门禁

常用本地检查：

```bash
npm run quality:fast
npm run quality:frontend
```

公开评估使用公开或生成的 fixtures：

```bash
npm run eval:public -- output/playwright/eval-public-current
```

维护者私有文件评估只应在本机私有语料或 ignored manifest 上运行，不提交真实文件、token、绝对路径或生成报告。
Maintainer private corpus gates must run only after model services are healthy and the GPU is idle.

## 文档入口

- [docs/README.md](./docs/README.md)：文档地图
- [docs/QUICKSTART_ZH.md](./docs/QUICKSTART_ZH.md)：中文首次使用指南
- [docs/RUN_MODES.md](./docs/RUN_MODES.md)：启动模式
- [docs/API.md](./docs/API.md)：HTTP API
- [docs/MODELS.md](./docs/MODELS.md)：模型与类别契约
- [docs/MODEL_PROVENANCE.md](./docs/MODEL_PROVENANCE.md)：模型来源记录
- [docs/EVALUATION.md](./docs/EVALUATION.md)：公开评估与维护者评估
- [docs/QUALITY_AUDIT.md](./docs/QUALITY_AUDIT.md)：发布质量交接（quality audit handoff）
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)：本地排错

## 安全

建议本地或内网部署。不要把开发实例直接暴露到公网；生产部署需要补齐认证、CORS、反向代理、日志留存和密钥管理策略。

## 许可

源代码使用 [Apache License 2.0](./LICENSE)。
