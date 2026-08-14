const DEFAULT_HOST = "192.168.123.200:81";
const FALLBACK_HOSTS = ["esp32cam.local:81"];
const WAKE_INTERVAL_MS = 1500;
const WAKE_TIMEOUT_MS = 40000;
const WAKE_REQUEST_TIMEOUT_MS = 5000;
const FRAME_INTERVAL_MS = 180;
const FRAME_ERROR_LIMIT = 8;
const FRAME_STALE_MS = 5000;

let state = "idle";
let host = localStorage.getItem("camHost") || DEFAULT_HOST;

let pollTimer = null;
let watchdogTimer = null;
let consecutiveErrors = 0;
let lastFrameAt = 0;
let viewStartedAt = 0;

const el = {
  host: document.getElementById("host"),
  btn: document.getElementById("btn"),
  status: document.getElementById("status"),
  view: document.getElementById("view"),
  viewWrap: document.getElementById("view-wrap"),
  spinner: document.getElementById("spinner"),
};

el.host.value = host;
el.host.addEventListener("change", () => {
  host = el.host.value.trim();
  if (!host) host = DEFAULT_HOST;
  localStorage.setItem("camHost", host);
});

function camUrl(path, h) {
  return "http://" + (h || host) + path + "?t=" + Date.now();
}

function setStatus(msg, cls) {
  el.status.textContent = msg;
  el.status.className = "status" + (cls ? " " + cls : "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fire(path) {
  const img = new Image();
  img.src = camUrl(path);
}

function getCandidate(i) {
  const seen = [host];
  for (const h of FALLBACK_HOSTS) {
    if (seen.indexOf(h) === -1) seen.push(h);
  }
  return seen[i % seen.length];
}

function wakeOnce(h) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = "";
      resolve(false);
    }, WAKE_REQUEST_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = camUrl("/api/wake", h);
  });
}

async function wakeLoop() {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  let n = 0;
  while (Date.now() < deadline) {
    if (state !== "waking") return false;
    const attemptHost = getCandidate(n);
    if (await wakeOnce(attemptHost)) {
      if (attemptHost !== host) {
        host = attemptHost;
        localStorage.setItem("camHost", host);
        el.host.value = host;
      }
      return true;
    }
    n++;
    if (state !== "waking") return false;
    await sleep(WAKE_INTERVAL_MS);
  }
  return false;
}

function frameTick() {
  const img = el.view;
  img.onload = () => {
    consecutiveErrors = 0;
    lastFrameAt = Date.now();
    el.spinner.hidden = true;
  };
  img.onerror = frameFail;
  img.src = camUrl("/frame");
}

function watchdog() {
  const ref = lastFrameAt || viewStartedAt;
  if (Date.now() - ref > FRAME_STALE_MS) frameFail();
}

function frameFail() {
  if (state !== "viewing") return;
  consecutiveErrors++;
  if (consecutiveErrors >= FRAME_ERROR_LIMIT) {
    stopPolling();
    setStatus("Mất kết nối, đang đánh thức lại...", "warn");
    state = "idle";
    wakeAndView();
  }
}

function startViewing() {
  viewStartedAt = Date.now();
  lastFrameAt = 0;
  consecutiveErrors = 0;
  el.viewWrap.hidden = false;
  el.spinner.hidden = false;
  setStatus("Đang kết nối hình ảnh...");
  pollTimer = setInterval(frameTick, FRAME_INTERVAL_MS);
  watchdogTimer = setInterval(watchdog, 500);
  frameTick();
}

function stopPolling() {
  clearInterval(pollTimer);
  clearInterval(watchdogTimer);
  pollTimer = null;
  watchdogTimer = null;
}

function stopViewing() {
  stopPolling();
  state = "idle";
  el.viewWrap.hidden = true;
  el.spinner.hidden = true;
  el.view.removeAttribute("src");
  setStatus("Đã tắt. Camera sẽ chuyển sang ngủ.");
  updateButton();
  fire(camUrl("/api/sleep"));
}

function updateButton() {
  if (state === "waking") {
    el.btn.textContent = "Đang đánh thức...";
    el.btn.dataset.state = "waking";
    el.btn.disabled = true;
  } else if (state === "viewing") {
    el.btn.textContent = "Tắt camera";
    el.btn.dataset.state = "viewing";
    el.btn.disabled = false;
  } else {
    el.btn.textContent = "Xem camera";
    el.btn.dataset.state = "idle";
    el.btn.disabled = false;
  }
}

async function wakeAndView() {
  if (state !== "idle") return;
  state = "waking";
  updateButton();
  setStatus("Đang đánh thức camera...");

  const ok = await wakeLoop();
  if (state !== "waking") return;

  if (!ok) {
    state = "idle";
updateButton();

if ("serviceWorker" in navigator) {
  const isSecure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isSecure) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
    setStatus("Không đánh thức được camera. Kiểm tra nguồn, WiFi và địa chỉ.", "error");
    return;
  }

  state = "viewing";
  updateButton();
  startViewing();
}

el.btn.addEventListener("click", () => {
  if (state === "idle") {
    host = (el.host.value.trim() || DEFAULT_HOST);
    localStorage.setItem("camHost", host);
    wakeAndView();
  } else {
    stopViewing();
  }
});

updateButton();
