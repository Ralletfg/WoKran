const store = window.createStore();
const sheet = document.getElementById("sheet");

// Der QR-Code enthält einen Link auf die App mit dem Fahrzeugcode,
// so öffnet auch die normale Handy-Kamera direkt das richtige Fahrzeug.
function scanUrl(code) {
  const base = new URL("./", location.href);
  base.searchParams.set("v", code);
  return base.href;
}

function nextCode(vehicles, offset = 0) {
  const max = vehicles.reduce((m, v) => {
    const n = parseInt((v.code.match(/^FZ-(\d+)$/) || [])[1], 10);
    return Number.isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return "FZ-" + String(max + 1 + offset).padStart(4, "0");
}

function labelEl(v) {
  const qr = qrcode(0, "M");
  qr.addData(scanUrl(v.code));
  qr.make();
  const el = document.createElement("div");
  el.className = "label";
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  for (const [cls, text] of [["name", v.name]]) {
    if (!text) continue;
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    el.append(d);
  }
  return el;
}

// Fahrzeugtyp aus dem Anfang des Kostenträgers (Liste in config.js)
const TYPES = window.APP_CONFIG.TYPES || [];
const OTHER = "Sonstige";
const ALL = "Alle";
const typeOf = (v) => TYPES.find((t) => String(v.name).startsWith(t.prefix))?.name || OTHER;

// Die Typ-Ansicht steht in der Adresse (#typ=AC80), so funktioniert auch "Zurück" im Browser
const currentGroup = () => decodeURIComponent((location.hash.match(/^#typ=(.+)$/) || [])[1] || "");
window.addEventListener("hashchange", render);
document.getElementById("back").addEventListener("click", () => {
  location.hash = "";
});

function tile(name, count) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tile";
  b.disabled = !count;
  const n = document.createElement("strong");
  n.textContent = name;
  const c = document.createElement("small");
  c.textContent = count === 1 ? "1 Fahrzeug" : `${count} Fahrzeuge`;
  b.append(n, c);
  b.addEventListener("click", () => {
    location.hash = "typ=" + encodeURIComponent(name);
    scrollTo(0, 0);
  });
  return b;
}

async function render() {
  const vehicles = await store.listVehicles();
  vehicles.sort((a, b) => String(a.name).localeCompare(String(b.name), "de", { numeric: true }));
  const counts = {};
  for (const v of vehicles) counts[typeOf(v)] = (counts[typeOf(v)] || 0) + 1;
  const names = [...TYPES.map((t) => t.name), ...(counts[OTHER] ? [OTHER] : []), ALL];

  const group = currentGroup();
  const inGroup = names.includes(group);
  document.getElementById("overview").hidden = inGroup;
  document.getElementById("group").hidden = !inGroup;

  if (!inGroup) {
    document.getElementById("tiles").replaceChildren(
      ...names.map((n) => tile(n, n === ALL ? vehicles.length : counts[n] || 0))
    );
    sheet.replaceChildren();
    return;
  }
  const shown = group === ALL ? vehicles : vehicles.filter((v) => typeOf(v) === group);
  document.getElementById("group-title").textContent = `${group} (${shown.length})`;
  sheet.replaceChildren(...shown.map(labelEl));
}

async function addMany(rows) {
  const vehicles = await store.listVehicles();
  for (const [i, name] of rows.entries()) {
    await store.addVehicle({ code: nextCode(vehicles, i), name });
  }
  render();
}

document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await addMany([f.name.value.trim()]);
    f.reset();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
});

document.getElementById("bulk-add").addEventListener("click", async () => {
  const box = document.getElementById("bulk");
  const rows = box.value
    .split("\n")
    .map((line) => line.split(/[;\t]/)[0].trim())
    .filter(Boolean);
  if (!rows.length) return;
  try {
    await addMany(rows);
    box.value = "";
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
});

document.getElementById("print").addEventListener("click", () => window.print());

requireLogin(store).then(render);
