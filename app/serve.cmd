@echo off
chcp 65001 >nul
cd /d "%~dp0"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do set "IP=%%a"
echo.
echo ============================================
echo   Camera giám sát
echo   Mở trên máy này:      http://%IP%:8080
echo   Mở trên điện thoại:  http://%IP%:8080
echo   (điện thoại phải cùng mạng wifi với máy này)
echo   Bấm Ctrl+C để dừng server.
echo ============================================
echo.
python -m http.server 8080
