'use strict';
// Convierte mensajes del protocolo en líneas con estilo, compartidas por la interfaz
// simple y la TUI. Una línea es una lista de tramos [códigoSGR, texto].

const { sgr, nickSgr, safe } = require('./colors');
const { stringWidth } = require('./width');

const GRAY = '90';
const RED = '91';
const YELLOW = '93';
const MAGENTA = '95';
const CYAN = '96';
const HIGHLIGHT = '30;103';

const pad = (n) => String(n).padStart(2, '0');
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mentions(text, nick) {
  return Boolean(nick) && new RegExp(`(^|[^\w-])${nick}($|[^\w-])`, 'i').test(text);
}

// indent: sangría de las líneas que siguen al cortar un mensaje largo.
const line = (spans, indent = 0) => ({ spans, indent });
const system = (text) => safe(text).split('\n').map((l) => line([[GRAY, '-- ' + l]], 3));

function chatLine(m, me) {
  const from = safe(m.from);
  const text = safe(m.text);
  const at = [GRAY, clock(m.ts) + ' '];
  // Con cifrado de extremo a extremo: avisar lo que no se pudo abrir o llegó sin cifrar.
  if (m.sealed) return line([at, [nickSgr(from), `<${from}>`], [RED, ' ' + text]], 6);
  if (m.plain) at[1] += '[sin cifrar] ';
  switch (m.type) {
    case 'chat': {
      const mine = from === me;
      const body = !mine && mentions(text, me) ? HIGHLIGHT : '';
      return line([at, [nickSgr(from) + (mine ? ';1' : ''), `<${from}>`], ['', ' '], [body, text]], 6);
    }
    case 'action':
      return line([at, [MAGENTA, `* ${from} ${text}`]], 6);
    case 'pm': {
      const label = from === me ? `[privado] tú → ${safe(m.to)}:` : `[privado] ${from} → tú:`;
      return line([at, [MAGENTA, label], ['', ' ' + text]], 6);
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------ vistas de comandos
// Respuestas de /help, /users, /rooms y /who con la estética de la pantalla de
// inicio. Todo pensado para entrar en ~40 columnas (teléfonos).

const AMBER = '38;5;214';
const TITLE = '1;97';
const VIEW_WIDTH = 38;

const rule = (title) => {
  const head = `━━━ ${title} `;
  return line([[AMBER, head + '━'.repeat(Math.max(3, VIEW_WIDTH - stringWidth(head)))]]);
};
const dots = (used) => ' ' + '·'.repeat(Math.max(2, VIEW_WIDTH - used - 2)) + ' ';

// Una persona por fila; si nick y sala no entran juntos, la sala baja a la fila siguiente.
function personRows(u, me, right) {
  const nick = safe(u.nick);
  const mark = u.admin ? '★ ' : '  ';
  const spans = [[YELLOW, ' ' + mark], [nickSgr(nick) + (nick === me ? ';1' : ''), nick]];
  if (!right) return [line(spans, 3)];
  const used = 3 + stringWidth(nick) + stringWidth(right);
  if (used + 4 <= VIEW_WIDTH) return [line([...spans, [GRAY, dots(used)], [CYAN, right]], 3)];
  return [line(spans, 3), line([[CYAN, '     ' + right]], 5)];
}

function formatView(view, me) {
  switch (view.kind) {
    case 'help': {
      const width = Math.max(...view.sections.flatMap((s) => s.items.map(([cmd]) => stringWidth(cmd))));
      const lines = [rule('COMANDOS')];
      for (const section of view.sections) {
        lines.push(line([[TITLE, ' ' + safe(section.title)]]));
        for (const [cmd, desc] of section.items) {
          lines.push(line([[AMBER, '  ' + safe(cmd).padEnd(width)], [GRAY, ' ' + safe(desc)]], width + 3));
        }
      }
      return lines;
    }
    case 'users':
      return [rule(`CONECTADOS (${view.users.length})`), ...view.users.flatMap((u) => personRows(u, me, '#' + safe(u.room)))];
    case 'who':
      return [rule(`EN #${safe(view.room)} (${view.users.length})`), ...view.users.flatMap((u) => personRows(u, me))];
    case 'rooms': {
      const lines = [rule('SALAS')];
      for (const r of view.rooms) {
        const name = '#' + safe(r.name);
        const count = String(r.users);
        const current = r.name === view.current;
        lines.push(
          line([[current ? '1;' + CYAN : CYAN, (current ? ' ▶ ' : '   ') + name], [GRAY, dots(3 + stringWidth(name) + count.length)], [TITLE, count]], 5)
        );
        if (r.topic) lines.push(line([[GRAY, '     ' + safe(r.topic)]], 5));
      }
      return lines;
    }
    default:
      return null; // vista desconocida: se usa el texto
  }
}

/** Líneas a mostrar para un mensaje del servidor (vacío si no se muestra). */
function formatMessage(m, me) {
  switch (m.type) {
    case 'chat':
    case 'action':
    case 'pm':
      return [chatLine(m, me)];
    case 'welcome':
      return [
        line([['1;' + CYAN, `== ${safe(m.server)} ${safe(m.version)} ==`]]),
        ...system(`${m.motd}\nUsuarios conectados: ${m.online}`),
      ];
    case 'joined': {
      const lines = system(
        `Estás en #${safe(m.room)}${m.topic ? ' — ' + safe(m.topic) : ''}\nEn la sala: ${m.users.map(safe).join(', ')}`
      );
      if (m.history.length) {
        lines.push(line([[GRAY, `---- últimos ${m.history.length} mensajes ----`]]));
        for (const h of m.history) lines.push(chatLine(h, me));
        lines.push(line([[GRAY, '-'.repeat(20)]]));
      }
      return lines;
    }
    case 'system':
      return m.view ? formatView(m.view, me) || system(m.text) : system(m.text);
    case 'announce':
      return [line([[GRAY, clock(m.ts) + ' '], ['1;' + YELLOW, '[ANUNCIO]'], [YELLOW, ' ' + safe(m.text)]], 6)];
    case 'error':
      return [line([[RED, '!! ' + safe(m.text)]], 3)];
    case 'fatal':
      return [line([['1;' + RED, '!! ' + safe(m.text)]], 3)];
    default:
      return [];
  }
}

/** ¿El mensaje merece llamar la atención (campana)? */
function isPing(m, me) {
  if (m.from === me) return false;
  return m.type === 'pm' || (m.type === 'chat' && mentions(safe(m.text), me));
}

const toAnsi = (spans) => spans.map(([code, text]) => sgr(code, text)).join('');

module.exports = { formatMessage, isPing, toAnsi, system, line, GRAY, RED, YELLOW, CYAN };
