'use strict';
// Cliente de CLI-Chat: conecta, se identifica y entrega la sesión a una interfaz
// (TUI de pantalla completa o modo simple línea a línea).

const readline = require('readline');
const config = require('./config');
const { connect, readMessages } = require('./transport');
const { shortFingerprint } = require('./cert');
const { createE2E } = require('./e2e');
const { c } = require('./term/colors');
const { DEFAULT_PORT } = require('./util');

// Preguntas en modo línea, antes de que arranque la interfaz.
function createPrompter() {
  let rl = null;
  return {
    notice: (text) => console.log(text),
    ask(question) {
      if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve, reject) => {
        const onClose = () => reject(new Error('entrada cerrada'));
        rl.once('close', onClose);
        rl.question(`${question}: `, (answer) => {
          rl.off('close', onClose);
          resolve(answer.trim());
        });
      });
    },
    close() {
      if (rl) rl.close();
      rl = null;
    },
  };
}

// Saludo: maneja contraseña y nick rechazado hasta recibir la bienvenida.
function handshake(socket, messages, { nick, password, adminToken, ask, notice }) {
  return new Promise((resolve, reject) => {
    const send = (msg) => socket.write(JSON.stringify(msg) + '\n');
    const hello = () => send({ type: 'hello', nick, password: password || undefined, adminToken });
    const onClose = () => reject(new Error('El servidor cerró la conexión durante el saludo.'));
    socket.once('close', onClose);

    messages.listen(async (m) => {
      try {
        if (m.type === 'welcome') {
          messages.pause(); // lo que siga queda en cola para la interfaz
          socket.off('close', onClose);
          return resolve(m);
        }
        if (m.type === 'fatal') return reject(new Error(m.text));
        if (m.type === 'password_required') {
          password = await ask('Contraseña del chat');
          return hello();
        }
        if (m.type === 'nick_rejected') {
          notice(c.red('!! ' + m.text));
          nick = await ask('Nick');
          return hello();
        }
      } catch (err) {
        reject(err);
      }
    });
    hello();
  });
}

/**
 * Conecta al servidor y abre la interfaz de chat.
 *   host, port     servidor
 *   nick           nick inicial (si el servidor lo rechaza, se vuelve a preguntar)
 *   password       contraseña (si falta y el servidor la pide, se pregunta)
 *   tls            'auto' | 'tls' | 'plain'
 *   fingerprint    huella esperada del servidor (evita la pregunta de confianza)
 *   ui             'tui' | 'line'
 *   adminToken     token de anfitrión (lo usa `clichat host`)
 *   e2eKey         clave de cifrado de extremo a extremo (de deriveKey), o null
 *   remember       guardar nick, servidor y huella en la configuración local
 *   onExit(code)   qué hacer al terminar (por defecto process.exit)
 */
async function startClient(opts) {
  const { host, port, adminToken, remember = true } = opts;
  const exit = opts.onExit || ((code) => process.exit(code));
  const prompter = createPrompter();

  let conn;
  let welcome;
  let messages;
  try {
    console.log(c.gray(`Conectando a ${host}:${port}...`));
    conn = await connect({
      host,
      port,
      mode: opts.tls || 'auto',
      fingerprint: opts.fingerprint,
      ask: prompter.ask,
      notice: prompter.notice,
      remember,
    });
    if (!conn.secure) console.log(c.yellow('⚠ Conexión SIN cifrar: los mensajes viajan en texto plano.'));
    messages = readMessages(conn.socket);
    welcome = await handshake(conn.socket, messages, {
      nick: opts.nick,
      password: opts.password,
      adminToken,
      ask: prompter.ask,
      notice: prompter.notice,
    });
  } catch (err) {
    prompter.close();
    if (conn) conn.socket.destroy();
    let text = err.message;
    if (opts.tls === 'plain' && /durante el saludo/.test(text)) text += ' ¿Usa cifrado? Prueba sin --no-tls.';
    console.error(c.red('!! ' + text));
    return exit(1);
  }
  prompter.close();

  const { socket } = conn;
  const nick = welcome.nick;
  if (remember) config.remember({ nick, server: port === DEFAULT_PORT ? host : `${host}:${port}` });

  let quitting = false;
  let fatal = null;
  let finished = false;
  let me = nick;
  const e2e = createE2E(opts.e2eKey || null);
  const write = (text) => socket.writable && socket.write(JSON.stringify({ type: 'line', text }) + '\n');

  const session = {
    nick,
    secure: conn.secure,
    fingerprint: conn.fingerprint && shortFingerprint(conn.fingerprint),
    e2e: e2e.code,
    send(text) {
      try {
        write(e2e.outgoing(text, me));
      } catch (err) {
        ui.onMessage({ type: 'error', text: err.message });
      }
    },
    quit(command = '/quit') {
      if (quitting) return;
      quitting = true;
      session.send(command);
      socket.end();
      setTimeout(() => finish(0), 800).unref();
    },
  };

  const wantsTui = opts.ui !== 'line';
  const canTui = process.stdin.isTTY && process.stdout.isTTY;
  const ui = wantsTui && canTui ? require('./term/tui').createTui(session) : require('./term/line').createLineUi(session);
  if (wantsTui && !canTui) console.log(c.gray('(sin terminal interactiva: se usa el modo simple)'));

  function finish(code) {
    if (finished) return;
    finished = true;
    ui.destroy();
    // La TUI se borra al salir: el motivo se repite en la terminal normal.
    if (ui.kind === 'tui' && fatal) console.log(c.red('!! ' + fatal));
    if (!quitting && !fatal) console.log(c.red('!! Se perdió la conexión con el servidor.'));
    exit(code);
  }

  socket.on('close', () => finish(quitting || fatal ? 0 : 1));
  socket.on('error', () => {});
  process.stdout.on('error', () => finish(0)); // p. ej. salida redirigida que se cierra

  ui.onMessage(welcome);
  if (conn.secure) {
    ui.onMessage({ type: 'system', text: `Conexión cifrada (huella ${session.fingerprint}).` });
  }
  if (e2e.enabled) {
    ui.onMessage({
      type: 'system',
      text: `Cifrado de extremo a extremo activo. Código de la clave: ${e2e.code}\nCompáralo con los demás: si no coincide, no se van a entender.`,
    });
  }
  messages.listen((m) => {
    if (m.type === 'fatal') fatal = m.text;
    if (m.type === 'state') me = m.nick;
    ui.onMessage(e2e.incoming(m));
  });
}

module.exports = { startClient };
