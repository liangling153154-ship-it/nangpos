import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { confirmOrderPayment, getOrderByCode } from '../services/orders.js';

export const webhooksRouter = Router();

function safeCompare(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * [CHỜ GẮN SEPAY] Webhook nhận biến động số dư từ SePay (https://sepay.vn)
 *
 * Cách kích hoạt sau này:
 * 1. Đặt biến môi trường SEPAY_WEBHOOK_SECRET trên Railway.
 * 2. Trong SePay Dashboard -> Webhooks -> Tạo webhook:
 *    - URL: https://<domain-railway>/api/webhooks/sepay
 *    - Kiểu chứng thực: API Key -> Header `Authorization: Apikey <SEPAY_WEBHOOK_SECRET>`
 *    - Sự kiện: Có tiền vào (transferType = "in")
 * 3. Khi khách chuyển khoản đúng nội dung `NC1234` và đủ số tiền, endpoint này
 *    tự động gọi `confirmOrderPayment(..., { source: 'sepay' })`, đẩy phiếu xuống
 *    máy in quán và cập nhật trạng thái đơn realtime.
 */
webhooksRouter.post('/sepay', async (req, res, next) => {
  try {
    if (!config.sepayWebhookSecret) {
      res.status(501).json({
        success: false,
        message:
          'SePay webhook chưa được kích hoạt. Đặt biến môi trường SEPAY_WEBHOOK_SECRET để bật.',
      });
      return;
    }

    // SePay sends `Authorization: Apikey <secret>`
    const authHeader = req.header('authorization') || '';
    const match = authHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
    const providedKey = match ? match[1].trim() : '';

    if (!providedKey || !safeCompare(providedKey, config.sepayWebhookSecret)) {
      res.status(401).json({ success: false, message: 'Invalid SePay API key' });
      return;
    }

    const body = req.body as {
      id?: number | string;
      transferType?: string;
      transferAmount?: number;
      content?: string;
      description?: string;
      referenceCode?: string;
    };

    if (body.transferType && body.transferType !== 'in') {
      res.json({ success: true, ignored: true, reason: 'Not an incoming transfer' });
      return;
    }

    const text = `${body.content || ''} ${body.description || ''}`;
    const codeMatch = text.match(/\bNC\d{4,6}\b/i);
    if (!codeMatch) {
      res.json({ success: true, ignored: true, reason: 'No NC order code found' });
      return;
    }

    const orderCode = codeMatch[0].toUpperCase();
    const order = await getOrderByCode(orderCode);
    if (!order) {
      res.json({ success: true, ignored: true, reason: `Order ${orderCode} not found` });
      return;
    }

    const amount = Number(body.transferAmount || 0);
    if (amount < order.totalAmount) {
      console.warn(
        `[SePay] Underpaid transfer for ${orderCode}: got ${amount}, expected ${order.totalAmount}`
      );
      res.json({
        success: true,
        ignored: true,
        reason: `Underpaid (${amount} < ${order.totalAmount})`,
      });
      return;
    }

    const txRef = String(body.referenceCode || body.id || '');
    const result = await confirmOrderPayment(orderCode, {
      source: 'sepay',
      txRef,
    });

    res.json({
      success: true,
      orderCode,
      alreadyPaid: result.alreadyPaid,
      printQueued: Boolean(result.printJob),
    });
  } catch (err) {
    next(err);
  }
});
