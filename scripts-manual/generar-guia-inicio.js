// Genera la guía rápida de inicio (para arrancar desde la computadora, con git).
const PDFDocument = require('pdfkit');
const fs = require('fs');

const GOLD = '#b8860b';
const DARK = '#1a1a1a';
const GRAY = '#555555';

const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
const OUT = 'Guia-Inicio-Rapido-HSTKD.pdf';
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width;
const M = 54;
const CW = W - M * 2;

function band(title) {
  if (doc.y > doc.page.height - 130) doc.addPage();
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
  const startY = doc.y;
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
  doc.save().rect(M + 16, y, CW - 32, h).fill('#11140f').restore();
  doc.fillColor('#e8c860').font('Courier-Bold').fontSize(11).text(txt, M + 26, y + 6, { width: CW - 52 });
  doc.fillColor(DARK).font('Helvetica').fontSize(11);
  doc.y = y + h + 8;
}

// ── Encabezado ──
doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(26).text('Cómo Iniciar el Sistema', M, 56);
doc.fillColor(GRAY).font('Helvetica').fontSize(11).text('Guía rápida · desde tu computadora · Poomsae Scoring · HSTKD', { width: CW });
doc.save().moveTo(M, doc.y + 8).lineTo(W - M, doc.y + 8).lineWidth(2).stroke(GOLD).restore();
doc.moveDown(1.2);

// ── 1. Encender ──
band('1.  Encender el sistema');
step(1, 'Enciende el router (solo a la luz; no necesita internet) y conecta la computadora a su WiFi.');
step(2, 'Abre la carpeta "poomsae-scoring" (la que clonaste con git).');
step(3, 'Haz clic en la barra de direccion (arriba), escribe "cmd" y presiona Enter.');
step(4, 'Escribe el comando y Enter:');
code('node server.js');
step(5, 'Espera a ver "Servidor en puerto 3000". NO cierres esa ventana.');
note('Si dice "Cannot find module server.js":', 'estas en la carpeta equivocada. Abre la carpeta que contiene server.js y public, y abre cmd ahi.');

// ── 2. Entrar tú (mesa) ──
band('2.  Entrar tú (mesa)');
step(1, 'En el navegador de la computadora entra a:');
code('localhost:3000');
step(2, 'Inicia sesion como "admin" con tu contraseña.');
step(3, 'Abre "Mesa Competencia", crea la sala y anota el CODIGO DE SALA.');
note('Licencia:', 'ya quedo activada; no tienes que volver a ponerla.');

// ── 3. Conectar a los jueces ──
band('3.  Conectar a los jueces (celular)');
step(1, 'Averigua la IP: abre otra ventana "cmd", escribe "ipconfig" y busca "Direccion IPv4" (ej. 192.168.1.45).');
step(2, 'Cada juez, en la MISMA WiFi, entra en su celular a:');
code('http://192.168.1.45:3000');
step(3, 'Inicia sesion con su usuario y clave, y escribe el CODIGO DE SALA y su numero de juez.');

// ── 4. Comandos útiles ──
band('4.  Comandos útiles');
bullet('Apagar el sistema: en la ventana negra, presiona Ctrl + C.');
bullet('Volver a encender: node server.js');
bullet('Actualizar a la ultima version (sin perder tus datos): git pull  y luego  node server.js');
note('Tus datos:', 'usuarios, licencia y tu clave se conservan siempre (viven en las carpetas data y vendor).');

doc.end();
console.log('PDF generado:', OUT);
