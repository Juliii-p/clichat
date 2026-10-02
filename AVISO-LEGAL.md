# Aviso legal y uso responsable

CLI-Chat es software libre bajo la [licencia MIT](LICENSE). Este aviso **no
modifica** esa licencia: explica en lenguaje claro lo que ella ya establece y
deja asentadas las responsabilidades de quien usa el programa.

## Sin garantías ni responsabilidad de los autores

El software se entrega **"tal cual"**, sin garantías de ningún tipo. En la
máxima medida que permita la ley aplicable, **los autores y colaboradores no
son responsables** de daños, reclamos, pérdidas ni consecuencias de ningún tipo
derivados del uso, del mal uso o de la imposibilidad de usar CLI-Chat. Esto
incluye el uso que terceros hagan de copias, versiones modificadas o
distribuciones del programa.

## Responsabilidad de quien lo usa

Quien instala, ejecuta, levanta un servidor o distribuye CLI-Chat:

- es el **único responsable** de cómo lo usa y de los contenidos que transmite;
- debe cumplir las leyes de su jurisdicción, en especial las de protección de
  datos personales, privacidad, interceptación de comunicaciones, uso de
  cifrado y exportación de software criptográfico;
- debe tener autorización para usar las redes y los equipos donde lo ejecuta;
- si activa el registro (`--log`), es responsable de informar a los
  participantes y de tratar esos datos conforme a la ley. CLI-Chat avisa
  automáticamente a quien entra, pero ese aviso no reemplaza las obligaciones
  legales de quien registra.

Los autores **no promueven, no avalan y no se hacen responsables** de usos
ilícitos, como el acoso, el fraude, la difusión de contenidos ilegales o la
coordinación de delitos.

## Qué protege el cifrado, y qué no

CLI-Chat ofrece cifrado opcional de la conexión (`--tls`) y cifrado de extremo a
extremo con clave compartida (`--e2e`). Aun así:

- **No es una herramienta de anonimato.** Quien levanta el servidor ve las
  direcciones IP, los nicks, las salas, los horarios y el tamaño de los
  mensajes. Las redes intermedias (por ejemplo, Tailscale o un proveedor de
  internet) pueden registrar quién se conecta con quién.
- Con una clave compartida, cualquiera que la tenga puede leer todos los
  mensajes y escribir haciéndose pasar por otro participante.
- La seguridad depende de que los equipos de los participantes no estén
  comprometidos y de que la clave se comparta por un medio seguro.
- El código no fue auditado por terceros. No se ofrece garantía de que esté
  libre de fallas de seguridad.

## Esto no es asesoramiento legal

Este aviso es informativo. Si vas a usar CLI-Chat en un contexto con
consecuencias legales, como una empresa, un servicio ofrecido a terceros o
datos sensibles, consulta con un profesional del derecho de tu jurisdicción.

---

*English summary:* CLI-Chat is provided "as is" under the MIT License, without
warranty of any kind. To the maximum extent permitted by law, the authors and
contributors are not liable for any use or misuse of the software. Users are
solely responsible for complying with applicable laws, including those on
privacy, interception, encryption, and export. CLI-Chat is not an anonymity tool,
and this notice is not legal advice.
