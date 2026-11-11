# Control local de migraciones mediante SHA-256

`tools/database/verify_migration_checksums.py` inspecciona archivos locales con
Python 3 y su biblioteca estándar. No abre conexiones, ejecuta SQL, carga `.env`,
lee cadenas de conexión ni crea o modifica archivos. Emite el manifiesto JSON a
stdout y el diagnóstico a stderr. El operador decide si conserva ese resultado.

## Convenciones

- Solo considera `*.up.sql` directamente dentro del directorio seleccionado;
  excluye subdirectorios, pruebas y `*.down.sql`.
- Exige `NNNN_nombre.up.sql`: versión entre `0001` y `9999`, y nombre en
  minúsculas con segmentos alfanuméricos separados por `_`.
- Rechaza un directorio vacío, nombres inválidos, enlaces simbólicos y versiones
  duplicadas, aunque los nombres descriptivos sean distintos.
- Ordena ascendentemente por versión. Permite huecos; no determina dependencias SQL.
- Calcula SHA-256 sobre los bytes exactos, por bloques. Cambiar comentarios,
  espacios, codificación o finales de línea cambia el checksum.

## Ejemplos

Ejecutar desde la raíz del repositorio:

```bash
python3 tools/database/verify_migration_checksums.py
python3 tools/database/verify_migration_checksums.py --directory database/migrations
python3 tools/database/verify_migration_checksums.py --state /ruta/local/migration-state.json
```

El directorio por defecto se resuelve respecto del script; `--directory` y
`--state` relativos se resuelven respecto del directorio de trabajo. El JSON
mostrado puede conservarse manualmente fuera del repositorio para revisarlo y
usarlo después con `--state`. La herramienta no incluye una opción para escribirlo.

Formato del estado, idéntico al manifiesto de salida:

```json
{
  "schema_version": 1,
  "migrations": [
    {
      "version": "0001",
      "name": "0001_core.up.sql",
      "sha256": "<64 caracteres hexadecimales minúsculos calculados por la herramienta>"
    }
  ]
}
```

El checksum del ejemplo es un marcador y debe reemplazarse por el resultado real.
El estado debe contener todas las migraciones, ordenadas por versión ascendente,
sin duplicados. Rechaza campos adicionales, versiones incoherentes, hashes
inválidos y claves JSON repetidas.

La comparación es exacta: informa archivos registrados ausentes, archivos nuevos
sin registrar y cambios de nombre o checksum. Las nuevas migraciones requieren
revisar y aprobar un nuevo estado; no se aceptan automáticamente. Si existe una
diferencia, stdout sigue mostrando el manifiesto actual, pero el código de salida
es `1`: no se debe sustituir automáticamente el estado de referencia por esa salida.

| Código | Significado |
| --- | --- |
| `0` | Archivos válidos; si se indicó estado, coincide exactamente. |
| `1` | Estado válido pero diferente de los archivos actuales. |
| `2` | Argumentos, nombres, duplicados, JSON o lectura inválidos. |

## Seguimiento y límites

Antes de aplicar migraciones, comparar los archivos con una referencia revisada.
Después de aprobar una nueva migración, conservar un nuevo manifiesto mediante
el procedimiento de control de cambios del equipo. Una migración ya aplicada
debe corregirse mediante una nueva versión, preservando los archivos históricos.

El JSON local es una referencia de archivos, no un registro de ejecución: no
demuestra qué migraciones están instaladas en DEV o PROD. Este verificador tampoco
valida sintaxis SQL, atomicidad, aislamiento, rollback ni el esquema desplegado.
Un checksum detecta cambios respecto de una referencia confiable; no es una firma
digital ni protege una referencia que también haya sido alterada.

## Secretos

No pasar URLs, contraseñas, tokens ni archivos `.env` como argumentos o estado.
El JSON admite únicamente metadatos de migraciones; no necesita datos de conexión.
Usar nombres descriptivos que no contengan secretos y rutas locales sin credenciales.
Los errores de lectura/JSON no muestran contenido, excepciones originales ni rutas.
Los diagnósticos de comparación solo incluyen versiones validadas. El propio shell
puede conservar los argumentos en su historial y mostrar errores de redirección:
mantener también esos argumentos libres de secretos.

Revisar el manifiesto antes de compartirlo: revela nombres de migraciones. No
pegar contenido SQL, variables de entorno ni cadenas de conexión en informes.
