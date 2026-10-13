# Mapeo de equipos: base de datos ↔ dashboard

Fuente: base `VERTEX_DEMO`, consultada en solo lectura con `app_demo_user` el 2026-10-12.

El dashboard muestra los ceros **CERO-010, CERO-011, CERO-012 y CERO-013**, con datos simulados.
La base de datos tiene **un solo equipo** registrado en `dbo.EquiposCero`.

## Equipos (`dbo.EquiposCero`)

| Código en BD | Descripción en BD | Cero del dashboard | Notas |
|---|---|---|---|
| CERO-010 | Aplicador CERO Línea 1 - Esmaltado (Equipo CERO piloto demo) | | Sacmi SYNERGIE MAX, serie SN-CERO-010-2019, año 2019. Área: Líneas de Esmaltado. `linea_id` vacío. Tipo CERO, perfil CERO_ESTANDAR. Motor vigente: MOT-CERO010-002 |

## Motores (`dbo.Motores`)

| Código en BD | Descripción en BD | Cero del dashboard | Notas |
|---|---|---|---|
| MOT-CERO010-001 | Motor Principal CERO-010. Motor original instalado en 2019 | | WEG W22-3CV-4P, 2,237 kW, 1740 rpm. Instalado en CERO-010 hasta 2026-09-11; se reemplazó por falla eléctrica (`EquipoMotorHistorial`) |
| MOT-CERO010-002 | Motor Principal CERO-010 (reemplazo). Motor reemplazado por falla eléctrica | | WEG W22-3CV-4P, 2,237 kW, 1740 rpm. En CERO-010 desde 2026-09-11. Ciclo vigente n.º 3 con 80 h; 432 h históricas (`ContadoresCicloMotor`) |

## Datos relacionados

- **Dispositivos:** `SIM-CERO010`, el simulador de adquisición de la demo.
- **Sensores:** `SEN-CORR-CERO010-M2`, que mide la corriente del motor MOT-CERO010-002 en CERO-010.
- **Áreas** (7): EMPACADO, ESMALTE, HORNOS, LINEAS (Líneas de Esmaltado), PASTA, PRENSAS y SEL_AUTO.
- **Líneas:** `dbo.Lineas` está vacía.

## Observaciones para el mapeo

1. **No hay códigos tipo `0001820`.** Los equipos usan el formato `CERO-0XX` y los motores `MOT-CERO0XX-00N`. Si los códigos numéricos vienen de SAP u otro sistema, todavía no están cargados en la base.
2. **Faltan CERO-011, CERO-012 y CERO-013.** El dashboard los muestra, pero no existen en la base.
3. **La línea no coincide.** El dashboard muestra "Línea 3" para CERO-010. En la base, su nombre dice "Línea 1" y no tiene `linea_id`, porque `dbo.Lineas` está vacía.
4. **`dbo.vw_EstadoMotores` repite filas.** Devuelve 3 filas para MOT-CERO010-002, una por cada valor de `horas_ciclo_calculadas` (208, 144 y 80). Los demás campos se repiten, salvo `estado_confianza` y `estado_actualidad`. Hay que tenerlo en cuenta si el dashboard usa esa vista. No se pudo revisar su definición porque `app_demo_user` no tiene permiso para leerla.
