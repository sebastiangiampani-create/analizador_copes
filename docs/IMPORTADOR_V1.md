# Importador V1

## Qué puede leer
La V1 reconoce automáticamente archivos con un código principal en el nombre, por ejemplo:

- `C0709 - ...xlsx`
- `C0832 - ...xlsx`
- `C0855 - ...xlsx`

Busca hojas llamadas o equivalentes a:

- `Propuestas`
- `Inscripciones`
- `Asistencias`

## Criterios de normalización

- Código principal: `C0000`
- Código de comisión: `C0000-001`, `C0000-01`, etc.
- Docente: prioriza DNI; luego correo.
- Escuela: usa `Establecimiento`, `Escuela / Establecimiento` o `Escuela`.
- Dependencia: `Dep. Fun` o, cuando corresponde, la primera línea de Escuela / Establecimiento.
- Área: `Área` / `Area`.
- Tutor: `Capacitador` / `Tutor`.
- Asistencia por fecha: usa el encuentro de la propuesta cuando está disponible; en bases sin ese dato usa la fecha registrada.

## Seguridad de la prueba

Los Excel se procesan en el navegador con SheetJS y se guardan en IndexedDB del mismo navegador.
No se agregan archivos de datos al repositorio público.

## Próxima capa

Cuando Neon quede operativo, la misma estructura se persistirá en PostgreSQL usando el esquema de `db/schema.sql`.
