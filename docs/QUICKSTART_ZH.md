# 首次使用指南

这份指南面向第一次部署和给同事体验的场景。先确认系统能打开、能上传、能看到任务和导出入口，再判断模型识别是否完整。

## 只打开一个入口

浏览器只打开：

```text
http://localhost:3000
```

`8000`、`8080`、`8081`、`8082` 都是服务端口，不是用户页面。

## 第一次启动

### Docker 轻量模式

```bash
npm run setup
cp .env.docker.example .env
docker compose up -d
```

这个模式用于检查页面、API、上传校验和基础工作流。它不代表 OCR、HaS Text、HaS Image 或 VLM 已经具备完整识别能力。

### 复用已有服务

如果本机已经有后端、前端或模型服务在运行：

```bash
npm run dev:attach
```

Windows 用户可以双击仓库根目录的 `start-dev.bat`。

## 检查 3000 和 8000

| 地址 | 用途 | 成功表现 |
| --- | --- | --- |
| `http://localhost:3000` | 用户界面 | 浏览器能打开 DataInfra 页面 |
| `http://127.0.0.1:8000/health` | 后端健康检查 | 返回 JSON |

Bash / WSL：

```bash
curl -I http://localhost:3000
curl http://127.0.0.1:8000/health
```

PowerShell：

```powershell
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8000/health
```

如果 `3000` 不通，先看前端；如果 `8000` 不通，先看后端。`8000` 是 API，不是产品界面。

## 检查模型/GPU

完整识别依赖模型服务。先运行：

```bash
npm run doctor
curl http://127.0.0.1:8000/health/services
```

状态说明：

- `online`：服务可用。
- `degraded`：服务启动中或正在预热。
- `offline`：服务不可用，不能做真实识别。

需要完整 GPU 模型服务时运行：

```bash
docker compose --profile gpu up -d
```

模型权重由本机维护，不提交到 Git。默认路径和下载说明见 [MODELS.md](./MODELS.md)。

## 推荐验证顺序

1. 打开 `http://localhost:3000`。
2. 上传一个小文件。
3. 跑单文件识别。
4. 看复核页是否有文本实体、OCR 框、视觉框。
5. 导出结果文件。
6. 单文件稳定后，再创建批量任务。

不要一开始就用大批量文件判断系统是否可用。先用小文件确认端到端路径。

## 模型预热

预热脚本只调用已经运行的模型服务，不负责启动服务：

```bash
curl http://127.0.0.1:8080/v1/models
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8082/health
WARMUP_MAX_WAIT_SECONDS=180 node scripts/run-python.mjs backend/scripts/warmup_models.py
```

如果模型服务在 Docker 里发布到宿主机，建议从 WSL/宿主 shell 跑预热脚本。普通 `docker compose exec backend` 里的 `127.0.0.1` 指向 backend 容器自身，通常访问不到其他模型容器。

## 常见误区

- `5176` 不是默认前端入口；默认看 `3000`。
- 前端状态为红色时，先查 `/health/services`，不要只看某个进程是否存在。
- 模型服务启动不等于模型已经加载完成，`degraded` 时等预热或继续观察。
- 私有测试文件、token、真实业务数据、Playwright 结果和本机绝对路径不要提交到 Git。

## 下一步

- 启动模式：[RUN_MODES.md](./RUN_MODES.md)
- 模型说明：[MODELS.md](./MODELS.md)
- API 调用：[API.md](./API.md)
- 排错：[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
