const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ── ESTADO GLOBAL ──
const salas = {};

// ── HELPERS ──
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

// ── CONEXIONES ──
io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  // ── MESA: CREAR SALA ──
  socket.on('mesa-crear-sala', ({ codigo, tipo, modo, numJueces, categoria, ronda }) => {
    if (salas[codigo]) {
      socket.emit('error-sala', { msg: 'Esa sala ya existe' });
      return;
    }
    salas[codigo] = {
      codigo,
      tipo,
      modo,
      numJueces,
      categoria,
      ronda,
      jueces: [],
      competidores: [],
      turnoIndex: 0,
      estado: 'setup',
      mesaId: socket.id
    };
    socket.join(codigo);
    socket.emit('sala-creada', { codigo, tipo, modo, numJueces, categoria, ronda });
    console.log(`Sala creada: ${codigo}`);
  });

  // ── MESA: INICIAR COMPETENCIA ──
  socket.on('mesa-iniciar', ({ codigo, competidores, modo, tipo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.competidores = competidores.map((c, i) => ({
      id: i,
      nombre: c.nombre,
      puntajes: [],
      total: null
    }));
    sala.turnoIndex = 0;
    sala.estado = 'activo';
    io.to(codigo).emit('competencia-iniciada', {
      competidores: sala.competidores,
      modo: sala.modo,
      tipo: sala.tipo
    });
  });

  // ── MESA: TURNO ──
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
    sala.jueces = sala.jueces.filter(j => j.num !== numJuez);
    sala.jueces.push({ id: socket.id, num: numJuez, nombre });
    socket.join(codigo);
    socket.data.codigo = codigo;
    socket.data.numJuez = numJuez;

    socket.emit('juez-ok', {
      sala: {
        codigo: sala.codigo,
        tipo: sala.tipo,
        modo: sala.modo,
        numJueces: sala.numJueces,
        categoria: sala.categoria,
        ronda: sala.ronda,
        estado: sala.estado,
        competidores: sala.competidores,
        turnoIndex: sala.turnoIndex
      }
    });

    // Si ya hay competencia activa enviar turno actual
    if (sala.estado === 'activo' && sala.competidores.length > 0) {
      const turnoIndex = sala.turnoIndex;
      const modo = sala.modo;
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
      socket.emit('turno-actualizado', { turno, salaInfo: { tipo: sala.tipo } });
    }

    io.to(codigo).emit('juez-conectado', { jueces: sala.jueces, nombre });
    console.log(`Juez ${numJuez} (${nombre}) en sala ${codigo}`);
  });

  // ── JUEZ: ENVIAR PUNTAJE ──
  socket.on('juez-puntaje', ({ codigo, competidorId, precision, presentacion }) => {
    const sala = salas[codigo];
    if (!sala) return;

    const comp = sala.competidores.find(c => c.id === competidorId);
    if (!comp) return;

    const numJuez = socket.data.numJuez;
    comp.puntajes = comp.puntajes.filter(p => p.juez !== numJuez);
    comp.puntajes.push({ juez: numJuez, precision, presentacion });

    io.to(codigo).emit('puntaje-recibido', {
      competidorId,
      juezNum: numJuez,
      totalPuntajes: comp.puntajes.length,
      numJueces: sala.numJueces
    });

    if (comp.puntajes.length === sala.numJueces) {
      comp.total = calcularTotal(comp.puntajes, sala.numJueces);
      io.to(codigo).emit('ranking-actualizado', { ranking: getRanking(sala) });
    }
  });

  // ── MESA: REVELAR ──
  socket.on('mesa-revelar', ({ codigo, turnoIndex }) => {
    const sala = salas[codigo];
    if (!sala) return;

    const modo = sala.modo;
    let datos = {};

    if (modo === '1v1-simultaneo') {
      const a = sala.competidores[turnoIndex];
      const b = sala.competidores[turnoIndex + 1];
      datos = { tipo: '1v1', competidorA: a, competidorB: b };
    } else if (modo === '1v1-secuencial') {
      const a = sala.competidores[turnoIndex];
      const b = sala.competidores[turnoIndex + 1];
      datos = { tipo: '1v1', competidorA: a, competidorB: b };
    } else {
      const c = sala.competidores[turnoIndex];
      datos = { tipo: 'cutoff', competidor: c, ranking: getRanking(sala) };
    }

    io.to(codigo).emit('puntaje-revelado', datos);
  });

  // ── MESA: CORTE ──
  socket.on('mesa-corte', ({ codigo, topN }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const ranking = getRanking(sala);
    io.to(codigo).emit('corte-aplicado', { ranking, topN });
  });

  // ── DESCONEXIÓN ──
  socket.on('disconnect', () => {
    const codigo = socket.data.codigo;
    if (codigo && salas[codigo]) {
      salas[codigo].jueces = salas[codigo].jueces.filter(j => j.id !== socket.id);
      io.to(codigo).emit('juez-desconectado', { jueces: salas[codigo].jueces });
    }
    console.log('Desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
