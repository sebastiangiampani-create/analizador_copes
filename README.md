# Analizador COPES

Aplicación web para consolidar, analizar y visualizar inscripciones y asistencias de acciones formativas.

## Objetivo
- Importación manual de bases Excel/CSV.
- Detección automática del código principal de acción (por ejemplo C0832, C0855, C0709).
- Normalización de acciones, comisiones, encuentros, docentes, escuelas, inscripciones y asistencias.
- Dashboard interactivo tipo Power BI / Looker Studio.
- Filtros por acción, escuela, tutor, sede, turno, comisión, comuna, dependencia, cargo y área.
- Informes imprimibles y exportables.

## Arquitectura inicial
- Frontend: Next.js + TypeScript
- Base de datos: Neon PostgreSQL
- Gráficos: Apache ECharts
- Importación: SheetJS
- Repositorio: GitHub

## Estado
Base inicial del proyecto. El esquema de datos está preparado en `db/schema.sql`.
