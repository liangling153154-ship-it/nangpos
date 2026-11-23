import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  AgentPresence,
  MenuResponse,
  OrderDTO,
  OrderStatus,
} from '../../../shared/types';
import {
  adminLogin,
  adminLogout,
  confirmAdminOrderPayment,
  fetchAdminMe,
  fetchAdminOrders,
  fetchAdminSystem,
  fetchMenu,
  reprintAdminOrder,
  sendAdminTestNtfy,
  sendAdminTestPrint,
  toggleMenuItemAvailability,
  toggleToppingAvailability,
  updateAdminOrderStatus,
  updateShopPause,
  type AdminSystemInfo,
} from '../lib/api';
import {
  formatRelativeTime,
  formatVnd,
  formatVnTime,
  normalizeSearch,
  orderStatusLabel,
} from '../lib/format';
import { playAdminNewOrderSound } from '../lib/sound';
import { APP_BUILD_DATE, APP_VERSION_LABEL } from '../version';
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  LogoutIcon,
  PhoneIcon,
  PrinterIcon,
  SearchIcon,
} from '../components/Icons';

type AdminTab = 'orders' | 'menu' | 'system';

export function AdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState<AdminTab>('orders');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const ordersRef = useRef<OrderDTO[]>([]);
  ordersRef.current = orders;
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [sysInfo, setSysInfo] = useState<AdminSystemInfo | null>(null);
  const [agents, setAgents] = useState<AgentPresence[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  soundEnabledRef.current = soundEnabled;

  const [menuSearch, setMenuSearch] = useState('');
  const [pauseMessageDraft, setPauseMessageDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  // Check login session on load
  useEffect(() => {
    fetchAdminMe()
      .then((res) => {
        setAuthenticated(res.authenticated);
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadAllAdminData = useCallback(async () => {
    const [ordRes, menuRes, sysRes] = await Promise.all([
      fetchAdminOrders('all'),
      fetchMenu(),
      fetchAdminSystem(),
    ]);
    setOrders(ordRes.orders);
    setMenu(menuRes);
    setPauseMessageDraft(menuRes.pause.message || '');
    setSysInfo(sysRes);
    setAgents(sysRes.agents);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    loadAllAdminData().catch((err) => {
      showToast(err instanceof Error ? err.message : 'Lỗi tải dữ liệu quản lý');
    });
  }, [authenticated, loadAllAdminData, showToast]);

  // Realtime WebSocket for Admin Dashboard
  useEffect(() => {
    if (!authenticated) return;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws?role=admin`);
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'admin:connected' && Array.isArray(msg.agents)) {
            setAgents(msg.agents);
          } else if (msg.type === 'agents:updated' && Array.isArray(msg.agents)) {
            setAgents(msg.agents);
          } else if (msg.type === 'order:new' && msg.order) {
            const incoming = msg.order as OrderDTO;
            setOrders((prev) => [
              incoming,
              ...prev.filter((o) => o.id !== incoming.id),
            ]);
            showToast(`Đơn chờ thanh toán ${incoming.orderCode} · ${formatVnd(incoming.totalAmount)}`);
          } else if (msg.type === 'order:updated' && msg.order) {
            const updated = msg.order as OrderDTO;
            const prevMatch = ordersRef.current.find((o) => o.id === updated.id);
            const justPaid =
              updated.paymentStatus === 'paid' && prevMatch?.paymentStatus !== 'paid';
            setOrders((prev) => {
              const exists = prev.some((o) => o.id === updated.id);
              return exists
                ? prev.map((o) => (o.id === updated.id ? updated : o))
                : [updated, ...prev];
            });
            if (justPaid) {
              showToast(
                `Đã nhận tiền & tự nhận đơn ${updated.orderCode} · ${formatVnd(updated.totalAmount)}`
              );
              if (soundEnabledRef.current) {
                playAdminNewOrderSound();
              }
            }
          } else if (msg.type === 'pause:updated' && msg.pause) {
            setMenu((prev) => (prev ? { ...prev, pause: msg.pause } : prev));
          } else if (msg.type === 'menu:updated') {
            fetchMenu().then(setMenu).catch(() => {});
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [authenticated, showToast]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      await adminLogin(username, password);
      setAuthenticated(true);
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await adminLogout();
    setAuthenticated(false);
    setOrders([]);
  }

  async function handleConfirmPayment(order: OrderDTO) {
    setBusyId(`pay-${order.id}`);
    try {
      const res = await confirmAdminOrderPayment(order.id);
      setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
      showToast(
        res.printQueued
          ? `Đã xác nhận tiền đơn ${order.orderCode} và đẩy xuống máy in.`
          : `Đơn ${order.orderCode} đã được xác nhận thanh toán.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không xác nhận được tiền.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReprint(order: OrderDTO) {
    setBusyId(`reprint-${order.id}`);
    try {
      const res = await reprintAdminOrder(order.id);
      showToast(
        res.onlineAgents > 0
          ? `Đã gửi lệnh in lại phiếu ${order.orderCode} xuống máy in quán.`
          : `Đã xếp hàng in lại ${order.orderCode}. Máy tính quán sẽ tự in khi có mạng.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi gửi lệnh in lại.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatusChange(order: OrderDTO, status: OrderStatus) {
    setBusyId(`st-${order.id}`);
    try {
      const res = await updateAdminOrderStatus(order.id, status);
      setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
      showToast(`Đơn ${order.orderCode} → ${orderStatusLabel(status)}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTogglePause(nextPaused: boolean, customMsg?: string) {
    setBusyId('pause');
    try {
      const msg = customMsg !== undefined ? customMsg : pauseMessageDraft;
      const res = await updateShopPause(nextPaused, msg);
      setMenu((prev) => (prev ? { ...prev, pause: res.pause } : prev));
      showToast(
        res.pause.paused
          ? 'Đã bật chế độ TẠM NGHỈ nhận đơn ship.'
          : 'Quán đã MỞ BÁN nhận đơn ship trở lại.'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không đổi được trạng thái quán.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleItem(id: number, nextAvail: boolean, name: string) {
    setBusyId(`item-${id}`);
    try {
      await toggleMenuItemAvailability(id, nextAvail);
      setMenu((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) =>
                it.id === id ? { ...it, isAvailable: nextAvail } : it
              ),
            }
          : prev
      );
      showToast(nextAvail ? `Đã mở bán lại "${name}"` : `Đã tắt hết hàng "${name}"`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật món.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleTopping(id: number, nextAvail: boolean, name: string) {
    setBusyId(`top-${id}`);
    try {
      await toggleToppingAvailability(id, nextAvail);
      setMenu((prev) =>
        prev
          ? {
              ...prev,
              toppings: prev.toppings.map((t) =>
                t.id === id ? { ...t, isAvailable: nextAvail } : t
              ),
            }
          : prev
      );
      showToast(nextAvail ? `Đã mở bán topping "${name}"` : `Đã báo hết "${name}"`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật topping.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTestPrint() {
    setBusyId('test-print');
    try {
      const res = await sendAdminTestPrint();
      showToast(
        res.onlineAgents > 0
          ? 'Đã đẩy phiếu in thử xuống máy tính quán!'
          : 'Đã tạo lệnh in thử (máy tính quán đang ngoại tuyến, sẽ tự in bù khi kết nối lại).'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi in thử.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTestNtfy() {
    setBusyId('test-ntfy');
    try {
      const res = await sendAdminTestNtfy();
      if (res.sent) {
        showToast('Đã gửi thông báo thử tới điện thoại chủ quán (ntfy)!');
      } else {
        showToast(`Chưa gửi được ntfy: ${res.error || 'Chưa cấu hình NTFY_TOPIC'}`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi gửi thử ntfy.');
    } finally {
      setBusyId(null);
    }
  }

  const awaitingPaymentCount = useMemo(
    () => orders.filter((o) => o.status === 'awaiting_payment').length,
    [orders]
  );

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'all') return orders;
    if (statusFilter === 'active') {
      return orders.filter((o) => o.status === 'pending_shop' || o.status === 'accepted');
    }
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  const filteredMenuItems = useMemo(() => {
    if (!menu) return [];
    const q = normalizeSearch(menuSearch);
    if (!q) return menu.items;
    return menu.items.filter((i) => normalizeSearch(`${i.name} ${i.description}`).includes(q));
  }, [menu, menuSearch]);

  if (!authChecked) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card">Đang kiểm tra phiên đăng nhập...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="admin-login-page">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <img
            src="/images/brand/logo-nang-cafe.png"
            alt="Nâng Café"
            className="admin-login-logo"
          />
          <div>
            <h1 className="admin-login-title">Quản lý đơn ship Nâng Café</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--ink-muted)' }}>
              Đăng nhập để xem đơn mới, xác nhận chuyển khoản và điều khiển thực đơn.
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="admin-user">
              Tên đăng nhập
            </label>
            <input
              id="admin-user"
              type="text"
              className="field-input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="admin-pass">
              Mật khẩu
            </label>
            <input
              id="admin-pass"
              type="password"
              className="field-input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {loginError && (
            <div className="form-error" role="alert">
              {loginError}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={loggingIn}>
            {loggingIn ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--ink-muted)' }}>
            <a
              href="/"
              style={{
                color: 'var(--ink-muted)',
                textDecoration: 'underline',
              }}
            >
              Quay lại trang đặt món của khách
            </a>
            <span className="tabular">{APP_VERSION_LABEL}</span>
          </div>
        </form>
      </div>
    );
  }

  const isPaused = Boolean(menu?.pause.paused);

  return (
    <div className="admin-shell">
      {/* Top Operational Bar */}
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <div className="admin-brand-group">
            <img
              src="/images/brand/logo-nang-cafe-reverse.png"
              alt="Nâng Café"
              className="admin-logo-sm"
            />
            <h1 className="admin-page-title">Quản lý đơn ship</h1>
            <span className="indicator-pill tabular" title={`Ngày cập nhật: ${APP_BUILD_DATE}`}>
              {APP_VERSION_LABEL}
            </span>
          </div>

          <div className="admin-status-cluster">
            <span className="indicator-pill" title="Trạng thái kết nối WebSocket">
              <span className={`ind-dot ${wsConnected ? 'ind-dot--ok' : 'ind-dot--warn'}`} />
              <span>{wsConnected ? 'Trực tuyến' : 'Đang kết nối...'}</span>
            </span>

            <span className="indicator-pill" title="Trạng thái máy tính & máy in ở quán">
              <span
                className={`ind-dot ${agents.length > 0 ? 'ind-dot--ok' : 'ind-dot--off'}`}
              />
              <span>
                {agents.length > 0
                  ? `Máy in sẵn sàng (${agents[0].hostname})`
                  : 'Máy in ngoại tuyến'}
              </span>
            </span>

            <button
              type="button"
              className={`topbar-btn ${isPaused ? 'topbar-btn--paused' : ''}`}
              disabled={busyId === 'pause'}
              onClick={() => handleTogglePause(!isPaused)}
            >
              <span>{isPaused ? 'Đang TẠM NGHỈ (Bấm mở lại)' : 'Tạm nghỉ'}</span>
            </button>

            <button
              type="button"
              className="topbar-btn"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) playAdminNewOrderSound();
              }}
              title="Bật/tắt chuông báo trên trình duyệt này"
            >
              {soundEnabled ? <BellIcon size={15} /> : <BellOffIcon size={15} />}
              <span>{soundEnabled ? 'Loa web: Bật' : 'Loa web: Tắt'}</span>
            </button>

            <button type="button" className="topbar-btn" onClick={handleLogout}>
              <LogoutIcon size={15} />
              <span>Thoát</span>
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="admin-tabs-bar" aria-label="Khu vực quản lý">
        <div className="admin-tabs-inner">
          <button
            type="button"
            className={`admin-tab ${tab === 'orders' ? 'admin-tab--active' : ''}`}
            onClick={() => setTab('orders')}
          >
            <span>Đơn hàng ({orders.length})</span>
            {awaitingPaymentCount > 0 && (
              <span className="tab-badge">{awaitingPaymentCount} chờ CK</span>
            )}
          </button>

          <button
            type="button"
            className={`admin-tab ${tab === 'menu' ? 'admin-tab--active' : ''}`}
            onClick={() => setTab('menu')}
          >
            <span>
              Thực đơn & Hết hàng
              {menu
                ? ` (${menu.items.filter((i) => !i.isAvailable).length} hết)`
                : ''}
            </span>
          </button>

          <button
            type="button"
            className={`admin-tab ${tab === 'system' ? 'admin-tab--active' : ''}`}
            onClick={() => {
              setTab('system');
              fetchAdminSystem().then(setSysInfo).catch(() => {});
            }}
          >
            <span>Trạng thái quán & Máy in</span>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="admin-main">
        {/* TAB 1: ORDERS */}
        {tab === 'orders' && (
          <>
            <div className="filter-bar">
              <div className="filter-pills">
                {[
                  { key: 'all', label: `Tất cả (${orders.length})` },
                  {
                    key: 'awaiting_payment',
                    label: `Chờ thanh toán (${awaitingPaymentCount})`,
                  },
                  {
                    key: 'active',
                    label: `Đang làm (${orders.filter((o) => o.status === 'pending_shop' || o.status === 'accepted').length})`,
                  },
                  {
                    key: 'completed',
                    label: `Hoàn tất (${orders.filter((o) => o.status === 'completed').length})`,
                  },
                  {
                    key: 'cancelled',
                    label: `Đã hủy (${orders.filter((o) => o.status === 'cancelled').length})`,
                  },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`filter-pill ${statusFilter === f.key ? 'filter-pill--active' : ''}`}
                    onClick={() => setStatusFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="action-btn"
                onClick={() => loadAllAdminData().then(() => showToast('Đã làm mới danh sách'))}
              >
                Làm mới
              </button>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="empty-state">
                <p>Chưa có đơn hàng nào trong mục này.</p>
              </div>
            ) : (
              <div className="orders-grid">
                {filteredOrders.map((order) => {
                  const needsPaymentConfirm =
                    order.paymentMethod === 'bank_transfer' &&
                    order.paymentStatus !== 'paid' &&
                    order.status !== 'cancelled';

                  return (
                    <article
                      key={order.id}
                      className={`order-card ${needsPaymentConfirm ? 'order-card--attention' : ''}`}
                    >
                      <div className="order-card-head">
                        <div>
                          <div className="order-code-lg">{order.orderCode}</div>
                          <div className="order-time">
                            {formatVnTime(order.createdAt)} · {formatRelativeTime(order.createdAt)}
                          </div>
                        </div>

                        <div className="badge-group">
                          {order.paymentMethod === 'cod' ? (
                            <span className="state-badge state-badge--cod">THU TIỀN MẶT</span>
                          ) : order.paymentStatus === 'paid' ? (
                            <span className="state-badge state-badge--paid">
                              CK · Đã nhận tiền
                              {order.paymentConfirmedBy === 'sepay' ? ' (SePay)' : ''}
                            </span>
                          ) : (
                            <span className="state-badge state-badge--waitpay">
                              CK · Chờ xác nhận tiền
                            </span>
                          )}

                          {order.printStatus === 'printed' ? (
                            <span className="state-badge state-badge--printed">
                              Đã in ({order.printCount}x)
                            </span>
                          ) : order.printStatus === 'pending' ? (
                            <span className="state-badge state-badge--pending-print">
                              Đang chờ máy in
                            </span>
                          ) : (
                            <span className="state-badge state-badge--pending-print">
                              Chưa in phiếu
                            </span>
                          )}

                          {order.status === 'completed' && (
                            <span className="state-badge state-badge--done">Hoàn tất</span>
                          )}
                          {order.status === 'cancelled' && (
                            <span className="state-badge state-badge--cancel">Đã hủy</span>
                          )}
                        </div>
                      </div>

                      <div className="order-customer">
                        <div className="order-customer-top">
                          <strong>{order.customerName}</strong>
                          <a href={`tel:${order.customerPhone}`} className="order-phone-link">
                            <PhoneIcon
                              size={14}
                              style={{ verticalAlign: '-2px', marginRight: 4 }}
                            />
                            {order.customerPhone}
                          </a>
                        </div>
                        <div className="order-address">{order.customerAddress}</div>
                      </div>

                      <ul className="order-items-list">
                        {order.items.map((item, idx) => (
                          <li key={idx} className="order-item-line">
                            <div>
                              <strong>
                                {item.quantity}× {item.name}
                                {item.size === 'L' ? ' (Size L)' : ''}
                              </strong>
                              <div className="order-item-detail">
                                {[
                                  item.variant,
                                  item.ice,
                                  item.sugar,
                                  item.toppings.length > 0
                                    ? '+' + item.toppings.map((t) => t.name).join(', ')
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                              {item.note && (
                                <div className="order-item-note">Ghi chú: {item.note}</div>
                              )}
                            </div>
                            <span className="tabular" style={{ fontWeight: 700, flex: 'none' }}>
                              {formatVnd(item.lineTotal)}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {order.note && (
                        <div className="order-note-box">Ghi chú đơn: {order.note}</div>
                      )}

                      <div className="order-card-foot">
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                            Tổng đồ uống (chưa gồm ship)
                          </div>
                          <div className="order-total-amt">{formatVnd(order.totalAmount)}</div>
                        </div>

                        <div className="order-actions">
                          {needsPaymentConfirm && (
                            <button
                              type="button"
                              className="action-btn action-btn--confirm"
                              disabled={busyId === `pay-${order.id}`}
                              onClick={() => handleConfirmPayment(order)}
                            >
                              <CheckIcon size={15} />
                              <span>
                                {busyId === `pay-${order.id}`
                                  ? 'Đang xác nhận...'
                                  : 'Xác nhận đã nhận tiền'}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            className="action-btn"
                            disabled={busyId === `reprint-${order.id}`}
                            onClick={() => handleReprint(order)}
                          >
                            <PrinterIcon size={15} />
                            <span>In lại phiếu</span>
                          </button>

                          {order.status !== 'completed' && order.status !== 'cancelled' && (
                            <>
                              <button
                                type="button"
                                className="action-btn action-btn--primary"
                                disabled={busyId === `st-${order.id}`}
                                onClick={() => handleStatusChange(order, 'completed')}
                              >
                                Hoàn tất
                              </button>
                              <button
                                type="button"
                                className="action-btn action-btn--danger"
                                disabled={busyId === `st-${order.id}`}
                                onClick={() => {
                                  if (window.confirm(`Hủy đơn ${order.orderCode}?`)) {
                                    handleStatusChange(order, 'cancelled');
                                  }
                                }}
                              >
                                Hủy
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* TAB 2: MENU AVAILABILITY */}
        {tab === 'menu' && menu && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="filter-bar" style={{ marginBottom: 0 }}>
              <div className="search-box" style={{ maxWidth: 380 }}>
                <SearchIcon size={17} className="search-icon" />
                <input
                  type="search"
                  className="search-input"
                  placeholder="Tìm món cần báo hết hàng..."
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                />
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-muted)' }}>
                Đang bán: <strong>{menu.items.filter((i) => i.isAvailable).length}</strong> · Hết
                hàng: <strong>{menu.items.filter((i) => !i.isAvailable).length}</strong>
              </div>
            </div>

            <div className="menu-admin-list">
              {filteredMenuItems.map((item) => (
                <div
                  key={item.id}
                  className={`menu-admin-row ${!item.isAvailable ? 'menu-admin-row--off' : ''}`}
                >
                  <div className="menu-admin-left">
                    <img src={item.imageUrl} alt="" className="menu-admin-thumb" />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{item.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--ink-muted)' }} className="tabular">
                        {formatVnd(item.price)}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`toggle-switch ${item.isAvailable ? 'toggle-switch--on' : 'toggle-switch--off'}`}
                    disabled={busyId === `item-${item.id}`}
                    onClick={() => handleToggleItem(item.id, !item.isAvailable, item.name)}
                  >
                    {item.isAvailable ? 'Đang bán' : 'Hết hàng'}
                  </button>
                </div>
              ))}
            </div>

            <div>
              <h2 className="settings-title" style={{ marginBottom: 10 }}>
                Topping (+8.000đ)
              </h2>
              <div className="menu-admin-list">
                {menu.toppings.map((t) => (
                  <div
                    key={t.id}
                    className={`menu-admin-row ${!t.isAvailable ? 'menu-admin-row--off' : ''}`}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }} className="tabular">
                        +{formatVnd(t.price)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`toggle-switch ${t.isAvailable ? 'toggle-switch--on' : 'toggle-switch--off'}`}
                      disabled={busyId === `top-${t.id}`}
                      onClick={() => handleToggleTopping(t.id, !t.isAvailable, t.name)}
                    >
                      {t.isAvailable ? 'Còn hàng' : 'Hết hàng'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SYSTEM & PAUSE */}
        {tab === 'system' && (
          <div className="settings-grid">
            <section className="settings-panel">
              <h2 className="settings-title">Chế độ Tạm nghỉ nhận đơn</h2>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-muted)' }}>
                Khi bật Tạm nghỉ, khách vẫn xem được menu nhưng nút Đặt hàng sẽ khóa và hiển thị
                thông báo bên dưới ngay lập tức.
              </p>

              <div className="field">
                <label className="field-label" htmlFor="pause-msg">
                  Lời nhắn hiển thị cho khách (không bắt buộc)
                </label>
                <input
                  id="pause-msg"
                  type="text"
                  className="field-input"
                  maxLength={200}
                  placeholder="Ví dụ: Quán tạm nghỉ ship do mưa lớn, hẹn bạn sau 30 phút."
                  value={pauseMessageDraft}
                  onChange={(e) => setPauseMessageDraft(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button"
                  className={`action-btn ${isPaused ? 'action-btn--confirm' : 'action-btn--danger'}`}
                  disabled={busyId === 'pause'}
                  onClick={() => handleTogglePause(!isPaused, pauseMessageDraft)}
                >
                  {isPaused ? 'Mở bán lại ngay' : 'Bật Tạm nghỉ'}
                </button>
                {isPaused && (
                  <button
                    type="button"
                    className="action-btn"
                    disabled={busyId === 'pause'}
                    onClick={() => handleTogglePause(true, pauseMessageDraft)}
                  >
                    Cập nhật lời nhắn
                  </button>
                )}
              </div>
            </section>

            <section className="settings-panel">
              <h2 className="settings-title">Máy tính quán, Máy in & Thông báo</h2>
              <div className="kv-list">
                <div className="kv-row">
                  <span>Phiên bản hệ thống</span>
                  <strong className="tabular">
                    {sysInfo?.version ? `v${sysInfo.version}` : APP_VERSION_LABEL} ({sysInfo?.buildDate || APP_BUILD_DATE})
                  </strong>
                </div>
                <div className="kv-row">
                  <span>Máy tính quán (Shop Agent)</span>
                  <strong style={{ color: agents.length > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {agents.length > 0
                      ? `Đang trực tuyến (${agents.map((a) => `${a.hostname} · ${a.printerMode}`).join(', ')})`
                      : 'Ngoại tuyến'}
                  </strong>
                </div>
                <div className="kv-row">
                  <span>Phiếu đang chờ in bù</span>
                  <strong className="tabular">{sysInfo?.pendingPrintCount ?? 0}</strong>
                </div>
                <div className="kv-row">
                  <span>VietQR BIDV</span>
                  <strong>
                    {sysInfo?.vietqrConfigured
                      ? `Đã cấu hình (${sysInfo.vietqrBankName})`
                      : 'Chưa điền VIETQR_ACCOUNT_NO'}
                  </strong>
                </div>
                <div className="kv-row">
                  <span>Thông báo điện thoại (ntfy)</span>
                  <strong>
                    {sysInfo?.ntfyConfigured ? 'Đã cấu hình topic' : 'Chưa cấu hình NTFY_TOPIC'}
                  </strong>
                </div>
                <div className="kv-row">
                  <span>SePay Webhook tự động</span>
                  <strong>
                    {sysInfo?.sepayConfigured
                      ? `Đã kích hoạt (${sysInfo.sepayWebhookPath})`
                      : `Chờ kích hoạt (${sysInfo?.sepayWebhookPath || '/api/webhooks/sepay'})`}
                  </strong>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  className="action-btn action-btn--primary"
                  disabled={busyId === 'test-print'}
                  onClick={handleTestPrint}
                >
                  <PrinterIcon size={15} />
                  <span>In phiếu thử</span>
                </button>

                <button
                  type="button"
                  className="action-btn"
                  disabled={busyId === 'test-ntfy'}
                  onClick={handleTestNtfy}
                >
                  <BellIcon size={15} />
                  <span>Gửi thử thông báo ntfy</span>
                </button>

                <button
                  type="button"
                  className="action-btn"
                  onClick={() => playAdminNewOrderSound()}
                >
                  Thử chuông & đọc "Đơn mới"
                </button>
              </div>
            </section>
          </div>
        )}
      </main>

      {toast && (
        <div className="toast-banner" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
