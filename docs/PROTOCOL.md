# Protocolo de CLI-Chat

TCP, texto UTF-8, **un objeto JSON por línea** (terminado en `\n`). Puerto por
defecto: `5555`. Con esto se puede escribir un cliente o un bot en cualquier
lenguaje.

## Cifrado

Si el servidor se levantó con `--tls`, la conexión entera va dentro de TLS
(1.2 o superior) y el protocolo de adentro es idéntico. El certificado suele ser
autofirmado, y la confianza se da comparando la huella SHA-256 del certificado,
como en SSH.

Un servidor sin cifrado que recibe un saludo TLS (primer byte `0x16`) corta la
conexión de inmediato. Así un cliente en modo automático detecta enseguida que
debe seguir sin cifrado.

## Cifrado de extremo a extremo

Es una convención entre clientes: el servidor no la conoce ni la necesita. Un
texto cifrado viaja como texto normal con el formato:

```
e2e1:<base64( nonce[12] || AES-256-GCM(JSON {"t": texto, "ts": ms}) || tag[16] )>
```

- Clave: `scrypt(frase NFC, sal "clichat-e2e-v1", N=2^15, r=8, p=1)`, 32 bytes.
- AAD: `clichat|<tipo>|<autor en minúsculas>`, donde tipo es `chat`, `me` o `pm`.
- Código de verificación: los primeros 8 bytes de
  `HMAC-SHA256(clave, "clichat-verificacion")`, en hexadecimal.
- Se cifra el texto de los mensajes, de `/me`, de `/msg` y de `/r`. Los comandos
  van en claro.

## Cliente → servidor

| Mensaje | Campos | Cuándo |
|---|---|---|
| `hello` | `nick`, `password?`, `adminToken?` | primer mensaje; se repite si el servidor rechaza el nick o pide contraseña |
| `line`  | `text` | todo lo que escribe el usuario: texto normal o comando (`/join dev`) |

Los comandos los interpreta el servidor, así que un cliente nuevo los soporta
todos sin hacer nada. Si no se envía un `hello` válido en 60 segundos, se corta
la conexión.

## Servidor → cliente

| Mensaje | Campos | Significado |
|---|---|---|
| `password_required` | | reenviar `hello` con `password` |
| `nick_rejected` | `text` | nick inválido o en uso; reenviar `hello` con otro |
| `welcome` | `server`, `version`, `nick`, `online`, `logged`, `commands[]`, `motd` | entrada aceptada; `logged` indica si el servidor registra las salas; `commands` (`cmd`, `args`, `desc`) sirve para autocompletar e incluye los de anfitrión si corresponde |
| `joined` | `room`, `topic`, `users[]`, `history[]` | entraste a una sala; `history` trae mensajes `chat` y `action` |
| `state` | `nick`, `room`, `admin` | tu nick o sala actual cambió |
| `rooms` | `rooms[]` (`name`, `users`, `topic`) | lista de salas; llega cada vez que cambia |
| `roster` | `room`, `users[]` (`nick`, `admin`) | quién está en tu sala; llega cada vez que cambia |
| `chat` | `room`, `from`, `text`, `ts` | mensaje en la sala (también recibes los tuyos) |
| `action` | `room`, `from`, `text`, `ts` | `/me` |
| `pm` | `from`, `to`, `text`, `ts` | mensaje privado (lo reciben el emisor y el destinatario) |
| `system` | `text`, `room?`, `view?` | aviso del sistema; puede tener varias líneas. `view` (opcional) trae los mismos datos estructurados para dibujarlos: `help` (`sections[]` con `title` e `items` `[comando, descripción]`), `users` (`users[]` con `nick`, `admin`, `room`), `rooms` (`rooms[]`, `current`) y `who` (`room`, `users[]`). Quien no lo entienda muestra `text`. |
| `announce` | `text`, `ts` | anuncio del anfitrión o del administrador |
| `error` | `text` | algo salió mal; la conexión sigue |
| `fatal` | `text` | el servidor va a cerrar la conexión |

`ts` es un timestamp en milisegundos (`Date.now()`). Los clientes deben ignorar
los tipos de mensaje que no conozcan: así se pueden agregar tipos nuevos sin
romper clientes viejos.

## Ejemplo

```
→ {"type":"hello","nick":"ana"}
← {"type":"welcome","server":"CLI-Chat","version":"1.0.0","nick":"ana","online":1,"motd":"..."}
← {"type":"joined","room":"general","topic":"Sala principal","users":["ana"],"history":[]}
← {"type":"state","nick":"ana","room":"general","admin":false}
→ {"type":"line","text":"hola"}
← {"type":"chat","room":"general","from":"ana","text":"hola","ts":1790896630291}
```

## Límites

- Nick: `^[A-Za-z0-9_-]{2,20}$`, único sin distinguir mayúsculas.
- Sala: `^[a-z0-9_-]{1,24}$`.
- Texto: hasta 4000 caracteres (los cifrados ocupan más); el servidor elimina los caracteres de control.
- Antiflood: ráfagas de 8 mensajes, que se recargan a razón de 2 por segundo.
- Una línea de más de 16 KB sin `\n` corta la conexión.
