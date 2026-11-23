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
      DISABLE_RATE_LIMIT: 'true',
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
    // TEST 1: COD REJECTED (400) + VIETQR TRANSFER -> SEPAY AUTO-ACCEPT -> PRINT
    // =========================================================================
    const codRejectRes = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Khách COD cũ',
        customerPhone: '0912345678',
        customerAddress: 'Số 24 đường Kim Đồng, P. Hợp Giang, Cao Bằng',
        paymentMethod: 'cod',
        items: [{ menuItemId: hatDeItem.id, quantity: 1 }],
      }),
    });
    assert.equal(codRejectRes.status, 400, 'COD orders must be rejected with HTTP 400');

    const order1Res = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Nguyễn Minh Anh',
        customerPhone: '0912345678',
        customerAddress: 'Số 24 đường Kim Đồng, P. Hợp Giang, Cao Bằng',
        note: 'Gọi trước khi giao 5 phút',
        paymentMethod: 'bank_transfer',
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
    assert.equal(order1Res.status, 201);
    const order1Data = await order1Res.json();
    const order1 = order1Data.order;
    assert.match(order1.orderCode, /^NC\.\d{4}\.001$/, `Expected NC.DDMM.001, got ${order1.orderCode}`);
    assert.equal(order1.totalAmount, 73000 + 90000);
    assert.equal(order1.status, 'awaiting_payment');
    assert.equal(order1.paymentStatus, 'unpaid');
    assert.ok(order1.vietqr, 'Should return VietQR object');
    const expectedTransferContent = order1.orderCode.replace(/\./g, '');
    assert.equal(order1.vietqr.content, expectedTransferContent, 'VietQR transfer content should be dot-free NC+DDMM+00n');
    assert.ok(order1.vietqr.emvPayload.includes('A000000727'), 'Valid NAPAS AID');
    assert.ok(order1.vietqr.emvPayload.includes('970418'), 'Valid BIDV BIN');
    assert.ok(order1.vietqr.qrDataUrl.startsWith('data:image/png;base64,'));

    // Ensure unpaid transfer is NOT printed prematurely and does NOT spam ntfy before paying
    await new Promise((r) => setTimeout(r, 500));
    const prematureFiles = fs.existsSync(receiptsDir)
      ? fs.readdirSync(receiptsDir).filter((f) => f.startsWith(order1.orderCode))
      : [];
    assert.equal(prematureFiles.length, 0, 'Unpaid transfer must wait for payment before printing');
    assert.equal(ntfyMessages.length, 0, 'Unpaid transfer must not spam ntfy before payment arrives');

    // Simulate SePay webhook -> MUST immediately auto-accept (status = accepted) + print + ntfy!
    const sepayHook1Res = await fetch(`${SERVER_URL}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        id: 987654,
        accountNumber: '8800000000',
        subAccount: '0000123456',
        code: order1.vietqr.content,
        transferType: 'in',
        transferAmount: order1.totalAmount,
        content: `BIDV IBFT ${order1.vietqr.content} CHUYEN TIEN`,
        referenceCode: 'FT2611220001',
      }),
    });
    assert.equal(sepayHook1Res.status, 200);
    const sepayHook1Data = await sepayHook1Res.json();
    assert.equal(sepayHook1Data.success, true);
    assert.equal(sepayHook1Data.printQueued, true);

    // Wait for Shop Agent to print & ACK
    const order1ReceiptFile = await waitFor(
      () => {
        if (!fs.existsSync(receiptsDir)) return null;
        return fs.readdirSync(receiptsDir).find((f) => f.startsWith(order1.orderCode));
      },
      10000,
      150,
      'SePay paid receipt file printed'
    );
    const order1ReceiptTxt = fs.readFileSync(path.join(receiptsDir, order1ReceiptFile), 'utf8');
    assert.ok(order1ReceiptTxt.includes(order1.orderCode), 'Receipt must include order code');
    assert.ok(order1ReceiptTxt.includes('CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'), 'Receipt must show paid transfer');
    assert.ok(!order1ReceiptTxt.includes('THU TIỀN MẶT'), 'Receipt must NOT say THU TIỀN MẶT');
    assert.ok(order1ReceiptTxt.includes('Cà phê hạt dẻ (L)'), 'Receipt must show size L');
    assert.ok(order1ReceiptTxt.includes('Thạch đen Cao Bằng'), 'Receipt must show topping');
    assert.ok(order1ReceiptTxt.includes('Ít kem chút'), 'Receipt must show item note');
    assert.ok(order1ReceiptTxt.includes('Gọi trước khi giao 5 phút'), 'Receipt must show order note');
    assert.ok(order1ReceiptTxt.includes('Nguyễn Minh Anh'), 'Receipt must show customer name');
    assert.ok(order1ReceiptTxt.includes('0912345678'), 'Receipt must show phone');

    // Verify auto-accepted & printed on server
    await waitFor(
      async () => {
        const r = await fetch(`${SERVER_URL}/api/admin/orders`, {
          headers: { Cookie: cookieHeader },
        });
        const d = await r.json();
        const found = d.orders.find((o) => o.orderCode === order1.orderCode);
        return found && found.status === 'accepted' && found.paymentStatus === 'paid' && found.printStatus === 'printed';
      },
      8000,
      150,
      'Transfer order auto-accepted & printed'
    );

    // Verify Admin WS got order:updated (paid+accepted) and ntfy got rich notification
    assert.ok(
      adminEvents.some((e) => e.type === 'order:updated' && e.order.orderCode === order1.orderCode && e.order.status === 'accepted'),
      'Admin WS must receive auto-accepted order:updated'
    );
    await waitFor(
      () => ntfyMessages.some((m) => String(m.title || '').includes(order1.orderCode) && String(m.message || '').includes('Cà phê hạt dẻ')),
      5000,
      100,
      'rich ntfy notification for paid order'
    );
    console.log(`✓ TEST 1 PASSED: COD blocked (400), VietQR ${order1.orderCode} -> SePay auto-accepted -> Printed -> Rich ntfy`);

    // =========================================================================
    // TEST 2: MANUAL BACKUP CONFIRMATION -> IMMEDIATE AUTO-ACCEPT -> PRINTED
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
    const qrOrder = (await qrRes.json()).order;
    assert.match(qrOrder.orderCode, /^NC\.\d{4}\.002$/, `Expected sequential NC.DDMM.002, got ${qrOrder.orderCode}`);

    // Owner manually confirms payment (backup) -> immediately auto-accepted!
    const confirmRes = await fetch(`${SERVER_URL}/api/admin/orders/${qrOrder.id}/confirm-payment`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.printQueued, true);
    assert.equal(confirmData.order.status, 'accepted', 'Confirmed order must be auto-accepted immediately');

    const qrReceiptFile = await waitFor(
      () => fs.readdirSync(receiptsDir).find((f) => f.startsWith(qrOrder.orderCode)),
      10000,
      150,
      'Manually confirmed VietQR order printed'
    );
    const qrReceiptTxt = fs.readFileSync(path.join(receiptsDir, qrReceiptFile), 'utf8');
    assert.ok(qrReceiptTxt.includes('CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'));
    console.log(`✓ TEST 2 PASSED: Backup manual confirm ${qrOrder.orderCode} -> Auto-accepted -> Printed`);

    // =========================================================================
    // TEST 3: OFFLINE CATCH-UP + ZERO DUPLICATE PRINTING (SEPAY WHILE OFFLINE)
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

    // Place transfer order & pay via SePay while Shop PC has no internet
    const offRes = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Lê Thu Hà',
        customerPhone: '0905111222',
        customerAddress: 'Đường Vườn Cam, Cao Bằng',
        paymentMethod: 'bank_transfer',
        items: [{ menuItemId: traVaiItem.id, quantity: 1 }],
      }),
    });
    assert.equal(offRes.status, 201);
    const offOrder = (await offRes.json()).order;

    const offPayRes = await fetch(`${SERVER_URL}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        id: 987660,
        accountNumber: '8800000000',
        subAccount: '0000123456',
        code: offOrder.vietqr.content,
        transferType: 'in',
        transferAmount: offOrder.totalAmount,
        content: offOrder.vietqr.content,
        referenceCode: 'FT261123OFF1',
      }),
    });
    assert.equal(offPayRes.status, 200);

    // Even while shop PC is offline, order MUST already be auto-accepted!
    const offCheckRes = await fetch(
      `${SERVER_URL}/api/orders/${offOrder.orderCode}?token=${encodeURIComponent(offOrder.publicToken)}`
    );
    const offCheckData = await offCheckRes.json();
    assert.equal(offCheckData.status, 'accepted', 'Paid order must be auto-accepted even when shop PC is temporarily offline');

    // Verify /api/agent/pending-jobs & /api/agent/test-ticket serve server-rendered K80 HTML + alarm directive
    const pendingJobsRes = await fetch(`${SERVER_URL}/api/agent/pending-jobs`, {
      headers: { 'x-agent-secret': AGENT_SECRET },
    });
    assert.equal(pendingJobsRes.status, 200);
    const pendingJobsData = await pendingJobsRes.json();
    const offPendingJob = pendingJobsData.jobs.find((j) => j.orderCode === offOrder.orderCode);
    assert.ok(offPendingJob?.payload?.rendered?.html80?.includes('CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'), 'Pending job must include server-rendered K80 HTML');
    assert.equal(offPendingJob?.payload?.rendered?.printableMm80, 72);
    assert.equal(offPendingJob?.payload?.alarm?.play, true, 'Paid initial print job must instruct alarm.play = true');

    const testTicketRes = await fetch(`${SERVER_URL}/api/agent/test-ticket`, {
      headers: { 'x-agent-secret': AGENT_SECRET },
    });
    assert.equal(testTicketRes.status, 200);
    const testTicketData = await testTicketRes.json();
    assert.ok(testTicketData.ticket?.rendered?.html80?.includes('Content-Security-Policy'));
    assert.equal(testTicketData.ticket?.rendered?.printableMm80, 72);

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
    console.log(`✓ TEST 3 PASSED: Offline paid order ${offOrder.orderCode} auto-accepted immediately & caught up print with ZERO duplicates`);

    // =========================================================================
    // TEST 4: REPRINT + OUT-OF-STOCK + PAUSE MODE
    // =========================================================================
    const reprintRes = await fetch(`${SERVER_URL}/api/admin/orders/${order1.id}/reprint`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    assert.equal(reprintRes.status, 200);
    await waitFor(
      () => fs.readdirSync(receiptsDir).filter((f) => f.startsWith(order1.orderCode)).length === 2,
      8000,
      150,
      'reprint receipt created'
    );
    const order1Files = fs.readdirSync(receiptsDir).filter((f) => f.startsWith(order1.orderCode)).sort();
    const reprintedTxt = fs.readFileSync(path.join(receiptsDir, order1Files[1]), 'utf8');
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
        paymentMethod: 'bank_transfer',
        items: [{ menuItemId: hatDeItem.id, quantity: 1 }],
      }),
    });
    assert.equal(soldOutTry.status, 409, 'Ordering out-of-stock item must return 409');
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
        paymentMethod: 'bank_transfer',
        items: [{ menuItemId: hatDeItem.id, quantity: 1 }],
      }),
    });
    assert.equal(pausedTry.status, 503, 'Ordering while paused must return 503');
    await fetch(`${SERVER_URL}/api/admin/settings/pause`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ paused: false, message: '' }),
    });

    console.log('✓ TEST 4 PASSED: Reprint + Out-of-stock + Pause mode all verified!');

    // =========================================================================
    // TEST 5: SECURITY HARDENING VERIFICATION (v1.4.0)
    // =========================================================================
    // 5a. Security headers & version
    const healthRes = await fetch(`${SERVER_URL}/api/health`);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.version, '1.4.0', 'Health endpoint should expose version 1.4.0');
    assert.equal(healthRes.headers.get('x-powered-by'), null, 'X-Powered-By must be disabled');
    assert.ok(healthRes.headers.get('content-security-policy'), 'CSP header must be present');
    assert.ok(healthRes.headers.get('permissions-policy'), 'Permissions-Policy header must be present');
    assert.equal(healthRes.headers.get('x-frame-options'), 'SAMEORIGIN');

    // 5b. Order IDOR closed (requires publicToken)
    assert.ok(order1.publicToken && order1.publicToken.length >= 24, 'Order must have publicToken');
    const idorNoTok = await fetch(`${SERVER_URL}/api/orders/${order1.orderCode}`);
    assert.equal(idorNoTok.status, 404, 'GET /api/orders/:code without token must return 404');
    const idorBadTok = await fetch(`${SERVER_URL}/api/orders/${order1.orderCode}?token=deadbeef`);
    assert.equal(idorBadTok.status, 404, 'GET /api/orders/:code with wrong token must return 404');
    const idorGoodTok = await fetch(
      `${SERVER_URL}/api/orders/${order1.orderCode}?token=${encodeURIComponent(order1.publicToken)}`
    );
    assert.equal(idorGoodTok.status, 200, 'GET /api/orders/:code with valid token must return 200');
    const publicOrderView = await idorGoodTok.json();
    assert.equal(publicOrderView.orderCode, order1.orderCode);
    assert.equal(publicOrderView.customerPhone, undefined, 'Public order view must never expose phone');

    // 5c. WebSocket hardening: reject agent ?token=, reject customer missing/bad token, reject admin CSWSH
    const waitCloseCode = (ws, label) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          try { ws.terminate(); } catch {}
          reject(new Error(`Timed out waiting for WS close: ${label}`));
        }, 5000);
        ws.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        ws.once('error', () => {});
      });

    const badAgentWs = new WebSocket(
      `ws://127.0.0.1:${PORT}/ws?role=agent&token=${encodeURIComponent(AGENT_SECRET)}`
    );
    assert.equal(await waitCloseCode(badAgentWs, 'badAgentWs'), 4001, 'Agent WS with ?token= query string must be rejected');

    const badCustWs = new WebSocket(
      `ws://127.0.0.1:${PORT}/ws?role=customer&orderCode=${order1.orderCode}`
    );
    assert.equal(await waitCloseCode(badCustWs, 'badCustWs'), 4001, 'Customer WS without token must be rejected');

    const cswshWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws?role=admin`, {
      headers: { Cookie: cookieHeader, Origin: 'https://evil.example' },
    });
    assert.equal(await waitCloseCode(cswshWs, 'cswshWs'), 4003, 'Admin WS from untrusted Origin must be rejected (4003)');

    // 5d. CSRF Origin protection on Admin mutations
    const csrfRes = await fetch(`${SERVER_URL}/api/admin/settings/pause`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ paused: true, message: 'Hacked' }),
    });
    assert.equal(csrfRes.status, 403, 'Cross-origin admin mutation must be blocked with 403');

    // 5e. SePay webhook receiving account validation + txRef anti-replay
    const spOrder2Res = await fetch(`${SERVER_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Replay',
        customerPhone: '0911888777',
        customerAddress: 'Phường Sông Hiến, Cao Bằng',
        paymentMethod: 'bank_transfer',
        items: [{ menuItemId: traVaiItem.id, quantity: 1 }],
      }),
    });
    const spOrder2 = (await spOrder2Res.json()).order;

    const wrongAccRes = await fetch(`${SERVER_URL}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        id: 987655,
        accountNumber: '9999999999',
        subAccount: '96247WRONGVA',
        code: spOrder2.vietqr.content,
        transferType: 'in',
        transferAmount: spOrder2.totalAmount,
        content: spOrder2.vietqr.content,
        referenceCode: 'FT2611220099',
      }),
    });
    const wrongAccData = await wrongAccRes.json();
    assert.equal(wrongAccData.ignored, true, 'Wrong destination account must be ignored');

    const replayRes = await fetch(`${SERVER_URL}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        id: 987656,
        accountNumber: '8800000000',
        subAccount: '0000123456',
        code: spOrder2.vietqr.content,
        transferType: 'in',
        transferAmount: spOrder2.totalAmount,
        content: spOrder2.vietqr.content,
        referenceCode: 'FT2611220001', // Replaying order1's txRef!
      }),
    });
    const replayData = await replayRes.json();
    assert.equal(replayData.ignored, true, 'Replayed txRef must be ignored');
    assert.equal(replayData.reason, 'Transaction already used');

    // 5f. Fail-closed production config check (must refuse to boot with default/weak secrets)
    const badProdExitCode = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(repoRoot, 'server/dist/server/src/index.js')], {
        cwd: repoRoot,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          PORT: '3499',
          ADMIN_PASSWORD: 'nangcafe2026',
          SESSION_SECRET: 'short',
          SHOP_AGENT_SECRET: 'short',
        },
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        try { p.kill('SIGKILL'); } catch {}
        resolve(0);
      }, 5000);
      p.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });
    assert.notEqual(badProdExitCode, 0, 'Production server must fail-closed with weak/default secrets');

    console.log('✓ TEST 5 PASSED: Security headers, IDOR token, WS/CSWSH, CSRF Origin, SePay anti-replay & fail-closed config verified!');
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
