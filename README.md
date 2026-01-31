# Legal Redaction 法律文件脱敏平台

<p align="center">
  <strong>面向律师的智能文件脱敏平台</strong><br>
  支持 Word / PDF / 图片敏感信息识别与脱敏处理<br>
  <b>全链路本地推理，无云端依赖</b>
</p>

---

## ✨ 功能特性

| 模块 | 说明 |
|------|------|
| 📄 **多格式支持** | Word (.doc/.docx)、PDF、图片 (.jpg/.png) |
| 🧠 **OCR + NER 双引擎** | PaddleOCR-VL-1.5（文字识别）+ Qwen3-0.6B（命名实体识别） |
| 👁️ **本地视觉识别** | GLM-4.6V-Flash（签名/公章/指纹/二维码/广告水印等） |
| ✏️ **交互式编辑** | 识别结果可选 / 可编辑 / 可拉框调整 |
| 🔄 **脱敏模式** | 智能替换 / 掩码 / 结构化替换 |
| 📊 **对比与导出** | 脱敏前后对比预览、下载 |
| 🧪 **测试用例** | `testdata/ce.png` |

---

## 📦 模型与 Pipeline

| Pipeline | 模型 | 用途 |
|----------|------|------|
| **OCR + HaS** | PaddleOCR-VL-1.5 + Qwen3-0.6B | 文字识别 & 命名实体（姓名/身份证/手机号等） |
| **GLM Vision** | GLM-4.6V-Flash-Q4_K_M.gguf + mmproj-F16.gguf | 视觉敏感区域（签名/公章/指纹/二维码等） |

---

## 🚀 快速开始

### 环境要求

- **操作系统**：Windows 10/11 或 Linux（WSL2 可选）
- **Python**：3.10+
- **Node.js**：18+
- **GPU**：NVIDIA（建议 RTX 4060 及以上，8GB+ 显存）

### 目录结构（建议）

```
<你的工作目录>/
├── llama.cpp/                  # llama.cpp 可执行文件
│   └── llama-server.exe        # 或 llama-server（Linux）
├── glm-models/                 # GLM 模型权重
│   ├── GLM-4.6V-Flash-Q4_K_M.gguf
│   └── mmproj-F16.gguf
└── legal-redaction/            # 本项目
    ├── backend/
    ├── frontend/
    └── ...
```

> **提示**：以下命令中的路径请根据你的实际目录结构调整。

---

### 1️⃣ 启动 GLM Vision（本地视觉服务）

```bash
# Windows PowerShell
cd <llama.cpp目录>
.\llama-server.exe ^
  -m <glm-models目录>\GLM-4.6V-Flash-Q4_K_M.gguf ^
  --mmproj <glm-models目录>\mmproj-F16.gguf ^
  --port 8081 -ngl 99 --ctx-size 4096 --jinja ^
  --flash-attn on --reasoning-budget 0 --mlock -np 1 -ub 1024
```

```bash
# Linux / WSL2
./llama-server \
  -m ../glm-models/GLM-4.6V-Flash-Q4_K_M.gguf \
  --mmproj ../glm-models/mmproj-F16.gguf \
  --port 8081 -ngl 99 --ctx-size 4096 --jinja \
  --flash-attn on --reasoning-budget 0 --mlock -np 1 -ub 1024
```

---

### 2️⃣ 启动 HaS（本地 NER 服务）

```bash
# Windows
.\llama-server.exe -hf xuanwulab/HaS_4.0_0.6B_GGUF --port 8080 -ngl 99
```

```bash
# Linux / WSL2
./llama-server -hf xuanwulab/HaS_4.0_0.6B_GGUF --port 8080 -ngl 99
```

---

### 3️⃣ 启动后端

```bash
cd backend
python -m venv venv        # 或使用 conda
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

### 4️⃣ 启动前端

```bash
cd frontend
npm install
npm run dev -- --port 3000
```

访问：**http://localhost:3000**

---

## 🛠️ 本地模型部署踩坑记录

### GLM-4.6V-Flash（重点）

| 问题 | 解决方案 |
|------|----------|
| `unknown projector type: glm4v` | 使用 **b7897+** 版本的 llama.cpp（旧版不支持 glm4v） |
| 视觉识别无响应 | 必须带 `--mmproj mmproj-F16.gguf` |
| `expected value for argument` | `--flash-attn` 新版必须写成 `--flash-attn on` |
| 推理速度慢 | 添加 `--reasoning-budget 0` 关闭思考过程 |
| 输出英文而非中文 | 后端已内置 system prompt 强制中文输出 |

**模型下载**：
- 主模型：[GLM-4.6V-Flash-Q4_K_M.gguf](https://huggingface.co/unsloth/GLM-4.6V-Flash-GGUF)
- 视觉投影：同仓库的 `mmproj-F16.gguf`

---

### PaddleOCR-VL-1.5

- 首次启动时会自动下载到本地缓存（约 2GB）
- 后续运行会复用缓存，无需重复下载

---

### HaS（Qwen3-0.6B）

- 通过 llama-server 的 `-hf` 参数自动拉取
- 后端默认连接 `http://127.0.0.1:8080/v1`

---

## 🧪 环境检查

Windows PowerShell：

```powershell
.\scripts\check_env.ps1
```

脚本会检查：
- Python / Node / npm
- NVIDIA 驱动
- 模型文件是否存在
- 各服务端口是否监听

---

## 🧪 冒烟测试

详见：`tests/smoke_test.md`

测试用例：`testdata/ce.png`

---

## 📁 项目结构

```
legal-redaction/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── api/             # API 路由
│   │   ├── core/            # 配置、客户端
│   │   └── services/        # 业务逻辑
│   └── requirements.txt
├── frontend/                # React + Vite 前端
│   ├── src/
│   │   ├── components/      # 通用组件
│   │   └── pages/           # 页面
│   └── package.json
├── scripts/                 # 环境检查脚本
├── testdata/                # 测试用例
└── tests/                   # 测试模板
```

---

## 📖 API 文档

- **Swagger UI**：http://localhost:8000/docs
- **ReDoc**：http://localhost:8000/redoc

---

## 🤝 贡献

欢迎 Issue 与 PR！详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 📄 许可证

[MIT License](./LICENSE)

---

## ⭐ Star History

如果这个项目对你有帮助，请点个 Star ⭐
