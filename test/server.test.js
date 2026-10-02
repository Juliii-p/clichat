'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { startServer } = require('../src/server');

let srv;
let privateSrv;
before(async () => {
  srv = await startServer({ port: 0, bind: '127.0.0.1', log: null });
  privateSrv = await startServer({ port: 0, bind: '127.0.0.1', log: null, password: 'clave', adminToken: 'tok' });
});
after(async () => {
  await srv.shutdown();
  await privateSrv.shutdown();
});

// Cliente de prueba que habla el protocolo directamente.
function connect(port = srv.port) {
  const socket = net.connect(port, '127.0.0.1');
  const inbox = [];
  const waiters = new Set();
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      inbox.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
    for (const check of [...waiters]) check();
  });
  const bot = {
    inbox,
    send: (msg) => socket.write(JSON.stringify(msg) + '\n'),
    say: (text) => bot.send({ type: 'line', text }),
    // Espera (y consume) el primer mensaje que cumpla la condición.
    next(match, timeout = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error('timeout; recibido: ' + JSON.stringify(inbox)));
        }, timeout);
        function check() {
          const i = inbox.findIndex(match);
          if (i === -1) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(inbox.splice(i, 1)[0]);
        }
        waiters.add(check);
        check();
      });
    },
    close: () => socket.end(),
  };
  return bot;
}

async function login(nick, extra = {}, port = srv.port) {
  const bot = connect(port);
  bot.send({ type: 'hello', nick, ...extra });
  await bot.next((m) => m.type === 'state');
  return bot;
}

test('saludo: bienvenida y sala general', async () => {
  const ana = connect();
  ana.send({ type: 'hello', nick: 'ana' });
  assert.equal((await ana.next((m) => m.type === 'welcome')).nick, 'ana');
  const joined = await ana.next((m) => m.type === 'joined');
  assert.equal(joined.room, 'general');
  assert.deepEqual(joined.users, ['ana']);
  ana.close();
});

test('rechaza nicks inválidos o repetidos (sin distinguir mayúsculas)', async () => {
  const a = await login('beto');
  const b = connect();
  b.send({ type: 'hello', nick: 'BETO' });
  assert.match((await b.next((m) => m.type === 'nick_rejected')).text, /en uso/);
  b.send({ type: 'hello', nick: 'x' });
  assert.match((await b.next((m) => m.type === 'nick_rejected')).text, /inválido/);
  b.send({ type: 'hello', nick: 'beto2' });
  await b.next((m) => m.type === 'welcome');
  a.close();
  b.close();
});

test('mensajes en sala, filtro de secuencias ANSI e historial para quien llega', async () => {
  const a = await login('carla');
  const b = await login('dani');
  a.say('hola \x1b[31mrojo');
  const msg = await b.next((m) => m.type === 'chat');
  assert.equal(msg.from, 'carla');
  assert.equal(msg.text, 'hola [31mrojo');
  const c = connect();
  c.send({ type: 'hello', nick: 'eva' });
  const joined = await c.next((m) => m.type === 'joined');
  assert.ok(joined.history.some((h) => h.text === 'hola [31mrojo'));
  for (const bot of [a, b, c]) bot.close();
});

test('mensajes privados y /r', async () => {
  const a = await login('fede');
  const b = await login('gabi');
  a.say('/msg gabi secreto');
  assert.equal((await b.next((m) => m.type === 'pm')).text, 'secreto');
  b.say('/r recibido');
  assert.equal((await a.next((m) => m.type === 'pm' && m.from === 'gabi')).text, 'recibido');
  a.close();
  b.close();
});

test('salas: /join aísla los mensajes', async () => {
  const a = await login('hugo');
  const b = await login('ines');
  a.say('/join dev');
  assert.equal((await a.next((m) => m.type === 'state')).room, 'dev');
  b.say('solo en general');
  a.say('solo en dev');
  assert.equal((await a.next((m) => m.type === 'chat')).text, 'solo en dev');
  assert.ok(!a.inbox.some((m) => m.type === 'chat' && m.text === 'solo en general'));
  a.close();
  b.close();
});

test('contraseña: la pide, rechaza la incorrecta y acepta la correcta', async () => {
  const a = connect(privateSrv.port);
  a.send({ type: 'hello', nick: 'juan' });
  await a.next((m) => m.type === 'password_required');
  a.send({ type: 'hello', nick: 'juan', password: 'mal' });
  await a.next((m) => m.type === 'fatal');
  const b = await login('juan', { password: 'clave' }, privateSrv.port);
  b.close();
});

test('anfitrión: entra sin contraseña y puede expulsar; los demás no', async () => {
  const host = await login('anfitrion', { adminToken: 'tok' }, privateSrv.port);
  const guest = await login('invitado', { password: 'clave' }, privateSrv.port);
  guest.say('/kick anfitrion');
  assert.match((await guest.next((m) => m.type === 'error')).text, /Solo el anfitrión/);
  host.say('/kick invitado molesto');
  assert.match((await guest.next((m) => m.type === 'fatal')).text, /expulsaron.*molesto/);
  host.close();
});

test('comandos desconocidos devuelven error', async () => {
  const a = await login('kiko');
  a.say('/inventado');
  assert.match((await a.next((m) => m.type === 'error')).text, /desconocido/);
  a.close();
});

test('eventos para el panel: lista de salas y usuarios de la sala', async () => {
  const a = await login('lola');
  const b = await login('mario');
  b.say('/join panel');
  const rooms = await a.next((m) => m.type === 'rooms' && m.rooms.some((r) => r.name === 'panel'));
  assert.equal(rooms.rooms.find((r) => r.name === 'panel').users, 1);
  const roster = await a.next((m) => m.type === 'roster' && !m.users.some((u) => u.nick === 'mario'));
  assert.equal(roster.room, 'general');
  b.close();
  const gone = await a.next((m) => m.type === 'rooms' && !m.rooms.some((r) => r.name === 'panel'));
  assert.ok(gone.rooms.some((r) => r.name === 'general'));
  a.close();
});

test('un cliente TLS contra un servidor sin cifrado recibe un corte inmediato', async () => {
  const socket = net.connect(srv.port, '127.0.0.1');
  socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00]));
  await new Promise((resolve) => socket.on('close', resolve));
});

test('/help, /users, /rooms y /who mandan texto y una vista estructurada', async () => {
  const a = await login('nora');
  for (const [cmd, kind] of [['/help', 'help'], ['/users', 'users'], ['/rooms', 'rooms'], ['/who', 'who']]) {
    a.say(cmd);
    const m = await a.next((x) => x.type === 'system' && x.view && x.view.kind === kind);
    assert.ok(m.text.length > 0, `${cmd} conserva el texto para clientes viejos`);
  }
  a.close();
});
