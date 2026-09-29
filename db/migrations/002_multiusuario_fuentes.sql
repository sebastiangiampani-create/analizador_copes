-- Analizador COPES
-- Migración 002: multiusuario + fuentes dinámicas
-- Aditiva / no destructiva

create table if not exists app_users (
  id bigserial primary key,
  auth_user_id text unique,
  email text not null unique,
  display_name text,
  role text not null default 'consulta'
    check (role in ('admin','analista','consulta')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_sources (
  id bigserial primary key,
  accion_id bigint references acciones(id) on delete set null,
  codigo_accion_hint varchar(32),
  nombre text not null,
  source_type text not null default 'google_sheets'
    check (source_type in ('google_sheets','excel_manual','csv_manual')),
  source_url text,
  spreadsheet_id text,
  auth_mode text not null default 'public_link'
    check (auth_mode in ('public_link','technical_account','delegated')),
  sync_interval_minutes integer not null default 5
    check (sync_interval_minutes between 5 and 1440),
  active boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status text
    check (last_sync_status is null or last_sync_status in ('ok','warning','error')),
  last_sync_message text,
  created_by bigint references app_users(id) on delete set null,
  updated_by bigint references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, spreadsheet_id)
);

create index if not exists data_sources_accion_idx on data_sources(accion_id);
create index if not exists data_sources_active_idx on data_sources(active) where active = true;

create table if not exists data_source_tabs (
  id bigserial primary key,
  source_id bigint not null references data_sources(id) on delete cascade,
  sheet_name text not null,
  sheet_kind text not null
    check (sheet_kind in ('propuestas','inscripciones','asistencias','otro')),
  header_row integer not null default 1 check (header_row > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source_id, sheet_name)
);

create table if not exists sync_runs (
  id bigserial primary key,
  source_id bigint not null references data_sources(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running','ok','warning','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_unchanged integer not null default 0,
  rows_missing integer not null default 0,
  warnings integer not null default 0,
  error_message text,
  details jsonb
);

create index if not exists sync_runs_source_started_idx
  on sync_runs(source_id, started_at desc);

create table if not exists source_row_state (
  id bigserial primary key,
  source_id bigint not null references data_sources(id) on delete cascade,
  sheet_name text not null,
  source_key text not null,
  row_hash text not null,
  row_payload jsonb,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, sheet_name, source_key)
);

create index if not exists source_row_state_lookup_idx
  on source_row_state(source_id, sheet_name, active);

create table if not exists app_user_action_access (
  user_id bigint not null references app_users(id) on delete cascade,
  accion_id bigint not null references acciones(id) on delete cascade,
  can_view_pii boolean not null default false,
  can_export boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, accion_id)
);

create table if not exists audit_log (
  id bigserial primary key,
  user_id bigint references app_users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on audit_log(created_at desc);
create index if not exists audit_log_user_idx on audit_log(user_id, created_at desc);

comment on table data_sources is 'Fuentes dinámicas de cada acción. Las credenciales se gestionan fuera de esta tabla.';
comment on table source_row_state is 'Estado/hash por fila para sincronización incremental e idempotente.';
comment on table app_users is 'Perfil de aplicación asociado al proveedor de autenticación; no almacena contraseñas.';
