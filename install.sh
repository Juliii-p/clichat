#!/usr/bin/env bash
# Instalador de clichat para Linux, macOS y Android (Termux).
#
#   curl -fsSL https://raw.githubusercontent.com/Juliii-p/clichat/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Juliii-p/clichat/main/install.sh | bash -s -- --server
#
# Opciones:
#   --client          solo el cliente
#   --server          cliente + servidor en segundo plano (arranca solo)
#   --port N          puerto del servidor (5555)
#   --no-tls          servidor sin cifrado (por defecto usa TLS)
#   --password CLAVE  contraseña del servidor (si no se pasa, se pregunta)
#   --no-completion   no agregar el autocompletado a ~/.bashrc o ~/.zshrc
#   --ref REF         rama o etiqueta de GitHub a instalar (main)
#   --uninstall       quitar clichat y el servicio (la configuración queda)
#   --dry-run         mostrar qué haría, sin hacer nada
#   -y, --yes         no preguntar: usar los valores por defecto
#
# En Windows, usar install.ps1.

set -euo pipefail

REPO="Juliii-p/clichat"
REF="main"
MODE=""
PORT=5555
TLS=1
PASSWORD=""
PASSWORD_SET=0
COMPLETION=1
UNINSTALL=0
DRY_RUN=0
ASSUME_YES=0

# ------------------------------------------------------------------ salida

if [ -t 1 ]; then
  BOLD=$'\e[1m'; AMBER=$'\e[38;5;214m'; GREEN=$'\e[92m'; RED=$'\e[91m'; GRAY=$'\e[90m'; RESET=$'\e[0m'
else
  BOLD=''; AMBER=''; GREEN=''; RED=''; GRAY=''; RESET=''
fi
say()  { printf '%s\n' "${AMBER}▶${RESET} $*"; }
ok()   { printf '%s\n' "${GREEN}✔${RESET} $*"; }
warn() { printf '%s\n' "${AMBER}⚠${RESET} $*" >&2; }
die()  { printf '%s\n' "${RED}✖ $*${RESET}" >&2; exit 1; }
run()  {
  if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "${GRAY}  + $*${RESET}"; else "$@"; fi
}
# Escribe un archivo (o lo muestra, en --dry-run). Uso: put <ruta> <permisos> <<'EOF' ... EOF
put() {
  local path="$1" mode="$2" body
  body="$(cat)"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "${GRAY}  + escribir $path ($mode)${RESET}"
  else
    mkdir -p "$(dirname "$path")"
    printf '%s\n' "$body" > "$path"
    chmod "$mode" "$path"
  fi
}

# Con `curl | bash` la entrada estándar es el propio script: las preguntas se leen
# de la terminal (/dev/tty). Sin terminal, se usa el valor por defecto.
has_tty() { [ "$ASSUME_YES" = 0 ] && { : < /dev/tty; } 2>/dev/null; }
ask() {
  local question="$1" default="${2:-}" answer=""
  if has_tty; then
    printf '%s' "${BOLD}?${RESET} $question${default:+ ${GRAY}[$default]${RESET}}: " > /dev/tty
    IFS= read -r answer < /dev/tty || true
  fi
  printf '%s' "${answer:-$default}"
}
ask_secret() {
  local question="$1" answer=""
  if has_tty; then
    printf '%s' "${BOLD}?${RESET} $question: " > /dev/tty
    stty -echo < /dev/tty 2>/dev/null || true
    IFS= read -r answer < /dev/tty || true
    stty echo < /dev/tty 2>/dev/null || true
    printf '\n' > /dev/tty
  fi
  printf '%s' "$answer"
}

# ------------------------------------------------------------------ opciones

while [ $# -gt 0 ]; do
  case "$1" in
    --client) MODE=client ;;
    --server) MODE=server ;;
    --port) PORT="${2:?falta el número de puerto}"; shift ;;
    --no-tls) TLS=0 ;;
    --password) PASSWORD="${2-}"; PASSWORD_SET=1; shift ;;
    --no-completion) COMPLETION=0 ;;
    --ref) REF="${2:?falta la rama o etiqueta}"; shift ;;
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      printf '%s\n' 'Instalador de clichat. Opciones: --client, --server, --port N, --no-tls,' \
        '--password CLAVE, --no-completion, --ref REF, --uninstall, --dry-run, -y.' \
        "Detalles: https://github.com/$REPO#instalación"
      exit 0 ;;
    *) die "opción desconocida: $1 (ver --help)" ;;
  esac
  shift
done
case "$PORT" in ''|*[!0-9]*) die "puerto inválido: $PORT" ;; esac

# ------------------------------------------------------------------ plataforma

# CLICHAT_INSTALL_PLATFORM fuerza la plataforma (para probar el instalador con --dry-run).
if [ -n "${CLICHAT_INSTALL_PLATFORM:-}" ]; then
  PLATFORM="$CLICHAT_INSTALL_PLATFORM"
elif [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; then
  PLATFORM=termux
else
  case "$(uname -s)" in
    Linux) PLATFORM=linux ;;
    Darwin) PLATFORM=macos ;;
    MINGW*|MSYS*|CYGWIN*) die "En Windows usa install.ps1:  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex" ;;
    *) die "sistema no soportado: $(uname -s)" ;;
  esac
fi

CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/clichat"
[ "$PLATFORM" = macos ] && CONF_DIR="$HOME/.config/clichat"
SUDO=""
if [ "$PLATFORM" = linux ] && [ "$(id -u)" != 0 ] && command -v sudo >/dev/null 2>&1; then SUDO=sudo; fi

# ------------------------------------------------------------------ Node.js

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true; }

ensure_node() {
  local major
  major="$(node_major)"
  if [ -n "$major" ] && [ "$major" -ge 18 ]; then
    ok "Node.js $(node -v)"
    return
  fi
  say "clichat necesita Node.js 18 o superior${major:+ (hay v$major)}. Instalándolo..."
  case "$PLATFORM" in
    termux) run pkg install -y nodejs ;;
    macos)
      command -v brew >/dev/null 2>&1 || die "instala Homebrew (https://brew.sh) o Node.js (https://nodejs.org) y vuelve a correr esto"
      run brew install node ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then run $SUDO apt-get update && run $SUDO apt-get install -y nodejs npm
      elif command -v dnf >/dev/null 2>&1; then run $SUDO dnf install -y nodejs npm
      elif command -v pacman >/dev/null 2>&1; then run $SUDO pacman -S --noconfirm nodejs npm
      elif command -v apk >/dev/null 2>&1; then run $SUDO apk add nodejs npm
      elif command -v zypper >/dev/null 2>&1; then run $SUDO zypper install -y nodejs npm
      fi ;;
  esac
  [ "$DRY_RUN" = 1 ] && return
  major="$(node_major)"
  if [ -z "$major" ] || [ "$major" -lt 18 ]; then
    die "Node.js de tu sistema es viejo o no está (${major:-ninguno}). Instala una versión actual con nvm:
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install --lts
  y vuelve a correr este instalador."
  fi
  ok "Node.js $(node -v)"
}

# ------------------------------------------------------------------ clichat

TARBALL="https://codeload.github.com/$REPO/tar.gz/$REF"
LOCAL_PREFIX="$HOME/.local"

install_clichat() {
  say "Instalando clichat ($REPO@$REF)..."
  local global_prefix
  global_prefix="$(npm prefix -g 2>/dev/null || echo /usr/local)"
  # Si la carpeta global de npm es del sistema, se instala en ~/.local sin sudo.
  if [ -w "$global_prefix" ] || [ "$PLATFORM" = termux ]; then
    run npm install -g "$TARBALL"
  else
    run npm install -g --prefix "$LOCAL_PREFIX" "$TARBALL"
    case ":$PATH:" in
      *":$LOCAL_PREFIX/bin:"*) ;;
      *) export PATH="$LOCAL_PREFIX/bin:$PATH"; add_to_rc 'clichat path' "export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
  fi
  if [ "$DRY_RUN" = 0 ]; then
    command -v clichat >/dev/null 2>&1 || die "npm terminó, pero no encuentro el comando clichat en el PATH"
    ok "clichat $(clichat --version) en $(command -v clichat)"
  fi
}

rc_file() {
  case "$(basename "${SHELL:-bash}")" in
    zsh) printf '%s' "$HOME/.zshrc" ;;
    *) printf '%s' "$HOME/.bashrc" ;;
  esac
}

# Agrega una línea al rc del shell, marcada para poder quitarla al desinstalar.
add_to_rc() {
  local tag="$1" line="$2" rc
  rc="$(rc_file)"
  if [ -f "$rc" ] && grep -q "# $tag\$" "$rc"; then return; fi
  if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "${GRAY}  + agregar a $rc: $line${RESET}"; return; fi
  printf '%s  # %s\n' "$line" "$tag" >> "$rc"
}

setup_completion() {
  [ "$COMPLETION" = 1 ] || return 0
  local shell
  shell="$(basename "${SHELL:-bash}")"
  case "$shell" in bash|zsh) ;; *) shell=bash ;; esac
  add_to_rc 'clichat completion' "eval \"\$(clichat completion $shell)\""
  ok "Autocompletado de $shell activado (abre una terminal nueva)"
}

# ------------------------------------------------------------------ servidor

ENV_FILE="$CONF_DIR/server.env"
RUNNER="$CONF_DIR/run-server.sh"

write_server_files() {
  local bin quoted
  bin="$(command -v clichat 2>/dev/null || echo "$LOCAL_PREFIX/bin/clichat")"
  printf -v quoted '%q' "$PASSWORD" # a salvo de comillas y espacios al leerlo con bash
  # Contraseña en un archivo solo legible por el usuario, no en la línea de comandos.
  put "$ENV_FILE" 600 <<EOF
# Configuración del servidor de clichat (la usa run-server.sh).
CLI_CHAT_PORT=$PORT
CLI_CHAT_TLS=$TLS
CLI_CHAT_PASSWORD=$quoted
EOF
  put "$RUNNER" 700 <<EOF
#!/usr/bin/env bash
# Arranca el servidor de clichat con la configuración de server.env.
set -a
. "$ENV_FILE"
set +a
# El certificado (y su huella) siempre sale de esta carpeta, lo arranque quien lo arranque.
export CLI_CHAT_CONFIG_DIR="$CONF_DIR"
[ -n "\${CLI_CHAT_PASSWORD:-}" ] || unset CLI_CHAT_PASSWORD
[ "\${CLI_CHAT_TLS:-0}" = 1 ] || unset CLI_CHAT_TLS
exec "$bin" server
EOF
}

service_linux() {
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    put "$HOME/.config/systemd/user/clichat.service" 644 <<EOF
[Unit]
Description=Servidor de clichat
After=network-online.target

[Service]
ExecStart=$RUNNER
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
    run systemctl --user daemon-reload
    run systemctl --user enable --now clichat.service
    ok "Servicio systemd de usuario 'clichat' activo"
    printf '%s\n' "  ${GRAY}Para que siga corriendo con la sesión cerrada: sudo loginctl enable-linger $USER${RESET}"
    printf '%s\n' "  ${GRAY}Ver estado y registro: systemctl --user status clichat · journalctl --user -u clichat -f${RESET}"
  else
    fallback_background
  fi
}

service_termux() {
  run pkg install -y termux-services
  local svdir="$PREFIX/var/service/clichat"
  put "$svdir/run" 700 <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec "$RUNNER" 2>&1
EOF
  put "$svdir/log/run" 700 <<EOF
#!/data/data/com.termux/files/usr/bin/sh
mkdir -p "$PREFIX/var/log/sv/clichat"
exec svlogd -tt "$PREFIX/var/log/sv/clichat"
EOF
  # El gestor de servicios de Termux arranca con cada sesión nueva: si se acaba de
  # instalar, todavía no corre en esta.
  if [ -n "${SVDIR:-}" ]; then
    run sv-enable clichat || true
    ok "Servicio 'clichat' de Termux activo"
  else
    warn "Cierra Termux por completo (Exit en la notificación), ábrelo y ejecuta: sv-enable clichat"
  fi
  printf '%s\n' "  ${GRAY}Para que Android no lo corte: termux-wake-lock (y quitar a Termux del ahorro de batería)${RESET}"
  printf '%s\n' "  ${GRAY}Ver registro: tail -f \$PREFIX/var/log/sv/clichat/current${RESET}"
}

service_macos() {
  local plist="$HOME/Library/LaunchAgents/dev.clichat.server.plist"
  put "$plist" 644 <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.clichat.server</string>
  <key>ProgramArguments</key><array><string>$RUNNER</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$CONF_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$CONF_DIR/server.log</string>
</dict>
</plist>
EOF
  run launchctl unload "$plist" 2>/dev/null || true
  run launchctl load -w "$plist"
  ok "Servicio launchd 'dev.clichat.server' activo"
  printf '%s\n' "  ${GRAY}Ver registro: tail -f $CONF_DIR/server.log${RESET}"
}

# Sin gestor de servicios: en segundo plano, hasta el próximo reinicio.
fallback_background() {
  run sh -c "nohup '$RUNNER' >> '$CONF_DIR/server.log' 2>&1 & echo \$! > '$CONF_DIR/server.pid'"
  ok "Servidor corriendo en segundo plano (se detiene al reiniciar el equipo)"
  printf '%s\n' "  ${GRAY}Detenerlo: kill \$(cat $CONF_DIR/server.pid)${RESET}"
}

setup_server() {
  if [ "$PASSWORD_SET" = 0 ]; then
    PASSWORD="$(ask_secret 'Contraseña del servidor (vacío = sin contraseña)')"
  fi
  [ -n "$PASSWORD" ] || warn "Servidor sin contraseña: cualquiera que llegue a tu IP puede entrar."
  say "Configurando el servidor (puerto $PORT, $([ "$TLS" = 1 ] && echo 'con TLS' || echo 'sin cifrar'))..."
  write_server_files
  case "$PLATFORM" in
    linux) service_linux ;;
    termux) service_termux ;;
    macos) service_macos ;;
  esac
  if [ "$TLS" = 1 ] && [ "$DRY_RUN" = 0 ]; then
    printf '%s\n' "  Huella TLS (para compartir): ${BOLD}$(CLI_CHAT_CONFIG_DIR="$CONF_DIR" clichat fingerprint | head -1)${RESET}"
  fi
}

# ------------------------------------------------------------------ desinstalar

uninstall() {
  say "Desinstalando clichat..."
  case "$PLATFORM" in
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        run systemctl --user disable --now clichat.service 2>/dev/null || true
        run rm -f "$HOME/.config/systemd/user/clichat.service"
      fi ;;
    termux)
      run sv-disable clichat 2>/dev/null || true
      run rm -rf "$PREFIX/var/service/clichat" ;;
    macos)
      run launchctl unload -w "$HOME/Library/LaunchAgents/dev.clichat.server.plist" 2>/dev/null || true
      run rm -f "$HOME/Library/LaunchAgents/dev.clichat.server.plist" ;;
  esac
  if [ -f "$CONF_DIR/server.pid" ]; then run sh -c "kill \$(cat '$CONF_DIR/server.pid') 2>/dev/null; rm -f '$CONF_DIR/server.pid'"; fi
  run npm uninstall -g clichat 2>/dev/null || true
  run npm uninstall -g --prefix "$LOCAL_PREFIX" clichat 2>/dev/null || true
  local rc
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && grep -q '# clichat ' "$rc"; then
      if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "${GRAY}  + quitar líneas de clichat de $rc${RESET}"
      else grep -v '# clichat ' "$rc" > "$rc.clichat-tmp" && mv "$rc.clichat-tmp" "$rc"; fi
    fi
  done
  ok "clichat desinstalado. Tu configuración quedó en $CONF_DIR (bórrala si no la quieres)."
}

# ------------------------------------------------------------------ principal

printf '%s\n' "${AMBER}━━━ CLI-CHAT // INSTALADOR ━━━${RESET}  ${GRAY}$PLATFORM${RESET}"
[ "$DRY_RUN" = 1 ] && warn "Modo --dry-run: no se cambia nada."

if [ "$UNINSTALL" = 1 ]; then uninstall; exit 0; fi

if [ -z "$MODE" ]; then
  printf '%s\n' "  1) Solo el cliente (para unirme a chats)" "  2) Cliente + servidor (mi equipo aloja un chat)"
  case "$(ask 'Qué instalar' 1)" in 2) MODE=server ;; *) MODE=client ;; esac
fi

ensure_node
install_clichat
setup_completion
[ "$MODE" = server ] && setup_server

printf '\n%s\n' "${GREEN}${BOLD}Listo.${RESET} Para empezar:"
printf '%s\n' "  clichat                     pantalla de inicio"
printf '%s\n' "  clichat join <ip>           unirse a un chat"
[ "$MODE" = server ] && printf '%s\n' "  clichat join 127.0.0.1      entrar a tu propio servidor"
printf '%s\n' "  ${GRAY}Desinstalar: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- --uninstall${RESET}"
