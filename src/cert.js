'use strict';
// Certificado autofirmado para el modo cifrado (TLS), sin depender de openssl.
//
// Node puede generar claves pero no certificados X.509, así que se arma uno mínimo
// en DER a mano: ECDSA P-256, sin extensiones. La confianza no viene de una autoridad
// certificante sino de la huella (como en SSH): el cliente la guarda la primera vez y
// avisa si cambia.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------ DER mínimo

function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const integer = (bytes) => tlv(0x02, bytes);
const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));

function oid(dotted) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (let v of rest) {
    const chunk = [v & 0x7f];
    for (v >>= 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date) {
  const s = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'; // AAAAMMDDhhmmssZ
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(s.slice(2))) : tlv(0x18, Buffer.from(s));
}

const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

// ------------------------------------------------------------ certificado

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const COMMON_NAME = '2.5.4.3';
const DAY = 86_400_000;

function createSelfSigned(commonName = 'clichat') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const algorithm = seq(oid(ECDSA_SHA256));
  const name = seq(set(seq(oid(COMMON_NAME), utf8(commonName))));
  const serial = crypto.randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x40; // positivo y sin ceros a la izquierda (DER)

  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))), // X.509 v3
    integer(serial),
    algorithm,
    name,
    seq(time(new Date(Date.now() - DAY)), time(new Date(Date.now() + 20 * 365 * DAY))),
    name,
    publicKey.export({ type: 'spki', format: 'der' })
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, algorithm, tlv(0x03, Buffer.from([0]), signature));

  return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// Carga el certificado del servidor o lo crea la primera vez. Se guarda para que la
// huella no cambie entre reinicios: si cambiara, los clientes avisarían de un posible ataque.
function loadOrCreate(dir) {
  const certFile = path.join(dir, 'server-cert.pem');
  const keyFile = path.join(dir, 'server-key.pem');
  try {
    return { cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') };
  } catch {
    const pair = createSelfSigned();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(keyFile, pair.key, { mode: 0o600 });
      fs.writeFileSync(certFile, pair.cert);
    } catch {
      /* sin disco: el certificado vale solo para esta ejecución */
    }
    return pair;
  }
}

// ------------------------------------------------------------ huellas

const fingerprint = (certPem) => new crypto.X509Certificate(certPem).fingerprint256;

// Versión corta para comparar en voz alta o de un vistazo: 64 bits, "3F9A-12BC-77D0-E4A1".
const shortFingerprint = (fp) => fp.replace(/:/g, '').slice(0, 16).match(/.{4}/g).join('-');

const normalizeFingerprint = (fp) => String(fp || '').replace(/[^0-9a-f]/gi, '').toUpperCase();

// ¿`given` (corta o completa) corresponde a `actual`?
function fingerprintMatches(given, actual) {
  const g = normalizeFingerprint(given);
  return g.length >= 16 && normalizeFingerprint(actual).startsWith(g);
}

module.exports = { createSelfSigned, loadOrCreate, fingerprint, shortFingerprint, fingerprintMatches };
