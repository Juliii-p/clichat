#!/usr/bin/env python3
"""Prueba de carga para clichat.

Conecta muchos usuarios a la vez (con nombres propios de estrellas), los hace
charlar en una sala y mide:

  - cuántos logran entrar y cuánto tardan;
  - la latencia de cada mensaje (de que se envía a que vuelve el eco del servidor);
  - si se pierden mensajes;
  - qué errores devuelve el servidor.

Solo usa la biblioteca estándar: corre igual en la PC y en Termux.

    python tools/stress.py                         # 500 usuarios contra 127.0.0.1:5555
    python tools/stress.py --users 200 --room estres --duration 60
    python tools/stress.py --host 100.64.0.10 --tls --password clave

Úsalo solo contra servidores tuyos o con permiso de quien los administra.
"""

import argparse
import asyncio
import hashlib
import json
import random
import ssl
import statistics
import sys
import time
from collections import Counter

# Nombres propios de estrellas, agrupadas por constelación. Sin designaciones
# ("Alpha Centauri", "HD 189733"): solo nombres. En ASCII, porque los nicks no
# admiten tildes.
STARS = {
    'Orión': ['Betelgeuse', 'Rigel', 'Bellatrix', 'Alnilam', 'Alnitak', 'Mintaka', 'Saiph', 'Meissa'],
    'Can Mayor': ['Sirius', 'Adhara', 'Wezen', 'Mirzam', 'Aludra', 'Furud'],
    'Can Menor': ['Procyon', 'Gomeisa'],
    'Tauro': ['Aldebaran', 'Elnath', 'Alcyone', 'Electra', 'Maia', 'Merope', 'Taygeta', 'Celaeno',
              'Asterope', 'Atlas', 'Pleione', 'Ain'],
    'Géminis': ['Castor', 'Pollux', 'Alhena', 'Wasat', 'Mebsuta', 'Tejat', 'Propus', 'Alzirr'],
    'Auriga': ['Capella', 'Menkalinan', 'Almaaz', 'Hassaleh'],
    'Lira': ['Vega', 'Sheliak', 'Sulafat'],
    'Águila': ['Altair', 'Tarazed', 'Alshain'],
    'Cisne': ['Deneb', 'Albireo', 'Sadr', 'Gienah', 'Fawaris'],
    'Boyero': ['Arcturus', 'Izar', 'Muphrid', 'Seginus', 'Nekkar'],
    'Virgo': ['Spica', 'Porrima', 'Vindemiatrix', 'Heze', 'Zaniah', 'Syrma'],
    'Leo': ['Regulus', 'Denebola', 'Algieba', 'Zosma', 'Chertan', 'Adhafera', 'Rasalas'],
    'Escorpio': ['Antares', 'Shaula', 'Sargas', 'Dschubba', 'Acrab', 'Lesath', 'Larawag'],
    'Osa Menor': ['Polaris', 'Kochab', 'Pherkad', 'Yildun'],
    'Osa Mayor': ['Dubhe', 'Merak', 'Phecda', 'Megrez', 'Alioth', 'Mizar', 'Alcor', 'Alkaid',
                  'Talitha', 'Tania'],
    'Casiopea': ['Schedar', 'Caph', 'Ruchbah', 'Segin', 'Achird'],
    'Perseo': ['Mirfak', 'Algol', 'Menkib', 'Atik'],
    'Andrómeda': ['Alpheratz', 'Mirach', 'Almach'],
    'Pegaso': ['Markab', 'Scheat', 'Algenib', 'Enif', 'Homam', 'Matar'],
    'Pez Austral': ['Fomalhaut'],
    'Quilla': ['Canopus', 'Miaplacidus', 'Avior', 'Aspidiske'],
    'Erídano': ['Achernar', 'Cursa', 'Zaurak', 'Acamar'],
    'Cruz del Sur': ['Acrux', 'Mimosa', 'Gacrux', 'Imai'],
    'Centauro': ['RigilKentaurus', 'Toliman', 'Hadar', 'Menkent'],
    'Hidra': ['Alphard'],
    'Dragón': ['Thuban', 'Eltanin', 'Rastaban', 'Edasich', 'Giausar'],
    'Ofiuco': ['Rasalhague', 'Sabik', 'Cebalrai', 'Yed-Prior'],
    'Hércules': ['Rasalgethi', 'Kornephoros', 'Sarin'],
    'Sagitario': ['Nunki', 'Ascella', 'Kaus-Australis', 'Alnasl', 'Rukbat', 'Arkab', 'Polis'],
    'Aries': ['Hamal', 'Sheratan', 'Mesarthim'],
    'Ballena': ['Menkar', 'Diphda', 'Mira', 'Kaffaljidhma'],
    'Corona Boreal': ['Alphecca', 'Nusakan'],
    'Libra': ['Zubenelgenubi', 'Zubeneschamali', 'Brachium'],
    'Acuario': ['Sadalmelik', 'Sadalsuud', 'Skat', 'Albali'],
    'Capricornio': ['Nashira', 'Dabih', 'Algedi'],
    'Piscis': ['Alrescha'],
    'Pavo': ['Peacock'],
    'Grulla': ['Alnair'],
    'Triángulo Austral': ['Atria'],
    'Vela': ['Suhail'],
    'Popa': ['Naos'],
    'Perros de Caza': ['Cor-Caroli'],
    'Delfín': ['Sualocin', 'Rotanev'],
    'Cefeo': ['Alderamin', 'Errai'],
    'Fénix': ['Ankaa'],
    'Serpiente': ['Unukalhai'],
    'Cuervo': ['Algorab', 'Kraz', 'Minkar'],
    'Copa': ['Alkes'],
}
CONSTELLATION = {star: name for name, stars in STARS.items() for star in stars}
ALL_STARS = list(CONSTELLATION)

PHRASES = [
    'brillando fuerte esta noche ✨',
    'saludos desde {const}, acá todo tranqui',
    '¿alguien más ve esa nebulosa?',
    'mi luz tarda años en llegar, perdón la demora',
    'hoy roté más rápido que un púlsar',
    '{otra} me debe plata desde el Big Bang',
    '¿esto es una constelación o un grupo de WhatsApp?',
    'fusión nuclear al 100% 🔥',
    'transmitiendo desde el brazo de Orión',
    '¿alguien tiene un agujero negro de repuesto?',
    'nos vemos en el próximo eclipse 🌑',
    'creo que me estoy por convertir en supernova',
    '{otra}, bajá el brillo que encandilás',
    'acá en {const} no llega ni el wifi',
    'soy una enana blanca y estoy orgullosa',
    'pasaba por la Vía Láctea y dije hola 👋',
]


def nicknames(count):
    """Nombres únicos: primero los de las estrellas y, si no alcanzan, con número."""
    names = []
    round_ = 1
    while len(names) < count:
        for star in ALL_STARS:
            names.append(star if round_ == 1 else f'{star}-{round_}'[:20])
            if len(names) == count:
                break
        round_ += 1
    random.shuffle(names)
    return names


def percentile(values, p):
    if not values:
        return float('nan')
    ordered = sorted(values)
    k = min(len(ordered) - 1, max(0, round(p / 100 * (len(ordered) - 1))))
    return ordered[k]


class Stats:
    def __init__(self):
        self.connected = 0
        self.failed = Counter()
        self.connect_ms = []
        self.sent = 0
        self.delivered = 0
        self.latency_ms = []
        self.server_errors = Counter()
        self.dropped = 0
        self.max_in_room = 0


# ------------------------------------------------------------------ un usuario

async def user(nick, args, stats, ctx, chat_start, stop):
    started = time.perf_counter()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(args.host, args.port, ssl=ctx, limit=2 ** 23), timeout=20
        )
    except Exception as err:  # noqa: BLE001 - se registra el motivo, sea cual sea
        stats.failed[f'conexión: {type(err).__name__}'] += 1
        return

    if ctx and args.fp:
        der = writer.get_extra_info('ssl_object').getpeercert(binary_form=True)
        real = hashlib.sha256(der).hexdigest().upper()
        wanted = ''.join(ch for ch in args.fp.upper() if ch in '0123456789ABCDEF')
        if not real.startswith(wanted):
            stats.failed['huella del servidor distinta'] += 1
            writer.close()
            return

    def send(obj):
        writer.write((json.dumps(obj, ensure_ascii=False) + '\n').encode('utf-8'))

    welcomed = asyncio.Event()
    pending = {}  # id del mensaje → momento de envío
    state = {'nick': nick, 'room': None, 'tries': 0}

    def hello():
        msg = {'type': 'hello', 'nick': state['nick']}
        if args.password:
            msg['password'] = args.password
        send(msg)

    async def read_loop():
        while True:
            try:
                raw = await reader.readline()
            except Exception:  # noqa: BLE001
                break
            if not raw:
                break
            # Atajo: los mensajes de otros solo se cuentan, sin decodificar. Con 500
            # usuarios llegan decenas de miles por segundo y decodificarlos todos hace
            # que el propio script sea el cuello de botella (y ensucie la latencia).
            if raw.startswith(b'{"type":"chat"') and f'"from":"{state["nick"]}"'.encode() not in raw:
                stats.delivered += 1
                continue
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            kind = m.get('type')
            if kind == 'welcome':
                stats.connected += 1
                stats.connect_ms.append((time.perf_counter() - started) * 1000)
                state['nick'] = m.get('nick', state['nick'])
                if args.room != 'general':
                    send({'type': 'line', 'text': f'/join {args.room}'})
                welcomed.set()
            elif kind == 'password_required':
                if not args.password:
                    stats.failed['el servidor pide contraseña (--password)'] += 1
                    break
                hello()
            elif kind == 'nick_rejected':
                state['tries'] += 1
                if state['tries'] > 5:
                    stats.failed['nick rechazado'] += 1
                    break
                state['nick'] = f"{nick[:14]}-{random.randint(100, 999)}"
                hello()
            elif kind == 'state':
                state['room'] = m.get('room')
            elif kind == 'roster':
                stats.max_in_room = max(stats.max_in_room, len(m.get('users', [])))
            elif kind == 'chat':
                stats.delivered += 1
                if m.get('from') == state['nick']:
                    tag = m.get('text', '').rsplit('·', 1)[-1]
                    sent_at = pending.pop(tag, None)
                    if sent_at is not None:
                        stats.latency_ms.append((time.perf_counter() - sent_at) * 1000)
            elif kind == 'error':
                stats.server_errors[m.get('text', '?')] += 1
            elif kind == 'fatal':
                stats.server_errors['fatal: ' + m.get('text', '?')] += 1
                break

    reading = asyncio.create_task(read_loop())
    hello()
    try:
        await asyncio.wait_for(welcomed.wait(), timeout=60)
    except asyncio.TimeoutError:
        stats.failed['sin bienvenida en 60 s'] += 1
        reading.cancel()
        writer.close()
        return

    await chat_start.wait()
    counter = 0
    while not stop.is_set() and not reading.done():
        try:
            await asyncio.wait_for(stop.wait(), timeout=random.expovariate(1 / args.interval))
            break
        except asyncio.TimeoutError:
            pass
        counter += 1
        tag = f'{state["nick"]}#{counter}'
        phrase = random.choice(PHRASES).format(
            const=CONSTELLATION.get(nick.split('-')[0], 'algún lugar'), otra=random.choice(ALL_STARS)
        )
        pending[tag] = time.perf_counter()
        send({'type': 'line', 'text': f'{phrase} ·{tag}'})
        stats.sent += 1
        try:
            await writer.drain()
        except Exception:  # noqa: BLE001
            break

    await asyncio.sleep(args.grace)  # dar tiempo a que lleguen los últimos ecos
    stats.dropped += len(pending)
    try:
        send({'type': 'line', 'text': '/quit volviendo a mi galaxia'})
        await writer.drain()
        writer.close()
    except Exception:  # noqa: BLE001
        pass
    reading.cancel()


# ------------------------------------------------------------------ orquestación

def progress(stats, total, phase, started):
    lat = stats.latency_ms[-2000:]
    line = (
        f'\r[{time.perf_counter() - started:5.0f}s] {phase:<10} '
        f'conectados {stats.connected}/{total} · enviados {stats.sent} · '
        f'entregas {stats.delivered} · lat p50 {percentile(lat, 50):.0f} ms '
        f'p95 {percentile(lat, 95):.0f} ms · errores {sum(stats.server_errors.values())}   '
    )
    sys.stdout.write(line)
    sys.stdout.flush()


async def main(args):
    ctx = None
    if args.tls:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # certificado autofirmado: la confianza la da --fp

    stats = Stats()
    names = nicknames(args.users)
    chat_start = asyncio.Event()
    stop = asyncio.Event()
    started = time.perf_counter()
    phase = {'name': 'entrando'}

    async def ticker():
        while True:
            progress(stats, args.users, phase['name'], started)
            await asyncio.sleep(1)

    tick = asyncio.create_task(ticker())
    tasks = []
    for i, nick in enumerate(names):
        tasks.append(asyncio.create_task(user(nick, args, stats, ctx, chat_start, stop)))
        if (i + 1) % args.ramp == 0:
            await asyncio.sleep(1)

    # Esperar a que entren todos (o a que no entre nadie más).
    last, still = -1, 0
    while stats.connected + sum(stats.failed.values()) < args.users and still < 10:
        await asyncio.sleep(1)
        still = still + 1 if stats.connected == last else 0
        last = stats.connected
    ramp_seconds = time.perf_counter() - started

    phase['name'] = 'charlando'
    chat_start.set()
    await asyncio.sleep(args.duration)
    phase['name'] = 'saliendo'
    stop.set()
    await asyncio.gather(*tasks, return_exceptions=True)
    tick.cancel()
    progress(stats, args.users, 'fin', started)
    report(stats, args, ramp_seconds)


def report(stats, args, ramp_seconds):
    def ms(values, p):
        return f'{percentile(values, p):.0f} ms' if values else '—'

    expected = stats.sent * max(stats.max_in_room, 1)
    print('\n')
    print('━━━ RESULTADO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print(f'servidor        {args.host}:{args.port}  sala #{args.room}  {"TLS" if args.tls else "sin TLS"}')
    print(f'usuarios        {args.users} pedidos · {stats.connected} conectados · '
          f'{sum(stats.failed.values())} fallidos · máx. {stats.max_in_room} en la sala')
    for reason, n in stats.failed.most_common():
        print(f'                  ✖ {n} × {reason}')
    print(f'entrada         todos adentro en {ramp_seconds:.1f} s · '
          f'p50 {ms(stats.connect_ms, 50)} · p95 {ms(stats.connect_ms, 95)} · máx {ms(stats.connect_ms, 100)}')
    print(f'mensajes        {stats.sent} enviados en {args.duration} s '
          f'({stats.sent / max(args.duration, 1):.1f}/s)')
    print(f'entregas        {stats.delivered} recibidas · ~{expected} esperadas '
          f'({stats.delivered / max(expected, 1) * 100:.1f}%)')
    print(f'latencia        p50 {ms(stats.latency_ms, 50)} · p95 {ms(stats.latency_ms, 95)} · '
          f'p99 {ms(stats.latency_ms, 99)} · máx {ms(stats.latency_ms, 100)}')
    print(f'perdidos        {stats.dropped} mensajes propios sin eco')
    if stats.server_errors:
        print('errores         ' + '\n                '.join(f'{n} × {t}' for t, n in stats.server_errors.most_common(5)))


def parse_args():
    p = argparse.ArgumentParser(description='Prueba de carga para clichat (usuarios con nombres de estrellas).')
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=5555)
    p.add_argument('--users', type=int, default=500, help='usuarios simultáneos (500)')
    p.add_argument('--room', default='general', help='sala donde charlan (general)')
    p.add_argument('--duration', type=int, default=60, help='segundos charlando (60)')
    p.add_argument('--interval', type=float, default=10, help='segundos promedio entre mensajes de cada usuario (10)')
    p.add_argument('--ramp', type=int, default=100, help='usuarios nuevos por segundo al entrar (100)')
    p.add_argument('--grace', type=float, default=3, help='segundos para esperar los últimos ecos (3)')
    p.add_argument('--password', help='contraseña del chat, si tiene')
    p.add_argument('--tls', action='store_true', help='conectar con TLS')
    p.add_argument('--fp', help='huella esperada del servidor (con --tls)')
    return p.parse_args()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        asyncio.run(main(parse_args()))
    except KeyboardInterrupt:
        print('\ncancelado')
