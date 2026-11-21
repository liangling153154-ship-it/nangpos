import fs from 'node:fs';
import path from 'node:path';

export type DesktopPrinterMode = 'electron-silent' | 'escpos-tcp' | 'mock';

export interface DesktopConfig {
  serverUrl: string;
  agentSecret: string;
  printerMode: DesktopPrinterMode;
  printerName: string;
  paperMm: 58 | 80;
  printerHost: string;
  printerPort: number;
  audioEnabled: boolean;
  alertSeconds: number;
  autoLaunch: boolean;
  configured: boolean;
}

const DEFAULT_CONFIG: DesktopConfig = {
  serverUrl: 'http://localhost:3000',
  agentSecret: '',
  printerMode: 'electron-silent',
  printerName: '',
  paperMm: 80,
  printerHost: '192.168.1.200',
  printerPort: 9100,
  audioEnabled: true,
  alertSeconds: 10,
  autoLaunch: true,
  configured: false,
};

export class ConfigStore {
  private filePath: string;
  private current: DesktopConfig;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.filePath = path.join(userDataDir, 'nang-desktop-config.json');
    this.current = this.load();
  }

  private load(): DesktopConfig {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULT_CONFIG };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<DesktopConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...raw,
        serverUrl: (raw.serverUrl || DEFAULT_CONFIG.serverUrl).replace(/\/+$/, ''),
        paperMm: raw.paperMm === 58 ? 58 : 80,
        alertSeconds: Math.max(3, Math.min(30, Number(raw.alertSeconds || 10))),
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  get(): DesktopConfig {
    return { ...this.current };
  }

  save(patch: Partial<DesktopConfig>): DesktopConfig {
    const next: DesktopConfig = {
      ...this.current,
      ...patch,
      serverUrl: (patch.serverUrl ?? this.current.serverUrl).trim().replace(/\/+$/, ''),
      agentSecret: (patch.agentSecret ?? this.current.agentSecret).trim(),
      printerName: (patch.printerName ?? this.current.printerName).trim(),
      printerHost: (patch.printerHost ?? this.current.printerHost).trim(),
      printerPort: Number(patch.printerPort ?? this.current.printerPort) || 9100,
      paperMm: (patch.paperMm ?? this.current.paperMm) === 58 ? 58 : 80,
      alertSeconds: Math.max(3, Math.min(30, Number(patch.alertSeconds ?? this.current.alertSeconds) || 10)),
      configured: true,
    };
    this.current = next;
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
    return { ...next };
  }
}
