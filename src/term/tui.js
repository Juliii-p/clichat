'use strict';
// Interfaz de pantalla completa (TUI), sin dependencias.
//
//  ┌──────────────────────────────────────────────────────────────┐
//  │ CLI-Chat │ #general — tema                 cifrado │ ana ★  │  cabecera
//  │ 20:31 <ana> hola                          │ SALAS            │
//  │ 20:31 <beto> qué tal                      │ #general 2       │  mensajes + panel
//  │                                           │ EN #general (2)  │  (el panel se oculta
//  │                                           │ ★ana             │   en pantallas angostas)
//  │── Tab completa · PgUp/PgDn historial ────────────────────────│  estado
//  │› escribiendo…                                                │  entrada
//  └──────────────────────────────────────────────────────────────┘
//
// Cada cambio redibuja la pantalla entera en una sola escritura: es simple, no deja
// basura al redimensionar y en una terminal sobra velocidad para hacerlo.

const readline = require('readline');
const { enabled: colorEnabled, nickSgr } = require('./colors');
const { formatMessage, isPing } = require('./format');
const { clusterWidth: charWidth, graphemes, stringWidth } = require('./width');
const { commandList, suggest, argumentHint } = require('./commands');

const MAX_ENTRIES = 2000;
const SIDEBAR_MIN_COLS = 72; // por debajo, el panel arranca oculto (teléfonos)
const SIDEBAR_WIDTH = 22;
const HEADER_SGR = '97;100';
const MENU_ROWS = 6; // sugerencias visibles a la vez
const MENU_SGR = '97;48;5;236';
const MENU_SELECTED_SGR = '1;30;48;5;214';

// ------------------------------------------------------------ celdas y cortes de línea

const toCells = (spans) => {
  const cells = [];
  for (const [code, text] of spans) for (const { ch, w } of graphemes(text)) cells.push({ ch, code, w });
  return cells;
};
const cellsWidth = (cells) => cells.reduce((n, c) => n + c.w, 0);

/** Corta una línea con estilo en filas de `width` columnas, sin partir palabras si se puede. */
function wrap(line, width) {
  const cells = toCells(line.spans);
  const indent = line.indent && width >= line.indent * 3 ? line.indent : 0;
  const rows = [];
  let i = 0;
  do {
    const avail = rows.length ? width - indent : width;
    let used = 0;
    let j = i;
    while (j < cells.length && used + cells[j].w <= avail) used += cells[j++].w;
    while (j < cells.length && cells[j].w === 0) j++; // marcas combinantes van con su letra
    if (j < cells.length) {
      let k = j;
      while (k > i && cells[k - 1].ch !== ' ') k--;
      if (k - i > avail / 3) j = k; // cortar en el último espacio, si no deja la fila casi vacía
    }
    if (j === i) j = i + 1; // un carácter más ancho que la fila: avanzar igual
    const row = cells.slice(i, j);
    if (j < cells.length) while (row.length > 1 && row[row.length - 1].ch === ' ') row.pop();
    rows.push(rows.length && indent ? [{ ch: ' '.repeat(indent), code: '', w: indent }, ...row] : row);
    i = j;
    while (i < cells.length && cells[i].ch === ' ') i++;
  } while (i < cells.length);
  return rows;
}

/** Recorta a `width` columnas, con "…" si no entra. */
function fit(cells, width) {
  if (cellsWidth(cells) <= width) return cells;
  const out = [];
  let used = 0;
  for (const c of cells) {
    if (used + c.w > width - 1) break;
    out.push(c);
    used += c.w;
  }
  out.push({ ch: '…', code: cells[out.length]?.code || '', w: 1 });
  return out;
}

/** Celdas → texto con secuencias SGR, rellenado con espacios hasta `width`. */
function paint(cells, width, base = '') {
  const reset = colorEnabled ? '\x1b[0m' + (base ? `\x1b[${base}m` : '') : '';
  let s = reset;
  let used = 0;
  let current = '';
  for (const c of cells) {
    if (used + c.w > width) break;
    if (colorEnabled && c.code !== current) {
      s += reset + (c.code ? `\x1b[${c.code}m` : '');
      current = c.code;
    }
    s += c.ch;
    used += c.w;
  }
  return s + reset + ' '.repeat(Math.max(0, width - used)) + (colorEnabled ? '\x1b[0m' : '');
}

// ------------------------------------------------------------ interfaz

function createTui(session) {
  const out = process.stdout;
  const input = process.stdin;

  const st = {
    nick: session.nick,
    room: '',
    topic: '',
    admin: false,
    entries: [], // { spans, indent, cache }
    scroll: 0, // filas desde abajo
    unread: 0,
    rooms: [],
    users: [],
    input: [], // caracteres
    cursor: 0,
    offset: 0, // desplazamiento horizontal de la entrada
    history: [],
    historyIndex: -1,
    draft: null,
    sidebar: null, // null = automático según el ancho
    completion: null,
    commands: commandList(null), // se reemplaza por la lista del servidor al entrar
    menu: null, // sugerencias abiertas: { kind, start, items }
    menuIndex: 0,
    menuDismissed: false, // Esc las cierra hasta que se vuelva a escribir
    messageWidth: 80,
  };

  const size = () => ({ W: out.columns || 80, H: out.rows || 24 });
  const sidebarVisible = (W) => st.sidebar ?? W >= SIDEBAR_MIN_COLS;

  function wrapped(entry, width) {
    if (!entry.cache || entry.cache.width !== width) entry.cache = { width, rows: wrap(entry, width) };
    return entry.cache.rows;
  }

  function addLines(lines) {
    for (const l of lines) {
      const entry = { ...l };
      st.entries.push(entry);
      // Si se está leyendo más arriba, la vista queda quieta.
      if (st.scroll > 0) st.scroll += wrapped(entry, st.messageWidth).length;
    }
    if (st.scroll > 0 && lines.length) st.unread++;
    if (st.entries.length > MAX_ENTRIES) st.entries.splice(0, st.entries.length - MAX_ENTRIES);
  }

  // ---------------------------------------------------------- dibujo

  function messageRows(width, height) {
    const need = height + st.scroll;
    const chunks = [];
    let count = 0;
    for (let i = st.entries.length - 1; i >= 0 && count < need; i--) {
      const rows = wrapped(st.entries[i], width);
      chunks.push(rows);
      count += rows.length;
    }
    const rows = chunks.reverse().flat();
    st.scroll = Math.min(st.scroll, Math.max(0, rows.length - height));
    if (st.scroll === 0) st.unread = 0;
    const end = rows.length - st.scroll;
    const visible = rows.slice(Math.max(0, end - height), end);
    while (visible.length < height) visible.unshift([]); // los mensajes se apoyan abajo
    return visible;
  }

  function sidebarRows(width, height) {
    const rows = [];
    const add = (spans) => rows.push(fit(toCells(spans), width));
    add([['1;90', ' SALAS']]);
    for (const r of st.rooms) {
      add([[r.name === st.room ? '1;96' : '', ` #${r.name}`], ['90', ` ${r.users}`]]);
    }
    add([]);
    add([['1;90', ` EN #${st.room} (${st.users.length})`]]);
    for (const u of st.users) add([['93', u.admin ? ' ★' : '  '], [nickSgr(u.nick), u.nick]]);
    if (rows.length > height) {
      rows.length = height;
      rows[height - 1] = toCells([['90', ' …']]);
    }
    while (rows.length < height) rows.push([]);
    return rows;
  }

  function headerRow(W) {
    const right = toCells([
      ['1;92', session.e2e ? ' e2e ' : ''],
      [session.secure ? '92' : '93', session.secure ? ' cifrado ' : ' sin cifrar '],
      ['37', '│ '],
      ['1', `${st.nick}${st.admin ? ' ★' : ''} `],
    ]);
    const left = toCells([
      ['1', ' CLI-Chat '],
      ['37', '│ '],
      ['1;96', `#${st.room}`],
      ['37', st.topic && W >= 50 ? ` — ${st.topic}` : ''],
    ]);
    const space = W - cellsWidth(right);
    if (space < 12) return paint(fit(left, W), W, HEADER_SGR);
    const l = fit(left, space - 1);
    const gap = { ch: ' '.repeat(W - cellsWidth(l) - cellsWidth(right)), code: '', w: 0 };
    gap.w = gap.ch.length;
    return paint([...l, gap, ...right], W, HEADER_SGR);
  }

  function statusRow(W) {
    let text;
    let code = '90';
    if (st.menu) {
      code = '38;5;214';
      text = W >= 52 ? ' ↑↓ elegir · Tab o ⏎ aceptar · Esc cerrar ' : ' ↑↓ · Tab/⏎ · Esc ';
    } else if (st.scroll > 0) {
      code = '93';
      text = st.unread ? ` ↓ ${st.unread} nuevo${st.unread > 1 ? 's' : ''} · PgDn para bajar ` : ' ↑ leyendo historial · PgDn para bajar ';
    } else {
      text = W >= 64 ? ' Tab completa · PgUp/PgDn historial · F2 panel · /help ' : ' /help · PgUp/PgDn · F2 panel ';
    }
    const cells = fit(toCells([['90', '──'], [code, text]]), W);
    const fill = W - cellsWidth(cells);
    return paint([...cells, { ch: '─'.repeat(fill), code: '90', w: fill }], W);
  }

  function inputRow(W) {
    const prompt = '› ';
    const avail = W - prompt.length - 1;
    const widthOf = (from, to) => st.input.slice(from, to).reduce((n, ch) => n + charWidth(ch), 0);
    if (st.cursor < st.offset) st.offset = st.cursor;
    while (st.offset < st.cursor && widthOf(st.offset, st.cursor) > avail) st.offset++;
    let used = 0;
    let text = '';
    for (let i = st.offset; i < st.input.length; i++) {
      const w = charWidth(st.input[i]);
      if (used + w > avail) break;
      text += st.input[i];
      used += w;
    }
    const color = colorEnabled ? '\x1b[96m' : '';
    const reset = colorEnabled ? '\x1b[0m' : '';
    // Pista en gris con los argumentos que faltan: "/msg " → "<nick> <txt>".
    let ghost = '';
    if (st.cursor === st.input.length) {
      const typed = st.input.join('');
      const hint = argumentHint(typed, st.commands);
      const g = hint && (typed.endsWith(' ') ? '' : ' ') + hint;
      if (g && used + stringWidth(g) <= avail) ghost = colorEnabled ? `\x1b[90m${g}\x1b[0m` : g;
    }
    return {
      row: `${color}${prompt}${reset}${text}${ghost}\x1b[K`,
      column: prompt.length + widthOf(st.offset, st.cursor) + 1,
    };
  }

  function menuRows(W, max) {
    const { items } = st.menu;
    const count = Math.min(items.length, max);
    const first = Math.min(Math.max(0, st.menuIndex - count + 1), items.length - count);
    const labelW = Math.min(
      Math.max(...items.map((i) => stringWidth(i.label + (i.detail ? ' ' + i.detail : '')))) + 3,
      Math.floor(W * 0.6)
    );
    return items.slice(first, first + count).map((item, n) => {
      const selected = first + n === st.menuIndex;
      const cells = toCells([
        ['1', (selected ? ' ▶ ' : '   ') + item.label],
        [selected ? '' : '38;5;214', item.detail ? ' ' + item.detail : ''],
      ]);
      const pad = Math.max(1, labelW - cellsWidth(cells));
      const more = n === count - 1 && first + count < items.length ? ` (+${items.length - first - count})` : '';
      const desc = toCells([[selected ? '' : '37', ' '.repeat(pad) + item.desc + more]]);
      return paint(fit([...cells, ...desc], W), W, selected ? MENU_SELECTED_SGR : MENU_SGR);
    });
  }

  function render() {
    if (stopped) return;
    const { W, H } = size();
    if (W < 20 || H < 6) {
      out.write('\x1b[2J\x1b[1;1HAgranda la ventana');
      return;
    }
    const side = sidebarVisible(W) ? Math.min(SIDEBAR_WIDTH, Math.floor(W / 3)) : 0;
    const msgW = side ? W - side - 1 : W;
    const bodyH = H - 3;
    st.messageWidth = msgW;

    const rows = [headerRow(W)];
    const messages = messageRows(msgW, bodyH);
    const panel = side ? sidebarRows(side, bodyH) : null;
    const bar = colorEnabled ? '\x1b[90m│\x1b[0m' : '│';
    for (let i = 0; i < bodyH; i++) {
      // Columna absoluta para el separador: si la terminal mide un símbolo distinto que
      // nosotros, el desfase queda en esa fila y no corre el panel.
      rows.push(paint(messages[i], msgW) + (panel ? `\x1b[${msgW + 1}G${bar}${paint(panel[i], side)}` : ''));
    }
    // Menú de sugerencias: tapa las últimas filas de mensajes, justo sobre la entrada.
    if (st.menu) {
      const menu = menuRows(W, Math.min(MENU_ROWS, bodyH - 1));
      menu.forEach((r, i) => (rows[bodyH - menu.length + 1 + i] = r));
    }
    rows.push(statusRow(W));
    const { row, column } = inputRow(W);
    rows.push(row);

    let frame = '\x1b[?25l';
    // Se borra cada fila antes de escribirla: no quedan restos del cuadro anterior.
    rows.forEach((r, i) => (frame += `\x1b[${i + 1};1H\x1b[2K${r}`));
    out.write(`${frame}\x1b[${H};${column}H\x1b[?25h`);
  }

  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    setImmediate(() => {
      renderPending = false;
      render();
    });
  }

  // ---------------------------------------------------------- teclado

  function setInput(text) {
    st.input = graphemes(text).map((g) => g.ch);
    st.cursor = st.input.length;
  }

  // Tras insertar se vuelve a agrupar: un emoji compuesto puede llegar en varias partes.
  function regroup() {
    const before = st.input.slice(0, st.cursor).join('');
    st.input = graphemes(st.input.join('')).map((g) => g.ch);
    st.cursor = graphemes(before).length;
  }

  function submit() {
    const text = st.input.join('').trim();
    setInput('');
    st.historyIndex = -1;
    st.draft = null;
    if (!text) return;
    if (st.history[st.history.length - 1] !== text) st.history.push(text);
    if (st.history.length > 100) st.history.shift();

    if (text === '/clear') {
      st.entries = [];
      st.scroll = 0;
    } else if (text === '/panel') {
      st.sidebar = !sidebarVisible(size().W);
    } else if (/^\/(quit|exit)\b/i.test(text)) {
      session.quit(text);
    } else {
      st.scroll = 0;
      session.send(text);
    }
  }

  function browseHistory(step) {
    if (!st.history.length) return;
    if (st.historyIndex === -1) st.draft = st.input.join('');
    const next = st.historyIndex + step;
    if (next < -1 || next >= st.history.length) return;
    st.historyIndex = next;
    setInput(next === -1 ? st.draft : st.history[st.history.length - 1 - next]);
  }

  function complete() {
    if (!st.completion) {
      const before = st.input.slice(0, st.cursor).join('');
      const word = Array.from(before.match(/(\S*)$/)[1]);
      const start = st.cursor - word.length;
      const prefix = word.join('').toLowerCase();
      const isCommand = start === 0 && prefix.startsWith('/');
      const pool = isCommand ? st.commands.map((c) => c.cmd) : st.users.map((u) => u.nick).filter((n) => n !== st.nick);
      const matches = pool.filter((p) => p.toLowerCase().startsWith(prefix));
      if (!matches.length) return;
      st.completion = { start, matches, index: -1, suffix: !isCommand && start === 0 ? ': ' : ' ' };
    }
    const comp = st.completion;
    comp.index = (comp.index + 1) % comp.matches.length;
    const replacement = Array.from(comp.matches[comp.index] + comp.suffix);
    st.input.splice(comp.start, st.cursor - comp.start, ...replacement);
    st.cursor = comp.start + replacement.length;
  }

  // Recalcula el menú de sugerencias según lo escrito hasta el cursor.
  function updateMenu() {
    const previous = st.menu && st.menu.items[st.menuIndex] && st.menu.items[st.menuIndex].value;
    const next = st.menuDismissed
      ? null
      : suggest(st.input.slice(0, st.cursor).join(''), {
          commands: st.commands,
          nicks: st.users.filter((u) => u.nick !== st.nick),
          rooms: st.rooms,
        });
    st.menu = next;
    const keep = next ? next.items.findIndex((i) => i.value === previous) : -1;
    st.menuIndex = Math.max(0, keep);
  }

  // Inserta la sugerencia elegida. Devuelve true si el comando quedó completo (sin
  // argumentos obligatorios pendientes), para que Enter lo envíe de una.
  function acceptSuggestion() {
    const item = st.menu.items[st.menuIndex];
    const base = st.input.slice(0, st.menu.start).join('') + item.value;
    const tail = st.input.slice(st.cursor).join('');
    const remaining = argumentHint(base + ' ', st.commands);
    const text = base + (remaining ? ' ' : '');
    st.input = graphemes(text + tail).map((g) => g.ch);
    st.cursor = graphemes(text).length;
    st.menu = null;
    return !remaining.includes('<');
  }

  function deleteWordBack() {
    let i = st.cursor;
    while (i > 0 && st.input[i - 1] === ' ') i--;
    while (i > 0 && st.input[i - 1] !== ' ') i--;
    st.input.splice(i, st.cursor - i);
    st.cursor = i;
  }

  function onKey(str, key = {}) {
    const before = st.input.join('');
    handleKey(str, key);
    // Escribir o borrar vuelve a abrir las sugerencias que se cerraron con Esc.
    if (st.input.join('') !== before) st.menuDismissed = false;
    if (!st.menuNavigating) updateMenu();
    st.menuNavigating = false;
    render();
  }

  function handleKey(str, key) {
    const page = Math.max(1, size().H - 4);
    if (key.name !== 'tab') st.completion = null;

    // Con el menú de sugerencias abierto, las flechas, Tab, Enter y Esc son suyos.
    if (st.menu && !key.ctrl) {
      const n = st.menu.items.length;
      switch (key.name) {
        case 'up':
          st.menuIndex = (st.menuIndex + n - 1) % n;
          st.menuNavigating = true;
          return;
        case 'down':
          st.menuIndex = (st.menuIndex + 1) % n;
          st.menuNavigating = true;
          return;
        case 'tab':
          acceptSuggestion();
          return;
        case 'return':
        case 'enter':
          if (acceptSuggestion()) submit();
          return;
        case 'escape':
          st.menu = null;
          st.menuDismissed = true;
          st.menuNavigating = true;
          return;
      }
    }

    if (key.ctrl) {
      switch (key.name) {
        case 'c':
          return session.quit();
        case 'd':
          if (!st.input.length) return session.quit();
          break;
        case 'a':
          st.cursor = 0;
          break;
        case 'e':
          st.cursor = st.input.length;
          break;
        case 'u':
          st.input.splice(0, st.cursor);
          st.cursor = 0;
          break;
        case 'k':
          st.input.splice(st.cursor);
          break;
        case 'w':
          deleteWordBack();
          break;
        case 'l':
          out.write('\x1b[2J');
          break;
        default:
          return;
      }
      return;
    }

    switch (key.name) {
      case 'return':
      case 'enter':
        submit();
        break;
      case 'backspace':
        if (st.cursor > 0) st.input.splice(--st.cursor, 1);
        break;
      case 'delete':
        st.input.splice(st.cursor, 1);
        break;
      case 'left':
        st.cursor = Math.max(0, st.cursor - 1);
        break;
      case 'right':
        st.cursor = Math.min(st.input.length, st.cursor + 1);
        break;
      case 'home':
        st.cursor = 0;
        break;
      case 'end':
        st.cursor = st.input.length;
        break;
      case 'up':
        browseHistory(1);
        break;
      case 'down':
        browseHistory(-1);
        break;
      case 'pageup':
        st.scroll += page;
        break;
      case 'pagedown':
        st.scroll = Math.max(0, st.scroll - page);
        break;
      case 'tab':
        complete();
        break;
      case 'f2':
        st.sidebar = !sidebarVisible(size().W);
        break;
      case 'escape':
        break;
      default: {
        if (!str || key.meta) return;
        const chars = Array.from(str).filter((ch) => ch >= ' ' && ch !== '\x7f');
        if (!chars.length) return;
        st.input.splice(st.cursor, 0, ...chars);
        st.cursor += chars.length;
        regroup();
      }
    }
  }

  // ---------------------------------------------------------- ciclo de vida

  let stopped = false;
  const onResize = () => {
    out.write('\x1b[2J');
    render();
  };

  function restore() {
    if (stopped) return;
    stopped = true;
    input.off('keypress', onKey);
    out.off('resize', onResize);
    process.off('exit', restore);
    try {
      input.setRawMode(false);
    } catch {
      /* la terminal ya no existe */
    }
    input.pause();
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }

  out.write('\x1b[?1049h\x1b[2J');
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  input.on('keypress', onKey);
  out.on('resize', onResize);
  process.on('exit', restore); // si algo revienta, la terminal no queda en modo raw
  render();

  return {
    kind: 'tui',
    onMessage(m) {
      switch (m.type) {
        case 'state':
          st.nick = m.nick;
          st.room = m.room;
          st.admin = Boolean(m.admin);
          break;
        case 'joined':
          // Cada sala tiene su conversación: se limpia la vista y se muestra su historial.
          st.entries = [];
          st.scroll = 0;
          st.topic = m.topic || '';
          st.users = m.users.map((nick) => ({ nick, admin: false }));
          addLines(formatMessage(m, st.nick));
          break;
        case 'rooms': {
          st.rooms = m.rooms;
          const current = m.rooms.find((r) => r.name === st.room);
          if (current) st.topic = current.topic || '';
          break;
        }
        case 'roster':
          if (m.room === st.room) st.users = m.users;
          break;
        case 'welcome':
          st.commands = commandList(m.commands);
          addLines(formatMessage(m, st.nick));
          break;
        default:
          addLines(formatMessage(m, st.nick));
          if (isPing(m, st.nick)) out.write('\x07');
      }
      if (st.menu && (m.type === 'rooms' || m.type === 'roster')) updateMenu();
      scheduleRender();
    },
    destroy: restore,
  };
}

module.exports = { createTui, wrap, fit };
