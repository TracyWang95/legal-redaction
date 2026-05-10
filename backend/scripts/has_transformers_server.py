"""OpenAI-compatible HaS Text server backed by Hugging Face Transformers."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from transformers import AutoModelForCausalLM, AutoTokenizer


MODEL_ID = os.environ.get("HAS_TEXT_HF_MODEL", "xuanwulab/HaS_4.0_0.6B")
HOST = os.environ.get("HAS_TEXT_HOST", "0.0.0.0")
PORT = int(os.environ.get("HAS_TEXT_PORT", "8080"))
MAX_NEW_TOKENS = int(os.environ.get("HAS_TEXT_MAX_NEW_TOKENS", "512"))
DEVICE = os.environ.get("HAS_TEXT_HF_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
ALLOW_CPU = os.environ.get("HAS_TEXT_ALLOW_CPU", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

if DEVICE == "cpu" and not ALLOW_CPU:
    raise SystemExit(
        "HaS Transformers server refuses CPU mode by default. "
        "Set HAS_TEXT_ALLOW_CPU=1 only for debug."
    )

if DEVICE.startswith("cuda") and not torch.cuda.is_available():
    raise SystemExit("CUDA was requested for HaS Transformers, but torch.cuda is unavailable.")

DTYPE = torch.bfloat16 if DEVICE.startswith("cuda") else torch.float32

app = FastAPI(title="HaS Text Transformers Service", version="0.1.0")
generate_lock = threading.Lock()

print("=" * 50, flush=True)
print("  HaS Text Transformers service", flush=True)
print("=" * 50, flush=True)
print(f"Model: {MODEL_ID}", flush=True)
print(f"Device: {DEVICE}", flush=True)
print(f"dtype: {DTYPE}", flush=True)
print(f"Server URL: http://{HOST}:{PORT}/v1", flush=True)
print("Loading tokenizer...", flush=True)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
print("Loading model...", flush=True)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    trust_remote_code=True,
    torch_dtype=DTYPE,
)
model.to(DEVICE)
model.eval()
print("Model loaded.", flush=True)


def _content_from_messages(messages: list[dict[str, Any]]) -> str:
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    parts = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")
        parts.append(f"{role}: {content}")
    parts.append("assistant:")
    return "\n".join(parts)


def _generate(messages: list[dict[str, Any]], payload: dict[str, Any]) -> str:
    prompt = _content_from_messages(messages)
    inputs = tokenizer(prompt, return_tensors="pt").to(DEVICE)
    max_new_tokens = int(payload.get("max_tokens") or payload.get("max_new_tokens") or MAX_NEW_TOKENS)
    temperature = float(payload.get("temperature", 0) or 0)
    do_sample = temperature > 0
    generation_kwargs: dict[str, Any] = {
        "max_new_tokens": max_new_tokens,
        "do_sample": do_sample,
        "pad_token_id": tokenizer.eos_token_id,
        "eos_token_id": tokenizer.eos_token_id,
    }
    if do_sample:
        generation_kwargs["temperature"] = temperature
        generation_kwargs["top_p"] = float(payload.get("top_p", 0.9) or 0.9)
    with torch.inference_mode():
        output_ids = model.generate(**inputs, **generation_kwargs)
    generated = output_ids[0, inputs["input_ids"].shape[-1] :]
    return _repair_mojibake(tokenizer.decode(generated, skip_special_tokens=True).strip())


def _repair_mojibake(text: str) -> str:
    markers = ("ä", "å", "ç", "æ", "è", "é", "ã")
    if not any(marker in text for marker in markers):
        return text
    for encoding in ("cp1252", "latin1"):
        try:
            repaired = text.encode(encoding).decode("utf-8")
        except UnicodeError:
            continue
        if repaired:
            return repaired
    return text


@app.get("/health")
def health() -> dict[str, Any]:
    detail: dict[str, Any] = {
        "status": "ok",
        "ready": True,
        "model": MODEL_ID,
        "runtime": "transformers",
        "runtime_mode": "gpu" if DEVICE.startswith("cuda") else "cpu",
        "device": DEVICE,
        "gpu_available": torch.cuda.is_available(),
        "gpu_only_mode": not ALLOW_CPU,
        "cpu_fallback_risk": DEVICE == "cpu",
    }
    if DEVICE.startswith("cuda"):
        detail["gpu_memory_allocated_mb"] = round(torch.cuda.memory_allocated() / 1024 / 1024, 1)
        detail["gpu_memory_reserved_mb"] = round(torch.cuda.memory_reserved() / 1024 / 1024, 1)
    return detail


@app.get("/v1/models")
def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_ID,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "transformers",
                "meta": {
                    "runtime": "transformers",
                    "device": DEVICE,
                    "dtype": str(DTYPE).replace("torch.", ""),
                },
            }
        ],
        "models": [
            {
                "name": MODEL_ID,
                "model": MODEL_ID,
                "type": "model",
                "capabilities": ["completion"],
            }
        ],
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> JSONResponse:
    payload = await request.json()
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        return JSONResponse({"error": {"message": "messages must be a non-empty list"}}, status_code=400)
    started = time.perf_counter()
    with generate_lock:
        content = _generate(messages, payload)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return JSONResponse(
        {
            "id": f"chatcmpl-has-transformers-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": MODEL_ID,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"elapsed_ms": elapsed_ms},
        }
    )


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
