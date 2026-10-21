// QR-Scanner über die Handykamera. Nutzt den eingebauten BarcodeDetector,
// wo es ihn gibt (Android/Chrome), sonst jsQR (z. B. iPhone/Safari).

window.startScanner = function ({ video, onCode, onError }) {
  let stream = null;
  let stopped = false;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const detector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;

  async function detect() {
    if (detector) {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue || null;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data || null;
  }

  async function loop() {
    if (stopped) return;
    try {
      const code = await detect();
      if (code) {
        stop();
        onCode(code);
        return;
      }
    } catch {}
    setTimeout(loop, 150);
  }

  function stop() {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" }, audio: false })
    .then((s) => {
      if (stopped) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      video.srcObject = s;
      video.setAttribute("playsinline", "");
      video.muted = true;
      return video.play().then(loop);
    })
    .catch(onError);

  return stop;
};

// Liest den Fahrzeugcode aus dem QR-Inhalt: entweder ein App-Link mit ?v=CODE
// oder direkt der Code selbst.
window.codeFromQr = function (text) {
  try {
    const v = new URL(text).searchParams.get("v");
    if (v) return v;
  } catch {}
  return text.trim();
};
