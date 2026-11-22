import type {
  AgentPresence,
  MenuResponse,
  OrderDTO,
  OrderStatus,
  PaymentMethod,
  ShopPauseState,
} from '../../../shared/types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Lỗi máy chủ (${res.status})`);
  }
  return data as T;
}

export function fetchMenu(): Promise<MenuResponse> {
  return requestJson<MenuResponse>('/api/menu');
}

export interface PlaceOrderPayload {
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

export function placeOrder(
  payload: PlaceOrderPayload
): Promise<{ order: OrderDTO; message: string }> {
  return requestJson('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchCustomerOrder(
  orderCode: string,
  publicToken: string
): Promise<OrderDTO> {
  return requestJson(
    `/api/orders/${encodeURIComponent(orderCode)}?token=${encodeURIComponent(publicToken)}`
  );
}

// ---------- Admin APIs ----------

export function fetchAdminMe(): Promise<{ authenticated: boolean; username?: string }> {
  return requestJson('/api/admin/me');
}

export function adminLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; username: string }> {
  return requestJson('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function adminLogout(): Promise<{ ok: boolean }> {
  return requestJson('/api/admin/logout', { method: 'POST' });
}

export function fetchAdminOrders(status = 'all'): Promise<{ orders: OrderDTO[] }> {
  return requestJson(`/api/admin/orders?status=${encodeURIComponent(status)}`);
}

export function confirmAdminOrderPayment(
  id: number
): Promise<{ order: OrderDTO; alreadyPaid: boolean; printQueued: boolean }> {
  return requestJson(`/api/admin/orders/${id}/confirm-payment`, { method: 'POST' });
}

export function updateAdminOrderStatus(
  id: number,
  status: OrderStatus
): Promise<{ order: OrderDTO }> {
  return requestJson(`/api/admin/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function reprintAdminOrder(
  id: number
): Promise<{ ok: boolean; onlineAgents: number }> {
  return requestJson(`/api/admin/orders/${id}/reprint`, { method: 'POST' });
}

export function toggleMenuItemAvailability(
  id: number,
  isAvailable: boolean
): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/menu/${id}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable }),
  });
}

export function toggleToppingAvailability(
  id: number,
  isAvailable: boolean
): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/toppings/${id}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable }),
  });
}

export function updateShopPause(
  paused: boolean,
  message: string
): Promise<{ pause: ShopPauseState }> {
  return requestJson('/api/admin/settings/pause', {
    method: 'PUT',
    body: JSON.stringify({ paused, message }),
  });
}

export interface AdminSystemInfo {
  version: string;
  buildDate: string;
  agents: AgentPresence[];
  pendingPrintCount: number;
  vietqrConfigured: boolean;
  vietqrBankName: string;
  ntfyConfigured: boolean;
  sepayConfigured: boolean;
  sepayWebhookPath: string;
  printUnpaidTransfer: boolean;
}

export function fetchAdminSystem(): Promise<AdminSystemInfo> {
  return requestJson('/api/admin/system');
}

export function sendAdminTestPrint(): Promise<{ ok: boolean; onlineAgents: number }> {
  return requestJson('/api/admin/test-print', { method: 'POST' });
}

export function sendAdminTestNtfy(): Promise<{
  sent: boolean;
  skipped?: boolean;
  error?: string;
}> {
  return requestJson('/api/admin/test-ntfy', { method: 'POST' });
}
