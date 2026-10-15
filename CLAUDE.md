# VERTEX

Sistema de monitoreo industrial: horas de operación, estados, eventos y
mantenimiento de motores en planta. Monorepo con frontend React, backend
Express y base de datos SQL Server.

## Estado actual

### Frontend (`apps/frontend`) — React 19 + TypeScript + Vite 8, CSS Modules
- **Login** (`src/modules/auth/`)
  - `AuthFlow.tsx`: panel de marca (desktop) + tarjeta de login.
  - `LoginForm.tsx`: campo "Usuario o correo" + contraseña con botón mostrar/ocultar, estados de carga y error.
  - `auth.service.ts`: `login()`, `getStoredToken()` (descarta tokens vencidos) y `logout()`. Token en `localStorage` con clave `vx_token`.
  - Dos modos:
    - **Normal:** `POST {VITE_API_URL}/api/identity/login`.
    - **Demo** (`VITE_DEMO_MODE=true`, para Netlify): valida contra `VITE_DEMO_EMAIL` / `VITE_DEMO_PASSWORD` sin backend y genera un token local `{ demo: true, exp: +8h }` sin firma real.
  - `App.tsx`: vista `'login' | 'dashboard'`. Si hay un token vigente, entra directo al dashboard.
- **Dashboard** (`src/modules/dashboard/`): en modo normal, la dona, el estado del motor, la tendencia y la tabla de eventos leen la base; el resto sigue simulado (`mockData.ts`, `donutSimulation.ts`). En modo demo todo es simulado.
  - **Período compartido** (`periodo.ts`: `{ dias }` o `{ desde, hasta }` AAAA-MM-DD, por defecto 30 días): uno solo para la dona, la tabla de eventos y la tendencia. Lo cambian el selector de fechas y los botones de la tabla.
  - `PeriodoSelector.tsx`: botón con las fechas que abre dos calendarios nativos (Fecha inicio / Fecha fin) con Aplicar / Cancelar; Escape o clic fuera cierran; límites = primer y último registro del equipo; valida inicio ≤ fin.
  - Selectores CERO / Período. Al cambiar el CERO se consulta `GET /api/equipos/:codigo` (`equipos.service.ts`):
    - mientras espera, spinner;
    - si existe, borde verde y ✓;
    - si responde 404, 503 o hay error de red, borde rojo y banner con el mensaje del backend.
    - Si el usuario cambia de nuevo, se cancela la consulta anterior. En modo demo no se consulta.
  - Panel de la dona: info del motor, unidades h/d/sem/mes y leyenda en una sola fila.
    - Centro de la dona: total con la letra de la unidad pegada (`720H`, `30,0D`, `4,3S`, `1,0M`) y debajo el período en líneas sin partir: "Del dd/mm al dd/mm", el año ("2026", o "2025 – 2026" si cruza de año) y, en modo normal, "(última medición)". Letra de la fecha `clamp(6px, 5.8cqi, 12px)`; cabe en los 5 layouts (verificado hasta un teléfono de 320 px).
    - Una sola petición `GET /api/equipos/:codigo/bloques` (`fetchBloques`) alimenta la dona (`horas`), el estado del motor (`estado_actual`) y la tabla de eventos: siempre coinciden. Debajo de la leyenda solo "Cargando…", "Sin mediciones…" o el error.
    - El fin del período se muestra como el último día incluido (`ultimoDia`); "(última medición)" solo si el período llega al último registro.
    - Modo demo: `demoBloquesData` (`bloques.service.ts`) devuelve la misma forma con bloques simulados, para días o rangos de fechas. El período termina en el último registro simulado (14/10).
    - Producto y línea siguen simulados.
  - **Tendencia** (`TrendChart.tsx`, SVG puro) con selector de variable (corriente, vibración, temperatura, voltaje y producción) y línea nominal (valores fijos en `mockData.ts`: 5,2 A, 2,5 mm/s, 60 °C y 220 V).
    - Modo normal: `GET /api/equipos/:codigo/mediciones` en el período compartido. Cada punto es el promedio de un intervalo con el motor encendido; el intervalo lo elige el SP según la duración (15 min, 1 h, 4 h o diario) y se indica en el aviso ("Promedio cada 4 h con el motor encendido"). Producción sigue simulada y lo indica.
    - Eje X de tiempo real con exactamente el período (el mismo de la dona y la tabla); la línea se corta donde no hay datos. Fechas en UTC alineadas a las 00:00 ("dd/mm" o "dd/mm hh:mm"), tantas como quepan por ancho. Títulos de ejes "Variable (unidad)" y "Fecha (UTC)".
    - Capas: máximo de cada intervalo (azul claro), umbral (rojo oscuro punteado si está habilitado; gris "(desh.)" si no, y solo si cae dentro del rango de datos), puntos con marcas de evento en rojo con tooltip, y bandas de fondo Evento (#FFEBEE) / Mantenimiento (#FFF3E0) con los bloques de la tabla. Leyenda debajo, solo con lo que aparece.
    - **Se dibuja al tamaño real de su caja** (`ResizeObserver`, 1 unidad SVG = 1 px): ocupa todo el espacio de la tarjeta y la letra queda en 11 px en cualquier pantalla. Teléfono: caja 3:2 (máx. 320 px de alto); desktop: el alto que queda en la tarjeta. Título y aviso van en la misma línea.
    - Mientras carga un período nuevo solo usa datos del período actual (no mezcla el eje de uno con los datos de otro).
    - Modo demo: `demoMedicionesData` (`operacion.service.ts`) simula lecturas por minuto en los bloques ENCENDIDO del período demo, agrupadas como el SP, con los mismos umbrales que la base (temperatura que sube de 40 a 62 °C en el turno). La marca de evento simulada (10 min: vibración en CERO-010 el 21/09 06:11, temperatura en CERO-012 el 09/10 09:30) sale igual en la gráfica y en las `marcas` de los bloques.
  - `operacion.service.ts` (fetch de mediciones y su simulación demo) y `useBackend.ts` (hook genérico con cancelación por clave).
  - **Resumen de eventos** (`EventsSummary.tsx`, `bloques.service.ts`), en el lugar de las antiguas barras por turno:
    - tabla # / Inicio / Fin / Duración / Estado con los bloques de estado del CERO seleccionado (el mismo cálculo que la dona), y botones 7 / 15 / 30 días / Todo que cambian el período compartido;
    - # numera las filas en el orden mostrado: 1 es el bloque más reciente; la regla que decidió cada bloque sale como `title` de la fila;
    - Encendido / Apagado / Evento / Mantenimiento; las horas se muestran en UTC, tal como están guardadas;
    - modo normal: `GET /api/equipos/:codigo/bloques`;
    - modo demo: bloques simulados minuto a minuto con los turnos del seed (CERO-010/011/012), y CERO-013 devuelve "Equipo no encontrado" para probar el error.
    - Teléfono (todo lo que no es desktop): Estado con etiqueta corta ("Encend.", "Apagado", "Evento", "Mtto."; la completa en `title`) y celdas con menos relleno; ≤ 340 px, letra 11 px. Cabe sin desplazamiento horizontal en 360 px (304/304), 320 px (264/264) y teléfono horizontal.
    - `HorizontalBars.tsx` y `mockData.bars` quedan sin usar.
  - Placeholder del mapa.
  - Cerrar sesión en el Sidebar (desktop) y en la cabecera móvil.
- **Modos de layout** (los mismos en `dashboard.module.css` y `auth.module.css`):
  - teléfono por defecto;
  - teléfono horizontal: `(orientation: landscape) and (max-height: 500px)`;
  - desktop: `(min-width: 768px) and (min-height: 501px)`, fijo a 100vh;
  - desktop compacto: alto ≤ 760;
  - desktop grande: ≥ 1440×860.
- `src/shared/api.ts`: `API_URL` (`VITE_API_URL`) y `DEMO_MODE` (`VITE_DEMO_MODE`), compartidos por los servicios.
- Variables de color para validación en `dashboard.module.css`: `--vx-ok` (#2E7D32) y `--vx-danger` (#E53935). `--vx-success` es azul, por eso no se usa para "ok".
- Los archivos vacíos (`LoginPage.tsx`, `ReauthModal.tsx`, `modules/reporting`, `modules/admin`, `shared/`) son estructura pendiente.

### Backend (`apps/backend`) — Express 5 + TypeScript, `mssql`, `bcrypt`, `jsonwebtoken`
- `src/main.ts`: conecta a SQL Server (pool global de `mssql`) y escucha en el puerto **3000**.
- `src/app.ts`: JSON, CORS (`CORS_ORIGIN`) y `GET /health` → `{ status: "ok" }`.
- **`POST /api/identity/login`**
  - Body: `{ credential, password }`, donde `credential` es el email **o** el `username`.
  - Busca un usuario activo en `dbo.Usuarios` y sus roles en `dbo.UsuarioRoles` / `dbo.Roles`, y compara con bcrypt.
  - Respuestas: 200 `{ token }`, 400 si faltan datos, 401 `{ error: "Credenciales inválidas" }`.
  - JWT: `{ userId, email, username, rol: string[] }`, vence en `JWT_EXPIRES_IN` (8h).
  - Si el usuario no existe también ejecuta bcrypt, para que el tiempo de respuesta no delate qué usuarios existen.
- **`GET /api/equipos/:codigo`** (`src/domains/equipos/`): busca un equipo activo en `dbo.EquiposCero` junto con su área.
  - 200 `{ encontrado: true, codigo, nombre, area }`.
  - 404 `{ encontrado: false, mensaje: "Equipo no encontrado" }`.
  - 503 `{ encontrado: false, mensaje: "Sin conexión a la base de datos" }` si SQL Server no responde.
  - Sin autenticación por ahora; es una prueba de conexión dashboard → backend → base de datos.
- **El cálculo de estados vive en `dbo.sp_vx_resumen_estados`** (ver Base de datos); Node solo lo ejecuta (`ejecutarResumenEstados` en `equipos.service.ts`). No hay lógica de estados en Node ni en el frontend.
- **Período** (`leerPeriodo` en el controller, tipo `Periodo` en el service) en `/resumen`, `/bloques` y `/mediciones`:
  - `?dias=N` (1 a 3650): de `MAX(event_time) - N días` al último registro;
  - `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`: días UTC con los dos extremos incluidos (hasta las 24:00 de `hasta`), recortado al último registro;
  - sin parámetros: toda la historia (`/resumen` exige uno de los dos).
  - 400 si no son válidos; 404 / 503 / 500 con `{ mensaje }`. Nunca se usa el reloj del servidor.
- **`GET /api/equipos/:codigo/bloques`**: lo usa el dashboard para la dona y la tabla (una sola ejecución del SP).
  - 200 `{ fecha_referencia, desde, primer_registro, ultimo_registro, horas: { ENCENDIDO, APAGADO, EVENTO, MANTENIMIENTO }, estado_actual, bloques: [{ inicio, fin, duracion_min, segmento, regla, marcas }] }`, bloques del más reciente al más antiguo.
- **`GET /api/equipos/:codigo/resumen`**: horas por estado más el detalle de cálculo (el dashboard ya no lo usa).
  - 200 `{ fecha_referencia, desde, primer_registro, ultimo_registro, horas, estado_actual, ciclos, mantenimientos }`.
  - `ciclos`: `{ inicio, ultimo_registro, registros_encendido, registros_encendido_con_evento, porcentaje, estado_evento, estado_evento_desde, primera_marca }`; `mantenimientos`: `{ inicio, fin, duracion_min }`.
  - Sin mediciones (CERO-011): `fecha_referencia: null`, horas en cero y listas vacías.
- `GET /api/equipos/:codigo/intervalos` ya no existe (leía `IntervalosFuncionamiento`).
- **`GET /api/equipos/:codigo/mediciones?variable=CODIGO`** + período: estadísticas por intervalo de una variable, solo con el motor encendido. Solo ejecuta `dbo.sp_vx_tendencia_variable`.
  - `variable`: CORRIENTE_MOTOR, TEMPERATURA_MOT, VIBRACION_MOT, VOLTAJE_MOTOR, FRECUENCIA_RED, POTENCIA_MOT o RPM_MOTOR; si no, 400.
  - 200 `{ variable, unidad, fecha_referencia, desde, minutos_punto, umbral: { min, max, habilitado } | null, puntos: [{ inicio, dia, promedio, minimo, maximo, lecturas, marcas }] }`.
- `requestTimeout` de `mssql`: 30 s (`main.ts`); "Todo" puede tardar varios segundos.
- Pendiente:
  - middlewares `authenticate` / `authorize` / `reauthenticate` (vacíos), así que todavía no hay rutas protegidas;
  - el resto de dominios (data-acquisition, hours-calculation, mantenimiento, audit), que son archivos vacíos.
- La autenticación final será contra el Directorio Activo corporativo; la tabla de usuarios es para la demo.

### Base de datos (`database/`) — SQL Server, bases `VERTEX_DEMO` y `VERTEX_REAL`
- Migraciones `V001`–`V006`, procedimientos `R__*`, seeds `01`–`03` e instalador `database/scripts/01_install_databases.sql`.
  - `V006`: índice `IX_Mediciones_Equipo_Tiempo (equipo_id, event_time) INCLUDE (variable_id, valor)` para el cálculo de estados (~45 MB).
- Varios `.sql` están en **UTF-16**: para buscar en ellos, decodificarlos primero; `grep` no los lee.
  - Al editarlos hay que conservar la codificación (UTF-16 LE con BOM) y los finales de línea, que mezclan CRLF y LF.
  - `03_demo_measurements_extended.sql` es la excepción: está en UTF-8 sin BOM.
- **Catálogo de variables:** lo define solo `01_reference_data.sql`, con un MERGE que inserta y actualiza las 8 variables:

| variable_id | codigo | unidad |
|---|---|---|
| `44444444-…-01` | CORRIENTE_MOTOR | A |
| `44444444-…-02` | RPM_MOTOR | RPM |
| `44444444-…-03` | TEMPERATURA_MOT | °C |
| `44444444-…-04` | VOLTAJE_MOTOR | V |
| `55555555-…-01` | VIBRACION_MOT | mm/s |
| `55555555-…-02` | FRECUENCIA_RED | Hz |
| `55555555-…-03` | POTENCIA_MOT | kW |
| `55555555-…-04` | ESTADO_MOTOR | - |

  - `02` usa esos IDs (la corriente y el sensor `SEN-CORR-CERO010-M2` van con `44444444-…-01`).
  - `03` no crea ni modifica variables: valida que existan y, si no, se detiene ("Ejecute primero 01_reference_data.sql"). Las unidades de sus mediciones salen de `dbo.Variables`.
- **Mediciones por minuto de CERO-010** (`apps/backend/scripts/seed-mediciones.ts`, `npm run seed:mediciones`):
  - Del 2026-07-13 (lunes) al último lote de 5 minutos antes de ejecutarlo; una fila por minuto de CORRIENTE, TEMPERATURA, VIBRACION, VOLTAJE y ESTADO_MOTOR (~650 000 filas, ~300–450 MB). Valores deterministas (semilla fija).
  - Turnos: lunes a viernes ~06–22 h UTC, sábado ~06–14 h, domingo apagado. Apagado = filas con `ESTADO_MOTOR = 0` y valores cerca de cero; mantenimiento = sin filas.
  - 4 mantenimientos (el 2.º es el cambio de MOT-CERO010-001 por MOT-CERO010-002 el 2026-09-11 08:00 UTC) y 3 eventos (anomalías dispersas 2–4 días antes y una parada de 20–50 min). Fechas fijas en el script.
  - También inserta `IntervalosFuncionamiento` (cierre `PARADA_NORMAL`, `FALLA` o `MANTENIMIENTO`), `IntervencionesMantenimiento` y `ContadoresCicloMotor` (5 ciclos), con `hallazgos` / `motivo_inicio` que empiezan por `SEED:` para que `sp_vx_restablecer_demo` no los borre.
  - Una sola transacción; no inserta nada si CERO-010 ya tiene datos. `--simular` (`npx tsx scripts/seed-mediciones.ts --simular`) solo calcula y muestra el resumen, sin conectarse.
  - Requisitos, con la cuenta administradora: `database/scripts/03_preparar_seed_mediciones_cero010.sql` (borra los datos simulados anteriores de CERO-010 y alinea `EquipoMotorHistorial`) y, una vez, `04_crear_login_seed.sql` (login `SEED_DB_USER`: SELECT en dbo e INSERT solo en Mediciones, IntervalosFuncionamiento, IntervencionesMantenimiento, ContadoresCicloMotor y Auditoria; toma la contraseña de la variable de entorno).
  - **Los seeds 02 y 03 vuelven a cargar datos de CERO-010** en ese período (03 borra y regenera del 11/09 al 10/10). No re-ejecutarlos sin revisarlos.
  - **Después de cualquier seed o carga de datos**, ejecutar `database/scripts/99_verificar_integridad_variables.sql`.
    - Es de solo lectura y se puede ejecutar con `app_demo_user`.
    - Revisa el catálogo, las mediciones con una unidad distinta a la de su variable, los sensores asociados a otra variable y las mediciones cuya variable no es la de su sensor; además cuenta las mediciones por variable.
    - El resumen final debe decir `OK`.
- **Cálculo de estados** (ENCENDIDO / APAGADO / EVENTO / MANTENIMIENTO): `database/procedures/R__sp_vx_resumen_estados.sql` (UTF-16 LE con BOM).
  - `EXEC dbo.sp_vx_resumen_estados @equipo_codigo, @desde, @hasta | @dias, @detalle`. `@hasta` se recorta al último registro. Devuelve: 1) minutos por segmento, estado actual, `primer_registro` y `ultimo_registro`; 2) ciclos con contadores; 3) mantenimientos detectados; 4) con `@detalle = 1`, bloques con su regla y marcas.
  - Solo lee `Mediciones`: **nunca se modifican sus filas** ni se usan etiquetas guardadas (`IntervalosFuncionamiento`, `calidad`…); el estado sale de los valores y de `event_time` (nunca `received_time` ni relojes del servidor).
  - Registro = filas del equipo con el mismo `event_time`. El tiempo hasta el siguiente registro se asigna al primero.
  - Reglas: 1) hueco > `TOLERANCIA_HUECO_MIN` entre registros → MANTENIMIENTO y ciclo nuevo (los huecos menores son paquetes perdidos y conservan la regla del registro anterior); 2) contadores del ciclo: registros encendidos y encendidos con marca; si el % supera `PORCENTAJE_EVENTO`, el ciclo entra en estado de evento hasta el siguiente mantenimiento; 3) ciclo en estado de evento → EVENTO; 4a) corriente > 0 → ENCENDIDO (la marca queda registrada); 4b) corriente 0 con alguna marca desde el último mantenimiento → EVENTO; 4c) si no → APAGADO.
  - Corriente 0 = `CORRIENTE_MOTOR <= CORRIENTE_CERO_MAX` (en la demo el motor apagado marca 0,001–0,081 A, no 0); sin lectura de corriente se usa `ESTADO_MOTOR = 0`. Marca = alguna variable habilitada fuera de `UMBRAL_MAX` / `UMBRAL_MIN`.
  - Para un período lee la historia desde el último mantenimiento anterior a su inicio.
  - Rendimiento:
    - La lectura (`INSERT #r`) usa `WITH (INDEX (IX_Mediciones_Equipo_Tiempo))` y `OPTION (MAXDOP 1, ORDER GROUP, LOOP JOIN)`: la agregación hash se desbordaba a tempdb (~10 s) y en paralelo variaba de 0,4 a 12 s. Un columnstore vacío en `#r` habilita el modo batch en las funciones de ventana.
    - `#t` calcula el número de bloque (`LAG` + suma acumulada) con PK `(bloque, event_time)` y `OPTION (MAXDOP 1, RECOMPILE)`, así el resultado 4 agrupa sin ordenar (`ORDER GROUP`). Antes se desbordaba (1 244 páginas, picos de 22 s).
    - Tiempos en el portátil de desarrollo: 7 días ~1,5–2,5 s, toda la historia ~5–8 s (casi todo CPU; con batería la CPU baja a 1,1 GHz). Con poca memoria libre SQL Server reduce las concesiones y alguna sentencia se desborda; recomendado fijar `min server memory` (p. ej. 1 GB).
    - La primera llamada tras cambiar el SP tarda más (compila).
  - Parámetros: `database/scripts/05_parametros_calculo_estados.sql` (idempotente, MERGE; re-ejecutarlo restablece estos valores). Se ejecuta con un login con escritura (`-E`), no con `app_demo_user`.

| Tabla | Clave | Valor |
|---|---|---|
| `ConfiguracionCalculo` | `PORCENTAJE_EVENTO` | 30 |
| | `INTERVALO_REGISTRO_MIN` | 1 (dispositivo y demo) |
| | `TOLERANCIA_HUECO_MIN` | 30 (hueco > 30 min = mantenimiento) |
| | `CORRIENTE_CERO_MAX` | 0.1 A |
| `ConfiguracionVariables` | CORRIENTE_MOTOR `UMBRAL_MAX` / `HABILITADO` | 2.5 A / **0** (la demo trabaja a ~5,2 A) |
| | VOLTAJE_MOTOR `NOMINAL` / `UMBRAL_MIN` / `UMBRAL_MAX` / `HABILITADO` | 440 / 396 / 484 V / **0** (la demo está a ~220 V) |
| | VIBRACION_MOT `UMBRAL_MAX` / `HABILITADO` | 4.5 mm/s (ISO 10816-1 Clase I) / 1 |
| | TEMPERATURA_MOT `UMBRAL_MAX` / `HABILITADO` | 65 °C / 1 |

  - Resultado en la demo (CERO-010): 5 ciclos separados por 4 mantenimientos (6 h, 17,5 h, 26 h y 5 h); ninguno supera el 30 %, así que todo el EVENTO viene de la regla 4b (p. ej. desde la marca de vibración del 21/09 06:11 hasta el mantenimiento del 28/09). Septiembre: ENCENDIDO 21 412, APAGADO 8 258, EVENTO 10 920, MANTENIMIENTO 2 610 min.
- **Tendencia**: `database/procedures/R__sp_vx_tendencia_variable.sql` (UTF-16 LE con BOM). `EXEC dbo.sp_vx_tendencia_variable @equipo_codigo, @variable_codigo, @dias | @desde, @hasta [, @minutos_punto]`:
  - 1) `unidad`, `fecha_referencia`, `desde`, `minutos_punto`, `umbral_min`, `umbral_max`, `umbral_habilitado`;
  - 2) por intervalo (`inicio`, `dia`): promedio, mínimo, máximo, lecturas y `marcas` (lecturas fuera del umbral; 0 si está deshabilitado).
  - `@minutos_punto` automático según la duración: ≤ 2 días → 15 min; ≤ 16 días → 60; ≤ 60 días → 240; más → 1440. Intervalos alineados a las 00:00 UTC.
  - Encendido con el mismo criterio que el cálculo de estados: corriente > `CORRIENTE_CERO_MAX`; sin corriente, `ESTADO_MOTOR <> 0`.
  - Usa variables locales `@inicio` / `@fin` y `OPTION (RECOMPILE)`: con el plan del primer período (parameter sniffing) otros períodos eran lentísimos. ~0,1–0,5 s.
  - `sp_vx_get_serie_variable` (puntos sueltos con historial de modificaciones) es otro propósito y no lo usa el dashboard.
- Login SQL `app_demo_user`: solo `SELECT` / `EXECUTE` en `VERTEX_DEMO` (`DENY INSERT/UPDATE/DELETE`).
- **Datos de prueba (solo desarrollo):**
  - `CERO-011` "Equipo de prueba", insertado a mano en `dbo.EquiposCero` de `VERTEX_DEMO`, con el área, tipo y perfil de CERO-010. Sirve para probar el caso "encontrado"; no es un equipo real.
  - Para borrarlo: `DELETE FROM dbo.EquiposCero WHERE codigo = 'CERO-011';` con un login con permisos de escritura, porque `app_demo_user` no los tiene.
  - Equipos reales en la base: solo CERO-010. Ver `docs/equipos-mapping.md`.
- Hashes reales de los 7 usuarios demo: `scripts/create_demo_users.ts`, que lee `DEMO_PWD_*` del `.env` raíz.

### Despliegue
- GitHub: `https://github.com/Arturo-Civer/VERTEX` (rama `main`), conectado a Netlify.
- Netlify solo sirve el frontend en **modo demo**; el backend corre en la red interna, porque necesita SQL Server.
- Configuración de Netlify (en su panel, fuera del repo):

| Ajuste | Valor |
|---|---|
| Base directory | `apps/frontend` |
| Build command | `npm run build` |
| Publish directory | `apps/frontend/dist` |
| Variables | `VITE_DEMO_MODE=true`, `VITE_DEMO_EMAIL`, `VITE_DEMO_PASSWORD` |

- Vite copia las variables `VITE_*` dentro del JavaScript público. La contraseña demo debe ser desechable.

## Estructura

```
apps/
  frontend/            React + Vite (src/modules/{auth,dashboard,...}, src/contracts)
  backend/             Express API (src/domains/<dominio>/, src/shared/middleware)
packages/shared/       Contratos TypeScript compartidos (vacíos por ahora)
database/              migrations/, procedures/, seeds/, scripts/
scripts/               create_demo_users.ts
docs/                  INSTALL_DATABASE.md
instalar.ps1           Instalador de las bases de datos (PowerShell)
start-vertex.ps1       Arranque de desarrollo: SQL Server + backend + frontend + navegador
```

## Variables de entorno

Ningún `.env` se sube a git (`.gitignore`). Cada carpeta tiene su `.env.example`.

**`apps/backend/.env`**

| Variable | Uso |
|---|---|
| `DB_SERVER`, `DB_PORT` | SQL Server (por defecto `localhost`, `1433`) |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `app_demo_user` sobre `VERTEX_DEMO` |
| `DB_TRUST_SERVER_CERTIFICATE` | `true` por defecto (certificado autofirmado local) |
| `SEED_DB_USER`, `SEED_DB_PASSWORD` | Solo `npm run seed:mediciones`: login de escritura creado con `database/scripts/04_crear_login_seed.sql` |
| `JWT_SECRET` | Obligatorio. Generar con `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `8h` |
| `CORS_ORIGIN` | `http://localhost:5173` (lista separada por comas) |

**`apps/frontend/.env`**

| Variable | Uso |
|---|---|
| `VITE_API_URL` | `http://localhost:3000` |
| `VITE_DEMO_MODE` | `false` en local, `true` en Netlify |
| `VITE_DEMO_EMAIL`, `VITE_DEMO_PASSWORD` | Solo en Netlify, nunca en el repo |

**`.env` raíz:** instalador y `scripts/create_demo_users.ts` (`VERTEX_DEMO_*`, `DEMO_PWD_*`).

## Comandos de desarrollo

**Arranque rápido:** doble clic en el acceso directo "Iniciar VERTEX" del escritorio, que ejecuta
`powershell -ExecutionPolicy Bypass -File start-vertex.ps1`. El script:
- comprueba que el servicio `MSSQLSERVER` está en marcha y, si no, lo arranca (pide permisos de administrador si hacen falta);
- verifica el puerto `DB_PORT`;
- ejecuta `npm install` si falta `node_modules`;
- abre dos terminales ("VERTEX Backend" y "VERTEX Frontend") con `npm run dev`, sin duplicarlas si el 3000 o el 5173 ya están ocupados;
- espera a que respondan el backend (3000) y Vite (5173), y abre `http://localhost:5173`.
  - El backend solo abre el puerto tras conectar con SQL Server. Si el dashboard carga antes, sus peticiones fallan ("Sin conexión con el servidor"), la dona se queda en 0 y no se reintenta hasta cambiar de CERO o de período.

```bash
# Backend (requiere SQL Server con VERTEX_DEMO instalada)
cd apps/backend
npm install
npm run dev          # tsx watch, http://localhost:3000
npm run typecheck
npm run build && npm start

# Frontend
cd apps/frontend
npm install
npm run dev          # Vite, http://localhost:5173
npm run build        # tsc -b && vite build → dist/
npm run lint         # oxlint
```

## Convenciones
- La interfaz y los mensajes van en español; el `index.html` tiene `lang="es"` para que el navegador no traduzca la página.
- Las variables CSS `--vx-*` están definidas en `dashboard.module.css` y no se redefinen.
- No hay dependencias de gráficos: la dona y la tendencia son SVG puro. Los íconos son SVG inline.
- Nunca guardar contraseñas, tokens ni hashes en archivos versionados.
- Commits y push solo cuando el usuario lo apruebe explícitamente ("aprobado").

## Reglas de trabajo con Claude

**Regla de contexto**
- Al iniciar una sesión nueva (primera conversación del día), leer CLAUDE.md una sola vez y confirmar que se leyó.
- Durante la sesión NO volver a leerlo salvo que el usuario lo pida.

**Regla de actualización**
- Al completar una tarea aprobada, preguntar: "¿Apruebas guardar estos cambios en CLAUDE.md?"
- Solo si el usuario responde "sí" o "aprobado", actualizar CLAUDE.md.
- No hacer commit de CLAUDE.md hasta que el usuario diga "aprobado".
