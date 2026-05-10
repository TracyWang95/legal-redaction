# DataInfra RedactionEverything

本地优先的文档脱敏工作台，面向 TXT、DOCX、PDF、扫描件和图片。核心流程是：

1. 上传文件
2. 选择识别清单
3. 使用文本、OCR、视觉模型识别敏感内容
4. 人工复核
5. 导出脱敏文件或批量包

项目默认在本机运行，不提交模型权重、私有样本、运行日志、上传文件或生成结果。

## 功能

- 单次处理：支持文本、Word、PDF、扫描 PDF、PNG、JPG。
- 批量处理：支持多文件任务、进度跟踪、继续审阅和统一导出。
- 任务中心：查看任务状态、进度、审阅入口和删除操作。
- 处理结果：查看已处理文件、对比结果，并导出打包文件。
- 配置清单：按通用、法律、金融、医疗等场景组合文本和图像识别项。
- 图像管道：OCR + HaS、HaS Image YOLO、可选 VLM checklist。

## 本地端口

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 前端 | `3000` | 浏览器入口 |
| 后端 API | `8000` | 上传、任务、识别、导出 |
| HaS Text | `8080` | 文本语义识别 |
| HaS Image | `8081` | 图像目标检测 |
| OCR | `8082` | OCR 和版面识别 |
| VLM | 按配置 | 可选视觉补充能力 |

## 快速启动

推荐 Node.js 24 和 Python 3.11+。先启动后端，再启动前端。

后端：

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

前端：

```bash
cd frontend
npm ci
npm run dev -- --host 0.0.0.0 --port 3000
```

启动后打开：

```text
http://localhost:3000
```

## 模型配置

模型路径和显存策略通过环境变量配置。常用项：

```env
HAS_TEXT_N_CTX=8192
GLM_FLASH_N_CTX=2048
OCR_BASE_URL=http://127.0.0.1:8082
HAS_BASE_URL=http://127.0.0.1:8080
HAS_IMAGE_BASE_URL=http://127.0.0.1:8081
```

当前推荐把 PaddleOCR-VL、HaS Text、HaS Image 和 GLM VLM 都放在 GPU/CUDA 路径上运行；如果显存紧张，优先降低上下文和并发，而不是让服务回退到 CPU。

## 使用流程

### 单次处理

1. 打开 `http://localhost:3000`。
2. 上传文件。
3. 选择文本配置清单和图像配置清单。
4. 运行识别。
5. 在结果页勾选、取消或调整识别结果。
6. 确认脱敏并导出。

### 批量处理

1. 选择配置清单。
2. 上传一批文件。
3. 等待批量识别完成。
4. 逐份继续审阅。
5. 全部确认后导出批量包。

## 代码结构

```text
backend/     FastAPI 后端、识别编排、文件处理、任务管理
frontend/    React 前端工作台
```

## 安全说明

- 不要把开发实例直接暴露到公网。
- 不要提交 `.env`、模型权重、真实样本、上传文件、数据库或导出结果。
- 生产环境需要补齐认证、反向代理、访问控制、日志保留和密钥管理策略。

## License

Apache License 2.0
