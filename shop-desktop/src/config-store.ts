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

interface StoredConfigFile extends Omit<DesktopConfig, 'agentSecret'> {
  agentSecret?: string;
  agentSecretEncrypted?: string;
}

interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

function getElectronSafeStorage(): SecretCipher {
  try {
    // Loaded dynamically so Node unit tests can import ConfigStore without Electron runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      safeStorage?: {
        isEncryptionAvailable(): boolean;
        encryptString(str: string): Buffer;
        decryptString(buf: Buffer): string;
      };
    };
    const ss = electron?.safeStorage;
    if (ss && typeof ss.isEncryptionAvailable === 'function') {
      return {
        isAvailable: () => ss.isEncryptionAvailable(),
        encrypt: (plain: string) => ss.encryptString(plain).toString('base64'),
        decrypt: (encoded: string) => ss.decryptString(Buffer.from(encoded, 'base64')),
      };
    }
  } catch {
    // Running outside Electron (smoke test)
  }
  return {
    isAvailable: () => false,
    encrypt: (s) => s,
    decrypt: (s) => s,
  };
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
  private cipher: SecretCipher;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.filePath = path.join(userDataDir, 'nang-desktop-config.json');
    this.cipher = getElectronSafeStorage();
    this.current = this.load();
  }

  private load(): DesktopConfig {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULT_CONFIG };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<StoredConfigFile>;
      let secret = '';
      let needsMigration = false;

      if (raw.agentSecretEncrypted && this.cipher.isAvailable()) {
        try {
          secret = this.cipher.decrypt(raw.agentSecretEncrypted);
        } catch {
          secret = '';
        }
      } else if (raw.agentSecret) {
        secret = raw.agentSecret;
        if (this.cipher.isAvailable()) {
          needsMigration = true;
        }
      }

      const loaded: DesktopConfig = {
        ...DEFAULT_CONFIG,
        ...raw,
        agentSecret: secret,
        serverUrl: (raw.serverUrl || DEFAULT_CONFIG.serverUrl).replace(/\/+$/, ''),
        paperMm: raw.paperMm === 58 ? 58 : 80,
        alertSeconds: Math.max(3, Math.min(30, Number(raw.alertSeconds || 10))),
      };

      // Transparently migrate plaintext v1.1.0 secret to Windows DPAPI encryption
      if (needsMigration && loaded.agentSecret) {
        this.writeDisk(loaded);
      }
      return loaded;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private writeDisk(cfg: DesktopConfig): void {
    const toStore: StoredConfigFile = {
      serverUrl: cfg.serverUrl,
      printerMode: cfg.printerMode,
      printerName: cfg.printerName,
      paperMm: cfg.paperMm,
      printerHost: cfg.printerHost,
      printerPort: cfg.printerPort,
      audioEnabled: cfg.audioEnabled,
      alertSeconds: cfg.alertSeconds,
      autoLaunch: cfg.autoLaunch,
      configured: cfg.configured,
    };

    if (cfg.agentSecret) {
      if (this.cipher.isAvailable()) {
        toStore.agentSecretEncrypted = this.cipher.encrypt(cfg.agentSecret);
      } else {
        toStore.agentSecret = cfg.agentSecret;
      }
    }

    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(toStore, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
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
    this.writeDisk(next);
    return { ...next };
  }
}
