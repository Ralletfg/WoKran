const store = window.createStore();
const $ = (id) => document.getElementById(id);
const fmtTime = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

// Kleine Helfer für Elemente
function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter((c) => c != null && c !== false));
  return e;
}
const btn = (label, onClick, cls = "") => el("button", { type: "button", textContent: label, className: cls, onclick: onClick });

async function run(fn) {
  try {
    await fn();
  } catch (err) {
    alert("Fehler: " + (err?.message || err));
  }
}

// --- Reiter -----------------------------------------------------------------

function showTab(name) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  return ({ fahrzeuge: renderVehicles, benutzer: renderUsers, backup: renderBackups })[name]();
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => run(() => showTab(b.dataset.tab))));

// --- Fahrzeuge und Meldungen ------------------------------------------------

let vehicles = [];
const open = new Set(); // Fahrzeuge, deren Meldungen aufgeklappt sind

async function renderVehicles() {
  vehicles = await store.listVehicles();
  vehicles.sort((a, b) => String(a.name).localeCompare(String(b.name), "de", { numeric: true }));
  filterVehicles();
}

function filterVehicles() {
  const q = $("v-search").value.trim().toLowerCase();
  const shown = vehicles.filter((v) => !q || String(v.name).toLowerCase().includes(q));
  $("v-list").replaceChildren(...shown.slice(0, 100).map(vehicleRow));
  if (shown.length > 100) $("v-list").append(el("li", { className: "muted", textContent: `… und ${shown.length - 100} weitere, bitte suchen.` }));
}
$("v-search").addEventListener("input", filterVehicles);

function vehicleRow(v) {
  const li = el("li", { className: "row" });
  const input = el("input", { type: "text", value: v.name });
  const sub = el("ul", { className: "sub" });
  const toggle = btn(open.has(v.id) ? "Meldungen ausblenden" : "Meldungen", () => {
    open.has(v.id) ? open.delete(v.id) : open.add(v.id);
    filterVehicles();
  });
  li.append(
    el("div", { className: "row-head" },
      input,
      btn("Speichern", () => run(async () => {
        const name = input.value.trim();
        if (!name || name === v.name) return;
        await store.updateVehicle(v.id, { name });
        await renderVehicles();
      })),
      toggle,
      btn("Löschen", () => run(async () => {
        if (!confirm(`Fahrzeug ${v.name} mit allen Meldungen löschen?`)) return;
        await store.deleteVehicle(v.id);
        await renderVehicles();
      }), "danger"),
    ),
    sub,
  );
  if (open.has(v.id)) renderPositions(v, sub);
  return li;
}

async function renderPositions(v, sub) {
  sub.replaceChildren(el("li", { className: "muted", textContent: "Lade …" }));
  const rows = await store.history(v.id, 200);
  sub.replaceChildren(...rows.map((p) => el("li", {},
    el("span", {},
      el("strong", { textContent: fmtTime(p.created_at) }), " ",
      el("small", { textContent: [p.created_by || "unbekannt", p.source === "manual" ? "von Hand" : "GPS"].join(" · ") })),
    btn("Löschen", () => run(async () => {
      if (!confirm(`Meldung vom ${fmtTime(p.created_at)} löschen?`)) return;
      await store.deletePosition(p.id);
      renderPositions(v, sub);
    }), "danger"),
  )));
  if (!rows.length) sub.replaceChildren(el("li", { className: "muted", textContent: "Keine Meldungen." }));
}

// --- Benutzer ---------------------------------------------------------------

let me = null;

async function renderUsers() {
  const users = await store.listUsers();
  $("u-list").replaceChildren(...users.map(userRow));
}

function userRow(u) {
  const self = u.id === me.id;
  const role = el("select", {},
    el("option", { value: "user", textContent: "Mitarbeiter", selected: u.role !== "admin" }),
    el("option", { value: "admin", textContent: "Admin", selected: u.role === "admin" }));
  role.disabled = self;
  role.addEventListener("change", () => run(async () => {
    await store.updateUser(u.id, { role: role.value, active: u.active });
    await renderUsers();
  }));
  return el("li", { className: "row" },
    el("div", { className: "row-head" },
      el("strong", { textContent: u.name || u.username }),
      u.username && el("small", { textContent: u.username }),
      u.role === "admin" && el("span", { className: "tag admin", textContent: "Admin" }),
      !u.active && el("span", { className: "tag off", textContent: "gesperrt" })),
    !self && el("div", { className: "row-head" },
      role,
      btn(u.active ? "Sperren" : "Entsperren", () => run(async () => {
        await store.updateUser(u.id, { role: u.role, active: !u.active });
        await renderUsers();
      })),
      btn("Passwort setzen", () => run(async () => {
        const pw = prompt(`Neues Passwort für ${u.name || u.username} (mindestens 6 Zeichen):`);
        if (!pw) return;
        await store.setPassword(u.id, pw);
        alert("Passwort geändert. Bitte dem Mitarbeiter mitteilen.");
      })),
      btn("Löschen", () => run(async () => {
        if (!confirm(`Konto von ${u.name || u.username} löschen? Die Meldungen bleiben erhalten.`)) return;
        await store.deleteUser(u.id);
        await renderUsers();
      }), "danger")),
    self && el("small", { textContent: "Das bist du." }),
  );
}

// --- Backup -----------------------------------------------------------------

function download(data, name) {
  const a = el("a", {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })),
    download: name,
  });
  a.click();
}
const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[T:]/g, "-");

async function restore(data, label) {
  const n = `${data?.vehicles?.length ?? "?"} Fahrzeuge, ${data?.positions?.length ?? "?"} Meldungen`;
  if (!confirm(`Backup ${label} einspielen (${n})?\n\nAlle aktuellen Fahrzeuge und Meldungen werden dadurch ersetzt. Der jetzige Stand wird vorher gesichert.`)) return;
  await store.restore(data);
  alert("Backup eingespielt.");
  renderBackups();
}

async function renderBackups() {
  const list = await store.listBackups();
  $("b-list").replaceChildren(...list.map((b) => el("li", { className: "row" },
    el("div", { className: "row-head" },
      el("strong", { textContent: fmtTime(b.created_at) }),
      el("span", { className: "tag", textContent: b.kind })),
    el("small", { textContent: `${b.vehicles} Fahrzeuge, ${b.positions} Meldungen` }),
    el("div", { className: "row-head" },
      btn("Herunterladen", () => run(async () => download(await store.getBackup(b.id), `backup-${stamp(new Date(b.created_at))}.json`))),
      btn("Einspielen", () => run(async () => restore(await store.getBackup(b.id), `vom ${fmtTime(b.created_at)}`)), "danger")),
  )));
  if (!list.length) $("b-list").replaceChildren(el("li", { className: "muted", textContent: "Noch keine Backups." }));
}

$("b-make").addEventListener("click", () => run(async () => {
  await store.makeBackup();
  await renderBackups();
}));
$("b-download").addEventListener("click", () => run(async () => download(await store.exportData(), `fahrzeuge-${stamp()}.json`)));
$("b-file").addEventListener("change", (e) => run(async () => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("Die Datei ist kein gültiges Backup.");
  }
  await restore(data, `aus ${file.name}`);
}));

// --- Start ------------------------------------------------------------------

requireLogin(store).then((u) => {
  me = u;
  const isAdmin = store.mode === "demo" || (u.role === "admin" && u.active !== false);
  $("denied").hidden = isAdmin;
  $("admin").hidden = !isAdmin;
  if (isAdmin) run(() => showTab("fahrzeuge"));
});
