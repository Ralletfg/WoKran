-- Gemeinsame Datenbank für den Prototyp.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
-- Kann gefahrlos mehrfach ausgeführt werden.

-- Geländegrenze (genau eine Zeile)
create table if not exists site (
  id int primary key default 1 check (id = 1),
  boundary jsonb            -- Liste von [lat, lng]-Punkten
);
-- Lage des Lageplan-Bildes auf der Karte: { tl, tr, bl } als [lat, lng]
alter table site add column if not exists plan jsonb;

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
-- Wer gemeldet hat (Konto der Anmeldung)
alter table positions add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists positions_vehicle_time on positions (vehicle_id, created_at desc);

-- Letzter bekannter Standort je Fahrzeug
-- security_invoker: die Sicht gilt nur für Angemeldete, wie die Tabelle
create or replace view latest_positions with (security_invoker = true) as
select distinct on (vehicle_id) *
from positions
order by vehicle_id, created_at desc;

-- Konto und Name des Melders setzt die Datenbank selbst, damit der Verlauf stimmt
create or replace function set_reporter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.created_by := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'name',
    auth.jwt() -> 'user_metadata' ->> 'full_name',   -- Microsoft-Anmeldung
    auth.jwt() ->> 'email', new.created_by);
  return new;
end $$;
drop trigger if exists positions_reporter on positions;
create trigger positions_reporter before insert on positions
  for each row execute function set_reporter();

-- Nur angemeldete Mitarbeiter dürfen lesen und schreiben.
alter table site enable row level security;
alter table vehicles enable row level security;
alter table positions enable row level security;
drop policy if exists "prototype all" on site;
drop policy if exists "prototype all" on vehicles;
drop policy if exists "prototype all" on positions;
drop policy if exists "angemeldet" on site;
drop policy if exists "angemeldet" on vehicles;
drop policy if exists "angemeldet" on positions;
create policy "angemeldet" on site for all to authenticated using (true) with check (true);
create policy "angemeldet" on vehicles for all to authenticated using (true) with check (true);
create policy "angemeldet" on positions for all to authenticated using (true) with check (true);

-- Live-Aktualisierung für alle offenen Geräte (mehrfach ausführbar)
do $$
declare t text;
begin
  foreach t in array array['site', 'vehicles', 'positions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
