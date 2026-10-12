<#
.SYNOPSIS
    Instala VERTEX_DEMO y/o VERTEX_REAL en SQL Server.

.DESCRIPTION
    Orden de ejecucion:
      1. database\scripts\01_install_databases.sql  (en master)
      2. database\migrations\V*.sql                 (en cada BD)
      3. database\procedures\R__*.sql               (en cada BD)
      4. database\seeds\*.sql                       (solo en VERTEX_DEMO)

    Lee las contraseñas de los logins de VARIABLES DE ENTORNO.
    NUNCA escribe contraseñas en archivos.

.PARAMETER Target
    demo  = solo VERTEX_DEMO (migraciones + seeds)
    real  = solo VERTEX_REAL (solo migraciones)
    all   = ambas bases (default)

.PARAMETER Server
    Instancia SQL Server. Default: localhost,1433

.PARAMETER SkipCreateDb
    Si se indica, omite la creacion de bases y logins
    (util cuando ya existen y solo quieres reaplicar migraciones).

.EXAMPLE
    # Primera instalacion completa:
    $env:VERTEX_DEMO_APP_USER_PWD = "<define-tu-contraseña>"
    $env:VERTEX_REAL_APP_USER_PWD = "<define-tu-contraseña>"
    .\instalar.ps1

    # Solo demo:
    .\instalar.ps1 -Target demo

    # Solo replicar migraciones sin recrear bases:
    .\instalar.ps1 -SkipCreateDb

.NOTES
    Requiere: sqlcmd en PATH
    Autenticacion: Windows (sa/sysadmin) para crear bases y logins.
    Si usas sa, agrega: -U sa -P <pwd> en la funcion Invoke-SqlCmd
#>

[CmdletBinding()]
param(
    [ValidateSet('demo', 'real', 'all')]
    [string]$Target     = 'all',
    [string]$Server     = 'localhost,1433',
    [string]$DbDemo     = 'VERTEX_DEMO',
    [string]$DbReal     = 'VERTEX_REAL',
    [switch]$SkipCreateDb
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = $PSScriptRoot

# ---- Colores de salida ----
function Write-Step  ([string]$m) { Write-Host "`n[*] $m" -ForegroundColor Cyan    }
function Write-OK    ([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green  }
function Write-Warn  ([string]$m) { Write-Host "    >> $m"  -ForegroundColor Yellow }
function Write-Fail  ([string]$m) { Write-Host "    ERROR: $m" -ForegroundColor Red }

# ---- Verificar sqlcmd ----
if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
    Write-Fail "sqlcmd no encontrado en PATH."
    Write-Warn "Agrega la carpeta de SQL Server Tools al PATH, por ejemplo:"
    Write-Warn "  C:\Program Files\Microsoft SQL Server\160\Tools\Binn"
    exit 1
}

# ---- Funcion: ejecutar un archivo SQL en una base ----
function Invoke-SqlFile {
    param(
        [string]$FilePath,
        [string]$Database,
        [string]$Srv = $Server
    )
    $name = [System.IO.Path]::GetFileName($FilePath)
    Write-Host "      -> $name" -NoNewline

    # -b: aborta en error; -V 1: muestra mensajes de nivel 1+
    $output = & sqlcmd -S $Srv -E -d $Database -i "$FilePath" -b -V 1 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host " [FALLO]" -ForegroundColor Red
        Write-Host ($output -join "`n") -ForegroundColor Red
        throw "Fallo al ejecutar $name en $Database"
    }
    Write-Host " [OK]" -ForegroundColor Green
}

# ---- 1. Crear bases y logins ----
if (-not $SkipCreateDb) {
    Write-Step "Creando bases de datos y logins de aplicacion..."

    $demoPwd = $env:VERTEX_DEMO_APP_USER_PWD
    $realPwd = $env:VERTEX_REAL_APP_USER_PWD

    if (-not $demoPwd -or -not $realPwd) {
        Write-Warn "VERTEX_DEMO_APP_USER_PWD o VERTEX_REAL_APP_USER_PWD no definidas."
        Write-Warn "Las bases se crean pero los logins de aplicacion NO se crean."
        Write-Warn "Define las variables de entorno y vuelve a ejecutar para crearlos."

        # Crear solo las bases (sin logins)
        $sql = @"
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name='$DbDemo')
    CREATE DATABASE [$DbDemo] COLLATE Latin1_General_CI_AS;
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name='$DbReal')
    CREATE DATABASE [$DbReal] COLLATE Latin1_General_CI_AS;
ALTER DATABASE [$DbDemo] SET RECOVERY SIMPLE;
ALTER DATABASE [$DbReal] SET RECOVERY SIMPLE;
"@
        $tmp = [IO.Path]::GetTempFileName() + '.sql'
        $sql | Out-File $tmp -Encoding UTF8
        & sqlcmd -S $Server -E -d master -i $tmp -b -V 1
        Remove-Item $tmp -Force
        Write-OK "Bases creadas sin logins de aplicacion."
    }
    else {
        # Ejecutar el script completo (usa -v para inyectar contraseñas)
        $installScript = Join-Path $ScriptRoot 'database\scripts\01_install_databases.sql'
        if (-not (Test-Path $installScript)) {
            throw "No se encontro: $installScript"
        }

        $output = & sqlcmd -S $Server -E -d master `
            -v DEMO_PWD="'$($demoPwd.Replace("'","''"))'" `
            -v REAL_PWD="'$($realPwd.Replace("'","''"))'" `
            -i "$installScript" -b -V 1 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Error creando bases/logins"
            Write-Host ($output -join "`n")
            exit 1
        }
        Write-OK "Bases y logins creados/verificados."
    }
}
else {
    Write-Warn "SkipCreateDb activado: se omite la creacion de bases y logins."
}

# ---- Funcion: aplicar migraciones y procedimientos ----
function Apply-Schema {
    param([string]$Db)
    Write-Step "Aplicando esquema en $Db..."

    $migDir  = Join-Path $ScriptRoot 'database\migrations'
    $procDir = Join-Path $ScriptRoot 'database\procedures'

    if (-not (Test-Path $migDir))  { throw "No existe: $migDir"  }
    if (-not (Test-Path $procDir)) { throw "No existe: $procDir" }

    # Migraciones V*.sql en orden
    Get-ChildItem $migDir -Filter 'V*.sql' | Sort-Object Name | ForEach-Object {
        Invoke-SqlFile -FilePath $_.FullName -Database $Db
    }

    # Procedimientos R__*.sql (re-ejecutables, CREATE OR ALTER)
    Get-ChildItem $procDir -Filter 'R__*.sql' | Sort-Object Name | ForEach-Object {
        Invoke-SqlFile -FilePath $_.FullName -Database $Db
    }

    Write-OK "Esquema aplicado en $Db."
}

# ---- Funcion: aplicar seeds (solo DEMO) ----
function Apply-Seeds {
    param([string]$Db)
    Write-Step "Aplicando seeds en $Db (solo demo)..."

    $seedDir = Join-Path $ScriptRoot 'database\seeds'
    if (-not (Test-Path $seedDir)) { throw "No existe: $seedDir" }

    Get-ChildItem $seedDir -Filter '*.sql' | Sort-Object Name | ForEach-Object {
        Invoke-SqlFile -FilePath $_.FullName -Database $Db
    }

    Write-OK "Seeds aplicados en $Db."
}

# ---- Ejecutar segun Target ----
switch ($Target) {
    'demo' {
        Apply-Schema -Db $DbDemo
        Apply-Seeds  -Db $DbDemo
    }
    'real' {
        Apply-Schema -Db $DbReal
    }
    'all' {
        Apply-Schema -Db $DbDemo
        Apply-Seeds  -Db $DbDemo
        Apply-Schema -Db $DbReal
    }
}

# ---- Resumen ----
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " Instalacion completada  |  Target: $Target" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proximos pasos:" -ForegroundColor White
Write-Host "  1. Crea el archivo .env con las variables de tu .env.example"
Write-Host "  2. Ejecuta: npx ts-node scripts/create_demo_users.ts"
Write-Host "     para asignar contraseñas reales a los usuarios demo."
Write-Host "  3. Inicia el backend: npm run dev"
Write-Host ""
Write-Host "Para verificar la instalacion abre SSMS y conecta a: $Server"
Write-Host "Bases disponibles: $DbDemo, $DbReal"
