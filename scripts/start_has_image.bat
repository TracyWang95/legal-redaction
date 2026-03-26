@echo off
setlocal
chcp 65001 >nul
REM HaS Image (YOLO11) — 端口 8081，与 Paddle 一样先 activate legal-redaction
call "%~dp0ensure_conda_root.bat"
if errorlevel 1 exit /b 1
call "%CONDA_ROOT%\Scripts\activate.bat" legal-redaction
if errorlevel 1 goto :activate_fail
goto :activate_ok
:activate_fail
echo ERROR: conda activate failed: legal-redaction
pause
exit /b 1
:activate_ok
if not defined HAS_IMAGE_WEIGHTS (
  set "HAS_MODELS_DIR=%~dp0..\..\has_models"
  if exist "%HAS_MODELS_DIR%\sensitive_seg_best.pt" set "HAS_IMAGE_WEIGHTS=%HAS_MODELS_DIR%\sensitive_seg_best.pt"
)
cd /d "%~dp0..\backend"
if not exist "has_image_server.py" (
    echo ERROR: has_image_server.py not found in "%CD%"
    pause
    exit /b 1
)
python has_image_server.py
pause
