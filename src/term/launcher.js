'use strict';
// Pantalla de inicio de `clichat` sin argumentos: una sala de briefing táctica para
// elegir la operación (unirse, crear un canal o levantar un servidor) y su nivel de
// seguridad. Solo se usa en una terminal interactiva; si no, queda el menú clásico.

const crypto = require('crypto');
const readline = require('readline');
const { enabled: colorEnabled } = require('./colors');
const { stringWidth } = require('./width');
const { NICK_RE, DEFAULT_PORT, localAddresses } = require('../util');

// ------------------------------------------------------------ estilo

const style = (code) => (s) => (colorEnabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const amber = style('38;5;214');
const ember = style('38;5;130');
const white = style('1;97');
const gray = style('90');
const red = style('91');
const green = style('92');
const yellow = style('93');
const stamp = style('1;97;41');
const selected = style('1;30;48;5;214');
const GRADIENT = ['38;5;220', '38;5;214', '38;5;208', '38;5;202', '38;5;166'];

const visible = (s) => stringWidth(s.replace(/\x1b\[[0-9;]*m/g, ''));
const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - visible(s)));
const center = (s, w) => ' '.repeat(Math.max(0, Math.floor((w - visible(s)) / 2))) + s;
const rule = (title, w) => {
  const head = `━━━ ${title} `;
  return amber(head + '━'.repeat(Math.max(0, w - stringWidth(head))));
};
// Corta texto sin estilo en líneas de `w` columnas (para pantallas de teléfono).
function wrapPlain(text, w) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(' ')) {
    if (current && stringWidth(current + ' ' + word) > w) {
      lines.push(current);
      current = word;
    } else current = current ? current + ' ' + word : word;
  }
  if (current) lines.push(current);
  return lines;
}
const note = (text, w, indent = '  ') => wrapPlain(text, w - indent.length).map((l) => gray(indent + l));

const leader = (label, value, w) => {
  const dots = Math.max(2, w - stringWidth(label) - visible(value) - 4);
  return `${gray('> ' + label + ' ' + '.'.repeat(dots))} ${value}`;
};

// Letras en bloque, de diseño propio: 5 filas de alto.
const FONT = {
  C: [' ████', '██   ', '██   ', '██   ', ' ████'],
  L: ['██   ', '██   ', '██   ', '██   ', '█████'],
  I: ['██', '██', '██', '██', '██'],
  '-': ['    ', '    ', '████', '    ', '    '],
  H: ['██  ██', '██  ██', '██████', '██  ██', '██  ██'],
  A: [' ████ ', '██  ██', '██████', '██  ██', '██  ██'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
};
function bigTitle(text) {
  return [0, 1, 2, 3, 4].map((row) => {
    const line = Array.from(text, (ch) => FONT[ch][row]).join(' ');
    return colorEnabled ? `\x1b[${GRADIENT[row]}m${line}\x1b[0m` : line;
  });
}
const TITLE_WIDTH = stringWidth(bigTitle('CLI-CHAT')[0].replace(/\x1b\[[0-9;]*m/g, ''));

// ------------------------------------------------------------ operaciones

const OPERATIONS = [
  { mode: 'join', name: 'UNIRSE A UN CHAT', go: 'CONECTAR', desc: 'Conectarse a un chat que ya está abierto.' },
  { mode: 'host', name: 'CREAR UN CHAT', go: 'CREAR CHAT', desc: 'Abrir un chat en este equipo y participar. Si sales, se cierra para todos.' },
  { mode: 'server', name: 'SERVIDOR DEDICADO', go: 'INICIAR SERVIDOR', desc: 'Solo servidor, sin chatear. Para una máquina siempre encendida.' },
  { mode: null, name: 'SALIR', desc: 'Salir sin hacer nada.' },
];

function formFor(mode, ctx) {
  const fields = [];
  if (mode === 'join') {
    fields.push({ key: 'target', label: 'SERVIDOR', type: 'text', value: ctx.recents[0] || '', hint: 'IP o nombre del servidor, con :puerto si no es el 5555.' });
  }
  if (mode !== 'server') {
    fields.push({ key: 'nick', label: 'NICK', type: 'text', value: ctx.nick || '', hint: '2 a 20 caracteres: letras, números, _ o -.' });
  }
  if (mode !== 'join') {
    fields.push({ key: 'port', label: 'PUERTO', type: 'text', value: String(DEFAULT_PORT), hint: 'Puerto donde escucha el canal.' });
  }
  if (mode === 'join') {
    fields.push({
      key: 'tls',
      label: 'CONEXIÓN',
      type: 'choice',
      options: [['auto', 'AUTOMÁTICO'], ['tls', 'EXIGIR CIFRADO'], ['plain', 'SIN CIFRAR']],
      index: 0,
      hint: 'Automático: cifra si el servidor lo permite, y avisa si no.',
    });
  } else {
    fields.push({ key: 'tls', label: 'CIFRADO TLS', type: 'toggle', value: true, hint: 'Protege el viaje por la red.' });
  }
  if (mode !== 'server') {
    fields.push({ key: 'e2e', label: 'CIFRADO E2E', type: 'toggle', value: false, hint: 'Clave compartida: ni el servidor puede leer los mensajes.' });
    fields.push({ key: 'phrase', label: 'CLAVE E2E', type: 'secret', value: '', when: (v) => v.e2e, hint: 'La misma frase en todos los equipos. 12 caracteres o más.' });
  }
  fields.push({
    key: 'password',
    label: mode === 'join' ? 'CONTRASEÑA' : 'CONTRASEÑA DE ACCESO',
    type: 'secret',
    value: '',
    hint: mode === 'join' ? 'Solo si el canal la pide.' : 'Vacío = cualquiera con la IP puede entrar.',
  });
  if (mode !== 'join') {
    fields.push({ key: 'log', label: 'REGISTRO', type: 'text', value: '', hint: 'Archivo donde registrar las salas. Vacío = efímero.' });
  }
  fields.push({ key: 'go', label: OPERATIONS.find((o) => o.mode === mode).go, type: 'button' });
  return fields;
}

function valuesOf(fields) {
  const v = {};
  for (const f of fields) {
    if (f.type === 'choice') v[f.key] = f.options[f.index][0];
    else if (f.type !== 'button') v[f.key] = f.value;
  }
  return v;
}

/**
 * Nivel de seguridad de la operación, con lo que protege y lo que no.
 * `width` (opcional) corta las aclaraciones para pantallas angostas.
 */
function securityLevel(mode, v, width = 80) {
  const tls = mode === 'join' ? v.tls !== 'plain' : v.tls;
  const e2e = mode !== 'server' && v.e2e;
  const level = tls && e2e ? 3 : e2e ? 2 : tls ? 1 : 0;
  const names = ['ABIERTO', 'RESTRINGIDO', 'CLASIFICADO', 'ALTO SECRETO'];
  const paint = [red, yellow, amber, green][level];
  const lines = [`${paint('▮'.repeat(level) + '▯'.repeat(3 - level))} ${paint(`NIVEL ${level} // ${names[level]}`)}`];
  const item = (ok, label, detail) => {
    const mark = ok === null ? gray('□') : ok ? green('▣') : red('□');
    const inline = detail && stringWidth(label + detail) + 4 <= width;
    lines.push(`${mark} ${label}${inline ? gray('  ' + detail) : ''}`);
    if (detail && !inline) lines.push(...note(detail, width, '  '));
  };
  item(tls, 'CONEXIÓN CIFRADA (TLS)', mode === 'join' && v.tls === 'auto' ? 'si el servidor lo permite' : '');
  if (mode !== 'server') item(e2e, 'MENSAJES CIFRADOS (E2E)', e2e ? '' : 'el servidor puede leer');
  item(null, 'ANONIMATO', 'no disponible: se ven IPs, nicks y horarios');
  if (e2e && v.phrase && v.phrase.length < 12) lines.push(yellow('⚠ CLAVE CORTA: más fácil de adivinar'));
  return lines;
}

function validate(mode, v) {
  if (mode === 'join' && !v.target.trim()) return 'FALTA LA IP DEL SERVIDOR';
  if (mode !== 'server' && !NICK_RE.test(v.nick)) return 'NICK INVÁLIDO: 2 a 20 letras, números, _ o -';
  if (mode !== 'join') {
    const port = Number(v.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'PUERTO INVÁLIDO';
  }
  if (v.e2e && !v.phrase) return 'EL CIFRADO E2E NECESITA UNA CLAVE';
  return null;
}

// ------------------------------------------------------------ pantalla

/**
 * Muestra la pantalla de inicio. Resuelve con la operación elegida:
 *   { mode, target, args, e2ePhrase }   o null si se abortó.
 */
function runLauncher({ version, nick, recents = [] }) {
  const out = process.stdout;
  const input = process.stdin;
  const tailnet = localAddresses().find((ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip));
  const cryptoOk = crypto.getCiphers().includes('aes-256-gcm');

  const st = { screen: 'boot', boot: 0, menu: 0, mode: null, fields: [], field: 0, error: null, launch: [] };

  return new Promise((resolve) => {
    let timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    function frame(lines) {
      const W = out.columns || 80;
      const H = out.rows || 24;
      const BW = Math.min(W - 2, 76);
      const left = ' '.repeat(Math.max(0, Math.floor((W - BW) / 2)));
      const body = lines(BW, W);
      const rows = new Array(H).fill('');
      // Franjas de cine arriba y abajo, si hay lugar.
      const bars = H >= body.length + 4;
      if (bars) {
        rows[0] = gray('▄'.repeat(W));
        rows[H - 1] = gray('▀'.repeat(W));
      }
      const space = H - (bars ? 2 : 0);
      const top = (bars ? 1 : 0) + Math.max(0, Math.floor((space - body.length) / 2));
      body.slice(0, space).forEach((l, i) => (rows[top + i] = left + l));
      let s = '\x1b[?25l';
      rows.forEach((r, i) => (s += `\x1b[${i + 1};1H\x1b[2K${r}`));
      out.write(s);
    }

    function header(BW) {
      const lines = [
        BW >= 50
          ? `${stamp(' CONFIDENCIAL ')} ${gray('// SOLO PERSONAL AUTORIZADO //')} ${ember(`v${version}`)}`
          : `${stamp(' CONFIDENCIAL ')} ${ember(`v${version}`)}`,
        '',
      ];
      if (BW >= TITLE_WIDTH + 2) {
        for (const l of bigTitle('CLI-CHAT')) lines.push(center(l, BW));
        lines.push('');
        lines.push(center(white('C O M U N I C A C I O N E S   T Á C T I C A S'), BW));
      } else {
        lines.push(center(white('▌ C L I - C H A T ▐'), BW));
        lines.push(center(amber('COMUNICACIONES TÁCTICAS'), BW));
      }
      lines.push('');
      return lines;
    }

    // ---------------------------------------------------------- pantallas

    const bootSteps = [
      ['INICIALIZANDO TERMINAL', green('OK')],
      ['MÓDULOS CRIPTOGRÁFICOS', cryptoOk ? green('OK') : red('FALLA')],
      ['RED TAILSCALE', tailnet ? green(tailnet) : yellow('NO DETECTADA')],
      ['NICK', nick ? amber(nick) : gray('SIN ELEGIR')],
      ['ESTADO', green('LISTO')],
    ];

    function drawBoot() {
      frame((BW) => {
        const lines = header(BW);
        const w = Math.min(BW, 56);
        for (let i = 0; i < st.boot; i++) lines.push(leader(bootSteps[i][0], bootSteps[i][1], w));
        if (st.boot >= bootSteps.length) lines.push('', gray('  presiona cualquier tecla'));
        return lines;
      });
    }

    function drawMenu() {
      frame((BW) => {
        const lines = header(BW);
        lines.push(rule('ESTADO', BW));
        const w = Math.min(BW, 56);
        lines.push(leader('NICK', nick ? amber(nick) : gray('SIN ELEGIR'), w));
        lines.push(leader('ÚLTIMO SERVIDOR', recents[0] ? amber(recents[0]) : gray('NINGUNO'), w));
        lines.push(leader('TU IP (TAILSCALE)', tailnet ? amber(tailnet) : gray('NO DETECTADA'), w));
        lines.push('');
        lines.push(rule('MENÚ', BW));
        OPERATIONS.forEach((op, i) => {
          const label = ` ${String(i + 1).padStart(2, '0')}  ${op.name} `;
          lines.push(i === st.menu ? `${amber('▶')} ${selected(padEnd(label, 24))}` : `  ${white(label)}`);
        });
        lines.push('');
        lines.push(...note(OPERATIONS[st.menu].desc, BW));
        lines.push('');
        lines.push(gray(BW >= 50 ? '  ↑↓ ELEGIR   ⏎ CONFIRMAR   1-4 ATAJO   ESC SALIR' : '  ↑↓  ⏎  ESC'));
        return lines;
      });
    }

    const shown = () => {
      const v = valuesOf(st.fields);
      return st.fields.filter((f) => !f.when || f.when(v));
    };

    function drawForm() {
      frame((BW) => {
        const op = OPERATIONS.find((o) => o.mode === st.mode);
        const v = valuesOf(st.fields);
        const narrow = BW < 56;
        const labelW = narrow ? 0 : 24;
        const lines = [
          `${stamp(' CONFIDENCIAL ')} ${gray('// CLI-CHAT //')}`,
          '',
          white(op.name),
          ...note(op.desc, BW, ''),
          '',
          rule('PARÁMETROS', BW),
        ];
        const fields = shown();
        fields.forEach((f, i) => {
          const focus = i === st.field;
          const mark = focus ? amber('▶ ') : '  ';
          if (f.type === 'button') {
            lines.push('');
            lines.push(mark + (focus ? selected(` ${f.label} `) : white(`[ ${f.label} ]`)));
            return;
          }
          let value;
          if (f.type === 'toggle') value = f.value ? green('[■] ACTIVO') : gray('[ ] INACTIVO');
          else if (f.type === 'choice') value = `${gray('◀')} ${amber(f.options[f.index][1])} ${gray('▶')}`;
          else {
            const text = f.type === 'secret' ? '●'.repeat(Array.from(f.value).length) : f.value;
            const room = BW - labelW - 6;
            const clipped = stringWidth(text) > room ? '…' + Array.from(text).slice(-room + 1).join('') : text;
            value = (focus ? white(clipped) + amber('█') : amber(clipped)) || gray('—');
            if (!f.value && !focus) value = gray('—');
          }
          const label = focus ? amber(f.label) : gray(f.label);
          if (narrow) {
            lines.push(mark + label);
            lines.push('    ' + value);
          } else {
            lines.push(mark + padEnd(label, labelW) + value);
          }
        });
        lines.push('');
        lines.push(rule('NIVEL DE SEGURIDAD', BW));
        for (const l of securityLevel(st.mode, v, BW - 2)) lines.push('  ' + l);
        lines.push('');
        const hint = fields[st.field] && fields[st.field].hint;
        if (st.error) lines.push(...wrapPlain('✖ ' + st.error, BW).map(red));
        else lines.push(...note(hint || '', BW, ''));
        lines.push(gray(BW >= 60 ? '↑↓ CAMPO   ←→ ESPACIO CAMBIAR   ⏎ SIGUIENTE   ESC VOLVER' : '↑↓  ←→  ⏎  ESC'));
        return lines;
      });
    }

    function drawLaunch() {
      frame((BW) => {
        const lines = [`${stamp(' CONFIDENCIAL ')} ${gray('// CLI-CHAT //')}`, '', rule('INICIANDO', BW), ''];
        for (const l of st.launch) lines.push(l);
        return lines;
      });
    }

    const draw = () => ({ boot: drawBoot, menu: drawMenu, form: drawForm, launch: drawLaunch })[st.screen]();

    // ---------------------------------------------------------- transiciones

    function toMenu() {
      st.screen = 'menu';
      st.error = null;
      draw();
    }

    function openForm(i) {
      const op = OPERATIONS[i];
      if (!op.mode) return finish(null);
      st.mode = op.mode;
      st.fields = formFor(op.mode, { nick, recents });
      st.field = 0;
      st.error = null;
      st.screen = 'form';
      draw();
    }

    function execute() {
      const v = valuesOf(st.fields);
      st.error = validate(st.mode, v);
      if (st.error) return draw();
      const args = { nick: v.nick, password: v.password || undefined };
      if (st.mode === 'join') {
        if (v.tls === 'tls') args.tls = true;
        if (v.tls === 'plain') args['no-tls'] = true;
      } else {
        args.port = v.port;
        args.tls = v.tls;
        if (v.log) args.log = v.log;
      }
      const result = { mode: st.mode, target: v.target, args, e2ePhrase: v.e2e ? v.phrase : null };
      const where = st.mode === 'join' ? v.target : `PUERTO ${v.port}`;
      const steps = [
        `${gray('>')} ${white(OPERATIONS.find((o) => o.mode === st.mode).name)}`,
        `${gray('>')} ${st.mode === 'join' ? 'CONECTANDO A' : 'ABRIENDO CHAT EN'} ${amber(where)}`,
        `${gray('>')} ${securityLevel(st.mode, v)[0]}`,
      ];
      st.screen = 'launch';
      steps.forEach((s, i) =>
        later(180 * (i + 1), () => {
          st.launch.push(s);
          draw();
        })
      );
      later(180 * steps.length + 450, () => finish(result));
      draw();
    }

    // ---------------------------------------------------------- teclado

    function onKey(str, key = {}) {
      if (key.ctrl && key.name === 'c') return finish(null);
      if (st.screen === 'boot') {
        timers.forEach(clearTimeout);
        timers = [];
        return toMenu();
      }
      if (st.screen === 'launch') return;

      if (st.screen === 'menu') {
        if (key.name === 'up' || str === 'k') st.menu = (st.menu + OPERATIONS.length - 1) % OPERATIONS.length;
        else if (key.name === 'down' || str === 'j') st.menu = (st.menu + 1) % OPERATIONS.length;
        else if (/^[1-4]$/.test(str || '')) return openForm(Number(str) - 1);
        else if (key.name === 'return' || key.name === 'enter') return openForm(st.menu);
        else if (key.name === 'escape' || str === 'q') return finish(null);
        return draw();
      }

      // Formulario
      const fields = shown();
      const f = fields[st.field];
      st.error = null;
      switch (key.name) {
        case 'escape':
          return toMenu();
        case 'up':
          st.field = (st.field + fields.length - 1) % fields.length;
          break;
        case 'down':
        case 'tab':
          st.field = (st.field + 1) % fields.length;
          break;
        case 'return':
        case 'enter':
          if (f.type === 'button') return execute();
          if (f.type === 'toggle') f.value = !f.value;
          st.field = Math.min(st.field + 1, shown().length - 1);
          break;
        case 'left':
        case 'right':
          if (f.type === 'toggle') f.value = !f.value;
          if (f.type === 'choice') f.index = (f.index + (key.name === 'left' ? f.options.length - 1 : 1)) % f.options.length;
          break;
        case 'space':
          if (f.type === 'toggle') f.value = !f.value;
          else if (f.type === 'choice') f.index = (f.index + 1) % f.options.length;
          else if (f.type === 'text' || f.type === 'secret') f.value += ' ';
          break;
        case 'backspace':
          if (f.type === 'text' || f.type === 'secret') f.value = Array.from(f.value).slice(0, -1).join('');
          break;
        default:
          if ((f.type === 'text' || f.type === 'secret') && str && !key.ctrl && !key.meta) {
            const chars = Array.from(str).filter((ch) => ch >= ' ' && ch !== '\x7f');
            if (Array.from(f.value).length + chars.length <= 200) f.value += chars.join('');
          }
      }
      st.field = Math.min(st.field, shown().length - 1);
      draw();
    }

    // ---------------------------------------------------------- ciclo de vida

    let done = false;
    function restore() {
      input.off('keypress', onKey);
      out.off('resize', draw);
      process.off('exit', restore);
      try {
        input.setRawMode(false);
      } catch {
        /* sin terminal */
      }
      input.pause();
      out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    }
    function finish(result) {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      restore();
      resolve(result);
    }

    out.write('\x1b[?1049h\x1b[2J');
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKey);
    out.on('resize', draw);
    process.on('exit', restore);

    draw();
    bootSteps.forEach((_, i) =>
      later(140 * (i + 1), () => {
        st.boot = i + 1;
        draw();
      })
    );
    later(140 * bootSteps.length + 900, toMenu);
  });
}

module.exports = { runLauncher, securityLevel, validate, formFor, valuesOf };
