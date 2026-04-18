#!/usr/bin/env bash
# 使用系统 wget/curl（自带 HTTPS）从 HF 镜像下载 GGUF，避开「未编译 OpenSSL 的 llama-server 无法用 -hf 拉 HTTPS」的问题。
#
# 用法（在 backend 目录下）：
#   ./scripts/download_has_text_gguf.sh
#
# 可选环境变量：
#   HF_MIRROR_BASE   默认 https://hf-mirror.com
#   DEST_DIR         默认 <backend>/models/has

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST_DIR="${DEST_DIR:-${BACKEND_DIR}/models/has}"
HF_MIRROR_BASE="${HF_MIRROR_BASE:-https://hf-mirror.com}"

FILENAME="HaS_Text_0209_0.6B_Q4_K_M.gguf"
REPO_PATH="xuanwulab/HaS_Text_0209_0.6B_Q4"
URL="${HF_MIRROR_BASE%/}/${REPO_PATH}/resolve/main/${FILENAME}"
OUT="${DEST_DIR}/${FILENAME}"

mkdir -p "${DEST_DIR}"

if [[ -f "${OUT}" ]]; then
  echo "[download] 已存在，跳过: ${OUT}"
  exit 0
fi

echo "[download] -> ${OUT}"
echo "[download] <- ${URL}"

if command -v wget >/dev/null 2>&1; then
  wget -c --show-progress -O "${OUT}.part" "${URL}"
  mv -f "${OUT}.part" "${OUT}"
elif command -v curl >/dev/null 2>&1; then
  curl -fL --retry 3 --retry-delay 2 -o "${OUT}.part" "${URL}"
  mv -f "${OUT}.part" "${OUT}"
else
  echo "错误: 需要 wget 或 curl" >&2
  exit 1
fi

echo "[download] 完成: ${OUT}"
