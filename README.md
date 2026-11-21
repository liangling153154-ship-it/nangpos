# Nâng Café (Cao Bằng) — Hệ thống Web Đặt Ship, Máy In Phiếu & Thông Báo

Hệ thống đặt ship đồ uống hoàn chỉnh dành riêng cho **Nâng Café** (*075 tổ 10, P. Sông Hiến, Thục Phán, Cao Bằng*), gồm 3 thành phần chạy đồng bộ:

1. **Web khách hàng (`/`) — Mobile-First PWA**: Xem menu theo nhóm, món hết hàng hiện mờ, chọn tùy chọn (vị, size M/L, mức đá/nóng, mức đường, topping +8k, ghi chú), giỏ hàng, thanh toán **VietQR BIDV** hoặc **Tiền mặt (COD)**, nhận mã đơn `NCxxxx` và thông báo *"Quán sẽ gọi lại xác nhận"*. Cài được lên màn hình chính điện thoại như app.
2. **Server & Trang quản lý (`/admin`) — Railway + PostgreSQL**: Lưu đơn, cấp mã `NC1234`, tạo mã **VietQR chuẩn EMVCo/NAPAS** (tài khoản BIDV Hộ kinh doanh Nâng Café), đẩy đơn realtime qua **WebSocket**, gửi thông báo **ntfy** sang điện thoại chủ quán, và có sẵn endpoint `/api/webhooks/sepay` để gắn **SePay** sau này.
3. **Ứng dụng Máy tính quán (`shop-agent/`) — Windows**: Chạy tự động khi mở máy Windows, kết nối WebSocket với Railway. Khi có đơn mới tự phát **chuông + đọc "Đơn mới" bằng tiếng Việt**, tự **in phiếu nhiệt** (ghi rõ `THU TIỀN MẶT` nếu là đơn COD), tự nhận đơn không cần bấm. Khi mất mạng và có mạng trở lại sẽ **tự in bù các đơn chưa in và chống in trùng tuyệt đối**.

---

## Kiến trúc thư mục

```text
├── shared/          # Kiểu dữ liệu dùng chung (TypeScript)
├── server/          # Express + WebSocket + PostgreSQL + VietQR + ntfy + SePay stub
├── client/          # React + Vite Mobile-First PWA (/) & Trang quản lý (/admin)
├── shop-agent/      # Ứng dụng chạy trên máy tính Windows ở quán (in nhiệt + loa)
├── tests/           # Kịch bản test tự động toàn bộ luồng (e2e-flow.mjs)
├── railway.json     # Cấu hình build/deploy Railway
└── .env.example     # Mẫu biến môi trường (không chứa thông tin nhạy cảm)
```

---

## 1. Hướng dẫn Deploy lên Railway (kèm PostgreSQL)

### Bước 1: Đưa mã nguồn lên GitHub
Tạo một repository **Private** trên GitHub và push toàn bộ thư mục dự án lên (file `.env` đã nằm trong `.gitignore`, tuyệt đối không push `.env`).

### Bước 2: Tạo Project trên Railway
1. Vào [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → chọn repo vừa tạo.
2. Trong cùng Project, bấm **+ New** → **Database** → **Add PostgreSQL**.
3. Chọn service Web App → tab **Variables** → bấm **New Variable** và điền đầy đủ các biến môi trường sau:

| Biến môi trường | Ví dụ / Giá trị | Giải thích |
|---|---|---|
| `NODE_ENV` | `production` | Bật chế độ production & cookie bảo mật HTTPS |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Tham chiếu trực tiếp tới PostgreSQL vừa thêm trên Railway |
| `PUBLIC_URL` | `https://nangcafe.up.railway.app` | Domain công khai của web (dùng để bấm mở nhanh từ ntfy) |
| `ADMIN_USERNAME` | `admin` | Tên đăng nhập trang `/admin` |
| `ADMIN_PASSWORD` | `MatKhauManh@2026` | Mật khẩu đăng nhập trang `/admin` |
| `SESSION_SECRET` | *(chuỗi ngẫu nhiên ≥ 32 ký tự)* | Ký cookie phiên đăng nhập quản trị |
| `SHOP_AGENT_SECRET` | *(chuỗi ngẫu nhiên ≥ 24 ký tự)* | Mã bảo mật kết nối giữa máy tính quán và server |
| `VIETQR_BANK_BIN` | `970418` | Mã BIN ngân hàng BIDV |
| `VIETQR_BANK_NAME` | `BIDV - CN Cao Bằng` | Tên ngân hàng hiển thị cho khách |
| `VIETQR_ACCOUNT_NO` | `8849xxxxxx` | Số tài khoản BIDV Hộ kinh doanh Nâng Café |
| `VIETQR_ACCOUNT_NAME` | `HO KINH DOANH NANG CAFE` | Tên chủ tài khoản |
| `NTFY_BASE_URL` | `https://ntfy.sh` | Máy chủ ntfy |
| `NTFY_TOPIC` | `nang-cafe-cb-9x7k2m4p` | Tên topic bí mật (đặt ngẫu nhiên khó đoán) |
| `NTFY_TOKEN` | *(để trống nếu dùng ntfy công khai)* | Bearer token nếu bạn dùng topic bảo mật |
| `PRINT_UNPAID_TRANSFER` | `false` | `false`: chỉ in đơn chuyển khoản sau khi chủ quán xác nhận đã nhận tiền (đơn COD luôn in ngay). Đặt `true` nếu muốn in ngay cả khi chưa xác nhận tiền. |
| `SEPAY_WEBHOOK_SECRET` | *(để trống)* | Điền API Key khi nâng cấp gắn SePay tự động xác nhận tiền |

4. Vào tab **Settings** → **Networking** → bấm **Generate Domain** để lấy đường dẫn HTTPS (hoặc gắn domain riêng như `order.nangcafe.vn`), sau đó cập nhật lại biến `PUBLIC_URL`.
5. Railway sẽ tự chạy `npm run install:all && npm run build` rồi khởi động `npm run start`. Khi server khởi động lần đầu, các bảng PostgreSQL và toàn bộ thực đơn Nâng Café sẽ tự động được tạo và nạp sẵn.

---

## 2. Cấu hình thông báo ntfy sang điện thoại chủ quán

1. Cài ứng dụng **ntfy** miễn phí trên điện thoại:
   - **Android**: Google Play Store → tìm `ntfy` (hoặc F-Droid).
   - **iPhone (iOS)**: App Store → tìm `ntfy`.
2. Mở app **ntfy** → bấm dấu **`+`** (Subscribe to topic).
3. Nhập **đúng tên topic** đã đặt trong biến `NTFY_TOPIC` trên Railway (ví dụ: `nang-cafe-cb-9x7k2m4p`) → bấm **Subscribe**.
   > **Lưu ý bảo mật:** Trên `ntfy.sh`, bất kỳ ai biết tên topic đều có thể nghe thông báo, vì vậy hãy đặt tên topic dài và có ký tự ngẫu nhiên (ví dụ `nang-cafe-cb-7h4k9p2m`).
4. Vào trang quản lý `https://<domain-cua-ban>/admin` → tab **Trạng thái quán & Máy in** → bấm **Gửi thử thông báo ntfy** để kiểm tra điện thoại có rung và hiện thông báo ngay không.

---

## 3. Hướng dẫn cài đặt trên Máy tính ở quán (Windows)

Máy tính ở quán cần cài **Node.js 20 trở lên** ([nodejs.org](https://nodejs.org) — tải bản LTS).

### Bước 1: Tải thư mục `shop-agent` và cài thư viện
1. Copy thư mục dự án (hoặc tối thiểu các thư mục `shop-agent/` và `shared/`) về máy tính quán, ví dụ tại `C:\NangCafe\`.
2. Mở **Command Prompt** hoặc **PowerShell** tại thư mục `C:\NangCafe\shop-agent` và chạy:
   ```powershell
   npm.cmd install
   npm.cmd run build
   ```

### Bước 2: Cấu hình máy in & kết nối server
1. Sao chép file `shop-agent\.env.example` thành `shop-agent\.env`.
2. Tìm tên chính xác máy in nhiệt trong Windows bằng lệnh PowerShell:
   ```powershell
   Get-Printer | Select-Object Name
   ```
   *(Ví dụ: `XP-80C`, `POS-58`, `EPSON TM-T82`)*
3. Mở file `shop-agent\.env` bằng Notepad và điền:
   ```env
   SERVER_URL=https://ten-app-cua-ban.up.railway.app
   SHOP_AGENT_SECRET=trung_khop_voi_SHOP_AGENT_SECRET_tren_Railway

   # Dùng driver Windows (khuyên dùng cho máy in USB, in tiếng Việt có dấu sắc nét 100%)
   PRINTER_MODE=windows
   PRINTER_NAME=XP-80C
   PRINTER_PAPER_MM=80

   # Bật chuông + giọng đọc tiếng Việt "Đơn mới"
   AUDIO_ENABLED=true
   ```
   - Nếu máy in kết nối qua **cáp mạng LAN** (IP tĩnh, cổng `9100`), đổi `PRINTER_MODE=escpos-tcp` và điền `PRINTER_HOST=192.168.1.200`.
   - Nếu máy dùng giấy khổ nhỏ 58mm, đổi `PRINTER_PAPER_MM=58`.

### Bước 3: Kiểm tra Loa và Máy in trước khi bán hàng
Chạy lần lượt 2 lệnh sau trong `shop-agent`:
```powershell
# 1. Kiểm tra loa: phải nghe tiếng chuông + giọng tiếng Việt đọc "Đơn mới"
npm.cmd run test:audio

# 2. Kiểm tra máy in nhiệt: in ra 1 phiếu mẫu NC8888 (có dòng THU TIỀN MẶT)
npm.cmd run test:print
```
- **Lưu ý về loa:** Cắm loa ngoài vào máy tính quán, bật âm lượng Windows lên 80–100%, tắt chế độ *Sleep/Ngủ đông* trong Windows Power Settings (`Settings → System → Power & sleep → Screen / Sleep = Never`) để máy luôn thức nhận đơn.
- **Không cần cài gói ngôn ngữ tiếng Việt cho Windows**: `shop-agent` đã đóng gói sẵn file âm thanh chuông (`chime.wav`) và giọng đọc tiếng Việt tự nhiên (`alert-don-moi.wav`) chạy offline 100% qua loa Windows.

### Bước 4: Cài tự động chạy khi khởi động Windows
Mở PowerShell tại `C:\NangCafe\shop-agent` và chạy:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
```
Script sẽ tạo shortcut vào thư mục **Startup** của Windows. Từ lần mở máy sau, `start-shop-agent.bat` sẽ tự khởi động thu nhỏ dưới thanh Taskbar và tự hồi phục nếu mất điện/mất mạng.
- Để chạy ngay lập tức không cần khởi động lại máy: bấm đúp file `shop-agent\start-shop-agent.bat`.
- Để gỡ tự khởi động: `powershell -ExecutionPolicy Bypass -File .\install-startup.ps1 -Uninstall`.

### Cơ chế xử lý khi mất mạng (In bù & Không in trùng)
- Mỗi đơn cần in được server lưu vào bảng PostgreSQL `print_jobs` với khóa chống trùng `idempotency_key` (`initial:NC1234`).
- Khi máy tính quán mất mạng, các đơn mới vẫn được lưu trên Railway và gửi ntfy tới điện thoại chủ quán.
- Ngay khi máy tính quán có mạng lại, `shop-agent` tự kết nối lại WebSocket, kéo toàn bộ phiếu đang chờ (`pending`) và in bù theo thứ tự thời gian.
- Đồng thời, `shop-agent` lưu nhật ký cục bộ (`shop-agent/data/printed-jobs.json`) trước khi gửi xác nhận `ACK` lên server. Dù mạng rớt ngay khoảnh khắc vừa in xong, lần kết nối lại sẽ **không bao giờ in trùng** phiếu cũ.
- Khi chủ quán bấm **In lại phiếu** trên `/admin`, server tạo một lệnh in riêng (`reprint`) có đánh dấu `*** BẢN IN LẠI ***` trên đầu phiếu.

---

## 4. Hướng dẫn gắn SePay tự động xác nhận chuyển khoản (Nâng cấp sau)

Code đã chừa sẵn endpoint **`POST /api/webhooks/sepay`** dùng chung hàm `confirmOrderPayment()` với nút xác nhận thủ công:

1. Đăng ký tài khoản [SePay](https://sepay.vn) và liên kết tài khoản BIDV Hộ kinh doanh Nâng Café.
2. Trên Railway → **Variables**, thêm biến `SEPAY_WEBHOOK_SECRET` (một chuỗi bí mật tự chọn).
3. Trong SePay Dashboard → **Webhooks** → tạo webhook mới:
   - **URL**: `https://<domain-cua-ban>/api/webhooks/sepay`
   - **Kiểu chứng thực**: `API Key` → dán đúng giá trị `SEPAY_WEBHOOK_SECRET` (SePay gửi header `Authorization: Apikey <secret>`).
   - **Sự kiện**: Giao dịch tiền vào (`transferType = "in"`).
4. Khi khách quét VietQR chuyển đúng số tiền và nội dung `NCxxxx`, hệ thống sẽ tự chuyển đơn sang **Đã nhận tiền**, đẩy phiếu xuống máy in quán, cập nhật màn hình khách và gửi thông báo ntfy!

---

## 5. Chạy thử & Test tự động trên máy cục bộ (Dev)

Không cần cài PostgreSQL cục bộ — khi để trống `DATABASE_URL`, server tự chạy PostgreSQL nhúng (**PGlite**) tại `./data/pgdata`:

```powershell
# 1. Cài dependencies cho cả 3 phần
npm.cmd run install:all

# 2. Tạo file .env từ mẫu (chỉnh sửa các giá trị theo ý bạn)
copy .env.example .env

# 3. Build toàn bộ hệ thống
npm.cmd run build
npm.cmd run build:agent

# 4. Chạy kịch bản test tự động toàn bộ luồng:
#    Đặt đơn COD & VietQR -> WebSocket -> ntfy -> Máy tính quán in phiếu ->
#    Mất mạng & in bù không trùng -> In lại -> Hết hàng -> Tạm nghỉ -> SePay webhook
npm.cmd run test:e2e
```
