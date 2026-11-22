import crypto from 'node:crypto';
import { getDb, type DbClient } from '../db/index.js';
import { config } from '../config.js';
import { generateOrderVietQr } from './vietqr.js';
import { notifyNewOrder, notifyPaymentConfirmed } from './ntfy.js';
import { realtimeHub } from './ws.js';
import type {
  DrinkType,
  MenuItemDTO,
  MenuResponse,
  OrderDTO,
  OrderItemSnapshot,
  OrderStatus,
  PaymentMethod,
  PrintJobDTO,
  PrintTicketPayload,
  ShopPauseState,
  StoreInfo,
} from '../../../shared/types.js';

export const SIZE_OPTIONS: { id: 'M' | 'L'; label: string; extraPrice: number }[] = [
  { id: 'M', label: 'Tiêu chuẩn (M)', extraPrice: 0 },
  { id: 'L', label: 'Lớn (L)', extraPrice: 10000 },
];

export const SUGAR_OPTIONS = [
  '100% đường',
  '70% đường',
  '50% đường',
  '30% đường',
  'Không đường',
];

export const ICE_OPTIONS_BY_TYPE: Record<DrinkType, string[]> = {
  iced_or_hot: ['Đá bình thường', 'Ít đá', 'Không đá', 'Nóng (cùng giá)'],
  cold_only: ['Đá bình thường', 'Ít đá', 'Không đá'],
  hot_only: ['Nóng'],
  blended: ['Đá xay tiêu chuẩn'],
  snack: [],
};

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  note?: string;
  paymentMethod: PaymentMethod;
  items: {
    menuItemId: number;
    quantity: number;
    variant?: string;
    size?: 'M' | 'L';
    sugar?: string;
    ice?: string;
    toppingSlugs?: string[];
    note?: string;
  }[];
}

function mapOrderRow(row: any): OrderDTO {
  return {
    id: Number(row.id),
    orderCode: row.order_code,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerAddress: row.customer_address,
    note: row.note || '',
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    subtotal: Number(row.subtotal),
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentConfirmedAt: row.payment_confirmed_at
      ? new Date(row.payment_confirmed_at).toISOString()
      : null,
    paymentConfirmedBy: row.payment_confirmed_by || null,
    paymentTxRef: row.payment_tx_ref || null,
    status: row.status,
    printStatus: row.print_status,
    printedAt: row.printed_at ? new Date(row.printed_at).toISOString() : null,
    printCount: Number(row.print_count || 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapPrintJobRow(row: any): PrintJobDTO {
  return {
    id: Number(row.id),
    orderId: row.order_id !== null ? Number(row.order_id) : null,
    orderCode: row.order_code,
    jobType: row.job_type,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attempts: Number(row.attempts || 0),
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function buildTicketPayload(order: OrderDTO, isReprint: boolean): PrintTicketPayload {
  return {
    orderCode: order.orderCode,
    createdAt: order.createdAt,
    isReprint,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    note: order.note,
    items: order.items,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  };
}

function getVnDayMonth(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(new Date());
  const dd = parts.find((p) => p.type === 'day')?.value || '01';
  const mm = parts.find((p) => p.type === 'month')?.value || '01';
  return `${dd}${mm}`;
}

async function generateUniqueOrderCode(tx: DbClient): Promise<string> {
  // Format: NC.DDMM.00n (n = daily sequential ticket number in Vietnam timezone, e.g. NC.2211.001)
  const ddmm = getVnDayMonth();
  const prefix = `NC.${ddmm}.`;
  const latest = await tx.query<{ order_code: string }>(
    `SELECT order_code FROM orders
     WHERE order_code LIKE $1
     ORDER BY id DESC
     LIMIT 1`,
    [`${prefix}%`]
  );

  let nextSeq = 1;
  if (latest.rows.length > 0) {
    const tail = latest.rows[0].order_code.slice(prefix.length);
    const parsed = Number.parseInt(tail, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      nextSeq = parsed + 1;
    }
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const seqStr = String(nextSeq + attempt).padStart(3, '0');
    const code = `${prefix}${seqStr}`;
    const existing = await tx.query('SELECT 1 FROM orders WHERE order_code = $1', [code]);
    if (existing.rows.length === 0) return code;
  }

  // Fallback with timestamp tail if extreme burst occurs
  return `${prefix}${String(Date.now() % 10000).padStart(4, '0')}`;
}

export async function getShopPauseState(): Promise<ShopPauseState> {
  const db = getDb();
  const res = await db.query<{ value: ShopPauseState }>(
    `SELECT value FROM shop_settings WHERE key = 'pause'`
  );
  if (res.rows.length === 0) return { paused: false, message: '' };
  const val = res.rows[0].value;
  return typeof val === 'string' ? JSON.parse(val) : val;
}

export async function setShopPauseState(pause: ShopPauseState): Promise<ShopPauseState> {
  const db = getDb();
  const clean: ShopPauseState = {
    paused: Boolean(pause.paused),
    message: (pause.message || '').trim().slice(0, 200),
  };
  await db.query(
    `INSERT INTO shop_settings (key, value, updated_at)
     VALUES ('pause', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(clean)]
  );
  realtimeHub.notifyPauseUpdated(clean);
  return clean;
}

export async function getMenuResponse(): Promise<MenuResponse> {
  const db = getDb();
  const [catsRes, itemsRes, toppingsRes, pauseState, storeRes] = await Promise.all([
    db.query(`SELECT id, slug, name, subtitle, sort_order FROM categories ORDER BY sort_order ASC, id ASC`),
    db.query(
      `SELECT m.*, c.slug AS category_slug
       FROM menu_items m
       JOIN categories c ON c.id = m.category_id
       ORDER BY m.sort_order ASC, m.id ASC`
    ),
    db.query(`SELECT id, slug, name, price, is_available, sort_order FROM toppings ORDER BY sort_order ASC`),
    getShopPauseState(),
    db.query<{ value: StoreInfo }>(`SELECT value FROM shop_settings WHERE key = 'store_info'`),
  ]);

  const store: StoreInfo =
    storeRes.rows.length > 0
      ? typeof storeRes.rows[0].value === 'string'
        ? JSON.parse(storeRes.rows[0].value)
        : storeRes.rows[0].value
      : {
          name: 'Nâng Café',
          tagline: 'Trong tiếng Tày – Nùng, Nâng là số một.',
          address: '075 tổ 10, P. Sông Hiến, Thục Phán, Cao Bằng',
          hours: '7:00 — 22:00',
        };

  return {
    store,
    pause: pauseState,
    categories: catsRes.rows.map((r) => ({
      id: Number(r.id),
      slug: r.slug,
      name: r.name,
      subtitle: r.subtitle || '',
      sortOrder: Number(r.sort_order),
    })),
    items: itemsRes.rows.map((r): MenuItemDTO => ({
      id: Number(r.id),
      categoryId: Number(r.category_id),
      categorySlug: r.category_slug,
      slug: r.slug,
      name: r.name,
      nameEn: r.name_en || '',
      description: r.description || '',
      price: Number(r.price),
      imageUrl: r.image_url,
      imageFit: r.image_fit === 'cover' ? 'cover' : 'contain',
      isFeatured: Boolean(r.is_featured),
      badge: r.badge || '',
      drinkType: r.drink_type as DrinkType,
      variants: typeof r.variants === 'string' ? JSON.parse(r.variants) : r.variants || [],
      allowSize: Boolean(r.allow_size),
      allowSugar: Boolean(r.allow_sugar),
      allowIce: Boolean(r.allow_ice),
      allowToppings: Boolean(r.allow_toppings),
      isAvailable: Boolean(r.is_available),
      sortOrder: Number(r.sort_order),
    })),
    toppings: toppingsRes.rows.map((r) => ({
      id: Number(r.id),
      slug: r.slug,
      name: r.name,
      price: Number(r.price),
      isAvailable: Boolean(r.is_available),
      sortOrder: Number(r.sort_order),
    })),
    sizeOptions: SIZE_OPTIONS,
    sugarOptions: SUGAR_OPTIONS,
    iceOptionsByType: ICE_OPTIONS_BY_TYPE,
  };
}

export async function createOrder(input: CreateOrderInput): Promise<{
  order: OrderDTO;
  printJob: PrintJobDTO | null;
}> {
  const db = getDb();

  // Check if shop is paused
  const pause = await getShopPauseState();
  if (pause.paused) {
    throw new HttpError(
      503,
      pause.message || 'Quán hiện đang tạm nghỉ nhận đơn ship. Mong bạn quay lại sau!'
    );
  }

  const { order, printJob } = await db.transaction(async (tx) => {
    // Load referenced menu items & toppings from DB to compute trusted totals
    const itemIds = [...new Set(input.items.map((i) => i.menuItemId))];
    const menuRes = await tx.query(
      `SELECT id, name, price, drink_type, variants, allow_size, allow_sugar, allow_ice, allow_toppings, is_available
       FROM menu_items WHERE id = ANY($1::int[])`,
      [itemIds]
    );
    const menuMap = new Map(menuRes.rows.map((r) => [Number(r.id), r]));

    const toppingsRes = await tx.query(
      `SELECT slug, name, price, is_available FROM toppings`
    );
    const toppingMap = new Map(toppingsRes.rows.map((r) => [r.slug as string, r]));

    const snapshots: OrderItemSnapshot[] = [];
    let subtotal = 0;

    for (const line of input.items) {
      const dbItem = menuMap.get(line.menuItemId);
      if (!dbItem) {
        throw new HttpError(400, 'Có món không tồn tại trong thực đơn.');
      }
      if (!dbItem.is_available) {
        throw new HttpError(409, `Món "${dbItem.name}" hiện đã hết hàng. Vui lòng cập nhật lại giỏ.`);
      }

      const qty = Math.max(1, Math.min(50, Math.round(line.quantity)));
      const basePrice = Number(dbItem.price);

      const allowedVariants: string[] =
        typeof dbItem.variants === 'string'
          ? JSON.parse(dbItem.variants)
          : dbItem.variants || [];
      const variant =
        allowedVariants.length > 0
          ? allowedVariants.includes(line.variant || '')
            ? line.variant
            : allowedVariants[0]
          : undefined;

      let size: 'M' | 'L' | undefined;
      let sizeLabel: string | undefined;
      let sizePrice = 0;
      if (dbItem.allow_size) {
        const chosen = SIZE_OPTIONS.find((s) => s.id === line.size) || SIZE_OPTIONS[0];
        size = chosen.id;
        sizeLabel = chosen.label;
        sizePrice = chosen.extraPrice;
      }

      const sugar = dbItem.allow_sugar
        ? SUGAR_OPTIONS.includes(line.sugar || '')
          ? line.sugar
          : SUGAR_OPTIONS[0]
        : undefined;

      const drinkType = dbItem.drink_type as DrinkType;
      const validIce = ICE_OPTIONS_BY_TYPE[drinkType] || [];
      const ice =
        dbItem.allow_ice && validIce.length > 0
          ? validIce.includes(line.ice || '')
            ? line.ice
            : validIce[0]
          : drinkType === 'hot_only'
            ? 'Nóng'
            : undefined;

      const chosenToppings: { slug: string; name: string; price: number }[] = [];
      let toppingsTotal = 0;
      if (dbItem.allow_toppings && Array.isArray(line.toppingSlugs)) {
        const seen = new Set<string>();
        for (const slug of line.toppingSlugs) {
          if (seen.has(slug)) continue;
          seen.add(slug);
          const t = toppingMap.get(slug);
          if (t && t.is_available) {
            const tp = Number(t.price);
            chosenToppings.push({ slug: t.slug, name: t.name, price: tp });
            toppingsTotal += tp;
          }
        }
      }

      const unitPrice = basePrice + sizePrice + toppingsTotal;
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      snapshots.push({
        menuItemId: Number(dbItem.id),
        name: dbItem.name,
        basePrice,
        variant,
        size,
        sizeLabel,
        sizePrice,
        sugar,
        ice,
        toppings: chosenToppings,
        note: (line.note || '').trim().slice(0, 140) || undefined,
        quantity: qty,
        unitPrice,
        lineTotal,
      });
    }

    const orderCode = await generateUniqueOrderCode(tx);
    const isCod = input.paymentMethod === 'cod';
    const initialStatus: OrderStatus = isCod ? 'pending_shop' : 'awaiting_payment';
    const paymentStatus = isCod ? 'cod' : 'unpaid';
    const shouldPrintNow = isCod || config.printUnpaidTransfer;

    const orderRes = await tx.query(
      `INSERT INTO orders (
         order_code, customer_name, customer_phone, customer_address, note,
         items, subtotal, total_amount, payment_method, payment_status,
         status, print_status
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        orderCode,
        input.customerName.trim(),
        input.customerPhone.trim(),
        input.customerAddress.trim(),
        (input.note || '').trim().slice(0, 300),
        JSON.stringify(snapshots),
        subtotal,
        subtotal,
        input.paymentMethod,
        paymentStatus,
        initialStatus,
        shouldPrintNow ? 'pending' : 'not_queued',
      ]
    );

    const createdOrder = mapOrderRow(orderRes.rows[0]);
    let createdJob: PrintJobDTO | null = null;

    if (shouldPrintNow) {
      const payload = buildTicketPayload(createdOrder, false);
      const jobRes = await tx.query(
        `INSERT INTO print_jobs (order_id, order_code, job_type, status, payload, idempotency_key)
         VALUES ($1, $2, 'initial', 'pending', $3::jsonb, $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [createdOrder.id, createdOrder.orderCode, JSON.stringify(payload), `initial:${createdOrder.orderCode}`]
      );
      if (jobRes.rows.length > 0) {
        createdJob = mapPrintJobRow(jobRes.rows[0]);
      }
    }

    return { order: createdOrder, printJob: createdJob };
  });

  if (order.paymentMethod === 'bank_transfer') {
    order.vietqr = await generateOrderVietQr(order.orderCode, order.totalAmount);
  }

  // Push real-time notifications (WebSocket + ntfy)
  realtimeHub.notifyOrderCreated(order);
  if (printJob) {
    realtimeHub.pushPrintJobToAgents(printJob);
  }
  // Fire ntfy asynchronously so a slow upstream never blocks the customer's checkout
  notifyNewOrder(order).catch((err) => console.error('[ntfy] notifyNewOrder error:', err));

  return { order, printJob };
}

export async function getOrderByCode(orderCode: string): Promise<OrderDTO | null> {
  const db = getDb();
  const res = await db.query(`SELECT * FROM orders WHERE order_code = $1`, [
    orderCode.toUpperCase(),
  ]);
  if (res.rows.length === 0) return null;
  const order = mapOrderRow(res.rows[0]);
  if (order.paymentMethod === 'bank_transfer') {
    order.vietqr = await generateOrderVietQr(order.orderCode, order.totalAmount);
  }
  return order;
}

export async function listOrders(filter?: {
  status?: string;
  limit?: number;
}): Promise<OrderDTO[]> {
  const db = getDb();
  const limit = Math.min(200, Math.max(1, filter?.limit || 80));
  if (filter?.status && filter.status !== 'all') {
    const res = await db.query(
      `SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [filter.status, limit]
    );
    return res.rows.map(mapOrderRow);
  }
  const res = await db.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`, [
    limit,
  ]);
  return res.rows.map(mapOrderRow);
}

/**
 * Confirms bank transfer payment (used by BOTH manual admin click AND future SePay webhook).
 * Idempotent: calling it twice never creates duplicate print jobs.
 */
export async function confirmOrderPayment(
  orderIdOrCode: number | string,
  opts: { source: 'manual' | 'sepay'; txRef?: string }
): Promise<{ order: OrderDTO; printJob: PrintJobDTO | null; alreadyPaid: boolean }> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const lookupRes =
      typeof orderIdOrCode === 'number'
        ? await tx.query(`SELECT * FROM orders WHERE id = $1`, [orderIdOrCode])
        : await tx.query(`SELECT * FROM orders WHERE order_code = $1`, [
            orderIdOrCode.toUpperCase(),
          ]);

    if (lookupRes.rows.length === 0) {
      throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    }

    const existing = mapOrderRow(lookupRes.rows[0]);
    if (existing.paymentStatus === 'paid') {
      return { order: existing, printJob: null, alreadyPaid: true };
    }
    if (existing.status === 'cancelled') {
      throw new HttpError(409, 'Đơn hàng này đã bị hủy.');
    }

    const nextStatus: OrderStatus =
      existing.status === 'awaiting_payment' ? 'pending_shop' : existing.status;
    const nextPrintStatus =
      existing.printStatus === 'printed' ? 'printed' : 'pending';

    const updatedRes = await tx.query(
      `UPDATE orders
       SET payment_status = 'paid',
           payment_confirmed_at = NOW(),
           payment_confirmed_by = $2,
           payment_tx_ref = COALESCE($3, payment_tx_ref),
           status = $4,
           print_status = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [existing.id, opts.source, opts.txRef || null, nextStatus, nextPrintStatus]
    );

    const updatedOrder = mapOrderRow(updatedRes.rows[0]);
    let job: PrintJobDTO | null = null;

    // Queue initial print job if not yet printed (idempotent via unique idempotency_key)
    if (existing.printStatus !== 'printed') {
      const payload = buildTicketPayload(updatedOrder, false);
      const jobRes = await tx.query(
        `INSERT INTO print_jobs (order_id, order_code, job_type, status, payload, idempotency_key)
         VALUES ($1, $2, 'initial', 'pending', $3::jsonb, $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          updatedOrder.id,
          updatedOrder.orderCode,
          JSON.stringify(payload),
          `initial:${updatedOrder.orderCode}`,
        ]
      );
      if (jobRes.rows.length > 0) {
        job = mapPrintJobRow(jobRes.rows[0]);
      }
    }

    return { order: updatedOrder, printJob: job, alreadyPaid: false };
  });

  if (!result.alreadyPaid) {
    realtimeHub.notifyOrderUpdated(result.order);
    if (result.printJob) {
      realtimeHub.pushPrintJobToAgents(result.printJob);
    }
    if (opts.source === 'sepay') {
      notifyPaymentConfirmed(result.order, 'sepay').catch((err) =>
        console.error('[ntfy] notifyPaymentConfirmed error:', err)
      );
    }
  }

  return result;
}

export async function updateOrderStatus(
  orderId: number,
  status: OrderStatus
): Promise<OrderDTO> {
  const db = getDb();
  const res = await db.query(
    `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [orderId, status]
  );
  if (res.rows.length === 0) {
    throw new HttpError(404, 'Không tìm thấy đơn hàng.');
  }
  const order = mapOrderRow(res.rows[0]);
  realtimeHub.notifyOrderUpdated(order);
  return order;
}

export async function queueReprint(orderId: number): Promise<PrintJobDTO> {
  const db = getDb();
  const res = await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (res.rows.length === 0) {
    throw new HttpError(404, 'Không tìm thấy đơn hàng.');
  }
  const order = mapOrderRow(res.rows[0]);
  const payload = buildTicketPayload(order, true);
  const idempotencyKey = `reprint:${order.orderCode}:${crypto.randomUUID()}`;

  const jobRes = await db.query(
    `INSERT INTO print_jobs (order_id, order_code, job_type, status, payload, idempotency_key)
     VALUES ($1, $2, 'reprint', 'pending', $3::jsonb, $4)
     RETURNING *`,
    [order.id, order.orderCode, JSON.stringify(payload), idempotencyKey]
  );
  const job = mapPrintJobRow(jobRes.rows[0]);
  realtimeHub.pushPrintJobToAgents(job);
  return job;
}

export async function queueTestPrint(): Promise<PrintJobDTO> {
  const db = getDb();
  const orderCode = `NC.${getVnDayMonth()}.000`;
  const payload: PrintTicketPayload = {
    orderCode,
    createdAt: new Date().toISOString(),
    isReprint: false,
    isTest: true,
    customerName: 'Phiếu in thử — Nâng Café',
    customerPhone: '0900 000 000',
    customerAddress: '075 tổ 10, P. Sông Hiến, Cao Bằng',
    note: 'Kiểm tra kết nối máy in nhiệt & loa thông báo',
    items: [
      {
        menuItemId: 1,
        name: 'Cà phê hạt dẻ',
        basePrice: 55000,
        size: 'M',
        sizeLabel: 'Tiêu chuẩn (M)',
        sizePrice: 0,
        ice: 'Đá bình thường',
        sugar: '70% đường',
        toppings: [{ slug: 'thach-den', name: 'Thạch đen Cao Bằng', price: 8000 }],
        quantity: 1,
        unitPrice: 63000,
        lineTotal: 63000,
      },
    ],
    totalAmount: 63000,
    paymentMethod: 'cod',
    paymentStatus: 'cod',
  };

  const jobRes = await db.query(
    `INSERT INTO print_jobs (order_id, order_code, job_type, status, payload, idempotency_key)
     VALUES (NULL, $1, 'test', 'pending', $2::jsonb, $3)
     RETURNING *`,
    [orderCode, JSON.stringify(payload), `test:${crypto.randomUUID()}`]
  );
  const job = mapPrintJobRow(jobRes.rows[0]);
  realtimeHub.pushPrintJobToAgents(job);
  return job;
}

export async function getPendingPrintJobs(): Promise<PrintJobDTO[]> {
  const db = getDb();
  const res = await db.query(
    `SELECT * FROM print_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`
  );
  return res.rows.map(mapPrintJobRow);
}

export async function ackPrintJob(
  jobId: number,
  agentHostname: string
): Promise<{ job: PrintJobDTO; order: OrderDTO | null }> {
  const db = getDb();

  const out = await db.transaction(async (tx) => {
    const jobRes = await tx.query(
      `UPDATE print_jobs
       SET status = 'printed',
           printed_at = COALESCE(printed_at, NOW()),
           printed_by = COALESCE(printed_by, $2),
           attempts = attempts + 1
       WHERE id = $1
       RETURNING *`,
      [jobId, agentHostname]
    );
    if (jobRes.rows.length === 0) {
      throw new HttpError(404, 'Không tìm thấy lệnh in.');
    }
    const job = mapPrintJobRow(jobRes.rows[0]);
    let updatedOrder: OrderDTO | null = null;

    if (job.orderId) {
      // Auto-accept COD / paid orders upon printing (Requirement #12: Đơn tự động nhận, không cần bấm)
      const orderRes = await tx.query(
        `UPDATE orders
         SET print_status = 'printed',
             printed_at = COALESCE(printed_at, NOW()),
             print_count = print_count + 1,
             status = CASE WHEN status = 'pending_shop' THEN 'accepted' ELSE status END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [job.orderId]
      );
      if (orderRes.rows.length > 0) {
        updatedOrder = mapOrderRow(orderRes.rows[0]);
      }
    }

    return { job, order: updatedOrder };
  });

  if (out.order) {
    realtimeHub.notifyOrderUpdated(out.order);
  }
  return out;
}

export async function recordPrintJobFailure(jobId: number, errorMessage: string): Promise<void> {
  const db = getDb();
  await db.query(
    `UPDATE print_jobs
     SET attempts = attempts + 1,
         last_error = $2
     WHERE id = $1 AND status = 'pending'`,
    [jobId, errorMessage.slice(0, 500)]
  );
}

export async function setMenuItemAvailability(
  itemId: number,
  isAvailable: boolean
): Promise<void> {
  const db = getDb();
  const res = await db.query(
    `UPDATE menu_items SET is_available = $2 WHERE id = $1 RETURNING id`,
    [itemId, isAvailable]
  );
  if (res.rows.length === 0) {
    throw new HttpError(404, 'Không tìm thấy món.');
  }
  realtimeHub.notifyMenuUpdated();
}

export async function setToppingAvailability(
  toppingId: number,
  isAvailable: boolean
): Promise<void> {
  const db = getDb();
  const res = await db.query(
    `UPDATE toppings SET is_available = $2 WHERE id = $1 RETURNING id`,
    [toppingId, isAvailable]
  );
  if (res.rows.length === 0) {
    throw new HttpError(404, 'Không tìm thấy topping.');
  }
  realtimeHub.notifyMenuUpdated();
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}
