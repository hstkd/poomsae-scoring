const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const auth = require('./auth');
const license = require('./license');

auth.init();

// Estado de la licencia al arrancar (informativo)
const _lic = license.estado();
if (_lic.valid) {
  console.log(`Licencia válida — cliente: ${_lic.cliente} · vence: ${new Date(_lic.vence).toISOString().slice(0, 10)}`);
} else {
  console.log(`⚠️ Licencia NO válida: ${_lic.motivo}. La app quedará bloqueada hasta instalar una licencia.`);
}

const app = express();
const server = http.createServer(app);
// Nota: reconnection/reconnectionAttempts/reconnectionDelay son opciones del
// CLIENTE (io()), no del servidor; aquí solo aplican ping/pong.
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.json());

const COOKIE_OPTS = `HttpOnly; SameSite=Lax; Path=/`;

// ── AUTENTICACIÓN: login / logout (públicos) ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.verificarCredenciales(username, password);
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = auth.firmarToken(user, 1); // sesión de 1 día
  res.setHeader('Set-Cookie', `${auth.COOKIE}=${token}; ${COOKIE_OPTS}; Max-Age=${24 * 60 * 60}`);
  res.json({ ok: true, role: user.role });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${auth.COOKIE}=; ${COOKIE_OPTS}; Max-Age=0`);
  res.json({ ok: true });
});

// ¿La petición viene de la propia computadora del servidor (localhost)?
function esLocal(req) {
  const ip = (req.ip || (req.socket && req.socket.remoteAddress) || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1';
}

// ── PUERTA DE ACCESO: exige sesión válida para todo lo demás ──
app.use((req, res, next) => {
  const ruta = req.path;
  // Recursos públicos necesarios para la pantalla de login
  if (ruta === '/login.html' || ruta.startsWith('/fonts/') ||
      ruta.startsWith('/vendor/') || ruta.startsWith('/socket.io/') ||
      ruta === '/favicon.ico') {
    return next();
  }
  const cookies = auth.parseCookies(req.headers.cookie);
  const user = auth.verificarToken(cookies[auth.COOKIE]);
  if (!user) {
    if (ruta.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
    return res.redirect('/login.html');
  }
  // Control de acceso por página según rol
  const pagina = (ruta === '/' ? '/index.html' : ruta);
  if (pagina.endsWith('.html') && !auth.puedeAccederPagina(user.role, pagina)) {
    return res.status(403).send('No autorizado para esta página');
  }
  // La Administración solo se abre desde la propia computadora (localhost)
  if (pagina === '/admin.html' && !esLocal(req)) {
    return res.status(403).send('La administración solo está disponible desde la computadora del servidor (localhost).');
  }
  req.user = user;
  next();
});

// ── APIs autenticadas ──
// soloAdmin: exige rol admin Y que la petición venga de la computadora local.
function soloAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador' });
  if (!esLocal(req)) return res.status(403).json({ error: 'La administración solo está disponible desde la computadora del servidor' });
  next();
}
app.get('/api/me', (req, res) => res.json({ ...req.user, local: esLocal(req) }));
app.get('/api/users', soloAdmin, (req, res) => res.json(auth.listarUsuarios()));
app.post('/api/users', soloAdmin, (req, res) => {
  try { res.json(auth.crearUsuario(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/users/habilitar', soloAdmin, (req, res) => {
  try { res.json(auth.habilitarUsuario(req.body.username, req.body.enabled)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/users/eliminar', soloAdmin, (req, res) => {
  if (String(req.body.username).toLowerCase() === req.user.username)
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  try { auth.eliminarUsuario(req.body.username); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── LICENCIA: estado e instalación ──
app.get('/api/licencia', (req, res) => {
  const e = license.estado();
  res.json({
    valid: e.valid, motivo: e.motivo || null,
    cliente: e.cliente || null, vence: e.vence || null,
  });
});
app.post('/api/licencia/instalar', soloAdmin, (req, res) => {
  try { const e = license.instalarLicencia(req.body.licencia); res.json({ ok: true, cliente: e.cliente, vence: e.vence }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── PUERTA DE LICENCIA: sin licencia válida, la app queda bloqueada ──
// Se permite seguir gestionando usuarios e instalar la licencia (admin),
// pero las páginas y APIs de competencia quedan inhabilitadas.
app.use((req, res, next) => {
  if (license.estado().valid) return next();
  const ruta = req.path;
  const permitidoSinLicencia =
    ruta === '/login.html' || ruta === '/licencia.html' || ruta === '/admin.html' ||
    ruta === '/api/me' || ruta === '/api/logout' ||
    ruta.startsWith('/api/licencia') || ruta.startsWith('/api/users') ||
    ruta.startsWith('/fonts/') || ruta.startsWith('/vendor/');
  if (permitidoSinLicencia) return next();
  if (ruta.startsWith('/api/')) return res.status(403).json({ error: 'Licencia inválida o vencida' });
  return res.redirect('/licencia.html');
});

app.use(express.static(path.join(__dirname, 'public')));

const salas = {};

// ── SEGURIDAD: saneo de nombres (anti-XSS + calidad de datos) ──
// Lista blanca: solo letras (cualquier idioma, incl. acentos/ñ/ü), espacios
// y guiones. Esto elimina de raíz los caracteres peligrosos para los
// contextos innerHTML/atributos/onclick (< > " ' & `) y además descarta
// dígitos, símbolos y emojis que no van en un nombre de persona.
function sanitizeName(s) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .replace(/[^\p{L}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

// ── SEGURIDAD: validación de puntajes ──
function numEnRango(v, min, max) {
  return typeof v === 'number' && isFinite(v) && v >= min && v <= max;
}

// Valida y normaliza el desglose técnico (acepta solo números 0-10).
function sanitizeDesglose(d) {
  if (!d || typeof d !== 'object') return {};
  const out = {};
  for (const k of ['prec', 'vel', 'rit', 'exp']) {
    out[k] = numEnRango(d[k], 0, 10) ? d[k] : 0;
  }
  return out;
}

// ── SEGURIDAD: token de mesa ──
// Cada sala emite un token secreto en su creación. Solo quien lo posee puede
// emitir eventos de control (iniciar, eliminar, reconectar como mesa, etc.).
function generarToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Devuelve true si el socket está autorizado como mesa de esa sala.
function autorizarMesa(sala, token, socket) {
  if (!sala) return false;
  if (sala.mesaToken && token === sala.mesaToken) return true;
  socket.emit('error-sala', { msg: 'No autorizado para controlar esta sala' });
  return false;
}

// ── LIMPIEZA DE SALAS INACTIVAS (anti fuga de memoria) ──
// Cuando una sala queda sin ningún socket conectado durante el periodo de
// gracia, se elimina. Si alguien reconecta antes, se cancela la limpieza.
const GRACIA_LIMPIEZA_MS = 60 * 60 * 1000; // 1 hora

function cancelarLimpieza(sala) {
  if (sala && sala.limpiezaTimer) {
    clearTimeout(sala.limpiezaTimer);
    sala.limpiezaTimer = null;
  }
}

function programarLimpieza(codigo) {
  const sala = salas[codigo];
  if (!sala) return;
  cancelarLimpieza(sala);
  sala.limpiezaTimer = setTimeout(() => {
    const room = io.sockets.adapter.rooms.get(codigo);
    if (!room || room.size === 0) {
      delete salas[codigo];
      console.log(`Sala ${codigo} eliminada por inactividad`);
    }
  }, GRACIA_LIMPIEZA_MS);
}

function calcularTotal(puntajes, numJueces) {
  if (puntajes.length < numJueces) return null;
  const valores = puntajes.map(p => p.precision + p.presentacion);
  let resultado;
  if (numJueces >= 5) {
    const sorted = [...valores].sort((a, b) => a - b);
    const recortados = sorted.slice(1, -1);
    resultado = recortados.reduce((a, b) => a + b, 0) / recortados.length;
  } else {
    resultado = valores.reduce((a, b) => a + b, 0) / valores.length;
  }
  return Math.round(resultado * 100) / 100;
}

// Suma de presentación de un competidor (criterio de desempate WT).
function presentacionTotal(c) {
  const sum = arr => (arr || []).reduce((s, p) => s + (p.presentacion || 0), 0);
  return sum(c.puntajesP1) + sum(c.puntajesP2);
}

function getRanking(sala) {
  return sala.competidores
    .filter(c => c.total !== null)
    // Empate por total → desempata mayor presentación (regla WT)
    .sort((a, b) => (b.total - a.total) || (presentacionTotal(b) - presentacionTotal(a)))
    .map((c, i) => ({ ...c, pos: i + 1 }));
}

function buildTurno(sala, ti) {
  const m = sala.modo;
  if (m === '1v1-simultaneo') {
    return {
      tipo: '1v1-simultaneo',
      competidorA: sala.competidores[ti] || null,
      competidorB: sala.competidores[ti + 1] || null,
    };
  } else if (m === '1v1-secuencial') {
    return {
      tipo: '1v1-secuencial',
      competidorA: sala.competidores[ti] || null,
      competidorB: sala.competidores[ti + 1] || null,
      fase: 'A',
    };
  } else {
    return {
      tipo: 'cutoff',
      competidor: sala.competidores[ti] || null,
      numero: ti + 1,
      total: sala.competidores.length,
    };
  }
}

// ── HELPER: snapshot completo de sala para reconexión ──
// Usado por mesa-reconectar y juez-unirse para restaurar pantalla y jueces
function buildSnapshot(sala) {
  return {
    codigo: sala.codigo,
    tipo: sala.tipo,
    modo: sala.modo,
    numJueces: sala.numJueces,
    categoria: sala.categoria,
    ronda: sala.ronda,
    grupoCategoria: sala.grupoCategoria,   // FIX #14
    estado: sala.estado,
    competidores: sala.competidores,
    turnoIndex: sala.turnoIndex,
    faseActual: sala.faseActual,
    poomsae1: sala.poomsae1,
    poomsae2: sala.poomsae2,
    cronoActivo: sala.cronoActivo,
    cronoSegundos: sala.cronoSegundos || 0,
    juecesOcupados: sala.jueces.map(j => j.num),
  };
}

// ── AUTENTICACIÓN DEL SOCKET: exige licencia válida + sesión válida ──
io.use((socket, next) => {
  if (!license.estado().valid) return next(new Error('Licencia inválida o vencida'));
  const cookies = auth.parseCookies(socket.handshake.headers.cookie);
  const user = auth.verificarToken(cookies[auth.COOKIE]);
  if (!user) return next(new Error('No autenticado'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  console.log(`Conectado: ${socket.id} (${socket.data.user.username}/${socket.data.user.role})`);

  // Control de acceso por evento según el rol del usuario
  socket.use(([evento], next) => {
    const role = socket.data.user && socket.data.user.role;
    if (typeof evento === 'string') {
      if (evento.startsWith('mesa-') && !['admin', 'mesa'].includes(role)) {
        return next(new Error('Rol no autorizado para controlar la mesa'));
      }
      if ((evento === 'juez-puntaje' || evento === 'juez-precision') &&
          !['admin', 'mesa', 'juez'].includes(role)) {
        return next(new Error('Rol no autorizado para calificar'));
      }
    }
    next();
  });

  // ── MESA: CREAR SALA ──
  socket.on('mesa-crear-sala', ({ codigo, tipo, modo, numJueces, categoria, ronda, grupoCategoria }) => {
    if (salas[codigo]) {
      socket.emit('error-sala', { msg: 'Esa sala ya existe' });
      return;
    }
    const mesaToken = generarToken();
    salas[codigo] = {
      codigo, tipo, modo, numJueces,
      categoria, ronda, grupoCategoria,
      jueces: [],
      competidores: [],
      turnoIndex: 0,
      estado: 'setup',
      mesaId: socket.id,
      mesaToken,                // SEGURIDAD: secreto de control de la mesa
      poomsae1: null,
      poomsae2: null,
      faseActual: 'sorteo',
      cronoActivo: false,
      cronoSegundos: 0,         // FIX #9
      notasSnapshot: {},        // FIX #2: almacén de notas para replay
    };
    socket.join(codigo);
    socket.data.codigo = codigo;   // para limpieza al desconectar
    socket.emit('sala-creada', { codigo, tipo, modo, numJueces, categoria, ronda, grupoCategoria, token: mesaToken });
    console.log(`Sala creada: ${codigo}`);
  });

  // ── MESA: INICIAR COMPETENCIA ──
  socket.on('mesa-iniciar', ({ codigo, competidores, modo, tipo, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    if (!Array.isArray(competidores) || competidores.length === 0 || competidores.length > 200) {
      socket.emit('error-sala', { msg: 'Lista de competidores inválida' });
      return;
    }
    sala.competidores = competidores.map((c, i) => ({
      id: i,
      nombre: sanitizeName(c && c.nombre),
      puntajesP1: [],
      puntajesP2: [],
      totalP1: null,
      totalP2: null,
      total: null,
    }));
    sala.turnoIndex = 0;
    sala.estado = 'activo';
    sala.faseActual = 'sorteo';
    sala.poomsae1 = null;
    sala.poomsae2 = null;
    sala.notasSnapshot = {};    // FIX #2: limpiar notas del enfrentamiento anterior
    io.to(codigo).emit('competencia-iniciada', {
      competidores: sala.competidores,
      modo: sala.modo,
      tipo: sala.tipo,
    });
  });

  // ── MESA: TURNO ──
  socket.on('mesa-turno', ({ codigo, turnoIndex, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    // FIX #6: resetear snapshot solo cuando cambia el enfrentamiento
    if (sala.turnoIndex !== turnoIndex) {
      sala.notasSnapshot = {};
    }
    sala.turnoIndex = turnoIndex;
    const turno = buildTurno(sala, turnoIndex);
    io.to(codigo).emit('turno-actualizado', { turno, salaInfo: { tipo: sala.tipo } });
  });

  // ── JUEZ: UNIRSE / RECONECTAR ──
  socket.on('juez-unirse', ({ codigo, nombre, numJuez }) => {
    const sala = salas[codigo];
    if (!sala) {
      socket.emit('error-sala', { msg: 'Sala no encontrada' });
      return;
    }
    cancelarLimpieza(sala);   // alguien volvió: no eliminar la sala

    // Bloquear posición ya ocupada por OTRO usuario — excepto Pantalla (numJuez 0).
    // El MISMO usuario puede reclamar su posición (reconexión tras cambiar de app),
    // aunque su socket anterior siga colgado: se reemplaza por el nuevo.
    if (numJuez !== 0) {
      const miUsuario = socket.data.user && socket.data.user.username;
      const ocupado = sala.jueces.find(j => j.num === numJuez);
      if (ocupado && ocupado.id !== socket.id && ocupado.usuario && ocupado.usuario !== miUsuario) {
        socket.emit('error-sala', { msg: `Juez ${numJuez} ya está conectado en esta sala` });
        return;
      }
      // Cerrar el socket anterior del mismo juez si quedó colgado
      if (ocupado && ocupado.id !== socket.id) {
        const viejo = io.sockets.sockets.get(ocupado.id);
        if (viejo) viejo.disconnect(true);
      }
      sala.jueces = sala.jueces.filter(j => j.num !== numJuez);
      sala.jueces.push({ id: socket.id, num: numJuez, nombre, usuario: miUsuario });
    }

    socket.join(codigo);
    socket.data.codigo = codigo;
    socket.data.numJuez = numJuez;
    socket.data.nombre = nombre;

    // Enviar snapshot completo (FIX #14: incluye grupoCategoria)
    socket.emit('juez-ok', { sala: buildSnapshot(sala) });

    // Si hay competencia activa, reenviar turno + fase
    if (sala.estado === 'activo' && sala.competidores.length > 0) {
      socket.emit('turno-actualizado', {
        turno: buildTurno(sala, sala.turnoIndex),
        salaInfo: { tipo: sala.tipo },
      });
      socket.emit('control-actualizado', {
        accion: sala.cronoActivo ? 'iniciar' : 'detener',
        fase: sala.faseActual,
        poomsae1: sala.poomsae1,
        poomsae2: sala.poomsae2,
        esReconexion: true,
      });
      // FIX #2: replay de notas acumuladas para Pantalla
      if (numJuez === 0 && sala.notasSnapshot) {
        Object.values(sala.notasSnapshot).forEach(nota => {
          socket.emit('puntaje-recibido', nota);
        });
      }
    }

    // Solo notificar jueces reales (no Pantalla) al broadcast
    if (numJuez !== 0) {
      io.to(codigo).emit('juez-conectado', {
        jueces: sala.jueces,
        nombre, numJuez,
        juecesOcupados: sala.jueces.map(j => j.num),
      });
    }
    console.log(`${numJuez === 0 ? 'Pantalla' : `Juez ${numJuez}`} (${nombre}) en sala ${codigo}`);
  });

  // ── MESA: FASE ──
  socket.on('mesa-fase', ({ codigo, fase, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    sala.faseActual = fase;
    io.to(codigo).emit('fase-actualizada', { fase });
  });

  // ── MESA: CONTROL ──
  socket.on('mesa-control', ({ codigo, accion, fase, poomsae, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    if (fase) sala.faseActual = fase;
    sala.cronoActivo = (accion === 'iniciar');
    // Limpiar snapshot al iniciar nueva competencia o nueva poomsae
    if (accion === 'nueva-competencia') {
      sala.notasSnapshot = {};
      sala.poomsae1 = null;
      sala.poomsae2 = null;
    }
    io.to(codigo).emit('control-actualizado', { accion, fase, poomsae });
  });

  // ── JUEZ: PRECISIÓN ──
  socket.on('juez-precision', ({ codigo, competidorId, precision, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!numEnRango(precision, 0, 10)) return; // SEGURIDAD: rango válido
    const numJuez = socket.data.numJuez;
    io.to(codigo).emit('precision-recibida', {
      competidorId, juezNum: numJuez, precision, poomsae,
    });
  });

  // ── JUEZ: PUNTAJE COMPLETO ──
  socket.on('juez-puntaje', ({ codigo, competidorId, precision, presentacion, desglose, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;

    // SEGURIDAD: validar puntajes antes de aceptarlos (no confiar en el cliente)
    if (!numEnRango(precision, 0, 10) || !numEnRango(presentacion, 0, 10)) {
      console.log(`⚠️ Puntaje fuera de rango rechazado en sala ${codigo}: prec=${precision} pres=${presentacion}`);
      socket.emit('error-sala', { msg: 'Puntaje fuera de rango (0-10)' });
      return;
    }
    if (poomsae !== 1 && poomsae !== 2) return;
    desglose = sanitizeDesglose(desglose);

    const comp = sala.competidores.find(c => c.id === competidorId);
    if (!comp) {
      console.log(`⚠️ Comp no encontrado: id=${competidorId} en sala ${codigo}`);
      return;
    }

    const numJuez = socket.data.numJuez;
    const entrada = { juez: numJuez, precision, presentacion, desglose };
    let totalComp = null;

    if (poomsae === 1) {
      comp.puntajesP1 = comp.puntajesP1.filter(p => p.juez !== numJuez);
      comp.puntajesP1.push(entrada);
      if (comp.puntajesP1.length === sala.numJueces) {
        comp.totalP1 = calcularTotal(comp.puntajesP1, sala.numJueces);
        console.log(`✅ Total P1 ${comp.nombre}: ${comp.totalP1}`);
        // Freestyle: una sola rutina → total final = P1
        if (sala.tipo === 'freestyle') {
          comp.total = comp.totalP1;
          console.log(`🏆 Total final (freestyle) ${comp.nombre}: ${comp.total}`);
        }
      }
      totalComp = comp.totalP1;

    } else if (poomsae === 2) {
      comp.puntajesP2 = comp.puntajesP2.filter(p => p.juez !== numJuez);
      comp.puntajesP2.push(entrada);
      if (comp.puntajesP2.length === sala.numJueces) {
        comp.totalP2 = calcularTotal(comp.puntajesP2, sala.numJueces);
        console.log(`✅ Total P2 ${comp.nombre}: ${comp.totalP2}`);
      }
      totalComp = comp.totalP2;
      if (comp.totalP1 !== null && comp.totalP2 !== null) {
        if (sala.modo === 'cutoff') {
          // Cutoff: promedio de las dos poomsaes
          comp.total = Math.round(((comp.totalP1 + comp.totalP2) / 2) * 100) / 100;
        } else {
          comp.total = Math.round((comp.totalP1 + comp.totalP2) * 100) / 100;
        }
        console.log(`🏆 Total final ${comp.nombre}: ${comp.total}`);
      }
    }

    const totalRecibidosP = poomsae === 1 ? comp.puntajesP1.length : comp.puntajesP2.length;

    const payload = {
      competidorId,
      competidorNombre: comp.nombre,
      juezNum: numJuez,
      totalPuntajes: totalRecibidosP,
      numJueces: sala.numJueces,
      precision, presentacion, desglose,
      totalComp,
      totalFinal: comp.total,
      poomsae,
    };

    // FIX #2: guardar en snapshot para replay (clave única por comp+poomsae+juez)
    if (!sala.notasSnapshot) sala.notasSnapshot = {};
    sala.notasSnapshot[`${competidorId}_p${poomsae}_j${numJuez}`] = payload;

    io.to(codigo).emit('puntaje-recibido', payload);
    socket.emit('puntaje-confirmado', { competidorId, juezNum: numJuez, poomsae });
    console.log(`Puntaje J${numJuez} → ${comp.nombre}(id=${competidorId}) P${poomsae}: prec=${precision} pres=${presentacion}`);
  });


  // ── MESA: REVELAR ──
  socket.on('mesa-revelar', ({ codigo, turnoIndex, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    let datos = {};
    if (sala.modo === '1v1-simultaneo' || sala.modo === '1v1-secuencial') {
      datos = {
        tipo: '1v1',
        competidorA: sala.competidores[turnoIndex],
        competidorB: sala.competidores[turnoIndex + 1],
      };
    } else {
      datos = {
        tipo: 'cutoff',
        competidor: sala.competidores[turnoIndex],
        ranking: getRanking(sala),
      };
    }
    io.to(codigo).emit('puntaje-revelado', datos);
  });

  // ── SORTEO POOMSAE ──
  socket.on('mesa-sortear-poomsae', ({ codigo, numero, poomsae, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    if (numero === 1) sala.poomsae1 = poomsae;
    else sala.poomsae2 = poomsae;
    io.to(codigo).emit('poomsae-sorteada', { numero, poomsae });
  });

  // ── CRONÓMETRO ──
  socket.on('mesa-cronometro', ({ codigo, accion, duracion, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    if (accion === 'iniciar') sala.cronoActivo = true;
    if (accion === 'detener' || accion === 'restablecer') sala.cronoActivo = false;
    if (duracion !== undefined) sala.cronoSegundos = duracion; // FIX #9
    io.to(codigo).emit('cronometro-update', { accion, duracion });
  });

  // ── CORTE ──
  socket.on('mesa-corte', ({ codigo, topN, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    io.to(codigo).emit('corte-aplicado', { ranking: getRanking(sala), topN });
  });

  // ── MESA: RECONECTAR ── FIX #1: snapshot completo
  socket.on('mesa-reconectar', ({ codigo, token }) => {
    const sala = salas[codigo];
    if (!sala) {
      socket.emit('error-sala', { msg: 'Sala no encontrada al reconectar' });
      return;
    }
    if (!autorizarMesa(sala, token, socket)) return;
    cancelarLimpieza(sala);   // la mesa volvió: no eliminar la sala
    socket.join(codigo);
    socket.data.codigo = codigo;   // para limpieza al desconectar
    sala.mesaId = socket.id;

    // 1. Info de sala (incluye grupoCategoria — FIX #14)
    socket.emit('sala-creada', {
      codigo: sala.codigo, tipo: sala.tipo, modo: sala.modo,
      numJueces: sala.numJueces, categoria: sala.categoria,
      ronda: sala.ronda, grupoCategoria: sala.grupoCategoria,
      token: sala.mesaToken,
    });

    // 2. Jueces conectados
    socket.emit('juez-conectado', {
      jueces: sala.jueces, nombre: '', numJuez: -1,
      juecesOcupados: sala.jueces.map(j => j.num),
    });

    if (sala.estado !== 'activo' || !sala.competidores.length) return;

    // 3. Competidores con IDs
    socket.emit('competencia-iniciada', {
      competidores: sala.competidores,
      modo: sala.modo,
      tipo: sala.tipo,
    });

    // 4. Poomsaes sorteadas
    if (sala.poomsae1) socket.emit('poomsae-sorteada', { numero: 1, poomsae: sala.poomsae1 });
    if (sala.poomsae2) socket.emit('poomsae-sorteada', { numero: 2, poomsae: sala.poomsae2 });

    // 5. Fase + cronómetro
    socket.emit('estado-snapshot', {
      faseActual: sala.faseActual,
      cronoActivo: sala.cronoActivo,
      cronoSegundos: sala.cronoSegundos || 0,
      turnoIndex: sala.turnoIndex,
      poomsae1: sala.poomsae1,
      poomsae2: sala.poomsae2,
    });

    // 6. Replay de notas para que Mesa vea las notas recibidas
    if (sala.notasSnapshot) {
      Object.values(sala.notasSnapshot).forEach(nota => {
        socket.emit('puntaje-recibido', nota);
      });
    }

    console.log(`Mesa reconectada a sala ${codigo} — snapshot enviado`);
  });

  // ── ELIMINAR SALA ──
  socket.on('mesa-eliminar-sala', ({ codigo, token }) => {
    const sala = salas[codigo];
    if (!sala) {
      socket.emit('sala-eliminada', { codigo });
      return;
    }
    if (!autorizarMesa(sala, token, socket)) return;
    cancelarLimpieza(sala);
    io.to(codigo).emit('sala-eliminada', { codigo });
    delete salas[codigo];
    console.log(`Sala eliminada: ${codigo}`);
  });

  // ── RENOMBRAR COMPETIDOR ──
  socket.on('mesa-renombrar-competidor', ({ codigo, competidorId, nombre, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    const comp = sala.competidores.find(c => c.id === competidorId);
    if (!comp) return;
    const nombreLimpio = sanitizeName(nombre);
    comp.nombre = nombreLimpio;
    io.to(codigo).emit('competidor-renombrado', { competidorId, nombre: nombreLimpio });
    console.log(`Renombrado id=${competidorId} → "${nombreLimpio}" en sala ${codigo}`);
  });

  // ── FIN DE SALA ──
  socket.on('mesa-fin-sala', ({ codigo, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    cancelarLimpieza(sala);
    io.to(codigo).emit('sala-finalizada');
    delete salas[codigo];
    console.log(`Sala finalizada: ${codigo}`);
  });

  // ── RESTAURAR SALA ── FIX #9 + #10
  socket.on('mesa-restaurar', ({ codigo, token }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (!autorizarMesa(sala, token, socket)) return;
    sala.competidores = [];
    sala.turnoIndex = 0;
    sala.estado = 'setup';
    sala.poomsae1 = null;
    sala.poomsae2 = null;
    sala.faseActual = 'sorteo';
    sala.cronoActivo = false;
    sala.cronoSegundos = 0;      // FIX #9
    sala.notasSnapshot = {};     // FIX #2
    io.to(codigo).emit('sistema-restaurado');
    console.log(`Sala restaurada: ${codigo}`);
  });

  // ── DESCONEXIÓN ──
  socket.on('disconnect', (reason) => {
    const codigo = socket.data.codigo;
    const numJuez = socket.data.numJuez;
    console.log(`Desconectado: ${socket.id} — razón: ${reason}`);
    if (codigo && salas[codigo] && numJuez !== 0) {
      const sala = salas[codigo];
      const juezActual = sala.jueces.find(j => j.num === numJuez);
      if (juezActual && juezActual.id === socket.id) {
        sala.jueces = sala.jueces.filter(j => j.id !== socket.id);
        io.to(codigo).emit('juez-desconectado', {
          jueces: sala.jueces, numJuez,
          juecesOcupados: sala.jueces.map(j => j.num),
        });
      }
    }
    // Si la sala quedó sin sockets, programar su limpieza (anti fuga de memoria)
    if (codigo && salas[codigo]) programarLimpieza(codigo);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
