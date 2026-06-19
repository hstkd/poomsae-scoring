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

## Notas de mantenimiento

- `node_modules/` y `package-lock.json` se versionan **a propósito** para el
  arranque offline. Si actualizas dependencias (`npm install`), vuelve a
  confirmar esos cambios.
- `npm run check` hace una verificación rápida de sintaxis de `server.js`.
