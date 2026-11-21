import type { OrderStatus } from '../../../shared/types';

export function formatVnd(amount: number): string {
  return Math.round(amount).toLocaleString('vi-VN') + 'đ';
}

export function formatVnTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('vi-VN');
  }
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 45) return 'vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} giờ trước`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} ngày trước`;
}

export function normalizeSearch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'awaiting_payment':
      return 'Chờ xác nhận tiền';
    case 'pending_shop':
      return 'Chờ quán nhận';
    case 'accepted':
      return 'Quán đã nhận';
    case 'completed':
      return 'Hoàn tất';
    case 'cancelled':
      return 'Đã hủy';
  }
}
