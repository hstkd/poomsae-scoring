// Genera el Manual de Ingreso en PDF (estilo HSTKD).
const PDFDocument = require('pdfkit');
const fs = require('fs');

const GOLD = '#b8860b';
const DARK = '#1a1a1a';
const GRAY = '#555555';
const LIGHT = '#8a6d12';
const BG = '#f4f1e9';

const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
const OUT = 'Manual-Ingreso-HSTKD.pdf';
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width;
const M = 54;
const CW = W - M * 2;

function band(title) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.4);
  const y = doc.y;
  doc.save().rect(M, y, CW, 26).fill(GOLD).restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text(title, M + 10, y + 6);
  doc.fillColor(DARK).font('Helvetica').fontSize(11);
  doc.y = y + 36;
}

function step(n, txt) {
  const y = doc.y;
  doc.save().circle(M + 8, y + 6, 8).fill(GOLD).restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(String(n), M + 4.5, y + 1.5);
  doc.fillColor(DARK).font('Helvetica').fontSize(11).text(txt, M + 26, y, { width: CW - 26 });
  doc.moveDown(0.5);
}

function bullet(txt) {
  doc.fillColor(GOLD).font('Helvetica-Bold').text('•', M + 4, doc.y, { continued: true });
  doc.fillColor(DARK).font('Helvetica').text('  ' + txt, { width: CW - 10 });
  doc.moveDown(0.2);
}

function note(label, txt) {
  const y = doc.y;
  doc.save().rect(M, y, CW, 0).restore();
  const startY = y;
  doc.fillColor(DARK).font('Helvetica').fontSize(10.5);
  const h = doc.heightOfString(txt, { width: CW - 70 }) + 16;
  doc.save().rect(M, startY, CW, h).fill('#fbf6e8').restore();
  doc.save().rect(M, startY, 4, h).fill(GOLD).restore();
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10.5).text(label, M + 14, startY + 8, { continued: true });
  doc.fillColor(DARK).font('Helvetica').text('  ' + txt, { width: CW - 70 });
  doc.y = startY + h + 8;
}

function code(txt) {
  const y = doc.y;
  const h = 22;
  doc.save().rect(M + 20, y, CW - 40, h).fill('#11140f').restore();
  doc.fillColor('#e8c860').font('Courier-Bold').fontSize(11).text(txt, M + 30, y + 6);
  doc.fillColor(DARK).font('Helvetica').fontSize(11);
  doc.y = y + h + 8;
}

// ───────── PORTADA ─────────
doc.save().rect(0, 0, W, doc.page.height).fill(BG).restore();
doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(58).text('POOMSAE', M, 150, { characterSpacing: 8, align: 'center', width: CW });
doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(12).text('SISTEMA DE CALIFICACIÓN', { characterSpacing: 4, align: 'center', width: CW });
doc.moveDown(2.5);
doc.fillColor(DARK).font('Helvetica-Bold').fontSize(26).text('Manual de Ingreso', { align: 'center', width: CW });
doc.moveDown(0.3);
doc.fillColor(GRAY).font('Helvetica').fontSize(13).text('Guía rápida para usar el sistema en los eventos', { align: 'center', width: CW });
doc.save().moveTo(M + 120, doc.y + 26).lineTo(W - M - 120, doc.y + 26).lineWidth(2).stroke(GOLD).restore();
doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(12).text('Henry Sigchos Taekwondo · HSTKD', M, doc.page.height - 90, { align: 'center', width: CW });
doc.addPage();
doc.save().rect(0, 0, W, doc.page.height).fill('#ffffff').restore();

// ───────── 1. QUÉ NECESITAS ─────────
band('1.  Qué necesitas');
bullet('Una computadora con el sistema instalado (será el "servidor").');
bullet('Un router WiFi (solo enchufado a la luz; no necesita internet).');
bullet('Los celulares de los jueces, conectados a esa misma WiFi.');
note('Sin internet:', 'El sistema funciona en red local. El router solo necesita estar encendido para que los aparatos se conecten entre sí.');

// ───────── 2. ENCENDER ─────────
band('2.  Encender el sistema (operador)');
step(1, 'Enciende el router (solo a la luz; no necesita internet) y conecta la computadora a su red WiFi.');
step(2, 'Abre la carpeta del sistema. Es la que contiene juntos: "server.js", la carpeta "public" y la carpeta "node_modules". Esa es la carpeta correcta.');
step(3, 'Dentro de esa carpeta, haz clic en la barra de direccion (arriba), escribe "cmd" y presiona Enter. Usa cmd, NO PowerShell.');
step(4, 'En la ventana negra escribe el siguiente comando y presiona Enter:');
code('node server.js');
step(5, 'Cuando veas "Servidor en puerto 3000", ya esta encendido. NO cierres esa ventana.');
step(6, 'Anota la direccion IP: abre otra ventana "cmd", escribe "ipconfig" y busca "Direccion IPv4" (ej. 192.168.1.45).');
note('Si dice "Cannot find module server.js":', 'estas en la carpeta equivocada. Entra a la subcarpeta que contiene server.js y public, y abre cmd ahi (paso 3).');
note('Importante:', 'Deja la ventana negra abierta durante todo el evento. Para apagar el sistema: presiona Ctrl + C en esa ventana.');

// ───────── 3. INGRESO DEL ADMINISTRADOR / MESA ─────────
band('3.  Ingreso del administrador (mesa)');
step(1, 'En la computadora abre el navegador (Chrome) y entra a:');
code('localhost:3000');
step(2, 'Inicia sesión con el usuario "admin" y su contraseña.');
step(3, 'La primera vez se activa la licencia (pegar el código que te entregó el proveedor). Queda guardada.');
step(4, 'Para la competencia, abre "Mesa Competencia", crea la sala y anota el CÓDIGO DE SALA (ej. FINAL1).');

doc.addPage();

// ───────── 4. CREAR / GESTIONAR JUECES ─────────
band('4.  Crear y gestionar los jueces');
step(1, 'Entra a "Administración" (visible para el admin).');
step(2, 'Crea un usuario por cada juez: nombre de usuario, contraseña (mínimo 6 caracteres) y rol "Juez". Pulsa GUARDAR.');
step(3, 'Para cambiar una contraseña: escribe el mismo usuario, la nueva contraseña y GUARDAR.');
step(4, 'Para quitar a un juez: "Eliminar". Para suspenderlo temporalmente: "Deshabilitar".');
note('Recuerda:', 'Los jueces quedan guardados entre eventos. Anota usuario y contraseña de cada uno: es lo que escribirán en su celular.');

// ───────── 5. INGRESO DE LOS JUECES ─────────
band('5.  Ingreso de los jueces (celular)');
step(1, 'Conecta el celular a la MISMA WiFi del router (opcional: deja los datos móviles encendidos para tener internet).');
step(2, 'En el navegador del celular escribe la IP de la computadora con ":3000". Ejemplo:');
code('http://192.168.1.45:3000');
step(3, 'Inicia sesión con el usuario y contraseña del juez.');
step(4, 'Escribe el CÓDIGO DE SALA y el número de juez. ¡Listo para calificar!');
note('Si el juez sale a otra app:', 'Al volver, reingresa automáticamente a la sala. Si no, que actualice la página y vuelva a entrar.');

// ───────── 6. PROBLEMAS COMUNES ─────────
band('6.  Problemas comunes');
bullet('El juez no entra: revisa que esté en la MISMA WiFi y que use la IP 192.168... (no "localhost"), con ":3000".');
bullet('Windows preguntó por el Firewall: dale "Permitir acceso" a Node.');
bullet('La página no abre: confirma que la ventana negra siga diciendo "Servidor en puerto 3000".');
bullet('Olvidaste la contraseña de un juez: crea de nuevo el mismo usuario con una contraseña nueva.');

// ───────── 7. NOTAS IMPORTANTES ─────────
band('7.  Notas importantes');
bullet('Licencia: tiene fecha de vencimiento. Al vencer, el sistema se bloquea hasta instalar una nueva.');
bullet('Usuario y contraseña: no cambian ni vencen solos; se quedan hasta que tú los cambies.');
bullet('Sesión: por seguridad dura 1 día. Al día siguiente cada juez vuelve a iniciar sesión (con la misma contraseña).');
bullet('Al actualizar el sistema, los usuarios y la licencia se conservan (carpeta "data").');

// pie de página en todas menos la portada
const range = doc.bufferedPageRange ? null : null;
doc.end();
console.log('PDF generado:', OUT);
