'use strict';
// Ancho en columnas de terminal. Aproximación de wcwidth suficiente para un chat:
// marcas combinantes y selectores de variante ocupan 0, CJK y emojis ocupan 2.

const ZERO = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x20d0, 0x20ff], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f], [0xfeff, 0xfeff], [0x1f3fb, 0x1f3ff], [0xe0000, 0xe0fff],
];
const WIDE = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

function inRanges(cp, ranges) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  if (cp === 0x200d || inRanges(cp, ZERO)) return 0; // 0x200d: unión de emojis
  return inRanges(cp, WIDE) ? 2 : 1;
}

// Un emoji compuesto (👩‍💻, 🇦🇷, 👍🏽, ❤️) son varios caracteres que la terminal dibuja
// como un solo símbolo de 2 columnas. Por eso se mide por grafema y no por carácter.
const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const COMPOUND = /[‍️\u{1F3FB}-\u{1F3FF}]/u; // unión, presentación emoji, tono de piel
const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;

function clusterWidth(cluster) {
  const chars = Array.from(cluster);
  if (chars.length > 1 && (COMPOUND.test(cluster) || FLAG.test(cluster))) return 2;
  return chars.reduce((n, ch) => n + charWidth(ch), 0);
}

/** Grafemas con su ancho: [{ ch, w }]. */
function graphemes(text) {
  if (!segmenter) return Array.from(text, (ch) => ({ ch, w: charWidth(ch) }));
  return Array.from(segmenter.segment(text), ({ segment }) => ({ ch: segment, w: clusterWidth(segment) }));
}

const stringWidth = (s) => graphemes(s).reduce((n, g) => n + g.w, 0);

module.exports = { charWidth, clusterWidth, graphemes, stringWidth };
