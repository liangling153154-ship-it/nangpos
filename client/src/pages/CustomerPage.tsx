import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItemDTO, MenuResponse, OrderDTO } from '../../../shared/types';
import { fetchCustomerOrder, fetchMenu } from '../lib/api';
import { formatVnd, normalizeSearch } from '../lib/format';
import { APP_VERSION_LABEL } from '../version';
import { CartDrawer } from '../components/CartDrawer';
import { DrinkSheet, type CartEntry } from '../components/DrinkSheet';
import { OrderSuccess } from '../components/OrderSuccess';
import {
  AlertIcon,
  BagIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  MapPinIcon,
  NangStarBadge,
  PlusIcon,
  ReceiptIcon,
  SearchIcon,
} from '../components/Icons';

const RECENT_ORDER_KEY = 'nang_recent_order_code_v1';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function CustomerPage() {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>('signature');

  const [cart, setCart] = useState<CartEntry[]>([]);
  const [selectedDrink, setSelectedDrink] = useState<MenuItemDTO | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeOrder, setActiveOrder] = useState<OrderDTO | null>(null);
  const [recentOrderCode, setRecentOrderCode] = useState<string | null>(() => {
    try {
      return localStorage.getItem(RECENT_ORDER_KEY);
    } catch {
      return null;
    }
  });
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const loadMenu = useCallback(async () => {
    try {
      const data = await fetchMenu();
      setMenu(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Không tải được thực đơn.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  // Listen for PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Realtime menu availability & shop pause updates via WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws?role=public`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'menu:updated') {
            loadMenu();
          } else if (msg.type === 'pause:updated' && msg.pause) {
            setMenu((prev) => (prev ? { ...prev, pause: msg.pause } : prev));
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!disposed) {
          retryTimer = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [loadMenu]);

  // Quantity per menuItemId currently in cart
  const cartQtyByItemId = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of cart) {
      map.set(entry.item.id, (map.get(entry.item.id) || 0) + entry.quantity);
    }
    return map;
  }, [cart]);

  const totalCount = useMemo(() => cart.reduce((s, c) => s + c.quantity, 0), [cart]);
  const totalAmount = useMemo(
    () => cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0),
    [cart]
  );

  const normalizedQuery = normalizeSearch(search);

  const groupedCategories = useMemo(() => {
    if (!menu) return [];
    return menu.categories
      .map((cat) => {
        const items = menu.items.filter((it) => {
          if (it.categoryId !== cat.id) return false;
          if (!normalizedQuery) return true;
          const hay = normalizeSearch(`${it.name} ${it.nameEn} ${it.description} ${cat.name}`);
          return hay.includes(normalizedQuery);
        });
        return { category: cat, items };
      })
      .filter((g) => g.items.length > 0);
  }, [menu, normalizedQuery]);

  const signatureItems = useMemo(() => {
    if (!menu) return [];
    return menu.items.filter((i) => i.isFeatured);
  }, [menu]);

  function addToCart(entry: CartEntry) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.uid === entry.uid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + entry.quantity };
        return next;
      }
      return [...prev, entry];
    });
  }

  function updateCartQty(uid: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.uid === uid ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  }

  function updateCartNote(uid: string, note: string) {
    setCart((prev) => prev.map((c) => (c.uid === uid ? { ...c, note } : c)));
  }

  function removeFromCart(uid: string) {
    setCart((prev) => prev.filter((c) => c.uid !== uid));
  }

  function handleOrderPlaced(order: OrderDTO) {
    setCart([]);
    setCartOpen(false);
    setActiveOrder(order);
    setRecentOrderCode(order.orderCode);
    try {
      localStorage.setItem(RECENT_ORDER_KEY, order.orderCode);
    } catch {
      // ignore
    }
  }

  async function openRecentOrder() {
    if (!recentOrderCode) return;
    try {
      const order = await fetchCustomerOrder(recentOrderCode);
      setActiveOrder(order);
    } catch {
      setRecentOrderCode(null);
      try {
        localStorage.removeItem(RECENT_ORDER_KEY);
      } catch {}
    }
  }

  function jumpToCategory(slug: string) {
    setActiveCat(slug);
    const el = sectionRefs.current[slug];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function handleInstallPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const res = await installPrompt.userChoice;
    if (res.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  }

  return (
    <div className="app-shell">
      {/* Deep Teal Brand Header with Tày-Nùng Thổ Cẩm motif */}
      <header className="brand-hero">
        <div className="brand-hero-inner">
          <div className="brand-topbar">
            <a href="/" className="brand-logo-link" aria-label="Nâng Café Trang chủ">
              <img
                src="/images/brand/logo-nang-cafe-reverse.png"
                alt="Nâng Café"
                className="brand-logo-img"
              />
            </a>

            <div className="brand-actions">
              {recentOrderCode && (
                <button
                  type="button"
                  className="recent-order-chip"
                  onClick={openRecentOrder}
                >
                  <ReceiptIcon size={15} />
                  <span>Đơn {recentOrderCode}</span>
                </button>
              )}
              {installPrompt && (
                <button type="button" className="install-chip" onClick={handleInstallPwa}>
                  <DownloadIcon size={15} />
                  <span>Cài app</span>
                </button>
              )}
            </div>
          </div>

          <div className="brand-intro">
            <div>
              <h1 className="brand-headline">Đặt ship tận nơi</h1>
              <div className="brand-meta">
                <span className="status-pill">
                  <span
                    className={`status-dot ${menu?.pause.paused ? 'status-dot--paused' : ''}`}
                  />
                  <span>
                    {menu?.pause.paused ? 'Đang tạm nghỉ' : 'Đang nhận đơn'}
                  </span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <ClockIcon size={14} />
                  <span>{menu?.store.hours || '7:00 — 22:00'}</span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <MapPinIcon size={14} />
                  <span>075 tổ 10, P. Sông Hiến, Cao Bằng</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Paused Store Banner */}
      {menu?.pause.paused && (
        <div className="pause-banner" role="status">
          <div className="pause-banner-inner">
            <AlertIcon size={20} style={{ flex: 'none', marginTop: 1 }} />
            <div>
              <strong>Quán hiện đang tạm nghỉ nhận đơn ship.</strong>{' '}
              {menu.pause.message ||
                'Bạn vẫn có thể xem trước thực đơn và quay lại đặt khi quán mở lại nhé.'}
            </div>
          </div>
        </div>
      )}

      {/* Sticky Search + Category Pills */}
      {menu && (
        <nav className="sticky-nav" aria-label="Tìm kiếm và danh mục đồ uống">
          <div className="sticky-nav-inner">
            <div className="search-row">
              <div className="search-box">
                <SearchIcon size={17} className="search-icon" />
                <input
                  type="search"
                  className="search-input"
                  placeholder="Tìm cà phê hạt dẻ, trà mác kham, matcha..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Tìm đồ uống"
                />
                {search && (
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => setSearch('')}
                    aria-label="Xóa từ khóa"
                  >
                    <CloseIcon size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="cat-rail" role="tablist">
              {menu.categories.map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  role="tab"
                  aria-selected={activeCat === cat.slug}
                  className={`cat-pill ${activeCat === cat.slug ? 'cat-pill--active' : ''}`}
                  onClick={() => jumpToCategory(cat.slug)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </nav>
      )}

      {/* Main Menu Area */}
      <main className="menu-main">
        {loading && (
          <div className="skeleton-list" aria-label="Đang tải thực đơn">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
        )}

        {!loading && loadError && (
          <div className="empty-state">
            <p>{loadError}</p>
            <button type="button" className="btn-secondary" onClick={loadMenu}>
              Tải lại thực đơn
            </button>
          </div>
        )}

        {!loading && menu && (
          <>
            {/* Signature Editorial Strip (hidden during active text search) */}
            {!normalizedQuery && signatureItems.length > 0 && (
              <section
                className="sig-section"
                aria-labelledby="sig-heading"
                ref={(el) => {
                  sectionRefs.current['signature'] = el;
                }}
              >
                <div className="sig-head">
                  <h2 className="sig-title" id="sig-heading">
                    Đặc biệt của Nâng
                  </h2>
                  <p className="sig-sub">Hạt dẻ · Mác kham Cao Bằng</p>
                </div>

                <div className="sig-rail">
                  {signatureItems.map((item) => {
                    const inCartQty = cartQtyByItemId.get(item.id) || 0;
                    const soldOut = !item.isAvailable;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`sig-card ${soldOut ? 'sig-card--soldout' : ''}`}
                        disabled={soldOut}
                        onClick={() => setSelectedDrink(item)}
                      >
                        <div className="sig-card-media">
                          <img src={item.imageUrl} alt={item.name} loading="lazy" />
                        </div>
                        <div className="sig-card-body">
                          {item.badge && <span className="sig-card-tag">{item.badge}</span>}
                          <span className="sig-card-name">{item.name}</span>
                          <div className="sig-card-foot">
                            <span className="sig-card-price">{formatVnd(item.price)}</span>
                            {soldOut ? (
                              <span className="soldout-pill">Hết hàng</span>
                            ) : (
                              <span
                                className={`add-circle ${inCartQty > 0 ? 'add-circle--in-cart' : ''}`}
                                style={{ height: 30, minWidth: 30 }}
                              >
                                {inCartQty > 0 ? inCartQty : <PlusIcon size={15} />}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Categorized Full Menu */}
            {groupedCategories.length === 0 ? (
              <div className="empty-state">
                <p>Không tìm thấy món phù hợp với "{search}".</p>
                <button type="button" className="btn-secondary" onClick={() => setSearch('')}>
                  Xem toàn bộ thực đơn
                </button>
              </div>
            ) : (
              groupedCategories
                .filter((g) => !(g.category.slug === 'signature' && !normalizedQuery))
                .map(({ category, items }) => (
                  <section
                    key={category.slug}
                    className="cat-section"
                    aria-labelledby={`cat-${category.slug}`}
                    ref={(el) => {
                      sectionRefs.current[category.slug] = el;
                    }}
                  >
                    <div className="cat-header">
                      <h2 className="cat-title" id={`cat-${category.slug}`}>
                        {category.name}
                      </h2>
                      {category.subtitle && (
                        <p className="cat-subtitle">{category.subtitle}</p>
                      )}
                    </div>

                    <div className="menu-grid">
                      {items.map((item) => {
                        const inCartQty = cartQtyByItemId.get(item.id) || 0;
                        const soldOut = !item.isAvailable;
                        const isStarred = item.badge === 'Nên thử';

                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`drink-row ${soldOut ? 'drink-row--soldout' : ''}`}
                            disabled={soldOut}
                            onClick={() => setSelectedDrink(item)}
                          >
                            <div
                              className={`drink-thumb ${
                                item.imageFit === 'cover' ? 'drink-thumb--cover' : ''
                              }`}
                            >
                              <img src={item.imageUrl} alt={item.name} loading="lazy" />
                              {isStarred && !soldOut && (
                                <NangStarBadge size={22} className="drink-star" />
                              )}
                            </div>

                            <div className="drink-info">
                              <div>
                                <div className="drink-name-line">
                                  <span className="drink-name">{item.name}</span>
                                  {soldOut ? (
                                    <span className="soldout-pill">Hết hàng</span>
                                  ) : (
                                    item.badge && (
                                      <span className="drink-badge">{item.badge}</span>
                                    )
                                  )}
                                </div>
                                {item.description && (
                                  <p className="drink-desc">{item.description}</p>
                                )}
                              </div>

                              <div className="drink-bottom">
                                <span className="drink-price">{formatVnd(item.price)}</span>
                                <span
                                  className={`add-circle ${
                                    soldOut
                                      ? 'add-circle--disabled'
                                      : inCartQty > 0
                                        ? 'add-circle--in-cart'
                                        : ''
                                  }`}
                                  aria-hidden="true"
                                >
                                  {soldOut ? (
                                    '—'
                                  ) : inCartQty > 0 ? (
                                    inCartQty
                                  ) : (
                                    <PlusIcon size={16} />
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))
            )}

            {/* Store Footer */}
            <footer className="store-footer">
              <img
                src="/images/brand/sketch-nang.png"
                alt="Minh họa ngôi nhà vách đất Nâng Café Cao Bằng"
                className="footer-sketch"
                loading="lazy"
              />
              <p className="footer-note">
                <strong>Nâng Café</strong> · 075 tổ 10, P. Sông Hiến, Thục Phán, Cao Bằng · Mở cửa
                7:00 — 22:00. Đá hay nóng cùng một giá; phí ship quán báo lại khi gọi xác nhận.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <a href="/admin" className="footer-admin-link">
                  Trang quản lý dành cho quán
                </a>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }} className="tabular">
                  · {APP_VERSION_LABEL}
                </span>
              </div>
            </footer>
          </>
        )}
      </main>

      {/* Floating Bottom Cart Bar */}
      {totalCount > 0 && (
        <div className="cart-bar-wrap">
          <button
            type="button"
            className="cart-bar"
            onClick={() => setCartOpen(true)}
          >
            <span className="cart-bar-left">
              <span className="cart-count-badge">{totalCount}</span>
              <BagIcon size={19} />
              <span className="cart-bar-label">Xem giỏ & Đặt hàng</span>
            </span>
            <span className="cart-bar-total">{formatVnd(totalAmount)}</span>
          </button>
        </div>
      )}

      {/* Drink Customization Bottom Sheet */}
      {selectedDrink && menu && (
        <DrinkSheet
          item={selectedDrink}
          menu={menu}
          onClose={() => setSelectedDrink(null)}
          onAdd={addToCart}
        />
      )}

      {/* Cart & Checkout Drawer */}
      {cartOpen && menu && (
        <CartDrawer
          cart={cart}
          pause={menu.pause}
          onUpdateQty={updateCartQty}
          onUpdateNote={updateCartNote}
          onRemove={removeFromCart}
          onClose={() => setCartOpen(false)}
          onOrderPlaced={handleOrderPlaced}
        />
      )}

      {/* Order Confirmation & VietQR Sheet */}
      {activeOrder && (
        <OrderSuccess order={activeOrder} onClose={() => setActiveOrder(null)} />
      )}
    </div>
  );
}
