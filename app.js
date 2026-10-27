const cfg = window.APP_CONFIG;
const store = window.createStore();

const modeEl = document.getElementById("mode");
modeEl.textContent = store.mode === "shared" ? "Live" : "Demo";
modeEl.classList.toggle("shared", store.mode === "shared");
modeEl.title = store.mode === "shared" ? "Gemeinsame Daten für alle" : "Demo-Modus: Daten bleiben nur auf diesem Gerät";

// --- Karte ---------------------------------------------------------------

// Lageplan-Bild und seine Lage auf der Karte (Ecken oben links, oben rechts, unten links).
// Die Grenze ist im Bild als Pixel-Polygon hinterlegt und wird daraus in Koordinaten umgerechnet.
const PLAN = cfg.PLAN;
const planLL = (u, v) => [
  PLAN.tl[0] + (u / PLAN.size[0]) * (PLAN.tr[0] - PLAN.tl[0]) + (v / PLAN.size[1]) * (PLAN.bl[0] - PLAN.tl[0]),
  PLAN.tl[1] + (u / PLAN.size[0]) * (PLAN.tr[1] - PLAN.tl[1]) + (v / PLAN.size[1]) * (PLAN.bl[1] - PLAN.tl[1]),
];
const boundary = PLAN.boundary.map(([u, v]) => planLL(u, v));
const siteBounds = L.latLngBounds([planLL(0, 0), planLL(PLAN.size[0], 0), planLL(0, PLAN.size[1]), planLL(PLAN.size[0], PLAN.size[1])]);

const map = L.map("map", {
  zoomControl: true,
  maxBounds: siteBounds.pad(0.15),
  maxBoundsViscosity: 1,
  zoomSnap: 0.25,
});

const satellite = L.layerGroup([
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution: "Bilder &copy; Esri, Maxar, Earthstar Geographics",
  }),
  L.polygon(boundary, { color: "#e5322d", weight: 3, fill: false, interactive: false }),
]);
const planLayer = L.imageOverlay.rotated(PLAN.image, L.latLng(PLAN.tl), L.latLng(PLAN.tr), L.latLng(PLAN.bl), { interactive: false });
const planView = L.layerGroup([planLayer]);

let baseName = "Satellit";
try { baseName = localStorage.getItem("qr-fahrzeuge-karte") || baseName; } catch {}
(baseName === "Lageplan" ? planView : satellite).addTo(map);
L.control.layers({ Satellit: satellite, Lageplan: planView }, {}, { collapsed: false, position: "topright" }).addTo(map);
map.on("baselayerchange", (e) => {
  document.getElementById("map").classList.toggle("plan-mode", e.name === "Lageplan");
  try { localStorage.setItem("qr-fahrzeuge-karte", e.name); } catch {}
});
document.getElementById("map").classList.toggle("plan-mode", baseName === "Lageplan");

// Nicht weiter herauszoomen, als das Gelände braucht
function fitSite() {
  const z = map.getBoundsZoom(siteBounds, false, L.point(16, 16));
  map.setMinZoom(z);
  return z;
}
map.setView(siteBounds.getCenter(), 16);
map.fitBounds(siteBounds, { padding: [8, 8] });
fitSite();
map.on("resize", fitSite);

const vehicleLayer = L.layerGroup().addTo(map);

let vehicles = [];
const markers = {}; // vehicle_id -> Leaflet-Marker

const fmtTime = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const fmtSource = (p) => (p.source === "manual" ? "von Hand gesetzt" : "GPS" + (p.accuracy ? ` ±${Math.round(p.accuracy)} m` : ""));

function popupContent(v, p) {
  const el = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = v.name;
  const meta = document.createElement("div");
  meta.textContent = [fmtTime(p.created_at), fmtSource(p), p.created_by].filter(Boolean).join(" · ");
  const actions = document.createElement("div");
  actions.className = "popup-actions";
  for (const [label, fn] of [["Verlauf", () => showHistory(v)], ["Teilen", () => shareVehicle(v, p)]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    actions.append(b);
  }
  el.append(title, meta, actions);
  return el;
}

// --- Seitenleiste für Verlauf und Teilen -----------------------------------

const panelEl = document.getElementById("panel");
let panelLayer = L.layerGroup().addTo(map);

function openPanel(title, ...nodes) {
  document.getElementById("panel-title").textContent = title;
  document.getElementById("panel-body").replaceChildren(...nodes);
  panelLayer.clearLayers();
  map.closePopup();
  panelEl.hidden = false;
}
function closePanel() {
  panelEl.hidden = true;
  panelLayer.clearLayers();
}
document.getElementById("panel-close").addEventListener("click", closePanel);

// Verlauf: letzte Meldungen, ein Tipp zeigt den damaligen Platz auf der Karte
async function showHistory(v) {
  const list = document.createElement("ol");
  list.className = "history";
  list.textContent = "Lade …";
  openPanel(`Verlauf ${v.name}`, list);
  try {
    const rows = await store.history(v.id);
    list.replaceChildren(
      ...rows.map((p, i) => {
        const li = document.createElement("li");
        const when = document.createElement("strong");
        when.textContent = fmtTime(p.created_at) + (i === 0 ? " (aktuell)" : "");
        const who = document.createElement("small");
        who.textContent = [p.created_by || "unbekannt", fmtSource(p)].join(" · ");
        li.append(when, who);
        li.addEventListener("click", () => {
          list.querySelectorAll(".active").forEach((x) => x.classList.remove("active"));
          li.classList.add("active");
          panelLayer.clearLayers();
          L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#8250df", fillOpacity: 1 })
            .bindTooltip(fmtTime(p.created_at), { permanent: true, direction: "right", offset: [8, 0], className: "vlabel" })
            .addTo(panelLayer);
          map.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
        });
        return li;
      })
    );
    if (!rows.length) list.textContent = "Noch keine Meldungen.";
  } catch (err) {
    list.textContent = "Verlauf nicht verfügbar: " + err.message;
  }
}

// Teilen: ein Kartenausschnitt mit dem Fahrzeug als Bild und der Link in die App.
// Das Bild wird zuerst als Vorschau gebaut; "Senden" ruft dann das Teilen-Menü des
// Handys direkt per Tipp auf (iPhone verlangt das), dort sind WhatsApp und Teams dabei.
function appLink(v) {
  const u = new URL("./", location.href);
  u.searchParams.set("f", v.code);
  return u.href;
}

const SNAP_W = 800, SNAP_H = 600, SNAP_ZOOM = 18;
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Bild nicht geladen: " + src));
  img.src = src;
});

// Zeichnet den Ausschnitt um das Fahrzeug, als Satellitenbild oder als Lageplan
async function snapshot(v, p, usePlan) {
  const canvas = document.createElement("canvas");
  canvas.width = SNAP_W;
  canvas.height = SNAP_H;
  const ctx = canvas.getContext("2d");
  const c = map.project([p.lat, p.lng], SNAP_ZOOM);
  const origin = c.subtract([SNAP_W / 2, SNAP_H / 2]);
  const px = (ll) => map.project(ll, SNAP_ZOOM).subtract(origin);

  if (usePlan) {
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, 0, SNAP_W, SNAP_H);
    const img = await loadImage(PLAN.image);
    const [tl, tr, bl] = [px(PLAN.tl), px(PLAN.tr), px(PLAN.bl)];
    const [w, h] = PLAN.size;
    ctx.setTransform((tr.x - tl.x) / w, (tr.y - tl.y) / w, (bl.x - tl.x) / h, (bl.y - tl.y) / h, tl.x, tl.y);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const x0 = Math.floor(origin.x / 256), x1 = Math.floor((origin.x + SNAP_W) / 256);
    const y0 = Math.floor(origin.y / 256), y1 = Math.floor((origin.y + SNAP_H) / 256);
    const jobs = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const src = TILE_URL.replace("{z}", SNAP_ZOOM).replace("{x}", x).replace("{y}", y);
        jobs.push(loadImage(src).then((img) => ctx.drawImage(img, x * 256 - origin.x, y * 256 - origin.y)));
      }
    }
    await Promise.all(jobs);
    ctx.strokeStyle = "#e5322d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    boundary.forEach((ll, i) => {
      const q = px(ll);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // Fahrzeug-Punkt mit Beschriftung
  const cx = SNAP_W / 2, cy = SNAP_H / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = "#1f6feb";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.font = "bold 24px system-ui, sans-serif";
  const label = v.name;
  const lw = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(cx + 22, cy - 18, lw + 20, 36);
  ctx.fillStyle = "#1b1f24";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx + 32, cy);

  // Fußzeile mit Zeitpunkt und Melder
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, SNAP_H - 44, SNAP_W, 44);
  ctx.fillStyle = "#fff";
  ctx.font = "20px system-ui, sans-serif";
  ctx.fillText([fmtTime(p.created_at), p.created_by].filter(Boolean).join(" · "), 14, SNAP_H - 22);

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht erzeugt werden"))), "image/jpeg", 0.85));
  return new File([blob], `Standort-${v.name.replace(/[^\w-]+/g, "_")}.jpg`, { type: "image/jpeg" });
}

async function shareVehicle(v, p) {
  const link = appLink(v);
  const body = document.createElement("div");
  body.className = "share";
  body.textContent = "Bild wird erstellt …";
  openPanel(`${v.name} teilen`, body);

  // Satellitenbild, falls die Karte gerade so steht; klappt das nicht, der Lageplan
  let file = null;
  try {
    file = await snapshot(v, p, map.hasLayer(planView));
  } catch {
    try { file = await snapshot(v, p, true); } catch {}
  }

  const button = (label, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", fn);
    return b;
  };
  const nodes = [];
  if (file) {
    const img = document.createElement("img");
    img.className = "share-preview";
    img.alt = `Kartenausschnitt ${v.name}`;
    img.src = URL.createObjectURL(file);
    nodes.push(img);
  }
  const withFile = file && navigator.canShare?.({ files: [file] });
  if (navigator.share) {
    nodes.push(button("Senden (WhatsApp, Teams …)", "primary", async () => {
      try {
        await navigator.share(withFile ? { files: [file], text: link } : { text: link });
      } catch (err) {
        if (err.name !== "AbortError") alert("Teilen nicht möglich: " + err.message);
      }
    }));
  }
  if (file && !withFile) {
    nodes.push(button("Bild speichern", "", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
    }));
  }
  const copy = button("Link kopieren", "", async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = "Link kopiert";
    } catch {
      copy.textContent = link;
    }
  });
  nodes.push(copy);
  body.replaceChildren(...nodes);
}

async function renderVehicles() {
  const [list, positions] = await Promise.all([store.listVehicles(), store.latestPositions()]);
  vehicles = list;
  const byId = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  for (const k of Object.keys(markers)) delete markers[k];
  for (const p of positions) {
    const v = byId[p.vehicle_id];
    if (!v) continue;
    markers[v.id] = L.circleMarker([p.lat, p.lng], { radius: 9, color: "#fff", weight: 2, fillColor: "#1f6feb", fillOpacity: 1 })
      .bindPopup(popupContent(v, p))
      .bindTooltip(v.name, { permanent: true, direction: "right", offset: [8, 0], className: "vlabel" });
  }
  showVehicle(shownId, false);
}

// Normalerweise steht nur das gesuchte (oder gerade erfasste) Fahrzeug auf der Karte,
// mit "Alle" unten alle Fahrzeuge auf einmal
let shownId = null;
let showAll = false;
try { showAll = localStorage.getItem("qr-fahrzeuge-alle") === "1"; } catch {}

function showVehicle(id, focus = true) {
  shownId = id;
  vehicleLayer.clearLayers();
  if (showAll) Object.values(markers).forEach((m) => m.addTo(vehicleLayer));
  const m = id && markers[id];
  if (!m) return;
  m.addTo(vehicleLayer);
  if (focus) {
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 18));
    m.openPopup();
  }
}

const allBtn = document.getElementById("btn-all");
function updateAllBtn() {
  allBtn.classList.toggle("on", showAll);
  allBtn.setAttribute("aria-pressed", showAll);
}
updateAllBtn();
allBtn.addEventListener("click", () => {
  showAll = !showAll;
  try { localStorage.setItem("qr-fahrzeuge-alle", showAll ? "1" : "0"); } catch {}
  updateAllBtn();
  showVehicle(shownId, false);
});

// --- Eigener Standort ----------------------------------------------------

let meMarker = null;
document.getElementById("btn-locate").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Dieses Gerät kann keinen Standort liefern.");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const ll = [coords.latitude, coords.longitude];
      if (meMarker) meMarker.remove();
      meMarker = L.circle(ll, { radius: coords.accuracy, color: "#1a7f37", weight: 2, fillOpacity: 0.15 }).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), 18));
    },
    (err) => alert(err.code === err.PERMISSION_DENIED
      ? "Standortzugriff verweigert. Bitte in den Einstellungen des Handys bzw. Browsers den Standort für diese Seite erlauben."
      : "Standort nicht verfügbar: " + err.message),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

// --- Suche --------------------------------------------------------------

const searchEl = document.getElementById("search");
const resultsEl = document.getElementById("search-results");

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) showVehicle(null);
  const hits = q
    ? vehicles.filter((v) => [v.name].some((f) => f && f.toLowerCase().includes(q))).slice(0, 20)
    : [];
  resultsEl.replaceChildren(
    ...hits.map((v) => {
      const li = document.createElement("li");
      li.textContent = v.name;
      const small = document.createElement("small");
      small.textContent = markers[v.id] ? "" : "noch kein Standort";
      if (small.textContent) li.append(small);
      li.addEventListener("click", () => {
        resultsEl.hidden = true;
        searchEl.value = v.name;
        searchEl.blur();
        showVehicle(v.id);
      });
      return li;
    })
  );
  resultsEl.hidden = !hits.length;
});

// --- Scannen und Standort erfassen ---------------------------------------

const scannerEl = document.getElementById("scanner");
const captureEl = document.getElementById("capture");
const captureStatus = document.getElementById("capture-status");
let stopScan = null;
let capture = null; // { vehicle, marker, accuracy, moved }

document.getElementById("btn-scan").addEventListener("click", () => {
  if (!navigator.mediaDevices?.getUserMedia) return alert("Dieser Browser kann nicht auf die Kamera zugreifen.");
  scannerEl.hidden = false;
  stopScan = startScanner({
    video: document.getElementById("scan-video"),
    onCode: (text) => {
      scannerEl.hidden = true;
      beginCapture(codeFromQr(text));
    },
    onError: (err) => {
      scannerEl.hidden = true;
      alert("Kamera nicht verfügbar: " + err.message);
    },
  });
});

document.getElementById("scan-close").addEventListener("click", () => {
  stopScan?.();
  scannerEl.hidden = true;
});

async function beginCapture(code) {
  if (!vehicles.length) await renderVehicles();
  const vehicle = vehicles.find((v) => v.code === code);
  if (!vehicle) return alert(`Unbekannter Code "${code}". Ist das Fahrzeug unter QR-Etiketten angelegt?`);

  endCapture();
  closePanel();
  const marker = L.marker(map.getCenter(), { draggable: true, autoPan: true }).addTo(map);
  capture = { vehicle, marker, accuracy: null, moved: false };
  marker.on("dragend", () => {
    stopGps();
    capture.moved = true;
    captureStatus.textContent = "Von Hand verschoben.";
  });
  document.getElementById("capture-title").textContent = vehicle.name;
  captureEl.hidden = false;
  locateForCapture();
}

// GPS bis zu 10 Sekunden messen und die besten Werte nehmen: Die erste Messung ist oft
// ungenau. Messungen nahe der besten werden nach Genauigkeit gewichtet gemittelt.
const GPS_SECONDS = 10;
const GPS_GOOD_ENOUGH = 5; // Meter: früher aufhören, wenn so genau

let gpsWatch = null;
let gpsTimer = null;

function stopGps() {
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  clearInterval(gpsTimer);
  gpsWatch = gpsTimer = null;
}

function locateForCapture() {
  if (!capture) return;
  stopGps();
  capture.moved = false;
  if (!navigator.geolocation) {
    captureStatus.textContent = "Kein GPS. Bitte den Marker auf den Stellplatz ziehen.";
    return;
  }
  const readings = [];
  const started = Date.now();
  let centered = false;

  const best = () => {
    const minAcc = Math.min(...readings.map((r) => r.acc));
    const use = readings.filter((r) => r.acc <= minAcc * 1.5);
    const w = use.map((r) => 1 / (r.acc * r.acc));
    const sum = w.reduce((x, y) => x + y, 0);
    return {
      lat: use.reduce((x, r, i) => x + r.lat * w[i], 0) / sum,
      lng: use.reduce((x, r, i) => x + r.lng * w[i], 0) / sum,
      acc: minAcc,
    };
  };

  const show = (done) => {
    if (!capture) return;
    const left = Math.max(0, GPS_SECONDS - Math.round((Date.now() - started) / 1000));
    if (!readings.length) {
      captureStatus.textContent = `GPS-Position wird ermittelt … (${left} s)`;
      return;
    }
    const b = best();
    if (!capture.moved) {
      capture.marker.setLatLng([b.lat, b.lng]);
      capture.accuracy = b.acc;
      if (!centered) {
        map.setView([b.lat, b.lng], Math.max(map.getZoom(), 18));
        centered = true;
      }
    }
    captureStatus.textContent = done
      ? `GPS-Genauigkeit etwa ${Math.round(b.acc)} m.` + (b.acc > 15 ? " Bei Bedarf den Marker auf den richtigen Platz ziehen." : "")
      : `Messe GPS … etwa ${Math.round(b.acc)} m (noch ${left} s, du kannst schon speichern)`;
  };

  const finish = () => {
    stopGps();
    if (!capture || capture.moved) return;
    if (readings.length) show(true);
    else captureStatus.textContent = "GPS nicht verfügbar. Bitte den Marker auf den Stellplatz ziehen.";
  };

  captureStatus.textContent = `GPS-Position wird ermittelt … (${GPS_SECONDS} s)`;
  gpsWatch = navigator.geolocation.watchPosition(
    ({ coords }) => {
      readings.push({ lat: coords.latitude, lng: coords.longitude, acc: coords.accuracy });
      if (coords.accuracy <= GPS_GOOD_ENOUGH) finish();
      else show(false);
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        stopGps();
        if (capture) captureStatus.textContent = "Standortzugriff verweigert. Marker von Hand auf den Stellplatz ziehen. " +
          (/iPhone|iPad/.test(navigator.userAgent)
            ? "Zum Freigeben: Einstellungen → Datenschutz & Sicherheit → Ortungsdienste → Safari-Websites → \"Beim Verwenden\", und in Safari unter \"aA\" → Website-Einstellungen → Standort → Erlauben."
            : "Zum Freigeben im Browser beim Schloss-Symbol neben der Adresse den Standort erlauben.");
      }
    },
    { enableHighAccuracy: true, timeout: GPS_SECONDS * 1000, maximumAge: 0 }
  );
  gpsTimer = setInterval(() => (Date.now() - started >= GPS_SECONDS * 1000 ? finish() : show(false)), 1000);
}

function endCapture() {
  stopGps();
  capture?.marker.remove();
  capture = null;
  captureEl.hidden = true;
}

document.getElementById("capture-gps").addEventListener("click", locateForCapture);
document.getElementById("capture-cancel").addEventListener("click", endCapture);
document.getElementById("capture-save").addEventListener("click", async () => {
  if (!capture) return;
  const { lat, lng } = capture.marker.getLatLng();
  try {
    await store.addPosition({
      vehicle_id: capture.vehicle.id,
      lat: +lat.toFixed(7),
      lng: +lng.toFixed(7),
      accuracy: capture.moved ? null : capture.accuracy,
      source: capture.moved || capture.accuracy == null ? "manual" : "gps",
      created_by: user?.name || "",
    });
    const savedId = capture.vehicle.id;
    endCapture();
    shownId = savedId;
    await renderVehicles();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
});

// --- Start ---------------------------------------------------------------

// Fehler der Datenbank sichtbar machen statt still zu scheitern
function showDbError(err) {
  modeEl.textContent = "Fehler";
  modeEl.classList.remove("shared");
  modeEl.title = "Datenbank nicht erreichbar: " + (err?.message || err);
  console.error(err);
}

// Angemeldeter Mitarbeiter; sein Name steht bei jeder Meldung im Verlauf
let user = null;
const userEl = document.getElementById("user");
// Tipp auf den Namen: eigenes Passwort ändern oder abmelden
userEl.addEventListener("click", () => {
  const nodes = [];
  if (store.mode !== "demo") {
    const form = document.createElement("form");
    form.className = "pw-form";
    form.innerHTML = `
      <label>Aktuelles Passwort <input name="old" type="password" autocomplete="current-password" required></label>
      <label>Neues Passwort <input name="pw" type="password" autocomplete="new-password" minlength="6" required></label>
      <label>Neues Passwort wiederholen <input name="pw2" type="password" autocomplete="new-password" minlength="6" required></label>
      <p class="pw-msg muted" hidden></p>
      <button type="submit" class="primary">Passwort ändern</button>`;
    const msg = form.querySelector(".pw-msg");
    const say = (text, ok) => {
      msg.textContent = text;
      msg.style.color = ok ? "#1a7f37" : "#cf222e";
      msg.hidden = false;
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.pw.value !== form.pw2.value) return say("Die beiden neuen Passwörter stimmen nicht überein.");
      if (form.pw.value.length < 6) return say("Das neue Passwort muss mindestens 6 Zeichen haben.");
      try {
        await store.changePassword(form.old.value, form.pw.value);
        form.reset();
        say("Passwort geändert.", true);
      } catch (err) {
        say(/invalid login/i.test(err.message) ? "Das aktuelle Passwort ist falsch." : "Ändern fehlgeschlagen: " + err.message);
      }
    });
    nodes.push(form);
  }
  const out = document.createElement("button");
  out.type = "button";
  out.textContent = "Abmelden";
  out.addEventListener("click", async () => {
    await store.signOut();
    location.reload();
  });
  nodes.push(out);
  openPanel(`Angemeldet als ${user.name}`, ...nodes);
});

// QR-Link (…/?v=FZ-0001) erfasst den Standort, geteilter Link (…/?f=FZ-0001) zeigt das Fahrzeug
const params = new URLSearchParams(location.search);
const startCode = params.get("v");
const findCode = params.get("f");

requireLogin(store).then(async (u) => {
  user = u;
  userEl.textContent = u.name;
  userEl.title = "Abmelden";
  userEl.hidden = false;
  document.getElementById("admin-link").hidden = !(store.mode === "demo" || u.role === "admin");
  if (u.active === false) {
    modeEl.textContent = "Gesperrt";
    modeEl.title = "Dein Konto ist gesperrt. Bitte wende dich an einen Admin.";
    alert(modeEl.title);
    return;
  }
  try {
    await renderVehicles();
  } catch (err) {
    showDbError(err);
  }
  if (startCode || findCode) history.replaceState(null, "", location.pathname);
  if (startCode) beginCapture(startCode);
  else if (findCode) {
    const v = vehicles.find((x) => x.code === findCode);
    if (v) {
      searchEl.value = v.name;
      showVehicle(v.id);
    }
  }
  store.onChange(() => {
    renderVehicles().catch(showDbError);
  });
});
