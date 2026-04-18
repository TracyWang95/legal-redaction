#!/usr/bin/env bash
# HaS Text NER：本地 llama-server，端口 8080。
#
# 默认：后台启动，日志与 PID 写入 backend/logs/
# 前台调试：HAS_TEXT_FOREGROUND=1 ./scripts/run_has_text_llama_server.sh
#           或 ./scripts/run_has_text_llama_server.sh --foreground
#
# 说明（重要）：
# llama-server 若编译时未检测到 OpenSSL，则内置下载器不支持 HTTPS，使用
#   -hf … + HF_ENDPOINT=https://hf-mirror.com
# 会报错「HTTPS is not supported」。
#
# 推荐流程（无需重编译）：
#   1) ./scripts/download_has_text_gguf.sh
#   2) ./scripts/run_has_text_llama_server.sh
#      （默认读取 backend/models/has/HaS_Text_0209_0.6B_Q4_K_M.gguf）
#
# 若已安装 libssl-dev 并在 llama.cpp 中重新 cmake 编译出支持 HTTPS 的二进制，
# 可设置 USE_HF_DOWNLOAD=1 走 -hf 在线拉取（仍需 HF_ENDPOINT 镜像）。
#
# 覆盖 llama-server 路径：
#   LLAMA_CPP_BUILD=/path/to/llama.cpp/build ./scripts/run_has_text_llama_server.sh
#
# 停止示例：kill $(cat backend/logs/has_text_llama.pid)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG="${BACKEND_DIR}/logs"
mkdir -p "${LOG}"

FOREGROUND=0
for a in "$@"; do
  if [[ "$a" == "--foreground" || "$a" == "-f" ]]; then
    FOREGROUND=1
  fi
done
case "${HAS_TEXT_FOREGROUND:-}" in 1|true|yes|TRUE|YES) FOREGROUND=1 ;; esac

LLAMA_CPP_BUILD="${LLAMA_CPP_BUILD:-/home/spark/Desktop/work/llama.cpp/build}"
SERVER="${LLAMA_CPP_BUILD}/bin/llama-server"

DEFAULT_GGUF="${BACKEND_DIR}/models/has/HaS_Text_0209_0.6B_Q4_K_M.gguf"
MODEL_PATH="${HAS_TEXT_GGUF:-${DEFAULT_GGUF}}"

USE_HF_DOWNLOAD="${USE_HF_DOWNLOAD:-0}"

if [[ ! -x "${SERVER}" ]]; then
  echo "错误: 未找到可执行文件: ${SERVER}" >&2
  echo "请设置 LLAMA_CPP_BUILD 指向你的 llama.cpp/build。" >&2
  exit 1
fi

ARGS=(
  --host 0.0.0.0
  --port 8080
  -ngl 99
  -c 8192
  -np 1
)

_run_foreground() {
  exec "$@"
}

_run_background() {
  nohup "$@" >>"${LOG}/has_text_llama.log" 2>&1 &
  local pid=$!
  echo "${pid}" >"${LOG}/has_text_llama.pid"
  echo "[llama-server] 已后台启动 PID=${pid}"
  echo "[llama-server] 日志: ${LOG}/has_text_llama.log"
  echo "[llama-server] 停止: kill \$(cat ${LOG}/has_text_llama.pid)"
  echo "[llama-server] 探活: curl -sS http://127.0.0.1:8080/v1/models | head -c 200"
}

if [[ "${USE_HF_DOWNLOAD}" == "1" ]]; then
  export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
  echo "[llama-server] 模式: -hf（需 llama-server 编译含 HTTPS/OpenSSL）"
  echo "[llama-server] HF_ENDPOINT=${HF_ENDPOINT}"
  if [[ "${FOREGROUND}" == "1" ]]; then
    _run_foreground "${SERVER}" -hf "xuanwulab/HaS_Text_0209_0.6B_Q4" "${ARGS[@]}"
  else
    _run_background "${SERVER}" -hf "xuanwulab/HaS_Text_0209_0.6B_Q4" "${ARGS[@]}"
    exit 0
  fi
fi

if [[ ! -f "${MODEL_PATH}" ]]; then
  echo "错误: 未找到本地 GGUF: ${MODEL_PATH}" >&2
  echo "" >&2
  echo "请先下载模型（使用系统 wget/curl，不依赖 llama 内置 HTTPS）：" >&2
  echo "  ./scripts/download_has_text_gguf.sh" >&2
  echo "" >&2
  echo "或自行指定路径：" >&2
  echo "  HAS_TEXT_GGUF=/path/to/HaS_Text_0209_0.6B_Q4_K_M.gguf ./scripts/run_has_text_llama_server.sh" >&2
  echo "" >&2
  echo "若坚持使用 -hf 在线下载，请先安装 libssl-dev 并重新编译 llama.cpp，然后：" >&2
  echo "  USE_HF_DOWNLOAD=1 HF_ENDPOINT=https://hf-mirror.com ./scripts/run_has_text_llama_server.sh" >&2
  exit 1
fi

echo "[llama-server] 模式: 本地 -m（推荐，无需 llama HTTPS）"
echo "[llama-server] ${SERVER}"
echo "[llama-server] -m ${MODEL_PATH}"

if [[ "${FOREGROUND}" == "1" ]]; then
  _run_foreground "${SERVER}" -m "${MODEL_PATH}" "${ARGS[@]}"
else
  _run_background "${SERVER}" -m "${MODEL_PATH}" "${ARGS[@]}"
fi
