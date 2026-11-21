# DESIGN — Nâng Café Delivery System

## Visual World (Inherited from Nâng Café Brand Assets)
- **Ground & Paper:** Warm giấy bản cream `#F6EDDD` (`--paper`), raised surface `#FBF6EC` (`--paper-raised`), photo tray `#F2E8DE` (`--paper-shot`), hairline rule `#DCCBB0` (`--rule`).
- **Brand Primary:** Deep Nâng Teal `#0B4A53` (`--teal`), dark teal `#073238` (`--teal-deep`), primary ink `#12333A` (`--ink`).
- **Signature Accents:** Nâng Peach `#FAAA6D` (`--peach`, used on dark teal/chestnut), accessible roasted amber `#8F4F18` (`--amber-ink`, contrast ≥ 5.5:1 on light paper), Cao Bằng Chestnut `#5A3C2F` (`--chestnut`) for Signature showcase.
- **Cultural Texture:** Subtle Tày–Nùng stepped-diamond brocade (`thổ cẩm`) SVG tile (`--brocade-tile`) on deep teal headers.
- **Typography (Self-hosted, Vietnamese subset):**
  - UI & Body: `Be Vietnam Pro` (400, 500, 600, italic) with `tabular-nums` for prices, order codes, phone numbers, timestamps.
  - Display & Order Stamps: `Big Shoulders Display` (700, 800) uppercase for section headings and `NCxxxx` order codes.

## Surface Modes
- **Customer PWA (`/`):** Tactile mobile-first café ordering. Sticky category navigation, Signature Cao Bằng horizontal rail, clear dimmed out-of-stock states (`Hết hàng`), ≥ 44px touch targets, bottom sheets for customization and checkout, scannable EMVCo VietQR card with 1-tap copy and PNG download.
- **Admin Dashboard (`/admin`):** Operate mode — restrained, scannable, dense. Fixed top bar with live WebSocket & Shop Printer Agent presence dots, one-tap `"Tạm nghỉ"` toggle, filterable order cards with bold `THU TIỀN MẶT` vs `CHUYỂN KHOẢN` badges, instant out-of-stock switches, and system diagnostics (`In phiếu thử`, `Gửi thử ntfy`).

## Craft Floor Checks
- Contrast ≥ 4.5:1 on all body text and interactive labels.
- Zero emoji UI icons — consistent 1.9px stroke SVG icon set plus Nâng's rounded star badge from Menu 15-09.
- Browser surfaces themed (`::selection`, `caret-color`, custom scrollbars, `:focus-visible` ring).
- Reduced-motion respected via `@media (prefers-reduced-motion: reduce)`.
