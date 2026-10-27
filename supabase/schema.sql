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

-- Konto und Name des Melders setzt die Datenbank selbst, damit der Verlauf stimmt.
-- Beim Einspielen eines Backups bleiben die gesicherten Werte stehen.
create or replace function set_reporter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.restoring', true) = 'on' then return new; end if;
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

-- Benutzer: Name, Benutzername, Rolle und ob das Konto gesperrt ist
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  username text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Jedes neue Konto bekommt automatisch einen Eintrag
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, username, created_at)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
          split_part(new.email, '@', 1), new.created_at)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Schon vorhandene Konten nachtragen
insert into profiles (id, name, username, created_at)
select id, coalesce(raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'full_name', ''),
       split_part(email, '@', 1), created_at
from auth.users
on conflict (id) do nothing;

-- Gibt es noch keinen Admin, wird das älteste Konto Admin
update profiles set role = 'admin'
where id = (select id from profiles order by created_at limit 1)
  and not exists (select 1 from profiles where role = 'admin');

create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin')
$$;

-- Rechte: Mitarbeiter lesen, melden Standorte und legen Fahrzeuge an.
-- Ändern und Löschen darf nur ein Admin. Gesperrte Konten sehen nichts.
alter table site enable row level security;
alter table vehicles enable row level security;
alter table positions enable row level security;
alter table profiles enable row level security;
do $$
declare t text; pol text;
begin
  foreach t in array array['site', 'vehicles', 'positions', 'profiles'] loop
    foreach pol in array array['prototype all', 'angemeldet', 'lesen', 'anlegen', 'admin ändern', 'admin löschen', 'admin schreiben'] loop
      execute format('drop policy if exists %I on %I', pol, t);
    end loop;
  end loop;
end $$;
create policy "lesen" on site for select to authenticated using (is_active());
create policy "admin schreiben" on site for all to authenticated using (is_admin()) with check (is_admin());
create policy "lesen" on vehicles for select to authenticated using (is_active());
create policy "anlegen" on vehicles for insert to authenticated with check (is_active());
create policy "admin ändern" on vehicles for update to authenticated using (is_admin()) with check (is_admin());
create policy "admin löschen" on vehicles for delete to authenticated using (is_admin());
create policy "lesen" on positions for select to authenticated using (is_active());
create policy "anlegen" on positions for insert to authenticated with check (is_active());
create policy "admin ändern" on positions for update to authenticated using (is_admin()) with check (is_admin());
create policy "admin löschen" on positions for delete to authenticated using (is_admin());
create policy "lesen" on profiles for select to authenticated using (id = auth.uid() or is_admin());

-- Benutzerverwaltung für Admins
create or replace function admin_update_user(uid uuid, new_role text, new_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur für Admins'; end if;
  if uid = auth.uid() and (new_role <> 'admin' or not new_active) then
    raise exception 'Das eigene Admin-Konto kann nicht herabgestuft oder gesperrt werden';
  end if;
  update profiles set role = new_role, active = new_active where id = uid;
  -- Gesperrte Konten können sich auch nicht mehr anmelden
  update auth.users set banned_until = case when new_active then null else 'infinity'::timestamptz end where id = uid;
end $$;

create or replace function admin_set_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Nur für Admins'; end if;
  if length(pw) < 6 then raise exception 'Das Passwort muss mindestens 6 Zeichen haben'; end if;
  update auth.users set encrypted_password = crypt(pw, gen_salt('bf')), updated_at = now() where id = uid;
end $$;

create or replace function admin_delete_user(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur für Admins'; end if;
  if uid = auth.uid() then raise exception 'Das eigene Konto kann nicht gelöscht werden'; end if;
  delete from auth.users where id = uid;   -- Meldungen bleiben, nur der Name steht noch daran
end $$;

-- Backups: Kopie aller Fahrzeuge und Meldungen als JSON in der Datenbank
create table if not exists backups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null default 'manuell',      -- automatisch, manuell, vor Wiederherstellung
  vehicles int not null default 0,
  positions int not null default 0,
  data jsonb not null
);
alter table backups enable row level security;
drop policy if exists "admin" on backups;
create policy "admin" on backups for select to authenticated using (is_admin());

-- Ohne Anmeldung (auth.uid() leer) läuft es nur für den Zeitplan in der Datenbank selbst
create or replace function make_backup(backup_kind text default 'manuell') returns bigint
language plpgsql security definer set search_path = public as $$
declare bid bigint;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'Nur für Admins'; end if;
  insert into backups (kind, vehicles, positions, data)
  values (backup_kind,
          (select count(*) from vehicles), (select count(*) from positions),
          jsonb_build_object(
            'vehicles', coalesce((select jsonb_agg(v) from vehicles v), '[]'::jsonb),
            'positions', coalesce((select jsonb_agg(p) from positions p), '[]'::jsonb)))
  returning id into bid;
  -- Automatische Backups 30 Tage aufbewahren
  delete from backups where kind = 'automatisch' and created_at < now() - interval '30 days';
  return bid;
end $$;

-- Ersetzt alle Fahrzeuge und Meldungen durch den Inhalt eines Backups.
-- Vorher wird der aktuelle Stand gesichert, damit man es rückgängig machen kann.
create or replace function restore_backup(backup jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nur für Admins'; end if;
  if jsonb_typeof(backup -> 'vehicles') <> 'array' or jsonb_typeof(backup -> 'positions') <> 'array' then
    raise exception 'Keine gültige Backup-Datei';
  end if;
  perform make_backup('vor Wiederherstellung');
  perform set_config('app.restoring', 'on', true);
  delete from positions where true;
  delete from vehicles where true;
  insert into vehicles select * from jsonb_populate_recordset(null::vehicles, backup -> 'vehicles');
  insert into positions select * from jsonb_populate_recordset(null::positions, backup -> 'positions');
  perform set_config('app.restoring', 'off', true);
end $$;

revoke execute on function admin_update_user(uuid, text, boolean), admin_set_password(uuid, text),
  admin_delete_user(uuid), make_backup(text), restore_backup(jsonb) from public, anon;
grant execute on function admin_update_user(uuid, text, boolean), admin_set_password(uuid, text),
  admin_delete_user(uuid), make_backup(text), restore_backup(jsonb) to authenticated;

-- Tägliches Backup um 2 Uhr nachts (UTC)
create extension if not exists pg_cron;
select cron.schedule('taegliches-backup', '0 2 * * *', $$select public.make_backup('automatisch')$$);

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
