import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  ADMIN_COOKIE_NAME,
  checkLoginRateLimit,
  clearFailedLogins,
  createSessionToken,
  recordFailedLogin,
  requireAdmin,
  verifyAdminCredentials,
  verifySessionToken,
} from '../services/auth.js';
import {
  confirmOrderPayment,
  getMenuResponse,
  getPendingPrintJobs,
  HttpError,
  listOrders,
  queueReprint,
  queueTestPrint,
  setMenuItemAvailability,
  setShopPauseState,
  setToppingAvailability,
  updateOrderStatus,
} from '../services/orders.js';
import { sendNtfyNotification } from '../services/ntfy.js';
import { realtimeHub } from '../services/ws.js';

export const adminRouter = Router();

adminRouter.post('/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rate = checkLoginRateLimit(ip);
  if (!rate.allowed) {
    res.status(429).json({
      error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${rate.retryAfterSec} giây.`,
    });
    return;
  }

  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' });
    return;
  }

  if (!verifyAdminCredentials(parsed.data.username, parsed.data.password)) {
    recordFailedLogin(ip);
    res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    return;
  }

  clearFailedLogins(ip);
  const token = createSessionToken(parsed.data.username.trim());
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({ ok: true, username: parsed.data.username.trim() });
});

adminRouter.post('/logout', (_req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

adminRouter.get('/me', (req, res) => {
  const token = req.cookies?.[ADMIN_COOKIE_NAME] as string | undefined;
  const session = verifySessionToken(token);
  if (!session) {
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: session.username });
});

// All routes below require admin authentication
adminRouter.use(requireAdmin);

adminRouter.get('/orders', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const limit = Number(req.query.limit || 80);
    const orders = await listOrders({ status, limit });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/orders/:id/confirm-payment', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID đơn hàng không hợp lệ.' });
      return;
    }
    const result = await confirmOrderPayment(id, { source: 'manual' });
    res.json({
      order: result.order,
      alreadyPaid: result.alreadyPaid,
      printQueued: Boolean(result.printJob),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

adminRouter.patch('/orders/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      status: z.enum(['awaiting_payment', 'pending_shop', 'accepted', 'completed', 'cancelled']),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
      return;
    }
    const order = await updateOrderStatus(id, parsed.data.status);
    res.json({ order });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

adminRouter.post('/orders/:id/reprint', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID đơn hàng không hợp lệ.' });
      return;
    }
    const job = await queueReprint(id);
    res.json({
      ok: true,
      job,
      onlineAgents: realtimeHub.getOnlineAgents().length,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

adminRouter.get('/menu', async (_req, res, next) => {
  try {
    const menu = await getMenuResponse();
    res.json(menu);
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/menu/:id/availability', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({ isAvailable: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      return;
    }
    await setMenuItemAvailability(id, parsed.data.isAvailable);
    res.json({ ok: true, id, isAvailable: parsed.data.isAvailable });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

adminRouter.patch('/toppings/:id/availability', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({ isAvailable: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      return;
    }
    await setToppingAvailability(id, parsed.data.isAvailable);
    res.json({ ok: true, id, isAvailable: parsed.data.isAvailable });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

adminRouter.put('/settings/pause', async (req, res, next) => {
  try {
    const schema = z.object({
      paused: z.boolean(),
      message: z.string().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      return;
    }
    const pause = await setShopPauseState({
      paused: parsed.data.paused,
      message: parsed.data.message || '',
    });
    res.json({ pause });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/system', async (_req, res, next) => {
  try {
    const pendingJobs = await getPendingPrintJobs();
    res.json({
      agents: realtimeHub.getOnlineAgents(),
      pendingPrintCount: pendingJobs.length,
      vietqrConfigured: Boolean(config.vietqr.accountNo),
      vietqrBankName: config.vietqr.bankName,
      ntfyConfigured: Boolean(config.ntfy.topic),
      sepayConfigured: Boolean(config.sepayWebhookSecret),
      sepayWebhookPath: '/api/webhooks/sepay',
      printUnpaidTransfer: config.printUnpaidTransfer,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/test-print', async (_req, res, next) => {
  try {
    const job = await queueTestPrint();
    res.json({
      ok: true,
      job,
      onlineAgents: realtimeHub.getOnlineAgents().length,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/test-ntfy', async (_req, res, next) => {
  try {
    const result = await sendNtfyNotification({
      title: 'Kiểm tra thông báo — Nâng Café',
      message:
        'Kết nối thông báo ntfy hoạt động tốt! Khi có đơn ship mới, thông báo sẽ hiện ngay tại đây.',
      priority: 3,
      tags: ['coffee', 'white_check_mark'],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
