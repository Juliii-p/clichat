'use strict';
// Comandos del chat para autocompletar. El servidor manda su lista en la bienvenida
// (`welcome.commands`); esta es la de respaldo para servidores que no la mandan.

const DEFAULT_COMMANDS = [
  ['/msg', '<nick> <txt>', 'mensaje privado'],
  ['/r', '<texto>', 'responder privado'],
  ['/me', '<acción>', 'acción (* nick ...)'],
  ['/join', '<sala>', 'entrar o crear sala'],
  ['/rooms', '', 'ver salas'],
  ['/who', '[sala]', 'quién está'],
  ['/topic', '[texto]', 'ver o cambiar tema'],
  ['/users', '', 'todos los conectados'],
  ['/nick', '<nuevo>', 'cambiar de nick'],
  ['/clear', '', 'limpiar'],
  ['/panel', '', 'panel lateral (TUI)'],
  ['/quit', '[mensaje]', 'salir'],
  ['/help', '', 'ver comandos'],
].map(([cmd, args, desc]) => ({ cmd, args, desc }));

// Qué se completa en el primer argumento de cada comando.
const ARG_KIND = { '/msg': 'nick', '/m': 'nick', '/pm': 'nick', '/kick': 'nick', '/join': 'room', '/j': 'room', '/who': 'room' };

/** Normaliza la lista que manda el servidor; si no hay, la de respaldo. */
function commandList(fromServer) {
  if (!Array.isArray(fromServer) || !fromServer.length) return DEFAULT_COMMANDS;
  const list = fromServer
    .filter((c) => c && typeof c.cmd === 'string' && c.cmd.startsWith('/') && !c.cmd.startsWith('//'))
    .map((c) => ({ cmd: c.cmd, args: String(c.args || ''), desc: String(c.desc || '') }));
  if (!list.some((c) => c.cmd === '/help')) list.push({ cmd: '/help', args: '', desc: 'ver comandos' });
  return list;
}

/**
 * Sugerencias para lo escrito hasta el cursor.
 * Devuelve { kind: 'command' | 'nick' | 'room', start, items: [{ value, label, detail, desc }] } o null.
 */
function suggest(before, { commands, nicks = [], rooms = [] }) {
  if (/^\/\S*$/.test(before)) {
    const prefix = before.toLowerCase();
    const items = commands
      .filter((c) => c.cmd.startsWith(prefix))
      .map((c) => ({ value: c.cmd, label: c.cmd, detail: c.args, desc: c.desc }));
    return items.length ? { kind: 'command', start: 0, items } : null;
  }
  const m = before.match(/^(\/\S+)(\s+)(\S*)$/);
  if (!m) return null;
  const kind = ARG_KIND[m[1].toLowerCase()];
  if (!kind) return null;
  const start = m[1].length + m[2].length;
  const prefix = m[3].replace(/^#/, '').toLowerCase();
  const pool =
    kind === 'nick'
      ? nicks.map((n) => ({ value: n.nick, label: n.nick, detail: n.admin ? '★' : '', desc: '' }))
      : rooms.map((r) => ({ value: r.name, label: '#' + r.name, detail: String(r.users), desc: r.topic || '' }));
  const items = pool.filter((i) => i.value.toLowerCase().startsWith(prefix));
  if (!items.length || (items.length === 1 && items[0].value.toLowerCase() === prefix)) return null;
  return { kind, start, items };
}

/** Argumentos que faltan escribir, para mostrarlos en gris ("<nick> <txt>"). */
function argumentHint(text, commands) {
  const m = text.match(/^(\/\S+)\s(.*)$/);
  if (!m) return '';
  const command = commands.find((c) => c.cmd === m[1].toLowerCase());
  if (!command || !command.args) return '';
  const expected = command.args.split(' ');
  const typed = m[2].split(/\s+/);
  const done = m[2] === '' ? 0 : m[2].endsWith(' ') ? typed.length - 1 : typed.length;
  return expected.slice(done).join(' ');
}

module.exports = { DEFAULT_COMMANDS, ARG_KIND, commandList, suggest, argumentHint };
