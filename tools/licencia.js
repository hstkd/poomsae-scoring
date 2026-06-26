#!/usr/bin/env node
// ── HERRAMIENTA DEL PROVEEDOR: generar par de claves y emitir licencias ──
//
//   node tools/licencia.js init                 → crea el par de claves (una sola vez)
//   node tools/licencia.js generar --cliente "ESCUELA X" --dias 365
//   node tools/licencia.js ver "<licencia>"     → inspecciona una licencia
//
// La clave PRIVADA (vendor/clave-privada.pem) NUNCA se versiona ni se comparte:
// con ella se firman las licencias. La PÚBLICA (license-public.pem) viaja con
// el producto. Si pierdes la privada, no podrás emitir más licencias.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRIV = path.join(ROOT, 'vendor', 'clave-privada.pem');
// La clave pública propia va en data/ (no versionada): tiene prioridad sobre la
// demo del repositorio y se conserva al actualizar el sistema.
const PUB = path.join(ROOT, 'data', 'license-public.pem');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--')) ? argv[++i] : true;
      a[k] = v;
    } else a._.push(t);
  }
  return a;
}

function init(args) {
  if (fs.existsSync(PRIV) && !args.force) {
    console.error('Ya existe vendor/clave-privada.pem.');
    console.error('Usa --force para regenerar (¡invalidará TODAS las licencias ya emitidas!).');
    process.exit(1);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('✓ Par de claves generado (reemplaza la clave de demostración).');
  console.log('  • vendor/clave-privada.pem      →  TU LLAVE MAESTRA: guárdala en secreto y respáldala.');
  console.log('  • data/license-public.pem       →  clave pública propia (se conserva al actualizar).');
  console.log('');
  console.log('  Ahora genera tu licencia:  node tools/licencia.js generar --cliente "TU NOMBRE" --dias 3650');
}

function generar(args) {
  if (!fs.existsSync(PRIV)) { console.error('No existe la clave privada. Ejecuta primero: node tools/licencia.js init'); process.exit(1); }
  const cliente = typeof args.cliente === 'string' ? args.cliente.trim() : '';
  const dias = parseInt(args.dias || '365', 10);
  if (!cliente) { console.error('Falta --cliente "NOMBRE DE LA ORGANIZACIÓN"'); process.exit(1); }
  if (!(dias > 0)) { console.error('--dias debe ser un número positivo'); process.exit(1); }

  const priv = crypto.createPrivateKey(fs.readFileSync(PRIV));
  const payload = {
    id: crypto.randomUUID(),
    cliente,
    emitida: Date.now(),
    vence: Date.now() + dias * 24 * 60 * 60 * 1000,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const firma = crypto.sign(null, Buffer.from(payloadB64), priv);
  const licencia = payloadB64 + '.' + b64url(firma);

  const vence = new Date(payload.vence).toISOString().slice(0, 10);
  console.log(`\nLicencia para: ${cliente}`);
  console.log(`Vence: ${vence}  (${dias} días)`);
  console.log('\n── Copia este texto y entrégalo al cliente ──\n');
  console.log(licencia);
  console.log('');
}

function ver(args) {
  const license = require('../license');
  let licStr = args._[0];
  if (!licStr) { try { licStr = fs.readFileSync(0, 'utf8').trim(); } catch (e) {} }
  console.log(license.verificar(licStr));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._.shift();
if (cmd === 'init') init(args);
else if (cmd === 'generar') generar(args);
else if (cmd === 'ver') ver(args);
else {
  console.log('Uso:');
  console.log('  node tools/licencia.js init');
  console.log('  node tools/licencia.js generar --cliente "ESCUELA X" --dias 365');
  console.log('  node tools/licencia.js ver "<licencia>"');
}
