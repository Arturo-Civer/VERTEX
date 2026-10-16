<#
.SYNOPSIS
    Arranca el entorno de desarrollo de VERTEX.

.DESCRIPTION
    1. Verifica que SQL Server (servicio MSSQLSERVER) esta corriendo; si no, intenta arrancarlo.
    2. Abre una terminal con el backend  (apps\backend  -> npm run dev, puerto 3000).
    3. Abre una terminal con el frontend (apps\frontend -> npm run dev, puerto 5173).
    4. Espera a que el backend confirme la base de datos (GET /health -> db "conectada")
       y a que Vite responda; hace una peticion de calentamiento y abre el navegador.

    Para lanzarlo con doble clic usa el acceso directo "Iniciar VERTEX" del escritorio,
    o ejecuta:  powershell -ExecutionPolicy Bypass -File .\start-vertex.ps1
#>

$ErrorActionPreference = 'Stop'

$Root         = $PSScriptRoot
$BackendDir   = Join-Path $Root 'apps\backend'
$FrontendDir  = Join-Path $Root 'apps\frontend'
$SqlService   = 'MSSQLSERVER'
$BackendPort  = 3000
$FrontendPort = 5173
$FrontendUrl  = "http://localhost:$FrontendPort"
$HealthUrl    = "http://localhost:$BackendPort/health"
$EsperaMaxima = 90
# Calentamiento: las mismas consultas que hace el dashboard al elegir CERO-010
$Calentamiento = @(
    "http://localhost:$BackendPort/api/equipos/CERO-010/bloques?dias=30",
    "http://localhost:$BackendPort/api/equipos/CERO-010/mediciones?variable=CORRIENTE_MOTOR&dias=30"
)

$Host.UI.RawUI.WindowTitle = 'VERTEX - Inicio'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [!]  $msg" -ForegroundColor Yellow }

function Exit-WithError($msg) {
    Write-Host "    [X]  $msg" -ForegroundColor Red
    Read-Host "`nPulsa Enter para cerrar"
    exit 1
}

function Test-Port([int]$Port) {
    # Vite/Node pueden escuchar solo en IPv6 (::1), por eso se prueban ambas direcciones
    foreach ($addr in @('127.0.0.1', '::1')) {
        $ip = [System.Net.IPAddress]::Parse($addr)
        $client = New-Object System.Net.Sockets.TcpClient($ip.AddressFamily)
        try {
            $async = $client.BeginConnect($ip, $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(500) -and $client.Connected) { return $true }
        } catch {
        } finally {
            $client.Close()
        }
    }
    return $false
}

function Get-DbPort {
    $envFile = Join-Path $BackendDir '.env'
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^\s*DB_PORT\s*=\s*(\d+)' | Select-Object -First 1
        if ($line) { return [int]$line.Matches[0].Groups[1].Value }
    }
    return 1433
}

function Get-DbState {
    # null: el backend no responde; si no, el campo db de /health
    try {
        return (Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5).db
    } catch {
        return $null
    }
}

function Start-DevTerminal($Title, $Dir) {
    $cmd = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location -LiteralPath '$Dir'; npm run dev"
    Start-Process powershell.exe -WorkingDirectory $Dir -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
}

# ---------------------------------------------------------------------------
# 0. Requisitos
# ---------------------------------------------------------------------------
Write-Step 'Comprobando requisitos'
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Exit-WithError 'No se encontro npm en el PATH. Instala Node.js.'
}
foreach ($dir in @($BackendDir, $FrontendDir)) {
    if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
        Write-Warn "Falta node_modules en $dir. Ejecutando npm install..."
        Push-Location $dir
        try { npm install } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { Exit-WithError "npm install fallo en $dir" }
    }
}
Write-Ok 'Node.js y dependencias listos'

# ---------------------------------------------------------------------------
# 1. SQL Server
# ---------------------------------------------------------------------------
Write-Step "Verificando SQL Server ($SqlService)"
$svc = Get-Service -Name $SqlService -ErrorAction SilentlyContinue
if (-not $svc) {
    Exit-WithError "No existe el servicio $SqlService en este equipo."
}

if ($svc.Status -ne 'Running') {
    Write-Warn "El servicio esta '$($svc.Status)'. Intentando iniciarlo..."
    try {
        Start-Service -Name $SqlService
    } catch {
        # Sin permisos de administrador: pedir elevacion solo para arrancar el servicio
        Write-Warn 'Se necesitan permisos de administrador. Acepta el aviso de Windows.'
        try {
            Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden `
                -ArgumentList '-NoProfile', '-Command', "Start-Service -Name $SqlService"
        } catch {
            Exit-WithError 'No se pudo iniciar SQL Server (elevacion cancelada).'
        }
    }
    $svc.Refresh()
    try { $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) } catch {}
    $svc.Refresh()
    if ($svc.Status -ne 'Running') { Exit-WithError 'SQL Server no arranco.' }
}
Write-Ok 'Servicio en ejecucion'

$dbPort = Get-DbPort
$listening = $false
for ($i = 0; $i -lt 10 -and -not $listening; $i++) {
    $listening = Test-Port $dbPort
    if (-not $listening) { Start-Sleep -Seconds 1 }
}
if ($listening) {
    Write-Ok "SQL Server acepta conexiones en el puerto $dbPort"
} else {
    Write-Warn "El puerto $dbPort no responde. Revisa que TCP/IP este habilitado en SQL Server Configuration Manager."
}

# ---------------------------------------------------------------------------
# 2. Backend
# ---------------------------------------------------------------------------
Write-Step 'Iniciando backend'
if (Test-Port $BackendPort) {
    Write-Warn "El puerto $BackendPort ya esta en uso; se asume que el backend ya esta corriendo."
} else {
    Start-DevTerminal 'VERTEX Backend' $BackendDir
    Write-Ok "Terminal abierta (http://localhost:$BackendPort)"
}

# ---------------------------------------------------------------------------
# 3. Frontend
# ---------------------------------------------------------------------------
Write-Step 'Iniciando frontend'
if (Test-Port $FrontendPort) {
    Write-Warn "El puerto $FrontendPort ya esta en uso; se asume que el frontend ya esta corriendo."
} else {
    Start-DevTerminal 'VERTEX Frontend' $FrontendDir
    Write-Ok "Terminal abierta ($FrontendUrl)"
}

# ---------------------------------------------------------------------------
# 4. Base de datos, calentamiento y navegador
# ---------------------------------------------------------------------------
# El backend abre el puerto enseguida y reintenta la conexion con SQL Server;
# /health dice si la base responde. El navegador solo se abre con la base
# conectada: si no, el dashboard mostraria errores en lugar de datos.
Write-Step "Esperando a que el backend confirme la base de datos (maximo $EsperaMaxima s)"
$reloj = [Diagnostics.Stopwatch]::StartNew()
$db = $null
$viteOk = $false
$avisado = 0
while ($reloj.Elapsed.TotalSeconds -lt $EsperaMaxima) {
    $db = Get-DbState
    $viteOk = Test-Port $FrontendPort
    if ($db -eq 'conectada' -and $viteOk) { break }
    # Un aviso cada 15 s para que se vea que sigue esperando
    $seg = [int]$reloj.Elapsed.TotalSeconds
    if ($seg -ge $avisado + 15) {
        $avisado = $seg
        $estado = if ($null -eq $db) { 'el backend aun no responde' } elseif ($db -ne 'conectada') { "base de datos: $db" } else { 'esperando a Vite' }
        Write-Warn "$seg s: $estado..."
    }
    Start-Sleep -Seconds 1
}

if ($db -ne 'conectada') {
    if ($null -eq $db) {
        Exit-WithError ("El backend no respondio en $EsperaMaxima s. Revisa la ventana 'VERTEX Backend'. " +
            "Cuando funcione, abre $FrontendUrl a mano.")
    }
    Exit-WithError ("El backend responde, pero la base de datos sigue '$db' tras $EsperaMaxima s. " +
        "Revisa el servicio $SqlService y la ventana 'VERTEX Backend' (muestra cada intento de conexion). " +
        "Cuando conecte, abre $FrontendUrl a mano.")
}
Write-Ok "Base de datos conectada ($([int]$reloj.Elapsed.TotalSeconds) s)"
if (-not $viteOk) {
    Exit-WithError "Vite no respondio en el puerto $FrontendPort. Revisa la ventana 'VERTEX Frontend'."
}

# La primera consulta tras un rato sin uso es la mas lenta (SQL Server vuelve
# a cargar los datos en memoria): que la pague el script y no el dashboard
Write-Step 'Calentando las consultas del dashboard'
foreach ($url in $Calentamiento) {
    $t = [Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-RestMethod -Uri $url -TimeoutSec 60 | Out-Null
        Write-Ok ("{0} ({1:N1} s)" -f ($url -replace '^.*/api/equipos/', ''), $t.Elapsed.TotalSeconds)
    } catch {
        Write-Warn ("{0} fallo ({1}); el dashboard lo reintentara." -f ($url -replace '^.*/api/equipos/', ''), $_.Exception.Message)
    }
}

Start-Process $FrontendUrl
Write-Ok 'Navegador abierto'

Write-Host "`nVERTEX en marcha. Esta ventana se cerrara en 5 segundos..." -ForegroundColor Green
Start-Sleep -Seconds 5
