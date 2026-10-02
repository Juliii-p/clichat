'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wrap, fit } = require('../src/term/tui');
const { stringWidth } = require('../src/term/width');

const text = (row) => row.map((c) => c.ch).join('');
const plain = (s, indent = 0) => ({ spans: [['', s]], indent });

test('ancho de caracteres: acentos, emojis y CJK', () => {
  assert.equal(stringWidth('ñandú'), 5);
  assert.equal(stringWidth('👍'), 2);
  assert.equal(stringWidth('日本'), 4);
  assert.equal(stringWidth('é'), 1);
});

test('emojis compuestos ocupan 2 columnas, como los dibuja la terminal', () => {
  for (const emoji of ['❤️', '⚠️', '👩‍💻', '👨‍👩‍👧', '👍🏽', '🇦🇷', '🏳️‍🌈']) {
    assert.equal(stringWidth(emoji), 2, emoji);
  }
});

test('corta en espacios y respeta la sangría', () => {
  const rows = wrap(plain('12:00 <ana> uno dos tres cuatro cinco seis', 6), 20);
  assert.deepEqual(rows.map(text), ['12:00 <ana> uno dos', '      tres cuatro', '      cinco seis']);
  for (const r of rows) assert.ok(r.reduce((n, c) => n + c.w, 0) <= 20);
});

test('una palabra más larga que la línea se parte igual', () => {
  const rows = wrap(plain('x'.repeat(25)), 10);
  assert.deepEqual(rows.map(text), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
});

test('los emojis no se parten ni desbordan la línea', () => {
  const rows = wrap(plain('👍'.repeat(7)), 5);
  for (const r of rows) assert.ok(r.reduce((n, c) => n + c.w, 0) <= 5);
  assert.equal(rows.map(text).join(''), '👍'.repeat(7));
});

test('una línea vacía ocupa una fila', () => {
  assert.equal(wrap(plain(''), 10).length, 1);
});

test('fit recorta con puntos suspensivos', () => {
  const cells = Array.from('panel lateral').map((ch) => ({ ch, code: '', w: 1 }));
  assert.equal(text(fit(cells, 6)), 'panel…');
  assert.equal(text(fit(cells, 40)), 'panel lateral');
});

test('las vistas de comandos entran en la pantalla de un teléfono', () => {
  const { formatMessage, toAnsi } = require('../src/term/format');
  const views = [
    { kind: 'users', users: [{ nick: 'nombre_bien_largo_20', admin: true, room: 'una-sala-de-nombre-x' }] },
    { kind: 'rooms', rooms: [{ name: 'general', users: 12, topic: 'Sala principal' }], current: 'general' },
    { kind: 'who', room: 'general', users: [{ nick: 'ana', admin: false }] },
  ];
  for (const view of views) {
    for (const l of formatMessage({ type: 'system', text: 'x', view }, 'ana')) {
      const width = stringWidth(toAnsi(l.spans).replace(/\x1b\[[0-9;]*m/g, ''));
      assert.ok(width <= 44, `${view.kind}: ${width} columnas`);
    }
  }
  // Una vista desconocida (de un servidor más nuevo) cae al texto.
  const fallback = formatMessage({ type: 'system', text: 'hola', view: { kind: 'futuro' } }, 'ana');
  assert.match(toAnsi(fallback[0].spans), /hola/);
});
