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
- **Dashboard** (`src/modules/dashboard/`): datos simulados (`mockData.ts`, `donutSimulation.ts`).
  - Selectores CERO / Período. Al cambiar el CERO se consulta `GET /api/equipos/:codigo` (`equipos.service.ts`):
    - mientras espera, spinner;
    - si existe, borde verde y ✓;
    - si responde 404, 503 o hay error de red, borde rojo y banner con el mensaje del backend.
    - Si el usuario cambia de nuevo, se cancela la consulta anterior. En modo demo no se consulta.
  - Panel de la dona: info del motor, unidades h/d/sem/mes y leyenda en una sola fila.
  - Tendencia con selector de variable y línea nominal.
  - **Resumen de eventos** (`EventsSummary.tsx`, `useIntervalos.ts`, `intervalos.service.ts`), en el lugar de las antiguas barras por turno:
    - tabla Inicio / Fin / Duración / Estado con los intervalos del CERO seleccionado, y selector 7 / 15 / 30 días / Todo (por defecto 30);
    - `PARADA_NORMAL` → Apagado, `MANTENIMIENTO` → Mantenimiento, `null` → En marcha ▶; las horas se muestran en UTC, tal como están guardadas;
    - modo normal: `GET /api/equipos/:codigo/intervalos`;
    - modo demo: datos simulados para CERO-010/011/012, y CERO-013 devuelve "Equipo no encontrado" para probar el error.
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
- **`GET /api/equipos/:codigo/intervalos?dias=N`**: intervalos de `dbo.IntervalosFuncionamiento` de un equipo activo, del más reciente al más antiguo.
  - 200 `{ fecha_referencia, intervalos: [{ inicio, fin, duracion_min, tipo_cierre }] }`.
  - `fecha_referencia` = `MAX(fin)` del equipo, o `MAX(inicio)` si solo hay intervalos abiertos. Nunca se usa el reloj del servidor.
  - Con `dias`, solo los intervalos con `inicio >= fecha_referencia - N días`; sin `dias`, todos.
  - Si el equipo no tiene intervalos: `{ fecha_referencia: null, intervalos: [] }` (es el caso de CERO-011).
  - 400 si `dias` no es un entero de 1 a 3650; 404 / 503 / 500 con `{ mensaje }`.
- Pendiente:
  - middlewares `authenticate` / `authorize` / `reauthenticate` (vacíos), así que todavía no hay rutas protegidas;
  - el resto de dominios (data-acquisition, hours-calculation, mantenimiento, audit), que son archivos vacíos.
- La autenticación final será contra el Directorio Activo corporativo; la tabla de usuarios es para la demo.

### Base de datos (`database/`) — SQL Server, bases `VERTEX_DEMO` y `VERTEX_REAL`
- Migraciones `V001`–`V005`, procedimientos `R__*`, seeds `01`–`03` e instalador `database/scripts/01_install_databases.sql`.
- Varios `.sql` están en **UTF-16**: para buscar en ellos, decodificarlos primero; `grep` no los lee.
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
index.html             Página estática antigua ("Dashboard - Inicio"), no es la app React
```

## Variables de entorno

Ningún `.env` se sube a git (`.gitignore`). Cada carpeta tiene su `.env.example`.

**`apps/backend/.env`**

| Variable | Uso |
|---|---|
| `DB_SERVER`, `DB_PORT` | SQL Server (por defecto `localhost`, `1433`) |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `app_demo_user` sobre `VERTEX_DEMO` |
| `DB_TRUST_SERVER_CERTIFICATE` | `true` por defecto (certificado autofirmado local) |
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
