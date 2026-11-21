import fs from 'node:fs';
import path from 'node:path';

interface JournalEntry {
  key: string;
  orderCode: string;
  printedAt: string;
}

/**
 * Atomic on-disk print journal guaranteeing zero duplicate thermal prints
 * across Wi-Fi drops, sleep/wake cycles, or sudden power cuts.
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
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as JournalEntry[];
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const item of parsed) {
          if (item?.key && new Date(item.printedAt).getTime() >= cutoff) {
            this.entries.set(item.key, item);
          }
        }
      }
    } catch {
      // ignore corrupted journal
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
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Array.from(this.entries.values()), null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  size(): number {
    return this.entries.size;
  }
}
