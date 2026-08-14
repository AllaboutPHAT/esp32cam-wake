#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <esp_camera.h>
#include <esp_sleep.h>

const char *WIFI_SSID = "Nhat Phat";
const char *WIFI_PASS = "12345678";

const char *MDNS_HOSTNAME = "esp32cam";
const uint16_t HTTP_PORT = 81;

const bool USE_STATIC_IP = false;
IPAddress LOCAL_IP(192, 168, 1, 200);
IPAddress GATEWAY(192, 168, 1, 1);
IPAddress SUBNET(255, 255, 255, 0);

const unsigned long LISTEN_WINDOW_MS = 4000;
const unsigned long LISTEN_EXTEND_MS = 2000;
const unsigned long SLEEP_MS = 5000;
const unsigned long STREAM_IDLE_MS = 20000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;

const framesize_t FRAME_SIZE = FRAMESIZE_HD;
const uint8_t FRAME_QUALITY = 12;

const int SENSOR_VFLIP = 1;
const int SENSOR_HMIRROR = 0;

#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 15
#define SIOD_GPIO_NUM 4
#define SIOC_GPIO_NUM 5
#define Y9_GPIO_NUM 16
#define Y8_GPIO_NUM 17
#define Y7_GPIO_NUM 18
#define Y6_GPIO_NUM 12
#define Y5_GPIO_NUM 10
#define Y4_GPIO_NUM 8
#define Y3_GPIO_NUM 9
#define Y2_GPIO_NUM 11
#define VSYNC_GPIO_NUM 6
#define HREF_GPIO_NUM 7
#define PCLK_GPIO_NUM 13

enum Mode { LISTEN, STREAM };

Mode mode = LISTEN;
unsigned long listenDeadline = 0;
unsigned long lastFrameAt = 0;
bool cameraReady = false;

WebServer server(HTTP_PORT);

void goSleep();

void startListenWindow() {
  listenDeadline = millis() + LISTEN_WINDOW_MS;
  mode = LISTEN;
}

bool startCamera() {
  camera_config_t config;
  memset(&config, 0, sizeof(config));
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAME_SIZE;
  config.jpeg_quality = FRAME_QUALITY;
  config.fb_count = 2;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    cameraReady = false;
    Serial.printf("camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, FRAME_SIZE);
    s->set_quality(s, FRAME_QUALITY);
    s->set_vflip(s, SENSOR_VFLIP);
    s->set_hmirror(s, SENSOR_HMIRROR);
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
  }

  cameraReady = true;
  return true;
}

void touch() {
  if (mode == LISTEN) {
    listenDeadline = millis() + LISTEN_EXTEND_MS;
  }
}

void sendRaw(WiFiClient &c, const char *header, size_t bodyLen, const uint8_t *body) {
  c.print("HTTP/1.1 200 OK\r\n");
  c.print(header);
  c.print("Content-Length: ");
  c.print(bodyLen);
  c.print("\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n");
  if (bodyLen > 0 && body) {
    c.write(body, bodyLen);
  }
}

void handleWake() {
  bool ok = cameraReady;
  if (!ok) {
    ok = startCamera();
  }
  mode = STREAM;
  lastFrameAt = millis();
  WiFiClient c = server.client();
  c.print("HTTP/1.1 ");
  c.print(ok ? "200 OK" : "500 Camera Error");
  c.print("\r\nContent-Type: text/plain\r\nContent-Length: ");
  c.print(ok ? 5 : 6);
  c.print("\r\nConnection: close\r\n\r\n");
  c.print(ok ? "ready" : "error");
  if (ok) {
    Serial.println("wake -> streaming");
  }
}

void handleFrame() {
  touch();
  if (!cameraReady) {
    WiFiClient c = server.client();
    c.print("HTTP/1.1 503 Not Ready\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n");
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    WiFiClient c = server.client();
    c.print("HTTP/1.1 500 No Frame\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n");
    return;
  }

  WiFiClient c = server.client();
  sendRaw(c, "Content-Type: image/jpeg\r\n", fb->len, fb->buf);
  esp_camera_fb_return(fb);
  lastFrameAt = millis();
}

void handleSleep() {
  WiFiClient c = server.client();
  c.print("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbye");
  delay(50);
  goSleep();
}

void handleStatus() {
  touch();
  WiFiClient c = server.client();
  const char *msg = mode == STREAM ? "streaming" : "listening";
  c.print("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ");
  c.print(strlen(msg));
  c.print("\r\nConnection: close\r\n\r\n");
  c.print(msg);
}

void handleNotFound() {
  touch();
  WiFiClient c = server.client();
  c.print("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
}

void goSleep() {
  Serial.println("going to deep sleep");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_MS * 1000ULL);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("boot");
  Serial.printf("PSRAM total: %u bytes, free heap: %u\n", ESP.getPsramSize(), ESP.getFreeHeap());

  WiFi.mode(WIFI_STA);
  if (USE_STATIC_IP) {
    WiFi.config(LOCAL_IP, GATEWAY, SUBNET);
  }
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_CONNECT_TIMEOUT_MS) {
    delay(100);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("wifi failed");
    goSleep();
  }

  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  MDNS.begin(MDNS_HOSTNAME);
  MDNS.addService("http", "tcp", HTTP_PORT);

  server.on("/api/wake", HTTP_GET, handleWake);
  server.on("/frame", HTTP_GET, handleFrame);
  server.on("/api/sleep", HTTP_GET, handleSleep);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.onNotFound(handleNotFound);
  server.begin();

  startListenWindow();
}

void loop() {
  server.handleClient();

  if (mode == STREAM) {
    if ((long)(millis() - lastFrameAt) >= (long)STREAM_IDLE_MS) {
      goSleep();
    }
  } else if (mode == LISTEN) {
    if ((long)(millis() - listenDeadline) >= 0) {
      goSleep();
    }
  }
}
