// Genera la guía corta "Cómo Rentar" en PDF (para el proveedor).
const PDFDocument = require('pdfkit');
const fs = require('fs');

const GOLD = '#b8860b';
const DARK = '#1a1a1a';
const GRAY = '#555555';

const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
const OUT = 'Guia-Como-Rentar-HSTKD.pdf';
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
  doc.fillColor('#e8c860').font('Courier-Bold').fontSize(10.5).text(txt, M + 26, y + 6, { width: CW - 52 });
  doc.fillColor(DARK).font('Helvetica').fontSize(11);
  doc.y = y + h + 8;
}

// ── Encabezado ──
doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(26).text('Cómo Rentar el Sistema', M, 56);
doc.fillColor(GRAY).font('Helvetica').fontSize(11).text('Guía rápida para el proveedor · Poomsae Scoring · HSTKD', { width: CW });
doc.save().moveTo(M, doc.y + 8).lineTo(W - M, doc.y + 8).lineWidth(2).stroke(GOLD).restore();
doc.moveDown(1.2);

// ── 1. Cómo funciona ──
band('Cómo funciona');
bullet('Una licencia es un texto firmado con TU llave que caduca en los días que tú elijas.');
bullet('Cuando vence, el sistema del cliente se bloquea solo. No tienes que hacer nada al final.');
bullet('Todo se controla con tu llave maestra (carpeta "vendor"). Respáldala y nunca la compartas.');

// ── 2. Preparar el paquete (una vez) ──
band('Preparar el paquete (una sola vez)');
step(1, 'Si aún no la tienes, crea tu clave:');
code('node tools/licencia.js init');
step(2, 'Crea el paquete protegido (codigo no editable, con tu clave embebida):');
code('npm run build');
step(3, 'Se crea la carpeta "dist". Esa es la que entregas al cliente: es la misma para todos.');
note('Importante:', 'el paquete se construye una sola vez. Por cada renta solo cambias la licencia (el texto).');

// ── 3. Por cada renta ──
band('Por cada renta (3 pasos)');
step(1, 'Genera la licencia con los días pagados (ejemplo: 3 días):');
code('node tools/licencia.js generar --cliente "Club Tigres" --dias 3');
step(2, 'Copia el texto largo que aparece y envíalo al cliente (WhatsApp, correo).');
step(3, 'El cliente lo pega en la pantalla "Licencia" y pulsa ACTIVAR. Le funciona esos días.');
note('Duraciones:', '3 días = --dias 3   ·   1 semana = --dias 7   ·   1 mes = --dias 30   ·   para ti = --dias 3650');

// ── 4. Renovar / extender ──
band('Renovar o extender');
bullet('Genera otra licencia nueva con más días y envíala; el cliente la pega encima. Listo.');
bullet('Para ver cuándo vence una licencia:');
code('node tools/licencia.js ver "PEGA-AQUI-LA-LICENCIA"');

// ── 5. Importante ──
band('A tener en cuenta');
bullet('Caduca sola: para rentas cortas no haces nada al vencer.');
bullet('No se puede apagar a distancia antes de que venza (se valida sin internet).');
bullet('La licencia no está atada a una computadora: el cliente podría usarla en más de una PC durante esos días.');
bullet('Respalda la carpeta "vendor" (tu llave maestra). Sin ella no puedes emitir ni renovar licencias.');

doc.end();
console.log('PDF generado:', OUT);
