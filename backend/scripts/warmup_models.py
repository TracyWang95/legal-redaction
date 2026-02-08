"""
模型预热脚本 - 在服务启动时预热所有模型
避免首次推理时的冷启动延迟
"""
import httpx
import base64
import time
import sys

# 配置
HAS_URL = "http://127.0.0.1:8080/v1/chat/completions"
VLM_URL = "http://127.0.0.1:8081/v1/chat/completions"
OCR_URL = "http://127.0.0.1:8082/ocr"
TIMEOUT = 180.0  # 首次推理可能需要较长时间


def warmup_has_model():
    """预热HaS NER模型"""
    print("[预热] 正在预热 HaS NER 模型...")
    
    # 简单的测试文本
    test_text = "张三的身份证号是110101199003071234，电话13812345678。"
    
    try:
        start = time.perf_counter()
        resp = httpx.post(
            HAS_URL,
            json={
                "model": "has",
                "messages": [
                    {"role": "system", "content": "你是一个NER识别助手。"},
                    {"role": "user", "content": f"请识别以下文本中的实体：{test_text}"}
                ],
                "max_tokens": 256,
                "temperature": 0.1,
            },
            timeout=TIMEOUT
        )
        resp.raise_for_status()
        elapsed = time.perf_counter() - start
        print(f"[预热] [OK] HaS 模型预热完成，耗时 {elapsed:.2f}s")
        return True
    except Exception as e:
        print(f"[预热] [FAIL] HaS 模型预热失败: {e}")
        return False


def warmup_vlm_model():
    """预热GLM Vision模型"""
    print("[预热] 正在预热 GLM Vision 模型...")
    
    # 创建一个简单的测试图片 (1x1 白色像素)
    # PNG格式的1x1白色图片的base64
    test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    
    try:
        start = time.perf_counter()
        resp = httpx.post(
            VLM_URL,
            json={
                "model": "glm",
                "messages": [
                    {"role": "system", "content": "你是一个图像分析助手。"},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{test_image_base64}"}},
                            {"type": "text", "text": "这张图片里有什么？请简短回答。"}
                        ]
                    }
                ],
                "max_tokens": 64,
                "temperature": 0.1,
            },
            timeout=TIMEOUT
        )
        resp.raise_for_status()
        elapsed = time.perf_counter() - start
        print(f"[预热] [OK] GLM Vision 模型预热完成，耗时 {elapsed:.2f}s")
        return True
    except Exception as e:
        print(f"[预热] [FAIL] GLM Vision 模型预热失败: {e}")
        return False


def warmup_ocr():
    """预热PaddleOCR-VL微服务"""
    print("[warmup] PaddleOCR-VL ...")
    import base64
    # 1x1白色PNG
    test_image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    try:
        start = time.perf_counter()
        resp = httpx.post(OCR_URL, json={"image": test_image, "max_new_tokens": 64}, timeout=TIMEOUT)
        resp.raise_for_status()
        elapsed = time.perf_counter() - start
        print(f"[warmup] [OK] PaddleOCR-VL warmup done in {elapsed:.2f}s")
        return True
    except Exception as e:
        print(f"[warmup] [FAIL] PaddleOCR-VL warmup failed: {e}")
        return False


def check_service(url: str, name: str) -> bool:
    """检查服务是否可用"""
    try:
        resp = httpx.get(url.replace("/v1/chat/completions", "/health"), timeout=5.0)
        return resp.status_code == 200
    except:
        try:
            # llama-server 可能没有 /health 端点，尝试 /v1/models
            resp = httpx.get(url.replace("/v1/chat/completions", "/v1/models"), timeout=5.0)
            return resp.status_code == 200
        except:
            return False


def wait_for_services(max_wait: int = 90):
    """等待所有模型服务启动"""
    print("[start] waiting for services...")
    
    has_ready = False
    vlm_ready = False
    ocr_ready = False
    
    for i in range(max_wait):
        if not has_ready:
            has_ready = check_service(HAS_URL, "HaS")
            if has_ready:
                print("[start] [OK] HaS ready")
        
        if not vlm_ready:
            vlm_ready = check_service(VLM_URL, "VLM")
            if vlm_ready:
                print("[start] [OK] VLM ready")
        
        if not ocr_ready:
            try:
                resp = httpx.get("http://127.0.0.1:8082/health", timeout=3.0)
                if resp.status_code == 200 and resp.json().get("ready"):
                    ocr_ready = True
                    print("[start] [OK] OCR ready")
            except:
                pass
        
        if has_ready and vlm_ready and ocr_ready:
            return True
        
        if i % 5 == 0:
            status = f"HaS={'OK' if has_ready else '...'} VLM={'OK' if vlm_ready else '...'} OCR={'OK' if ocr_ready else '...'}"
            print(f"[start] waiting ({i}s) {status}")
        time.sleep(1)
    
    return has_ready and vlm_ready and ocr_ready


def main():
    print("=" * 50)
    print("Model Warmup Script")
    print("=" * 50)
    
    if not wait_for_services():
        print("[ERROR] Services not ready in time")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("Warming up models...")
    print("=" * 50 + "\n")
    
    has_ok = warmup_has_model()
    print()
    vlm_ok = warmup_vlm_model()
    print()
    ocr_ok = warmup_ocr()
    
    print("\n" + "=" * 50)
    all_ok = has_ok and vlm_ok and ocr_ok
    if all_ok:
        print("[OK] All models warmed up!")
    else:
        print("[WARN] Some models failed to warm up")
    print("=" * 50)


if __name__ == "__main__":
    main()
