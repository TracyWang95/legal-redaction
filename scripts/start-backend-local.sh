#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PYTHONPATH="${PYTHONPATH:-$(pwd)/backend}"
export DEBUG="${DEBUG:-true}"
export AUTH_ENABLED="${AUTH_ENABLED:-false}"
export DATA_DIR="${DATA_DIR:-./data}"
export UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
export OUTPUT_DIR="${OUTPUT_DIR:-./outputs}"
export BATCH_RECOGNITION_PAGE_CONCURRENCY="${BATCH_RECOGNITION_PAGE_CONCURRENCY:-2}"
export OCR_BASE_URL="${OCR_BASE_URL:-http://127.0.0.1:8082}"
export HAS_IMAGE_BASE_URL="${HAS_IMAGE_BASE_URL:-http://127.0.0.1:8081}"
export HAS_LLAMACPP_BASE_URL="${HAS_LLAMACPP_BASE_URL:-http://127.0.0.1:8080/v1}"

if [[ -n "${DATAINFRA_PYTHON:-}" ]]; then
  python_bin="$DATAINFRA_PYTHON"
elif [[ -x ".venv/bin/python" ]]; then
  python_bin=".venv/bin/python"
elif [[ -x "$HOME/.cache/datainfra-redaction/.venv/bin/python" ]]; then
  python_bin="$HOME/.cache/datainfra-redaction/.venv/bin/python"
else
  python_bin="python"
fi
exec "$python_bin" -m uvicorn app.main:app \
  --app-dir "$(pwd)/backend" \
  --host "${BACKEND_HOST:-0.0.0.0}" \
  --port "${BACKEND_PORT:-8000}"
