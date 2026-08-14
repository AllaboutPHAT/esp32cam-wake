# Camera giám sát ESP32-S3 — đánh thức theo yêu cầu

Camera an ninh gia đình dùng bo mạch **ESP32-S3 WROOM N16R8 CAM (OV3660)**.
Camera ngủ sâu (deep sleep) để tiết kiệm điện. Khi bạn bấm nút **Xem** trong
app, camera tự thức dậy trong vài giây và truyền hình ảnh về điện thoại.
Không cần server, không cần internet, tất cả chạy trong mạng wifi nhà bạn.

## Cách hoạt động

```
[Camera ESP32-S3]  --ngủ 5s-->  [thức dậy] --kết nối wifi 3-4s-->
   --lắng nghe 4s-->
       |  có ai gọi? --không-->  ngủ tiếp
       |  có: /api/wake -----------> bật camera, stream hình
[App trên điện thoại] --bấm "Xem"--> gọi /api/wake liên tục tới khi bắt được
   --xem hình ảnh /frame~5fps--> camera giữ thức cho tới khi bạn tắt
```

Độ trễ khi bấm "Xem" thường khoảng 2-6 giây (tối đa ~10 giây).

## Cấu trúc dự án

```
esp32cam/
├── firmware/            # Code ESP32-S3 (PlatformIO, Arduino)
│   └── src/main.cpp
└── app/                 # Web app PWA (xem trên điện thoại/máy tính)
    ├── index.html
    ├── app.js
    ├── style.css
    ├── serve.cmd        # Chạy app ngay trên máy tính
    └── icons/
```

## 1. Nạp firmware cho camera

Máy tính cần cài [PlatformIO](https://platformio.org) (máy này đã có).
Cắm board ESP32-S3 bằng cáp USB.

```powershell
cd firmware
python -m platformio run -t upload
```

### Cấu hình trong `firmware/src/main.cpp`

| Hằng số | Giá trị mặc định | Ý nghĩa |
|---|---|---|
| `WIFI_SSID` | `Nhat Phat` | Tên wifi nhà |
| `WIFI_PASS` | `12345678` | Mật khẩu wifi |
| `USE_STATIC_IP` | `true` | Dùng IP cố định (khuyên dùng, không phụ thuộc mDNS) |
| `LOCAL_IP` | `192.168.123.200` | IP cố định của camera (sửa theo mạng nhà bạn) |
| `GATEWAY` | `192.168.123.1` | IP modem/router |
| `LISTEN_WINDOW_MS` | `4000` | Thời gian lắng nghe mỗi lần thức dậy |
| `SLEEP_MS` | `3000` | Thời gian ngủ giữa 2 lần thức dậy (nhỏ hơn = khởi động nhanh hơn, tốn điện hơn) |
| `STREAM_IDLE_MS` | `20000` | Tự ngủ lại sau bao lâu không ai xem |
| `FRAME_SIZE` | `FRAMESIZE_VGA` | Độ phân giải ảnh (VGA cho fps cao; muốn nét hơn dùng `FRAMESIZE_SVGA`/`HD`) |
| `FRAME_QUALITY` | `18` | Chất lượng JPEG (nhỏ hơn = nét hơn, tốn dữ liệu hơn) |

Chân camera mặc định theo chuẩn bo ESP32-S3-CAM (SCCB: GPIO4/5, XCLK: GPIO15,
PCLK: GPIO13, VSYNC: GPIO6, HREF: GPIO7, D0-D7: GPIO11/9/8/10/12/18/17/16).
Nếu bo của bạn không ra ảnh, kiểm tra sơ đồ chân bo để sửa các hằng số
`Y2_GPIO_NUM ... Y9_GPIO_NUM`, `XCLK`, `PCLK`, `SIOD`, `SIOC`.

## 2. Tìm địa chỉ camera

Khi cắm board, mở Serial Monitor (bấm `python -m platformio device monitor`) để xem IP.
Camera cũng quảng bá tên mạng **`esp32cam.local`**. Cách khác: vào trang quản trị
của router, xem danh sách thiết bị kết nối.

> Dự án này đã đặt IP cố định `192.168.123.200` (mạng nhà `192.168.123.x`).
> Nếu mạng nhà bạn khác, sửa `LOCAL_IP` và `GATEWAY` trong `main.cpp` cho khớp.

## 3. Chạy app

### Cách 1 — trên máy tính (đơn giản nhất)

Chạy `app\serve.cmd` (hoặc `python -m http.server 8080` trong thư mục `app`).
Mở trình duyệt vào `http://localhost:8080`.

### Cách 2 — trên điện thoại

Điện thoại phải cùng mạng wifi với máy tính. Mở trình duyệt vào
`http://IP-MAY-TINH:8080` (IP hiện ra khi chạy `serve.cmd`).
Có thể dùng nút **"Thêm vào màn hình chính"** của trình duyệt để dùng như app.

### Cách 3 — copy file app sang điện thoại

Chép thư mục `app` vào điện thoại, mở `index.html` bằng trình duyệt.

### Địa chỉ camera trong app

Ở ô **"Địa chỉ camera"**, gõ:

- `192.168.123.200:81` (mặc định, IP cố định của camera — sửa theo mạng nhà bạn), hoặc
- `esp32cam.local:81` (tên mạng, tự tìm IP)

App tự động thử cả hai địa chỉ khi đánh thức.

## 4. Cách dùng

1. Bấm **Xem camera** — status hiện "Đang đánh thức camera...".
2. Sau vài giây camera bật và hình ảnh hiện ra (tự động làm mới ~5 khung/giây).
3. Bấm **Tắt camera** — camera ngủ lại sau vài giây.

Camera cũng tự ngủ sau 20 giây không ai xem.

## 5. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| "Không đánh thức được camera" | Kiểm tra nguồn cấp (5V riêng), đúng wifi trong firmware, đúng địa chỉ camera trong app |
| Không ra ảnh, màn hình đen | Kiểm tra chân camera đúng bo (xem ở trên), thử `FRAMESIZE_VGA` |
| Ảnh ngược/từ trên xuống | Đổi `SENSOR_VFLIP` / `SENSOR_HMIRROR` (0 hoặc 1) |
| Ảnh mờ | Giảm `FRAME_QUALITY` xuống (ví dụ 8) |
| Ảnh quá tối | Thêm đèn chiếu sáng chỗ camera, hoặc tăng `s->set_ae_level` trong `main.cpp` |
| Camera ngủ quá nhanh | Tăng `STREAM_IDLE_MS` |

## Chỉnh hình ảnh trong app

Trong app có mục **"Cài đặt hình ảnh"** (bấm mở ra):
- Độ sáng, mức phơi sáng, độ khuếch đại ánh sáng, độ nét, độ phân giải.
- Cài đặt được áp dụng ngay khi đang xem và được lưu lại cho lần sau.
- Camera tối phòng → tăng **Độ sáng** hoặc bật **Chế độ thiếu sáng** (ảnh sáng hơn
  nhưng fps giảm). Muốn fps cao hơn → giảm độ phân giải xuống QVGA.

Các cài đặt này gửi tới endpoint `GET /api/tune` trên camera. Bạn cũng có thể chỉnh
thẳng bằng trình duyệt, ví dụ: `http://192.168.123.200:81/api/tune?q=15&size=vga`.

## Tốc độ khung hình

Camera chụp ảnh VGA (640x480), nén JPEG, stream MJPEG ~12-15 khung/giây trong
mạng LAN. Nếu phòng tối, camera tự kéo dài phơi sáng nên fps giảm — hãy đảm bảo
đủ ánh sáng để đạt fps tối đa. App tự động dùng stream MJPEG trên máy tính/Android
(mượt), và dùng ảnh rời `/frame` trên iPhone.

## Bảo mật

App chỉ dùng được trong mạng wifi nhà. Ai cùng mạng đều có thể xem được.
Không bật chuyển tiếp cổng (port forwarding) trên router.

## Ghi chú nguồn điện

Board nên cấp nguồn 5V riêng (nguồn sạc điện thoại) cho ổn định, nhất là khi
dùng camera + wifi. Không nên cấp chung với nguồn nhiễu.
