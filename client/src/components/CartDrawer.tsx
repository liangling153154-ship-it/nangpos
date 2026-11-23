import { useEffect, useState, type FormEvent } from 'react';
import type { OrderDTO, ShopPauseState } from '../../../shared/types';
import { placeOrder } from '../lib/api';
import { formatVnd } from '../lib/format';
import type { CartEntry } from './DrinkSheet';
import { CheckIcon, CloseIcon, MinusIcon, PlusIcon } from './Icons';

const CUSTOMER_INFO_KEY = 'nang_customer_profile_v1';

interface SavedProfile {
  name: string;
  phone: string;
  address: string;
}

function loadProfile(): SavedProfile {
  try {
    const raw = localStorage.getItem(CUSTOMER_INFO_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SavedProfile>;
      return {
        name: p.name || '',
        phone: p.phone || '',
        address: p.address || '',
      };
    }
  } catch {
    // ignore
  }
  return { name: '', phone: '', address: '' };
}

interface CartDrawerProps {
  cart: CartEntry[];
  pause: ShopPauseState;
  onUpdateQty: (uid: string, delta: number) => void;
  onUpdateNote: (uid: string, note: string) => void;
  onRemove: (uid: string) => void;
  onClose: () => void;
  onOrderPlaced: (order: OrderDTO) => void;
}

export function CartDrawer({
  cart,
  pause,
  onUpdateQty,
  onUpdateNote,
  onRemove,
  onClose,
  onOrderPlaced,
}: CartDrawerProps) {
  const initial = loadProfile();
  const [customerName, setCustomerName] = useState(initial.name);
  const [customerPhone, setCustomerPhone] = useState(initial.phone);
  const [customerAddress, setCustomerAddress] = useState(initial.address);
  const [orderNote, setOrderNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const subtotal = cart.reduce((sum, entry) => sum + entry.unitPrice * entry.quantity, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (cart.length === 0 || submitting || pause.paused) return;

    const cleanName = customerName.trim();
    const cleanPhone = customerPhone.trim();
    const cleanAddr = customerAddress.trim();

    if (cleanName.length < 2) {
      setError('Vui lòng nhập tên người nhận.');
      return;
    }
    const digits = cleanPhone.replace(/[\s.\-+()]/g, '');
    if (!/^(0\d{8,10}|84\d{8,10})$/.test(digits)) {
      setError('Số điện thoại chưa đúng định dạng (ví dụ: 0912345678).');
      return;
    }
    if (cleanAddr.length < 5) {
      setError('Vui lòng nhập địa chỉ giao hàng cụ thể hơn.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      try {
        localStorage.setItem(
          CUSTOMER_INFO_KEY,
          JSON.stringify({ name: cleanName, phone: cleanPhone, address: cleanAddr })
        );
      } catch {
        // ignore storage quota
      }

      const res = await placeOrder({
        customerName: cleanName,
        customerPhone: cleanPhone,
        customerAddress: cleanAddr,
        note: orderNote.trim(),
        paymentMethod: 'bank_transfer',
        items: cart.map((entry) => ({
          menuItemId: entry.item.id,
          quantity: entry.quantity,
          variant: entry.variant,
          size: entry.size,
          sugar: entry.sugar,
          ice: entry.ice,
          toppingSlugs: entry.toppings.map((t) => t.slug),
          note: entry.note.trim() || undefined,
        })),
      });

      onOrderPlaced(res.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đặt hàng lúc này. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="sheet-panel" onSubmit={handleSubmit} noValidate>
        <div className="sheet-header">
          <h2 className="sheet-title" id="cart-title">
            Giỏ hàng & Đặt ship
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          {pause.paused && (
            <div className="form-error">
              {pause.message || 'Quán hiện đang tạm nghỉ nhận đơn ship. Mong bạn quay lại sau!'}
            </div>
          )}

          {cart.length === 0 ? (
            <div className="empty-state">
              <p>Giỏ hàng đang trống. Hãy chọn đồ uống bạn thích nhé.</p>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Quay lại xem thực đơn
              </button>
            </div>
          ) : (
            <>
              {/* Cart items list */}
              <div>
                {cart.map((entry) => {
                  const optList: string[] = [];
                  if (entry.variant) optList.push(entry.variant);
                  if (entry.sizeLabel) optList.push(entry.sizeLabel);
                  if (entry.ice) optList.push(entry.ice);
                  if (entry.sugar) optList.push(entry.sugar);
                  if (entry.toppings.length > 0) {
                    optList.push('+' + entry.toppings.map((t) => t.name).join(', '));
                  }

                  return (
                    <div key={entry.uid} className="cart-item">
                      <div className="cart-item-top">
                        <div>
                          <div className="cart-item-name">{entry.item.name}</div>
                          {optList.length > 0 && (
                            <div className="cart-item-opts">{optList.join(' · ')}</div>
                          )}
                        </div>
                        <div className="drink-price">{formatVnd(entry.unitPrice * entry.quantity)}</div>
                      </div>

                      <input
                        type="text"
                        className="cart-item-note-input"
                        maxLength={140}
                        placeholder="Thêm ghi chú cho món này..."
                        value={entry.note}
                        onChange={(e) => onUpdateNote(entry.uid, e.target.value)}
                      />

                      <div className="cart-item-controls">
                        <div className="qty-stepper">
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => onUpdateQty(entry.uid, -1)}
                            aria-label="Giảm số lượng"
                          >
                            <MinusIcon size={15} />
                          </button>
                          <span className="qty-val">{entry.quantity}</span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => onUpdateQty(entry.uid, 1)}
                            aria-label="Tăng số lượng"
                          >
                            <PlusIcon size={15} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="link-danger"
                          onClick={() => onRemove(entry.uid)}
                        >
                          Xóa món
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overall order note */}
              <div className="field">
                <label className="field-label" htmlFor="order-note">
                  Ghi chú cho quán (không bắt buộc)
                </label>
                <input
                  id="order-note"
                  type="text"
                  className="field-input"
                  maxLength={300}
                  placeholder="Ví dụ: lấy thêm ống hút, giao trước 15h..."
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                />
              </div>

              {/* Delivery contact details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="option-label" style={{ fontSize: 15 }}>
                  Thông tin giao hàng
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="cust-name">
                    Họ và tên *
                  </label>
                  <input
                    id="cust-name"
                    type="text"
                    required
                    autoComplete="name"
                    className="field-input"
                    placeholder="Nguyễn Minh Anh"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="cust-phone">
                    Số điện thoại *
                  </label>
                  <input
                    id="cust-phone"
                    type="tel"
                    inputMode="tel"
                    required
                    autoComplete="tel"
                    className="field-input"
                    placeholder="0912 345 678"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="cust-address">
                    Địa chỉ giao hàng tại Cao Bằng *
                  </label>
                  <textarea
                    id="cust-address"
                    required
                    autoComplete="street-address"
                    className="field-textarea"
                    placeholder="Số nhà, đường, tổ / phường (ví dụ: Số 24 Kim Đồng, P. Hợp Giang)"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                  />
                </div>
              </div>

              {/* Payment method (Bank Transfer VietQR only) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="option-label" style={{ fontSize: 15 }}>
                  Phương thức thanh toán
                </div>
                <div className="payment-card payment-card--selected" style={{ cursor: 'default' }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'var(--teal)',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 'none',
                      marginTop: 2,
                    }}
                    aria-hidden="true"
                  >
                    <CheckIcon size={13} />
                  </div>
                  <div>
                    <div className="payment-title">Chuyển khoản VietQR (BIDV) · Tự động nhận đơn</div>
                    <div className="payment-desc">
                      Quán chỉ áp dụng thanh toán chuyển khoản. Bấm đặt hàng để hiện mã QR có sẵn số
                      tiền — tiền về hệ thống tự động xác nhận và làm đồ ngay.
                    </div>
                  </div>
                </div>
              </div>

              {/* Order summary */}
              <div className="summary-box">
                <div className="summary-row">
                  <span>Tiền đồ uống ({cart.reduce((s, c) => s + c.quantity, 0)} món)</span>
                  <span className="tabular">{formatVnd(subtotal)}</span>
                </div>
                <div className="summary-row">
                  <span>Phí giao hàng</span>
                  <span style={{ color: 'var(--amber-ink)', fontWeight: 600 }}>
                    Quán báo sau khi xác nhận
                  </span>
                </div>
                <div className="summary-row summary-row--total">
                  <span>Tổng tiền đồ uống</span>
                  <span className="tabular">{formatVnd(subtotal)}</span>
                </div>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {cart.length > 0 && (
          <div className="sheet-footer">
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || pause.paused}
            >
              {submitting ? (
                'Đang gửi đơn...'
              ) : (
                <>
                  <span>Đặt hàng & lấy mã QR</span>
                  <span className="tabular">· {formatVnd(subtotal)}</span>
                </>
              )}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
