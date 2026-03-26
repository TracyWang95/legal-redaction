@echo off
REM 若未设置 CONDA_ROOT，则在常见安装位置探测 conda.exe（不含任何固定盘符路径）
if defined CONDA_ROOT exit /b 0
if exist "%LOCALAPPDATA%\miniconda3\Scripts\conda.exe" set "CONDA_ROOT=%LOCALAPPDATA%\miniconda3" & exit /b 0
if exist "%LOCALAPPDATA%\anaconda3\Scripts\conda.exe" set "CONDA_ROOT=%LOCALAPPDATA%\anaconda3" & exit /b 0
if exist "%USERPROFILE%\miniconda3\Scripts\conda.exe" set "CONDA_ROOT=%USERPROFILE%\miniconda3" & exit /b 0
if exist "%USERPROFILE%\anaconda3\Scripts\conda.exe" set "CONDA_ROOT=%USERPROFILE%\anaconda3" & exit /b 0
if exist "C:\ProgramData\miniconda3\Scripts\conda.exe" set "CONDA_ROOT=C:\ProgramData\miniconda3" & exit /b 0
if exist "C:\ProgramData\anaconda3\Scripts\conda.exe" set "CONDA_ROOT=C:\ProgramData\anaconda3" & exit /b 0
echo ERROR: 未找到 conda。请先安装 Miniconda/Anaconda，或手动 set CONDA_ROOT=你的安装目录
exit /b 1
