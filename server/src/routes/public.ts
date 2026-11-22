import { Router } from 'express';
import { z } from 'zod';
import {
  createOrder,
  getMenuResponse,
  getOrderByCode,
  HttpError,
  verifyOrderPublicToken,
} from '../services/orders.js';
import { getDb } from '../db/index.js';
import { BoundedRateLimiter } from '../services/rate-limit.js';
import { APP_BUILD_DATE, APP_VERSION } from '../version.js';

// Anti-spam protection: max 6 orders / 10 minutes per IP + 15s cooldown per phone
const orderIpLimiter = new BoundedRateLimiter(6, 10 * 60 * 1000, 5000);
const orderPhoneCooldown = new BoundedRateLimiter(1, 15 * 1000, 5000);
const orderLookupLimiter = new BoundedRateLimiter(40, 5 * 60 * 1000, 5000);

function isRateLimitBypassed(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.DISABLE_RATE_LIMIT === 'true';
}

const orderItemSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(50),
  variant: z.string().max(60).optional(),
  size: z.enum(['M', 'L']).optional(),
  sugar: z.string().max(40).optional(),
  ice: z.string().max(40).optional(),
  toppingSlugs: z.array(z.string().max(60)).max(10).optional(),
  note: z.string().max(140).optional(),
});

const createOrderSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, 'Vui lòng nhập tên người nhận (tối thiểu 2 ký tự).')
    .max(80, 'Tên người nhận quá dài.'),
  customerPhone: z
    .string()
    .trim()
    .refine(
      (val) => {
        const digits = val.replace(/[\s.\-+()]/g, '');
        return /^(0\d{8,10}|84\d{8,10})$/.test(digits);
      },
      { message: 'Số điện thoại chưa đúng định dạng Việt Nam (ví dụ: 0912345678).' }
    ),
  customerAddress: z
    .string()
    .trim()
    .min(5, 'Vui lòng nhập địa chỉ giao hàng chi tiết hơn.')
    .max(250, 'Địa chỉ giao hàng quá dài.'),
  note: z.string().max(300).optional(),
  paymentMethod: z.enum(['cod', 'bank_transfer']),
  items: z
    .array(orderItemSchema)
    .min(1, 'Giỏ hàng đang trống. Vui lòng chọn ít nhất 1 món.')
    .max(50),
});

export const publicRouter = Router();

publicRouter.get('/health', async (_req, res) => {
  try {
    const db = getDb();
    await db.query('SELECT 1');
    res.json({
      ok: true,
      version: APP_VERSION,
      buildDate: APP_BUILD_DATE,
      db: db.kind,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

publicRouter.get('/menu', async (_req, res, next) => {
  try {
    const menu = await getMenuResponse();
    res.json(menu);
  } catch (err) {
    next(err);
  }
});

publicRouter.post('/orders', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!isRateLimitBypassed()) {
      const ipGate = orderIpLimiter.check(ip);
      if (!ipGate.allowed) {
        res.status(429).json({
          error: `Bạn đặt đơn quá nhanh. Vui lòng thử lại sau ${ipGate.retryAfterSec} giây.`,
        });
        return;
      }
    }

    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstMsg = parsed.error.issues[0]?.message || 'Thông tin đặt hàng chưa hợp lệ.';
      res.status(400).json({ error: firstMsg, issues: parsed.error.issues });
      return;
    }

    if (!isRateLimitBypassed()) {
      const normPhone = parsed.data.customerPhone.replace(/\D/g, '');
      const phoneGate = orderPhoneCooldown.consume(normPhone);
      if (!phoneGate.allowed) {
        res.status(429).json({
          error: `Đơn hàng vừa được gửi. Vui lòng chờ ${phoneGate.retryAfterSec} giây trước khi đặt thêm.`,
        });
        return;
      }
      orderIpLimiter.consume(ip);
    }

    const { order } = await createOrder(parsed.data);
    res.status(201).json({
      order,
      message: 'Quán sẽ gọi lại xác nhận',
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

publicRouter.get('/orders/:orderCode', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!isRateLimitBypassed()) {
      const gate = orderLookupLimiter.consume(ip);
      if (!gate.allowed) {
        res.status(429).json({ error: 'Quá nhiều yêu cầu tra cứu đơn. Vui lòng thử lại sau.' });
        return;
      }
    }

    const code = (req.params.orderCode || '').trim().toUpperCase();
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!/^(NC\.\d{4}\.\d{3,5}|NC\d{4,9})$/.test(code) || !token) {
      res.status(404).json({ error: 'Không tìm thấy đơn hàng hoặc đường dẫn không hợp lệ.' });
      return;
    }

    const validToken = await verifyOrderPublicToken(code, token);
    if (!validToken) {
      res.status(404).json({ error: 'Không tìm thấy đơn hàng hoặc đường dẫn không hợp lệ.' });
      return;
    }

    const order = await getOrderByCode(code);
    if (!order) {
      res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
      return;
    }
    // Return customer-safe view (excludes customer PII and internal fields)
    res.json({
      orderCode: order.orderCode,
      publicToken: order.publicToken,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentConfirmedAt: order.paymentConfirmedAt,
      items: order.items,
      totalAmount: order.totalAmount,
      note: order.note,
      createdAt: order.createdAt,
      vietqr: order.vietqr,
    });
  } catch (err) {
    next(err);
  }
});
