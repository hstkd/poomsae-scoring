# Poomsae Scoring · HSTKD

Sistema de calificación de poomsae (taekwondo) en tiempo real con Socket.IO.
Pensado para funcionar en una **red local sin Internet** durante el torneo.

Roles (cada uno es una página):

- **Mesa de competencia** (`/mesa.html`): 1v1 simultáneo, secuencial y cut-off.
- **Mesa de liga** (`/liga.html`): carga por Excel y corrida continua por grupos.
- **Juez** (`/juez.html`): califica desde el móvil.
- **Pantalla** (`/pantalla.html`): resultados para el público (con modo claro/oscuro).

## Funciona sin Internet

Todos los recursos se sirven desde el propio servidor: tipografías
(`public/fonts/`), la librería de Excel (`public/vendor/xlsx.full.min.js`)
y el cliente de Socket.IO. Además, las dependencias del servidor
(`express`, `socket.io`) están **versionadas en `node_modules/`**, así que el
servidor arranca sin necesidad de `npm install` ni conexión a Internet.

## Arranque (en el torneo, sin Internet)

En el computador que hará de servidor:

```bash
npm start          # o bien: node server.js
```

Por defecto escucha en el puerto **3000** (configurable con la variable de
entorno `PORT`).

Luego, desde cada dispositivo (jueces, pantalla) conectado a la **misma red
WiFi/LAN**, abre en el navegador:

```
http://IP-DEL-SERVIDOR:3000
```

> Para saber la IP del servidor: en Windows `ipconfig`, en macOS/Linux
> `ifconfig` o `ip a` (suele ser algo como `192.168.x.x`).

## Requisitos

- **Node.js 18 o superior** instalado en el computador servidor.

No se requiere ningún otro paso de instalación: el repositorio ya incluye
todo lo necesario para ejecutarse offline.

## Acceso (autenticación)

Todo exige iniciar sesión; el link por sí solo no da acceso. Al primer
arranque se crea un usuario `admin` y su contraseña se imprime en la consola.
Entra a `/admin.html` para crear y habilitar/deshabilitar a los usuarios
(roles: `admin`, `mesa`, `juez`, `pantalla`). Deshabilitar un usuario revoca
su sesión de inmediato.

## Licenciamiento (solo el PROVEEDOR)

El sistema no funciona sin una licencia válida firmada por el proveedor.

1. **Una sola vez**, crea tu par de claves:
   ```bash
   node tools/licencia.js init        # usa --force si ya existe una (p. ej. la demo)
   ```
   - `vendor/clave-privada.pem` → **tu llave maestra**: guárdala en secreto y
     respáldala; con ella firmas las licencias. NO se versiona.
   - `data/license-public.pem` → tu clave pública. Tiene **prioridad** sobre la
     de demostración del repositorio y **se conserva al actualizar** (la carpeta
     `data/` no se borra con `git pull`).
2. Emite una licencia:
   ```bash
   node tools/licencia.js generar --cliente "ESCUELA X" --dias 365
   ```
   Entrega ese texto al cliente (o, para tu propio uso, hazla de larga duración).
3. Se pega en **`/licencia.html`** (o el admin en su panel) para activarla. La
   licencia vence; para renovar, emite una nueva. Si no la renuevas, la
   instalación queda bloqueada (control de acceso del proveedor).

> El repositorio incluye una **clave pública de demostración** (`license-public.pem`)
> para probar de inmediato. Al ejecutar `init`, tu clave queda en
> `data/license-public.pem` y manda sobre la demo. **Respalda `vendor/` y `data/`**:
> son tu llave maestra y tus datos (usuarios + licencia).

> ⚠️ En modelo autohospedado el cliente tiene el código del servidor (Node) y
> podría editarlo para saltar la validación. El blindaje fuerte contra eso
> (empaquetado binario / ofuscación del servidor) corresponde a la Fase 3.

## Paquete protegido (build para entregar al cliente)

Para no entregar el código fuente legible, genera un paquete con el servidor
compilado a **bytecode** y el cliente **minificado**:

```bash
npm install        # una vez, con Internet (trae las herramientas de build)
npm run build      # genera dist/
```

`dist/` contiene `server.jsc/auth.jsc/license.jsc` (bytecode, no editable como
texto), el cliente con el JS minificado, `node_modules`, la clave pública y un
`package.json` de producción. Entrega **esa carpeta** al cliente:

```bash
cd dist && node server.js
```

> El bytecode requiere ejecutarse con la **misma versión mayor de Node** con la
> que se construyó. Honestamente, el bytecode y la minificación **dificultan**
> mucho leer o alterar el código, pero no son cifrado: un atacante muy decidido
> podría revertirlos. Suben el listón a un nivel razonable para producto comercial.

## Notas de mantenimiento

- `node_modules/` y `package-lock.json` se versionan **a propósito** para el
  arranque offline. Si actualizas dependencias (`npm install`), vuelve a
  confirmar esos cambios.
- `npm run check` hace una verificación rápida de sintaxis de `server.js`.
