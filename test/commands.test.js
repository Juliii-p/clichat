'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_COMMANDS, commandList, suggest, argumentHint } = require('../src/term/commands');
const { SCRIPTS } = require('../src/completion');

const ctx = {
  commands: DEFAULT_COMMANDS,
  nicks: [{ nick: 'ana', admin: false }, { nick: 'beto', admin: true }],
  rooms: [{ name: 'general', users: 3, topic: 'Sala principal' }, { name: 'dev', users: 1, topic: '' }],
};
const values = (s) => s && s.items.map((i) => i.value);

test('al escribir "/" se sugieren comandos, filtrados por lo escrito', () => {
  assert.ok(values(suggest('/', ctx)).length >= 10);
  assert.deepEqual(values(suggest('/m', ctx)), ['/msg', '/me']);
  assert.equal(suggest('hola', ctx), null);
  assert.equal(suggest('/zzz', ctx), null);
});

test('argumentos: nicks para /msg, salas para /join (con o sin #)', () => {
  assert.deepEqual(values(suggest('/msg ', ctx)), ['ana', 'beto']);
  assert.deepEqual(values(suggest('/msg b', ctx)), ['beto']);
  assert.deepEqual(values(suggest('/join ', ctx)), ['general', 'dev']);
  assert.deepEqual(values(suggest('/join #d', ctx)), ['dev']);
  assert.equal(suggest('/msg ana hola', ctx), null, 'ya escribiendo el mensaje: sin menú');
  assert.equal(suggest('/msg ana', ctx), null, 'nick completo: sin menú');
});

test('pista de argumentos pendientes', () => {
  assert.equal(argumentHint('/msg ', DEFAULT_COMMANDS), '<nick> <txt>');
  assert.equal(argumentHint('/msg ana ', DEFAULT_COMMANDS), '<txt>');
  assert.equal(argumentHint('/msg ana hola', DEFAULT_COMMANDS), '');
  assert.equal(argumentHint('/who ', DEFAULT_COMMANDS), '[sala]');
  assert.equal(argumentHint('/rooms', DEFAULT_COMMANDS), '');
  assert.equal(argumentHint('hola', DEFAULT_COMMANDS), '');
});

test('la lista del servidor reemplaza a la de respaldo y descarta lo raro', () => {
  const list = commandList([{ cmd: '/kick', args: '<nick>', desc: 'expulsar' }, { cmd: '//texto' }, null, { cmd: 'x' }]);
  assert.deepEqual(list.map((c) => c.cmd), ['/kick', '/help']);
  assert.equal(commandList(undefined), DEFAULT_COMMANDS);
});

test('scripts de autocompletado para cada shell', () => {
  assert.match(SCRIPTS.bash(), /complete -F _clichat clichat/);
  assert.match(SCRIPTS.zsh(), /bashcompinit/);
  assert.match(SCRIPTS.powershell(), /Register-ArgumentCompleter/);
  for (const make of Object.values(SCRIPTS)) assert.match(make(), /__recientes/);
});
