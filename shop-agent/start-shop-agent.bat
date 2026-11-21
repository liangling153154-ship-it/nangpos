@echo off
chcp 65001 >nul
title Nâng Café - Máy In Phiếu & Loa Đọc Đơn Mới
cd /d "%~dp0"

if not exist "dist\shop-agent\src\index.js" (
  echo Đang build shop-agent lần đầu...
  call npm.cmd run build
)

:loop
echo [%date% %time%] Khởi động Nâng Café Shop Agent...
node dist\shop-agent\src\index.js
echo [%date% %time%] Shop Agent vừa dừng. Tự khởi động lại sau 5 giây...
timeout /t 5 /nobreak >nul
goto loop
