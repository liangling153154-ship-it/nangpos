import type { PrintTicketPayload } from '../../shared/types.js';

export function formatVnd(amount: number): string {
  return Math.round(amount).toLocaleString('vi-VN') + 'đ';
}

export function formatVnDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('vi-VN');
  }
}

export function stripVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxWidth) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

function centerText(text: string, width: number): string {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function twoCol(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  if (left.length + right.length + 1 > width) {
    const trimmed = left.slice(0, Math.max(1, width - right.length - 2)) + '…';
    return trimmed + ' ' + right;
  }
  return left + ' '.repeat(space) + right;
}

export interface ReceiptLine {
  text: string;
  align?: 'left' | 'center';
  bold?: boolean;
  large?: boolean;
  invert?: boolean;
}

export function buildReceiptLines(
  ticket: PrintTicketPayload,
  paperMm: 58 | 80 = 80
): ReceiptLine[] {
  const width = paperMm === 58 ? 32 : 42;
  const divider = '-'.repeat(width);
  const thick = '='.repeat(width);
  const lines: ReceiptLine[] = [];

  lines.push({ text: 'NÂNG CAFÉ · CAO BẰNG', align: 'center', bold: true, large: true });
  lines.push({ text: '075 tổ 10, P. Sông Hiến', align: 'center' });

  if (ticket.isTest) {
    lines.push({ text: '*** PHIẾU IN THỬ ***', align: 'center', bold: true });
  } else if (ticket.isReprint) {
    lines.push({ text: '*** BẢN IN LẠI ***', align: 'center', bold: true });
  } else {
    lines.push({ text: 'PHIẾU ĐƠN ĐẶT SHIP', align: 'center', bold: true });
  }

  lines.push({ text: thick });
  lines.push({ text: `MÃ ĐƠN: ${ticket.orderCode}`, align: 'center', bold: true, large: true });
  lines.push({ text: `Giờ đặt: ${formatVnDateTime(ticket.createdAt)}`, align: 'center' });
  lines.push({ text: thick });

  // Payment callout block — super clear for cashier/barista/shipper
  if (ticket.paymentMethod === 'cod') {
    lines.push({
      text: `THU TIỀN MẶT: ${formatVnd(ticket.totalAmount)}`,
      align: 'center',
      bold: true,
      large: true,
      invert: true,
    });
    lines.push({ text: '(Thu tiền mặt khi giao · chưa gồm ship)', align: 'center', bold: true });
  } else if (ticket.paymentStatus === 'paid') {
    lines.push({ text: 'CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN', align: 'center', bold: true });
    lines.push({ text: '(Không thu tiền đồ uống)', align: 'center' });
  } else {
    lines.push({ text: 'CHUYỂN KHOẢN · CHỜ XÁC NHẬN TIỀN', align: 'center', bold: true });
  }

  lines.push({ text: divider });

  // Customer info
  for (const l of wrapText(`Khách: ${ticket.customerName}`, width)) {
    lines.push({ text: l, bold: true });
  }
  lines.push({ text: `SĐT:   ${ticket.customerPhone}`, bold: true });
  const addrLines = wrapText(`Đ/c:   ${ticket.customerAddress}`, width);
  for (const l of addrLines) {
    lines.push({ text: l });
  }

  lines.push({ text: divider });
  lines.push({ text: twoCol('MÓN', 'THÀNH TIỀN', width), bold: true });
  lines.push({ text: divider });

  // Items with full options
  for (const item of ticket.items) {
    const sizeTag = item.size === 'L' ? ' (L)' : '';
    const title = `${item.quantity}x ${item.name}${sizeTag}`;
    const priceStr = formatVnd(item.lineTotal);
    lines.push({ text: twoCol(title, priceStr, width), bold: true });

    const opts: string[] = [];
    if (item.variant) opts.push(item.variant);
    if (item.ice) opts.push(item.ice);
    if (item.sugar) opts.push(item.sugar);
    if (opts.length > 0) {
      for (const l of wrapText(`  · ${opts.join(' / ')}`, width)) {
        lines.push({ text: l });
      }
    }

    for (const top of item.toppings) {
      lines.push({ text: `  + ${top.name} (+${Math.round(top.price / 1000)}k)` });
    }

    if (item.note) {
      for (const l of wrapText(`  * Ghi chú: ${item.note}`, width)) {
        lines.push({ text: l, bold: true });
      }
    }
  }

  if (ticket.note) {
    lines.push({ text: divider });
    for (const l of wrapText(`GHI CHÚ ĐƠN: ${ticket.note}`, width)) {
      lines.push({ text: l, bold: true });
    }
  }

  lines.push({ text: thick });
  lines.push({
    text: twoCol('TỔNG ĐỒ UỐNG:', formatVnd(ticket.totalAmount), width),
    bold: true,
    large: true,
  });
  lines.push({ text: 'Phí ship: Quán báo riêng cho khách' });
  if (ticket.paymentMethod === 'cod') {
    lines.push({ text: '>>> NHỚ THU TIỀN MẶT <<<', align: 'center', bold: true });
  }
  lines.push({ text: divider });
  lines.push({ text: 'Nâng Café — Cảm ơn quý khách!', align: 'center' });

  return lines;
}

export function renderPlainTextReceipt(
  ticket: PrintTicketPayload,
  paperMm: 58 | 80 = 80
): string {
  const width = paperMm === 58 ? 32 : 42;
  const lines = buildReceiptLines(ticket, paperMm);
  return lines
    .map((l) => (l.align === 'center' ? centerText(l.text, width) : l.text))
    .join('\n');
}
