# Análisis de acciones

Dashboard web para consolidar, analizar y visualizar inscripciones y asistencias de acciones formativas.

## V1 de prueba

La V1 funciona **local-first**: los Excel se procesan directamente en el navegador y los datos quedan guardados en IndexedDB en ese equipo. Esto permite probar carga, normalización, filtros y visualizaciones sin publicar credenciales de base de datos.

### Formatos usados para validar el importador

- C0709 — Trayecto de Formación Pedagógico Didáctica DET Noveles
- C0832 — FDS Secundaria Aprende Agosto 2026
- C0855 — Secundaria Aprende · Talleres de Diseño SEP 2026

El importador admite .xlsx, .xls y .csv, y puede recibir varios archivos juntos.

## Detección y normalización

- código principal de acción C#### desde nombre del archivo o contenido;
- códigos de comisión/subacción;
- códigos embebidos dentro de Taller o Propuesta;
- grupos de C0709;
- hojas Propuestas, Inscripciones y Asistencias;
- DNI, nombre, correo, escuela, dependencia, DE/región, área, turno, sede, cargo, comuna y sector de gestión cuando están disponibles;
- tutor/capacitador y metadatos de comisión desde Propuestas;
- control de códigos SGA que no coinciden con la acción;
- deduplicación de registros;
- asistentes no encontrados dentro de la base de inscriptos.

## Dashboard

### Indicadores
- docentes inscriptos únicos;
- asistentes vinculados a inscripción;
- porcentaje de asistencia sobre inscriptos;
- asistentes sin inscripción encontrada;
- escuelas representadas;
- escuelas sin asistencia;
- acciones y comisiones.

### Filtros
- acción;
- escuela;
- comisión;
- área;
- sede;
- turno;
- tutor/capacitador;
- dependencia;
- DE/región;
- sector de gestión;
- comuna;
- cargo.

### Visualizaciones
- asistencia por encuentro/fecha;
- área;
- escuela;
- comisión;
- dependencia;
- tutor/capacitador;
- sede;
- turno;
- cargo;
- sector de gestión;
- comuna o DE/región.

### Vistas
- resumen general;
- acciones;
- detalle por grupo/comisión con inscriptos, asistentes, %, tutor, sede y turno;
- escuelas;
- docentes inscriptos sin asistencia;
- escuelas sin asistencia;
- historial de importaciones.

## Neon PostgreSQL

El esquema de persistencia está en `db/schema.sql`. Neon se utilizará como almacenamiento central en la siguiente etapa, mediante backend/API segura. La cadena de conexión y las credenciales no deben quedar en el JavaScript público ni en GitHub Pages.

## Publicación

El workflow `.github/workflows/pages.yml` está preparado para GitHub Pages. Para la primera publicación, el propietario del repositorio debe habilitar Pages una vez desde **Settings → Pages → Build and deployment → Source: GitHub Actions**. Después los push a `main` publican automáticamente.
