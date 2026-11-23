import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nang-desktop-smoke-'));

// Import compiled desktop modules (CommonJS)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ConfigStore } = require(path.join(repoRoot, 'shop-desktop/dist/shop-desktop/src/config-store.js'));
const { PrintedJournal } = require(path.join(repoRoot, 'shop-desktop/dist/shop-desktop/src/journal.js'));
const { buildReceiptHtml, buildReceiptPlainText } = require(path.join(repoRoot, 'shop-desktop/dist/shop-desktop/src/receipt-html.js'));
const { resolveReceiptAssets } = require(path.join(repoRoot, 'shop-desktop/dist/shop-desktop/src/printer.js'));

async function run() {
  console.log('=== NÂNG CAFÉ DESKTOP APP SMOKE TEST ===');

  // 1. ConfigStore persistence + defaults
  const store = new ConfigStore(tmpDir);
  const def = store.get();
  assert.equal(def.alertSeconds, 10, 'Default speaker alarm duration must be 10 seconds');
  assert.equal(def.printerMode, 'electron-silent');
  assert.equal(def.autoLaunch, true);

  const saved = store.save({
    serverUrl: 'https://nangpos.up.railway.app/',
    agentSecret: 'secret-123',
    printerName: 'XP-80C',
    paperMm: 80,
    alertSeconds: 10,
  });
  assert.equal(saved.serverUrl, 'https://nangpos.up.railway.app', 'Trailing slash trimmed');
  const reloaded = new ConfigStore(tmpDir).get();
  assert.equal(reloaded.printerName, 'XP-80C');
  assert.equal(reloaded.configured, true);
  console.log('✓ ConfigStore persistence & 10s alert default OK');

  // 2. PrintedJournal zero-duplicate persistence
  const j = new PrintedJournal(tmpDir);
  assert.equal(j.has('initial:NC4242'), false);
  j.markPrinted('initial:NC4242', 'NC4242');
  assert.equal(new PrintedJournal(tmpDir).has('initial:NC4242'), true);
  console.log('✓ PrintedJournal atomic duplicate-guard OK');

  // 3. Receipt HTML & plain-text rendering (Bank transfer paid + Vietnamese diacritics)
  const sample = {
    orderCode: 'NC.2311.001',
    createdAt: new Date().toISOString(),
    isReprint: false,
    customerName: 'Nguyễn Minh Anh',
    customerPhone: '0912345678',
    customerAddress: '075 tổ 10, P. Sông Hiến, Cao Bằng',
    note: 'Gọi trước khi giao',
    items: [
      {
        menuItemId: 1,
        name: 'Cà phê hạt dẻ',
        basePrice: 55000,
        size: 'L',
        sizeLabel: 'Lớn (L)',
        sizePrice: 10000,
        ice: 'Ít đá',
        sugar: '70% đường',
        toppings: [{ slug: 'thach-den', name: 'Thạch đen Cao Bằng', price: 8000 }],
        note: 'Ít kem',
        quantity: 1,
        unitPrice: 73000,
        lineTotal: 73000,
      },
    ],
    totalAmount: 73000,
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
  };

  const html = buildReceiptHtml(sample, 80);
  assert.ok(html.includes('NC.2311.001'));
  assert.ok(html.includes('CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'));
  assert.ok(html.includes('Thạch đen Cao Bằng'));
  assert.ok(html.includes('Gọi trước khi giao'));
  const txt = buildReceiptPlainText(sample, 58);
  assert.ok(txt.includes('CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'));

  // 3b. Server-driven receipt template takes priority + strips <script> defensively + offline fallback
  const fallbackAssets = resolveReceiptAssets(sample, 80);
  assert.equal(fallbackAssets.fromServer, false);
  assert.equal(fallbackAssets.printableMm, 72);
  const serverDrivenAssets = resolveReceiptAssets(
    {
      ...sample,
      rendered: {
        html80: '<html><body><div>CUSTOM RAILWAY BILL</div><script>alert(1)</script></body></html>',
        text80: 'CUSTOM SERVER TEXT',
        printableMm80: 70,
      },
    },
    80
  );
  assert.equal(serverDrivenAssets.fromServer, true);
  assert.ok(serverDrivenAssets.html.includes('CUSTOM RAILWAY BILL'));
  assert.ok(!serverDrivenAssets.html.includes('<script>'), 'Must defensively strip <script> tags');
  assert.equal(serverDrivenAssets.plainText, 'CUSTOM SERVER TEXT');
  assert.equal(serverDrivenAssets.printableMm, 70);
  console.log('✓ Thermal receipt HTML (80mm), text (58mm) & server-driven template override OK');

  // 4. Verify 10-second audio assets exist and have expected size (~480KB for 10s 24kHz 16-bit mono PCM)
  for (const name of ['alert-don-moi-10s.wav', 'alert-chuyen-khoan-10s.wav']) {
    const p = path.join(repoRoot, 'shop-desktop/assets', name);
    assert.ok(fs.existsSync(p), `Missing ${name}`);
    const sz = fs.statSync(p).size;
    assert.ok(sz > 400_000, `${name} should be ~10s PCM WAV (got ${sz} B)`);
  }
  console.log('✓ 10-second Vietnamese speaker alert WAV assets verified');

  // 5. Boot real Electron binary headless-ish for 3s to confirm zero main-process crash
  const electronExe = path.join(repoRoot, 'shop-desktop/node_modules/electron/dist/electron.exe');
  if (fs.existsSync(electronExe)) {
    const proc = spawn(electronExe, [path.join(repoRoot, 'shop-desktop'), '--minimized'], {
      cwd: path.join(repoRoot, 'shop-desktop'),
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    let exitedEarly = false;
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) exitedEarly = true;
    });
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal(exitedEarly, false, `Electron exited early with error:\n${stderr}`);
    proc.kill();
    console.log('✓ Real Electron binary launched cleanly in tray mode (--minimized) with zero crashes!');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\n🎉 ALL DESKTOP SMOKE TESTS PASSED!');
}

run().catch((err) => {
  console.error('❌ DESKTOP SMOKE TEST FAILED:', err);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
});
