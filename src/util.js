'use strict';

const os = require('os');
const { version: VERSION } = require('../package.json');

const DEFAULT_PORT = 5555;
const NICK_RE = /^[A-Za-z0-9_-]{2,20}$/;
const NICK_HELP = 'Nick inválido: 2 a 20 caracteres (letras, números, _ o -).';

// Parser de argumentos mínimo: --clave valor, --clave=valor, -x valor y posicionales.
function parseArgs(argv, { alias = {}, boolean = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--?([a-zA-Z][\w-]*)(?:=(.*))?$/);
    if (!m) {
      out._.push(argv[i]);
      continue;
    }
    const key = alias[m[1]] || m[1];
    if (boolean.includes(key)) out[key] = true;
    else out[key] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}

// "host", "host:puerto" o "[ipv6]:puerto".
function parseAddress(text, fallbackPort = DEFAULT_PORT) {
  const s = String(text || '').trim();
  const m = s.match(/^\[(.+)\](?::(\d+))?$/) || s.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return { host: s, port: fallbackPort };
  return { host: m[1], port: m[2] ? Number(m[2]) : fallbackPort };
}

// IPs de esta máquina a las que otros pueden conectarse.
function localAddresses() {
  try {
    return Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal)
      .map((i) => i.address)
      .filter((ip) => !ip.startsWith('169.254.'));
  } catch {
    return []; // Android (Termux) puede negar el acceso a las interfaces de red
  }
}

module.exports = { VERSION, DEFAULT_PORT, NICK_RE, NICK_HELP, parseArgs, parseAddress, localAddresses };
