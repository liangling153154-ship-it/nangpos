import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrintTicketPayload } from '../../shared/types.js';
import {
  buildReceiptLines,
  renderPlainTextReceipt,
  stripVietnamese,
} from './receipt.js';

const execFileAsync = promisify(execFile);

export type PrinterMode = 'windows' | 'escpos-tcp' | 'mock';

export interface PrinterConfig {
  mode: PrinterMode;
  printerName: string;
  paperMm: 58 | 80;
  host: string;
  port: number;
  mockOutputDir: string;
}

export async function printReceipt(
  ticket: PrintTicketPayload,
  cfg: PrinterConfig,
  jobId: number | string
): Promise<{ outputPath?: string }> {
  if (cfg.mode === 'mock') {
    return printMock(ticket, cfg, jobId);
  }
  if (cfg.mode === 'escpos-tcp') {
    await printEscPosTcp(ticket, cfg);
    return {};
  }
  await printWindowsGdi(ticket, cfg);
  return {};
}

async function printMock(
  ticket: PrintTicketPayload,
  cfg: PrinterConfig,
  jobId: number | string
): Promise<{ outputPath: string }> {
  fs.mkdirSync(cfg.mockOutputDir, { recursive: true });
  const text = renderPlainTextReceipt(ticket, cfg.paperMm);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const txtPath = path.join(cfg.mockOutputDir, `${ticket.orderCode}-job${jobId}-${stamp}.txt`);
  fs.writeFileSync(txtPath, text + '\n', 'utf8');

  console.log('\n┌────────────────────────────────────────────┐');
  for (const line of text.split('\n')) {
    console.log('│ ' + line.padEnd(42).slice(0, 42) + ' │');
  }
  console.log('└────────────────────────────────────────────┘');
  console.log(`[Printer:mock] Saved receipt -> ${txtPath}`);
  return { outputPath: txtPath };
}

/**
 * Direct TCP/9100 ESC/POS printing for LAN thermal printers.
 */
function printEscPosTcp(ticket: PrintTicketPayload, cfg: PrinterConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const lines = buildReceiptLines(ticket, cfg.paperMm);
    const chunks: Buffer[] = [];

    // ESC @ (Initialize printer)
    chunks.push(Buffer.from([0x1b, 0x40]));

    for (const line of lines) {
      // Alignment: ESC a n (0=left, 1=center)
      chunks.push(Buffer.from([0x1b, 0x61, line.align === 'center' ? 1 : 0]));
      // Emphasis: ESC E n
      chunks.push(Buffer.from([0x1b, 0x45, line.bold ? 1 : 0]));
      // Character size: GS ! n (0x00 normal, 0x01 double-height)
      chunks.push(Buffer.from([0x1d, 0x21, line.large ? 0x01 : 0x00]));
      // Reverse black/white: GS B n
      chunks.push(Buffer.from([0x1d, 0x42, line.invert ? 1 : 0]));

      const ascii = stripVietnamese(line.text) + '\n';
      chunks.push(Buffer.from(ascii, 'ascii'));

      if (line.invert) {
        chunks.push(Buffer.from([0x1d, 0x42, 0]));
      }
    }

    // Reset & feed 4 lines + partial auto-cut (GS V 66 0)
    chunks.push(Buffer.from([0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0]));
    chunks.push(Buffer.from('\n\n\n\n', 'ascii'));
    chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));

    const payload = Buffer.concat(chunks);
    const socket = new net.Socket();
    socket.setTimeout(8000);

    socket.connect(cfg.port, cfg.host, () => {
      socket.write(payload, (err) => {
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
      reject(new Error(`Timeout connecting to LAN printer ${cfg.host}:${cfg.port}`));
    });
    socket.on('error', (err) => reject(err));
  });
}

/**
 * Silent Windows GDI+ thermal receipt printing via built-in PowerShell .NET PrintDocument.
 * Zero C++ native builds, 100% crisp Vietnamese Unicode accents on Xprinter / Zywell / Epson drivers!
 */
async function printWindowsGdi(ticket: PrintTicketPayload, cfg: PrinterConfig): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('PRINTER_MODE=windows chỉ hỗ trợ hệ điều hành Windows.');
  }

  const lines = buildReceiptLines(ticket, cfg.paperMm);
  const tmpJson = path.join(os.tmpdir(), `nang-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const tmpPs1 = path.join(os.tmpdir(), `nang-print-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);

  fs.writeFileSync(
    tmpJson,
    JSON.stringify({
      printerName: cfg.printerName || '',
      paperMm: cfg.paperMm,
      lines,
    }),
    'utf8'
  );

  // Width in hundredths of an inch: 80mm ≈ 315, 58mm ≈ 228 (usable print area slightly narrower)
  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Printing

$data = Get-Content -Path '${tmpJson.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json
$paperWidth = if ($data.paperMm -eq 58) { 188 } else { 270 }
$marginX = 4
$usableW = $paperWidth - ($marginX * 2)

$fontNormal = New-Object System.Drawing.Font("Consolas", 8.5, [System.Drawing.FontStyle]::Regular)
$fontBold   = New-Object System.Drawing.Font("Consolas", 8.5, [System.Drawing.FontStyle]::Bold)
$fontLarge  = New-Object System.Drawing.Font("Segoe UI", 11.5, [System.Drawing.FontStyle]::Bold)

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
if ($data.printerName -and $data.printerName.Trim().Length -gt 0) {
  $doc.PrinterSettings.PrinterName = $data.printerName
  if (-not $doc.PrinterSettings.IsValid) {
    throw "Không tìm thấy máy in Windows: $($data.printerName)"
  }
}

# Estimate total paper height
$estHeight = 60
foreach ($l in $data.lines) {
  $estHeight += if ($l.large) { 24 } else { 16 }
}
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("ThermalReceipt", $paperWidth, [Math]::Max(300, $estHeight))
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$doc.add_PrintPage({
  param($sender, $e)
  $g = $e.Graphics
  $y = 10.0
  foreach ($l in $data.lines) {
    $f = if ($l.large) { $fontLarge } elseif ($l.bold) { $fontBold } else { $fontNormal }
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = if ($l.align -eq 'center') { [System.Drawing.StringAlignment]::Center } else { [System.Drawing.StringAlignment]::Near }
    $rect = New-Object System.Drawing.RectangleF($marginX, $y, $usableW, 120)
    $measured = $g.MeasureString($l.text, $f, $usableW, $sf)
    $boxH = [Math]::Ceiling($measured.Height) + 2

    if ($l.invert) {
      $g.FillRectangle([System.Drawing.Brushes]::Black, $marginX, $y - 1, $usableW, $boxH + 2)
      $g.DrawString($l.text, $f, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF($marginX, $y, $usableW, $boxH + 2)), $sf)
    } else {
      $g.DrawString($l.text, $f, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF($marginX, $y, $usableW, $boxH + 2)), $sf)
    }
    $y += $boxH + 1
  }
  $e.HasMorePages = $false
})

$doc.Print()
$fontNormal.Dispose()
$fontBold.Dispose()
$fontLarge.Dispose()
`;

  fs.writeFileSync(tmpPs1, '\ufeff' + psScript, 'utf8');

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1],
      { timeout: 20_000 }
    );
    console.log(`[Printer:windows] Printed ${ticket.orderCode} to "${cfg.printerName || 'default'}"`);
  } finally {
    try { fs.unlinkSync(tmpJson); } catch {}
    try { fs.unlinkSync(tmpPs1); } catch {}
  }
}
