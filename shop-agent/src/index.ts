import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import type { PrintJobDTO } from '../../shared/types.js';
import { PrintedJournal } from './journal.js';
import { AudioNotifier } from './audio.js';
import { printReceipt, type PrinterConfig, type PrinterMode } from './printer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.resolve(__dirname, __dirname.includes('dist') ? '../../..' : '..');
dotenv.config({ path: path.join(agentRoot, '.env') });
dotenv.config({ path: path.resolve(agentRoot, '../.env') });

const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const SHOP_AGENT_SECRET =
  process.env.SHOP_AGENT_SECRET || 'dev-only-shop-agent-secret-change-me';
const PRINTER_MODE = (process.env.PRINTER_MODE || 'windows') as PrinterMode;
const PRINTER_NAME = process.env.PRINTER_NAME || '';
const PRINTER_PAPER_MM = Number(process.env.PRINTER_PAPER_MM) === 58 ? 58 : 80;
const PRINTER_HOST = process.env.PRINTER_HOST || '192.168.1.200';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const AUDIO_ENABLED = !['0', 'false', 'no', 'off'].includes(
  (process.env.AUDIO_ENABLED || 'true').toLowerCase()
);
const RECONCILE_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.RECONCILE_INTERVAL_MS || 25_000)
);
const DATA_DIR = process.env.AGENT_DATA_DIR || path.join(agentRoot, 'data');
const MOCK_OUTPUT_DIR =
  process.env.MOCK_OUTPUT_DIR || path.join(agentRoot, 'printed-receipts');

const hostname = os.hostname();
const journal = new PrintedJournal(DATA_DIR);
const audio = new AudioNotifier(AUDIO_ENABLED);
const printerCfg: PrinterConfig = {
  mode: PRINTER_MODE,
  printerName: PRINTER_NAME,
  paperMm: PRINTER_PAPER_MM,
  host: PRINTER_HOST,
  port: PRINTER_PORT,
  mockOutputDir: MOCK_OUTPUT_DIR,
};

// Serialized print pipeline with in-flight deduplication
const inFlightKeys = new Set<string>();
let printChain: Promise<void> = Promise.resolve();

async function ackJobOnServer(jobId: number): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/agent/print-jobs/${jobId}/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-secret': SHOP_AGENT_SECRET,
    },
    body: JSON.stringify({ hostname }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ACK HTTP ${res.status}: ${txt}`);
  }
}

async function reportJobFailure(jobId: number, errMsg: string): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/api/agent/print-jobs/${jobId}/fail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-secret': SHOP_AGENT_SECRET,
      },
      body: JSON.stringify({ error: errMsg }),
    });
  } catch {
    // best effort
  }
}

function enqueuePrintJob(job: PrintJobDTO): void {
  if (inFlightKeys.has(job.idempotencyKey)) {
    return;
  }
  inFlightKeys.add(job.idempotencyKey);

  printChain = printChain
    .then(async () => {
      try {
        // Offline/Reconnect duplicate protection!
        if (journal.has(job.idempotencyKey)) {
          console.log(
            `[Duplicate Guard] Job #${job.id} (${job.idempotencyKey}) already printed locally -> skipping print & re-ACKing server`
          );
          await ackJobOnServer(job.id);
          return;
        }

        console.log(
          `[Shop Agent] Processing print job #${job.id} (${job.jobType}) for ${job.orderCode}...`
        );

        // Ring bell + Vietnamese "Đơn mới" concurrently with thermal print spooling
        const soundPromise =
          job.jobType === 'reprint'
            ? Promise.resolve()
            : audio.announceNewOrder('new_order');

        await printReceipt(job.payload, printerCfg, job.id);

        // Persist locally BEFORE ACKing server so even an immediate network drop cannot cause double-print!
        journal.markPrinted(job.idempotencyKey, job.orderCode);
        await ackJobOnServer(job.id);
        await soundPromise;

        console.log(`[Shop Agent] Completed & ACKed job #${job.id} (${job.orderCode})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Shop Agent] Error processing job #${job.id} (${job.orderCode}):`, msg);
        await reportJobFailure(job.id, msg);
      } finally {
        inFlightKeys.delete(job.idempotencyKey);
      }
    })
    .catch(() => {});
}

async function pullPendingJobs(): Promise<void> {
  try {
    const res = await fetch(`${SERVER_URL}/api/agent/pending-jobs`, {
      headers: { 'x-agent-secret': SHOP_AGENT_SECRET },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { jobs?: PrintJobDTO[] };
    if (Array.isArray(data.jobs) && data.jobs.length > 0) {
      console.log(`[Shop Agent] Catch-up sync found ${data.jobs.length} pending job(s)`);
      for (const job of data.jobs) {
        enqueuePrintJob(job);
      }
    }
  } catch (err) {
    // Offline; will retry on next reconnect / interval
  }
}

function buildWsUrl(): string {
  const wsBase = SERVER_URL.replace(/^http/i, 'ws');
  const params = new URLSearchParams({
    role: 'agent',
    hostname,
    printerMode: PRINTER_MODE,
    printerName: PRINTER_NAME || (PRINTER_MODE === 'mock' ? 'Mock Receipt' : 'Mặc định'),
  });
  return `${wsBase}/ws?${params.toString()}`;
}

let reconnectDelay = 1500;
let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

function connect(): void {
  const wsUrl = buildWsUrl();
  console.log(`[Shop Agent] Connecting to ${SERVER_URL} (${PRINTER_MODE}, ${PRINTER_PAPER_MM}mm)...`);

  ws = new WebSocket(wsUrl, {
    headers: { 'x-agent-secret': SHOP_AGENT_SECRET },
  });

  ws.on('open', () => {
    console.log(`[Shop Agent] Connected to Nâng Café server! Host: ${hostname}`);
    reconnectDelay = 1500;

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
    }, 20_000);

    // Belt-and-suspenders pull for any pending jobs missed while offline
    pullPendingJobs();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === 'agent:print_job' && msg.job) {
        enqueuePrintJob(msg.job as PrintJobDTO);
      } else if (msg.type === 'agent:pending_jobs' && Array.isArray(msg.jobs)) {
        if (msg.jobs.length > 0) {
          console.log(`[Shop Agent] Received ${msg.jobs.length} queued job(s) from server`);
          for (const job of msg.jobs as PrintJobDTO[]) {
            enqueuePrintJob(job);
          }
        }
      } else if (msg.type === 'agent:order_alert') {
        if (msg.paymentMethod === 'bank_transfer' && msg.status === 'awaiting_payment') {
          console.log(`[Shop Agent] Order ${msg.orderCode} awaiting VietQR transfer (auto-accept on payment)`);
        }
      }
    } catch (err) {
      console.error('[Shop Agent] Bad WS message:', err);
    }
  });

  ws.on('close', (code, reason) => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const reasonStr = reason?.toString('utf8') || '';
    console.warn(
      `[Shop Agent] Disconnected (code=${code}${reasonStr ? `, ${reasonStr}` : ''}). Reconnecting in ${Math.round(reconnectDelay / 1000)}s...`
    );
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(15_000, Math.round(reconnectDelay * 1.6));
  });

  ws.on('error', (err) => {
    console.error('[Shop Agent] WebSocket error:', err.message);
  });
}

console.log('====================================================');
console.log('  NÂNG CAFÉ — MÁY IN PHIẾU & LOA ĐỌC ĐƠN MỚI');
console.log(`  Server:   ${SERVER_URL}`);
console.log(`  Máy in:   ${PRINTER_MODE} (${PRINTER_NAME || 'Mặc định'}, ${PRINTER_PAPER_MM}mm)`);
console.log(`  Loa:      ${AUDIO_ENABLED ? 'BẬT (Chuông + "Đơn mới")' : 'TẮT'}`);
console.log(`  Đã lưu:   ${journal.size()} phiếu trong bộ nhớ chống in trùng`);
console.log('====================================================');

connect();
setInterval(pullPendingJobs, RECONCILE_INTERVAL_MS);
