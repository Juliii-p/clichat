#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');
const { Writable } = require('stream');
const config = require('../src/config');
const cert = require('../src/cert');
const { deriveKey } = require('../src/e2e');
const { startServer } = require('../src/server');
const { startClient } = require('../src/client');
const { c } = require('../src/term/colors');
const { VERSION, DEFAULT_PORT, NICK_RE, NICK_HELP, parseArgs, parseAddress } = require('../src/util');

const USAGE = `${c.bold('CLI-Chat')} ${VERSION} — chat por terminal

Uso:
  clichat                       menú interactivo
  clichat host                  crear un chat y participar
  clichat join <ip[:puerto]>    unirse a un chat
  clichat server                servidor dedicado (sin chatear)
  clichat forget <ip[:puerto]>  olvidar la huella guardada de un servidor
  clichat completion <shell>    autocompletado para bash, zsh o powershell
  clichat fingerprint           huella TLS de este equipo, para compartirla

Opciones:
  -n, --nick <nick>             tu nick
  -p, --port <puerto>           puerto (por defecto ${DEFAULT_PORT})
  --password <clave>            contraseña del chat
  --simple                      interfaz línea a línea en vez de pantalla completa
  -h, --help                    esta ayuda
  -v, --version                 versión

Cifrado (opcional):
  --tls                         host/server: cifrar la conexión
                                join: exigir conexión cifrada
  --no-tls                      join: conectar sin cifrado
  --fp <huella>                 join: huella esperada del servidor
  --e2e                         host/join: cifrado de extremo a extremo con
                                una clave compartida (se pide sin mostrarla)
  --cert <archivo> --key <arch> host/server: certificado propio (PEM)

Servidor:
  --bind <ip>                   host/server: IP donde escuchar (0.0.0.0)
  --log <archivo>               host/server: registrar las salas en un archivo

Ejemplos:
  clichat host --nick ana --tls --e2e
  clichat join 192.168.1.20 --nick beto --e2e
  clichat 192.168.1.20          (atajo de join)`;

const args = parseArgs(process.argv.slice(2), {
  alias: { n: 'nick', p: 'port', h: 'help', v: 'version' },
  boolean: ['help', 'version', 'tls', 'no-tls', 'simple', 'e2e'],
});
const env = process.env;

function fail(message) {
  console.error(c.red('!! ' + message));
  process.exit(1);
}

function portOption() {
  const raw = args.port ?? env.CLI_CHAT_PORT;
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Puerto inválido: ${raw}`);
  return port;
}

const password = () => args.password ?? env.CLI_CHAT_PASSWORD ?? '';
const wantsTls = () => Boolean(args.tls) || /^(1|true|si|sí|yes)$/i.test(env.CLI_CHAT_TLS || '');

// ------------------------------------------------------------ preguntas

let rl = null;
function ask(question, fallback = '') {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('close', () => rl && process.exit(0)); // entrada cerrada a mitad de una pregunta
  }
  const hint = fallback ? c.gray(` [${fallback}]`) : '';
  return new Promise((resolve) => rl.question(`${question}${hint}: `, (a) => resolve(a.trim() || fallback)));
}
function doneAsking() {
  if (!rl) return;
  const r = rl;
  rl = null;
  r.close();
}
const yes = (answer) => /^(s|si|sí|y|yes)$/i.test(answer);

// Pregunta sin mostrar lo que se escribe (para la clave compartida).
function askSecret(question) {
  doneAsking();
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _enc, done) {
        if (!muted) process.stdout.write(chunk);
        done();
      },
    });
    const secret = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
    secret.on('SIGINT', () => process.exit(130));
    secret.question(`${question}: `, (answer) => {
      secret.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true; // la pregunta ya se mostró; lo que se tipee, no
  });
}

// Clave de extremo a extremo: --e2e la pide; CLI_CHAT_E2E o la pantalla de inicio
// la dan sin preguntar.
let presetPhrase = null;
async function resolveE2E() {
  let phrase = presetPhrase || env.CLI_CHAT_E2E || '';
  while (args.e2e && !phrase) phrase = await askSecret('Clave compartida (e2e)');
  if (!phrase) return null;
  if (phrase.length < 12) {
    console.log(c.yellow('⚠ Clave corta: con menos de 12 caracteres es más fácil de adivinar.'));
  }
  return deriveKey(phrase);
}

async function resolveNick() {
  let nick = args.nick || env.CLI_CHAT_NICK || '';
  const saved = config.load().nick || '';
  while (!NICK_RE.test(nick)) {
    if (nick) console.log(c.red('!! ' + NICK_HELP));
    nick = await ask('Tu nick', saved);
  }
  return nick;
}

// ------------------------------------------------------------ modos

function clientOptions() {
  if (args.tls && args['no-tls']) fail('--tls y --no-tls no van juntos.');
  return {
    tls: args.tls ? 'tls' : args['no-tls'] ? 'plain' : 'auto',
    fingerprint: args.fp,
    ui: args.simple || env.CLI_CHAT_SIMPLE ? 'line' : 'tui',
  };
}

async function join(target) {
  const recents = config.load().servers || [];
  if (!target) {
    if (recents.length) {
      console.log(c.gray('Recientes: ' + recents.map((s, i) => `${i + 1}) ${s}`).join('  ')));
    }
    while (!target) {
      target = await ask('IP del servidor (o número de reciente)', recents[0]);
      if (/^\d$/.test(target) && recents[Number(target) - 1]) target = recents[Number(target) - 1];
    }
  }
  const { host, port } = parseAddress(target, portOption() ?? DEFAULT_PORT);
  const nick = await resolveNick();
  const e2eKey = await resolveE2E();
  doneAsking();
  startClient({ host, port, nick, password: password(), e2eKey, ...clientOptions() });
}

function tlsMaterial() {
  if (!wantsTls()) return null;
  if (args.cert || args.key) {
    if (!args.cert || !args.key) fail('--cert y --key van juntos.');
    try {
      return { cert: fs.readFileSync(args.cert, 'utf8'), key: fs.readFileSync(args.key, 'utf8') };
    } catch (err) {
      fail(`No se pudo leer el certificado: ${err.message}`);
    }
  }
  return cert.loadOrCreate(config.configDir());
}

async function listen(options) {
  try {
    return await startServer({
      port: portOption() ?? DEFAULT_PORT,
      bind: args.bind || env.CLI_CHAT_BIND || '0.0.0.0',
      password: password(),
      tls: tlsMaterial(),
      logFile: args.log || env.CLI_CHAT_LOG || null,
      ...options,
    });
  } catch (err) {
    if (err.syscall === 'open') fail(`No se pudo abrir el archivo de registro: ${err.message}`);
    if (err.code === 'EADDRINUSE') fail(`El puerto ya está en uso. Prueba con otro: --port ${DEFAULT_PORT + 1}`);
    if (err.code === 'EACCES') fail('Sin permiso para usar ese puerto. Usa uno mayor a 1024.');
    if (err.code === 'EADDRNOTAVAIL') fail(`Esta máquina no tiene la IP ${args.bind}.`);
    fail(err.message);
  }
}

function shareInfo(srv) {
  const portSuffix = srv.port === DEFAULT_PORT ? '' : `:${srv.port}`;
  const extras = [srv.fingerprint ? 'cifrado' : 'sin cifrar', password() && 'con contraseña'].filter(Boolean);
  const lines = [c.green(`✔ Chat abierto en el puerto ${srv.port} (${extras.join(', ')})`)];
  const ips = srv.bind === '0.0.0.0' ? srv.addresses : [srv.bind];
  if (ips.length) {
    lines.push('  Para unirse desde otro equipo:');
    for (const ip of ips) lines.push(c.bold(`    clichat join ${ip}${portSuffix}`));
  } else {
    lines.push('  No pude detectar tu IP. En Android: Ajustes > Wi-Fi > tu red.');
    lines.push(c.bold(`  Los demás usan: clichat join <tu-ip>${portSuffix}`));
  }
  if (srv.fingerprint) {
    lines.push(`  Huella: ${c.bold(cert.shortFingerprint(srv.fingerprint))}`);
    lines.push(c.gray('  Quien se una verá esta huella: debe coincidir.'));
  } else {
    lines.push(c.yellow('  Los mensajes viajan sin cifrar. Para cifrar: --tls'));
  }
  const logFile = args.log || env.CLI_CHAT_LOG;
  if (logFile) lines.push(c.yellow(`  Registrando las salas en ${logFile} (los participantes lo ven al entrar).`));
  return lines.join('\n');
}

async function host() {
  const nick = await resolveNick();
  const e2eKey = await resolveE2E();
  doneAsking();
  const adminToken = crypto.randomBytes(16).toString('hex');
  const srv = await listen({ adminToken, log: null });
  console.log(shareInfo(srv));
  console.log(c.gray('  Eres el anfitrión: si sales, el chat se cierra para todos.\n'));
  const { ui } = clientOptions();
  startClient({
    host: '127.0.0.1',
    port: srv.port,
    nick,
    adminToken,
    tls: srv.fingerprint ? 'tls' : 'plain',
    fingerprint: srv.fingerprint,
    ui,
    e2eKey,
    remember: false,
    onExit: (code) => srv.shutdown('El anfitrión cerró el chat.').then(() => process.exit(code)),
  });
  config.remember({ nick });
}

async function server() {
  const srv = await listen({ adminConsole: true });
  console.log(shareInfo(srv));
  if (process.stdin.isTTY) console.log(c.gray('  Escribe un texto para enviar un anuncio, o /help.'));
}

function forget(target) {
  if (!target) fail('Uso: clichat forget <ip[:puerto]>');
  const removed = config.forgetHost(target);
  console.log(removed ? `Huella de ${target} olvidada.` : `No había ninguna huella guardada para ${target}.`);
}

async function askServerOptions() {
  if (args.tls === undefined && !env.CLI_CHAT_TLS) args.tls = yes(await ask('¿Cifrar la conexión? (s/n)', 's'));
  if (args.password === undefined && !env.CLI_CHAT_PASSWORD) {
    args.password = await ask('Contraseña (vacío = sin contraseña)');
  }
}

async function askE2E() {
  if (args.e2e === undefined && !env.CLI_CHAT_E2E) {
    args.e2e = yes(await ask('¿Cifrado de extremo a extremo con clave compartida? (s/n)', 'n'));
  }
}

// Pantalla de inicio táctica. Lo que se elige ahí se vuelca en `args` y sigue por los
// mismos caminos que `clichat join/host/server`.
async function launcher() {
  const { runLauncher } = require('../src/term/launcher');
  const cfg = config.load();
  const choice = await runLauncher({ version: VERSION, nick: cfg.nick, recents: cfg.servers || [] });
  if (!choice) return console.log(c.gray('Cancelado.'));
  Object.assign(args, choice.args);
  presetPhrase = choice.e2ePhrase;
  if (choice.mode === 'join') return join(choice.target);
  if (choice.mode === 'host') return host();
  return server();
}

async function menu() {
  console.log(`${c.bold(c.cyan('CLI-Chat'))} ${c.gray(VERSION)}\n`);
  console.log('  1) Unirme a un chat');
  console.log('  2) Crear un chat (y participar)');
  console.log('  3) Solo servidor');
  console.log('  q) Salir\n');
  for (;;) {
    const choice = (await ask('Opción', '1')).toLowerCase();
    if (choice === '1') {
      await askE2E();
      return join();
    }
    if (choice === '2') {
      await askServerOptions();
      await askE2E();
      return host();
    }
    if (choice === '3') {
      await askServerOptions();
      doneAsking();
      return server();
    }
    if (choice === 'q') return doneAsking();
  }
}

// ------------------------------------------------------------ entrada

const [command, target] = args._;

if (args.version) {
  console.log(VERSION);
} else if (args.help || command === 'help') {
  console.log(USAGE);
} else {
  switch (command) {
    case undefined:
      // En una terminal interactiva, la sala de briefing; en scripts o con --simple,
      // el menú clásico de siempre (lo que ya funciona no se rompe).
      if (process.stdin.isTTY && process.stdout.isTTY && !args.simple && !env.CLI_CHAT_SIMPLE) launcher();
      else menu();
      break;
    case 'join':
    case 'connect':
    case 'j':
      join(target);
      break;
    case 'host':
    case 'create':
      host();
      break;
    case 'server':
    case 'serve':
      server();
      break;
    case 'forget':
      forget(target);
      break;
    case 'completion': {
      const { SCRIPTS, SHELLS } = require('../src/completion');
      const shell = (target || '').toLowerCase();
      if (!SCRIPTS[shell]) fail(`Uso: clichat completion <${SHELLS.join('|')}>`);
      process.stdout.write(SCRIPTS[shell]());
      break;
    }
    case 'fingerprint':
    case 'huella': {
      // Huella del certificado de este equipo (la que verán quienes se unan con TLS).
      // Útil cuando el servidor corre en segundo plano y no hay consola donde verla.
      const pair = cert.loadOrCreate(config.configDir());
      const fp = cert.fingerprint(pair.cert);
      console.log(`${c.bold(cert.shortFingerprint(fp))}\n${c.gray(fp)}`);
      break;
    }
    case '__recientes':
      // Uso interno de los scripts de autocompletado: servidores recientes, uno por línea.
      for (const s of config.load().servers || []) console.log(s);
      break;
    default:
      // `clichat 192.168.1.20` es un atajo de `clichat join 192.168.1.20`.
      if (/^[\w.-]+(:\d+)?$|^\[.+\](:\d+)?$/.test(command) && /[.:]|^localhost$/.test(command)) join(command);
      else fail(`Comando desconocido: ${command}. Usa clichat --help`);
  }
}
