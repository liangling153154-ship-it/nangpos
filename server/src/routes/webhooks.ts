import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import {
  confirmOrderPayment,
  findOrderByTxRef,
  getOrderByCode,
} from '../services/orders.js';

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

    // SePay sends `Authorization: Apikey <secret>` (also accept Bearer / X-Api-Key)
    const authHeader = req.header('authorization') || '';
    const match = authHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
    const providedKey = (
      (match ? match[1] : '') ||
      req.header('x-api-key') ||
      ''
    ).trim();

    if (!providedKey || !safeCompare(providedKey, config.sepayWebhookSecret)) {
      console.warn('[SePay] Rejected webhook: invalid API key');
      res.status(401).json({ success: false, message: 'Invalid SePay API key' });
      return;
    }

    const body = req.body as {
      id?: number | string;
      code?: string | null;
      accountNumber?: string;
      subAccount?: string | null;
      transferType?: string;
      transferAmount?: number;
      content?: string;
      description?: string;
      referenceCode?: string;
    };

    console.log(
      `[SePay] Received webhook id=${body.id} type=${body.transferType} amount=${body.transferAmount} code=${body.code ?? ''} sub=${body.subAccount ?? ''} content="${body.content || ''}"`
    );

    if (body.transferType && body.transferType !== 'in') {
      res.json({ success: true, ignored: true, reason: 'Not an incoming transfer' });
      return;
    }

    // Check SePay's extracted `code` field first, then scan content/description.
    // Supports BOTH new daily format (NC.DDMM.00n / NC2211001 / NC 2211 001) and legacy NC1234.
    const text = `${body.code || ''} ${body.content || ''} ${body.description || ''}`;
    let orderCode: string | null = null;

    const dailyMatch = text.match(/(?<![A-Z])NC[.\s-]?(\d{2})(\d{2})[.\s-]?(\d{3,5})(?!\d)/i);
    if (dailyMatch) {
      orderCode = `NC.${dailyMatch[1]}${dailyMatch[2]}.${dailyMatch[3]}`;
    } else {
      const legacyMatch = text.match(/(?<![A-Z])NC(\d{4,6})(?!\d)/i);
      if (legacyMatch) {
        orderCode = `NC${legacyMatch[1]}`;
      }
    }

    if (!orderCode) {
      console.log(`[SePay] Ignored: no NC order code found in "${text}"`);
      res.json({ success: true, ignored: true, reason: 'No NC order code found' });
      return;
    }

    // Verify destination account / VA matches our configured receiving account (when provided)
    const expectedAcc = config.vietqr.accountNo.replace(/\s+/g, '').toUpperCase();
    const payloadAccounts = [body.subAccount, body.accountNumber]
      .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      .map((a) => a.replace(/\s+/g, '').toUpperCase());
    if (expectedAcc && payloadAccounts.length > 0 && !payloadAccounts.includes(expectedAcc)) {
      console.warn(
        `[SePay] Ignored ${orderCode}: destination account mismatch (${payloadAccounts.join(',')} != ${expectedAcc})`
      );
      res.json({ success: true, ignored: true, reason: 'Receiving account mismatch' });
      return;
    }

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

    // Prevent a single bank transaction from confirming two different orders
    const txRef = String(body.referenceCode || body.id || '').trim();
    if (txRef) {
      const existingOwner = await findOrderByTxRef(txRef);
      if (existingOwner && existingOwner !== orderCode) {
        console.warn(
          `[SePay] Blocked tx replay: txRef=${txRef} already applied to ${existingOwner}, refusing ${orderCode}`
        );
        res.json({ success: true, ignored: true, reason: 'Transaction already used' });
        return;
      }
    }
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
