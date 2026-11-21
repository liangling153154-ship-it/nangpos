import type { IncomingMessage, Server as HttpServer } from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ADMIN_COOKIE_NAME,
  parseCookieHeader,
  verifySessionToken,
  verifyShopAgentSecret,
} from './auth.js';
import type {
  AgentPresence,
  OrderDTO,
  PrintJobDTO,
  ShopPauseState,
} from '../../../shared/types.js';

interface TrackedAgent {
  ws: WebSocket;
  info: AgentPresence;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private admins = new Set<WebSocket>();
  private agents = new Map<string, TrackedAgent>();
  private customerWatchers = new Map<string, Set<WebSocket>>();
  private publicClients = new Set<WebSocket>();
  private onAgentConnectedCallback: ((ws: WebSocket) => Promise<void>) | null = null;

  attach(
    server: HttpServer,
    onAgentConnected?: (ws: WebSocket) => Promise<void>
  ): void {
    this.onAgentConnectedCallback = onAgentConnected || null;
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const role = url.searchParams.get('role') || 'public';

      if (role === 'admin') {
        const cookies = parseCookieHeader(req.headers.cookie);
        const session = verifySessionToken(cookies[ADMIN_COOKIE_NAME]);
        if (!session) {
          ws.close(4001, 'Unauthorized admin');
          return;
        }
        this.admins.add(ws);
        this.send(ws, {
          type: 'admin:connected',
          agents: this.getOnlineAgents(),
        });
        ws.on('close', () => {
          this.admins.delete(ws);
        });
        return;
      }

      if (role === 'agent') {
        const secret =
          (req.headers['x-agent-secret'] as string) ||
          url.searchParams.get('token') ||
          '';
        if (!verifyShopAgentSecret(secret)) {
          ws.close(4001, 'Unauthorized shop agent');
          return;
        }

        const id = crypto.randomUUID().slice(0, 8);
        const hostname = url.searchParams.get('hostname') || 'windows-shop-pc';
        const printerMode = url.searchParams.get('printerMode') || 'windows';
        const printerName = url.searchParams.get('printerName') || 'Mặc định';
        const now = new Date().toISOString();

        const agent: TrackedAgent = {
          ws,
          info: {
            id,
            hostname,
            printerMode,
            printerName,
            connectedAt: now,
            lastHeartbeatAt: now,
          },
        };
        this.agents.set(id, agent);
        console.log(`[WS] Shop Agent connected: ${hostname} (${printerMode}: ${printerName})`);
        this.broadcastAdmins({ type: 'agents:updated', agents: this.getOnlineAgents() });

        this.send(ws, { type: 'agent:welcome', agentId: id, serverTime: now });

        // Immediately sync any pending unprinted jobs!
        if (this.onAgentConnectedCallback) {
          this.onAgentConnectedCallback(ws).catch((err) => {
            console.error('[WS] Failed to push pending print jobs on agent connect:', err);
          });
        }

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString('utf8'));
            if (msg?.type === 'ping') {
              agent.info.lastHeartbeatAt = new Date().toISOString();
              this.send(ws, { type: 'pong', ts: Date.now() });
            }
          } catch {
            // ignore malformed
          }
        });

        ws.on('close', () => {
          this.agents.delete(id);
          console.log(`[WS] Shop Agent disconnected: ${hostname}`);
          this.broadcastAdmins({ type: 'agents:updated', agents: this.getOnlineAgents() });
        });
        return;
      }

      if (role === 'customer') {
        const orderCode = (url.searchParams.get('orderCode') || '').toUpperCase();
        if (orderCode) {
          let set = this.customerWatchers.get(orderCode);
          if (!set) {
            set = new Set();
            this.customerWatchers.set(orderCode, set);
          }
          set.add(ws);
          ws.on('close', () => {
            set?.delete(ws);
            if (set && set.size === 0) {
              this.customerWatchers.delete(orderCode);
            }
          });
        }
        this.publicClients.add(ws);
        ws.on('close', () => this.publicClients.delete(ws));
        return;
      }

      // Public menu watcher (receives menu availability & pause updates live)
      this.publicClients.add(ws);
      ws.on('close', () => this.publicClients.delete(ws));
    });

    // Periodic ping to keep Railway proxy connections alive
    setInterval(() => {
      this.wss?.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      });
    }, 25_000);
  }

  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  getOnlineAgents(): AgentPresence[] {
    return Array.from(this.agents.values()).map((a) => a.info);
  }

  broadcastAdmins(event: Record<string, unknown>): void {
    const str = JSON.stringify(event);
    for (const ws of this.admins) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(str);
      }
    }
  }

  broadcastPublic(event: Record<string, unknown>): void {
    const str = JSON.stringify(event);
    for (const ws of this.publicClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(str);
      }
    }
  }

  pushPrintJobToAgents(job: PrintJobDTO): number {
    const str = JSON.stringify({ type: 'agent:print_job', job });
    let delivered = 0;
    for (const { ws } of this.agents.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(str);
        delivered++;
      }
    }
    return delivered;
  }

  pushPendingJobsToAgent(ws: WebSocket, jobs: PrintJobDTO[]): void {
    this.send(ws, { type: 'agent:pending_jobs', jobs });
  }

  notifyAgentsNewOrderAlert(order: OrderDTO): void {
    const str = JSON.stringify({
      type: 'agent:order_alert',
      orderCode: order.orderCode,
      paymentMethod: order.paymentMethod,
      status: order.status,
      totalAmount: order.totalAmount,
    });
    for (const { ws } of this.agents.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(str);
      }
    }
  }

  notifyOrderCreated(order: OrderDTO): void {
    this.broadcastAdmins({ type: 'order:new', order });
    this.notifyAgentsNewOrderAlert(order);
  }

  notifyOrderUpdated(order: OrderDTO): void {
    this.broadcastAdmins({ type: 'order:updated', order });
    const watchers = this.customerWatchers.get(order.orderCode);
    if (watchers) {
      const str = JSON.stringify({
        type: 'customer:order_updated',
        order: {
          orderCode: order.orderCode,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentConfirmedAt: order.paymentConfirmedAt,
        },
      });
      for (const ws of watchers) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(str);
        }
      }
    }
  }

  notifyMenuUpdated(): void {
    this.broadcastAdmins({ type: 'menu:updated' });
    this.broadcastPublic({ type: 'menu:updated' });
  }

  notifyPauseUpdated(pause: ShopPauseState): void {
    this.broadcastAdmins({ type: 'pause:updated', pause });
    this.broadcastPublic({ type: 'pause:updated', pause });
  }
}

export const realtimeHub = new RealtimeHub();
