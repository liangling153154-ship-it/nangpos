import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveAssetsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../assets'),
    path.resolve(__dirname, '../../../assets'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

export class AudioNotifier {
  private queue: Promise<void> = Promise.resolve();
  private assetsDir: string;

  constructor(private enabled: boolean) {
    this.assetsDir = resolveAssetsDir();
  }

  /**
   * Plays café bell chime + clear Vietnamese "Đơn mới" voice via Windows speakers.
   * Uses bundled PCM WAV + .NET SoundPlayer so it works 100% offline with zero browser autoplay limits.
   */
  announceNewOrder(kind: 'new_order' | 'transfer_alert' = 'new_order'): Promise<void> {
    const task = this.queue.then(async () => {
      if (!this.enabled) {
        console.log(`[Audio:muted] Would play chime + Vietnamese "${kind === 'new_order' ? 'Đơn mới' : 'Đơn chuyển khoản mới'}"`);
        return;
      }

      const combined = path.join(this.assetsDir, 'alert-don-moi.wav');
      const chime = path.join(this.assetsDir, 'chime.wav');
      const voice = path.join(
        this.assetsDir,
        kind === 'transfer_alert' ? 'don-chuyen-khoan.wav' : 'don-moi.wav'
      );

      try {
        if (kind === 'new_order' && fs.existsSync(combined)) {
          await this.playWavFile(combined);
        } else {
          if (fs.existsSync(chime)) await this.playWavFile(chime);
          if (fs.existsSync(voice)) await this.playWavFile(voice);
        }
        console.log(`[Audio] Played chime + Vietnamese "${kind === 'new_order' ? 'Đơn mới' : 'Đơn chuyển khoản mới'}"`);
      } catch (err) {
        console.error('[Audio] Playback failed:', err);
      }
    });

    this.queue = task.catch(() => {});
    return task;
  }

  private async playWavFile(wavPath: string): Promise<void> {
    if (process.platform !== 'win32') {
      console.log(`[Audio:non-win32] Skipping native Windows SoundPlayer for ${path.basename(wavPath)}`);
      return;
    }
    const escaped = wavPath.replace(/'/g, "''");
    const cmd = `$p = New-Object System.Media.SoundPlayer '${escaped}'; $p.PlaySync()`;
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { timeout: 12_000 }
    );
  }
}
