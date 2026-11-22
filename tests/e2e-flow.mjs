import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from '../server/node_modules/ws/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nang-e2e-'));

const PORT = 3456;
const NTFY_PORT = 3457;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const AGENT_SECRET = 'test-agent-secret-999';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'test-pass-123';
const SEPAY_SECRET = 'test-sepay-secret-xyz';

const ntfyMessages = [];

function startMockNtfyServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          ntfyMessages.push(JSON.parse(body));
        } catch {
          ntfyMessages.push({ raw: body });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock-ntfy-' + ntfyMessages.length }));
      });
    });
    srv.listen(NTFY_PORT, '127.0.0.1', () => resolve(srv));
  });
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 150, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const val = await fn();
      if (val) return val;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function spawnNode(scriptPath, env, tag) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.log(`  [${tag}] ${line}`);
    }
  });
  child.stderr.on('data', (d) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.error(`  [${tag}:err] ${line}`);
    }
  });
  return child;
}

async function killChild(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function run() {
  console.log('\n=======================================================');
  console.log('  NÂNG CAFÉ — END-TO-END FLOW VERIFICATION');
  console.log('=======================================================\n');

  const ntfySrv = await startMockNtfyServer();
  const pgDir = path.join(tmpRoot, 'pgdata');
  const agentDataDir = path.join(tmpRoot, 'agent-data');
  const receiptsDir = path.join(tmpRoot, 'receipts');

  const serverProc = spawnNode(
    path.join(repoRoot, 'server/dist/server/src/index.js'),
    {
      PORT: String(PORT),
      NODE_ENV: 'test',
      PUBLIC_URL: SERVER_URL,
      DATABASE_URL: `pglite://${pgDir}`,
      ADMIN_USERNAME: ADMIN_USER,
      ADMIN_PASSWORD: ADMIN_PASS,
      SESSION_SECRET: 'e2e-session-secret-more-than-32-chars-long',
      SHOP_AGENT_SECRET: AGENT_SECRET,
      VIETQR_BANK_BIN: '970418',
      VIETQR_BANK_NAME: 'BIDV - CN Cao Bằng',
      VIETQR_ACCOUNT_NO: '0000123456',
      VIETQR_ACCOUNT_NAME: 'HO KINH DOANH NANG CAFE',
      NTFY_BASE_URL: `http://127.0.0.1:${NTFY_PORT}`,
      NTFY_TOPIC: 'nang-cafe-e2e-test',
      PRINT_UNPAID_TRANSFER: 'false',
      SEPAY_WEBHOOK_SECRET: SEPAY_SECRET,
    },
    'server'
  );

  let agentProc = null;
  let adminWs = null;

  try {
    // 1. Wait for server health
    await waitFor(
      async () => {
        const res = await fetch(`${SERVER_URL}/api/health`);
        return res.ok;
      },
      20000,
      200,
      'server /api/health'
    );
    console.log('✓ Server healthy & PostgreSQL (PGlite) migrated + seeded');

    // 2. Verify menu API
    const menuRes = await fetch(`${SERVER_URL}/api/menu`);
    const menu = await menuRes.json();
    assert.ok(menu.categories.length >= 9, 'Should have full Nâng Café categories');
    assert.ok(menu.items.length >= 40, 'Should have full Nâng Café menu items');
    assert.equal(menu.toppings.length, 5, 'Should have 5 official toppings');
    const hatDeItem = menu.items.find((i) => i.slug === 'ca-phe-hat-de');
    const traVaiItem = menu.items.find((i) => i.slug === 'tra-vai-man-tam-hoa');
    assert.ok(hatDeItem && traVaiItem);
    console.log(`✓ Menu loaded: ${menu.categories.length} categories, ${menu.items.length} items, ${menu.toppings.length} toppings`);

    // 3. Admin login & open realtime Admin WebSocket
    const loginRes = await fetch(`${SERVER_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    assert.equal(loginRes.status, 200, 'Admin login should succeed');
    const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    assert.ok(cookieHeader.includes('nang_admin_session='), 'Should receive signed HttpOnly session cookie');

    const adminEvents = [];
    adminWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws?role=admin`, {
      headers: { Cookie: cookieHeader },
    });
    await new Promise((resolve, reject) => {
      adminWs.once('open', resolve);
      adminWs.once('error', reject);
    });
    adminWs.on('message', (raw) => adminEvents.push(JSON.parse(raw.toString())));
    console.log('✓ Admin logged in & connected to WebSocket');

    // 4. Start Windows Shop Agent (mock printer, audio disabled for silent test)
    const startAgent = () =>
      spawnNode(
        path.join(repoRoot, 'shop-agent/dist/shop-agent/src/index.js'),
        {
          SERVER_URL,
          SHOP_AGENT_SECRET: AGENT_SECRET,
          PRINTER_MODE: 'mock',
          PRINTER_PAPER_MM: '80',
          AUDIO_ENABLED: 'false',
          AGENT_DATA_DIR: agentDataDir,
          MOCK_OUTPUT_DIR: receiptsDir,
          RECONCILE_INTERVAL_MS: '5000',
        },
        'shop-agent'
      );

    agentProc = startAgent();
    await waitFor(
      async () => {
        const res = await fetch(`${SERVER_URL}/api/admin/system`, {
          headers: { Cookie: cookieHeader },
        });
        const sys = await res.json();
        return sys.agents && sys.agents.length === 1;
      },
      10000,
      200,
      'shop-agent online'
    );
    console.log('✓ Windows Shop Agent connected & visible in Admin dashboard');

    // =========================================================================
    // TEST 1: COD ORDER -> Admin WS -> ntfy -> Shop Agent Print -> Auto-Accept
    // =========================================================================
    const codRes = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Nguyễn Minh Anh',
        customerPhone: '0912345678',
        customerAddress: 'Số 24 đường Kim Đồng, P. Hợp Giang, Cao Bằng',
        note: 'Gọi trước khi giao 5 phút',
        paymentMethod: 'cod',
        items: [
          {
            menuItemId: hatDeItem.id, // 55k + L(10k) + thach-den(8k) = 73k
            quantity: 1,
            size: 'L',
            ice: 'Ít đá',
            sugar: '70% đường',
            toppingSlugs: ['thach-den'],
            note: 'Ít kem chút',
          },
          {
            menuItemId: traVaiItem.id, // 45k x 2 = 90k
            quantity: 2,
            size: 'M',
            ice: 'Đá bình thường',
            sugar: '50% đường',
          },
        ],
      }),
    });
    assert.equal(codRes.status, 201);
    const codData = await codRes.json();
    const codOrder = codData.order;
    assert.match(codOrder.orderCode, /^NC\.\d{4}\.001$/, `Expected NC.DDMM.001, got ${codOrder.orderCode}`);
    assert.equal(codData.message, 'Quán sẽ gọi lại xác nhận');
    assert.equal(codOrder.totalAmount, 73000 + 90000);
    assert.equal(codOrder.status, 'pending_shop');

    // Wait for Shop Agent to print & ACK -> auto-accepted!
    const codReceiptFile = await waitFor(
      () => {
        if (!fs.existsSync(receiptsDir)) return null;
        return fs.readdirSync(receiptsDir).find((f) => f.startsWith(codOrder.orderCode));
      },
      10000,
      150,
      'COD receipt file printed'
    );
    const codReceiptTxt = fs.readFileSync(path.join(receiptsDir, codReceiptFile), 'utf8');
    assert.ok(codReceiptTxt.includes(codOrder.orderCode), 'Receipt must include order code');
    assert.ok(codReceiptTxt.includes('THU TIỀN MẶT'), 'COD receipt must clearly state THU TIỀN MẶT');
    assert.ok(codReceiptTxt.includes('Cà phê hạt dẻ (L)'), 'Receipt must show size L');
    assert.ok(codReceiptTxt.includes('Thạch đen Cao Bằng'), 'Receipt must show topping');
    assert.ok(codReceiptTxt.includes('Ít kem chút'), 'Receipt must show item note');
    assert.ok(codReceiptTxt.includes('Gọi trước khi giao 5 phút'), 'Receipt must show order note');
    assert.ok(codReceiptTxt.includes('Nguyễn Minh Anh'), 'Receipt must show customer name');
    assert.ok(codReceiptTxt.includes('0912345678'), 'Receipt must show phone');

    // Verify auto-accept on server
    await waitFor(
      async () => {
        const r = await fetch(`${SERVER_URL}/api/admin/orders`, {
          headers: { Cookie: cookieHeader },
        });
        const d = await r.json();
        const found = d.orders.find((o) => o.orderCode === codOrder.orderCode);
        return found && found.status === 'accepted' && found.printStatus === 'printed';
      },
      8000,
      150,
      'COD order auto-accepted after printing'
    );

    // Verify Admin WS got order:new and ntfy got Vietnamese notification
    assert.ok(
      adminEvents.some((e) => e.type === 'order:new' && e.order.orderCode === codOrder.orderCode),
      'Admin WS must receive order:new'
    );
    await waitFor(
      () => ntfyMessages.some((m) => String(m.title || '').includes(codOrder.orderCode)),
      5000,
      100,
      'ntfy notification for COD order'
    );
    console.log(`✓ TEST 1 PASSED: COD ${codOrder.orderCode} -> WS -> ntfy -> Printed (THU TIỀN MẶT) -> Auto-accepted`);

    // =========================================================================
    // TEST 2: VIETQR TRANSFER -> Awaiting Payment -> Manual Confirm -> Printed
    // =========================================================================
    const qrRes = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Trần Hoàng Nam',
        customerPhone: '0987654321',
        customerAddress: 'Tổ 5, P. Sông Bằng, Cao Bằng',
        paymentMethod: 'bank_transfer',
        items: [{ menuItemId: hatDeItem.id, quantity: 1, size: 'M' }],
      }),
    });
    assert.equal(qrRes.status, 201);
    const qrData = await qrRes.json();
    const qrOrder = qrData.order;
    assert.equal(qrOrder.status, 'awaiting_payment');
    assert.equal(qrOrder.paymentStatus, 'unpaid');
    assert.ok(qrOrder.vietqr, 'Should return VietQR object');
    assert.match(qrOrder.orderCode, /^NC\.\d{4}\.002$/, `Expected sequential NC.DDMM.002, got ${qrOrder.orderCode}`);
    const expectedTransferContent = qrOrder.orderCode.replace(/\./g, '');
    assert.equal(qrOrder.vietqr.content, expectedTransferContent, 'VietQR transfer content should be dot-free NC+DDMM+00n');
    assert.ok(qrOrder.vietqr.emvPayload.includes('A000000727'), 'Valid NAPAS AID');
    assert.ok(qrOrder.vietqr.emvPayload.includes('970418'), 'Valid BIDV BIN');
    assert.ok(qrOrder.vietqr.emvPayload.includes(expectedTransferContent), 'Transfer content = dot-free orderCode');
    assert.ok(qrOrder.vietqr.qrDataUrl.startsWith('data:image/png;base64,'));

    // Ensure unpaid transfer was NOT printed prematurely
    await new Promise((r) => setTimeout(r, 600));
    const prematureFiles = fs
      .readdirSync(receiptsDir)
      .filter((f) => f.startsWith(qrOrder.orderCode));
    assert.equal(prematureFiles.length, 0, 'Unpaid transfer must wait for payment confirmation before printing');

    // Owner manually confirms payment
    const confirmRes = await fetch(`${SERVER_URL}/api/admin/orders/${qrOrder.id}/confirm-payment`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.printQueued, true);

    const qrReceiptFile = await waitFor(
      () => fs.readdirSync(receiptsDir).find((f) => f.startsWith(qrOrder.orderCode)),
      10000,
      150,
      'Confirmed VietQR order printed'
    );
    const qrReceiptTxt = fs.readFileSync(path.join(receiptsDir, qrReceiptFile), 'utf8');
    assert.ok(qrReceiptTxt.includes('CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'));
    assert.ok(!qrReceiptTxt.includes('THU TIỀN MẶT'));
    console.log(`✓ TEST 2 PASSED: VietQR ${qrOrder.orderCode} -> Awaiting Payment -> Manual Confirm -> Printed`);

    // =========================================================================
    // TEST 3: OFFLINE CATCH-UP + ZERO DUPLICATE PRINTING
    // =========================================================================
    await killChild(agentProc);
    agentProc = null;
    await waitFor(
      async () => {
        const res = await fetch(`${SERVER_URL}/api/admin/system`, {
          headers: { Cookie: cookieHeader },
        });
        const sys = await res.json();
        return sys.agents.length === 0;
      },
      8000,
      150,
      'shop-agent offline'
    );

    // Place COD order while Shop PC has no internet
    const offRes = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Lê Thu Hà',
        customerPhone: '0905111222',
        customerAddress: 'Đường Vườn Cam, Cao Bằng',
        paymentMethod: 'cod',
        items: [{ menuItemId: traVaiItem.id, quantity: 1 }],
      }),
    });
    assert.equal(offRes.status, 201);
    const offOrder = (await offRes.json()).order;
    assert.equal(offOrder.printStatus, 'pending');

    // Bring Shop PC back online -> must catch up & print exactly ONCE
    agentProc = startAgent();
    await waitFor(
      () => fs.readdirSync(receiptsDir).some((f) => f.startsWith(offOrder.orderCode)),
      10000,
      150,
      'offline order caught up and printed'
    );

    // Wait a moment, restart agent AGAIN to ensure zero duplicate prints
    await new Promise((r) => setTimeout(r, 800));
    await killChild(agentProc);
    agentProc = startAgent();
    await new Promise((r) => setTimeout(r, 1500));

    const offFiles = fs.readdirSync(receiptsDir).filter((f) => f.startsWith(offOrder.orderCode));
    assert.equal(offFiles.length, 1, 'Offline catch-up order must be printed EXACTLY ONCE (no duplicates)');
    console.log(`✓ TEST 3 PASSED: Offline order ${offOrder.orderCode} caught up after reconnect with ZERO duplicates`);

    // =========================================================================
    // TEST 4: REPRINT + OUT-OF-STOCK + PAUSE MODE + SEPAY WEBHOOK READY
    // =========================================================================
    // Reprint COD order
    const reprintRes = await fetch(`${SERVER_URL}/api/admin/orders/${codOrder.id}/reprint`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(reprintRes.status, 200);
    await waitFor(
      () => fs.readdirSync(receiptsDir).filter((f) => f.startsWith(codOrder.orderCode)).length === 2,
      8000,
      150,
      'reprint receipt created'
    );
    const codFiles = fs.readdirSync(receiptsDir).filter((f) => f.startsWith(codOrder.orderCode)).sort();
    const reprintedTxt = fs.readFileSync(path.join(receiptsDir, codFiles[1]), 'utf8');
    assert.ok(reprintedTxt.includes('BẢN IN LẠI'), 'Reprint ticket should say BẢN IN LẠI');

    // Out of stock toggle
    await fetch(`${SERVER_URL}/api/admin/menu/${hatDeItem.id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ isAvailable: false }),
    });
    const soldOutTry = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Sold Out',
        customerPhone: '0911222333',
        customerAddress: 'Cao Bằng',
        paymentMethod: 'cod',
        items: [{ menuItemId: hatDeItem.id, quantity: 1 }],
      }),
    });
    assert.equal(soldOutTry.status, 409, 'Ordering out-of-stock item must return 409');
    // Re-enable
    await fetch(`${SERVER_URL}/api/admin/menu/${hatDeItem.id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ isAvailable: true }),
    });

    // Pause mode ("Tạm nghỉ")
    await fetch(`${SERVER_URL}/api/admin/settings/pause`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ paused: true, message: 'Quán tạm nghỉ do mưa lớn' }),
    });
    const pausedTry = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Paused',
        customerPhone: '0911222333',
        customerAddress: 'Cao Bằng',
        paymentMethod: 'cod',
        items: [{ menuItemId: hatDeItem.id, quantity: 1 }],
      }),
    });
    assert.equal(pausedTry.status, 503, 'Ordering while paused must return 503');
    // Unpause
    await fetch(`${SERVER_URL}/api/admin/settings/pause`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ paused: false, message: '' }),
    });

    // SePay webhook end-to-end check
    const spOrderRes = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Phạm SePay',
        customerPhone: '0911999888',
        customerAddress: 'Phường Ngọc Xuân, Cao Bằng',
        paymentMethod: 'bank_transfer',
        items: [{ menuItemId: traVaiItem.id, quantity: 1 }],
      }),
    });
    const spOrder = (await spOrderRes.json()).order;
    const sepayHookRes = await fetch(`${SERVER_URL}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        id: 987654,
        code: spOrder.vietqr.content,
        transferType: 'in',
        transferAmount: spOrder.totalAmount,
        content: `BIDV IBFT ${spOrder.vietqr.content} CHUYEN TIEN`,
        referenceCode: 'FT2611220001',
      }),
    });
    assert.equal(sepayHookRes.status, 200);
    const sepayHookData = await sepayHookRes.json();
    assert.equal(sepayHookData.success, true);
    assert.equal(sepayHookData.printQueued, true);
    await waitFor(
      () => fs.readdirSync(receiptsDir).some((f) => f.startsWith(spOrder.orderCode)),
      8000,
      150,
      'SePay-confirmed order printed'
    );

    console.log(`✓ TEST 4 PASSED: Reprint + Out-of-stock + Pause mode + SePay webhook (${spOrder.orderCode}) all verified!`);
    console.log(`\n🎉 ALL E2E TESTS PASSED! (ntfy notifications received: ${ntfyMessages.length})`);
  } finally {
    if (adminWs) adminWs.close();
    await killChild(agentProc);
    await killChild(serverProc);
    ntfySrv.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
