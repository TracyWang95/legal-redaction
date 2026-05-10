# Model Files

The source repository does not include model weights. Full recognition needs
local OCR, text, and visual model assets that you have downloaded and are
allowed to use.

## Required Runtime Services

| Service | Purpose | Upstream | Local dev default | Docker target |
| --- | --- | --- | --- | --- |
| PaddleOCR-VL | OCR and layout parsing | `PaddlePaddle/PaddleOCR-VL` | Hugging Face cache used by vLLM | OCR container cache |
| HaS Text | Semantic text recognition | `xuanwulab/HaS_4.0_0.6B_GGUF` | `/mnt/d/has_models/HaS_Text_0209_0.6B_Q4_K_M.gguf` | `backend/models/has/HaS_Text_0209_0.6B_Q4_K_M.gguf` |
| HaS Image | Visual target detection | `xuanwulab/HaS_Image_0209_FP32` | `/mnt/d/has_models/sensitive_seg_best.pt` | `backend/models/has_image/sensitive_seg_best.pt` |
| GLM-4.6V-Flash | Optional checklist-driven VLM visual detection | `unsloth/GLM-4.6V-Flash-GGUF` | `D:/has_models/GLM-4.6V-Flash-Q4_K_M.gguf` plus `D:/has_models/mmproj-F16.gguf` | Not included by default |

## HaS Image Category Contract

HaS Image is fixed to 21 visual target classes:

`face`, `fingerprint`, `palmprint`, `id_card`, `hk_macau_permit`, `passport`,
`employee_badge`, `license_plate`, `bank_card`, `physical_key`, `receipt`,
`shipping_label`, `official_seal`, `whiteboard`, `sticky_note`,
`mobile_screen`, `monitor_screen`, `medical_wristband`, `qr_code`, `barcode`,
`paper`

The default active selection enables 20 classes and leaves `paper` off to avoid
large whole-page boxes. Enable `paper` manually only when you want that
container class.

The following are not HaS Image classes:

- `signature`
- `handwritten`
- `handwriting`
- `handwritten_signature`

Signature and handwriting detection are handled by the optional VLM stage, not
by HaS Image. OCR labels, explicit rules, or local fallback may create review
evidence, but they are not HaS Image model hits and must not be used for HaS
Image model-quality thresholds.

Image-pipeline code must not add regex-based recognizers for these visual
classes. Keep visual categories in `backend/app/core/has_image_categories.py`
aligned to the fixed 21 model classes, keep type aliases centralized in
`backend/app/models/type_mapping.py`, and keep VLM output separate with
`evidence_source="vlm_model"`.

`official_seal` redaction currently follows an explicit box-level replacement
flow: the detected seal region is replaced with a masked block, while the
surrounding page content stays untouched. We do not do background erasure,
whitening, or image inpainting for this class.

## Local Development Layout

The local scripts look in `/mnt/d/has_models` and `D:/has_models` first. This
keeps large files out of the Git workspace and works well for WSL users on
Windows.

The simplified local rule is:

- Python venvs run Python services only.
- `llama-server` runs GGUF services such as HaS Text and GLM-4.6V-Flash.
- Model files live in one external model directory, not under the repository.
- `.env` stores local paths and ports; shared manifests store only basenames,
  hashes, sizes, and upstream metadata.

```bash
mkdir -p /mnt/d/has_models
python -m pip install huggingface_hub

python - <<'PY'
from pathlib import Path
from shutil import copyfile
from huggingface_hub import hf_hub_download

target_dir = Path("/mnt/d/has_models")
target_dir.mkdir(parents=True, exist_ok=True)

has_text_src = hf_hub_download(
    repo_id="xuanwulab/HaS_4.0_0.6B_GGUF",
    filename="has_4.0_0.6B.gguf",
    local_dir=str(target_dir),
)
copyfile(has_text_src, target_dir / "HaS_Text_0209_0.6B_Q4_K_M.gguf")

hf_hub_download(
    repo_id="xuanwulab/HaS_Image_0209_FP32",
    filename="sensitive_seg_best.pt",
    local_dir=str(target_dir),
)
PY
```

Confirm:

```bash
ls -lh /mnt/d/has_models/HaS_Text_0209_0.6B_Q4_K_M.gguf
ls -lh /mnt/d/has_models/sensitive_seg_best.pt
npm run doctor
```

Use a different directory by setting:

```bash
HAS_MODEL_PATH=/path/to/HaS_Text_0209_0.6B_Q4_K_M.gguf npm run dev:models
HAS_IMAGE_WEIGHTS=/path/to/sensitive_seg_best.pt npm run dev:models
```

You can also put those values in `.env`.

### HaS Text GPU Runtime

The default local HaS Text launcher uses `llama-cpp-python`. That is simple, but
on machines that also run PaddleOCR and Torch in the same app venv, CUDA wheels
can pin incompatible NVIDIA runtime package versions. For GPU HaS Text, prefer
an external `llama-server` binary and let `npm run dev` manage it:

```bash
HAS_TEXT_SERVER_BIN=/path/to/llama-server \
HAS_TEXT_MODEL_PATH_FOR_SERVER=/path/to/HaS_Text_0209_0.6B_Q4_K_M.gguf \
HAS_TEXT_N_GPU_LAYERS=-1 \
HAS_TEXT_DEVICE=0 \
npm run dev:models
```

On Windows, `HAS_TEXT_SERVER_BIN` can point to `llama-server.exe`; set
`HAS_TEXT_MODEL_PATH_FOR_SERVER` to a Windows path if the binary does not accept
WSL paths. `HAS_TEXT_DEVICE` is optional. Use `llama-server --list-devices` to
choose the NVIDIA/Vulkan device when more than one device is visible.

Before starting the model server, validate the configuration and inspect the
exact command that `npm run dev:models` would use:

```bash
HAS_TEXT_SERVER_BIN=/path/to/llama-server \
HAS_TEXT_MODEL_PATH_FOR_SERVER=/path/to/HaS_Text_0209_0.6B_Q4_K_M.gguf \
npm run doctor:has-text-server
```

This doctor only checks paths, port, context, GPU-layer settings, and the
generated command preview. It does not start `llama-server`, load the GGUF, or
run inference.

If port 8080 is already serving a temporary CPU HaS Text process and the GPU may
be occupied by another application, run the non-mutating switch preflight first:

```bash
npm run has-text:gpu-preflight
```

It reports the current port listener PID, `/v1/models` response, configured
external server command, and `nvidia-smi` busy state. Treat a busy GPU warning as
a stop sign: leave the current service running until the GPU is idle.

### GLM-4.6V-Flash VLM Runtime

GLM-4.6V-Flash is an optional visual model used for checklist-style features
such as signatures or handwritten marks. It should run as a native
`llama-server` process, not as a Python package inside `.venv` or `.venv-vllm`.

For Windows plus WSL local development, keep the server binary and model paths
in `.env`:

```bash
GLM_FLASH_ENABLED=1
GLM_FLASH_SERVER_BIN=/mnt/d/llama.cpp/llama-server.exe
GLM_FLASH_MODEL_FOR_SERVER=D:/has_models/GLM-4.6V-Flash-Q4_K_M.gguf
GLM_FLASH_MMPROJ_FOR_SERVER=D:/has_models/mmproj-F16.gguf
GLM_FLASH_DEVICE=CUDA0
GLM_FLASH_N_CTX=2048
GLM_FLASH_N_PARALLEL=1
GLM_FLASH_START_DELAY_SEC=75
VLM_BASE_URL=http://127.0.0.1:8090
VLM_MODEL_NAME=GLM-4.6V-Flash-Q4
```

`npm run dev:models` starts this service when `GLM_FLASH_ENABLED=1`. The
generated command follows the Unsloth GLM-4.6V-Flash llama.cpp guidance:

```bash
llama-server \
  -m D:/has_models/GLM-4.6V-Flash-Q4_K_M.gguf \
  --mmproj D:/has_models/mmproj-F16.gguf \
  --host 0.0.0.0 --port 8090 \
  -a GLM-4.6V-Flash-Q4 \
  --jinja \
  -ngl auto \
  --flash-attn on \
  -fit on \
  -c 2048 \
  -np 1 \
  -ctk q8_0 \
  -ctv q8_0 \
  --temp 0.8 \
  --top-p 0.6 \
  --top-k 2 \
  --repeat-penalty 1.1 \
  --device CUDA0 \
  --mmproj-offload \
  --metrics
```

The backend uses non-streaming requests, disables thinking where the
OpenAI-compatible server accepts that option, compresses the image sent to VLM,
and caps detection output tokens. For throughput, keep OCR, HaS Image, and VLM
enabled together and use `VISION_DUAL_PIPELINE_PARALLEL=true` unless GPU memory
pressure forces a serial profile.

On 16GB GPUs, keep `GLM_FLASH_START_DELAY_SEC` enabled so PaddleOCR-VL vLLM can
reserve memory before GLM starts. GLM still uses `-fit on`, so it adapts to the
remaining device memory instead of racing the OCR service during startup.

## Docker Layout

Docker Compose mounts `./backend/models` into model containers:

- HaS Text: `backend/models/has/HaS_Text_0209_0.6B_Q4_K_M.gguf`
- HaS Image: `backend/models/has_image/sensitive_seg_best.pt`

```bash
mkdir -p backend/models/has backend/models/has_image
cp /mnt/d/has_models/HaS_Text_0209_0.6B_Q4_K_M.gguf backend/models/has/
cp /mnt/d/has_models/sensitive_seg_best.pt backend/models/has_image/

docker compose --profile gpu config --quiet
docker compose --profile gpu up -d
```

## PaddleOCR-VL

`npm run dev` starts vLLM for `PaddlePaddle/PaddleOCR-VL`. The model is
downloaded through the Hugging Face cache used by the vLLM environment. There is
no static PaddleOCR-VL file expected under `backend/models/`.

If you change the OCR model release, update the served model name, OCR adapter
settings, and evaluation baselines together.

## Environment Variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `HAS_MODEL_PATH` | Local HaS Text server | Absolute path to the HaS Text GGUF. |
| `HAS_TEXT_SERVER_BIN` | Local HaS Text server | Optional external `llama-server` binary for GPU/Vulkan/CUDA runs. |
| `HAS_TEXT_MODEL_PATH_FOR_SERVER` | Local HaS Text server | Optional model path passed to the external server, useful for Windows paths. |
| `HAS_TEXT_DEVICE` | Local HaS Text server | Optional device selector passed to external `llama-server --device`. |
| `HAS_TEXT_N_CTX` | Local HaS Text server | Context length passed to the Python or external HaS Text server. |
| `HAS_TEXT_N_GPU_LAYERS` | Local HaS Text server | GPU layer count passed to the Python or external HaS Text server; set `0` for CPU-only HaS Text. |
| `HAS_IMAGE_WEIGHTS` | Local HaS Image server | Absolute path to `sensitive_seg_best.pt`. |
| `HAS_MODELS_DIR` | HaS Image server fallback | Directory containing `sensitive_seg_best.pt`. |
| `GLM_FLASH_ENABLED` | Local model launcher | Set `1` to start the optional GLM-4.6V-Flash VLM service with `npm run dev:models`. |
| `GLM_FLASH_SERVER_BIN` | Local GLM VLM server | Native `llama-server` binary; prefer a CUDA build on NVIDIA machines. |
| `GLM_FLASH_MODEL_FOR_SERVER` | Local GLM VLM server | Absolute path to the GLM-4.6V-Flash GGUF. |
| `GLM_FLASH_MMPROJ_FOR_SERVER` | Local GLM VLM server | Absolute path to the GLM vision projector GGUF. |
| `GLM_FLASH_DEVICE` | Local GLM VLM server | Optional llama.cpp device selector such as `CUDA0`. |
| `VLM_BASE_URL` | Backend | OpenAI-compatible GLM VLM URL. |
| `VLM_MODEL_NAME` | Backend | Served GLM VLM model alias. |
| `OCR_VLLM_PORT` | Local vLLM service | Port for PaddleOCR-VL vLLM. |
| `OCR_BASE_URL` | Backend | PaddleOCR adapter URL. |
| `HAS_LLAMACPP_BASE_URL` | Backend | OpenAI-compatible HaS Text URL. |
| `HAS_IMAGE_BASE_URL` | Backend | HaS Image service URL. |

## Provenance

Model source and license notes live in
[MODEL_PROVENANCE.md](./MODEL_PROVENANCE.md). Update that file before mirroring,
vendoring, or baking weights into an internal image.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `HaS Text model file was not found` | Download the GGUF, rename/copy it to `HaS_Text_0209_0.6B_Q4_K_M.gguf`, or set `HAS_MODEL_PATH`. |
| `HaS-Image weights not found` | Download `sensitive_seg_best.pt` or set `HAS_IMAGE_WEIGHTS`. |
| OCR starts slowly | First launch may download `PaddlePaddle/PaddleOCR-VL` into the Hugging Face cache. |
| VLM is slow or CPU-bound | Use a CUDA llama.cpp build, set `GLM_FLASH_SERVER_BIN` to that binary, set `GLM_FLASH_DEVICE=CUDA0`, and confirm `llama-server --list-devices` shows the NVIDIA GPU. |
| VLM output is malformed | Confirm the server command includes `--jinja`; Unsloth GLM-4.6V-Flash GGUFs require it for the fixed chat template. |
| GPU memory is high | Keep page concurrency at `1`; set `VISION_DUAL_PIPELINE_PARALLEL=false` only when memory pressure matters more than speed. |
