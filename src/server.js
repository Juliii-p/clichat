'use strict';
// Servidor central de CLI-Chat. Protocolo: un objeto JSON por línea sobre TCP
// (ver docs/PROTOCOL.md).

const fs = require('fs');
const net = require('net');
const tls = require('tls');
const readline = require('readline');
const { fingerprint } = require('./cert');
const { VERSION, DEFAULT_PORT, NICK_RE, NICK_HELP, localAddresses } = require('./util');

const SERVER_NAME = 'CLI-Chat';
const DEFAULT_ROOM = 'general';
const HISTORY_SIZE = 50;        // mensajes recordados por sala
const MAX_TEXT = 4000;          // caracteres por mensaje (los cifrados e2e ocupan más)
const MAX_BUFFER = 16 * 1024;   // bytes sin salto de línea antes de cortar
const HELLO_TIMEOUT = 60_000;   // ms para identificarse
const RATE_BURST = 8;           // mensajes seguidos permitidos
const RATE_PER_SEC = 2;         // recarga de mensajes por segundo
const ROOM_RE = /^[a-z0-9_-]{1,24}$/;

// Líneas cortas: tiene que leerse bien en la pantalla de un teléfono.
// Ayuda por secciones. Comandos y descripciones cortos: deben entrar en un teléfono.
const HELP_SECTIONS = [
  {
    title: 'MENSAJES',
    items: [
      ['/msg <nick> <txt>', 'mensaje privado'],
      ['/r <texto>', 'responder privado'],
      ['/me <acción>', 'acción (* nick ...)'],
      ['//texto', 'enviar un "/" literal'],
    ],
  },
  {
    title: 'SALAS',
    items: [
      ['/join <sala>', 'entrar o crear sala'],
      ['/rooms', 'ver salas'],
      ['/who [sala]', 'quién está'],
      ['/topic [texto]', 'ver o cambiar tema'],
    ],
  },
  {
    title: 'PERSONAS',
    items: [
      ['/users', 'todos los conectados'],
      ['/nick <nuevo>', 'cambiar de nick'],
    ],
  },
  {
    title: 'PANTALLA',
    items: [
      ['/clear', 'limpiar'],
      ['/panel', 'panel lateral (TUI)'],
      ['/quit [mensaje]', 'salir'],
    ],
  },
];
const ADMIN_SECTION = {
  title: 'ANFITRIÓN',
  items: [
    ['/kick <nick>', 'expulsar (+ motivo)'],
    ['/announce <texto>', 'anuncio para todos'],
  ],
};
// Lista plana para autocompletar: { cmd: '/msg', args: '<nick> <txt>', desc }.
const commandsFor = (admin) =>
  (admin ? [...HELP_SECTIONS, ADMIN_SECTION] : HELP_SECTIONS)
    .flatMap((s) => s.items)
    .filter(([usage]) => !usage.startsWith('//'))
    .map(([usage, desc]) => {
      const [cmd, ...args] = usage.split(' ');
      return { cmd, args: args.join(' '), desc };
    })
    .concat([{ cmd: '/help', args: '', desc: 'ver comandos' }]);
// Versión en texto, para clientes que no dibujan la vista estructurada.
const helpText = (sections) =>
  sections.map((s) => `${s.title}:\n${s.items.map(([cmd, desc]) => ` ${cmd.padEnd(18)} ${desc}`).join('\n')}`).join('\n');

// Quita caracteres de control (incluye secuencias ANSI) para que nadie pueda
// manipular la terminal de otros usuarios.
const clean = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, MAX_TEXT);

function defaultLog(...parts) {
  console.log(`[${new Date().toLocaleString('sv-SE')}]`, ...parts);
}

/**
 * Arranca un servidor. Devuelve una promesa con { port, addresses, shutdown }.
 *   port          puerto (0 = uno libre al azar)
 *   bind          IP donde escuchar
 *   password      contraseña para entrar (opcional)
 *   adminToken    quien lo envía en el saludo es anfitrión (/kick, /announce)
 *   tls           { cert, key } para cifrar las conexiones; null = sin cifrado
 *   logFile       archivo donde registrar las salas (no los privados); null = nada
 *   log           función de log, o null para silenciar
 *   adminConsole  leer comandos de administración desde la terminal
 */
function startServer({
  port = DEFAULT_PORT,
  bind = '0.0.0.0',
  password = '',
  adminToken = '',
  tls: tlsOptions = null,
  logFile = null,
  log = defaultLog,
  adminConsole = false,
} = {}) {
  log = log || (() => {});

  // ------------------------------------------------------------ estado

  const clients = new Set();
  const rooms = new Map();

  function getRoom(name) {
    if (!rooms.has(name)) rooms.set(name, { name, topic: '', members: new Set(), history: [] });
    return rooms.get(name);
  }
  getRoom(DEFAULT_ROOM).topic = 'Sala principal';

  const online = () => [...clients].filter((c) => c.nick);
  const nicksIn = (room) => [...room.members].map((c) => c.nick).sort((a, b) => a.localeCompare(b));

  const roomList = () =>
    [...rooms.values()]
      .sort((a, b) => b.members.size - a.members.size || a.name.localeCompare(b.name))
      .map((r) => ({ name: r.name, users: r.members.size, topic: r.topic }));
  const roster = (room) =>
    [...room.members]
      .sort((a, b) => a.nick.localeCompare(b.nick))
      .map((c) => ({ nick: c.nick, admin: c.admin }));

  function findByNick(nick) {
    const n = String(nick).toLowerCase();
    for (const c of clients) if (c.nick && c.nick.toLowerCase() === n) return c;
    return null;
  }

  // ------------------------------------------------------------ envío

  function send(c, msg) {
    if (c.socket.writable) c.socket.write(JSON.stringify(msg) + '\n');
  }
  function toRoom(room, msg, except) {
    for (const c of room.members) if (c !== except) send(c, msg);
  }
  function toAll(msg) {
    for (const c of online()) send(c, msg);
  }
  const system = (c, text) => send(c, { type: 'system', text });
  const error = (c, text) => send(c, { type: 'error', text });
  const state = (c) => send(c, { type: 'state', nick: c.nick, room: c.room && c.room.name, admin: c.admin });
  // Para las interfaces con panel: lista de salas y quién está en la sala actual.
  const pushRooms = () => toAll({ type: 'rooms', rooms: roomList() });
  const pushRoster = (room) => toRoom(room, { type: 'roster', room: room.name, users: roster(room) });

  // ------------------------------------------------------------ salas

  function join(c, name) {
    const room = getRoom(name);
    if (c.room === room) return system(c, `Ya estás en #${name}.`);
    leave(c, `${c.nick} se fue a #${name}`);
    c.room = room;
    room.members.add(c);
    toRoom(room, { type: 'system', text: `${c.nick} entró a #${name}`, room: name }, c);
    send(c, { type: 'joined', room: name, topic: room.topic, users: nicksIn(room), history: room.history });
    state(c);
    pushRoster(room);
    pushRooms();
  }

  function leave(c, reason) {
    const room = c.room;
    if (!room) return;
    room.members.delete(c);
    c.room = null;
    toRoom(room, { type: 'system', text: reason, room: room.name });
    if (room.members.size === 0 && room.name !== DEFAULT_ROOM) rooms.delete(room.name);
    else pushRoster(room);
  }

  // ------------------------------------------------------------ registro (opcional)

  // Se abre al arrancar para que una ruta inválida falle enseguida y no a mitad del chat.
  const transcript = logFile ? fs.createWriteStream(null, { fd: fs.openSync(logFile, 'a') }) : null;
  function record(text) {
    if (transcript) transcript.write(`[${new Date().toLocaleString('sv-SE')}] ${text}\n`);
  }
  record('--- chat iniciado ---');

  function post(c, type, text) {
    record(type === 'action' ? `#${c.room.name} * ${c.nick} ${text}` : `#${c.room.name} <${c.nick}> ${text}`);
    const msg = { type, room: c.room.name, from: c.nick, text, ts: Date.now() };
    c.room.history.push(msg);
    if (c.room.history.length > HISTORY_SIZE) c.room.history.shift();
    toRoom(c.room, msg);
  }

  function privateMessage(c, target, text) {
    if (!target) return error(c, 'Ese usuario no está conectado.');
    if (target === c) return error(c, 'No puedes enviarte mensajes a ti mismo.');
    const msg = { type: 'pm', from: c.nick, to: target.nick, text, ts: Date.now() };
    send(target, msg);
    send(c, msg);
    target.lastPm = c.nick;
    c.lastPm = target.nick;
  }

  function announce(text) {
    record(`[ANUNCIO] ${clean(text)}`);
    toAll({ type: 'announce', text: clean(text), ts: Date.now() });
  }

  function kick(target, reason) {
    send(target, { type: 'fatal', text: `Te expulsaron del chat${reason ? ': ' + reason : '.'}` });
    target.quitMessage = 'expulsado' + (reason ? ': ' + reason : '');
    target.socket.end();
  }

  // ------------------------------------------------------------ comandos

  const commands = {
    help(c) {
      const sections = c.admin ? [...HELP_SECTIONS, ADMIN_SECTION] : HELP_SECTIONS;
      // `view` es opcional: los clientes que lo entienden lo dibujan, el resto muestra `text`.
      send(c, { type: 'system', text: helpText(sections), view: { kind: 'help', sections } });
    },
    join(c, arg) {
      const name = arg.replace(/^#/, '').toLowerCase();
      if (!ROOM_RE.test(name)) return error(c, 'Sala inválida: 1 a 24 caracteres (a-z, 0-9, _ o -).');
      join(c, name);
    },
    rooms(c) {
      const list = roomList();
      const lines = list.map((r) => ` #${r.name} (${r.users})${r.topic ? ' — ' + r.topic : ''}`);
      send(c, { type: 'system', text: 'Salas:\n' + lines.join('\n'), view: { kind: 'rooms', rooms: list, current: c.room.name } });
    },
    who(c, arg) {
      const name = arg ? arg.replace(/^#/, '').toLowerCase() : c.room.name;
      const room = rooms.get(name);
      if (!room) return error(c, `La sala #${name} no existe.`);
      send(c, {
        type: 'system',
        text: `En #${name} (${room.members.size}): ${nicksIn(room).join(', ') || 'nadie'}`,
        view: { kind: 'who', room: name, users: roster(room) },
      });
    },
    users(c) {
      const users = online()
        .sort((a, b) => a.nick.localeCompare(b.nick))
        .map((u) => ({ nick: u.nick, admin: u.admin, room: u.room ? u.room.name : '?' }));
      const lines = users.map((u) => ` ${u.nick}${u.admin ? ' ★' : ''} — #${u.room}`);
      send(c, { type: 'system', text: `Conectados (${users.length}):\n${lines.join('\n')}`, view: { kind: 'users', users } });
    },
    msg(c, arg) {
      const m = arg.match(/^(\S+)\s+(.+)$/);
      if (!m) return error(c, 'Uso: /msg <nick> <texto>');
      privateMessage(c, findByNick(m[1]), m[2]);
    },
    r(c, arg) {
      if (!arg) return error(c, 'Uso: /r <texto>');
      if (!c.lastPm) return error(c, 'Todavía no tienes conversaciones privadas.');
      privateMessage(c, findByNick(c.lastPm), arg);
    },
    me(c, arg) {
      if (!arg) return error(c, 'Uso: /me <acción>');
      post(c, 'action', arg);
    },
    nick(c, arg) {
      if (!NICK_RE.test(arg)) return error(c, NICK_HELP);
      const other = findByNick(arg);
      if (other && other !== c) return error(c, `El nick "${arg}" ya está en uso.`);
      const old = c.nick;
      c.nick = arg;
      toRoom(c.room, { type: 'system', text: `${old} ahora se llama ${arg}`, room: c.room.name });
      state(c);
      pushRoster(c.room);
      log(`${old} -> ${arg}`);
    },
    topic(c, arg) {
      const room = c.room;
      if (!arg) return system(c, room.topic ? `Tema de #${room.name}: ${room.topic}` : `#${room.name} no tiene tema.`);
      room.topic = arg.slice(0, 120);
      record(`#${room.name} -- ${c.nick} cambió el tema: ${room.topic}`);
      toRoom(room, { type: 'system', text: `${c.nick} cambió el tema: ${room.topic}`, room: room.name });
      pushRooms();
    },
    quit(c, arg) {
      c.quitMessage = arg;
      system(c, '¡Hasta luego!');
      c.socket.end();
    },
    kick(c, arg) {
      if (!c.admin) return error(c, 'Solo el anfitrión puede expulsar.');
      const m = arg.match(/^(\S+)\s*(.*)$/);
      const target = m && findByNick(m[1]);
      if (!target) return error(c, 'Uso: /kick <nick> [motivo] (el usuario debe estar conectado)');
      if (target === c) return error(c, 'No puedes expulsarte a ti mismo.');
      kick(target, m[2]);
      log(`${c.nick} expulsó a ${target.nick}`);
    },
    announce(c, arg) {
      if (!c.admin) return error(c, 'Solo el anfitrión puede enviar anuncios.');
      if (!arg) return error(c, 'Uso: /announce <texto>');
      announce(arg);
    },
  };
  const aliases = { j: 'join', list: 'rooms', w: 'who', m: 'msg', pm: 'msg', exit: 'quit', h: 'help', '?': 'help' };

  // ------------------------------------------------------------ protocolo

  function hello(c, msg) {
    if (msg.type !== 'hello') return error(c, 'Primero debes identificarte.');
    const isAdmin = Boolean(adminToken) && msg.adminToken === adminToken;
    if (password && !isAdmin) {
      if (!msg.password) return send(c, { type: 'password_required' });
      if (msg.password !== password) {
        log(`contraseña incorrecta desde ${c.addr}`);
        send(c, { type: 'fatal', text: 'Contraseña incorrecta.' });
        return c.socket.end();
      }
    }
    const nick = clean(msg.nick);
    if (!NICK_RE.test(nick)) return send(c, { type: 'nick_rejected', text: NICK_HELP });
    if (findByNick(nick)) return send(c, { type: 'nick_rejected', text: `El nick "${nick}" ya está en uso.` });

    c.nick = nick;
    c.admin = isAdmin;
    clearTimeout(c.helloTimer);
    log(`${nick} se conectó desde ${c.addr}`);
    send(c, {
      type: 'welcome',
      server: SERVER_NAME,
      version: VERSION,
      nick,
      online: online().length,
      logged: Boolean(transcript),
      commands: commandsFor(isAdmin),
      motd:
        `Bienvenido a ${SERVER_NAME}, ${nick}. Escribe /help para ver los comandos.` +
        (transcript ? '\nAtención: este chat se registra en el servidor (salas, no privados).' : ''),
    });
    join(c, DEFAULT_ROOM);
  }

  function rateLimited(c) {
    const now = Date.now();
    c.tokens = Math.min(RATE_BURST, c.tokens + ((now - c.lastTick) / 1000) * RATE_PER_SEC);
    c.lastTick = now;
    if (c.tokens < 1) return true;
    c.tokens -= 1;
    return false;
  }

  function onLine(c, line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return error(c, 'Mensaje mal formado.');
    }
    if (!msg || typeof msg !== 'object') return;
    if (!c.nick) return hello(c, msg);
    if (msg.type !== 'line') return;

    const text = clean(msg.text);
    if (!text) return;
    if (rateLimited(c)) return error(c, 'Vas muy rápido, espera un momento.');

    if (text.startsWith('//')) return post(c, 'chat', text.slice(1));
    if (!text.startsWith('/')) return post(c, 'chat', text);

    const m = text.match(/^\/(\S+)\s*(.*)$/);
    const name = m && (aliases[m[1].toLowerCase()] || m[1].toLowerCase());
    const handler = name && Object.hasOwn(commands, name) && commands[name];
    if (!handler) return error(c, `Comando desconocido: ${text.split(/\s/)[0]} — escribe /help`);
    handler(c, m[2].trim());
  }

  function disconnect(c) {
    if (!clients.delete(c)) return;
    clearTimeout(c.helloTimer);
    if (!c.nick) return;
    const extra = c.quitMessage ? ` (${c.quitMessage})` : '';
    leave(c, `${c.nick} salió del chat${extra}`);
    pushRooms();
    log(`${c.nick} se desconectó${extra}`);
  }

  function onConnection(socket) {
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);

    const c = {
      socket,
      addr: `${socket.remoteAddress}:${socket.remotePort}`,
      nick: null,
      admin: false,
      room: null,
      lastPm: null,
      quitMessage: '',
      tokens: RATE_BURST,
      lastTick: Date.now(),
      buffer: '',
    };
    c.helloTimer = setTimeout(() => {
      send(c, { type: 'fatal', text: 'Tiempo de identificación agotado.' });
      socket.end();
    }, HELLO_TIMEOUT);
    clients.add(c);

    socket.on('data', (chunk) => {
      // Un cliente que intenta TLS contra un servidor sin cifrado: se corta en seco
      // para que el cliente se dé cuenta enseguida y pruebe sin cifrar.
      if (!tlsOptions && !c.nick && c.buffer === '' && chunk.charCodeAt(0) === 0x16) return socket.destroy();
      c.buffer += chunk;
      let i;
      while ((i = c.buffer.indexOf('\n')) !== -1) {
        const line = c.buffer.slice(0, i).trim();
        c.buffer = c.buffer.slice(i + 1);
        if (line) onLine(c, line);
      }
      if (c.buffer.length > MAX_BUFFER) socket.destroy();
    });
    socket.on('close', () => disconnect(c));
    socket.on('error', () => {});
  }

  const server = tlsOptions
    ? tls.createServer({ cert: tlsOptions.cert, key: tlsOptions.key, minVersion: 'TLSv1.2' }, onConnection)
    : net.createServer(onConnection);
  // Clientes sin cifrado contra un servidor cifrado, escaneos, etc.: no hay nada que hacer.
  server.on('tlsClientError', () => {});

  // ------------------------------------------------------------ apagado

  let stopping = null;
  function shutdown(reason = 'El servidor se está apagando.') {
    if (stopping) return stopping;
    log('apagando servidor...');
    record('--- chat cerrado ---');
    if (transcript) transcript.end();
    toAll({ type: 'fatal', text: reason });
    for (const c of clients) c.socket.end();
    stopping = new Promise((resolve) => {
      server.close(() => resolve());
      // Si algún cliente no cierra a tiempo, se corta igual.
      setTimeout(() => {
        for (const c of clients) c.socket.destroy();
        resolve();
      }, 1000).unref();
    });
    return stopping;
  }

  // ------------------------------------------------------------ consola de administración

  const CONSOLE_HELP = [
    'Consola del servidor:',
    '  <texto>               anuncio para todos',
    '  /users                ver conectados',
    '  /rooms                ver salas',
    '  /kick <nick> [motivo] expulsar',
    '  /stop                 apagar el servidor',
  ].join('\n');

  function consoleCommand(line) {
    if (!line.startsWith('/')) {
      announce(line);
      return log(`anuncio enviado a ${online().length} usuarios`);
    }
    const [, cmd = '', rest = ''] = line.match(/^\/(\S+)\s*(.*)$/) || [];
    switch (cmd.toLowerCase()) {
      case 'users':
        return console.log(online().map((u) => `  ${u.nick} — #${u.room?.name} — ${u.addr}`).join('\n') || '  (nadie)');
      case 'rooms':
        return console.log([...rooms.values()].map((r) => `  #${r.name} (${r.members.size})`).join('\n'));
      case 'kick': {
        const m = rest.match(/^(\S+)\s*(.*)$/);
        const target = m && findByNick(m[1]);
        if (!target) return console.log('Ese usuario no está conectado.');
        return kick(target, m[2]);
      }
      case 'stop':
      case 'quit':
        return shutdown().then(() => process.exit(0));
      default:
        return console.log(CONSOLE_HELP);
    }
  }

  function startAdminConsole() {
    const stop = () => shutdown().then(() => process.exit(0));
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', (line) => line.trim() && consoleCommand(line.trim()));
      rl.on('SIGINT', stop);
    }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, () => {
      server.off('error', reject);
      server.on('error', (err) => log('error del servidor: ' + err.message));
      if (adminConsole) startAdminConsole();
      resolve({
        port: server.address().port,
        bind,
        addresses: localAddresses(),
        fingerprint: tlsOptions ? fingerprint(tlsOptions.cert) : null,
        shutdown,
      });
    });
  });
}

module.exports = { startServer };
