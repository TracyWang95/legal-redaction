<div align="center">

# DataInfra &middot; RedactionEverything

**本地优先的非结构化数据匿名化工作台**

不止个人信息，也不止固定规则。RedactionEverything 面向合同、扫描件、图片、PDF、Word 和纯文本，使用语义模型、OCR、视觉检测和可配置清单，把需要保护的内容识别出来，再交给人工复核和导出流程。

[![License](https://img.shields.io/badge/license-Personal%20Commercial-blue.svg)](./LICENSE)
[![CI](https://github.com/TracyWang95/DataInfra-RedactionEverything/actions/workflows/ci.yml/badge.svg)](https://github.com/TracyWang95/DataInfra-RedactionEverything/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)
[![GitHub Stars](https://img.shields.io/github/stars/TracyWang95/DataInfra-RedactionEverything?style=social)](https://github.com/TracyWang95/DataInfra-RedactionEverything)

> 本项目采用自定义 [Personal Commercial License](./LICENSE)：个人可免费商用；公司、机构、政府、团队或其他组织的生产使用、集成、SaaS、托管服务和再分发需取得单独商业授权。
>
> 商业授权、支持服务、采购条款或定制交付请联系：**wwang11@alumni.nd.edu**。

<p>
  <a href="#项目简介">项目简介</a> &middot;
  <a href="#核心能力">核心能力</a> &middot;
  <a href="#快速开始">快速开始</a> &middot;
  <a href="#系统架构">系统架构</a> &middot;
  <a href="#模型服务">模型服务</a> &middot;
  <a href="#技术栈">技术栈</a> &middot;
  <a href="#安全与部署">安全与部署</a> &middot;
  <a href="#许可证">许可证</a>
</p>

</div>

---

## 项目简介

**RedactionEverything** 是一个面向本地部署的文档数据匿名化系统。它把非结构化文件拆成文本线和图像线处理，识别姓名、机构、证件号、账号、地址、金额、日期、印章、人脸、签字等敏感内容，再提供可视化复核、批量任务管理和结果导出。

项目的设计目标不是做一个只能识别少数 PII 的固定工具，而是提供一套可以被行业清单驱动的工作台：

- 通用清单覆盖个人、组织、通信、证件、账号、金额、时间、地址等基础敏感实体。
- 行业清单面向法律、金融、医疗场景，按行业语义补充专用识别项。
- 文本识别默认交给 HaS Text 语义模型；正则只作为自定义兜底项保留。
- 图像识别由 OCR + HaS、HaS Image YOLO 和 VLM checklist 组成，分别处理文字、可视区域和签字等语义视觉特征。
- 所有业务文件、配置、识别结果和导出物都保留在本地运行环境中。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| 单次处理 | 支持 TXT、DOCX、PDF、扫描 PDF、PNG、JPG 等文件，上传后直接识别、复核和导出 |
| 批量处理 | 配置清单、上传队列、批量识别、逐份审阅、统一导出，适合成组合同和资料包 |
| 任务中心 | 查看任务状态、进度、继续审阅、查看详情和删除；运行中任务需先取消后删除 |
| 处理结果 | 查看已处理文件、批量树状结果、单文件结果、分页选择和打包下载 |
| 文本语义识别 | HaS Text 按清单中的 NER 标签识别实体，不依赖内置穷举映射 |
| OCR + HaS | 图像和扫描件先抽取文字块，再用 HaS Text 做语义识别并回写坐标 |
| HaS Image YOLO | 检测人脸、指纹、证件、银行卡、印章、二维码、屏幕等视觉区域 |
| VLM checklist | 作为图像管道补充能力，默认聚焦签字等需要视觉语义判断的区域 |
| 配置清单 | 内置通用、法律、金融、医疗清单，也支持自定义文本、图像和兜底项 |
| 本地部署 | 前端、后端、模型服务都可以在本机或内网 GPU 环境中运行 |

---

## 快速开始

### 环境要求

| 依赖 | 推荐版本 |
|---|---|
| Node.js | 24 LTS |
| Python | 3.11 |
| GPU | NVIDIA GPU，建议 16 GB 显存用于完整图像管道 |
| CUDA | 按 Paddle / vLLM / llama.cpp 的本地版本匹配 |

模型权重、真实样本、上传文件、运行数据库和导出结果不随仓库提交。请按自己的本地路径配置。

### 启动后端

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

后端启动后可以检查：

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/health/services
```

### 启动前端

```bash
cd frontend
npm ci
npm run dev -- --host 0.0.0.0 --port 3000
```

打开：

```text
http://localhost:3000
```

### Docker

仓库保留 Dockerfile 和 compose 配置，适合做后端、前端和模型服务容器化。生产环境部署前请确认 `.env`、模型挂载、GPU runtime、认证和反向代理配置。

---

## 系统架构

```text
                   +------------------------+
                   |  TXT / DOCX / PDF / IMG |
                   +-----------+------------+
                               |
                   +-----------v------------+
                   |  FastAPI 编排与任务队列 |
                   +-----------+------------+
                               |
        +----------------------+----------------------+
        |                      |                      |
+-------v--------+     +-------v--------+     +-------v--------+
| 文本语义管道   |     | OCR + HaS 管道 |     | 视觉区域管道   |
| HaS Text NER   |     | OCR text boxes |     | YOLO / VLM     |
+-------+--------+     +-------+--------+     +-------+--------+
        |                      |                      |
        +----------------------+----------------------+
                               |
                   +-----------v------------+
                   |  坐标归一、去重、合并  |
                   +-----------+------------+
                               |
                   +-----------v------------+
                   |  人工复核、脱敏、导出  |
                   +------------------------+
```

---

## 模型服务

默认本地端口如下：

| 服务 | 默认端口 | 说明 |
|---|---:|---|
| 后端 API | 8000 | 上传、任务、配置、识别、导出 |
| 前端 | 3000 | 浏览器工作台 |
| HaS Text | 8080 | OpenAI 兼容接口，文本 NER |
| HaS Image | 8081 | YOLO11 视觉区域检测 |
| PaddleOCR-VL | 8082 | OCR、版面和文字框 |
| VLM | 8090 | OpenAI 兼容接口，视觉语义补充 |

常用环境变量：

```env
OCR_BASE_URL=http://127.0.0.1:8082
HAS_TEXT_RUNTIME=vllm
HAS_TEXT_VLLM_BASE_URL=http://127.0.0.1:8080/v1
HAS_IMAGE_BASE_URL=http://127.0.0.1:8081
VLM_BASE_URL=http://127.0.0.1:8090
VLM_MODEL_NAME=GLM-4.6V-Flash-Q4
```

显存紧张时，优先调整上下文、最大生成长度、并发和图像尺寸；不要让关键模型静默回退到 CPU，否则网页会表现为长时间无结果或服务探测离线。

---

## 配置清单

系统内置四类清单：

| 清单 | 用途 |
|---|---|
| 通用 | 个人、组织、证件、账号、联系方式、地址、金额、日期时间等基础敏感实体 |
| 法律 | 当事人、代理人、法院、案号、合同编号、案件事实和法律文书相关字段 |
| 金融 | 账户、卡号、交易、金额、机构、客户和金融业务资料 |
| 医疗 | 患者、医疗机构、检查、诊断、用药、病历和就诊信息 |

文本管道和图像管道的清单互相独立。新建清单时，每个模块都支持全选和清空，方便按场景快速裁剪。

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19、TypeScript、Vite、Tailwind CSS、Radix UI、Zustand |
| 后端 | FastAPI、Pydantic、SQLite、本地文件存储 |
| 文本识别 | HaS Text，vLLM 或 llama.cpp OpenAI 兼容服务 |
| OCR | PaddleOCR-VL / PP-Structure 相关能力 |
| 视觉检测 | HaS Image YOLO11、VLM checklist |
| 导出 | 文本、图片、PDF、Word 处理与批量打包 |

---

## 代码结构

```text
backend/
  app/          FastAPI 应用、任务队列、识别编排、脱敏和导出
  config/       内置识别清单和行业预设
  scripts/      本地模型服务启动与预热脚本

frontend/
  src/          React 工作台、任务中心、处理结果、单次处理、批量处理和配置清单
  public/       前端静态资源
```

---

## 安全与部署

- 仓库只包含应用代码和默认配置，不包含本地 `.env`、模型权重、样本数据、上传文件、运行数据库、日志或导出结果。
- 项目默认面向本地或内网部署；如需公网访问，请配置认证、访问控制、反向代理、TLS、日志留存和密钥轮换策略。
- 默认识别由模型能力和配置清单驱动；正则仅作为用户自定义兜底能力保留。
- 建议将模型、样本、任务数据和导出目录放在私有运行环境中管理，并用访问权限和备份策略单独保护。

---

## 贡献

欢迎提交 issue 和 PR。建议 PR 聚焦一个问题或一个功能，避免混入本地样本、实验脚本、模型权重和临时输出。

提交前至少确认：

```bash
cd backend
python -m ruff check app/

cd ../frontend
npm run build
```

---

## 许可证

本项目采用自定义 [Personal Commercial License](./LICENSE)：

- 个人可免费商用，包括个人项目、自由职业、咨询、研究、学习和演示。
- 公司、机构、政府、团队或其他组织的生产使用、产品集成、SaaS、托管服务、OEM、再分发和采购场景需要单独商业授权。
- 模型权重、第三方依赖和数据集遵循其各自许可证。

商业授权联系：**wwang11@alumni.nd.edu**。

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=TracyWang95/DataInfra-RedactionEverything&type=Date)](https://star-history.com/#TracyWang95/DataInfra-RedactionEverything&Date)
