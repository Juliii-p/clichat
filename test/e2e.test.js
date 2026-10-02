'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { deriveKey, keyCode, encrypt, decrypt, createE2E, isEncrypted } = require('../src/e2e');
const { startServer } = require('../src/server');

const key = deriveKey('una frase larga de prueba');
const otherKey = deriveKey('otra frase distinta');

test('misma frase, misma clave y mismo código de verificación', () => {
  assert.deepEqual(deriveKey('una frase larga de prueba'), key);
  assert.equal(keyCode(key), keyCode(deriveKey('una frase larga de prueba')));
  assert.notEqual(keyCode(key), keyCode(otherKey));
  assert.match(keyCode(key), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
});

test('ida y vuelta, con texto que nunca aparece en claro', () => {
  const sealed = encrypt(key, 'chat', 'ana', 'nos vemos a las 15 ñandú 🧉');
  assert.ok(isEncrypted(sealed));
  const bytes = Buffer.from(sealed.slice(5), 'base64');
  assert.ok(!bytes.includes(Buffer.from('nos vemos')), 'el texto no aparece en los bytes cifrados');
  assert.equal(decrypt(key, 'chat', 'ana', sealed).text, 'nos vemos a las 15 ñandú 🧉');
});

test('cada mensaje se cifra distinto aunque el texto sea igual', () => {
  assert.notEqual(encrypt(key, 'chat', 'ana', 'hola'), encrypt(key, 'chat', 'ana', 'hola'));
});

test('otra clave, otro autor, otro tipo o un byte alterado: no se abre', () => {
  const sealed = encrypt(key, 'chat', 'ana', 'secreto');
  assert.equal(decrypt(otherKey, 'chat', 'ana', sealed), null);
  assert.equal(decrypt(key, 'chat', 'beto', sealed), null, 'el servidor no puede cambiar el autor');
  assert.equal(decrypt(key, 'pm', 'ana', sealed), null, 'ni convertirlo en privado');
  const raw = Buffer.from(sealed.slice(5), 'base64');
  raw[20] ^= 1;
  assert.equal(decrypt(key, 'chat', 'ana', 'e2e1:' + raw.toString('base64')), null);
});

test('qué se cifra al enviar: mensajes, /me, /msg y /r; los comandos no', () => {
  const e2e = createE2E(key);
  assert.ok(isEncrypted(e2e.outgoing('hola', 'ana')));
  assert.ok(isEncrypted(e2e.outgoing('//literal', 'ana')));
  assert.match(e2e.outgoing('/me saluda', 'ana'), /^\/me e2e1:/);
  assert.match(e2e.outgoing('/msg beto hola', 'ana'), /^\/msg beto e2e1:/);
  assert.match(e2e.outgoing('/r dale', 'ana'), /^\/r e2e1:/);
  assert.equal(e2e.outgoing('/join dev', 'ana'), '/join dev');
  assert.throws(() => e2e.outgoing('x'.repeat(1001), 'ana'), /demasiado largo/);
});

test('al recibir: descifra, marca lo que llegó sin cifrar y lo que no se puede abrir', () => {
  const mine = createE2E(key);
  const sealed = encrypt(key, 'chat', 'ana', 'hola');
  assert.equal(mine.incoming({ type: 'chat', from: 'ana', text: sealed }).text, 'hola');
  assert.equal(mine.incoming({ type: 'chat', from: 'ana', text: 'en claro' }).plain, true);
  assert.equal(createE2E(otherKey).incoming({ type: 'chat', from: 'ana', text: sealed }).sealed, true);
  assert.match(createE2E(null).incoming({ type: 'chat', from: 'ana', text: sealed }).text, /no tienes la clave/);
});

// ------------------------------------------------------------ con un servidor real

let srv;
let logFile;
before(async () => {
  logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clichat-log-')), 'chat.log');
  srv = await startServer({ port: 0, bind: '127.0.0.1', log: null, logFile });
});
after(() => srv.shutdown());

function bot(nick) {
  const socket = net.connect(srv.port, '127.0.0.1');
  const inbox = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      inbox.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  socket.write(JSON.stringify({ type: 'hello', nick }) + '\n');
  const say = (text) => socket.write(JSON.stringify({ type: 'line', text }) + '\n');
  const wait = (match) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        const m = inbox.find(match);
        if (m) return resolve(m);
        if (Date.now() - t0 > 2000) return reject(new Error('timeout: ' + JSON.stringify(inbox)));
        setTimeout(poll, 10);
      })();
    });
  return { socket, inbox, say, wait };
}

test('el servidor y su registro solo ven texto cifrado; quien tiene la clave lo lee', async () => {
  const ana = bot('ana_e2e');
  const beto = bot('beto_e2e');
  const intruso = bot('intruso');
  await Promise.all([ana, beto, intruso].map((b) => b.wait((m) => m.type === 'state')));

  const e2eAna = createE2E(key);
  ana.say(e2eAna.outgoing('la reunión es en el galpón', 'ana_e2e'));
  ana.say(e2eAna.outgoing('/msg beto_e2e solo para vos', 'ana_e2e'));

  const chat = await beto.wait((m) => m.type === 'chat');
  const pm = await beto.wait((m) => m.type === 'pm');
  assert.ok(isEncrypted(chat.text) && isEncrypted(pm.text), 'por el servidor pasa cifrado');
  assert.equal(createE2E(key).incoming(chat).text, 'la reunión es en el galpón');
  assert.equal(createE2E(key).incoming(pm).text, 'solo para vos');

  const seen = await intruso.wait((m) => m.type === 'chat');
  assert.equal(createE2E(otherKey).incoming(seen).sealed, true);

  for (const b of [ana, beto, intruso]) b.socket.end();
  await new Promise((r) => setTimeout(r, 100));
  const transcript = fs.readFileSync(logFile, 'utf8');
  assert.match(transcript, /<ana_e2e> e2e1:/);
  assert.ok(!transcript.includes('galpón'), 'el registro no tiene el texto en claro');
  assert.ok(!transcript.includes('solo para vos'), 'los privados no se registran');
});

test('con registro activo, se avisa a quien entra', async () => {
  const eva = bot('eva_log');
  const welcome = await eva.wait((m) => m.type === 'welcome');
  assert.equal(welcome.logged, true);
  assert.match(welcome.motd, /se registra/);
  eva.say('hola registro');
  await new Promise((r) => setTimeout(r, 100));
  assert.match(fs.readFileSync(logFile, 'utf8'), /#general <eva_log> hola registro/);
  eva.socket.end();
});
