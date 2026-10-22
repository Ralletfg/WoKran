const cfg = window.APP_CONFIG;
const store = window.createStore();

const modeEl = document.getElementById("mode");
modeEl.textContent = store.mode === "shared" ? "Live" : "Demo";
modeEl.classList.toggle("shared", store.mode === "shared");
modeEl.title = store.mode === "shared" ? "Gemeinsame Daten für alle" : "Demo-Modus: Daten bleiben nur auf diesem Gerät";

// --- Karte ---------------------------------------------------------------

const map = L.map("map", { zoomControl: true }).setView(cfg.MAP_CENTER, cfg.MAP_ZOOM);

const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 20, maxNativeZoom: 19, attribution: "Bilder &copy; Esri, Maxar, Earthstar Geographics" }
).addTo(map);

// Lageplan liegt zwischen Satellitenbild und Fahrzeugpunkten
map.createPane("plan").style.zIndex = 350;

const boundaryStyle = { color: "#e5322d", weight: 3, fill: false };
const boundaryLayer = L.polygon([], boundaryStyle).addTo(map);
const vehicleLayer = L.layerGroup().addTo(map);

// --- Lageplan ------------------------------------------------------------

const PLAN_IMAGE = "lageplan.png?v=2"; // Version hochzählen, wenn sich das Bild ändert
let plan = null; // { tl, tr, bl } als [lat, lng]
let planLayer = null;

// Ohne gespeicherte Lage: Plan über die Geländegrenze legen (Norden oben)
function defaultPlan() {
  const b = boundaryLayer.getLatLngs()[0]?.length > 2 ? boundaryLayer.getBounds() : map.getBounds().pad(-0.2);
  const nw = map.project(b.getNorthWest(), PZ);
  const se = map.project(b.getSouthEast(), PZ);
  return cornersOf({ c: nw.add(se).divideBy(2), w: se.x - nw.x, angle: 0 });
}

// Mischung Satellit/Lageplan: 0 = nur Satellit, 1 = nur Plan; pro Gerät gemerkt
let planOpacity = 0.7;
try {
  const saved = parseFloat(localStorage.getItem("qr-fahrzeuge-mix"));
  if (!Number.isNaN(saved)) planOpacity = saved;
} catch {}

const MixControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd() {
    const box = L.DomUtil.create("div", "mix-control leaflet-bar");
    box.innerHTML = '<span>Satellit</span><input type="range" min="0" max="100" step="5" aria-label="Mischung Satellit und Lageplan"><span>Plan</span>';
    const range = box.querySelector("input");
    range.value = Math.round(planOpacity * 100);
    range.addEventListener("input", () => {
      planOpacity = range.value / 100;
      try { localStorage.setItem("qr-fahrzeuge-mix", String(planOpacity)); } catch {}
      if (planLayer && !alignDraft) planLayer.setOpacity(planOpacity);
    });
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  },
});
new MixControl().addTo(map);

function showPlan(p, opacity = planOpacity) {
  const [tl, tr, bl] = [p.tl, p.tr, p.bl].map((c) => L.latLng(c));
  if (!planLayer) {
    planLayer = L.imageOverlay.rotated(PLAN_IMAGE, tl, tr, bl, { pane: "plan", opacity, interactive: false });
    layers.addOverlay(planLayer, "Lageplan");
    planLayer.addTo(map);
  } else {
    planLayer.reposition(tl, tr, bl);
    planLayer.setOpacity(opacity);
  }
}

async function renderPlan() {
  if (alignDraft) return;
  try {
    plan = await store.getPlan();
  } catch (err) {
    console.warn("Lageplan-Lage nicht lesbar (schema.sql aktuell?)", err);
  }
  showPlan(plan || defaultPlan());
}

const layers = L.control.layers({ Satellit: satellite }, {}, { collapsed: false, position: "topright" }).addTo(map);

async function renderBoundary(fit) {
  const pts = await store.getBoundary();
  boundaryLayer.setLatLngs(pts || []);
  if (fit && pts && pts.length > 2) map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
}

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

// --- Geländegrenze festlegen --------------------------------------------

const hint = document.getElementById("edit-hint");
let draft = null; // Liste von [lat, lng] während der Bearbeitung
const draftLayer = L.polygon([], { ...boundaryStyle, dashArray: "6 6" });

function setEditing(on) {
  hint.hidden = !on;
  draft = on ? [] : null;
  draftLayer.setLatLngs([]);
  if (on) draftLayer.addTo(map);
  else draftLayer.remove();
  boundaryLayer.setStyle({ opacity: on ? 0.3 : 1 });
}

map.on("click", (e) => {
  if (!draft) return;
  draft.push([e.latlng.lat, e.latlng.lng]);
  draftLayer.setLatLngs(draft);
});

document.getElementById("btn-edit").addEventListener("click", () => setEditing(true));
document.getElementById("edit-cancel").addEventListener("click", () => setEditing(false));
document.getElementById("edit-undo").addEventListener("click", () => {
  if (!draft) return;
  draft.pop();
  draftLayer.setLatLngs(draft);
});
document.getElementById("edit-save").addEventListener("click", async () => {
  if (!draft || draft.length < 3) return alert("Bitte mindestens drei Punkte setzen.");
  const pts = draft.map(([lat, lng]) => [+lat.toFixed(6), +lng.toFixed(6)]);
  try {
    await store.setBoundary(pts);
    setEditing(false);
    renderBoundary(false);
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
});

// --- Lageplan ausrichten -------------------------------------------------

// Der Plan wird als starres Bild behandelt: Mitte, Breite und Drehwinkel,
// gerechnet in Kartenpixeln auf fester Zoomstufe. So bleibt das Seitenverhältnis erhalten.
const PLAN_ASPECT = 953 / 1234; // Höhe / Breite von lageplan.png
const PZ = 20;
const planHint = document.getElementById("plan-hint");
let alignDraft = null; // { c: L.Point, w, angle } während des Ausrichtens
let alignHandles = [];

const toPt = (ll) => map.project(L.latLng(ll), PZ);
const toLL = (pt) => {
  const ll = map.unproject(pt, PZ);
  return [ll.lat, ll.lng];
};

function cornersOf({ c, w, angle }) {
  const h = w * PLAN_ASPECT;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (x, y) => toLL(L.point(c.x + x * cos - y * sin, c.y + x * sin + y * cos));
  return { tl: at(-w / 2, -h / 2), tr: at(w / 2, -h / 2), bl: at(-w / 2, h / 2) };
}

function rigidOf(p) {
  const tl = toPt(p.tl);
  const tr = toPt(p.tr);
  const bl = toPt(p.bl);
  const top = tr.subtract(tl);
  const w = Math.hypot(top.x, top.y);
  const angle = Math.atan2(top.y, top.x);
  // Mitte aus oberer Kante und Winkel, damit ein evtl. verzerrter alter Plan wieder gerade wird
  const h = w * PLAN_ASPECT;
  const mid = tl.add(tr).divideBy(2);
  const c = L.point(mid.x - (h / 2) * Math.sin(angle), mid.y + (h / 2) * Math.cos(angle));
  return { c, w, angle };
}

const handleIcon = L.divIcon({ className: "plan-handle", html: "&#10227;", iconSize: [34, 34] });

function startAlign() {
  if (draft) setEditing(false);
  alignDraft = rigidOf(plan || defaultPlan());
  if (!map.hasLayer(planLayer)) planLayer.addTo(map);
  planHint.hidden = false;

  const mover = L.marker(toLL(alignDraft.c), { draggable: true, icon: L.divIcon({ className: "plan-handle move", html: "&#10021;", iconSize: [34, 34] }) }).addTo(map);
  const turner = L.marker([0, 0], { draggable: true, icon: handleIcon }).addTo(map);

  const update = () => {
    const corners = cornersOf(alignDraft);
    showPlan(corners, 0.6);
    mover.setLatLng(toLL(alignDraft.c));
    turner.setLatLng(corners.tr);
  };

  mover.on("drag", () => {
    alignDraft.c = toPt(mover.getLatLng());
    update();
  });
  // Ecke oben rechts: drehen und gleichmäßig vergrößern/verkleinern
  const cornerAngle = Math.atan2(-PLAN_ASPECT, 1);
  const cornerFactor = Math.sqrt(1 + PLAN_ASPECT * PLAN_ASPECT) / 2;
  turner.on("drag", () => {
    const v = toPt(turner.getLatLng()).subtract(alignDraft.c);
    alignDraft.angle = Math.atan2(v.y, v.x) - cornerAngle;
    alignDraft.w = Math.max(50, Math.hypot(v.x, v.y) / cornerFactor);
    update();
  });
  turner.on("dragend", update);

  alignHandles = [mover, turner];
  alignUpdate = update;
  update();
}

let alignUpdate = null;
function nudge(dAngleDeg, scale) {
  if (!alignDraft) return;
  alignDraft.angle += (dAngleDeg * Math.PI) / 180;
  alignDraft.w *= scale;
  alignUpdate();
}

function endAlign() {
  alignHandles.forEach((m) => m.remove());
  alignHandles = [];
  alignDraft = null;
  alignUpdate = null;
  planHint.hidden = true;
  showPlan(plan || defaultPlan());
}

document.getElementById("btn-plan").addEventListener("click", () => (alignDraft ? endAlign() : startAlign()));
document.getElementById("plan-cancel").addEventListener("click", endAlign);
document.getElementById("plan-rot-left").addEventListener("click", () => nudge(-0.5, 1));
document.getElementById("plan-rot-right").addEventListener("click", () => nudge(0.5, 1));
document.getElementById("plan-smaller").addEventListener("click", () => nudge(0, 0.99));
document.getElementById("plan-bigger").addEventListener("click", () => nudge(0, 1.01));
document.getElementById("plan-save").addEventListener("click", async () => {
  const round = (c) => [+c[0].toFixed(7), +c[1].toFixed(7)];
  const corners = cornersOf(alignDraft);
  const next = { tl: round(corners.tl), tr: round(corners.tr), bl: round(corners.bl) };
  try {
    await store.setPlan(next);
    plan = next;
    endAlign();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message + "\n\nWurde die neue schema.sql in Supabase ausgeführt?");
  }
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
    capture.moved = true;
    captureStatus.textContent = "Von Hand verschoben.";
  });
  document.getElementById("capture-title").textContent = `${vehicle.name}${vehicle.plate ? " · " + vehicle.plate : ""}`;
  captureEl.hidden = false;
  locateForCapture();
}

function locateForCapture() {
  if (!capture) return;
  if (!navigator.geolocation) {
    captureStatus.textContent = "Kein GPS. Bitte den Marker auf den Stellplatz ziehen.";
    return;
  }
  captureStatus.textContent = "GPS-Position wird ermittelt …";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (!capture) return;
      const ll = [coords.latitude, coords.longitude];
      capture.marker.setLatLng(ll);
      capture.accuracy = coords.accuracy;
      capture.moved = false;
      map.setView(ll, Math.max(map.getZoom(), 18));
      captureStatus.textContent =
        `GPS-Genauigkeit etwa ${Math.round(coords.accuracy)} m.` +
        (coords.accuracy > 15 ? " Bei Bedarf den Marker auf den richtigen Platz ziehen." : "");
    },
    (err) => {
      if (!capture) return;
      captureStatus.textContent = `GPS nicht verfügbar (${err.message}). Bitte den Marker auf den Stellplatz ziehen.`;
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

function endCapture() {
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

Promise.all([renderBoundary(true), renderVehicles()]).catch(showDbError).finally(renderPlan);

// Aufruf über einen gescannten QR-Link (…/?v=FZ-0001)
const startCode = new URLSearchParams(location.search).get("v");
if (startCode) {
  history.replaceState(null, "", location.pathname);
  beginCapture(startCode);
}

store.onChange(() => {
  Promise.all([renderBoundary(false), renderVehicles(), renderPlan()]).catch(showDbError);
});
