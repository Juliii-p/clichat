'use strict';
// Interfaz simple, línea a línea: funciona en cualquier terminal y también con la
// entrada o la salida redirigidas. Es la alternativa a la TUI (`--simple`).

const readline = require('readline');
const { c, nickSgr, sgr } = require('./colors');
const { formatMessage, isPing, toAnsi } = require('./format');
const { stringWidth } = require('./width');
const { commandList, suggest } = require('./commands');

const visible = (s) => stringWidth(s.replace(/\x1b\[[0-9;]*m/g, ''));

function createLineUi(session) {
  const out = process.stdout;
  let nick = session.nick;
  let room = '';
  let ready = false;
  let commands = commandList(null);
  let users = [];
  let rooms = [];

  // Tab: comandos, nicks como argumento de /msg o /kick, salas para /join o /who,
  // y nicks en medio del texto.
  function completer(line) {
    const found = suggest(line, { commands, nicks: users.filter((u) => u.nick !== nick), rooms });
    if (found) {
      const typed = line.slice(found.start);
      const hash = found.kind === 'room' && typed.startsWith('#') ? '#' : '';
      return [found.items.map((i) => hash + i.value + (found.kind === 'command' ? '' : ' ')), typed];
    }
    const word = line.match(/(\S*)$/)[1];
    if (!word) return [[], line];
    const hits = users.map((u) => u.nick).filter((n) => n !== nick && n.toLowerCase().startsWith(word.toLowerCase()));
    return [hits, word];
  }

  const rl = readline.createInterface({ input: process.stdin, output: out, historySize: 200, completer });

  function updatePrompt() {
    const lock = (session.e2e ? c.green('e2e ') : '') + (session.secure ? c.green('*') : '');
    rl.setPrompt(`${c.gray('[')}${lock}${c.cyan('#' + room)}${c.gray(']')} ${sgr(nickSgr(nick), nick)}${c.gray('>')} `);
  }

  // Imprime encima de la línea de entrada sin perder lo que se está escribiendo.
  function print(text) {
    if (ready && out.isTTY) {
      readline.moveCursor(out, 0, -rl.getCursorPos().rows);
      readline.cursorTo(out, 0);
      readline.clearScreenDown(out);
    }
    out.write(text + '\n');
    if (ready) {
      rl.prevRows = 0; // la línea de entrada se redibuja desde cero, debajo del mensaje
      rl.prompt(true);
    }
  }

  rl.on('line', (input) => {
    if (!ready) return;
    // Borra la línea recién escrita: el servidor la devuelve ya formateada.
    if (out.isTTY) {
      const rows = Math.ceil((visible(rl.getPrompt()) + stringWidth(input)) / (out.columns || 80)) || 1;
      readline.moveCursor(out, 0, -rows);
      readline.cursorTo(out, 0);
      readline.clearScreenDown(out);
    }
    const text = input.trim();
    if (text === '/clear') console.clear();
    else if (/^\/(quit|exit)\b/i.test(text)) session.quit(text);
    else if (text) session.send(text);
    rl.prompt();
  });
  rl.on('SIGINT', () => session.quit());
  rl.on('close', () => session.quit()); // fin de la entrada (Ctrl+D / Ctrl+Z)

  return {
    kind: 'line',
    onMessage(m) {
      if (m.type === 'welcome') commands = commandList(m.commands);
      if (m.type === 'rooms') rooms = m.rooms;
      if (m.type === 'roster' && m.room === room) users = m.users;
      if (m.type === 'joined') users = m.users.map((n) => ({ nick: n, admin: false }));
      if (m.type === 'state') {
        nick = m.nick;
        room = m.room;
        updatePrompt();
        ready = true;
        return rl.prompt(true);
      }
      const lines = formatMessage(m, nick);
      if (!lines.length) return;
      const bell = isPing(m, nick) && out.isTTY ? '\x07' : '';
      print(lines.map((l) => toAnsi(l.spans)).join('\n') + bell);
    },
    destroy() {
      ready = false;
      rl.removeAllListeners('close');
      rl.close();
    },
  };
}

module.exports = { createLineUi };
