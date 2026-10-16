# Flujo de datos en VERTEX

Anexo técnico: el recorrido completo de los datos del dashboard, desde que el
usuario actúa en la pantalla hasta que ve el resultado.

> Estado del código: 15/10/2026 (actualizado con el árbol de equipos y los
> campos de fecha Desde / Hasta). Los nombres de archivos, funciones, rutas y
> procedimientos son los que existen hoy en el repositorio. Los ejemplos de
> respuesta son reales, tomados de la base `VERTEX_DEMO` (equipo CERO-010).

---

## 1. Cómo viajan los datos (visión general)

VERTEX tiene tres piezas que trabajan en cadena, como una ventanilla de
atención:

1. **El frontend** es la página web que el usuario ve en el navegador (hecha
   con React). Muestra la dona, la tabla de eventos y la gráfica de tendencia.
   No guarda datos de los motores: cada vez que necesita algo, lo pide.
2. **El backend** es un programa que corre en un servidor de la red interna
   (hecho con Node.js y Express, puerto 3000). Recibe los pedidos del
   frontend, revisa que estén bien escritos y se los pasa a la base de datos.
3. **La base de datos SQL Server** (`VERTEX_DEMO`) guarda todas las lecturas
   de los sensores (tabla `dbo.Mediciones`: una fila por variable y por
   minuto). Dentro de ella viven los **procedimientos almacenados**:
   programas guardados en la propia base que hacen los cálculos.

El viaje siempre es de ida y vuelta:

```
 Usuario hace clic
      │
      ▼
 FRONTEND (navegador) ──── petición HTTP (GET/POST) ───►  BACKEND (Express)
                                                            │ valida
                                                            ▼
                                                     SQL SERVER ejecuta el
                                                     procedimiento almacenado
                                                            │ filas de resultado
                                                            ▼
 FRONTEND dibuja  ◄──── respuesta JSON ─────────────  BACKEND da formato
```

**Reglas comunes a todo el sistema**

- **El período se mide desde la última medición, nunca desde el reloj del
  servidor.** "Últimos 7 días" significa "los 7 días anteriores al último
  dato guardado del equipo". Así el resultado es el mismo sin importar el
  día en que se consulte, y un equipo que dejó de enviar datos no aparece
  vacío.
- **La lógica de negocio vive en los procedimientos almacenados.** La regla
  que decide si el motor estaba ENCENDIDO, APAGADO, en EVENTO o en
  MANTENIMIENTO está escrita una sola vez, en `dbo.sp_vx_resumen_estados`.
  El backend solo lo ejecuta y el frontend solo lo dibuja. Así la dona, la
  tabla y la gráfica nunca se contradicen.
- **Las horas se guardan y se muestran en UTC** (hora universal), tal como
  llegan de los sensores (`event_time`).
- **Un solo período compartido.** La dona, la tabla de eventos y la gráfica
  de tendencia usan siempre el mismo período.

**Manejo de errores, en palabras simples**

| Qué pasó | Código HTTP | Mensaje que ve el usuario |
|---|---|---|
| El pedido está mal escrito (fecha inválida, variable desconocida…) | 400 | El mensaje del backend, p. ej. "El parámetro dias debe ser un entero entre 1 y 3650" |
| Usuario o contraseña incorrectos | 401 | "Credenciales inválidas" |
| El equipo no existe o está inactivo | 404 | "Equipo no encontrado" |
| El backend no logra hablar con SQL Server | 503 | "Sin conexión a la base de datos" |
| Cualquier otro fallo del servidor | 500 | "Error interno del servidor" |
| El navegador no alcanza al backend (apagado, sin red) | — | "Sin conexión con el servidor" |

El backend siempre responde el error en formato JSON con la clave `mensaje`.
Solo el login usa la clave `error`. El frontend muestra ese texto: en rojo
debajo de la dona, en la tabla o sobre la gráfica.

> **Nota.** El backend todavía no protege sus rutas. Los archivos
> `authenticate.ts`, `authorize.ts` y `reauthenticate.ts`
> (`apps/backend/src/shared/middleware/`) están vacíos, y el frontend no
> envía el token en las consultas del dashboard.

---

## 2. Piezas que se repiten en casi todos los recorridos

Conviene conocerlas antes, porque aparecen en varios disparadores.

### 2.1 El período compartido (`apps/frontend/src/modules/dashboard/periodo.ts`)

El período es un pequeño objeto con una de estas dos formas:

| Forma | Ejemplo | Significa |
|---|---|---|
| `{ dias: N }` | `{ dias: 7 }` | Los últimos 7 días hasta la última medición |
| `{ dias: null }` | `{ dias: null }` | Toda la historia ("Todo") |
| `{ desde, hasta }` | `{ desde: '2026-09-01', hasta: '2026-09-15' }` | Del 1 al 15 de septiembre, ambos días incluidos |

El valor inicial es `PERIODO_INICIAL = { dias: 30 }`. La función
`periodoQuery()` lo convierte en el texto que va en la URL:

| Período | Texto en la URL |
|---|---|
| `{ dias: 7 }` | `dias=7` |
| `{ dias: null }` | *(nada)* |
| `{ desde: '2026-09-01', hasta: '2026-09-15' }` | `desde=2026-09-01&hasta=2026-09-15` |

### 2.2 El "pedidor" con cancelación (`useBackend.ts`)

`useBackend(clave, cargar)` es un ayudante de React. Hace el pedido cada vez
que cambia la **clave**, un texto que resume lo que se pide, por ejemplo
`CERO-010|dias:30`.

Si la clave cambia antes de que llegue la respuesta, **cancela el pedido
anterior** (con un `AbortController`). Así, si el usuario hace clic rápido
en "7 días" y luego en "30 días", nunca se dibuja por error la respuesta
vieja.

Devuelve uno de cuatro estados: `idle` (nada que pedir), `loading`
(esperando), `error` (con su mensaje) o `data` (con los datos).

### 2.3 Lectura del período en el backend (`leerPeriodo`, `equipos.controller.ts`)

| Llega en la URL | Resultado | Error 400 si… |
|---|---|---|
| `?dias=7` | `{ dias: 7 }` | no es un entero entre 1 y 3650 → "El parámetro dias debe ser un entero entre 1 y 3650" |
| nada | `{ dias: null }` (toda la historia) | — |
| `?desde=2026-09-01&hasta=2026-09-15` | `{ desde: 01/09 00:00, hasta: 16/09 00:00 }` | falta una fecha, no es una fecha real (p. ej. 2026-02-30), `desde` es mayor que `hasta` o también viene `dias` → "Los parámetros desde y hasta deben ser fechas AAAA-MM-DD válidas, juntas, con desde <= hasta y sin dias" |

Fíjate en el detalle del rango de fechas: el backend **suma un día a
`hasta`**. Así, "hasta el 15/09" significa "hasta las 24:00 del 15/09" y el
día 15 queda completo dentro del período.

Después, la función `responder()` envía el resultado:
- sin datos → 404 "Equipo no encontrado";
- `DbUnavailableError` (SQL Server no responde) → 503;
- cualquier otro error → 500.

### 2.4 Los servicios del frontend (las funciones que hacen `fetch`)

| Archivo | Función | Pide | Mensaje si falla sin mensaje del backend |
|---|---|---|---|
| `modules/auth/auth.service.ts` | `login()` | `POST /api/identity/login` | "No se pudo iniciar sesión. Intenta de nuevo más tarde." |
| `modules/dashboard/equipos.service.ts` | `fetchEquipo()` | `GET /api/equipos/:codigo` | "No se pudo consultar el equipo" |
| `modules/dashboard/bloques.service.ts` | `fetchBloques()` | `GET /api/equipos/:codigo/bloques` | "No se pudieron consultar los eventos" |
| `modules/dashboard/operacion.service.ts` | `fetchMediciones()` | `GET /api/equipos/:codigo/mediciones` | "No se pudieron consultar las mediciones" |
| `modules/dashboard/operacion.service.ts` | `fetchMedicionesDetalle()` | varias veces `/mediciones`, por tramos | igual que la anterior |

La dirección del backend sale de `VITE_API_URL` (`src/shared/api.ts`; por
defecto `http://localhost:3000`).

### 2.5 El modo demo (`VITE_DEMO_MODE=true`)

En Netlify no hay backend ni base de datos. Con `VITE_DEMO_MODE=true` la
constante `DEMO_MODE` (`src/shared/api.ts`) es verdadera y cada servicio
**se desvía antes de hacer la petición**. Funciones del propio navegador
simulan datos con la misma forma que devolvería el backend, así que los
componentes que dibujan no notan la diferencia. En cada disparador, el paso
G indica dónde ocurre ese desvío.

---

## 3. Disparador 1 — Inicio de sesión (botón "Ingresar")

**A. Frontend — captura**
1. El formulario está en `LoginForm.tsx` (`apps/frontend/src/modules/auth/`),
   dentro de la tarjeta de `AuthFlow.tsx`.
2. Al pulsar "Ingresar" se ejecuta `handleSubmit`:
   - evita que el navegador recargue la página;
   - pone el estado local `status` en `'loading'` (el botón muestra que está
     trabajando);
   - llama a `login(credential.trim(), password)`.
3. Si todo va bien llama a `onSuccess(token)`. `App.tsx` cambia su estado
   `view` de `'login'` a `'dashboard'` y se monta el dashboard, lo que inicia
   el **disparador 8** (carga inicial).

**B. Frontend → backend — petición**
1. Servicio: `login()` en `auth.service.ts`.
2. Petición:
   ```
   POST http://localhost:3000/api/identity/login
   Content-Type: application/json

   { "credential": "admin", "password": "••••••" }
   ```
   `credential` puede ser el correo **o** el nombre de usuario.
3. No se cancela ni se divide. Si no hay conexión, el usuario ve "No se pudo
   iniciar sesión. Intenta de nuevo más tarde."

**C. Backend — procesamiento**
1. `app.ts` dirige `/api/identity` al router `identity.routes.ts`, que llama
   a `login()` en `identity.controller.ts`.
2. Validación: si falta el usuario o la contraseña, responde **400**
   `{ "error": "Ingresa tu usuario o correo y tu contraseña" }`.
3. Llama a `loginUser()` en `identity.service.ts`. Si falla la validación de
   credenciales responde **401** `{ "error": "Credenciales inválidas" }`.
   Cualquier otro fallo da **500** `{ "error": "Error interno del servidor" }`.
4. **Aquí no se usa un procedimiento almacenado**: `loginUser()` envía una
   consulta SQL directa.

**D. Base de datos — consulta**
1. Lee tres tablas:
   - `dbo.Usuarios`: el usuario;
   - `dbo.UsuarioRoles` y `dbo.Roles`: sus roles.
2. Busca un usuario **activo** (`activo = 1`) cuyo `email` o `username`
   coincida con lo escrito, y junta sus roles en un texto, por ejemplo
   `"ADMINISTRADOR,OPERADOR"`.
3. Devuelve `usuario_id`, `email`, `username`, `password_hash` y `roles`.

**Cómo se verifica la contraseña (en el backend, con bcrypt).** La base
nunca guarda la contraseña: guarda un *hash*, una huella irreversible.
`bcrypt.compare(contraseña, hash)` calcula la huella de lo que escribió el
usuario y la compara con la guardada.

Si el usuario no existe, igual se compara contra una huella falsa
(`DUMMY_HASH`). Así la respuesta tarda lo mismo y nadie puede adivinar qué
usuarios existen midiendo el tiempo de respuesta.

**E. Backend → frontend — respuesta**

Si las credenciales son correctas, el backend firma un **JWT** (un "pase"
digital firmado con `JWT_SECRET`, que vence en `JWT_EXPIRES_IN` = 8 h) con
este contenido:

```json
{ "userId": "…", "email": "admin@…", "username": "admin", "rol": ["ADMINISTRADOR"] }
```

Responde `200 { "token": "eyJhbGciOi…" }`.

**F. Frontend — visualización**
1. `login()` guarda el token en el navegador (`localStorage`, clave
   `vx_token`).
2. `App.tsx` muestra el dashboard.
3. Si hubo error, `LoginForm` pone `status = 'error'` y muestra el mensaje
   recibido ("Credenciales inválidas", etc.).
4. En visitas siguientes, `getStoredToken()` lee la fecha de vencimiento
   (`exp`) del token. Si sigue vigente entra directo al dashboard; si venció,
   lo borra.

**G. Modo demo**

`login()` llama a `demoLogin()` en lugar de hacer la petición:
1. Compara el correo con `VITE_DEMO_EMAIL` (sin distinguir mayúsculas) y la
   contraseña con `VITE_DEMO_PASSWORD`.
2. Si coinciden, crea un token local **sin firma real**:
   `{ demo: true, exp: ahora + 8 h }`.

---

## 4. Disparador 2 — Selección de equipo en el árbol

En este disparador se explican en detalle los dos cálculos de la base de
datos (paso D). Los demás disparadores remiten aquí.

**A. Frontend — captura**
1. El equipo se elige en el **árbol** `ArbolEquipos.tsx`: Área → Sección →
   Grupo → Equipo → Componente.
   - En desktop y teléfono horizontal está en el panel izquierdo
     (`Sidebar.tsx`).
   - En teléfono vertical está en el panel plegable `ArbolMovil`, bajo la
     cabecera.
   - Los nombres y niveles son **datos DEMO** escritos en el código
     (`jerarquiaDemo.ts`); no se leen de la base. Solo CERO-010 a CERO-013
     tienen datos.
2. Cada clic cambia la **ruta**: la lista de niveles elegidos, por ejemplo
   `Línea de esmaltado › Línea 1 › CEROS › CERO-011`. La función
   `cambiarRuta()` de `DashboardPage.tsx`:
   - la guarda en el estado `ruta`;
   - la copia en el navegador (`localStorage`, clave `vx_ruta`) para
     restaurarla al recargar.
3. **Qué se muestra** lo decide `seleccionDe(ruta)`:
   - sin equipo en la ruta → las cuatro tarjetas dicen "Elige un equipo para
     ver su información";
   - un componente sin sensores (Poleas, Correas) → "Sin mediciones para este
     componente";
   - un equipo sin datos (Molino 1, Prensa 1…) → "Sin mediciones para este
     equipo";
   - un CERO, o su componente Motor → el dashboard de ese CERO (la constante
     `cero`).
4. Al cambiar `cero` cambian las **claves** de `useBackend`, así que se
   vuelven a pedir los datos de todos los componentes que dependen del
   equipo:
   - la dona y el estado del motor (`DonutPanel`);
   - la tabla (`EventsSummary`);
   - la gráfica (`TrendChart`);
   - y la verificación del equipo, que se muestra junto a él en el árbol.

   Arriba del dashboard la ruta se muestra como texto informativo, que no se
   puede pulsar.

**B. Frontend → backend — peticiones (tres, en paralelo)**

Ejemplo: se elige CERO-011 con el período de 30 días y la variable corriente.

| # | Servicio | Petición |
|---|---|---|
| 1 | `fetchEquipo` (`equipos.service.ts`) | `GET /api/equipos/CERO-011` |
| 2 | `fetchBloques` (`bloques.service.ts`) | `GET /api/equipos/CERO-011/bloques?dias=30` |
| 3 | `fetchMediciones` (`operacion.service.ts`) | `GET /api/equipos/CERO-011/mediciones?variable=CORRIENTE_MOTOR&dias=30` |

- Las tres van por `useBackend`:
  - la 1 se cancela si el usuario elige otro equipo antes de la respuesta;
  - la 2 y la 3 se cancelan si cambia el equipo, el período o la variable.
- Si la ruta no tiene un CERO (ningún equipo, o un equipo o componente sin
  datos), **no se hace ninguna petición**.
- La 3 no se hace si la variable es Producción, que no tiene datos en la
  base.
- Si la gráfica está en Detalle, la 3 se reemplaza por varias peticiones por
  tramos (ver disparador 7).

**C. Backend — procesamiento**

`app.ts` dirige `/api/equipos` a `equipos.routes.ts`, que reparte así:

| Ruta | Función (`equipos.controller.ts`) | Qué hace |
|---|---|---|
| `GET /:codigo` | `getEquipo` | Pasa el código a mayúsculas y llama a `findEquipo()` |
| `GET /:codigo/bloques` | `getBloques` | `leerPeriodo()` → `findBloques()` → ejecuta `dbo.sp_vx_resumen_estados` con `@detalle = 1` |
| `GET /:codigo/mediciones` | `getMediciones` | Valida `variable` → `leerPeriodo()` → `findMediciones()` → ejecuta `dbo.sp_vx_tendencia_variable` |

Detalles de cada ruta:
- **`getEquipo`** responde 404 `{ "encontrado": false, "mensaje": "Equipo no encontrado" }`,
  503 `{ "encontrado": false, "mensaje": "Sin conexión a la base de datos" }`
  o 500.
- **`getMediciones`** solo acepta `CORRIENTE_MOTOR`, `TEMPERATURA_MOT`,
  `VIBRACION_MOT`, `VOLTAJE_MOTOR`, `FRECUENCIA_RED`, `POTENCIA_MOT` o
  `RPM_MOTOR`. Con cualquier otra responde 400 "El parámetro variable debe
  ser uno de: …".
- **Parámetros de los procedimientos.** `conPeriodo()` (`equipos.service.ts`)
  les pasa `@dias`, `@desde` y `@hasta`. Con `?dias=30` quedan
  `@dias = 30, @desde = NULL, @hasta = NULL`.
- **Errores de los procedimientos.** Si el procedimiento avisa "Equipo no
  encontrado." (`RAISERROR`), el backend lo convierte en 404. Otros avisos
  ("Variable no encontrada.", "Faltan parametros del calculo…") terminan en
  500.

**D. Base de datos — consulta**

*Verificación del equipo* (`findEquipo`, consulta directa, sin
procedimiento): busca en `dbo.EquiposCero` el código activo y su área en
`dbo.Areas`. Hoy en la base solo existen CERO-010 (real) y CERO-011 (de
prueba); por ejemplo, CERO-013 da 404.

#### D.1 `dbo.sp_vx_resumen_estados` (archivo `database/procedures/R__sp_vx_resumen_estados.sql`)

Es el corazón del sistema: decide en qué estado estuvo el motor en cada
minuto y suma los minutos. Paso a paso:

1. **Busca el equipo** en `dbo.EquiposCero`. Si no existe o está inactivo,
   avisa "Equipo no encontrado.".
2. **Lee los parámetros del cálculo** en `dbo.ConfiguracionCalculo`:

   | Clave | Valor | Para qué sirve |
   |---|---|---|
   | `TOLERANCIA_HUECO_MIN` | 30 | Un silencio de más de 30 min sin datos = mantenimiento |
   | `CORRIENTE_CERO_MAX` | 0,1 A | Corriente ≤ 0,1 A cuenta como "motor sin corriente" |
   | `PORCENTAJE_EVENTO` | 30 | % de lecturas con marca que pone todo el ciclo en evento |

   Y los **umbrales** habilitados de cada variable en
   `dbo.ConfiguracionVariables` (hoy: vibración 4,5 mm/s y temperatura 65 °C;
   corriente y voltaje están deshabilitados).
3. **Calcula el período real**, siempre a partir de los datos:
   - `@hasta` = el último registro del equipo (o la fecha pedida, si es
     anterior);
   - con `@dias`: `@desde = @hasta − @dias días`;
   - si `@desde` cae antes del primer registro, se usa el primer registro.

   *Ejemplo:* último registro el 14/10 a las 03:59 y `@dias = 15` → el
   período va del 29/09 03:59 al 14/10 03:59.
4. **Lee la historia previa.** Para saber si un ciclo ya estaba "en evento",
   empieza a leer desde el último mantenimiento anterior al período, no
   desde `@desde`.
5. **Arma los registros** (tabla temporal `#r`). Un *registro* es el grupo de
   filas de `dbo.Mediciones` con el mismo `event_time` (el mismo minuto). De
   cada registro guarda tres cosas:
   - la corriente;
   - el `ESTADO_MOTOR`;
   - si tiene **marca**: alguna variable habilitada fuera de su umbral.
6. **Clasifica cada registro** (tabla `#c`). El tiempo hasta el siguiente
   registro se asigna al registro actual. Las reglas se aplican en este
   orden y gana la primera que se cumple:

   | Regla | Condición | Estado |
   |---|---|---|
   | 1 | Hasta el siguiente registro pasan más de 30 min (hueco) | **MANTENIMIENTO**, y el siguiente registro abre un ciclo nuevo |
   | 3 | El ciclo entró en "estado de evento" (ver abajo) | **EVENTO** |
   | 4a | Corriente > 0,1 A (sin corriente: `ESTADO_MOTOR` ≠ 0) | **ENCENDIDO** |
   | 4b | Corriente ≤ 0,1 A y hubo alguna marca desde el último mantenimiento | **EVENTO** |
   | 4c | Corriente ≤ 0,1 A sin marcas | **APAGADO** |

   **La regla 2 (contadores del ciclo).** Un *ciclo* es el tramo entre dos
   mantenimientos. En cada ciclo se van contando, registro por registro, las
   lecturas con el motor encendido y las encendidas con marca:

   ```
   porcentaje = encendidos con marca ÷ encendidos × 100
   ```

   Si en algún momento supera 30 %, el ciclo queda "en estado de evento"
   desde ese registro hasta el siguiente mantenimiento.

   *Ejemplo:*
   - Un ciclo lleva 1 000 registros encendidos y 12 tienen marca: 1,2 %. No
     entra en evento.
   - El motor se detiene (corriente 0,03 A) después de esas 12 marcas: esos
     minutos de parada son EVENTO por la regla 4b, no APAGADO.
7. **Recorta al período y forma bloques** (tabla `#t`). A cada registro se le
   recorta su tramo para que no se salga del período. Los registros seguidos
   con el mismo estado se numeran como un mismo **bloque** (por ejemplo, "de
   06:17 a 21:45 ENCENDIDO").
8. **Devuelve cuatro conjuntos de resultados:**

   | # | Contenido | Columnas principales |
   |---|---|---|
   | 1 | Resumen | `desde`, `hasta`, `primer_registro`, `ultimo_registro`, `min_encendido`, `min_apagado`, `min_evento`, `min_mantenimiento`, `estado_actual` (estado del último registro) |
   | 2 | Ciclos que tocan el período | `inicio`, `registros_encendido`, `registros_encendido_con_evento`, `porcentaje`, `estado_evento`… |
   | 3 | Mantenimientos detectados | `inicio`, `fin`, `duracion_min` |
   | 4 | Bloques (solo con `@detalle = 1`) | `inicio`, `fin`, `segmento`, `regla`, `minutos`, `marcas` |

   Los minutos de cada estado se suman como
   `segundos entre el inicio y el fin de cada tramo ÷ 60`.

   El endpoint `/bloques` solo usa los resultados 1 y 4; los resultados 2 y 3
   los usa `/resumen`, que el dashboard ya no llama.

El procedimiento **solo lee**: nunca modifica `dbo.Mediciones`.

#### D.2 `dbo.sp_vx_tendencia_variable` (archivo `database/procedures/R__sp_vx_tendencia_variable.sql`)

Prepara los puntos de la gráfica de una variable:

1. Busca el equipo y la variable (`dbo.Variables`; de ahí sale la unidad,
   p. ej. `°C`).
2. Calcula el período igual que el anterior:
   - `@hasta` = el último registro;
   - con `@dias`, el inicio es `@hasta − @dias días + 1 ms`, para no contar
     dos veces el minuto del borde;
   - nunca antes del primer registro.
3. **Elige el tamaño de cada punto** según la duración del período, para que
   la gráfica no pase de unos 400 puntos:

   | Duración del período | Un punto cada |
   |---|---|
   | hasta 2 días | 15 min |
   | hasta 16 días | 1 h |
   | hasta 60 días | 4 h |
   | más de 60 días | 1 día |

4. **Agrupa cada lectura en su intervalo**, contando los minutos desde una
   medianoche fija (01/01/2000):

   ```
   inicio del intervalo = origen + ⌊minutos desde el origen ÷ tamaño⌋ × tamaño
   ```

   *Ejemplo:* una lectura de las 07:37 con puntos de 60 min cae en el
   intervalo de las 07:00; con puntos de 15 min, en el de las 07:30.
5. **Descarta las lecturas con el motor apagado**, con el mismo criterio que
   D.1: corriente > 0,1 A, o sin corriente `ESTADO_MOTOR` ≠ 0. Con el motor
   apagado los valores están cerca de cero y bajarían el promedio.
6. **Devuelve dos conjuntos de resultados:**

   | # | Contenido | Columnas |
   |---|---|---|
   | 1 | Cabecera | `unidad`, `fecha_referencia` (fin), `desde`, `minutos_punto`, `umbral_min`, `umbral_max`, `umbral_habilitado` |
   | 2 | Un renglón por intervalo | `inicio`, `dia`, `promedio` (AVG), `minimo` (MIN), `maximo` (MAX), `lecturas` (COUNT), `marcas` (lecturas fuera del umbral, solo si está habilitado) |

**E. Backend → frontend — respuesta**

Express convierte las fechas a texto ISO en UTC (terminan en `Z`).

*`GET /api/equipos/CERO-010`:*

```json
{ "encontrado": true, "codigo": "CERO-010",
  "nombre": "Aplicador CERO Línea 1 - Esmaltado", "area": "Líneas de Esmaltado" }
```

*`GET /api/equipos/CERO-010/bloques?dias=15`.* `findBloques()` hace tres
transformaciones:
- `cabeceraResumen()` renombra `hasta` → `fecha_referencia`;
- pasa los minutos a horas con dos decimales (`horasDeMinutos`: 10 954,8 min ÷ 60 = 182,58 h);
- ordena los bloques del más reciente al más antiguo (`.reverse()`).

```json
{
  "fecha_referencia": "2026-10-14T03:59:00.000Z",
  "desde": "2026-09-29T03:59:00.000Z",
  "primer_registro": "2026-07-13T00:00:00.000Z",
  "ultimo_registro": "2026-10-14T03:59:00.000Z",
  "horas": { "ENCENDIDO": 182.58, "APAGADO": 167.4, "EVENTO": 0, "MANTENIMIENTO": 10.02 },
  "estado_actual": "APAGADO",
  "bloques": [
    { "inicio": "2026-10-13T21:45:00.000Z", "fin": "2026-10-14T03:59:00.000Z",
      "duracion_min": 374, "segmento": "APAGADO", "regla": "4c corriente 0 sin marcas", "marcas": 0 },
    { "inicio": "2026-10-13T06:17:00.000Z", "fin": "2026-10-13T21:45:00.000Z",
      "duracion_min": 928, "segmento": "ENCENDIDO", "regla": "4a corriente > 0", "marcas": 0 }
  ]
}
```

Comprobación: 182,58 + 167,4 + 0 + 10,02 = 360 h, exactamente 15 días.

*`GET /api/equipos/CERO-010/mediciones?variable=TEMPERATURA_MOT&dias=7`.*
`findMediciones()` redondea a 3 decimales y arma `umbral` (o `null` si la
variable no tiene umbral):

```json
{
  "variable": "TEMPERATURA_MOT", "unidad": "°C",
  "fecha_referencia": "2026-10-14T03:59:00.000Z", "desde": "2026-10-07T03:59:00.001Z",
  "minutos_punto": 60,
  "umbral": { "min": null, "max": 65, "habilitado": true },
  "puntos": [
    { "inicio": "2026-10-07T06:00:00.000Z", "dia": "2026-10-07", "promedio": 39.393,
      "minimo": 29.673, "maximo": 46.635, "lecturas": 44, "marcas": 0 },
    { "inicio": "2026-10-07T07:00:00.000Z", "dia": "2026-10-07", "promedio": 51.316,
      "minimo": 46.725, "maximo": 54.369, "lecturas": 60, "marcas": 0 }
  ]
}
```

El primer punto tiene 44 lecturas y no 60 porque el motor encendió a las
06:16: solo 44 minutos de esa hora fueron con el motor encendido.

**F. Frontend — visualización**

1. **Verificación en el árbol.** Con la respuesta de `fetchEquipo`:
   - mientras espera, una ruedita junto al equipo;
   - si fue correcta, un ✓ verde;
   - si hubo error, un "!" rojo y el mensaje debajo del equipo (p. ej. "Equipo
     no encontrado").
2. **Dona** (`donutFromBloques()` en `DashboardPage.tsx` → `DonutPanel.tsx`).

   *Transformación.* Redondea las horas de cada estado (`Math.round`) y las
   suma para el total.

   *Ejemplo con 15 días:* 183 + 167 + 0 + 10 = 360 h en el centro ("360H").

   *Cálculo del dibujo.* La dona es un círculo SVG de 200 px con un trazo de
   22 px:

   ```
   radio         = (200 − 22) ÷ 2 = 89 px
   circunferencia = 2 × π × 89 ≈ 559,2 px
   largo del arco = horas del estado ÷ horas totales × 559,2
   ```

   | Estado | Horas | Arco | Empieza en (offset) |
   |---|---|---|---|
   | Encendido (azul oscuro) | 183 | 183 ÷ 360 × 559,2 ≈ 284,3 px | 0 |
   | Apagado (gris) | 167 | ≈ 259,4 px | −284,3 |
   | Evento (rojo) | 0 | 0 | — |
   | Mantenimiento (naranja) | 10 | ≈ 15,5 px | −543,7 |

   Cada arco empieza donde terminó el anterior. Todo se gira −90° para que
   la dona empiece arriba, en las 12 del reloj.

   *Texto del centro.* "Del 29/09 al 14/10", el año ("2026") y "(última
   medición)" si el período llega al último registro. Si `fecha_referencia`
   cae justo a las 00:00, la función `ultimoDia()` muestra el día anterior,
   porque ese 00:00 ya no pertenece al período.
3. **Estado del motor.** `estado_actual` reemplaza el "Estado:" de
   `DonutPanel`, con el color del estado. Producto y Línea siguen siendo
   valores fijos de `mockData.ts`.
4. **Tabla de eventos** (`EventsSummary.tsx`). Una fila por bloque, del más
   reciente (#1) al más antiguo:
   - inicio y fin con la fecha arriba y la hora debajo, en UTC;
   - duración `duracion_min ÷ 60` con un decimal (928 min → "15,5 h");
   - estado con su color;
   - al pasar el mouse, la regla que lo decidió.
5. **Gráfica de tendencia** (`TrendChart.tsx`). Los cálculos se explican en
   el disparador 6.
6. **Mientras carga:**
   - la dona muestra ceros y "Cargando horas…";
   - la tabla, "Cargando eventos…";
   - la gráfica, "Cargando mediciones…".
   Si hay error, se muestra el mensaje del backend en rojo.

**G. Modo demo**
- La verificación no se hace (la clave de `useBackend` es `null` en demo): no
  hay ruedita ni ✓.
- La dona y la tabla salen de `bloquesDemo()` → `demoBloquesData()`
  (`bloques.service.ts`), que simula el estado **minuto a minuto** con los
  perfiles de `DEMO_PERFILES`:
  - turnos de lunes a viernes de 06 a 22 h y sábado de 06 a 14 h; domingo
    apagado;
  - mantenimientos y una marca de evento de 10 min;
  - CERO-013 lanza "Equipo no encontrado" para probar el error.
- La gráfica sale de `medicionesDemo()` → `demoMedicionesData()`
  (`operacion.service.ts`), que inventa una lectura por minuto en los
  bloques ENCENDIDO y las agrupa igual que el procedimiento D.2.

---

## 5. Disparador 3 — Botones de período de la tabla (7 días, 15 días, 30 días, Todo)

**A. Frontend — captura**
1. Los botones son botones de opción (*radio*) en `EventsSummary.tsx`. Su
   lista es `RANGE_OPTIONS`: 7, 15, 30 y `null` (Todo).
2. Al elegir uno se llama a `onPeriodoChange({ dias })`, que es `setPeriodo`
   de `DashboardPage.tsx`. Cambia el **período compartido**, por ejemplo
   `{ dias: 15 }`.
3. Queda marcado el botón para el que `esDias(periodo, dias)` es verdadero.
   Con un rango de fechas libre no queda ninguno marcado.
4. Reaccionan:
   - la dona;
   - el estado del motor;
   - la tabla;
   - la gráfica;
   - los dos campos de fecha (`PeriodoSelector`), que pasan a mostrar las
     fechas reales del nuevo período.

**B. Frontend → backend — peticiones**

Ejemplo con CERO-010 y corriente:

| Botón | Peticiones |
|---|---|
| 7 días | `GET /api/equipos/CERO-010/bloques?dias=7` y `GET /api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR&dias=7` |
| 15 días | igual, con `dias=15` |
| 30 días | igual, con `dias=30` |
| Todo | `GET /api/equipos/CERO-010/bloques` y `GET /api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR` (sin período = toda la historia) |

No se vuelve a verificar el equipo. Si el usuario pulsa otro botón antes de
la respuesta, `useBackend` cancela las peticiones anteriores.

**C. Backend — procesamiento**

Igual que en 4.C. `leerPeriodo()` entrega `{ dias: 7 }`, o `{ dias: null }`
con "Todo". Los procedimientos reciben `@dias = 7, @desde = NULL, @hasta = NULL`,
o los tres en `NULL`.

**D. Base de datos — consulta**

Los mismos dos procedimientos (4.D.1 y 4.D.2). Lo que cambia es el período y,
con él, el tamaño de los puntos de la gráfica:

| Botón | Período calculado (último registro: 14/10 03:59) | Punto de la gráfica |
|---|---|---|
| 7 días | 07/10 03:59 → 14/10 03:59 | 1 h |
| 15 días | 29/09 03:59 → 14/10 03:59 | 1 h |
| 30 días | 14/09 03:59 → 14/10 03:59 | 4 h |
| Todo | 13/07 00:00 (primer registro) → 14/10 03:59 (≈ 93 días) | 1 día |

"Todo" es el cálculo más pesado. En el portátil de desarrollo, `/bloques`
con toda la historia tarda entre 2 y 8 s (2,4 s medido el 15/10).

**E. Backend → frontend — respuesta**

La misma forma de JSON que en 4.E.

**F. Frontend — visualización**

Igual que en 4.F. Además, `fechasDelPeriodo()` (en `DashboardPage.tsx`)
convierte `desde` y `fecha_referencia` en las fechas de los campos Desde y
Hasta (29/09/2026 y 14/10/2026). Mientras llega el período nuevo, los campos
conservan las fechas anteriores (`ultimosBloques`) para no parpadear.

**G. Modo demo**

`demoBloquesData()` aplica la misma regla: `hasta` = último registro simulado
(14/10 04:00 para CERO-010) y `desde = hasta − días`, sin bajar del primer
registro simulado.

---

## 6. Disparador 4 — Campos de fecha Desde / Hasta

**A. Frontend — captura**
1. El control es `PeriodoSelector.tsx`, dentro de `DonutFilters.tsx`: dos
   campos de fecha del navegador (`<input type="date">`), "Desde" y "Hasta",
   siempre visibles en una misma caja sobre la dona. No hay panel ni botón
   Aplicar.
2. Al hacer clic en un campo (o pulsar Enter) se abre el calendario del
   navegador (`showPicker()`), justo debajo de ese campo.
3. **Límites.** Los calendarios no dejan elegir fuera de los días con datos:
   - `min` y `max` salen de `primer_registro` y `ultimo_registro` (función
     `fechasDelPeriodo()`);
   - "Hasta" no admite una fecha anterior a "Desde".
4. **Se aplica al momento.** Cada cambio llama a `cambiar()`, que comprueba el
   rango sin consultar al backend (`errorDe()`):
   - si es válido → `onAplicar(desde, hasta)` → `onPeriodoChange({ desde, hasta })`
     → `setPeriodo`. El período compartido queda, por ejemplo,
     `{ desde: '2026-09-01', hasta: '2026-09-15' }`;
   - si "Desde" es posterior a "Hasta" → la caja se pone roja con "La fecha
     de inicio no puede ser posterior a la de fin" y **no se aplica**;
   - si un campo queda vacío (p. ej. con "Borrar") → no se aplica nada, y al
     salir del campo (`restaurar()`) vuelve la fecha anterior.
5. Reaccionan los mismos componentes que en el disparador 3. En la tabla no
   queda marcado ningún botón.

**B. Frontend → backend — peticiones**

```
GET /api/equipos/CERO-010/bloques?desde=2026-09-01&hasta=2026-09-15
GET /api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR&desde=2026-09-01&hasta=2026-09-15
```

Se cancelan igual que en 5.B si el período cambia antes de la respuesta: si
el usuario cambia "Desde" y enseguida "Hasta", solo cuenta el último rango.

**C. Backend — procesamiento**

`leerPeriodo()` revisa que las dos fechas sean reales y estén en orden (si
no, 400). Convierte el rango en `desde = 01/09 00:00` y
`hasta = 16/09 00:00`: le suma un día para incluir el 15 completo. Los
procedimientos reciben `@desde` y `@hasta`, con `@dias = NULL`.

**D. Base de datos — consulta**

Los mismos procedimientos (4.D). Ambos **recortan** `@hasta` al último
registro: si se pide hasta el 20/10 pero el último dato es del 14/10, el
período termina el 14/10. Un rango de 15 días da puntos de 1 h en la gráfica.

**E y F.** Igual que en 4.E y 4.F. Como el período no llega al último
registro, la dona **no** muestra "(última medición)".

**G. Modo demo**

`demoBloquesData()` detecta el rango (`esRango(periodo)`): toma
`desde = 00:00 del día de inicio` y `hasta = 24:00 del día final`, recortado
al último registro simulado.

---

## 7. Disparador 5 — Cambio de unidad de la dona (h / d / sem / mes)

**A. Frontend — captura**

Las opciones "Horas / Días / Sem / Meses" son botones de opción en
`DonutPanel.tsx`. Al elegir una se cambia un estado **local** del propio
componente: `unitId` (`useState`). No se toca el período ni ningún otro
componente.

**B. Frontend → backend — petición**

**No hay petición.** Las horas ya están en el navegador; solo cambia la
forma de mostrarlas.

**C, D y E.** No aplican: no interviene el backend ni la base de datos.

**F. Frontend — visualización (el cálculo)**

La función `formatValue()` divide las horas por las horas que tiene cada
unidad (tabla `TIME_UNITS`) y muestra un decimal. La forma de la dona no
cambia, porque las proporciones son las mismas.

| Unidad | Horas por unidad | 360 h se muestran como | Letra en el centro |
|---|---|---|---|
| Horas | 1 | 360 | 360**H** |
| Días | 24 | 360 ÷ 24 = 15,0 | 15,0**D** |
| Semanas | 168 (7 × 24) | 360 ÷ 168 ≈ 2,1 | 2,1**S** |
| Meses | 720 (30 × 24) | 360 ÷ 720 = 0,5 | 0,5**M** |

La leyenda usa el mismo cálculo. En teléfono las abreviaturas son más cortas
("s" y "m" en lugar de "sem" y "mes"), según `useIsMobile()`.

**G. Modo demo**

Funciona exactamente igual: nunca usa el backend.

---

## 8. Disparador 6 — Selector de variable de la tendencia

**A. Frontend — captura**
1. Los botones de opción están en `TrendVariablePicker.tsx`. Al elegir uno se
   llama a `onChange(v.id)`, que es `setVariableId` de `DashboardPage.tsx`.
2. Con ese `id`, `DashboardPage` busca la variable en
   `mockData.trendVariables`. Cada una trae:
   - su código en la base (`codigo`, p. ej. `VIBRACION_MOT`);
   - su unidad;
   - su forma de línea (`curva: 'suave'` en temperatura y vibración).
3. Solo reacciona la gráfica (`TrendChart`). La dona y la tabla no cambian.

**B. Frontend → backend — petición**

| Variable | Petición (período de 30 días) |
|---|---|
| Corriente | `GET /api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR&dias=30` |
| Vibración | `…?variable=VIBRACION_MOT&dias=30` |
| Temperatura | `…?variable=TEMPERATURA_MOT&dias=30` |
| Voltaje | `…?variable=VOLTAJE_MOTOR&dias=30` |
| Producción | **ninguna**: no existe en la base; se dibujan 7 valores fijos de `mockData.ts` con el aviso "Datos simulados: no hay una variable de producción en la base de datos" |

- `/bloques` no se vuelve a pedir: ya está cargado para ese CERO y período.
- Si el usuario cambia de variable antes de la respuesta, `useBackend`
  cancela la petición anterior.
- En modo Detalle, la petición se reparte en tramos (disparador 7).

**C. Backend — procesamiento**

`getMediciones()` valida la variable y el período, y llama a
`findMediciones()`. Esta ejecuta:

```
EXEC dbo.sp_vx_tendencia_variable @equipo_codigo='CERO-010', @variable_codigo='VIBRACION_MOT', @dias=30
```

No envía `@minutos_punto`, así que el procedimiento elige el tamaño de punto
automáticamente.

**D. Base de datos — consulta**

`dbo.sp_vx_tendencia_variable`, explicado en 4.D.2.

**E. Backend → frontend — respuesta**

La forma de JSON de `/mediciones` (ver 4.E).

**F. Frontend — visualización: los cálculos de la gráfica en modo Resumen**

1. **De JSON a puntos.** `puntosMedidos` (en `DashboardPage.tsx`) convierte
   cada renglón en un punto:
   - tiempo `t` = mitad del intervalo (`inicio + tamaño ÷ 2`), así el punto de
     07:00 a 08:00 se ubica a las 07:30;
   - `max` = `maximo`: **lo que se dibuja**;
   - `value` = `promedio`: solo aparece en el globo de ayuda;
   - `lecturas` = minutos encendidos del intervalo.
2. **La línea roja de referencia.** `lineaReferencia()` en
   `referenciasTendencia.ts`.
   - Mientras `USAR_REFERENCIAS_DEMO = true`, usa los valores **DEMO**:
     corriente 6,3 A, vibración 3,4 mm/s, temperatura 64 °C, voltaje 225 V y
     producción 100. Están justo por encima del máximo de la operación normal
     simulada.
   - Con datos reales usará `umbral.max`, que viene en la respuesta de
     `/mediciones`.
3. **La escala vertical** (`escalaY`):
   - toma el valor más bajo y el más alto, incluida la línea roja;
   - les suma un 12 % de margen arriba y abajo;
   - elige un paso "redondo" (1, 2, 2,5 o 5 × 10ⁿ) para unas 4 marcas. *Ejemplo:* de 4,9 a 6,3 A sale un paso de 0,5 → 5,0 · 5,5 · 6,0, y en rojo 6,3.
4. **Resumen = solo tiempo encendido** (`serieResumen`).
   - Cada punto ocupa un ancho proporcional a sus minutos encendidos, así que
     paradas y mantenimientos no ocupan espacio.
   - *Ejemplo:* tres puntos con 44, 60 y 60 lecturas suman 164 min. Se ubican
     en el 13 %, el 45 % y el 82 % del ancho:
     - (22 ÷ 164);
     - ((44 + 30) ÷ 164);
     - ((104 + 30) ÷ 164).
   - Si hay más puntos que espacio (más de uno cada 3 px), se juntan vecinos
     quedándose con el **más alto**, para no esconder picos.
5. **Episodios** (`episodios`). Puntos consecutivos con máximo ≥ la línea
   roja forman un episodio, que se marca **con un solo punto rojo en su
   pico**. Una parada entre dos puntos corta el episodio.
   - *Ejemplo:* con la línea en 64 y máximos 62 · 65 · 66 · 63 · 65 hay dos
     episodios.
   - El primero es 65–66 y su punto rojo va en 66.
   - El segundo es 65 y su punto rojo va en 65.
6. **La forma de la línea** (`trazado`).
   - Corriente y voltaje usan rectas entre puntos, para que se vean los
     saltos.
   - Temperatura y vibración usan una **curva monótona**: pasa exactamente
     por cada punto y en los picos y valles tiene pendiente plana. Así nunca
     sube por encima de un valor real ni inventa valores entre puntos.
7. **Fechas del eje horizontal.** El inicio de cada día con motor encendido
   ("29/09"). Se omiten las que se encimarían.
8. **Tamaño real.** La gráfica mide su caja con `ResizeObserver` y dibuja a
   1 unidad = 1 píxel, con letra de 11 px en cualquier pantalla.

**G. Modo demo**

`medicionesDemo()` → `demoMedicionesData()` inventa una lectura por minuto en
cada bloque ENCENDIDO simulado:

```
valor = base + calentamiento × (1 − e^(−horas desde las 06:00 ÷ 2,5)) + ruido
```

*Ejemplo:* la temperatura arranca en 40 °C y sube hacia 62 °C durante el
turno. Durante la marca simulada usa un valor de pico. Después agrupa las
lecturas como el procedimiento (promedio, mínimo, máximo, lecturas y marcas
por intervalo).

---

## 9. Disparador 7 — Control Resumen | Detalle de la tendencia

**A. Frontend — captura**
1. Los dos botones están en el encabezado de `TrendChart.tsx`. Al pulsar uno
   se llama a `onModoChange`, que es `setTrendModo` de `DashboardPage.tsx`.
   El estado `trendModo` pasa a `'detalle'` o `'resumen'`.
2. Solo reacciona la gráfica.

**B. Frontend → backend — peticiones**

- **Resumen:** no hace una petición nueva. Reutiliza la de `/mediciones` del
  período, que sigue cargada.
- **Detalle:** pide intervalos más cortos. El backend no permite elegir el
  tamaño del punto, así que `fetchMedicionesDetalle()`
  (`operacion.service.ts`) **divide el período en tramos de fechas**:
  - si el período dura hasta 16 días, tramos de **2 días** (el procedimiento
    devuelve puntos de 15 min);
  - si dura más, tramos de **16 días** (puntos de 1 h);
  - como mucho 3 peticiones a la vez, para no saturar SQL Server.

  *Ejemplo con "7 días"* (del 07/10 al 14/10): 4 peticiones.

  ```
  GET /api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR&desde=2026-10-07&hasta=2026-10-08
  GET …&desde=2026-10-09&hasta=2026-10-10
  GET …&desde=2026-10-11&hasta=2026-10-12
  GET …&desde=2026-10-13&hasta=2026-10-14
  ```

  Con "Todo" (13/07 → 14/10) son 6 tramos de 16 días.

**Cuándo espera y cuándo se cancela.**
- Detalle necesita las fechas reales del período (`desde` y
  `fecha_referencia` de `/bloques`), así que espera a que lleguen.
- Si cambian el CERO, el período o la variable, `useBackend` cancela **todos**
  los tramos en curso.
- Al volver a Resumen y luego otra vez a Detalle, los tramos se piden de
  nuevo.

**C. Backend — procesamiento**

Cada tramo es una petición normal a `/mediciones` con `desde` y `hasta`
(ver 6.C y 8.C). El backend no sabe que forman parte de un conjunto.

**D. Base de datos — consulta**

`dbo.sp_vx_tendencia_variable` una vez por tramo. Como cada tramo dura 2 o
16 días, la regla de tamaño de 4.D.2 da 15 min o 1 h.

**E. Backend → frontend — respuesta y unión de los tramos**

Cada tramo devuelve el JSON de siempre. `fetchMedicionesDetalle()` los une
con `reagrupar()`:
1. Usa como tamaño el más grande que llegó; un último tramo corto podría
   venir con puntos más chicos.
2. Junta los puntos de cada intervalo:
   - promedio ponderado por lecturas;
   - mínimo de los mínimos;
   - máximo de los máximos;
   - suma de lecturas y de marcas.
3. Descarta lo que cae fuera del período.

*Ejemplo de promedio ponderado:* dos puntos de 15 min, uno con promedio 5,0
y 10 lecturas y otro con 5,6 y 5 lecturas, dan
(5,0 × 10 + 5,6 × 5) ÷ 15 = 5,2.

**F. Frontend — visualización: los cálculos del modo Detalle**

1. **Línea de tiempo continua** (`serieDetalle`).
   - Divide el período en casillas del tamaño del punto, alineadas a las
     00:00 UTC. *Ejemplo:* 7 días con casillas de 15 min = 672 casillas.
   - Una casilla **con dato** es "encendido" y se dibuja su máximo con línea
     azul.
   - Una casilla **sin dato** busca su estado en los bloques de `/bloques`,
     los mismos de la dona y la tabla:
     - si es mantenimiento, la línea baja hasta el eje;
     - si no, la línea queda tenue, casi pegada al eje.
2. **Bandas de fondo.** Los bloques EVENTO se pintan en rosa (#FFEBEE) y los
   MANTENIMIENTO en naranja claro (#FFF3E0), con la palabra "Mantenimiento"
   escrita en vertical si cabe.
3. **Ancho desplazable.**
   - Base: 2 px por casilla de 15 min o 4 px por casilla de 1 h. *Ejemplo:*
     672 × 2 = 1 344 px para 7 días.
   - Si hace falta para que no se encimen las fechas de los episodios, se
     ensancha hasta 24 000 px como máximo.
   - El eje vertical queda fijo y el área se desplaza a los lados.
   - Al abrir Detalle, el scroll se coloca al final (lo más reciente).
4. **Hasta 50 marcas con fecha** (`elegirMarcadores`):
   - primero, los picos de los episodios, con su valor ("10,8 A"); si hay más
     de 50, los más altos, repartidos en el período;
   - después, los cambios de cada tramo encendido: cuándo empieza a subir, el
     pico y cuándo baja (sobre una media móvil de unas 2 h, para que el ruido
     no cuente), cuándo se apaga y cuándo vuelve a encender;
   - si dos fechas chocan, se omite la del pico más bajo; su punto rojo
     sigue visible.
5. La escala vertical, la línea roja, los episodios y la forma de la línea
   (recta o curva) son los mismos de 8.F.

**G. Modo demo**

No hay tramos. `medicionesDemo(…, true)` llama a `demoMedicionesData()`
pidiendo directamente intervalos de 15 min (período de hasta 16 días) o de
1 h (más largo), según `minutosDetalle()`.

---

## 10. Disparador 8 — Carga inicial del dashboard

**A. Frontend — captura**
1. Al abrir la página, `App.tsx` llama a `getStoredToken()`:
   - si hay un token vigente en `localStorage`, muestra el dashboard
     directamente;
   - si no, muestra el login (disparador 1).
2. Al montarse, `DashboardPage.tsx` arranca con estos estados:

   | Estado | Valor inicial |
   |---|---|
   | `ruta` | la guardada en `localStorage` (`vx_ruta`) por `rutaGuardada()`; si no hay ninguna, o algún nivel ya no existe en `jerarquiaDemo.ts`, la raíz (ninguna selección) |
   | `periodo` | `{ dias: 30 }` (`PERIODO_INICIAL`) |
   | `variableId` | `'corriente'` |
   | `trendModo` | `'resumen'` |

   **Ya no hay un equipo por defecto**: el CERO sale de la ruta restaurada.

**B. Frontend → backend — peticiones**

- **Sin ruta guardada** (primera visita), o con una ruta sin CERO: ninguna
  petición. Las tarjetas dicen "Elige un equipo para ver su información" (o
  el mensaje de 4.A.3).
- **Con una ruta que llega a un CERO**, por ejemplo CERO-010: tres
  peticiones en paralelo, como en el disparador 2.

  ```
  GET /api/equipos/CERO-010
  GET /api/equipos/CERO-010/bloques?dias=30
  GET /api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR&dias=30
  ```

Ninguna petición lleva el token.

**C, D y E.** Igual que en 4.C, 4.D y 4.E. Con 30 días, la gráfica recibe
puntos de 4 h.

**F. Frontend — visualización**
1. Mientras llegan los datos:
   - los campos de fecha están vacíos y desactivados (solo la primera vez);
   - la dona está en cero con "Cargando horas…";
   - la tabla dice "Cargando eventos…";
   - la gráfica dice "Cargando mediciones…".
2. Al llegar `/bloques` se dibujan la dona, el estado del motor y la tabla, y
   los campos muestran las fechas del período.
3. Al llegar `/mediciones` se dibuja la gráfica en modo Resumen.
4. Si el backend aún no estaba listo, el usuario ve "Sin conexión con el
   servidor". Pasa, por ejemplo, si el navegador abrió antes de que el
   backend conectara con SQL Server. El dashboard **no reintenta solo**: hay
   que cambiar de equipo o de período (o recargar la página).

**G. Modo demo**

No hay peticiones. `bloquesDemo()` y `medicionesDemo()` calculan los datos al
instante dentro del navegador. El resultado se ve igual, terminando en el
último registro simulado (14/10).

---

## 11. Tabla resumen

| Disparador | Función del frontend | Endpoint | Procedimiento almacenado | Componente que muestra el resultado |
|---|---|---|---|---|
| 1. Inicio de sesión | `LoginForm.handleSubmit` → `login()` (`auth.service.ts`) | `POST /api/identity/login` | Ninguno (consulta directa a `Usuarios` / `UsuarioRoles` / `Roles` + bcrypt) | `LoginForm` (error) → `App` cambia a `DashboardPage` |
| 2. Equipo en el árbol | `ArbolEquipos` → `cambiarRuta()` → `seleccionDe()` → `fetchEquipo()`, `fetchBloques()`, `fetchMediciones()` (solo con un CERO) | `GET /api/equipos/:codigo`, `…/bloques`, `…/mediciones` | Ninguno para `:codigo` (consulta a `EquiposCero` + `Areas`); `sp_vx_resumen_estados`; `sp_vx_tendencia_variable` | `ArbolEquipos` (✓ / !), `DonutPanel`, `EventsSummary`, `TrendChart` (o los avisos sin datos) |
| 3. Botones 7 / 15 / 30 días / Todo | `EventsSummary` → `setPeriodo({ dias })` → `fetchBloques()`, `fetchMediciones()` | `…/bloques?dias=N`, `…/mediciones?variable=…&dias=N` (sin `dias` en Todo) | `sp_vx_resumen_estados`, `sp_vx_tendencia_variable` | `DonutPanel`, `EventsSummary`, `TrendChart`, `PeriodoSelector` (fechas) |
| 4. Campos Desde / Hasta | `PeriodoSelector.cambiar` → `setPeriodo({ desde, hasta })` → `fetchBloques()`, `fetchMediciones()` | `…/bloques?desde=…&hasta=…`, `…/mediciones?variable=…&desde=…&hasta=…` | `sp_vx_resumen_estados`, `sp_vx_tendencia_variable` | `DonutPanel`, `EventsSummary`, `TrendChart` |
| 5. Unidad de la dona | `DonutPanel` → `setUnitId` → `formatValue()` | Ninguno | Ninguno | `DonutPanel` (centro y leyenda) |
| 6. Variable de la tendencia | `TrendVariablePicker` → `setVariableId` → `fetchMediciones()` (Producción: ninguna) | `…/mediciones?variable=CODIGO&…` | `sp_vx_tendencia_variable` | `TrendChart` |
| 7. Resumen \| Detalle | `TrendChart` → `setTrendModo` → (Detalle) `fetchMedicionesDetalle()` | Resumen: ninguno nuevo; Detalle: `…/mediciones?variable=…&desde=…&hasta=…` por tramos de 2 o 16 días | `sp_vx_tendencia_variable` (una vez por tramo) | `TrendChart` |
| 8. Carga inicial | `App` (`getStoredToken`) → `DashboardPage` (`rutaGuardada()`) → con un CERO: `fetchEquipo()`, `fetchBloques()`, `fetchMediciones()` | Sin ruta: ninguno. Con CERO-010: `…/CERO-010`, `…/CERO-010/bloques?dias=30`, `…/CERO-010/mediciones?variable=CORRIENTE_MOTOR&dias=30` | `sp_vx_resumen_estados`, `sp_vx_tendencia_variable` | `ArbolEquipos`, `DonutPanel`, `EventsSummary`, `TrendChart`, `PeriodoSelector` |
