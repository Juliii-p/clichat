'use strict';
// Cifrado de extremo a extremo con clave compartida.
//
// Cada participante deriva la misma clave de una frase acordada de antemano. Los
// mensajes se cifran en el equipo de quien escribe y se descifran en el de quien lee:
// el servidor solo reenvía texto ilegible. TLS protege el viaje por la red; esto
// protege el contenido incluso frente a quien levanta el servidor.
//
// Qué queda visible para el servidor: nicks, salas, horarios y tamaño de los mensajes.
// Limitación propia de una clave compartida: cualquiera que la tenga puede escribir
// haciéndose pasar por otro participante que también la tiene.

const crypto = require('crypto');

const MARK = 'e2e1:';
const SALT = 'clichat-e2e-v1';
const NONCE = 12;
const TAG = 16;
const MAX_PLAINTEXT = 1000;

/** Deriva la clave de 256 bits. scrypt la hace lenta de adivinar por fuerza bruta. */
function deriveKey(passphrase) {
  return crypto.scryptSync(String(passphrase).normalize('NFC'), SALT, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

/** Código corto para comprobar en voz alta que todos usan la misma clave. */
function keyCode(key) {
  const hex = crypto.createHmac('sha256', key).update('clichat-verificacion').digest('hex').toUpperCase();
  return hex.slice(0, 16).match(/.{4}/g).join('-');
}

// El tipo y el autor se atan al texto cifrado: el servidor no puede cambiar quién
// escribió un mensaje ni convertir un privado en uno público sin que se note.
const aad = (kind, from) => Buffer.from(`clichat|${kind}|${String(from).toLowerCase()}`);

function encrypt(key, kind, from, text) {
  const nonce = crypto.randomBytes(NONCE);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(kind, from));
  const body = Buffer.concat([cipher.update(JSON.stringify({ t: text, ts: Date.now() }), 'utf8'), cipher.final()]);
  return MARK + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
}

function decrypt(key, kind, from, data) {
  try {
    const raw = Buffer.from(data.slice(MARK.length), 'base64');
    if (raw.length < NONCE + TAG + 1) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, NONCE));
    decipher.setAAD(aad(kind, from));
    decipher.setAuthTag(raw.subarray(raw.length - TAG));
    const plain = Buffer.concat([decipher.update(raw.subarray(NONCE, raw.length - TAG)), decipher.final()]);
    const { t, ts } = JSON.parse(plain.toString('utf8'));
    return typeof t === 'string' ? { text: t, ts } : null;
  } catch {
    return null; // otra clave, mensaje alterado o basura
  }
}

const isEncrypted = (text) => typeof text === 'string' && text.startsWith(MARK);
const KIND = { chat: 'chat', action: 'me', pm: 'pm' };

/**
 * Capa de cifrado del cliente. Con key = null no cifra lo que sale, pero igual marca
 * los mensajes cifrados que llegan, para no mostrar texto ilegible.
 */
function createE2E(key) {
  return {
    enabled: Boolean(key),
    code: key ? keyCode(key) : null,

    /** Línea que escribió el usuario → línea a enviar. Lanza un error si es muy larga. */
    outgoing(line, me) {
      if (!key) return line;
      const seal = (kind, text) => {
        if (text.length > MAX_PLAINTEXT) throw new Error(`Mensaje demasiado largo (máximo ${MAX_PLAINTEXT} caracteres).`);
        return encrypt(key, kind, me, text);
      };
      let m;
      if (line.startsWith('//')) return seal('chat', line.slice(1));
      if (!line.startsWith('/')) return seal('chat', line);
      if ((m = line.match(/^\/me\s+(.+)$/i))) return `/me ${seal('me', m[1])}`;
      if ((m = line.match(/^\/(msg|m|pm)\s+(\S+)\s+(.+)$/i))) return `/${m[1]} ${m[2]} ${seal('pm', m[3])}`;
      if ((m = line.match(/^\/r\s+(.+)$/i))) return `/r ${seal('pm', m[1])}`;
      return line; // /join, /nick, /topic, etc. viajan sin cifrar
    },

    /** Mensaje del servidor → mensaje para mostrar. */
    incoming(msg) {
      if (msg.type === 'joined') return { ...msg, history: msg.history.map((h) => this.incoming(h)) };
      const kind = KIND[msg.type];
      if (!kind) return msg;
      if (!isEncrypted(msg.text)) return key ? { ...msg, plain: true } : msg;
      if (!key) return { ...msg, text: '[cifrado de extremo a extremo: no tienes la clave]', sealed: true };
      const opened = decrypt(key, kind, msg.from, msg.text);
      if (!opened) return { ...msg, text: '[no se pudo descifrar: otra clave o mensaje alterado]', sealed: true };
      return { ...msg, text: opened.text };
    },
  };
}

module.exports = { deriveKey, keyCode, encrypt, decrypt, isEncrypted, createE2E, MAX_PLAINTEXT };
