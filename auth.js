// ── AUTENTICACIÓN (Fase 1 del blindaje comercial) ──
// Sin dependencias externas: solo el módulo `crypto` nativo, para no romper
// el arranque offline (node_modules versionado). Hash de contraseñas con
// scrypt; sesiones con token firmado por HMAC guardado en cookie.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');

const ROLES = ['admin', 'mesa', 'juez', 'pantalla'];

// Qué rol puede abrir cada página. Las no listadas requieren solo sesión.
const ACCESO_PAGINA = {
  '/admin.html': ['admin'],
  '/mesa.html': ['admin', 'mesa'],
  '/liga.html': ['admin', 'mesa'],
  '/juez.html': ['admin', 'mesa', 'juez'],
  '/pantalla.html': ['admin', 'mesa', 'pantalla'],
};

let SECRET = null;
let usuarios = [];

function asegurarDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargarSecreto() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  asegurarDir();
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
}

function cargarUsuarios() {
  asegurarDir();
  if (fs.existsSync(USERS_FILE)) {
    try { usuarios = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
    catch (e) { usuarios = []; }
  } else {
    usuarios = [];
  }
}

function guardarUsuarios() {
  asegurarDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), { mode: 0o600 });
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

// Crea/actualiza un usuario. Lanza si el rol es inválido.
function crearUsuario({ username, password, role }) {
  username = String(username || '').trim().toLowerCase();
  if (!username) throw new Error('Usuario vacío');
  if (!password || String(password).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
  if (!ROLES.includes(role)) throw new Error('Rol inválido');
  const salt = crypto.randomBytes(16).toString('hex');
  const existente = usuarios.find(u => u.username === username);
  const datos = {
    username, role, salt,
    hash: hashPassword(password, salt),
    enabled: true,
    createdAt: existente ? existente.createdAt : Date.now(),
  };
  if (existente) Object.assign(existente, datos);
  else usuarios.push(datos);
  guardarUsuarios();
  return { username, role, enabled: true };
}

function habilitarUsuario(username, enabled) {
  const u = usuarios.find(x => x.username === String(username).toLowerCase());
  if (!u) throw new Error('Usuario no encontrado');
  u.enabled = !!enabled;
  guardarUsuarios();
  return { username: u.username, role: u.role, enabled: u.enabled };
}

function eliminarUsuario(username) {
  username = String(username).toLowerCase();
  const antes = usuarios.length;
  usuarios = usuarios.filter(u => u.username !== username);
  if (usuarios.length === antes) throw new Error('Usuario no encontrado');
  guardarUsuarios();
}

function listarUsuarios() {
  return usuarios.map(u => ({ username: u.username, role: u.role, enabled: u.enabled }));
}

// Devuelve el usuario si las credenciales son válidas y está habilitado.
function verificarCredenciales(username, password) {
  username = String(username || '').trim().toLowerCase();
  const u = usuarios.find(x => x.username === username);
  if (!u || !u.enabled) return null;
  const hash = hashPassword(password, u.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(u.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { username: u.username, role: u.role };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function firmarToken(user, dias = 1) {
  const exp = Date.now() + dias * 24 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ u: user.username, r: user.role, exp }));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

function verificarToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const esperada = b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
  const a = Buffer.from(sig || '');
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let datos;
  try { datos = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); }
  catch (e) { return null; }
  if (!datos.exp || Date.now() > datos.exp) return null;
  // Verificar que el usuario siga existiendo y habilitado (permite revocar al instante)
  const u = usuarios.find(x => x.username === datos.u);
  if (!u || !u.enabled) return null;
  return { username: datos.u, role: datos.r };
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(par => {
    const i = par.indexOf('=');
    if (i > -1) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  });
  return out;
}

function puedeAccederPagina(role, ruta) {
  const permitido = ACCESO_PAGINA[ruta];
  if (!permitido) return true;          // página sin restricción de rol
  return permitido.includes(role);
}

// Inicializa secreto + usuarios y siembra un admin si no hay ninguno.
function init() {
  SECRET = cargarSecreto();
  cargarUsuarios();
  if (usuarios.length === 0) {
    let passInicial = process.env.ADMIN_PASSWORD;
    if (!passInicial || String(passInicial).length < 6) {
      if (passInicial) console.log('⚠️ ADMIN_PASSWORD inválida (mín. 6 caracteres); se generará una aleatoria.');
      passInicial = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    }
    crearUsuario({ username: 'admin', password: passInicial, role: 'admin' });
    console.log('────────────────────────────────────────────');
    console.log(' USUARIO ADMIN INICIAL CREADO');
    console.log('   usuario:    admin');
    console.log(`   contraseña: ${passInicial}`);
    console.log('   (cámbiala tras el primer ingreso en /admin.html)');
    console.log('────────────────────────────────────────────');
  }
}

module.exports = {
  ROLES, init, crearUsuario, habilitarUsuario, eliminarUsuario, listarUsuarios,
  verificarCredenciales, firmarToken, verificarToken, parseCookies, puedeAccederPagina,
  COOKIE: 'sesion',
};
