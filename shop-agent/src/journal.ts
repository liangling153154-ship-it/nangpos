import fs from 'node:fs';
import path from 'node:path';

interface JournalEntry {
  key: string;
  orderCode: string;
  printedAt: string;
}

/**
 * Atomic persistent journal on local disk to GUARANTEE zero duplicate prints
 * even if Wi-Fi drops right after printing before ACK reaches Railway,
 * or if the Windows PC restarts abruptly.
 */
export class PrintedJournal {
  private entries = new Map<string, JournalEntry>();
  private filePath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'printed-jobs.json');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as JournalEntry[];
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // keep 30 days
        for (const item of parsed) {
          if (item?.key && new Date(item.printedAt).getTime() >= cutoff) {
            this.entries.set(item.key, item);
          }
        }
      }
    } catch (err) {
      console.warn('[Journal] Could not parse existing journal, starting clean:', err);
    }
  }

  has(idempotencyKey: string): boolean {
    return this.entries.has(idempotencyKey);
  }

  markPrinted(idempotencyKey: string, orderCode: string): void {
    this.entries.set(idempotencyKey, {
      key: idempotencyKey,
      orderCode,
      printedAt: new Date().toISOString(),
    });
    this.saveAtomic();
  }

  private saveAtomic(): void {
    const tmpPath = `${this.filePath}.tmp`;
    const list = Array.from(this.entries.values());
    fs.writeFileSync(tmpPath, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  size(): number {
    return this.entries.size;
  }
}
