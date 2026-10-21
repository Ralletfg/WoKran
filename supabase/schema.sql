-- Gemeinsame Datenbank für den Prototyp.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.

-- Geländegrenze (genau eine Zeile)
create table if not exists site (
  id int primary key default 1 check (id = 1),
  boundary jsonb            -- Liste von [lat, lng]-Punkten
);

-- Fahrzeuge; "code" ist der Inhalt des QR-Codes
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  plate text not null default '',
  created_at timestamptz not null default now()
);

-- Jede Standortmeldung wird aufbewahrt (Verlauf)
create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,             -- GPS-Genauigkeit in Metern
  source text not null check (source in ('gps', 'manual')),
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists positions_vehicle_time on positions (vehicle_id, created_at desc);

-- Letzter bekannter Standort je Fahrzeug
create or replace view latest_positions as
select distinct on (vehicle_id) *
from positions
order by vehicle_id, created_at desc;

-- Prototyp: jeder mit dem Link darf lesen und schreiben.
-- Vor dem echten Einsatz durch eine Anmeldung ersetzen.
alter table site enable row level security;
alter table vehicles enable row level security;
alter table positions enable row level security;
create policy "prototype all" on site for all using (true) with check (true);
create policy "prototype all" on vehicles for all using (true) with check (true);
create policy "prototype all" on positions for all using (true) with check (true);

-- Live-Aktualisierung für alle offenen Geräte
alter publication supabase_realtime add table site, vehicles, positions;
