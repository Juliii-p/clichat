# Cómo contribuir

¡Gracias por querer mejorar CLI-Chat!

## Antes de abrir un PR

1. Abre un issue para hablar de cambios grandes antes de programarlos.
2. Ejecuta `npm test`: tiene que pasar en Node 18, 20 y 22.
3. Agrega o ajusta los tests de `test/` si cambias el comportamiento del servidor.

## Principios del proyecto

- **Cero dependencias.** Solo la biblioteca estándar de Node.js. Así se instala
  en segundos en cualquier lado, incluso en Termux.
- **Pensado para teléfonos.** Los textos de ayuda y los mensajes del sistema
  deben leerse bien con unas 40 columnas.
- **El servidor no confía en nadie.** Todo texto que llega de la red se limpia
  antes de reenviarlo. Ningún cliente debe poder controlar la terminal de otro.
- **Protocolo estable.** Si cambias [docs/PROTOCOL.md](docs/PROTOCOL.md), mantén
  la compatibilidad con clientes viejos o súbele la versión.
- Estilo: el del código existente (2 espacios, comillas simples, `'use strict'`).

## Ideas para empezar

- Persistir el historial en disco.
- Soporte de mouse en la TUI (rueda para recorrer el historial).
- Reconexión automática si se cae la red.
- Clientes en otros lenguajes, bots o un puente a la web.
