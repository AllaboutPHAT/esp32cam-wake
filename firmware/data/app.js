const DEFAULT_HOST = "192.168.123.200:81";
const FALLBACK_HOSTS = ["esp32cam.local:81"];
const WAKE_INTERVAL_MS = 1000;
const WAKE_TIMEOUT_MS = 40000;
const WAKE_REQUEST_TIMEOUT_MS = 2500;
const FRAME_TIMEOUT_MS = 2500;
const FRAME_ERROR_LIMIT = 8;

let state = "idle";
let host = localStorage.getItem("camHost") || DEFAULT_HOST;

let consecutiveErrors = 0;
let lastFrameAt = 0;
let viewStartedAt = 0;

const TUNE_DEFAULTS = { brightness: 2, ae: 0, gain: "32", q: 18, size: "vga", aec2: "0" };
let tune = loadTune();

function loadTune() {
  const merged = Object.assign({}, TUNE_DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem("camTune") || "null");
    if (saved && typeof saved === "object") {
      for (const k in merged) {
        if (saved[k] !== undefined) merged[k] = saved[k];
      }
    }
  } catch (e) {}
  return merged;
}

const el = {
  host: document.getElementById("host"),
  btn: document.getElementById("btn"),
  status: document.getElementById("status"),
  view: document.getElementById("view"),
  viewWrap: document.getElementById("view-wrap"),
  spinner: document.getElementById("spinner"),
  tBrightness: document.getElementById("t-brightness"),
  tBrightnessVal: document.getElementById("t-brightness-val"),
  tAe: document.getElementById("t-ae"),
  tAeVal: document.getElementById("t-ae-val"),
  tGain: document.getElementById("t-gain"),
  tQ: document.getElementById("t-q"),
  tQVal: document.getElementById("t-q-val"),
  tSize: document.getElementById("t-size"),
  tAec2: document.getElementById("t-aec2"),
  tReset: document.getElementById("t-reset"),
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

function readTuneFromUi() {
  tune.brightness = parseInt(el.tBrightness.value, 10);
  tune.ae = parseInt(el.tAe.value, 10);
  tune.gain = el.tGain.value;
  tune.q = parseInt(el.tQ.value, 10);
  tune.size = el.tSize.value;
  tune.aec2 = el.tAec2.checked ? "1" : "0";
}

function syncTuneToUi() {
  el.tBrightness.value = tune.brightness;
  el.tBrightnessVal.textContent = tune.brightness;
  el.tAe.value = tune.ae;
  el.tAeVal.textContent = tune.ae;
  el.tGain.value = tune.gain;
  el.tQ.value = tune.q;
  el.tQVal.textContent = tune.q;
  el.tSize.value = tune.size;
  el.tAec2.checked = tune.aec2 === "1";
}

function saveTune() {
  try {
    localStorage.setItem("camTune", JSON.stringify(tune));
  } catch (e) {}
}

function tuneUrl() {
  return "http://" + host + "/api/tune?brightness=" + tune.brightness +
    "&ae=" + tune.ae + "&gain=" + tune.gain + "&q=" + tune.q +
    "&size=" + tune.size + "&aec2=" + tune.aec2 + "&t=" + Date.now();
}

function applyTune() {
  try {
    fetch(tuneUrl(), { mode: "no-cors" }).catch(() => {});
  } catch (e) {}
}

function onTuneChange() {
  readTuneFromUi();
  saveTune();
  if (state === "viewing") applyTune();
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

function frameFail() {
  if (state !== "viewing") return;
  consecutiveErrors++;
  if (consecutiveErrors >= FRAME_ERROR_LIMIT) {
    setStatus("Mất kết nối, đang đánh thức lại...", "warn");
    state = "idle";
    wakeAndView();
    return;
  }
  setTimeout(() => {
    if (state !== "viewing") return;
    if (isMjpegSupported()) {
      el.view.removeAttribute("src");
      startMjpeg();
    } else {
      loopFrame();
    }
  }, 300);
}

function isMjpegSupported() {
  return !/iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function startMjpeg() {
  const img = el.view;
  img.onload = () => {
    consecutiveErrors = 0;
    lastFrameAt = Date.now();
  };
  img.onerror = frameFail;
  img.src = camUrl("/stream");
}

function loopFrame() {
  if (state !== "viewing") return;
  const img = el.view;
  let done = false;
  const timeout = setTimeout(() => {
    if (done) return;
    done = true;
    frameFail();
  }, FRAME_TIMEOUT_MS);

  img.onload = () => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    consecutiveErrors = 0;
    lastFrameAt = Date.now();
    el.spinner.hidden = true;
    loopFrame();
  };
  img.onerror = () => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    frameFail();
  };
  img.src = camUrl("/frame");
}

function startViewing() {
  viewStartedAt = Date.now();
  lastFrameAt = 0;
  consecutiveErrors = 0;
  el.viewWrap.hidden = false;
  el.spinner.hidden = true;
  setStatus("Đang kết nối hình ảnh...");
  applyTune();
  if (isMjpegSupported()) {
    startMjpeg();
  } else {
    el.spinner.hidden = false;
    loopFrame();
  }
}

function stopViewing() {
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

el.tBrightness.addEventListener("input", () => {
  el.tBrightnessVal.textContent = el.tBrightness.value;
  onTuneChange();
});
el.tAe.addEventListener("input", () => {
  el.tAeVal.textContent = el.tAe.value;
  onTuneChange();
});
el.tQ.addEventListener("input", () => {
  el.tQVal.textContent = el.tQ.value;
  onTuneChange();
});
el.tGain.addEventListener("change", onTuneChange);
el.tSize.addEventListener("change", onTuneChange);
el.tAec2.addEventListener("change", onTuneChange);
el.tReset.addEventListener("click", () => {
  tune = Object.assign({}, TUNE_DEFAULTS);
  syncTuneToUi();
  saveTune();
  if (state === "viewing") applyTune();
});

syncTuneToUi();
updateButton();
