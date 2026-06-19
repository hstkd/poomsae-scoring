// ── LICENCIAS (Fase 2 del blindaje comercial) ──
// El producto verifica licencias firmadas por el PROVEEDOR con Ed25519.
// La clave PRIVADA la guarda solo el proveedor; aquí viaja únicamente la
// clave PÚBLICA (license-public.pem), con la que se verifica la firma offline.
// Una licencia es: base64url(payloadJSON) + "." + base64url(firma).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUB_FILE = path.join(__dirname, 'license-public.pem');
const LIC_FILE = path.join(__dirname, 'data', 'licencia.txt');

function publicKey() {
  if (process.env.LICENSE_PUBLIC_KEY) return process.env.LICENSE_PUBLIC_KEY;
  if (fs.existsSync(PUB_FILE)) return fs.readFileSync(PUB_FILE, 'utf8');
  return null;
}

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Verifica firma y vencimiento. Devuelve { valid, motivo, cliente, vence, datos }.
function verificar(licStr) {
  const pub = publicKey();
  if (!pub) return { valid: false, motivo: 'Producto sin clave de licencia configurada' };
  if (!licStr || typeof licStr !== 'string' || !licStr.includes('.')) {
    return { valid: false, motivo: 'No hay licencia instalada' };
  }
  const [payloadB64, sigB64] = licStr.trim().split('.');
  let firmaOk = false;
  try {
    firmaOk = crypto.verify(null, Buffer.from(payloadB64), pub, b64urlToBuf(sigB64));
  } catch (e) {
    return { valid: false, motivo: 'No se pudo verificar la firma de la licencia' };
  }
  if (!firmaOk) return { valid: false, motivo: 'Firma inválida: la licencia no fue emitida por el proveedor' };
  let datos;
  try { datos = JSON.parse(b64urlToBuf(payloadB64).toString()); }
  catch (e) { return { valid: false, motivo: 'Licencia corrupta' }; }
  if (datos.vence && Date.now() > datos.vence) {
    return { valid: false, motivo: 'Licencia vencida', cliente: datos.cliente, vence: datos.vence, datos };
  }
  return { valid: true, cliente: datos.cliente, vence: datos.vence, datos };
}

function leerLicenciaInstalada() {
  if (process.env.LICENSE) return process.env.LICENSE;
  if (fs.existsSync(LIC_FILE)) return fs.readFileSync(LIC_FILE, 'utf8').trim();
  return null;
}

// Valida y guarda la licencia en data/licencia.txt. Lanza si es inválida.
function instalarLicencia(licStr) {
  const v = verificar(licStr);
  if (!v.valid) throw new Error(v.motivo);
  fs.mkdirSync(path.dirname(LIC_FILE), { recursive: true });
  fs.writeFileSync(LIC_FILE, String(licStr).trim(), { mode: 0o600 });
  return v;
}

// Estado de la licencia actualmente instalada.
function estado() {
  return verificar(leerLicenciaInstalada());
}

module.exports = { verificar, estado, instalarLicencia, leerLicenciaInstalada, publicKey };
