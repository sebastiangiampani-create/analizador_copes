-- Analizador COPES - esquema inicial
-- PostgreSQL / Neon

create table if not exists acciones (
  id bigserial primary key,
  codigo varchar(32) not null unique,
  nombre text,
  anio integer,
  descripcion text,
  created_at timestamptz not null default now()
);

create table if not exists sedes (
  id bigserial primary key,
  nombre text not null,
  direccion text,
  created_at timestamptz not null default now()
);

create table if not exists tutores (
  id bigserial primary key,
  nombre text not null,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists escuelas (
  id bigserial primary key,
  cue varchar(32),
  nombre text not null,
  dependencia text,
  comuna text,
  sector_gestion text,
  distrito_region text,
  created_at timestamptz not null default now()
);

create table if not exists docentes (
  id bigserial primary key,
  dni varchar(32),
  cuil varchar(32),
  apellido text,
  nombre text,
  nombre_completo text,
  email text,
  cargo text,
  area text,
  escuela_id bigint references escuelas(id),
  created_at timestamptz not null default now()
);

create unique index if not exists docentes_dni_unique
  on docentes(dni)
  where dni is not null and dni <> '';

create table if not exists comisiones (
  id bigserial primary key,
  accion_id bigint not null references acciones(id) on delete cascade,
  codigo varchar(64) not null,
  nombre text,
  area text,
  formacion text,
  turno text,
  horario text,
  cupo integer,
  sede_id bigint references sedes(id),
  tutor_id bigint references tutores(id),
  created_at timestamptz not null default now(),
  unique (accion_id, codigo)
);

create table if not exists encuentros (
  id bigserial primary key,
  comision_id bigint not null references comisiones(id) on delete cascade,
  numero integer,
  fecha date,
  turno text,
  horario text,
  sede_id bigint references sedes(id),
  created_at timestamptz not null default now()
);

create table if not exists inscripciones (
  id bigserial primary key,
  accion_id bigint not null references acciones(id) on delete cascade,
  comision_id bigint references comisiones(id) on delete set null,
  docente_id bigint not null references docentes(id) on delete cascade,
  escuela_id bigint references escuelas(id),
  estado text,
  fecha_inscripcion date,
  fuente_importacion text,
  created_at timestamptz not null default now(),
  unique (accion_id, comision_id, docente_id)
);

create table if not exists asistencias (
  id bigserial primary key,
  encuentro_id bigint not null references encuentros(id) on delete cascade,
  docente_id bigint not null references docentes(id) on delete cascade,
  presente boolean,
  estado text,
  observaciones text,
  fuente_importacion text,
  created_at timestamptz not null default now(),
  unique (encuentro_id, docente_id)
);

create table if not exists importaciones (
  id bigserial primary key,
  nombre_archivo text not null,
  codigo_accion_detectado varchar(32),
  tipo_archivo text,
  estado text not null default 'pendiente',
  total_registros integer not null default 0,
  registros_validos integer not null default 0,
  registros_observados integer not null default 0,
  registros_duplicados integer not null default 0,
  detalle jsonb,
  created_at timestamptz not null default now()
);

create table if not exists equivalencias_columnas (
  id bigserial primary key,
  alias_origen text not null unique,
  campo_destino text not null,
  prioridad integer not null default 100,
  activa boolean not null default true
);

insert into equivalencias_columnas (alias_origen, campo_destino)
values
  ('curso', 'accion'),
  ('accion', 'accion'),
  ('acción', 'accion'),
  ('nombre de la propuesta', 'accion'),
  ('capacitacion', 'accion'),
  ('capacitación', 'accion'),
  ('establecimiento', 'escuela'),
  ('escuela', 'escuela'),
  ('nombre completo', 'docente_nombre'),
  ('apellido y nombre', 'docente_nombre'),
  ('asistencia', 'asistencia'),
  ('presente', 'asistencia'),
  ('comision', 'comision'),
  ('comisión', 'comision'),
  ('tutor', 'tutor'),
  ('sede', 'sede'),
  ('turno', 'turno')
on conflict (alias_origen) do nothing;
