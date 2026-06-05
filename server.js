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

function calcularTotal(puntajes, numJueces) {
  if (puntajes.length < numJueces) return null;
  const valores = puntajes.map(p => p.precision + p.presentacion);
  if (numJueces >= 5) {
    const sorted = [...valores].sort((a, b) => a - b);
    const recortados = sorted.slice(1, -1);
    return recortados.reduce((a, b) => a + b, 0) / recortados.length;
  }
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

function getRanking(sala) {
  return sala.competidores
    .filter(c => c.total !== null)
    .sort((a, b) => b.total - a.total)
    .map((c, i) => ({ ...c, pos: i + 1 }));
}

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

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
      poomsae1: null,
      poomsae2: null
    };
    socket.join(codigo);
    socket.emit('sala-creada', { codigo, tipo, modo, numJueces, categoria, ronda });
    console.log(`Sala creada: ${codigo}`);
  });

  socket.on('mesa-iniciar', ({ codigo, competidores, modo, tipo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.competidores = competidores.map((c, i) => ({
      id: i, nombre: c.nombre, puntajes: [], total: null
    }));
    sala.turnoIndex = 0;
    sala.estado = 'activo';
    io.to(codigo).emit('competencia-iniciada', {
      competidores: sala.competidores, modo: sala.modo, tipo: sala.tipo
    });
  });

  socket.on('mesa-turno', ({ codigo, turnoIndex, modo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.turnoIndex = turnoIndex;
    let turno = {};
    if (modo === '1v1-simultaneo') {
      turno = {
        tipo: '1v1-simultaneo',
        competidorA: sala.competidores[turnoIndex] || null,
        competidorB: sala.competidores[turnoIndex + 1] || null
      };
    } else if (modo === '1v1-secuencial') {
      turno = {
        tipo: '1v1-secuencial',
        competidorA: sala.competidores[turnoIndex] || null,
        competidorB: sala.competidores[turnoIndex + 1] || null,
        fase: 'A'
      };
    } else {
      turno = {
        tipo: 'cutoff',
        competidor: sala.competidores[turnoIndex] || null,
        numero: turnoIndex + 1,
        total: sala.competidores.length
      };
    }
    io.to(codigo).emit('turno-actualizado', { turno, salaInfo: { tipo: sala.tipo } });
  });

  // ── JUEZ: UNIRSE ──
  socket.on('juez-unirse', ({ codigo, nombre, numJuez }) => {
    const sala = salas[codigo];
    if (!sala) {
      socket.emit('error-sala', { msg: 'Sala no encontrada' });
      return;
    }
    // Eliminar sesión anterior del mismo número
    sala.jueces = sala.jueces.filter(j => j.num !== numJuez);
    sala.jueces.push({ id: socket.id, num: numJuez, nombre });
    socket.join(codigo);
    socket.data.codigo = codigo;
    socket.data.numJuez = numJuez;
    socket.data.nombre = nombre;

    socket.emit('juez-ok', {
      sala: {
        codigo: sala.codigo, tipo: sala.tipo, modo: sala.modo,
        numJueces: sala.numJueces, categoria: sala.categoria,
        ronda: sala.ronda, estado: sala.estado,
        competidores: sala.competidores, turnoIndex: sala.turnoIndex
      }
    });

    // Si hay competencia activa, reenviar turno actual
    if (sala.estado === 'activo' && sala.competidores.length > 0) {
      const ti = sala.turnoIndex;
      const m = sala.modo;
      let turno = {};
      if (m === '1v1-simultaneo') {
        turno = {
          tipo: '1v1-simultaneo',
          competidorA: sala.competidores[ti] || null,
          competidorB: sala.competidores[ti + 1] || null
        };
      } else if (m === '1v1-secuencial') {
        turno = {
          tipo: '1v1-secuencial',
          competidorA: sala.competidores[ti] || null,
          competidorB: sala.competidores[ti + 1] || null,
          fase: 'A'
        };
      } else {
        turno = {
          tipo: 'cutoff',
          competidor: sala.competidores[ti] || null,
          numero: ti + 1,
          total: sala.competidores.length
        };
      }
      socket.emit('turno-actualizado', { turno, salaInfo: { tipo: sala.tipo } });
    }

    // Notificar a TODOS incluyendo mesa
    io.to(codigo).emit('juez-conectado', {
      jueces: sala.jueces,
      nombre,
      numJuez
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
    // ── MESA: CONTROL CRONÓMETRO CON FASE ──
  socket.on('mesa-control', ({ codigo, accion, fase }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.faseActual = fase;
    sala.cronoActivo = accion === 'iniciar';
    io.to(codigo).emit('control-actualizado', { accion, fase });
  });
  socket.on('juez-precision', ({ codigo, competidorId, precision, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const numJuez = socket.data.numJuez;
    // Emitir a mesa para mostrar en tiempo real
    io.to(codigo).emit('precision-recibida', {
      competidorId, juezNum: numJuez, precision, poomsae
    });
    console.log(`Precisión J${numJuez} comp${competidorId}: ${precision}`);
  });

  // ── FIN DE SALA ──
  socket.on('mesa-fin-sala', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    io.to(codigo).emit('sala-finalizada');
    delete salas[codigo];
  });


  // ── JUEZ: PUNTAJE ──
    socket.on('juez-puntaje', ({ codigo, competidorId, precision, presentacion, desglose, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;

    const comp = sala.competidores.find(c => c.id === competidorId);
    if (!comp) {
      console.log(`⚠️ Comp no encontrado: ${competidorId} en sala ${codigo}`);
      console.log(`Competidores disponibles:`, sala.competidores.map(c => c.id));
      return;
    }

    const numJuez = socket.data.numJuez;
    comp.puntajes = comp.puntajes.filter(p => p.juez !== numJuez);
    comp.puntajes.push({ juez: numJuez, precision, presentacion, desglose });

    const totalRecibidos = comp.puntajes.length;

    // Calcular total de este competidor si todos calificaron
    let totalComp = null;
    if (totalRecibidos === sala.numJueces) {
      totalComp = calcularTotal(comp.puntajes, sala.numJueces);
      comp.total = totalComp;
    }

    // Emitir inmediatamente con toda la info
    io.to(codigo).emit('puntaje-recibido', {
      competidorId,
      competidorNombre: comp.nombre,
      juezNum: numJuez,
      totalPuntajes: totalRecibidos,
      numJueces: sala.numJueces,
      precision,
      presentacion,
      desglose,
      totalComp,
      poomsae
    });

    socket.emit('puntaje-confirmado', { competidorId, juezNum: numJuez });
    console.log(`Puntaje J${numJuez} → ${comp.nombre}(${competidorId}): prec=${precision} pres=${presentacion}`);
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
  socket.on('mesa-sortear-poomsae', ({ codigo, numero, poomsae }) => {
    const sala = salas[codigo];
    if (!sala) return;
    if (numero === 1) sala.poomsae1 = poomsae;
    else sala.poomsae2 = poomsae;
    io.to(codigo).emit('poomsae-sorteada', { numero, poomsae });
  });

  // ── CRONÓMETRO ──
  socket.on('mesa-cronometro', ({ codigo, accion, duracion, tipo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    io.to(codigo).emit('cronometro-update', { accion, duracion, tipo });
  });

  // ── CORTE ──
  socket.on('mesa-corte', ({ codigo, topN }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const ranking = getRanking(sala);
    io.to(codigo).emit('corte-aplicado', { ranking, topN });
  });

  // ── RESTAURAR SALA ──
  socket.on('mesa-restaurar', ({ codigo }) => {
    if (salas[codigo]) {
      const sala = salas[codigo];
      // Conservar jueces conectados, resetear competencia
      sala.competidores = [];
      sala.turnoIndex = 0;
      sala.estado = 'setup';
      sala.poomsae1 = null;
      sala.poomsae2 = null;
      io.to(codigo).emit('sistema-restaurado');
    }
  });

  // ── DESCONEXIÓN ──
  socket.on('disconnect', (reason) => {
    const codigo = socket.data.codigo;
    const numJuez = socket.data.numJuez;
    console.log(`Desconectado: ${socket.id} — razón: ${reason}`);

    if (codigo && salas[codigo]) {
      // Solo remover si el socket actual es el registrado para ese número
      const sala = salas[codigo];
      const juezActual = sala.jueces.find(j => j.num === numJuez);
      if (juezActual && juezActual.id === socket.id) {
        sala.jueces = sala.jueces.filter(j => j.id !== socket.id);
        io.to(codigo).emit('juez-desconectado', {
          jueces: sala.jueces,
          numJuez
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
