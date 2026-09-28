# Analizador COPES

Dashboard web para consolidar y analizar inscripciones y asistencias de acciones formativas.

## V1 disponible

La V1 funciona **local-first**: los Excel se procesan en el navegador, se normalizan y se guardan en IndexedDB del mismo navegador. Esto permite probar el sistema sin exponer credenciales de Neon.

Formatos ya contemplados:
- C0709 — Trayecto de Formación Pedagógico Didáctica DET Noveles
- C0832 — FDS Secundaria Aprende Agosto 2026
- C0855 — Secundaria Aprende · Talleres de Diseño SEP 2026

### Detecta automáticamente
- código principal de acción C####;
- códigos de comisión/subacción;
- propuestas y comisiones;
- inscripciones;
- asistencias y encuentros;
- DNI, nombre, correo, escuela, dependencia, DE/región, área y turno;
- inconsistencias de códigos dentro de un mismo archivo.

### Dashboard
- docentes inscriptos y asistentes únicos;
- porcentaje de asistencia;
- escuelas representadas y escuelas sin asistencia;
- gráficos por fecha/encuentro, área, escuela y comisión;
- filtros por acción, escuela, comisión y área;
- vistas de acciones, escuelas y ausencias;
- búsqueda global;
- carga simultánea de varios Excel.

## Neon PostgreSQL

El esquema base está en `db/schema.sql`. El código C#### es la identidad funcional de la acción. La conexión productiva se realizará mediante backend/API segura; la clave de Neon no se expone en GitHub Pages.

## Publicación

`.github/workflows/pages.yml` publica automáticamente el sitio mediante GitHub Pages cuando Pages está configurado para GitHub Actions.
