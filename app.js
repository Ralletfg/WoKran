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

function popupContent(v, p) {
  const el = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = v.name;
  const meta = document.createElement("div");
  meta.textContent = [
    v.plate,
    v.code,
    new Date(p.created_at).toLocaleString("de-DE"),
    p.source === "manual" ? "von Hand gesetzt" : "GPS",
    p.created_by,
  ].filter(Boolean).join(" · ");
  el.append(title, meta);
  return el;
}

async function renderVehicles() {
  const [list, positions] = await Promise.all([store.listVehicles(), store.latestPositions()]);
  vehicles = list;
  const byId = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  vehicleLayer.clearLayers();
  for (const k of Object.keys(markers)) delete markers[k];
  for (const p of positions) {
    const v = byId[p.vehicle_id];
    if (!v) continue;
    markers[v.id] = L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#1f6feb", fillOpacity: 1 })
      .bindPopup(popupContent(v, p))
      .bindTooltip(v.name, { permanent: true, direction: "right", offset: [8, 0], className: "vlabel" })
      .addTo(vehicleLayer);
  }
}

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
    (err) => alert("Standort nicht verfügbar: " + err.message),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

// --- Suche --------------------------------------------------------------

const searchEl = document.getElementById("search");
const resultsEl = document.getElementById("search-results");

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  const hits = q
    ? vehicles.filter((v) => [v.name, v.plate, v.code].some((f) => f && f.toLowerCase().includes(q))).slice(0, 20)
    : [];
  resultsEl.replaceChildren(
    ...hits.map((v) => {
      const li = document.createElement("li");
      li.textContent = v.name;
      const small = document.createElement("small");
      small.textContent = [v.plate, v.code, markers[v.id] ? "" : "noch kein Standort"].filter(Boolean).join(" · ");
      li.append(small);
      li.addEventListener("click", () => {
        resultsEl.hidden = true;
        searchEl.value = v.name;
        searchEl.blur();
        const m = markers[v.id];
        if (m) {
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 18));
          m.openPopup();
        }
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
const nameInput = document.getElementById("capture-name");
let stopScan = null;
let capture = null; // { vehicle, marker, accuracy, moved }

try { nameInput.value = localStorage.getItem("qr-fahrzeuge-name") || ""; } catch {}

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
  const marker = L.marker(map.getCenter(), { draggable: true, autoPan: true }).addTo(map);
  capture = { vehicle, marker, accuracy: null, moved: false };
  marker.on("dragend", () => {
    stopGps();
    capture.moved = true;
    captureStatus.textContent = "Von Hand verschoben.";
  });
  document.getElementById("capture-title").textContent = `${vehicle.name}${vehicle.plate ? " · " + vehicle.plate : ""}`;
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
        if (capture) captureStatus.textContent = "Standortzugriff verweigert. Bitte den Marker auf den Stellplatz ziehen.";
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
  const name = nameInput.value.trim();
  try { localStorage.setItem("qr-fahrzeuge-name", name); } catch {}
  const { lat, lng } = capture.marker.getLatLng();
  try {
    await store.addPosition({
      vehicle_id: capture.vehicle.id,
      lat: +lat.toFixed(7),
      lng: +lng.toFixed(7),
      accuracy: capture.moved ? null : capture.accuracy,
      source: capture.moved || capture.accuracy == null ? "manual" : "gps",
      created_by: name,
    });
    endCapture();
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

renderVehicles().catch(showDbError);

// Aufruf über einen gescannten QR-Link (…/?v=FZ-0001)
const startCode = new URLSearchParams(location.search).get("v");
if (startCode) {
  history.replaceState(null, "", location.pathname);
  beginCapture(startCode);
}

store.onChange(() => {
  renderVehicles().catch(showDbError);
});
