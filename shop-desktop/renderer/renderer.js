/* global window, document, Audio */
(function () {
  const api = window.nangDesktop;

  const connDot = document.getElementById('conn-dot');
  const connText = document.getElementById('conn-text');
  const printerText = document.getElementById('printer-text');
  const webview = document.getElementById('admin-webview');
  const unconfiguredView = document.getElementById('unconfigured-view');

  const btnStopAlarm = document.getElementById('btn-stop-alarm');
  const alarmBtnLabel = document.getElementById('alarm-btn-label');
  const btnTestAlarm = document.getElementById('btn-test-alarm');
  const btnTestPrint = document.getElementById('btn-test-print');
  const btnLogs = document.getElementById('btn-logs');
  const btnReload = document.getElementById('btn-reload');
  const btnSettings = document.getElementById('btn-settings');
  const btnOpenFirstSetup = document.getElementById('btn-open-first-setup');

  const logDrawer = document.getElementById('log-drawer');
  const logList = document.getElementById('log-list');
  const btnCloseLogs = document.getElementById('btn-close-logs');
  const btnOpenMockDir = document.getElementById('btn-open-mock-dir');

  const settingsModal = document.getElementById('settings-modal');
  const settingsForm = document.getElementById('settings-form');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnCancelSettings = document.getElementById('btn-cancel-settings');
  const btnRefreshPrinters = document.getElementById('btn-refresh-printers');

  const fServerUrl = document.getElementById('cfg-server-url');
  const fAgentSecret = document.getElementById('cfg-agent-secret');
  const fPrinterMode = document.getElementById('cfg-printer-mode');
  const fPaperMm = document.getElementById('cfg-paper-mm');
  const fPrinterName = document.getElementById('cfg-printer-name');
  const fPrinterHost = document.getElementById('cfg-printer-host');
  const fPrinterPort = document.getElementById('cfg-printer-port');
  const fAudioEnabled = document.getElementById('cfg-audio-enabled');
  const fAlertSeconds = document.getElementById('cfg-alert-seconds');
  const fAutoLaunch = document.getElementById('cfg-auto-launch');
  const groupWinPrinter = document.getElementById('group-win-printer');
  const groupLanPrinter = document.getElementById('group-lan-printer');
  const toastEl = document.getElementById('toast');

  let currentConfig = null;
  let audioUrls = null;
  let activeAudio = null;
  let alarmStopTimer = null;
  let alarmTickTimer = null;
  let toastTimer = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  function renderConnectionState(state) {
    connDot.className = 'dot';
    if (state === 'connected') {
      connDot.classList.add('dot--ok');
      connText.textContent = 'Đang trực nhận đơn';
    } else if (state === 'auth_error') {
      connDot.classList.add('dot--err');
      connText.textContent = 'Sai mã bảo mật';
    } else if (state === 'connecting') {
      connDot.classList.add('dot--warn');
      connText.textContent = 'Đang kết nối...';
    } else {
      connDot.classList.add('dot--err');
      connText.textContent = 'Chưa kết nối';
    }
  }

  function renderPrinterSummary(cfg) {
    if (cfg.printerMode === 'mock') {
      printerText.textContent = `Máy in: Chế độ thử (${cfg.paperMm}mm)`;
    } else if (cfg.printerMode === 'escpos-tcp') {
      printerText.textContent = `LAN: ${cfg.printerHost}:${cfg.printerPort} (${cfg.paperMm}mm)`;
    } else {
      printerText.textContent = `Máy in: ${cfg.printerName || 'Mặc định Windows'} (${cfg.paperMm}mm)`;
    }
  }

  function loadAdminWebview(cfg) {
    if (!cfg.configured || !cfg.serverUrl) {
      webview.classList.add('hidden');
      unconfiguredView.classList.remove('hidden');
      return;
    }
    unconfiguredView.classList.add('hidden');
    webview.classList.remove('hidden');
    const target = `${cfg.serverUrl}/admin`;
    if (webview.getAttribute('src') !== target) {
      webview.setAttribute('src', target);
    }
  }

  function prependLog(entry) {
    const div = document.createElement('div');
    div.className = `log-item log-item--${entry.level || 'info'}`;
    div.innerHTML = `<span class="log-time">${entry.time}</span><span></span>`;
    div.querySelector('span:last-child').textContent = entry.message;
    logList.prepend(div);
    while (logList.children.length > 60) {
      logList.removeChild(logList.lastChild);
    }
  }

  function renderPrintersDropdown(printers, selectedName) {
    fPrinterName.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- Dùng máy in mặc định của Windows --';
    fPrinterName.appendChild(defaultOpt);

    for (const p of printers) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.isDefault ? `${p.displayName} (Mặc định)` : p.displayName;
      if (p.name === selectedName) opt.selected = true;
      fPrinterName.appendChild(opt);
    }

    if (selectedName && !printers.some((p) => p.name === selectedName)) {
      const custom = document.createElement('option');
      custom.value = selectedName;
      custom.textContent = `${selectedName} (đã lưu)`;
      custom.selected = true;
      fPrinterName.appendChild(custom);
    }
  }

  function syncPrinterModeVisibility() {
    const mode = fPrinterMode.value;
    groupWinPrinter.classList.toggle('hidden', mode !== 'electron-silent');
    groupLanPrinter.classList.toggle('hidden', mode !== 'escpos-tcp');
  }

  function openSettings() {
    if (!currentConfig) return;
    fServerUrl.value = currentConfig.serverUrl || '';
    fAgentSecret.value = currentConfig.agentSecret || '';
    fPrinterMode.value = currentConfig.printerMode || 'electron-silent';
    fPaperMm.value = String(currentConfig.paperMm || 80);
    fPrinterHost.value = currentConfig.printerHost || '192.168.1.200';
    fPrinterPort.value = String(currentConfig.printerPort || 9100);
    fAudioEnabled.checked = currentConfig.audioEnabled !== false;
    fAlertSeconds.value = String(currentConfig.alertSeconds || 10);
    fAutoLaunch.checked = currentConfig.autoLaunch !== false;
    syncPrinterModeVisibility();
    settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
  }

  // ---------- 10-Second Speaker Alarm Controller ----------
  function stopAlarm() {
    if (alarmStopTimer) {
      clearTimeout(alarmStopTimer);
      alarmStopTimer = null;
    }
    if (alarmTickTimer) {
      clearInterval(alarmTickTimer);
      alarmTickTimer = null;
    }
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch {
        // ignore
      }
      activeAudio = null;
    }
    btnStopAlarm.classList.add('hidden');
  }

  function playAlarm(alarm) {
    stopAlarm();
    if (!audioUrls) return;

    const durationSec = Math.max(3, Math.min(30, Number(alarm.durationSec || 10)));
    const src =
      alarm.kind === 'transfer_alert' ? audioUrls.transfer10s : audioUrls.newOrder10s;

    const audio = new Audio(src);
    audio.loop = true; // Loops seamlessly if user sets > 10s, stops cleanly at exact durationSec!
    audio.volume = 1.0;
    activeAudio = audio;
    audio.play().catch((err) => {
      showToast('Không phát được loa: ' + err.message);
    });

    const endAt = Date.now() + durationSec * 1000;
    btnStopAlarm.classList.remove('hidden');

    function updateCountdown() {
      const remain = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      const label =
        alarm.kind === 'transfer_alert'
          ? `Đơn CK mới ${alarm.orderCode}`
          : `Đơn mới ${alarm.orderCode}`;
      alarmBtnLabel.textContent = `${label} (${remain}s) · Tắt chuông`;
    }
    updateCountdown();

    alarmTickTimer = setInterval(updateCountdown, 300);
    alarmStopTimer = setTimeout(() => {
      stopAlarm();
    }, durationSec * 1000);
  }

  // ---------- Event Wiring ----------
  btnStopAlarm.addEventListener('click', stopAlarm);
  btnTestAlarm.addEventListener('click', () => api.testAlarm());

  btnTestPrint.addEventListener('click', async () => {
    btnTestPrint.disabled = true;
    try {
      const res = await api.testPrint();
      if (res.ok) {
        showToast(
          res.outputPath
            ? 'Đã lưu phiếu in thử! Bấm Nhật ký -> Mở thư mục phiếu thử để xem.'
            : 'Đã gửi phiếu in thử thẳng ra máy in nhiệt!'
        );
      } else {
        showToast('Lỗi in thử: ' + (res.error || 'Không xác định'));
      }
    } finally {
      btnTestPrint.disabled = false;
    }
  });

  btnLogs.addEventListener('click', () => logDrawer.classList.toggle('hidden'));
  btnCloseLogs.addEventListener('click', () => logDrawer.classList.add('hidden'));
  btnOpenMockDir.addEventListener('click', () => api.openMockFolder());

  btnReload.addEventListener('click', () => {
    if (!webview.classList.contains('hidden')) {
      webview.reload();
      showToast('Đã tải lại trang quản lý.');
    }
  });

  btnSettings.addEventListener('click', openSettings);
  btnOpenFirstSetup.addEventListener('click', openSettings);
  btnCloseSettings.addEventListener('click', closeSettings);
  btnCancelSettings.addEventListener('click', closeSettings);
  fPrinterMode.addEventListener('change', syncPrinterModeVisibility);

  btnRefreshPrinters.addEventListener('click', async () => {
    const printers = await api.listPrinters();
    renderPrintersDropdown(printers, fPrinterName.value);
    showToast(`Tìm thấy ${printers.length} máy in trên Windows.`);
  });

  settingsForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const saved = await api.saveConfig({
      serverUrl: fServerUrl.value,
      agentSecret: fAgentSecret.value,
      printerMode: fPrinterMode.value,
      printerName: fPrinterName.value,
      paperMm: Number(fPaperMm.value) === 58 ? 58 : 80,
      printerHost: fPrinterHost.value,
      printerPort: Number(fPrinterPort.value) || 9100,
      audioEnabled: fAudioEnabled.checked,
      alertSeconds: Number(fAlertSeconds.value) || 10,
      autoLaunch: fAutoLaunch.checked,
    });
    currentConfig = saved;
    renderPrinterSummary(saved);
    loadAdminWebview(saved);
    closeSettings();
    showToast('Đã lưu cài đặt và kết nối lại máy chủ!');
  });

  api.onConnectionState(renderConnectionState);
  api.onLog(prependLog);
  api.onAlarm(playAlarm);
  api.onStopAlarm(stopAlarm);
  api.onOpenSettings(openSettings);

  // ---------- Bootstrap ----------
  api.getInitialState().then((init) => {
    currentConfig = init.config;
    audioUrls = init.audioUrls;
    renderConnectionState(init.connectionState);
    renderPrinterSummary(init.config);
    renderPrintersDropdown(init.printers, init.config.printerName);
    logList.innerHTML = '';
    for (const entry of [...init.logs].reverse()) {
      prependLog(entry);
    }
    loadAdminWebview(init.config);
    if (!init.config.configured) {
      openSettings();
    }
  });
})();
