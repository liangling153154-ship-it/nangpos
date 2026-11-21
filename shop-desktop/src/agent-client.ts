import os from 'node:os';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { PrintJobDTO } from '../../shared/types';
import type { DesktopConfig } from './config-store';
import { PrintedJournal } from './journal';
import { printDesktopReceipt } from './printer';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'auth_error';

export interface ActivityLogEntry {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export class DesktopAgentClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1500;
  private stopped = false;
  private state: ConnectionState = 'disconnected';
  private inFlightKeys = new Set<string>();
  private printChain: Promise<void> = Promise.resolve();
  private hostname = os.hostname();
  private logs: ActivityLogEntry[] = [];

  constructor(
    private getConfig: () => DesktopConfig,
    private journal: PrintedJournal,
    private mockDir: string
  ) {
    super();
  }

  getState(): ConnectionState {
    return this.state;
  }

  getLogs(): ActivityLogEntry[] {
    return [...this.logs];
  }

  private pushLog(level: ActivityLogEntry['level'], message: string): void {
    const entry: ActivityLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      level,
      message,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 60) this.logs.length = 60;
    this.emit('log', entry);
  }

  private setState(next: ConnectionState): void {
    if (this.state !== next) {
      this.state = next;
      this.emit('state', next);
    }
  }

  start(): void {
    this.stopped = false;
    this.connect();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = setInterval(() => {
      this.pullPendingJobs();
    }, 25_000);
  }

  restart(): void {
    this.stop();
    this.reconnectDelay = 1500;
    this.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setState('disconnected');
  }

  private buildWsUrl(cfg: DesktopConfig): string {
    const wsBase = cfg.serverUrl.replace(/^http/i, 'ws');
    const params = new URLSearchParams({
      role: 'agent',
      hostname: `${this.hostname} (App)`,
      printerMode: cfg.printerMode,
      printerName:
        cfg.printerName ||
        (cfg.printerMode === 'mock' ? 'Chế độ thử' : 'Mặc định Windows'),
    });
    return `${wsBase}/ws?${params.toString()}`;
  }

  private connect(): void {
    if (this.stopped) return;
    const cfg = this.getConfig();
    if (!cfg.serverUrl || !cfg.agentSecret) {
      this.setState('disconnected');
      this.pushLog('warn', 'Chưa nhập Link Railway hoặc Mã bảo mật máy tính quán.');
      return;
    }

    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.buildWsUrl(cfg), {
        headers: { 'x-agent-secret': cfg.agentSecret },
      });
    } catch (err) {
      this.pushLog('error', `URL server không hợp lệ: ${cfg.serverUrl}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      if (this.stopped) return;
      this.reconnectDelay = 1500;
      this.setState('connected');
      this.pushLog('success', `Đã kết nối máy chủ nhận đơn (${cfg.serverUrl}).`);

      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
      }, 20_000);

      // Catch up any unprinted orders missed while offline
      this.pullPendingJobs();
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        if (msg.type === 'agent:print_job' && msg.job) {
          this.enqueuePrintJob(msg.job as PrintJobDTO);
        } else if (msg.type === 'agent:pending_jobs' && Array.isArray(msg.jobs)) {
          if (msg.jobs.length > 0) {
            this.pushLog('info', `Đồng bộ ${msg.jobs.length} phiếu chưa in từ máy chủ.`);
            for (const job of msg.jobs as PrintJobDTO[]) {
              this.enqueuePrintJob(job);
            }
          }
        } else if (msg.type === 'agent:order_alert') {
          if (msg.paymentMethod === 'bank_transfer' && msg.status === 'awaiting_payment') {
            this.pushLog(
              'warn',
              `Đơn chuyển khoản mới ${msg.orderCode} — đang chờ chủ quán xác nhận tiền.`
            );
            this.emit('alarm', {
              kind: 'transfer_alert',
              orderCode: msg.orderCode,
              title: `Đơn chuyển khoản mới ${msg.orderCode}`,
              body: 'Kiểm tra tiền về tài khoản BIDV rồi bấm "Xác nhận đã nhận tiền" để in phiếu.',
            });
          }
        }
      } catch {
        // ignore bad frame
      }
    });

    ws.on('close', (code) => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.stopped) return;
      if (code === 4001) {
        this.setState('auth_error');
        this.pushLog(
          'error',
          'Sai SHOP_AGENT_SECRET! Vui lòng mở Cài đặt nhập đúng mã trùng với Railway.'
        );
        return;
      }
      this.setState('disconnected');
      this.pushLog(
        'warn',
        `Mất kết nối máy chủ. Tự kết nối lại sau ${Math.round(this.reconnectDelay / 1000)} giây...`
      );
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      if (this.stopped) return;
      this.pushLog('error', `Lỗi kết nối: ${err.message}`);
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(15_000, Math.round(this.reconnectDelay * 1.6));
  }

  private async pullPendingJobs(): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg.serverUrl || !cfg.agentSecret) return;
    try {
      const res = await fetch(`${cfg.serverUrl}/api/agent/pending-jobs`, {
        headers: { 'x-agent-secret': cfg.agentSecret },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: PrintJobDTO[] };
      if (Array.isArray(data.jobs) && data.jobs.length > 0) {
        for (const job of data.jobs) {
          this.enqueuePrintJob(job);
        }
      }
    } catch {
      // offline
    }
  }

  private async ackJobOnServer(jobId: number): Promise<void> {
    const cfg = this.getConfig();
    const res = await fetch(`${cfg.serverUrl}/api/agent/print-jobs/${jobId}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-secret': cfg.agentSecret,
      },
      body: JSON.stringify({ hostname: `${this.hostname} (App)` }),
    });
    if (!res.ok) {
      throw new Error(`ACK HTTP ${res.status}`);
    }
  }

  private async failJobOnServer(jobId: number, errMsg: string): Promise<void> {
    const cfg = this.getConfig();
    try {
      await fetch(`${cfg.serverUrl}/api/agent/print-jobs/${jobId}/fail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-secret': cfg.agentSecret,
        },
        body: JSON.stringify({ error: errMsg }),
      });
    } catch {
      // ignore
    }
  }

  private enqueuePrintJob(job: PrintJobDTO): void {
    if (this.inFlightKeys.has(job.idempotencyKey)) return;
    this.inFlightKeys.add(job.idempotencyKey);

    this.printChain = this.printChain
      .then(async () => {
        try {
          if (this.journal.has(job.idempotencyKey)) {
            this.pushLog(
              'info',
              `Chống in trùng: Phiếu ${job.orderCode} đã in trước đó → đồng bộ lại với server.`
            );
            await this.ackJobOnServer(job.id);
            return;
          }

          const cfg = this.getConfig();

          // Trigger 10-second speaker alarm & desktop notification for new orders (skip alarm on manual reprint)
          if (job.jobType !== 'reprint') {
            this.emit('alarm', {
              kind: 'new_order',
              orderCode: job.orderCode,
              title: `Đơn mới ${job.orderCode}`,
              body: `${job.payload.customerName} · ${job.payload.paymentMethod === 'cod' ? 'THU TIỀN MẶT' : 'Đã chuyển khoản'} — Đang tự động in phiếu!`,
            });
          }

          this.pushLog(
            'info',
            `Đang tự động in phiếu ${job.orderCode}${job.jobType === 'reprint' ? ' (bản in lại)' : ''}...`
          );

          const res = await printDesktopReceipt(job.payload, cfg, job.id, this.mockDir);

          // Persist to local journal BEFORE ACK to guarantee zero duplicate prints
          this.journal.markPrinted(job.idempotencyKey, job.orderCode);
          await this.ackJobOnServer(job.id);

          this.pushLog(
            'success',
            `Đã in xong phiếu ${job.orderCode}${res.outputPath ? ' (chế độ thử)' : ''}!`
          );
          this.emit('printed', { orderCode: job.orderCode, outputPath: res.outputPath });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.pushLog('error', `Lỗi in phiếu ${job.orderCode}: ${msg}`);
          await this.failJobOnServer(job.id, msg);
        } finally {
          this.inFlightKeys.delete(job.idempotencyKey);
        }
      })
      .catch(() => {});
  }

  async triggerLocalTestPrint(): Promise<{ outputPath?: string }> {
    const cfg = this.getConfig();
    this.pushLog('info', 'Đang in phiếu thử trực tiếp...');
    const res = await printDesktopReceipt(
      {
        orderCode: 'NC8888',
        createdAt: new Date().toISOString(),
        isReprint: false,
        isTest: true,
        customerName: 'Phiếu in thử — Nâng Café',
        customerPhone: '0912 345 678',
        customerAddress: '075 tổ 10, P. Sông Hiến, Cao Bằng',
        note: 'Kiểm tra máy in nhiệt & loa 10 giây',
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
            note: 'Ít kem chút',
            quantity: 1,
            unitPrice: 73000,
            lineTotal: 73000,
          },
        ],
        totalAmount: 73000,
        paymentMethod: 'cod',
        paymentStatus: 'cod',
      },
      cfg,
      'local-test',
      this.mockDir
    );
    this.pushLog(
      'success',
      `Đã in phiếu thử NC8888 thành công${res.outputPath ? ` (${res.outputPath})` : ''}!`
    );
    return res;
  }
}
