<#
.SYNOPSIS
    Arranca el entorno de desarrollo de VERTEX.

.DESCRIPTION
    1. Verifica que SQL Server (servicio MSSQLSERVER) esta corriendo; si no, intenta arrancarlo.
    2. Abre una terminal con el backend  (apps\backend  -> npm run dev, puerto 3000).
    3. Abre una terminal con el frontend (apps\frontend -> npm run dev, puerto 5173).
    4. Abre el navegador en http://localhost:5173 cuando Vite responde.

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
# 4. Navegador
# ---------------------------------------------------------------------------
# El backend solo abre el puerto tras conectar con SQL Server. Si el navegador
# se abre antes, el dashboard recibe "Sin conexion con el servidor" y la dona
# se queda en 0 hasta cambiar de CERO o de periodo.
Write-Step "Esperando a que el backend (puerto $BackendPort) y el frontend respondan"
$ready = $false
for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
    $ready = (Test-Port $BackendPort) -and (Test-Port $FrontendPort)
    if (-not $ready) { Start-Sleep -Seconds 1 }
}
if (-not $ready) {
    Write-Warn 'El backend o el frontend tardan en arrancar; revisa sus terminales. Abriendo el navegador de todas formas.'
}
Start-Process $FrontendUrl
Write-Ok 'Navegador abierto'

Write-Host "`nVERTEX en marcha. Esta ventana se cerrara en 5 segundos..." -ForegroundColor Green
Start-Sleep -Seconds 5
