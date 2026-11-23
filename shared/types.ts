export type DrinkType = 'iced_or_hot' | 'hot_only' | 'blended' | 'cold_only' | 'snack';

export interface CategoryDTO {
  id: number;
  slug: string;
  name: string;
  subtitle: string;
  sortOrder: number;
}

export interface MenuItemDTO {
  id: number;
  categoryId: number;
  categorySlug: string;
  slug: string;
  name: string;
  nameEn: string;
  description: string;
  price: number;
  imageUrl: string;
  imageFit: 'contain' | 'cover';
  isFeatured: boolean;
  badge: string;
  drinkType: DrinkType;
  variants: string[];
  allowSize: boolean;
  allowSugar: boolean;
  allowIce: boolean;
  allowToppings: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ToppingDTO {
  id: number;
  slug: string;
  name: string;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ShopPauseState {
  paused: boolean;
  message: string;
}

export interface StoreInfo {
  name: string;
  tagline: string;
  address: string;
  hours: string;
}

export interface MenuResponse {
  store: StoreInfo;
  pause: ShopPauseState;
  categories: CategoryDTO[];
  items: MenuItemDTO[];
  toppings: ToppingDTO[];
  sizeOptions: { id: 'M' | 'L'; label: string; extraPrice: number }[];
  sugarOptions: string[];
  iceOptionsByType: Record<DrinkType, string[]>;
}

export interface OrderItemTopping {
  slug: string;
  name: string;
  price: number;
}

export interface OrderItemSnapshot {
  menuItemId: number;
  name: string;
  basePrice: number;
  variant?: string;
  size?: 'M' | 'L';
  sizeLabel?: string;
  sizePrice: number;
  sugar?: string;
  ice?: string;
  toppings: OrderItemTopping[];
  note?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type PaymentMethod = 'cod' | 'bank_transfer';
export type PaymentStatus = 'unpaid' | 'paid' | 'cod';
export type OrderStatus =
  | 'awaiting_payment'
  | 'pending_shop'
  | 'accepted'
  | 'completed'
  | 'cancelled';
export type PrintStatus = 'not_queued' | 'pending' | 'printed';

export interface VietQRPaymentInfo {
  bankBin: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  amount: number;
  content: string;
  emvPayload: string;
  qrDataUrl: string;
}

export interface OrderDTO {
  id: number;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  note: string;
  items: OrderItemSnapshot[];
  subtotal: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: string | null;
  paymentTxRef: string | null;
  status: OrderStatus;
  printStatus: PrintStatus;
  printedAt: string | null;
  printCount: number;
  createdAt: string;
  updatedAt: string;
  publicToken?: string;
  vietqr?: VietQRPaymentInfo;
}

export interface PrintJobDTO {
  id: number;
  orderId: number | null;
  orderCode: string;
  jobType: 'initial' | 'reprint' | 'test';
  status: 'pending' | 'printed' | 'failed';
  idempotencyKey: string;
  attempts: number;
  payload: PrintTicketPayload;
  createdAt: string;
}

export interface ServerReceiptTemplates {
  html80?: string;
  html58?: string;
  text80?: string;
  text58?: string;
  printableMm80?: number;
  printableMm58?: number;
}

export interface ServerAlarmDirective {
  play: boolean;
  kind?: 'new_order' | 'transfer_alert';
  title?: string;
  body?: string;
  durationSeconds?: number;
}

export interface PrintTicketPayload {
  orderCode: string;
  createdAt: string;
  isReprint: boolean;
  isTest?: boolean;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  note: string;
  items: OrderItemSnapshot[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  rendered?: ServerReceiptTemplates;
  alarm?: ServerAlarmDirective;
}

export interface AgentPresence {
  id: string;
  hostname: string;
  printerMode: string;
  printerName: string;
  connectedAt: string;
  lastHeartbeatAt: string;
}
