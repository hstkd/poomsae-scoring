const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

app.use(express.static('public'));

const salas = {};

// ── CÁLCULO DE TOTAL (única fuente de verdad — fix #13) ──
// Recibe un array de { juez, precision, presentacion, desglose }
// Devuelve el promedio (trimmed mean si numJueces >= 5), redondeado a 2 decimales.
function calcularTotal(puntajes, numJueces) {
  if (puntajes.length < numJueces) return null;
  const valores = puntajes.map(p => p.precision + p.presentacion);
  let resultado;
  if (numJueces >= 5) {
    const sorted = [...valores].sort((a, b) => a - b);
    const recortados = sorted.slice(1, -1); // elimina el menor y el mayor
    resultado = recortados.reduce((a, b) => a + b, 0) / recortados.length;
  } else {
    resultado = valores.reduce((a, b) => a + b, 0) / valores.length;
  }
  return Math.round(resultado * 100) / 100;
}

function getRanking(sala) {
  return sala.competidores
    .filter(c => c.total !== null)
    .sort((a, b) => b.total - a.total)
    .map((c, i) => ({ ...c, pos: i + 1 }));
}

// ── HELPER: construir objeto turno a partir del estado de la sala ──
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

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  // ── MESA: CREAR SALA ──
  socket.on('mesa-crear-sala', ({ codigo, tipo, modo, numJueces, categoria, ronda, grupoCategoria }) => {
    if (salas[codigo]) {
      socket.emit('error-sala', { msg: 'Esa sala ya existe' });
      return;
    }
    salas[codigo] = {
      codigo, tipo, modo, numJueces,
      categoria, ronda, grupoCategoria,
      jueces: [],
      competidores: [],
      turnoIndex: 0,
      estado: 'setup',
      mesaId: socket.id,
      // Poomsaes del enfrentamiento activo
      poomsae1: null,
      poomsae2: null,
      // Fase actual para reenviar a jueces reconectados (fix #8)
      faseActual: 'sorteo',
      cronoActivo: false,
    };
    socket.join(codigo);
    socket.emit('sala-creada', { codigo, tipo, modo, numJueces, categoria, ronda });
    console.log(`Sala creada: ${codigo}`);
  });

  // ── MESA: INICIAR COMPETENCIA ──
  // FIX #3: el servidor asigna IDs y los devuelve a Mesa en competencia-iniciada.
  // Mesa debe escuchar este evento y reemplazar su array local con los competidores indexados.
  socket.on('mesa-iniciar', ({ codigo, competidores, modo, tipo }) => {
    const sala = salas[codigo];
    if (!sala) return;

    sala.competidores = competidores.map((c, i) => ({
      id: i,
      nombre: c.nombre,
      // FIX #1: puntajes separados por poomsae
      puntajesP1: [],
      puntajesP2: [],
      totalP1: null,
      totalP2: null,
      total: null,       // suma totalP1 + totalP2 (se calcula al tener ambos)
    }));
    sala.turnoIndex = 0;
    sala.estado = 'activo';
    sala.faseActual = 'sorteo';

    // FIX #3: devolver los competidores con sus IDs reales a TODOS (mesa incluida)
    io.to(codigo).emit('competencia-iniciada', {
      competidores: sala.competidores,
      modo: sala.modo,
      tipo: sala.tipo,
    });
  });

  // ── MESA: TURNO ──
  socket.on('mesa-turno', ({ codigo, turnoIndex, modo }) => {
    const sala = salas[codigo];
    if (!sala) return;
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

    // Bloquear posición ya ocupada por OTRO socket activo
    const ocupado = sala.jueces.find(j => j.num === numJuez);
    if (ocupado && ocupado.id !== socket.id) {
      socket.emit('error-sala', { msg: `Juez ${numJuez} ya está conectado en esta sala` });
      return;
    }

    // Reemplazar sesión anterior del mismo número (reconexión del mismo juez)
    sala.jueces = sala.jueces.filter(j => j.num !== numJuez);
    sala.jueces.push({ id: socket.id, num: numJuez, nombre });
    socket.join(codigo);
    socket.data.codigo = codigo;
    socket.data.numJuez = numJuez;
    socket.data.nombre = nombre;

    // Snapshot completo para sincronización inmediata (items 1 y 3)
    socket.emit('juez-ok', {
      sala: {
        codigo: sala.codigo, tipo: sala.tipo, modo: sala.modo,
        numJueces: sala.numJueces, categoria: sala.categoria,
        ronda: sala.ronda, estado: sala.estado,
        competidores: sala.competidores, turnoIndex: sala.turnoIndex,
        // Estado completo para restaurar pantalla
        faseActual: sala.faseActual,
        poomsae1: sala.poomsae1,
        poomsae2: sala.poomsae2,
        cronoActivo: sala.cronoActivo,
        cronoSegundos: sala.cronoSegundos || 0,
        // Lista de posiciones ocupadas para bloquear el select de login
        juecesOcupados: sala.jueces.map(j => j.num),
      },
    });

    // Si hay competencia activa, reenviar turno + estado de fase
    if (sala.estado === 'activo' && sala.competidores.length > 0) {
      const turno = buildTurno(sala, sala.turnoIndex);
      socket.emit('turno-actualizado', { turno, salaInfo: { tipo: sala.tipo } });
      socket.emit('control-actualizado', {
        accion: sala.cronoActivo ? 'iniciar' : 'detener',
        fase: sala.faseActual,
        poomsae1: sala.poomsae1,
        poomsae2: sala.poomsae2,
        esReconexion: true,
      });
    }

    io.to(codigo).emit('juez-conectado', {
      jueces: sala.jueces,
      nombre, numJuez,
      juecesOcupados: sala.jueces.map(j => j.num),
    });
    console.log(`Juez ${numJuez} (${nombre}) en sala ${codigo}`);
  });

  // ── MESA: FASE ──
  socket.on('mesa-fase', ({ codigo, fase }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.faseActual = fase;
    io.to(codigo).emit('fase-actualizada', { fase });
  });

  // ── MESA: CONTROL (iniciar / detener / nueva-poomsae / nueva-competencia / restablecer) ──
  socket.on('mesa-control', ({ codigo, accion, fase, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (fase) sala.faseActual = fase;
    sala.cronoActivo = (accion === 'iniciar');
    // FIX #8: guardar poomsae activa para reenviar al reconectar
    io.to(codigo).emit('control-actualizado', { accion, fase, poomsae });
  });

  // ── JUEZ: PRECISIÓN (envío inmediato al confirmar, antes de presentación) ──
  socket.on('juez-precision', ({ codigo, competidorId, precision, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const numJuez = socket.data.numJuez;
    // Solo relay: Mesa recibe en tiempo real, el almacenamiento definitivo
    // llega con juez-puntaje (que incluye presentación).
    io.to(codigo).emit('precision-recibida', {
      competidorId, juezNum: numJuez, precision, poomsae,
    });
    console.log(`Precisión J${numJuez} comp${competidorId} P${poomsae}: ${precision}`);
  });

  // ── JUEZ: PUNTAJE COMPLETO (precisión + presentación) ──
  // FIX #1: separar almacenamiento y cálculo por poomsae (P1 y P2)
  socket.on('juez-puntaje', ({ codigo, competidorId, precision, presentacion, desglose, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;

    const comp = sala.competidores.find(c => c.id === competidorId);
    if (!comp) {
      console.log(`⚠️ Comp no encontrado: id=${competidorId} en sala ${codigo}`);
      console.log(`IDs disponibles:`, sala.competidores.map(c => c.id));
      return;
    }

    const numJuez = socket.data.numJuez;
    const entrada = { juez: numJuez, precision, presentacion, desglose };

    let totalComp = null;

    if (poomsae === 1) {
      // Reemplazar si el mismo juez ya envió para esta poomsae
      comp.puntajesP1 = comp.puntajesP1.filter(p => p.juez !== numJuez);
      comp.puntajesP1.push(entrada);

      if (comp.puntajesP1.length === sala.numJueces) {
        comp.totalP1 = calcularTotal(comp.puntajesP1, sala.numJueces);
        console.log(`✅ Total P1 ${comp.nombre}: ${comp.totalP1}`);
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

      // FIX #13: calcular total final en el servidor cuando llegan ambas poomsaes
      if (comp.totalP1 !== null && comp.totalP2 !== null) {
        comp.total = Math.round((comp.totalP1 + comp.totalP2) * 100) / 100;
        console.log(`🏆 Total final ${comp.nombre}: ${comp.total}`);
      }
    }

    const totalRecibidosP = poomsae === 1 ? comp.puntajesP1.length : comp.puntajesP2.length;

    io.to(codigo).emit('puntaje-recibido', {
      competidorId,
      competidorNombre: comp.nombre,
      juezNum: numJuez,
      totalPuntajes: totalRecibidosP,
      numJueces: sala.numJueces,
      precision,
      presentacion,
      desglose,
      totalComp,        // total de la poomsae actual (null hasta que lleguen todos)
      totalFinal: comp.total, // total acumulado P1+P2 (null hasta tener ambas)
      poomsae,
    });

    socket.emit('puntaje-confirmado', { competidorId, juezNum: numJuez, poomsae });
    console.log(`Puntaje J${numJuez} → ${comp.nombre}(id=${competidorId}) P${poomsae}: prec=${precision} pres=${presentacion}`);
  });

  // ── MESA: REVELAR ──
  socket.on('mesa-revelar', ({ codigo, turnoIndex }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const modo = sala.modo;
    let datos = {};
    if (modo === '1v1-simultaneo' || modo === '1v1-secuencial') {
      const a = sala.competidores[turnoIndex];
      const b = sala.competidores[turnoIndex + 1];
      datos = { tipo: '1v1', competidorA: a, competidorB: b };
    } else {
      const c = sala.competidores[turnoIndex];
      datos = { tipo: 'cutoff', competidor: c, ranking: getRanking(sala) };
    }
    io.to(codigo).emit('puntaje-revelado', datos);
  });

  // ── SORTEO POOMSAE ──
  // FIX #8: guardar poomsaes en sala para reenviarlas al reconectar
  socket.on('mesa-sortear-poomsae', ({ codigo, numero, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (numero === 1) sala.poomsae1 = poomsae;
    else sala.poomsae2 = poomsae;
    io.to(codigo).emit('poomsae-sorteada', { numero, poomsae });
  });

  // ── CRONÓMETRO (relay puro) ──
  socket.on('mesa-cronometro', ({ codigo, accion, duracion, tipo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (accion === 'iniciar') sala.cronoActivo = true;
    if (accion === 'detener' || accion === 'restablecer') sala.cronoActivo = false;
    // Guardar tiempo restante para sincronizar jueces que se reconecten
    if (duracion !== undefined) sala.cronoSegundos = duracion;
    io.to(codigo).emit('cronometro-update', { accion, duracion, tipo });
  });

  // ── CORTE (cutoff) ──
  socket.on('mesa-corte', ({ codigo, topN }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const ranking = getRanking(sala);
    io.to(codigo).emit('corte-aplicado', { ranking, topN });
  });

  // ── MESA: RECONECTAR (re-join sala tras caída de socket) ──
  socket.on('mesa-reconectar', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) {
      socket.emit('error-sala', { msg: 'Sala no encontrada al reconectar' });
      return;
    }
    socket.join(codigo);
    sala.mesaId = socket.id;
    // Reenviar estado actual
    socket.emit('sala-creada', {
      codigo: sala.codigo,
      tipo: sala.tipo,
      modo: sala.modo,
      numJueces: sala.numJueces,
      categoria: sala.categoria,
      ronda: sala.ronda
    });
    socket.emit('juez-conectado', { jueces: sala.jueces, nombre: '', numJuez: 0 });
    if (sala.estado === 'activo' && sala.competidores.length > 0) {
      socket.emit('competencia-iniciada', {
        competidores: sala.competidores,
        modo: sala.modo,
        tipo: sala.tipo
      });
    }
    console.log(`Mesa reconectada a sala ${codigo}`);
  });

  // ── ELIMINAR SALA ──
  socket.on('mesa-eliminar-sala', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) {
      // Sala no existe — notificar igual para que Mesa limpie su estado
      socket.emit('sala-eliminada', { codigo });
      return;
    }
    io.to(codigo).emit('sala-eliminada', { codigo });
    delete salas[codigo];
    console.log(`Sala eliminada: ${codigo}`);
  });

  // ── RENOMBRAR COMPETIDOR (broadcast a todos en la sala) ──
  socket.on('mesa-renombrar-competidor', ({ codigo, competidorId, nombre }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const comp = sala.competidores.find(c => c.id === competidorId);
    if (!comp) return;
    comp.nombre = nombre;
    io.to(codigo).emit('competidor-renombrado', { competidorId, nombre });
    console.log(`Renombrado id=${competidorId} → "${nombre}" en sala ${codigo}`);
  });

  // ── FIN DE SALA ──
  socket.on('mesa-fin-sala', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    io.to(codigo).emit('sala-finalizada');
    delete salas[codigo];
    console.log(`Sala eliminada: ${codigo}`);
  });

  // ── RESTAURAR SALA ──
  socket.on('mesa-restaurar', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.competidores = [];
    sala.turnoIndex = 0;
    sala.estado = 'setup';
    sala.poomsae1 = null;
    sala.poomsae2 = null;
    sala.faseActual = 'sorteo';
    sala.cronoActivo = false;
    io.to(codigo).emit('sistema-restaurado');
    console.log(`Sala restaurada: ${codigo}`);
  });

  // ── DESCONEXIÓN ──
  socket.on('disconnect', (reason) => {
    const codigo = socket.data.codigo;
    const numJuez = socket.data.numJuez;
    console.log(`Desconectado: ${socket.id} — razón: ${reason}`);

    if (codigo && salas[codigo]) {
      const sala = salas[codigo];
      const juezActual = sala.jueces.find(j => j.num === numJuez);
      // Solo remover si el socket actual es el registrado para ese número
      if (juezActual && juezActual.id === socket.id) {
        sala.jueces = sala.jueces.filter(j => j.id !== socket.id);
        io.to(codigo).emit('juez-desconectado', { jueces: sala.jueces, numJuez, juecesOcupados: sala.jueces.map(j => j.num) });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
