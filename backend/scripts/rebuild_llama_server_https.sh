#!/usr/bin/env bash
# 为 llama-server 启用 HTTPS（OpenSSL），以便使用 -hf 从 https://hf-mirror.com 下载模型。
#
# 需系统安装 OpenSSL 开发包，例如：
#   sudo apt-get update && sudo apt-get install -y libssl-dev
#
# 然后在 llama.cpp 构建目录重新配置并编译（保留你已有的 CUDA 等选项，仅补上 OpenSSL）：
#
#   export LLAMA_CPP_SRC=/home/spark/Desktop/work/llama.cpp
#   ./scripts/rebuild_llama_server_https.sh
#
# 若 CMake 缓存里曾经「未找到 OpenSSL」，配置后应看到类似：
#   OpenSSL found: ...

set -euo pipefail

LLAMA_CPP_SRC="${LLAMA_CPP_SRC:-/home/spark/Desktop/work/llama.cpp}"
BUILD_DIR="${BUILD_DIR:-${LLAMA_CPP_SRC}/build}"

if [[ ! -d "${BUILD_DIR}" ]]; then
  echo "错误: 构建目录不存在: ${BUILD_DIR}" >&2
  exit 1
fi

if ! pkg-config --exists openssl 2>/dev/null && [[ ! -f /usr/include/openssl/ssl.h ]]; then
  echo "错误: 未检测到 OpenSSL 开发头文件（openssl/ssl.h）。" >&2
  echo "请先安装，例如：sudo apt-get install -y libssl-dev" >&2
  exit 1
fi

cmake -S "${LLAMA_CPP_SRC}" -B "${BUILD_DIR}" -DLLAMA_OPENSSL=ON
cmake --build "${BUILD_DIR}" --target llama-server -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

echo "完成: ${BUILD_DIR}/bin/llama-server"
