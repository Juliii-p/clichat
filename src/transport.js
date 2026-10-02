'use strict';
// Conexión al servidor: TCP con o sin TLS, verificación de huella y lectura de
// mensajes JSON por línea.

const net = require('net');
const tls = require('tls');
const config = require('./config');
const { shortFingerprint, fingerprintMatches } = require('./cert');

const CONNECT_TIMEOUT = 10_000;
// Errores en los que no tiene sentido reintentar sin cifrado: no se llegó al servidor.
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ETIMEDOUT']);

class ConnectError extends Error {}

function explain(err, host, port) {
  const why = {
    ECONNREFUSED: 'nadie escucha en ese puerto',
    ENOTFOUND: 'no existe esa dirección',
    EAI_AGAIN: 'no se pudo resolver el nombre',
    EHOSTUNREACH: 'no se llega a esa IP',
    ENETUNREACH: 'no se llega a esa red',
    ETIMEDOUT: 'el servidor no responde',
  }[err.code];
  return new ConnectError(`No se pudo conectar a ${host}:${port} (${why || err.message}).`);
}

function open(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({
          host,
          port,
          minVersion: 'TLSv1.2',
          // Certificados autofirmados: la confianza la da la huella, no una autoridad.
          rejectUnauthorized: false,
          servername: net.isIP(host) ? undefined : host,
        })
      : net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    }, CONNECT_TIMEOUT);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once('close', () => reject(Object.assign(new Error('conexión cerrada'), { code: 'ECONNRESET' })));
  });
}

// Huella al estilo SSH: se confía la primera vez y se avisa fuerte si cambia.
async function verify(socket, { key, expected, ask, notice, remember }) {
  const fp = socket.getPeerCertificate().fingerprint256;
  const trust = () => remember && config.trustHost(key, fp);

  if (expected) {
    if (!fingerprintMatches(expected, fp)) {
      throw new ConnectError(`La huella de ${key} (${shortFingerprint(fp)}) no coincide con la indicada. No se conectó.`);
    }
    trust();
    return fp;
  }

  const known = config.knownHost(key);
  if (known === fp) return fp;
  if (known) {
    throw new ConnectError(
      [
        `¡CUIDADO! La huella de ${key} cambió.`,
        `  antes: ${shortFingerprint(known)}`,
        `  ahora: ${shortFingerprint(fp)}`,
        'Alguien podría estar interceptando la conexión. Si el anfitrión',
        `regeneró su certificado, ejecuta: clichat forget ${key}`,
      ].join('\n')
    );
  }

  notice(`Primera conexión cifrada con ${key}.\nHuella: ${shortFingerprint(fp)} (compárala con la del anfitrión)`);
  const answer = await ask('¿Confiar en este servidor? (s/n)');
  if (!/^(s|si|sí|y|yes)$/i.test(answer)) throw new ConnectError('Conexión cancelada.');
  trust();
  return fp;
}

/**
 * Conecta según el modo:
 *   auto   intenta TLS y, si el servidor no cifra, sigue sin cifrado (avisando)
 *   tls    exige cifrado
 *   plain  sin cifrado
 * Devuelve { socket, secure, fingerprint }.
 */
async function connect({ host, port, mode = 'auto', fingerprint, ask, notice, remember = true }) {
  const key = `${host}:${port}`;
  if (mode !== 'plain') {
    let socket;
    try {
      socket = await open(host, port, true);
    } catch (err) {
      if (UNREACHABLE.has(err.code)) throw explain(err, host, port);
      if (mode === 'tls') throw new ConnectError(`${key} no acepta conexiones cifradas.`);
      // Si antes era cifrado y ahora no, no se baja a texto plano en silencio.
      if (config.knownHost(key)) {
        throw new ConnectError(
          `${key} antes usaba cifrado y ahora no. Podría ser un intento de\n` +
            'interceptar la conexión. Si el anfitrión lo desactivó, usa --no-tls.'
        );
      }
    }
    if (socket) {
      try {
        const fp = await verify(socket, { key, expected: fingerprint, ask, notice, remember });
        return { socket, secure: true, fingerprint: fp };
      } catch (err) {
        socket.destroy();
        throw err;
      }
    }
  }
  try {
    return { socket: await open(host, port, false), secure: false, fingerprint: null };
  } catch (err) {
    throw explain(err, host, port);
  }
}

// Lector de mensajes JSON por línea. Los mensajes se encolan hasta que alguien escuche.
function readMessages(socket) {
  let buffer = '';
  let handler = null;
  const queue = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // línea inválida: se ignora
      }
      if (handler) handler(msg);
      else queue.push(msg);
    }
  });
  return {
    listen(fn) {
      handler = fn;
      while (handler === fn && queue.length) fn(queue.shift());
    },
    pause() {
      handler = null;
    },
  };
}

module.exports = { connect, readMessages, ConnectError };
