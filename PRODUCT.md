# PRODUCT — Nâng Café (Đặt Ship Cao Bằng)

## Brand Truth
- **Tên quán:** Nâng Café ("Nâng" trong tiếng Tày – Nùng ở Cao Bằng là số 1, mang nghĩa nâng lên và phát triển).
- **Địa chỉ:** 075 tổ 10, P. Sông Hiến, Thục Phán, Cao Bằng.
- **Giờ mở cửa:** 7:00 — 22:00 hàng ngày.
- **Bản sắc:** Ngôi nhà vách đất, mái ngói truyền thống giữa vườn cây và hồ cá nhỏ. Thực đơn khai thác nguyên liệu bản địa Cao Bằng: **Mác kham**, **Hạt dẻ Cao Bằng**, **Thạch đen Cao Bằng**.

## Surfaces & Roles
1. **Customer Mobile-First PWA (`/`):**
   - Khách tại Cao Bằng mở bằng điện thoại (cài được như app PWA), duyệt thực đơn theo nhóm, tùy chọn món (size, đường, đá/nóng, topping +8k, ghi chú), nhập thông tin giao hàng, chọn VietQR BIDV hoặc tiền mặt COD, nhận mã đơn `NCxxxx` và dòng xác nhận `"Quán sẽ gọi lại xác nhận"`.
   - Phí ship quán tự gọi xác nhận và báo riêng.
2. **Shop Admin Dashboard (`/admin`):**
   - Chủ quán và nhân viên đăng nhập để theo dõi đơn realtime (WebSocket), xác nhận đã nhận tiền chuyển khoản, in lại phiếu, bật/tắt món hết hàng, bật/tắt chế độ `"Tạm nghỉ"`.
3. **Windows Shop Print & Voice Agent (`shop-agent/`):**
   - Chạy thường trực trên máy tính Windows ở quầy, kết nối WebSocket liên tục với server Railway:
     - Có đơn mới → phát chuông + đọc `"Đơn mới"` bằng tiếng Việt qua loa máy tính.
     - Tự động in phiếu nhiệt (có đủ mã đơn, món & tùy chọn, ghi chú, tên/SĐT/địa chỉ, tổng tiền, nổi bật `THU TIỀN MẶT` nếu COD).
     - Tự động nhận đơn, không cần bấm.
     - Mất mạng → khi có mạng lại tự in bù các đơn chưa in, chống in trùng hai lớp (DB `idempotency_key` + local atomic journal).
4. **Thông báo điện thoại chủ quán (ntfy):**
   - Server gửi push notification qua `ntfy` khi có đơn mới để chủ quán nắm bắt ngay cả khi không ngồi ở quầy.
5. **Nâng cấp tương lai:**
   - SePay Webhook tự động xác nhận chuyển khoản (đã chừa sẵn endpoint `/api/webhooks/sepay` và logic `confirmOrderPayment`).
   - Thông báo tiến độ đơn cho khách (chưa bật ở giai đoạn 1).
