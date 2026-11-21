import { config } from '../config.js';
import type { OrderDTO } from '../../../shared/types.js';

export interface NtfyResult {
  sent: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

function formatVnd(n: number): string {
  return n.toLocaleString('vi-VN') + 'đ';
}

export async function sendNtfyNotification(payload: {
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  clickUrl?: string;
}): Promise<NtfyResult> {
  if (!config.ntfy.topic) {
    return { sent: false, skipped: true, error: 'NTFY_TOPIC chưa được cấu hình' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (config.ntfy.token) {
      headers.Authorization = `Bearer ${config.ntfy.token}`;
    }

    // Use ntfy JSON publishing endpoint so Vietnamese UTF-8 titles/messages work cleanly
    const res = await fetch(config.ntfy.baseUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        topic: config.ntfy.topic,
        title: payload.title,
        message: payload.message,
        priority: payload.priority ?? 4,
        tags: payload.tags ?? ['coffee', 'bell'],
        click: payload.clickUrl || `${config.publicUrl}/admin`,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[ntfy] Failed (${res.status}): ${text}`);
      return { sent: false, status: res.status, error: text || `HTTP ${res.status}` };
    }

    return { sent: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ntfy] Error sending notification: ${msg}`);
    return { sent: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyNewOrder(order: OrderDTO): Promise<NtfyResult> {
  const paymentLabel =
    order.paymentMethod === 'cod'
      ? 'THU TIỀN MẶT (COD)'
      : 'CHUYỂN KHOẢN — CHỜ XÁC NHẬN TIỀN';

  const itemsText = order.items
    .map((it) => {
      const opts: string[] = [];
      if (it.variant) opts.push(it.variant);
      if (it.sizeLabel && it.size === 'L') opts.push(it.sizeLabel);
      if (it.ice) opts.push(it.ice);
      if (it.sugar) opts.push(it.sugar);
      if (it.toppings.length > 0) {
        opts.push('+' + it.toppings.map((t) => t.name).join(', '));
      }
      const optStr = opts.length ? ` (${opts.join(' · ')})` : '';
      return `• ${it.quantity}x ${it.name}${optStr}`;
    })
    .join('\n');

  const lines = [
    `${paymentLabel}`,
    `Khách: ${order.customerName} — ${order.customerPhone}`,
    `Địa chỉ: ${order.customerAddress}`,
    itemsText,
    `Tổng đồ uống: ${formatVnd(order.totalAmount)} (phí ship quán báo sau)`,
  ];
  if (order.note) {
    lines.push(`Ghi chú: ${order.note}`);
  }

  return sendNtfyNotification({
    title: `Đơn mới ${order.orderCode} · ${formatVnd(order.totalAmount)}`,
    message: lines.join('\n'),
    priority: 4,
    tags: order.paymentMethod === 'cod' ? ['coffee', 'moneybag'] : ['coffee', 'bell'],
    clickUrl: `${config.publicUrl}/admin`,
  });
}

export async function notifyPaymentConfirmed(
  order: OrderDTO,
  source: 'manual' | 'sepay'
): Promise<NtfyResult> {
  return sendNtfyNotification({
    title: `Đã nhận tiền ${order.orderCode} · ${formatVnd(order.totalAmount)}`,
    message:
      source === 'sepay'
        ? `SePay tự động xác nhận đơn ${order.orderCode} (${order.customerName}). Phiếu đã đẩy xuống máy in quán.`
        : `Đã xác nhận tiền đơn ${order.orderCode} (${order.customerName}). Phiếu đã đẩy xuống máy in quán.`,
    priority: 3,
    tags: ['white_check_mark', 'coffee'],
    clickUrl: `${config.publicUrl}/admin`,
  });
}
