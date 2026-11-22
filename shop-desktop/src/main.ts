import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  shell,
  Tray,
} from 'electron';
import { ConfigStore, type DesktopConfig } from './config-store';
import { PrintedJournal } from './journal';
import { DesktopAgentClient } from './agent-client';
import { APP_BUILD_DATE, APP_VERSION, APP_VERSION_LABEL } from './version';

// Guarantee 10-second speaker alert NEVER gets blocked by browser autoplay policy!
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const appRoot = fs.existsSync(path.resolve(__dirname, '../renderer'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../../..');

const rendererDir = path.join(appRoot, 'renderer');
const assetsDir = path.join(appRoot, 'assets');
const iconPngPath = path.join(appRoot, 'build', 'icon.png');
const iconIcoPath = path.join(appRoot, 'build', 'icon.ico');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let shownTrayHint = false;
let powerBlockerId: number | null = null;

// Single-instance lock so staff never accidentally launch 2 competing agents
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function applyAutoLaunch(enabled: boolean): void {
  // Only register OS login item in packaged app (avoid polluting dev environment)
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--minimized'],
    });
  } catch {
    // ignore
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('vn.nangcafe.counter');

  // Keep laptop awake so order reception & thermal printing never suspend
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  const userDataDir = app.getPath('userData');
  const mockReceiptsDir = path.join(userDataDir, 'printed-receipts');
  const configStore = new ConfigStore(userDataDir);
  const journal = new PrintedJournal(userDataDir);
  const agent = new DesktopAgentClient(
    () => configStore.get(),
    journal,
    mockReceiptsDir
  );

  // Lock down embedded <webview>: allow navigation ONLY to the configured serverUrl origin
  function isAllowedWebviewUrl(rawUrl: string): boolean {
    const serverUrl = configStore.get().serverUrl;
    if (!serverUrl) return false;
    try {
      const target = new URL(rawUrl);
      const allowed = new URL(serverUrl);
      return target.origin.toLowerCase() === allowed.origin.toLowerCase();
    } catch {
      return false;
    }
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (ev, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      if (params.src && !isAllowedWebviewUrl(params.src)) {
        ev.preventDefault();
      }
    });

    if (contents.getType() === 'webview') {
      contents.on('will-navigate', (ev, url) => {
        if (!isAllowedWebviewUrl(url)) {
          ev.preventDefault();
        }
      });
      contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('tel:') || isAllowedWebviewUrl(url)) {
          shell.openExternal(url).catch(() => {});
        }
        return { action: 'deny' };
      });
    }
  });

  applyAutoLaunch(configStore.get().autoLaunch);

  const appIcon = fs.existsSync(iconIcoPath)
    ? nativeImage.createFromPath(iconIcoPath)
    : nativeImage.createFromPath(iconPngPath);

  const startMinimized = process.argv.includes('--minimized');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: !startMinimized,
    title: `Nâng Café — Quầy Nhận Đơn ${APP_VERSION_LABEL}`,
    icon: appIcon,
    backgroundColor: '#0B4A53',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false, // Keep 10s alarm audio running smoothly even when minimized to Tray!
    },
  });

  // Hide default File/Edit/View menu bar for clean POS feel
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(rendererDir, 'index.html'));

  // Closing window (X) hides to System Tray instead of killing order reception
  mainWindow.on('close', (ev) => {
    if (!isQuitting) {
      ev.preventDefault();
      mainWindow?.hide();
      if (!shownTrayHint) {
        shownTrayHint = true;
        if (Notification.isSupported()) {
          new Notification({
            title: 'Nâng Café vẫn đang trực nhận đơn',
            body: 'Ứng dụng đã thu gọn xuống khay hệ thống (góc dưới phải). Có đơn mới máy vẫn tự phát loa 10 giây và in phiếu.',
            icon: appIcon,
          }).show();
        }
      }
    }
  });

  // Setup System Tray
  tray = new Tray(appIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Nâng Café — Đang trực nhận đơn ship');
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  function rebuildTrayMenu() {
    const stateLabel =
      agent.getState() === 'connected'
        ? 'Trạng thái: Đang trực nhận đơn'
        : agent.getState() === 'auth_error'
          ? 'Trạng thái: Sai mã bảo mật'
          : 'Trạng thái: Đang kết nối lại...';

    const menu = Menu.buildFromTemplate([
      { label: `Nâng Café — Quầy Nhận Đơn (${APP_VERSION_LABEL})`, enabled: false },
      { label: stateLabel, enabled: false },
      { type: 'separator' },
      {
        label: 'Mở cửa sổ quản lý đơn',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: 'Tắt chuông báo ngay',
        click: () => mainWindow?.webContents.send('desktop:stop-alarm'),
      },
      {
        label: 'Thử loa báo đơn (10 giây)',
        click: () => triggerAlarm('new_order', 'NC0000', 'Thử loa 10 giây', 'Kiểm tra âm lượng loa quầy Nâng Café'),
      },
      {
        label: 'In phiếu thử ngay',
        click: () => {
          agent.triggerLocalTestPrint().catch(() => {});
        },
      },
      {
        label: 'Cài đặt máy in & kết nối...',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
          mainWindow?.webContents.send('desktop:open-settings');
        },
      },
      { type: 'separator' },
      {
        label: 'Thoát hẳn (dừng nhận đơn)',
        click: () => {
          isQuitting = true;
          agent.stop();
          app.quit();
        },
      },
    ]);
    tray?.setContextMenu(menu);
  }

  function triggerAlarm(
    kind: 'new_order' | 'transfer_alert',
    orderCode: string,
    title: string,
    body: string
  ) {
    const cfg = configStore.get();
    if (cfg.audioEnabled) {
      mainWindow?.webContents.send('desktop:alarm', {
        kind,
        orderCode,
        title,
        body,
        durationSec: cfg.alertSeconds,
      });
    }
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
    if (Notification.isSupported()) {
      const notif = new Notification({
        title,
        body,
        icon: appIcon,
        silent: true, // Our 10-second Vietnamese speaker alert handles the sound
      });
      notif.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notif.show();
    }
  }

  agent.on('state', (state) => {
    mainWindow?.webContents.send('desktop:state', state);
    rebuildTrayMenu();
  });

  agent.on('log', (entry) => {
    mainWindow?.webContents.send('desktop:log', entry);
  });

  agent.on('alarm', (ev) => {
    triggerAlarm(ev.kind, ev.orderCode, ev.title, ev.body);
  });

  // IPC Handlers
  ipcMain.handle('desktop:list-printers', async () => {
    if (!mainWindow) return [];
    const list = await mainWindow.webContents.getPrintersAsync();
    return list.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: p.isDefault,
    }));
  });

  ipcMain.handle('desktop:get-initial', async () => {
    const printers = mainWindow ? await mainWindow.webContents.getPrintersAsync() : [];
    return {
      version: APP_VERSION,
      versionLabel: APP_VERSION_LABEL,
      buildDate: APP_BUILD_DATE,
      config: configStore.get(),
      connectionState: agent.getState(),
      logs: agent.getLogs(),
      printers: printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault,
      })),
      audioUrls: {
        newOrder10s: pathToFileURL(path.join(assetsDir, 'alert-don-moi-10s.wav')).toString(),
        transfer10s: pathToFileURL(path.join(assetsDir, 'alert-chuyen-khoan-10s.wav')).toString(),
      },
    };
  });

  ipcMain.handle('desktop:save-config', (_ev, patch: Partial<DesktopConfig>) => {
    const saved = configStore.save(patch);
    applyAutoLaunch(saved.autoLaunch);
    agent.restart();
    rebuildTrayMenu();
    return saved;
  });

  ipcMain.handle('desktop:test-print', async () => {
    try {
      const res = await agent.triggerLocalTestPrint();
      return { ok: true, outputPath: res.outputPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('desktop:test-alarm', () => {
    triggerAlarm(
      'new_order',
      'NC0000',
      'Thử loa báo đơn (10 giây)',
      'Đang phát chuông và đọc "Đơn mới" trong 10 giây.'
    );
  });

  ipcMain.handle('desktop:open-mock-folder', async () => {
    fs.mkdirSync(mockReceiptsDir, { recursive: true });
    await shell.openPath(mockReceiptsDir);
  });

  rebuildTrayMenu();
  agent.start();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
});
