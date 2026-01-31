"""
法律文件脱敏平台 - FastAPI 应用入口
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.api import files, redaction, entity_types, vision_types, vision_pipeline
from app.models.schemas import HealthResponse

# 创建 FastAPI 应用
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="面向律师的智能文件脱敏平台，支持 Word/PDF/图片敏感信息识别与脱敏处理",
    docs_url="/docs",
    redoc_url="/redoc",
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 确保上传和输出目录存在
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.OUTPUT_DIR, exist_ok=True)

# 挂载静态文件目录
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")
app.mount("/outputs", StaticFiles(directory=settings.OUTPUT_DIR), name="outputs")

# 注册路由
app.include_router(files.router, prefix=settings.API_PREFIX, tags=["文件管理"])
app.include_router(redaction.router, prefix=settings.API_PREFIX, tags=["脱敏处理"])
app.include_router(entity_types.router, prefix=settings.API_PREFIX, tags=["实体类型管理"])
app.include_router(vision_types.router, prefix=settings.API_PREFIX, tags=["图像类型管理"])
app.include_router(vision_pipeline.router, prefix=settings.API_PREFIX, tags=["图像识别Pipeline"])


@app.on_event("startup")
async def preload_models() -> None:
    """启动时预加载 OCR 模型到 GPU（PaddleOCR-VL）"""
    try:
        from app.services.ocr_service import ocr_service
        if ocr_service.is_available():
            print("[BOOT] OCRService ready (PaddleOCR-VL preloaded)")
        else:
            print("[BOOT] OCRService unavailable")
    except Exception as e:
        print(f"[BOOT] OCRService preload failed: {e}")


@app.get("/", tags=["根路径"])
async def root():
    """API 根路径"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
    }


@app.get("/health", response_model=HealthResponse, tags=["健康检查"])
async def health_check():
    """健康检查接口"""
    return HealthResponse(
        status="healthy",
        version=settings.APP_VERSION,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )
