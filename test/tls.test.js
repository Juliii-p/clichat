'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Configuración aislada: los tests no tocan la del usuario.
process.env.CLI_CHAT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clichat-test-'));

const { startServer } = require('../src/server');
const { connect, readMessages } = require('../src/transport');
const cert = require('../src/cert');
const config = require('../src/config');

let plain;
let secure;
let pair;
before(async () => {
  pair = cert.createSelfSigned();
  plain = await startServer({ port: 0, bind: '127.0.0.1', log: null });
  secure = await startServer({ port: 0, bind: '127.0.0.1', log: null, tls: pair });
});
after(async () => {
  await plain.shutdown();
  await secure.shutdown();
});

const noPrompt = { ask: async () => 'n', notice: () => {} };
const trusting = { ask: async () => 's', notice: () => {} };

function welcome(socket, nick) {
  const messages = readMessages(socket);
  socket.write(JSON.stringify({ type: 'hello', nick }) + '\n');
  return new Promise((resolve) => messages.listen((m) => m.type === 'welcome' && resolve(m)));
}

test('el certificado generado es válido y su huella coincide', () => {
  const x509 = new crypto.X509Certificate(pair.cert);
  assert.ok(x509.verify(x509.publicKey));
  assert.equal(secure.fingerprint, x509.fingerprint256);
  assert.match(cert.shortFingerprint(secure.fingerprint), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
});

test('modo automático contra un servidor sin cifrado: sigue en texto plano', async () => {
  const conn = await connect({ host: '127.0.0.1', port: plain.port, mode: 'auto', ...noPrompt });
  assert.equal(conn.secure, false);
  assert.equal((await welcome(conn.socket, 'plano1')).nick, 'plano1');
  conn.socket.destroy();
});

test('exigir cifrado contra un servidor sin cifrado falla', async () => {
  await assert.rejects(
    connect({ host: '127.0.0.1', port: plain.port, mode: 'tls', ...noPrompt }),
    /no acepta conexiones cifradas/
  );
});

test('cifrado con huella indicada: conecta sin preguntar', async () => {
  const short = cert.shortFingerprint(secure.fingerprint);
  const conn = await connect({ host: '127.0.0.1', port: secure.port, fingerprint: short, ...noPrompt, remember: false });
  assert.equal(conn.secure, true);
  assert.equal((await welcome(conn.socket, 'cifrado1')).nick, 'cifrado1');
  conn.socket.destroy();
});

test('huella equivocada: no conecta', async () => {
  await assert.rejects(
    connect({ host: '127.0.0.1', port: secure.port, fingerprint: 'AAAA-BBBB-CCCC-DDDD', ...noPrompt }),
    /no coincide/
  );
});

test('primera vez: pregunta, y si se rechaza no conecta', async () => {
  await assert.rejects(connect({ host: '127.0.0.1', port: secure.port, ...noPrompt }), /cancelada/);
});

test('confiar una vez la guarda; si la huella cambia, avisa y no conecta', async () => {
  const key = `127.0.0.1:${secure.port}`;
  const conn = await connect({ host: '127.0.0.1', port: secure.port, ...trusting });
  conn.socket.destroy();
  assert.equal(config.knownHost(key), secure.fingerprint);

  // La segunda vez no pregunta (si preguntara, noPrompt diría que no).
  const again = await connect({ host: '127.0.0.1', port: secure.port, ...noPrompt });
  again.socket.destroy();

  config.trustHost(key, 'AA:BB:CC');
  await assert.rejects(connect({ host: '127.0.0.1', port: secure.port, ...trusting }), /CUIDADO/);
  config.forgetHost(key);
});

test('un servidor que antes cifraba no se acepta sin cifrado en modo automático', async () => {
  const key = `127.0.0.1:${plain.port}`;
  config.trustHost(key, secure.fingerprint);
  await assert.rejects(connect({ host: '127.0.0.1', port: plain.port, ...noPrompt }), /antes usaba cifrado/);
  // Pidiéndolo explícitamente, sí.
  const conn = await connect({ host: '127.0.0.1', port: plain.port, mode: 'plain', ...noPrompt });
  conn.socket.destroy();
  config.forgetHost(key);
});

test('servidor caído: error claro, sin reintentar en texto plano', async () => {
  const srv = await startServer({ port: 0, bind: '127.0.0.1', log: null });
  const { port } = srv;
  await srv.shutdown();
  await assert.rejects(connect({ host: '127.0.0.1', port, ...noPrompt }), /nadie escucha/);
});
