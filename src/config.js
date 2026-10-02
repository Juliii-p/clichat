'use strict';
// Preferencias locales: último nick, servidores recientes y huellas de servidores
// cifrados conocidos. Nunca se guardan contraseñas.

const fs = require('fs');
const os = require('os');
const path = require('path');

function configDir() {
  if (process.env.CLI_CHAT_CONFIG_DIR) return process.env.CLI_CHAT_CONFIG_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'clichat');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'clichat');
}

const configFile = () => path.join(configDir(), 'config.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function save(cfg) {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2) + '\n');
  } catch {
    /* sin permisos de escritura: se sigue sin recordar nada */
  }
}

function update(fn) {
  const cfg = load();
  fn(cfg);
  save(cfg);
}

function remember({ nick, server }) {
  update((cfg) => {
    if (nick) cfg.nick = nick;
    if (server) cfg.servers = [server, ...(cfg.servers || []).filter((s) => s !== server)].slice(0, 5);
  });
}

const knownHost = (key) => (load().knownHosts || {})[key] || null;

function trustHost(key, fingerprint) {
  update((cfg) => {
    cfg.knownHosts = { ...cfg.knownHosts, [key]: fingerprint };
  });
}

// Devuelve cuántas huellas borró (acepta "host" o "host:puerto").
function forgetHost(target) {
  let removed = 0;
  update((cfg) => {
    for (const key of Object.keys(cfg.knownHosts || {})) {
      if (key === target || key.replace(/:\d+$/, '') === target) {
        delete cfg.knownHosts[key];
        removed++;
      }
    }
  });
  return removed;
}

module.exports = { configDir, configFile, load, remember, knownHost, trustHost, forgetHost };
