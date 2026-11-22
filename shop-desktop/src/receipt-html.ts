import type { PrintTicketPayload } from '../../shared/types';

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Crisp 58mm / 80mm (K58 / K80) thermal receipt HTML with 100% Vietnamese Unicode typography.
 * Calibrated for real K80 thermal print heads (72mm printable width -> 66mm safe content box,
 * left-anchored so right-edge totals/prices NEVER clip, with bold thermal-dark ink).
 */
export function buildReceiptHtml(ticket: PrintTicketPayload, paperMm: 58 | 80): string {
  const pageWidthMm = paperMm === 58 ? 48 : 72;
  const contentWidthMm = paperMm === 58 ? 45 : 66;
  const baseFontPx = paperMm === 58 ? 11 : 12;

  const badgeTitle = ticket.isTest
    ? '*** PHIẾU IN THỬ ***'
    : ticket.isReprint
      ? '*** BẢN IN LẠI ***'
      : 'PHIẾU ĐƠN ĐẶT SHIP';

  const paymentBanner =
    ticket.paymentMethod === 'cod'
      ? `<div class="cod-box">
           <div class="cod-title">THU TIỀN MẶT: ${escapeHtml(formatVnd(ticket.totalAmount))}</div>
           <div class="cod-sub">(Chưa gồm phí ship)</div>
         </div>`
      : ticket.paymentStatus === 'paid'
        ? `<div class="paid-box">CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN<div class="paid-sub">(Không thu tiền đồ uống)</div></div>`
        : `<div class="paid-box">CHUYỂN KHOẢN · CHỜ XÁC NHẬN TIỀN</div>`;

  const itemsHtml = ticket.items
    .map((item) => {
      const sizeTag = item.size === 'L' ? ' (L)' : '';
      const opts = [item.variant, item.ice, item.sugar].filter(Boolean).join(' / ');
      const toppingsHtml = item.toppings
        .map(
          (t) =>
            `<div class="item-sub">+ ${escapeHtml(t.name)} (+${Math.round(t.price / 1000)}k)</div>`
        )
        .join('');
      const noteHtml = item.note
        ? `<div class="item-note">* Ghi chú: ${escapeHtml(item.note)}</div>`
        : '';

      return `<div class="item">
        <div class="item-row">
          <span class="item-name">${item.quantity}x ${escapeHtml(item.name)}${sizeTag}</span>
          <span class="item-price">${escapeHtml(formatVnd(item.lineTotal))}</span>
        </div>
        ${opts ? `<div class="item-sub">· ${escapeHtml(opts)}</div>` : ''}
        ${toppingsHtml}
        ${noteHtml}
      </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<style>
  @page {
    size: ${pageWidthMm}mm auto;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${contentWidthMm}mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
  }
  body {
    padding: 2mm 1.5mm 7mm 1mm;
    font-family: Arial, Tahoma, 'Segoe UI', sans-serif;
    font-size: ${baseFontPx}px;
    font-weight: 600;
    line-height: 1.38;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .center { text-align: center; }
  .shop-name { font-size: ${baseFontPx + 3.5}px; font-weight: 900; letter-spacing: 0.03em; }
  .shop-sub { font-size: ${baseFontPx - 0.5}px; font-weight: 600; margin-top: 1px; }
  .doc-type { font-size: ${baseFontPx + 1}px; font-weight: 800; margin-top: 3px; }
  .rule-thick { border: 0; border-top: 2px solid #000; margin: 5px 0; }
  .rule-dash { border: 0; border-top: 1.5px dashed #000; margin: 5px 0; }
  .order-code { font-size: ${baseFontPx + 6}px; font-weight: 900; letter-spacing: 0.03em; margin: 2px 0; white-space: nowrap; }
  .order-time { font-size: ${baseFontPx - 0.5}px; font-weight: 600; }
  .cod-box {
    background: #000;
    color: #fff;
    padding: 6px 4px;
    text-align: center;
    margin: 6px 0;
    border-radius: 2px;
  }
  .cod-title { font-size: ${baseFontPx + 2}px; font-weight: 900; }
  .cod-sub { font-size: ${baseFontPx - 1}px; margin-top: 2px; font-weight: 700; }
  .paid-box {
    border: 2px solid #000;
    padding: 5px 4px;
    text-align: center;
    font-size: ${baseFontPx}px;
    font-weight: 800;
    margin: 6px 0;
  }
  .paid-sub { font-size: ${baseFontPx - 1}px; font-weight: 600; margin-top: 1px; }
  .cust-row { margin: 2px 0; word-break: break-word; }
  .cust-row strong { font-weight: 800; }
  .items-head { display: flex; justify-content: space-between; font-weight: 900; font-size: ${baseFontPx - 0.5}px; }
  .item { padding: 4px 0; border-bottom: 1px dashed #000; }
  .item:last-child { border-bottom: 0; }
  .item-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; font-weight: 800; }
  .item-name { flex: 1; min-width: 0; word-break: break-word; }
  .item-price { flex: none; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
  .item-sub { padding-left: 6px; font-size: ${baseFontPx - 1}px; font-weight: 600; }
  .item-note { padding-left: 6px; font-size: ${baseFontPx - 0.5}px; font-weight: 800; margin-top: 2px; }
  .order-note { border: 1.5px solid #000; padding: 4px 6px; margin-top: 6px; font-weight: 800; word-break: break-word; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: ${baseFontPx + 2.5}px; font-weight: 900; margin-top: 4px; }
  .total-row span:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ship-note { font-size: ${baseFontPx - 0.5}px; font-weight: 600; margin-top: 2px; }
  .cod-remind { text-align: center; font-weight: 900; margin-top: 5px; font-size: ${baseFontPx + 1}px; }
  .footer { text-align: center; font-size: ${baseFontPx - 0.5}px; font-weight: 600; margin-top: 7px; }
</style>
</head>
<body>
  <div class="center">
    <div class="shop-name">NÂNG CAFÉ · CAO BẰNG</div>
    <div class="shop-sub">075 tổ 10, P. Sông Hiến</div>
    <div class="doc-type">${badgeTitle}</div>
  </div>

  <hr class="rule-thick" />
  <div class="center">
    <div class="order-code">${escapeHtml(ticket.orderCode)}</div>
    <div class="order-time">Giờ đặt: ${escapeHtml(formatVnDateTime(ticket.createdAt))}</div>
  </div>
  ${paymentBanner}

  <div class="cust-row"><strong>Khách:</strong> ${escapeHtml(ticket.customerName)}</div>
  <div class="cust-row"><strong>SĐT:</strong> ${escapeHtml(ticket.customerPhone)}</div>
  <div class="cust-row"><strong>Đ/c:</strong> ${escapeHtml(ticket.customerAddress)}</div>

  <hr class="rule-dash" />
  <div class="items-head"><span>MÓN</span><span>THÀNH TIỀN</span></div>
  <hr class="rule-dash" />
  ${itemsHtml}

  ${ticket.note ? `<div class="order-note">GHI CHÚ ĐƠN: ${escapeHtml(ticket.note)}</div>` : ''}

  <hr class="rule-thick" />
  <div class="total-row">
    <span>TỔNG ĐỒ UỐNG:</span>
    <span>${escapeHtml(formatVnd(ticket.totalAmount))}</span>
  </div>
  <div class="ship-note">Phí ship: Quán báo riêng cho khách</div>
  ${ticket.paymentMethod === 'cod' ? `<div class="cod-remind">&gt;&gt;&gt; THU TIỀN MẶT &lt;&lt;&lt;</div>` : ''}
  <hr class="rule-dash" />
  <div class="footer">Cảm ơn quý khách đã đặt Nâng Café!</div>
</body>
</html>`;
}

export function buildReceiptPlainText(ticket: PrintTicketPayload, paperMm: 58 | 80): string {
  const width = paperMm === 58 ? 32 : 42;
  const line = '-'.repeat(width);
  const thick = '='.repeat(width);
  const out: string[] = [
    'NÂNG CAFÉ · CAO BẰNG',
    '075 tổ 10, P. Sông Hiến',
    ticket.isTest
      ? '*** PHIẾU IN THỬ ***'
      : ticket.isReprint
        ? '*** BẢN IN LẠI ***'
        : 'PHIẾU ĐƠN ĐẶT SHIP',
    thick,
    `MÃ ĐƠN: ${ticket.orderCode}`,
    `Giờ đặt: ${formatVnDateTime(ticket.createdAt)}`,
    thick,
    ticket.paymentMethod === 'cod'
      ? `>>> THU TIỀN MẶT: ${formatVnd(ticket.totalAmount)} <<<`
      : ticket.paymentStatus === 'paid'
        ? 'CHUYỂN KHOẢN · ĐÃ NHẬN TIỀN'
        : 'CHUYỂN KHOẢN · CHỜ XÁC NHẬN TIỀN',
    line,
    `Khách: ${ticket.customerName}`,
    `SĐT:   ${ticket.customerPhone}`,
    `Đ/c:   ${ticket.customerAddress}`,
    line,
  ];

  for (const item of ticket.items) {
    const sizeTag = item.size === 'L' ? ' (L)' : '';
    out.push(`${item.quantity}x ${item.name}${sizeTag} — ${formatVnd(item.lineTotal)}`);
    const opts = [item.variant, item.ice, item.sugar].filter(Boolean).join(' / ');
    if (opts) out.push(`  · ${opts}`);
    for (const t of item.toppings) {
      out.push(`  + ${t.name} (+${Math.round(t.price / 1000)}k)`);
    }
    if (item.note) out.push(`  * Ghi chú: ${item.note}`);
  }

  if (ticket.note) {
    out.push(line);
    out.push(`GHI CHÚ ĐƠN: ${ticket.note}`);
  }

  out.push(thick);
  out.push(`TỔNG ĐỒ UỐNG: ${formatVnd(ticket.totalAmount)}`);
  out.push('Phí ship: Quán báo riêng cho khách');
  if (ticket.paymentMethod === 'cod') out.push('>>> NHỚ THU TIỀN MẶT <<<');
  out.push(line);
  return out.join('\n');
}
