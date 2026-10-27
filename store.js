// Datenzugriff: Supabase, wenn konfiguriert, sonst lokaler Demo-Speicher.
// Beide Varianten haben dieselbe Schnittstelle, damit die App nichts davon merkt.

const LS_KEY = "qr-fahrzeuge-demo";

// crypto.randomUUID fehlt auf älteren iPhones und außerhalb von HTTPS
const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

function createLocalStore() {
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || { site: null, vehicles: [], positions: [] };
    } catch {
      return { site: null, vehicles: [], positions: [] };
    }
  };
  const save = (db) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch {}
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  const USER_KEY = "qr-fahrzeuge-user";

  return {
    mode: "demo",
    // Demo: Name genügt, er bleibt auf dem Gerät
    async currentUser() {
      try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
    },
    async signUp({ name }) {
      const u = { id: "demo", name, email: "", role: "admin", active: true };
      try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
      return u;
    },
    async signIn() {
      return this.currentUser();
    },
    async signOut() {
      try { localStorage.removeItem(USER_KEY); } catch {}
    },
    async getBoundary() {
      return load().site?.boundary || null;
    },
    async setBoundary(boundary) {
      const db = load();
      db.site = { ...db.site, boundary };
      save(db);
      notify();
    },
    async getPlan() {
      return load().site?.plan || null;
    },
    async setPlan(plan) {
      const db = load();
      db.site = { ...db.site, plan };
      save(db);
      notify();
    },
    async listVehicles() {
      return load().vehicles;
    },
    async addVehicle({ code, name, plate }) {
      const db = load();
      const v = { id: newId(), code, name, plate: plate || "" };
      db.vehicles.push(v);
      save(db);
      notify();
      return v;
    },
    async latestPositions() {
      const latest = {};
      for (const p of load().positions) {
        if (!latest[p.vehicle_id] || p.created_at > latest[p.vehicle_id].created_at) latest[p.vehicle_id] = p;
      }
      return Object.values(latest);
    },
    async history(vehicle_id, limit = 20) {
      return load().positions
        .filter((p) => p.vehicle_id === vehicle_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    },
    async addPosition({ vehicle_id, lat, lng, accuracy, source, created_by }) {
      const db = load();
      db.positions.push({
        id: newId(), vehicle_id, lat, lng, accuracy: accuracy ?? null,
        source, created_by: created_by || "", created_at: new Date().toISOString(),
      });
      save(db);
      notify();
    },

    // --- Admin (im Demo-Modus ist man selbst Admin, Backups liegen auf dem Gerät)
    async updateVehicle(id, fields) {
      const db = load();
      Object.assign(db.vehicles.find((v) => v.id === id) || {}, fields);
      save(db);
      notify();
    },
    async deleteVehicle(id) {
      const db = load();
      db.vehicles = db.vehicles.filter((v) => v.id !== id);
      db.positions = db.positions.filter((p) => p.vehicle_id !== id);
      save(db);
      notify();
    },
    async deletePosition(id) {
      const db = load();
      db.positions = db.positions.filter((p) => p.id !== id);
      save(db);
      notify();
    },
    async listUsers() {
      const u = await this.currentUser();
      return u ? [{ id: u.id, name: u.name, username: "", role: "admin", active: true }] : [];
    },
    async updateUser() {},
    async setPassword() {},
    async deleteUser() {},
    async exportData() {
      const { vehicles, positions } = load();
      return { vehicles, positions };
    },
    async listBackups() {
      return (load().backups || []).map(({ data, ...b }) => b).reverse();
    },
    async getBackup(id) {
      return (load().backups || []).find((b) => b.id === id)?.data;
    },
    async makeBackup(kind = "manuell") {
      const db = load();
      const data = { vehicles: db.vehicles, positions: db.positions };
      db.backups = [...(db.backups || []), {
        id: Date.now(), created_at: new Date().toISOString(), kind,
        vehicles: data.vehicles.length, positions: data.positions.length, data,
      }];
      save(db);
    },
    async restore(data) {
      if (!Array.isArray(data?.vehicles) || !Array.isArray(data?.positions)) throw new Error("Keine gültige Backup-Datei");
      await this.makeBackup("vor Wiederherstellung");
      const db = load();
      db.vehicles = data.vehicles;
      db.positions = data.positions;
      save(db);
      notify();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function createSupabaseStore(url, key) {
  const sb = window.supabase.createClient(url, key);
  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  const toUser = (u) => u && { id: u.id, email: u.email, name: u.user_metadata?.name || u.user_metadata?.full_name || u.email.split("@")[0] };

  return {
    mode: "shared",
    // Mit Rolle (admin/user) und Sperr-Status aus der Tabelle profiles
    async currentUser() {
      const { data } = await sb.auth.getSession();
      const u = toUser(data.session?.user);
      if (!u) return null;
      const { data: prof } = await sb.from("profiles").select("role, active").eq("id", u.id).maybeSingle();
      return { ...u, role: prof?.role || "user", active: prof ? prof.active : true };
    },
    // Liefert null, wenn Supabase erst eine Bestätigungs-E-Mail verlangt
    async signUp({ email, password, name }) {
      const data = check(await sb.auth.signUp({
        email, password,
        options: { data: { name }, emailRedirectTo: new URL("./", location.href).href },
      }));
      return data.session ? this.currentUser() : null;
    },
    async signIn({ email, password }) {
      check(await sb.auth.signInWithPassword({ email, password }));
      return this.currentUser();
    },
    // Zurück auf dieselbe Adresse, damit ein gescannter Link (?v=…) erhalten bleibt
    async signInWithMicrosoft() {
      check(await sb.auth.signInWithOAuth({
        provider: "azure",
        options: { scopes: "email", redirectTo: location.href },
      }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async getBoundary() {
      const rows = check(await sb.from("site").select("boundary").eq("id", 1));
      return rows[0]?.boundary || null;
    },
    async setBoundary(boundary) {
      check(await sb.from("site").upsert({ id: 1, boundary }));
    },
    // Lage des Plan-Bildes: { tl, tr, bl } als [lat, lng]
    async getPlan() {
      const rows = check(await sb.from("site").select("plan").eq("id", 1));
      return rows[0]?.plan || null;
    },
    async setPlan(plan) {
      check(await sb.from("site").upsert({ id: 1, plan }));
    },
    async listVehicles() {
      return check(await sb.from("vehicles").select("*").order("name"));
    },
    async addVehicle({ code, name, plate }) {
      return check(await sb.from("vehicles").insert({ code, name, plate: plate || "" }).select().single());
    },
    async latestPositions() {
      return check(await sb.from("latest_positions").select("*"));
    },
    async history(vehicle_id, limit = 20) {
      return check(await sb.from("positions").select("*").eq("vehicle_id", vehicle_id)
        .order("created_at", { ascending: false }).limit(limit));
    },
    async addPosition(p) {
      check(await sb.from("positions").insert(p));
    },

    // --- Admin (die Datenbank prüft selbst, ob man Admin ist)
    async updateVehicle(id, fields) {
      check(await sb.from("vehicles").update(fields).eq("id", id));
    },
    async deleteVehicle(id) {
      check(await sb.from("vehicles").delete().eq("id", id));
    },
    async deletePosition(id) {
      check(await sb.from("positions").delete().eq("id", id));
    },
    async listUsers() {
      return check(await sb.from("profiles").select("*").order("name"));
    },
    async updateUser(id, { role, active }) {
      check(await sb.rpc("admin_update_user", { uid: id, new_role: role, new_active: active }));
    },
    async setPassword(id, pw) {
      check(await sb.rpc("admin_set_password", { uid: id, pw }));
    },
    async deleteUser(id) {
      check(await sb.rpc("admin_delete_user", { uid: id }));
    },
    async exportData() {
      const [vehicles, positions] = await Promise.all([
        sb.from("vehicles").select("*"), sb.from("positions").select("*").limit(100000),
      ]).then((r) => r.map(check));
      return { vehicles, positions };
    },
    async listBackups() {
      return check(await sb.from("backups").select("id, created_at, kind, vehicles, positions")
        .order("created_at", { ascending: false }));
    },
    async getBackup(id) {
      return check(await sb.from("backups").select("data").eq("id", id).single()).data;
    },
    async makeBackup() {
      check(await sb.rpc("make_backup", { backup_kind: "manuell" }));
    },
    async restore(data) {
      check(await sb.rpc("restore_backup", { backup: data }));
    },
    onChange(fn) {
      const ch = sb
        .channel("changes")
        .on("postgres_changes", { event: "*", schema: "public" }, fn)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}

window.createStore = function () {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
    return createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return createLocalStore();
};
