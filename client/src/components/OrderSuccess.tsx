import { useEffect, useState } from 'react';
import type { OrderDTO } from '../../../shared/types';
import { fetchCustomerOrder } from '../lib/api';
import { formatVnd, orderStatusLabel } from '../lib/format';
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon } from './Icons';

interface OrderSuccessProps {
  order: OrderDTO;
  onClose: () => void;
}

export function OrderSuccess({ order: initialOrder, onClose }: OrderSuccessProps) {
  const [order, setOrder] = useState<OrderDTO>(initialOrder);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Listen for live payment/status updates via WebSocket + gentle refresh fallback
  useEffect(() => {
    const token = order.publicToken || '';
    if (!token) return;

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws?role=customer&orderCode=${encodeURIComponent(order.orderCode)}&token=${encodeURIComponent(token)}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'customer:order_updated' && msg.order) {
            setOrder((prev) => ({
              ...prev,
              status: msg.order.status,
              paymentStatus: msg.order.paymentStatus,
              paymentConfirmedAt: msg.order.paymentConfirmedAt,
            }));
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }

    const timer = window.setInterval(() => {
      fetchCustomerOrder(order.orderCode, token)
        .then((fresh) => setOrder((prev) => ({ ...prev, ...fresh })))
        .catch(() => {});
    }, 15_000);

    return () => {
      ws?.close();
      window.clearInterval(timer);
    };
  }, [order.orderCode, order.publicToken]);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore
    }
  }

  function downloadQr() {
    if (!order.vietqr?.qrDataUrl) return;
    const a = document.createElement('a');
    a.href = order.vietqr.qrDataUrl;
    a.download = `VietQR-${order.orderCode}-NangCafe.png`;
    a.click();
  }

  const isTransferWaiting =
    order.paymentMethod === 'bank_transfer' && order.paymentStatus !== 'paid';

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-done-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-panel">
        <div className="sheet-header">
          <h2 className="sheet-title" id="order-done-title">
            Đã nhận đơn đặt hàng
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          <div className="order-code-hero">
            <span style={{ fontSize: 13, color: 'var(--teal-ink-on-dark)' }}>
              Mã đơn hàng của bạn
            </span>
            <div className="order-code-stamp">{order.orderCode}</div>
            <p className="order-confirm-msg">Quán sẽ gọi lại xác nhận</p>
            <div
              className={`order-status-pill ${
                order.status === 'awaiting_payment'
                  ? 'order-status-pill--pending'
                  : 'order-status-pill--ok'
              }`}
            >
              <CheckIcon size={15} />
              <span>Trạng thái: {orderStatusLabel(order.status)}</span>
            </div>
          </div>

          {order.paymentMethod === 'bank_transfer' && (
            <div className="vietqr-box">
              {isTransferWaiting ? (
                <>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--teal)' }}>
                      Quét mã VietQR để chuyển khoản
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                      Giữ nguyên nội dung <strong>{order.vietqr?.content || order.orderCode}</strong> để quán xác nhận nhanh
                    </div>
                  </div>

                  {order.vietqr ? (
                    <>
                      <img
                        src={order.vietqr.qrDataUrl}
                        alt={`Mã VietQR chuyển khoản đơn ${order.orderCode}`}
                        className="vietqr-img"
                      />

                      <div className="bank-details">
                        <div className="bank-row">
                          <div>
                            <div className="bank-row-label">Ngân hàng</div>
                            <div className="bank-row-value">{order.vietqr.bankName}</div>
                          </div>
                        </div>
                        <div className="bank-row">
                          <div>
                            <div className="bank-row-label">Chủ tài khoản</div>
                            <div className="bank-row-value">{order.vietqr.accountName}</div>
                          </div>
                        </div>
                        <div className="bank-row">
                          <div>
                            <div className="bank-row-label">Số tài khoản</div>
                            <div className="bank-row-value">{order.vietqr.accountNo}</div>
                          </div>
                          <button
                            type="button"
                            className="copy-mini-btn"
                            onClick={() => copyText('acc', order.vietqr!.accountNo)}
                          >
                            <CopyIcon size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                            {copiedKey === 'acc' ? 'Đã chép' : 'Sao chép'}
                          </button>
                        </div>
                        <div className="bank-row">
                          <div>
                            <div className="bank-row-label">Số tiền đồ uống</div>
                            <div className="bank-row-value">{formatVnd(order.vietqr.amount)}</div>
                          </div>
                          <button
                            type="button"
                            className="copy-mini-btn"
                            onClick={() => copyText('amt', String(order.vietqr!.amount))}
                          >
                            <CopyIcon size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                            {copiedKey === 'amt' ? 'Đã chép' : 'Sao chép'}
                          </button>
                        </div>
                        <div className="bank-row">
                          <div>
                            <div className="bank-row-label">Nội dung chuyển khoản</div>
                            <div className="bank-row-value" style={{ color: 'var(--teal)' }}>
                              {order.vietqr.content}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="copy-mini-btn"
                            onClick={() => copyText('content', order.vietqr!.content)}
                          >
                            <CopyIcon size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                            {copiedKey === 'content' ? 'Đã chép' : 'Sao chép'}
                          </button>
                        </div>
                      </div>

                      <button type="button" className="btn-secondary" style={{ width: '100%' }} onClick={downloadQr}>
                        <DownloadIcon />
                        <span>Tải mã QR về máy để quét trên app ngân hàng</span>
                      </button>
                    </>
                  ) : (
                    <div className="form-error" style={{ width: '100%', textAlign: 'center' }}>
                      Quán chưa cấu hình số tài khoản VietQR trên hệ thống. Quán sẽ gọi lại hướng dẫn thanh toán.
                    </div>
                  )}
                </>
              ) : (
                <div
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--success-bg)',
                    color: 'var(--success)',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  Quán đã xác nhận nhận được tiền chuyển khoản! Đồ uống đang được pha chế.
                </div>
              )}
            </div>
          )}

          {order.paymentMethod === 'cod' && (
            <div className="summary-box">
              <div style={{ fontWeight: 700, color: 'var(--teal)' }}>
                Thanh toán tiền mặt khi nhận hàng (COD)
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                Đơn đã được chuyển thẳng tới máy pha chế tại quán. Quán sẽ gọi lại xác nhận và báo phí ship cụ thể.
              </div>
            </div>
          )}

          {/* Ordered items summary */}
          <div className="summary-box">
            <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>
              Chi tiết đơn hàng
            </div>
            {order.items.map((it, idx) => (
              <div key={idx} className="summary-row" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>
                    {it.quantity}× {it.name}
                    {it.size === 'L' ? ' (L)' : ''}
                  </strong>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                    {[
                      it.variant,
                      it.ice,
                      it.sugar,
                      it.toppings.length ? '+' + it.toppings.map((t) => t.name).join(', ') : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {it.note && (
                    <div style={{ fontSize: 12, color: 'var(--amber-ink)' }}>
                      Ghi chú: {it.note}
                    </div>
                  )}
                </div>
                <span className="tabular" style={{ fontWeight: 600 }}>
                  {formatVnd(it.lineTotal)}
                </span>
              </div>
            ))}
            <div className="summary-row summary-row--total">
              <span>Tổng tiền đồ uống</span>
              <span className="tabular">{formatVnd(order.totalAmount)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
              Phí giao hàng sẽ được quán báo lại khi gọi xác nhận.
            </div>
          </div>
        </div>

        <div className="sheet-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            Đặt thêm món khác
          </button>
        </div>
      </div>
    </div>
  );
}
