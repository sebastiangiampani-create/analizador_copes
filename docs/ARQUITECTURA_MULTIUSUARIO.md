# Arquitectura multiusuario y fuentes dinámicas

## Objetivo

El Analizador COPES no debe depender de la cuenta personal de un usuario ni de una carga manual repetida. Cada acción formativa puede asociarse a una Google Sheet externa que cambia durante la capacitación.

## Flujo de producción

```
Google Sheets de la acción
        |
        v
Sincronizador backend seguro
        |
        v
Neon PostgreSQL
        |
        v
API autenticada
        |
        v
Dashboard multiusuario
```

El navegador nunca debe contener credenciales de Google ni una contraseña de Neon.

## Usuarios y roles

- **admin**: administra usuarios, fuentes, sincronizaciones y acceso a PII.
- **analista**: consulta tableros, detalle autorizado y exportaciones.
- **consulta**: visualización de indicadores; por defecto sin PII ni exportación.

`app_user_action_access` permite restringir por acción y distinguir permisos de exportación y visualización de datos personales.

## Fuentes

`data_sources` registra una fuente una sola vez. Para Google Sheets conserva:

- acción asociada;
- spreadsheet_id;
- URL;
- modo de acceso;
- frecuencia;
- estado y fecha de última sincronización.

Modos de acceso previstos:

- `public_link`: la hoja puede leerse mediante un enlace accesible al backend;
- `technical_account`: el propietario comparte la hoja con una cuenta técnica;
- `delegated`: acceso autenticado delegado.

Las credenciales **no** se guardan en `data_sources`.

## Sincronización incremental

Cada corrida crea un registro en `sync_runs`.

`source_row_state` mantiene una clave estable y un hash por fila. La lógica es:

- fila nueva -> INSERT;
- misma clave con hash distinto -> UPDATE;
- mismo hash -> sin cambios;
- fila antes existente y ahora ausente -> marcar para revisión / inactiva, no borrar silenciosamente.

Esto permite volver a leer una planilla completa sin duplicar docentes, inscripciones ni asistencias.

## Privacidad

Las bases contienen DNI, CUIL y correos. Por eso:

1. el dashboard público de GitHub Pages no debe consultar Neon directamente con credenciales privilegiadas;
2. el acceso a PII se controla en backend;
3. las credenciales de Google y Neon se almacenan como secretos del entorno;
4. el frontend recibe solamente los datos que el rol está autorizado a ver;
5. `audit_log` registra acciones administrativas relevantes.

## Estado actual

La V1 sigue pudiendo procesar Excel/CSV localmente para pruebas. La pantalla **Fuentes** permite registrar de forma local las Google Sheets por código y deja preparada la transición a la sincronización central.
