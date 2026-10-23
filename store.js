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
      const u = { id: "demo", name, email: "" };
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

  const toUser = (u) => u && { id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split("@")[0] };

  return {
    mode: "shared",
    async currentUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },
    // Liefert null, wenn Supabase erst eine Bestätigungs-E-Mail verlangt
    async signUp({ email, password, name }) {
      const data = check(await sb.auth.signUp({
        email, password,
        options: { data: { name }, emailRedirectTo: new URL("./", location.href).href },
      }));
      return data.session ? toUser(data.user) : null;
    },
    async signIn({ email, password }) {
      return toUser(check(await sb.auth.signInWithPassword({ email, password })).user);
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
