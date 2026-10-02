# Instalador de clichat para Windows (PowerShell 5.1 o superior).
#
#   irm https://raw.githubusercontent.com/Juliii-p/clichat/main/install.ps1 | iex
#
# Con opciones (por ejemplo, cliente + servidor):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Juliii-p/clichat/main/install.ps1))) -Server
#
# Opciones: -Client, -Server, -Port N, -NoTls, -Password CLAVE, -NoCompletion,
#           -Ref RAMA, -Uninstall, -DryRun, -Yes
param(
  [switch]$Client,
  [switch]$Server,
  [int]$Port = 5555,
  [switch]$NoTls,
  [string]$Password,
  [switch]$NoCompletion,
  [string]$Ref = 'main',
  [switch]$Uninstall,
  [switch]$DryRun,
  [switch]$Yes
)

$Repo = 'Juliii-p/clichat'
$TaskName = 'clichat-server'
$ConfDir = Join-Path $env:APPDATA 'clichat'
# Los mensajes van en ASCII: PowerShell 5.1 lee los .ps1 sin BOM como ANSI, y
# con BOM se rompe `irm | iex`. Los comentarios pueden llevar tildes.
$ProfileTag = '# clichat completion'

function Say($m) { Write-Host "> $m" -ForegroundColor DarkYellow }
function Ok($m) { Write-Host "OK $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Note($m) { Write-Host "   $m" -ForegroundColor DarkGray }
# Con `irm | iex`, `exit` cerraría la ventana del usuario: los errores se lanzan.
function Die($m) { throw "clichat: $m" }
function Step([string]$what, [scriptblock]$do) {
  if ($DryRun) { Note "+ $what" } else { & $do }
}
function Ask([string]$question, [string]$default) {
  if ($Yes) { return $default }
  $answer = Read-Host "? $question [$default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
  return $answer
}
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}
function Node-Major {
  try { return [int]((node -v) -replace '^v(\d+).*', '$1') } catch { return 0 }
}

# ------------------------------------------------------------------ Node.js

function Ensure-Node {
  $major = Node-Major
  if ($major -ge 18) { Ok "Node.js $(node -v)"; return }
  Say "clichat necesita Node.js 18 o superior."
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Die 'instala Node.js LTS desde https://nodejs.org y vuelve a correr este instalador'
  }
  if ((Ask 'Instalar Node.js LTS con winget? (s/n)' 's') -notmatch '^(s|si|y|yes)$') {
    Die 'sin Node.js no se puede instalar clichat'
  }
  Step 'winget install OpenJS.NodeJS.LTS' {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  if (-not $DryRun -and (Node-Major) -lt 18) {
    Die 'Node.js ya esta instalado, pero esta ventana no lo ve: abre una terminal nueva y vuelve a correr el instalador'
  }
}

# ------------------------------------------------------------------ clichat

function Install-Package {
  $tarball = "https://codeload.github.com/$Repo/tar.gz/$Ref"
  Say "Instalando clichat ($Repo@$Ref)..."
  Step "npm install -g $tarball" {
    npm install -g $tarball
    if ($LASTEXITCODE -ne 0) { Die 'npm no pudo instalar clichat' }
    Refresh-Path
  }
  if (-not $DryRun) { Ok "clichat $(clichat --version)" }
}

function Setup-Completion {
  if ($NoCompletion) { return }
  $line = "Invoke-Expression (& clichat completion powershell | Out-String)  $ProfileTag"
  if ((Test-Path $PROFILE) -and (Select-String -Path $PROFILE -SimpleMatch $ProfileTag -Quiet)) {
    Ok 'Autocompletado ya configurado'
    return
  }
  Step "agregar el autocompletado a $PROFILE" {
    New-Item -ItemType Directory -Force (Split-Path $PROFILE) | Out-Null
    Add-Content -Path $PROFILE -Value $line
  }
  Ok 'Autocompletado activado (abre una terminal nueva)'
  $policy = Get-ExecutionPolicy -Scope CurrentUser
  if ($policy -eq 'Undefined') { $policy = Get-ExecutionPolicy }
  if ($policy -in 'Restricted', 'AllSigned') {
    Warn "La ExecutionPolicy ($policy) no deja cargar el perfil: el autocompletado no va a funcionar."
    Note 'Si quieres habilitarlo: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned'
  }
}

# ------------------------------------------------------------------ servidor

function Setup-Server {
  if (-not $script:PasswordGiven -and -not $Yes) {
    $secure = Read-Host '? Clave del servidor (Enter = sin clave)' -AsSecureString
    $script:Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  if ([string]::IsNullOrEmpty($script:Password)) { Warn 'Servidor sin clave: cualquiera que llegue a tu IP puede entrar.' }
  $tlsText = if ($NoTls) { 'sin cifrar' } else { 'con TLS' }
  Say "Configurando el servidor (puerto $Port, $tlsText)..."

  $config = Join-Path $ConfDir 'server.json'
  $runner = Join-Path $ConfDir 'run-server.ps1'
  Step "escribir $config y $runner" {
    New-Item -ItemType Directory -Force $ConfDir | Out-Null
    # JSON y no un .cmd: así la contraseña no se rompe con caracteres especiales.
    [ordered]@{ port = $Port; tls = (-not $NoTls); password = $script:Password } |
      ConvertTo-Json | Set-Content -Path $config -Encoding UTF8
    $node = (Get-Command node).Source
    # El paquete está junto al comando que creó npm (clichat.cmd); si no, se pregunta a npm.
    $shim = Get-Command clichat.cmd -ErrorAction SilentlyContinue
    $bin = if ($shim) { Join-Path (Split-Path $shim.Source) 'node_modules\clichat\bin\clichat.js' } else { '' }
    if (-not $bin -or -not (Test-Path $bin)) { $bin = Join-Path (npm root -g) 'clichat\bin\clichat.js' }
    if (-not (Test-Path $bin)) { Die "no encuentro clichat instalado ($bin)" }
    @"
# Arranca el servidor de clichat con la configuración de server.json.
`$cfg = Get-Content (Join-Path `$PSScriptRoot 'server.json') -Raw | ConvertFrom-Json
# El certificado (y su huella) siempre sale de esta carpeta, se arranque como se arranque.
`$env:CLI_CHAT_CONFIG_DIR = `$PSScriptRoot
`$env:CLI_CHAT_PORT = [string]`$cfg.port
if (`$cfg.tls) { `$env:CLI_CHAT_TLS = '1' }
if (`$cfg.password) { `$env:CLI_CHAT_PASSWORD = `$cfg.password }
& '$node' '$bin' server *>> (Join-Path `$PSScriptRoot 'server.log')
"@ | Set-Content -Path $runner -Encoding UTF8
  }

  # Tarea programada al iniciar sesión, sin ventana. -ExecutionPolicy Bypass vale solo
  # para ese proceso: no cambia la política del sistema.
  Step "registrar la tarea programada '$TaskName' (al entrar a Windows) y arrancarla" {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
      -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
      -Description 'Servidor de clichat' -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
  }
  Ok "Servidor '$TaskName' activo; arranca solo al entrar a Windows"
  Note "Registro: Get-Content -Wait $ConfDir\server.log"
  Note 'Para recibir conexiones de otros equipos, abre el puerto (como administrador):'
  Note "  netsh advfirewall firewall add rule name=`"CLI-Chat`" dir=in action=allow protocol=TCP localport=$Port"
  if (-not $NoTls -and -not $DryRun) {
    $env:CLI_CHAT_CONFIG_DIR = $ConfDir
    Write-Host "   Huella TLS (para compartir): $((clichat fingerprint) | Select-Object -First 1)"
    Remove-Item Env:\CLI_CHAT_CONFIG_DIR
  }
}

# ------------------------------------------------------------------ desinstalar

function Remove-Clichat {
  Say 'Desinstalando clichat...'
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Step "quitar la tarea programada '$TaskName'" {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
  }
  Step 'npm uninstall -g clichat' { npm uninstall -g clichat | Out-Null }
  if ((Test-Path $PROFILE) -and (Select-String -Path $PROFILE -SimpleMatch $ProfileTag -Quiet)) {
    Step "quitar el autocompletado de $PROFILE" {
      (Get-Content $PROFILE) | Where-Object { $_ -notlike "*$ProfileTag*" } | Set-Content $PROFILE
    }
  }
  Ok "clichat desinstalado. Tus ajustes siguen en $ConfDir (puedes borrar esa carpeta)."
}

# ------------------------------------------------------------------ principal

function Main {
  Write-Host '=== CLI-CHAT // INSTALADOR ===  windows' -ForegroundColor DarkYellow
  if ($DryRun) { Warn 'Modo -DryRun: no se cambia nada.' }
  if ($Uninstall) { Remove-Clichat; return }

  $mode = if ($Server) { 'server' } elseif ($Client) { 'client' } else { $null }
  if (-not $mode) {
    Write-Host '  1) Solo el cliente (para unirme a chats)'
    Write-Host '  2) Cliente + servidor (este equipo aloja un chat)'
    $mode = if ((Ask 'Elige 1 o 2' '1') -eq '2') { 'server' } else { 'client' }
  }

  Ensure-Node
  Install-Package
  Setup-Completion
  if ($mode -eq 'server') { Setup-Server }

  Write-Host ''
  Write-Host 'Listo. Para empezar:' -ForegroundColor Green
  Write-Host '  clichat                     pantalla de inicio'
  Write-Host '  clichat join <ip>           unirse a un chat'
  if ($mode -eq 'server') { Write-Host '  clichat join 127.0.0.1      entrar a tu propio servidor' }
  Note "Desinstalar: & ([scriptblock]::Create((irm https://raw.githubusercontent.com/$Repo/main/install.ps1))) -Uninstall"
}

$script:Password = $Password
$script:PasswordGiven = $PSBoundParameters.ContainsKey('Password')
try { Main } catch { Write-Host "x $($_.Exception.Message)" -ForegroundColor Red }
