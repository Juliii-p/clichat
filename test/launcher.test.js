'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { securityLevel, validate, formFor, valuesOf } = require('../src/term/launcher');

const plain = (lines) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));

test('niveles de seguridad: de ABIERTO a ALTO SECRETO', () => {
  assert.match(plain(securityLevel('host', { tls: false, e2e: false }))[0], /NIVEL 0 \/\/ ABIERTO/);
  assert.match(plain(securityLevel('host', { tls: true, e2e: false }))[0], /NIVEL 1 \/\/ RESTRINGIDO/);
  assert.match(plain(securityLevel('join', { tls: 'plain', e2e: true }))[0], /NIVEL 2 \/\/ CLASIFICADO/);
  assert.match(plain(securityLevel('join', { tls: 'tls', e2e: true }))[0], /NIVEL 3 \/\/ ALTO SECRETO/);
});

test('el panel nunca promete anonimato', () => {
  for (const v of [{ tls: true, e2e: true }, { tls: false, e2e: false }]) {
    assert.ok(plain(securityLevel('host', v)).some((l) => /ANONIMATO/.test(l)));
  }
});

test('en pantallas angostas las aclaraciones se cortan sin desbordar', () => {
  for (const l of plain(securityLevel('join', { tls: 'auto', e2e: false }, 30))) {
    assert.ok(l.length <= 30, `"${l}" mide ${l.length}`);
  }
});

test('validaciones del formulario', () => {
  assert.match(validate('join', { target: ' ', nick: 'juli' }), /IP DEL SERVIDOR/);
  assert.match(validate('host', { nick: 'x', port: '5555' }), /NICK/);
  assert.match(validate('server', { port: '99999' }), /PUERTO/);
  assert.match(validate('host', { nick: 'juli', port: '5555', e2e: true, phrase: '' }), /CLAVE/);
  assert.equal(validate('host', { nick: 'juli', port: '5555', e2e: true, phrase: 'una frase larga' }), null);
});

test('formularios: la clave E2E solo aparece al activar el cifrado', () => {
  const fields = formFor('join', { nick: 'juli', recents: ['100.64.0.10'] });
  const phrase = fields.find((f) => f.key === 'phrase');
  assert.equal(phrase.when(valuesOf(fields)), false);
  fields.find((f) => f.key === 'e2e').value = true;
  assert.equal(phrase.when(valuesOf(fields)), true);
  assert.equal(valuesOf(fields).target, '100.64.0.10', 'propone el último enlace');
  assert.ok(!formFor('server', { recents: [] }).some((f) => f.key === 'e2e'), 'el servidor no participa del E2E');
});
