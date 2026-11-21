<#
.SYNOPSIS
  Cài đặt Nâng Café Shop Agent tự động chạy mỗi khi mở máy tính Windows (Startup folder).
.DESCRIPTION
  Tạo shortcut ẩn/thu nhỏ trong thư mục Startup của user hiện tại (không cần quyền Admin).
  Để gỡ cài đặt, chạy: .\install-startup.ps1 -Uninstall
#>
param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'NangCafeShopAgent.lnk'
$batPath = Join-Path $PSScriptRoot 'start-shop-agent.bat'

if ($Uninstall) {
  if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Đã gỡ tự động khởi động Nâng Café Shop Agent." -ForegroundColor Yellow
  } else {
    Write-Host "Chưa cài đặt tự khởi động." -ForegroundColor Gray
  }
  exit 0
}

if (-not (Test-Path $batPath)) {
  throw "Không tìm thấy file $batPath"
}

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = $batPath
$sc.WorkingDirectory = $PSScriptRoot
$sc.WindowStyle = 7  # Minimized so cashier taskbar stays clean
$sc.Description = 'Nâng Café — Tự động nhận đơn ship, in phiếu nhiệt và đọc Đơn mới'
$sc.Save()

Write-Host "ĐÃ CÀI XONG! Từ lần mở máy sau, Nâng Café Shop Agent sẽ tự chạy thu nhỏ dưới thanh taskbar." -ForegroundColor Green
Write-Host "Shortcut tại: $shortcutPath"
