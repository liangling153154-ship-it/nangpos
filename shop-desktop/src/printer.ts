import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { PrintTicketPayload } from '../../shared/types';
import type { DesktopConfig } from './config-store';
import {
  buildReceiptHtml,
  buildReceiptPlainText,
  stripVietnamese,
} from './receipt-html';

export async function printDesktopReceipt(
  ticket: PrintTicketPayload,
  cfg: DesktopConfig,
  jobId: number | string,
  mockDir: string
): Promise<{ outputPath?: string }> {
  if (cfg.printerMode === 'mock') {
    return printMock(ticket, cfg.paperMm, jobId, mockDir);
  }
  if (cfg.printerMode === 'escpos-tcp') {
    await printEscPosTcp(ticket, cfg);
    return {};
  }
  await printElectronSilent(ticket, cfg);
  return {};
}

async function printMock(
  ticket: PrintTicketPayload,
  paperMm: 58 | 80,
  jobId: number | string,
  mockDir: string
): Promise<{ outputPath: string }> {
  fs.mkdirSync(mockDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(mockDir, `${ticket.orderCode}-job${jobId}-${stamp}`);
  fs.writeFileSync(`${base}.txt`, buildReceiptPlainText(ticket, paperMm) + '\n', 'utf8');
  fs.writeFileSync(`${base}.html`, buildReceiptHtml(ticket, paperMm), 'utf8');
  return { outputPath: `${base}.html` };
}

/**
 * Silent thermal printing via offscreen Electron BrowserWindow.
 * ZERO dialog popup ("in luôn không cần hỏi"), 100% Vietnamese Unicode accents.
 */
async function printElectronSilent(
  ticket: PrintTicketPayload,
  cfg: DesktopConfig
): Promise<void> {
  const html = buildReceiptHtml(ticket, cfg.paperMm);

  const printableMm = cfg.paperMm === 58 ? 48 : 72;
  const printWin = new BrowserWindow({
    show: false,
    width: cfg.paperMm === 58 ? 190 : 272,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await printWin.loadURL(dataUrl);

    // Give layout engine a tick to measure exact height
    const contentHeightPx: number = await printWin.webContents.executeJavaScript(
      'Math.ceil(document.body.scrollHeight) + 28'
    );
    // 1 CSS px ≈ 264.58 microns; use true thermal print head width (72mm K80 / 48mm K58)
    const widthMicrons = printableMm * 1000;
    const heightMicrons = Math.max(80_000, Math.round(contentHeightPx * 265));

    await new Promise<void>((resolve, reject) => {
      printWin.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: cfg.printerName || '',
          margins: { marginType: 'none' },
          pageSize: {
            width: widthMicrons,
            height: heightMicrons,
          },
        },
        (success, failureReason) => {
          if (success) {
            resolve();
          } else {
            reject(
              new Error(
                failureReason ||
                  `Máy in "${cfg.printerName || 'Mặc định'}" không phản hồi.`
              )
            );
          }
        }
      );
    });
  } finally {
    if (!printWin.isDestroyed()) {
      printWin.destroy();
    }
  }
}

/**
 * Direct TCP/9100 ESC/POS printing for LAN thermal printers.
 */
function printEscPosTcp(ticket: PrintTicketPayload, cfg: DesktopConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const plain = buildReceiptPlainText(ticket, cfg.paperMm);
    const chunks: Buffer[] = [Buffer.from([0x1b, 0x40])]; // ESC @ init

    for (const rawLine of plain.split('\n')) {
      const isHighlight =
        rawLine.includes('THU TIỀN MẶT') ||
        rawLine.startsWith('MÃ ĐƠN:') ||
        rawLine.startsWith('NÂNG CAFÉ');
      chunks.push(Buffer.from([0x1b, 0x45, isHighlight ? 1 : 0]));
      chunks.push(Buffer.from([0x1d, 0x21, rawLine.startsWith('MÃ ĐƠN:') ? 0x01 : 0x00]));
      chunks.push(Buffer.from(stripVietnamese(rawLine) + '\n', 'ascii'));
    }

    chunks.push(Buffer.from([0x1b, 0x45, 0, 0x1d, 0x21, 0]));
    chunks.push(Buffer.from('\n\n\n\n', 'ascii'));
    chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // partial auto-cut

    const socket = new net.Socket();
    socket.setTimeout(8000);
    socket.connect(cfg.printerPort, cfg.printerHost, () => {
      socket.write(Buffer.concat(chunks), (err) => {
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          socket.end();
        }
      });
    });
    socket.on('close', () => resolve());
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Quá thời gian kết nối máy in LAN ${cfg.printerHost}:${cfg.printerPort}`));
    });
    socket.on('error', (err) => reject(err));
  });
}
