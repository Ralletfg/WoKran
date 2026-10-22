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

const PLAN_IMAGE = "lageplan.png";
let plan = null; // { tl, tr, bl } als [lat, lng]
let planLayer = null;

// Ohne gespeicherte Lage: Plan über die Geländegrenze legen (Norden oben)
function defaultPlan() {
  const b = boundaryLayer.getLatLngs()[0]?.length > 2 ? boundaryLayer.getBounds() : map.getBounds().pad(-0.2);
  return {
    tl: [b.getNorth(), b.getWest()],
    tr: [b.getNorth(), b.getEast()],
    bl: [b.getSouth(), b.getWest()],
  };
}

function showPlan(p, opacity = 1) {
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

const planHint = document.getElementById("plan-hint");
let alignDraft = null; // { tl, tr, bl } während des Ausrichtens
let alignHandles = [];

const handleIcon = L.divIcon({ className: "plan-handle", iconSize: [26, 26] });

function startAlign() {
  if (draft) setEditing(false);
  alignDraft = JSON.parse(JSON.stringify(plan || defaultPlan()));
  if (!map.hasLayer(planLayer)) planLayer.addTo(map);
  showPlan(alignDraft, 0.6);
  planHint.hidden = false;

  const centerOf = (d) => [(d.tr[0] + d.bl[0]) / 2, (d.tr[1] + d.bl[1]) / 2];
  const corners = ["tl", "tr", "bl"].map((k) => {
    const m = L.marker(alignDraft[k], { draggable: true, icon: handleIcon }).addTo(map);
    m.on("drag", () => {
      const { lat, lng } = m.getLatLng();
      alignDraft[k] = [lat, lng];
      mover.setLatLng(centerOf(alignDraft));
      showPlan(alignDraft, 0.6);
    });
    return m;
  });
  const mover = L.marker(centerOf(alignDraft), { draggable: true, icon: L.divIcon({ className: "plan-handle move", iconSize: [34, 34] }) }).addTo(map);
  let last = null;
  mover.on("dragstart", () => (last = mover.getLatLng()));
  mover.on("drag", () => {
    const now = mover.getLatLng();
    const dLat = now.lat - last.lat;
    const dLng = now.lng - last.lng;
    last = now;
    ["tl", "tr", "bl"].forEach((k, i) => {
      alignDraft[k] = [alignDraft[k][0] + dLat, alignDraft[k][1] + dLng];
      corners[i].setLatLng(alignDraft[k]);
    });
    showPlan(alignDraft, 0.6);
  });
  alignHandles = [...corners, mover];
}

function endAlign() {
  alignHandles.forEach((m) => m.remove());
  alignHandles = [];
  alignDraft = null;
  planHint.hidden = true;
  showPlan(plan || defaultPlan());
}

document.getElementById("btn-plan").addEventListener("click", () => (alignDraft ? endAlign() : startAlign()));
document.getElementById("plan-cancel").addEventListener("click", endAlign);
document.getElementById("plan-save").addEventListener("click", async () => {
  const round = (c) => [+c[0].toFixed(7), +c[1].toFixed(7)];
  const next = { tl: round(alignDraft.tl), tr: round(alignDraft.tr), bl: round(alignDraft.bl) };
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
