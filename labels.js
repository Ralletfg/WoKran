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
  for (const [cls, text] of [["name", v.name], ["code", v.code]]) {
    if (!text) continue;
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    el.append(d);
  }
  return el;
}

async function render() {
  const vehicles = await store.listVehicles();
  vehicles.sort((a, b) => a.code.localeCompare(b.code));
  document.getElementById("count").textContent = `(${vehicles.length})`;
  sheet.replaceChildren(...vehicles.map(labelEl));
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

render();
