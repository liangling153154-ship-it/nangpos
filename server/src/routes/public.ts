import { Router } from 'express';
import { z } from 'zod';
import {
  createOrder,
  getMenuResponse,
  getOrderByCode,
  HttpError,
} from '../services/orders.js';
import { getDb } from '../db/index.js';

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
    res.json({ ok: true, db: db.kind, time: new Date().toISOString() });
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
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstMsg = parsed.error.issues[0]?.message || 'Thông tin đặt hàng chưa hợp lệ.';
      res.status(400).json({ error: firstMsg, issues: parsed.error.issues });
      return;
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
    const code = (req.params.orderCode || '').trim().toUpperCase();
    if (!/^(NC\.\d{4}\.\d{3,5}|NC\d{4,9})$/.test(code)) {
      res.status(400).json({ error: 'Mã đơn hàng không hợp lệ.' });
      return;
    }
    const order = await getOrderByCode(code);
    if (!order) {
      res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
      return;
    }
    // Return customer-safe view (masks nothing needed for their own receipt lookup, excludes internal fields)
    res.json({
      orderCode: order.orderCode,
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
