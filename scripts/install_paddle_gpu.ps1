# 在 conda 环境 legal-redaction 中安装 Paddle GPU（CUDA 12.6 官方源）
# 用法: 右键「使用 PowerShell 运行」或在项目根目录:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install_paddle_gpu.ps1
# 未设置 CONDA_ROOT 时，按常见路径探测 conda（与 start_has.ps1 一致）

$ErrorActionPreference = "Stop"

$EnvName = if ($env:LEGAL_REDACTION_CONDA_ENV) { $env:LEGAL_REDACTION_CONDA_ENV } else { "legal-redaction" }

function Get-CondaRoot {
    if ($env:CONDA_ROOT -and (Test-Path (Join-Path $env:CONDA_ROOT "Scripts\conda.exe"))) { return $env:CONDA_ROOT }
    foreach ($c in @("C:\ProgramData\miniconda3", "C:\ProgramData\anaconda3", "$env:LOCALAPPDATA\miniconda3", "$env:LOCALAPPDATA\anaconda3", "$env:USERPROFILE\anaconda3", "$env:USERPROFILE\miniconda3")) {
        if (Test-Path (Join-Path $c "Scripts\conda.exe")) { return $c }
    }
    $cmd = Get-Command conda -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -match 'conda\.exe$') { return (Split-Path (Split-Path $cmd.Source)) }
    return $null
}

$CondaRoot = Get-CondaRoot
if (-not $CondaRoot) {
    Write-Host "未找到 conda。请安装 Miniconda/Anaconda 或设置环境变量 CONDA_ROOT" -ForegroundColor Red
    exit 1
}

$Python = Join-Path $CondaRoot "envs\$EnvName\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host "未找到 $Python ，请先创建 conda 环境: conda create -n $EnvName python=3.10" -ForegroundColor Red
    exit 1
}

Write-Host "使用 Python: $Python" -ForegroundColor Cyan
Write-Host "1/3 卸载 CPU 版 paddlepaddle（若存在）..." -ForegroundColor Yellow
& $Python -m pip uninstall -y paddlepaddle 2>$null

Write-Host "2/3 安装 paddlepaddle-gpu 3.3.0 (cu126 镜像)..." -ForegroundColor Yellow
& $Python -m pip install paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/

Write-Host "3/3 验证 GPU..." -ForegroundColor Yellow
& $Python -c "import paddle; print('cuda=', paddle.is_compiled_with_cuda(), 'device=', paddle.get_device())"

Write-Host ""
Write-Host "可选：PaddleOCR-VL 会用到 PyTorch；若在环境中看到 torch 为 +cpu，请在本环境中安装 CUDA 版 PyTorch（与显卡驱动匹配），例如:" -ForegroundColor Yellow
Write-Host "  conda activate $EnvName" -ForegroundColor White
Write-Host "  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124" -ForegroundColor White
Write-Host ""
Write-Host "接下来安装项目其余依赖（含 paddleocr）:" -ForegroundColor Green
Write-Host "  conda activate $EnvName" -ForegroundColor White
Write-Host "  cd <项目>\backend" -ForegroundColor White
Write-Host "  pip install -r requirements.txt" -ForegroundColor White
Write-Host ""
