# CLI-Chat

Chat por terminal. Una persona levanta el chat y las demás se conectan desde su
consola: en Linux, macOS, Windows o Android con Termux.

- Un solo comando, `clichat`, sin dependencias. Solo necesita Node.js 18 o superior.
- **Interfaz de pantalla completa (TUI)** con panel de salas y usuarios. En
  pantallas angostas el panel se oculta solo, y existe un modo simple, línea a
  línea, para terminales básicas.
- **Cifrado opcional de la conexión (TLS)**, con verificación de huella al estilo SSH.
- **Cifrado de extremo a extremo opcional** con clave compartida: ni siquiera el
  servidor puede leer los mensajes.
- Salas, mensajes privados, acciones (`/me`), historial y contraseña opcional.
- Efímero por defecto: nada se guarda en disco, salvo que el anfitrión active `--log`.
- El anfitrión puede expulsar usuarios y enviar anuncios.

```
 CLI-Chat │ #general — Sala principal              cifrado │ ana ★
 20:31 <ana> ¿arrancamos?                  │ SALAS
 20:31 <beto> dale, ya estoy               │ #general 2
 20:32 * beto trae café                    │ #dev 1
                                           │
                                           │ EN #general (2)
                                           │ ★ana
                                           │  beto
 ── Tab completa · PgUp/PgDn historial · F2 panel · /help ─────────
 › _
```

## Instalación

```bash
npm install -g clichat
```

Sin npm global, desde el código fuente:

```bash
git clone <url-del-repo> clichat
cd clichat
node bin/clichat.js
```

### En Android (Termux)

Instala [Termux](https://termux.dev) desde F-Droid o GitHub. La versión de Google
Play está desactualizada. Después:

```bash
pkg install nodejs
npm install -g clichat
clichat
```

## Uso

```bash
clichat                          # pantalla de inicio: elegir qué hacer y la seguridad
clichat host                     # crear un chat y participar en él
clichat host --tls               # ... con cifrado
clichat join 192.168.1.20        # unirse a un chat
clichat 192.168.1.20             # atajo de join
clichat server                   # servidor dedicado (sin chatear)
```

| Opción               | Variable de entorno | Para qué                                  |
|----------------------|---------------------|-------------------------------------------|
| `-n, --nick <nick>`  | `CLI_CHAT_NICK`     | tu nick                                   |
| `-p, --port <n>`     | `CLI_CHAT_PORT`     | puerto (por defecto `5555`)               |
| `--password <clave>` | `CLI_CHAT_PASSWORD` | contraseña del chat                       |
| `--tls`              | `CLI_CHAT_TLS=1`    | cifrar (host/server) o exigir cifrado (join) |
| `--no-tls`           |                     | join: conectar sin cifrado                |
| `--fp <huella>`      |                     | join: huella esperada del servidor        |
| `--e2e`              | `CLI_CHAT_E2E`      | host/join: cifrado de extremo a extremo (pide la clave) |
| `--log <archivo>`    | `CLI_CHAT_LOG`      | host/server: registrar las salas en un archivo |
| `--cert` / `--key`   |                     | host/server: certificado propio (PEM)     |
| `--bind <ip>`        | `CLI_CHAT_BIND`     | host/server: IP donde escuchar (`0.0.0.0`) |
| `--simple`           | `CLI_CHAT_SIMPLE=1` | interfaz línea a línea en vez de TUI      |

`clichat` solo abre una **pantalla de inicio** con estética de sala de briefing.
Muestra tu nick, el último servidor y tu IP de Tailscale, y ofrece tres opciones:
**unirse a un chat**, **crear un chat** o levantar un **servidor dedicado**.
Cada opción tiene un formulario con un panel de **nivel de seguridad** que se
actualiza en vivo, de *NIVEL 0 // ABIERTO* a *NIVEL 3 // ALTO SECRETO*
(TLS + E2E). El panel siempre aclara que el anonimato no está disponible. Con
`--simple`, o en scripts, se usa el menú clásico.

`host` levanta el servidor y te conecta como **anfitrión**. Si cierras el chat,
se cierra para todos. `server` sirve para dejarlo corriendo en una máquina
siempre encendida, como un VPS o una Raspberry Pi. En su consola, todo lo que
escribas se envía como anuncio, y además acepta `/users`, `/rooms`, `/kick` y
`/stop`.

Con `--bind` el servidor escucha solo en una interfaz. Por ejemplo,
`--bind 100.64.0.5` lo deja accesible solo por la VPN y no por el Wi-Fi.

### La TUI

Al escribir `/` aparece un **menú de comandos** con su descripción, que se filtra
mientras escribes. Después de `/msg ` o `/kick ` sugiere nicks, y después de
`/join ` o `/who `, salas. ↑↓ eligen, Tab o Enter aceptan y Esc cierra el menú.
Enter ejecuta directamente los comandos que no necesitan nada más (como `/rooms`).
Mientras escribes un comando, una pista en gris muestra los argumentos que faltan
(`/msg ` → `<nick> <txt>`).

| Tecla                  | Qué hace                                       |
|------------------------|------------------------------------------------|
| Enter                  | enviar                                         |
| Tab                    | aceptar la sugerencia; sin menú, completar nicks (repetir para ciclar) |
| ↑ / ↓                  | mensajes que ya enviaste                       |
| PgUp / PgDn            | recorrer la conversación                       |
| F2 o `/panel`          | mostrar u ocultar el panel lateral             |
| Ctrl+A / Ctrl+E        | inicio o fin de la línea                       |
| Ctrl+W / Ctrl+U        | borrar palabra o línea                         |
| Ctrl+L                 | redibujar                                      |
| Ctrl+C o `/quit`       | salir                                          |

Si la entrada o la salida están redirigidas (por ejemplo, en scripts), se usa el
modo simple automáticamente.

### Autocompletado en la terminal

`clichat completion` genera el script para tu shell. Completa subcomandos,
opciones y, después de `join` o `forget`, tus servidores recientes.

```bash
echo 'eval "$(clichat completion bash)"' >> ~/.bashrc     # bash, también Termux
echo 'eval "$(clichat completion zsh)"' >> ~/.zshrc       # zsh
```

En PowerShell:

```
clichat completion powershell | Out-String | Add-Content $PROFILE
```

Abre una terminal nueva para que se active.

### Comandos dentro del chat

| Comando               | Qué hace                                  |
|-----------------------|-------------------------------------------|
| `/join <sala>`        | entrar a una sala (la crea si no existe)  |
| `/rooms`              | ver salas                                 |
| `/who [sala]`         | quién está en una sala                    |
| `/users`              | todos los conectados                      |
| `/msg <nick> <texto>` | mensaje privado                           |
| `/r <texto>`          | responder al último privado               |
| `/me <acción>`        | acción en tercera persona                 |
| `/nick <nuevo>`       | cambiar de nick                           |
| `/topic [texto]`      | ver o cambiar el tema de la sala          |
| `/clear`              | limpiar la pantalla                       |
| `/quit [mensaje]`     | salir                                     |
| `/kick <nick> [motivo]` | *anfitrión:* expulsar                   |
| `/announce <texto>`   | *anfitrión:* anuncio para todos           |

Cuando alguien te menciona o te escribe por privado, el mensaje se resalta y
suena la campana de la terminal.

## Cifrado

El cifrado es **opcional**: lo decide quien levanta el chat.

```bash
clichat host --tls
✔ Chat abierto en el puerto 5555 (cifrado)
  Huella: 0476-2D68-4024-341E
```

- Usa TLS 1.2 o 1.3. Con Node actual negocia TLS 1.3 con AES-256-GCM.
- La primera vez que te unes, `clichat` muestra la **huella** del servidor y
  pregunta si confías en ella: compárala con la que ve el anfitrión. Queda
  guardada, y si algún día cambia, `clichat` se niega a conectar y avisa de un
  posible ataque. Funciona igual que SSH.
- Para no tener que confirmar a mano: `clichat join <ip> --fp 0476-2D68-4024-341E`.
- **Al unirte no hace falta indicar nada**: `clichat` intenta cifrar y, si el
  servidor no cifra, sigue sin cifrado y lo avisa en pantalla. Un servidor que
  alguna vez usó cifrado no se acepta sin cifrado, salvo que pases `--no-tls`
  explícitamente.
- El certificado es autofirmado y se genera la primera vez. Se guarda para que la
  huella no cambie entre reinicios. También puedes usar el tuyo con `--cert` y `--key`.
- Si el anfitrión regeneró su certificado: `clichat forget <ip[:puerto]>`.

Sin `--tls`, todo viaja en texto plano, contraseña incluida.

### Cifrado de extremo a extremo (`--e2e`)

TLS protege el viaje por la red, pero el servidor ve los mensajes en claro
mientras los reenvía. Con `--e2e`, todos los participantes usan una **frase
secreta acordada de antemano**, y los mensajes se cifran y descifran en cada
equipo. El servidor solo ve texto ilegible.

```bash
clichat host --tls --e2e          # pide la frase sin mostrarla
clichat join 100.64.0.10 --e2e  # los demás, con la misma frase
```

- Usa AES-256-GCM con la clave derivada de la frase mediante scrypt. Cifra los
  mensajes, `/me`, `/msg` y `/r`. Los comandos (`/join`, `/nick`, `/topic`...)
  viajan sin cifrar.
- Al entrar se muestra un **código de la clave** (por ejemplo `1639-37FB-3D04-9CEB`).
  Si todos ven el mismo, todos usan la misma frase.
- Quien no tiene la frase ve `[cifrado de extremo a extremo: no tienes la clave]`.
  Un mensaje que alguien mandó sin cifrar se marca con `[sin cifrar]`.
- Usa una frase larga (12 caracteres o más) y compártela por un medio seguro,
  nunca por el mismo chat.
- **Qué no oculta:** nicks, salas, horarios, tamaño de los mensajes y las IPs de
  quienes se conectan. Además, cualquiera con la frase puede leer todo y escribir
  haciéndose pasar por otro participante que también la tiene.

Para la máxima protección, combina los dos: `--tls --e2e`.

## Registro (`--log`)

Por defecto, CLI-Chat es efímero: el servidor recuerda los últimos 50 mensajes
de cada sala en memoria y los olvida al cerrarse. Con `--log chat.txt`, quien
levanta el chat guarda las salas en un archivo:

```
[2026-10-01 22:11:50] #general <ana> ¿arrancamos?
[2026-10-01 22:11:51] #general * beto trae café
```

- **Todos los participantes ven un aviso al entrar** de que el chat se registra.
- Los mensajes privados nunca se registran.
- Con `--e2e`, el registro solo contiene texto cifrado: el servidor no tiene la
  frase y no puede leerlo.

## Conectarse entre equipos

- **Misma red Wi-Fi o LAN:** usa la IP que muestra `clichat host`.
- **Sin Wi-Fi:** el anfitrión activa la zona Wi-Fi de su teléfono y los demás se
  conectan a ella.
- **Por internet:** [Tailscale](https://tailscale.com) o ZeroTier en todos los
  equipos (también en Android), con la IP `100.x.x.x` que asignan. Otra opción es
  un VPS con `clichat server`, o abrir el puerto en el router.

En Windows, el anfitrión tiene que permitir el puerto en el firewall. Ejecuta
como administrador:

```
netsh advfirewall firewall add rule name="CLI-Chat" dir=in action=allow protocol=TCP localport=5555
```

### Consejos para Termux

- Para mantener el chat vivo con la pantalla apagada, ejecuta `termux-wake-lock`.
- Ctrl+C en Termux es **Volumen abajo + C**. La fila de teclas extra trae Tab, PgUp y PgDn.
- En pantallas angostas el panel lateral arranca oculto; F2 o `/panel` lo muestra.
- Si no aparece tu IP al crear un chat, búscala en Ajustes > Wi-Fi > tu red.

## Configuración

`clichat` recuerda tu último nick, los últimos 5 servidores y las huellas de los
servidores cifrados. Nunca guarda contraseñas.

- Linux, macOS y Termux: `~/.config/clichat/`
- Windows: `%APPDATA%\clichat\`
- Otra ubicación: `CLI_CHAT_CONFIG_DIR=/ruta`

Ahí también vive el certificado del servidor (`server-cert.pem` y `server-key.pem`).

## Seguridad

- El servidor filtra caracteres de control y secuencias ANSI, así que nadie
  puede manipular la terminal de otro.
- Hay límites de tamaño de mensaje y un antiflood por conexión.
- El historial vive solo en memoria y se pierde al cerrar el servidor, salvo con `--log`.
- **CLI-Chat no es una herramienta de anonimato.** Quien levanta el servidor ve
  IPs, nicks y horarios aunque el contenido vaya cifrado.

## Aviso legal

CLI-Chat se distribuye "tal cual", sin garantías. Los autores no son responsables
del uso que se le dé: quien lo usa debe cumplir las leyes de su jurisdicción.
Detalles en [AVISO-LEGAL.md](AVISO-LEGAL.md).

## Desarrollo

```bash
npm test          # tests con node:test, sin dependencias
npm start         # equivale a: node bin/clichat.js
```

```
bin/clichat.js      CLI: subcomandos y menú interactivo
src/server.js       servidor (salas, comandos, protocolo)
src/client.js       cliente: saludo y elección de interfaz
src/transport.js    conexión TCP/TLS y verificación de huella
src/cert.js         certificado autofirmado y huellas
src/e2e.js          cifrado de extremo a extremo con clave compartida
src/term/launcher.js pantalla de inicio
src/term/tui.js     interfaz de pantalla completa
src/term/line.js    interfaz simple
src/term/format.js  formato de mensajes, compartido por ambas
src/term/commands.js comandos, sugerencias y pistas para autocompletar
src/completion.js   scripts de autocompletado para bash, zsh y PowerShell
src/term/width.js   ancho de caracteres (emojis, CJK)
docs/PROTOCOL.md    protocolo, para escribir otros clientes o bots
```

Las contribuciones son bienvenidas: lee [CONTRIBUTING.md](CONTRIBUTING.md).

## English

CLI-Chat is a zero-dependency terminal chat with a full-screen TUI. One person
runs `clichat host` (or `clichat server`) and others run `clichat join <ip>`.
It works on Linux, macOS, Windows and Android (Termux) with Node.js 18 or newer.
Features: rooms, private messages, history, an optional password, host
moderation, optional TLS (`--tls`) with SSH-style fingerprint pinning, optional
end-to-end encryption with a pre-shared passphrase (`--e2e`), and optional
logging (`--log`), which participants are always told about. Install it with
`npm install -g clichat`. Licensed under MIT, provided as is: see
[AVISO-LEGAL.md](AVISO-LEGAL.md).

## Licencia

[MIT](LICENSE)
