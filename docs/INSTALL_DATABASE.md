# VERTEX — Guía de Instalación de Base de Datos

> **Plataforma**: VERTEX · Cerámica Italia  
> **Motor**: SQL Server 2022 (localhost,1433, autenticación mixta activa)  
> **Bases**: `VERTEX_DEMO` (demostración con datos) · `VERTEX_REAL` (producción vacía)

---

## Requisitos previos

| Requisito | Versión mínima | Notas |
|-----------|---------------|-------|
| SQL Server | 2019 | Evaluación 2022 funciona igual |
| SSMS | 19 | Solo para verificación visual |
| PowerShell | 5.1 ó 7+ | Incluido en Windows 10/11 |
| `sqlcmd` | Cualquiera | Ver abajo si no está en PATH |
| Node.js | 18 LTS | Para `create_demo_users.ts` |

### Verificar que `sqlcmd` está en PATH

```powershell
sqlcmd -?
```

Si devuelve error, agrega su carpeta al PATH de tu sesión:

```powershell
# Ajusta la versión (160 = SQL Server 2022)
$env:PATH += ";C:\Program Files\Microsoft SQL Server\160\Tools\Binn"
```

Para hacerlo permanente: Panel de control → Variables de entorno → PATH del sistema.

---

## Estructura de archivos relevante

```
vertex/
├── database/
│   ├── scripts/
│   │   └── 01_install_databases.sql   ← Crea bases y logins SQL
│   ├── migrations/
│   │   ├── V001__create_databases_and_schema_migrations.sql
│   │   ├── V002__create_identity_and_assets.sql
│   │   ├── V003__create_acquisition_and_calculation.sql
│   │   ├── V004__create_maintenance_audit_config.sql
│   │   └── V005__create_indexes_and_views.sql
│   ├── procedures/
│   │   ├── R__sp_vx_get_horas_motor.sql
│   │   ├── R__sp_vx_get_serie_variable.sql
│   │   ├── R__sp_vx_modificar_medicion_demo.sql
│   │   ├── R__sp_vx_registrar_intervencion.sql
│   │   └── R__sp_vx_restablecer_demo.sql
│   └── seeds/
│       ├── 01_reference_data.sql      ← Roles, permisos, configuración
│       └── 02_demo_pilot_data.sql     ← Equipos, mediciones, intervenciones
├── scripts/
│   └── create_demo_users.ts           ← Asigna contraseñas a usuarios demo
├── instalar.ps1                       ← Script maestro de instalación
└── .env                               ← Variables de entorno (NO subir a git)
```

---

## Paso 1 — Definir contraseñas en variables de entorno

Las contraseñas **nunca se escriben en archivos**. Se pasan como variables de entorno en la sesión de PowerShell donde corre el instalador.

```powershell
# Contraseñas de los logins SQL de aplicación
$env:VERTEX_DEMO_APP_USER_PWD = "<define-tu-contraseña>"      # mínimo 8 chars, mayús, núm, símbolo
$env:VERTEX_REAL_APP_USER_PWD = "<define-tu-contraseña>"
```

> **Estas contraseñas** son las del login SQL `app_demo_user` / `app_real_user`.
> Son distintas de las contraseñas de los usuarios dentro de la aplicación.

---

## Paso 2 — Ejecutar el instalador

Abre PowerShell **como administrador** en la carpeta raíz del proyecto:

```powershell
cd C:\Users\ISLENDER\Desktop\VERTEX
.\instalar.ps1
```

El script realiza en orden:
1. Crea `VERTEX_DEMO` y `VERTEX_REAL` con `COLLATE Latin1_General_CI_AS`
2. Crea los logins `app_demo_user` (→ solo VERTEX_DEMO) y `app_real_user` (→ solo VERTEX_REAL)
3. Aplica migraciones `V*.sql` en ambas bases (orden numérico)
4. Aplica procedimientos `R__*.sql` en ambas bases
5. Aplica seeds `01_reference_data.sql` y `02_demo_pilot_data.sql` **solo en VERTEX_DEMO**

### Opciones del instalador

```powershell
# Solo base demo (migraciones + seeds):
.\instalar.ps1 -Target demo

# Solo base real (solo migraciones):
.\instalar.ps1 -Target real

# Replicar migraciones sin recrear bases (si ya existen):
.\instalar.ps1 -SkipCreateDb

# Servidor remoto o named instance:
.\instalar.ps1 -Server "MISERVIDOR\SQLEXPRESS"
```

---

## Paso 3 — Crear el archivo `.env`

Copia `.env.example` a `.env` y rellena todos los valores:

```powershell
Copy-Item .env.example .env
notepad .env
```

Variables mínimas para que arranque el backend:

```
VERTEX_DEMO_SERVER=localhost,1433
VERTEX_DEMO_DB=VERTEX_DEMO
VERTEX_DEMO_SA_USER=app_demo_user
VERTEX_DEMO_SA_PWD=Demo@2024!          # misma que usaste arriba

VERTEX_REAL_SERVER=localhost,1433
VERTEX_REAL_DB=VERTEX_REAL
VERTEX_REAL_SA_USER=app_real_user
VERTEX_REAL_SA_PWD=Real@2024!

JWT_SECRET=genera-un-valor-aleatorio-largo-aqui
NODE_ENV=development
```

---

## Paso 4 — Crear usuarios de demostración

Este paso convierte los hashes de marcador de posición del seed en hashes bcrypt reales, leyendo las contraseñas de variables de entorno.

### 4a. Instalar dependencias Node

```bash
npm install
# o si usas pnpm:
pnpm install
```

### 4b. Definir contraseñas de los 7 usuarios demo

```powershell
$env:DEMO_PWD_ADMIN     = "Admin@Demo2024!"
$env:DEMO_PWD_ING_MANT  = "Ing@Demo2024!"
$env:DEMO_PWD_TEC_MEC   = "TecM@Demo2024!"
$env:DEMO_PWD_TEC_ELEC  = "TecE@Demo2024!"
$env:DEMO_PWD_DIR_PROD  = "Dir@Demo2024!"
$env:DEMO_PWD_CONSULTA  = "Cons@Demo2024!"
$env:DEMO_PWD_AUDITOR   = "Audit@Demo2024!"
```

### 4c. Ejecutar el script

```bash
npx ts-node scripts/create_demo_users.ts
```

Salida esperada:

```
=== create_demo_users.ts ===
Conectando a VERTEX_DEMO...
Conectado a VERTEX_DEMO
  Procesando admin.demo...
  ✓ admin.demo -> hash actualizado, rol asignado
  Procesando ing.mantenimiento...
  ✓ ing.mantenimiento -> hash actualizado, rol asignado
  ...
=== Usuarios demo creados/actualizados correctamente ===
```

---

## Paso 5 — Verificar en SSMS

1. Conecta a `localhost,1433` con autenticación Windows
2. Expande **Bases de datos** → deberías ver `VERTEX_DEMO` y `VERTEX_REAL`
3. En `VERTEX_DEMO` → Tablas → verifica que existen `dbo.Usuarios`, `dbo.Mediciones`, etc.
4. Ejecuta para ver un resumen rápido:

```sql
USE VERTEX_DEMO;
SELECT COUNT(*) AS mediciones FROM dbo.Mediciones;         -- debe ser ~120
SELECT COUNT(*) AS usuarios   FROM dbo.Usuarios;           -- debe ser 3 (demo)
SELECT COUNT(*) AS resultados FROM dbo.ResultadosIndividuales; -- debe ser 5
GO
```

---

## Reinstalación / Re-aplicar migraciones

Si necesitas borrar todo y reinstalar:

```sql
-- En SSMS como sysadmin:
DROP DATABASE IF EXISTS VERTEX_DEMO;
DROP DATABASE IF EXISTS VERTEX_REAL;
DROP LOGIN app_demo_user;
DROP LOGIN app_real_user;
```

Luego vuelve al Paso 1.

Si solo quieres re-aplicar migraciones y procedimientos (sin perder datos):

```powershell
.\instalar.ps1 -SkipCreateDb
```

> Los `V*.sql` son idempotentes (usan `IF NOT EXISTS`) pero **no son re-ejecutables** en el
> sentido de que si el esquema ya existe no falla, simplemente no hace nada.
> Los `R__*.sql` son siempre re-ejecutables (`CREATE OR ALTER`).

---

## Restablecer demo al estado inicial (desde la app)

Una vez el backend esté corriendo, el usuario `admin.demo` (que tiene el permiso
`DEMO_RESTABLECER`) puede restablecer la demo al estado de los seeds ejecutando:

```
POST /api/demo/restablecer
Authorization: Bearer <token-admin.demo>
```

Esto llama internamente a `dbo.sp_vx_restablecer_demo`, que:
- Restaura los valores originales de mediciones modificadas
- Elimina intervenciones creadas durante la demo
- Resetea los contadores de ciclo
- Deja ResultadosIndividuales en estado inicial

---

## Solución de problemas comunes

### `sqlcmd: error al conectar`
- Verifica que SQL Server está activo: `Get-Service MSSQLSERVER` (o `MSSQL$SQLEXPRESS`)
- Verifica que TCP/IP está habilitado en SQL Server Configuration Manager
- Puerto 1433 debe estar abierto en el firewall de Windows

### `Login failed for user`
- La autenticación Windows (`-E`) requiere que el usuario de Windows sea sysadmin en SQL Server
- En SQL Server Configuration Manager confirma que está activo el modo de autenticación mixta
- Si usas autenticación SQL (`sa`), edita la función `Invoke-SqlFile` en `instalar.ps1` y agrega `-U sa -P <pwd>`

### `No se encontro: database\scripts\01_install_databases.sql`
- Ejecuta el script desde la carpeta raíz del proyecto (`C:\Users\ISLENDER\Desktop\VERTEX`)
- No uses `cd` a una subcarpeta antes de llamar `.\instalar.ps1`

### `Fallo al ejecutar V002... en VERTEX_DEMO`
- Revisa el mensaje de error; suele ser un conflicto de objeto ya existente
- Si quieres empezar desde cero: borra las bases desde SSMS y reinstala
- Si solo quieres re-aplicar: `.\instalar.ps1 -SkipCreateDb`

### `Variable de entorno requerida no definida`
- Asegúrate de definir las variables en la **misma sesión** de PowerShell o terminal donde ejecutas el script
- Las variables `$env:X = "..."` en PowerShell son solo de sesión; cierra y reabre → desaparecen

---

## Seguridad — Recordatorios

- **Nunca** subas `.env` a git (está en `.gitignore`)
- Las contraseñas de los usuarios demo se guardan **solo como hashes bcrypt** en la BD
- Los logins SQL `app_demo_user` / `app_real_user` tienen permisos mínimos (EXECUTE + SELECT en sus propias bases, sin permiso en la otra base)
- La cuenta `sa` no se usa en la aplicación; solo para la instalación inicial si no hay usuario Windows sysadmin disponible
