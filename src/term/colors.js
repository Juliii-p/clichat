'use strict';
// Colores ANSI y saneado de texto recibido de la red.

const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const sgr = (code, s) => (enabled && code ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const paint = (code) => (s) => sgr(code, s);

const c = {
  bold: paint('1'),
  red: paint('91'),
  green: paint('92'),
  yellow: paint('93'),
  magenta: paint('95'),
  cyan: paint('96'),
  gray: paint('90'),
};

const NICK_COLORS = ['32', '33', '35', '36', '91', '92', '93', '94', '95', '96'];
function nickSgr(name) {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NICK_COLORS[h % NICK_COLORS.length];
}

// Nunca se imprimen caracteres de control recibidos de la red (salvo saltos de línea).
const safe = (s) => String(s ?? '').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');

module.exports = { enabled, sgr, c, nickSgr, safe };
