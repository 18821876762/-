@echo off
chcp 65001 >nul 2>&1
REM ============================================================
REM  一键启动本地桥（网课强制续播 · 爬虫精度增强，可选组件）
REM  - 双击即可：自动切到脚本所在目录并启动 bridge.py
REM  - 用法：run_bridge.bat [参数]   例：run_bridge.bat --port 7532
REM  - 退出：Ctrl+C
REM  注意：需先运行 python dump.py 生成 output/playlist_*.json，桥才有数据可返回
REM ============================================================

REM 切到本 bat 所在目录（无论从哪里双击）
cd /d "%~dp0"

REM 检查 python 是否可用
where python >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 python。请先安装 Python 3.10+ 并加入 PATH。
    echo         下载：https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [信息] 启动只读本地桥（默认监听 127.0.0.1，已限制浏览器来源）...
echo [信息] 默认端口 7531；如需改端口请用：run_bridge.bat --port 7532
echo [提示] 浏览器端桥默认关闭；需在课程页 URL 加 cxbridge=端口，或设置 localStorage.cx_bridge_on=1。
echo [提示] 自动下一课还需开启对应插件；启用后才探测 7531/7532/7533/8543/9090。
echo [提示] 浏览器访问 http://127.0.0.1:7531/ping 可验证桥是否在线。
echo ------------------------------------------------------------

python bridge.py %*

REM 异常退出（非 Ctrl+C）时暂停，便于查看错误
if errorlevel 1 (
    echo.
    echo [错误] 桥异常退出（code=%errorlevel%）。详见上方日志。
    pause
)
