#!/usr/bin/env node
// ── BUILD del paquete protegido (Fase 3) ──
// Genera dist/ con:
//   • server/auth/license compilados a BYTECODE (.jsc) — no editables como texto
//   • cliente con el JS embebido MINIFICADO (terser)
//   • node_modules, clave pública y package.json de producción
// El proveedor construye dist/ y entrega ESO al cliente (no el código fuente).
//
//   npm install   (una vez, con Internet, para traer terser)
//   npm run build

const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');
const { minify } = require('terser');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

function log(s) { console.log('  ' + s); }

async function build() {
  console.log('Construyendo paquete protegido en dist/ …');
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'public'), { recursive: true });

  // 1) Servidor → bytecode. Los stubs permiten que require('./auth') cargue el .jsc.
  for (const m of ['server', 'auth', 'license']) {
    bytenode.compileFile({ filename: path.join(ROOT, `${m}.js`), output: path.join(DIST, `${m}.jsc`) });
    log(`bytecode: ${m}.jsc`);
  }
  fs.writeFileSync(path.join(DIST, 'auth.js'), "module.exports = require('./auth.jsc');\n");
  fs.writeFileSync(path.join(DIST, 'license.js'), "module.exports = require('./license.jsc');\n");
  fs.writeFileSync(path.join(DIST, 'server.js'), "require('bytenode');\nrequire('./server.jsc');\n");

  // 2) Cliente → minificar el JS embebido de cada HTML (preservando nombres
  //    globales para no romper los onclick).
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) {
    const src = path.join(ROOT, 'public', f);
    const dst = path.join(DIST, 'public', f);
    if (fs.statSync(src).isDirectory()) { fs.cpSync(src, dst, { recursive: true }); continue; }
    if (!f.endsWith('.html')) { fs.copyFileSync(src, dst); continue; }

    let html = fs.readFileSync(src, 'utf8');
    const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    let salida = html, ahorro = 0;
    for (const b of bloques) {
      const original = b[1];
      try {
        const r = await minify(original, {
          compress: true,
          mangle: { toplevel: false },   // NO renombrar funciones globales (onclick)
          format: { comments: false },
        });
        if (r.code) {
          salida = salida.replace(`<script>${original}</script>`, `<script>${r.code}</script>`);
          ahorro += original.length - r.code.length;
        }
      } catch (e) {
        console.warn(`  ⚠️ no se pudo minificar un bloque de ${f}: ${e.message}`);
      }
    }
    fs.writeFileSync(dst, salida);
    log(`cliente: ${f} (${bloques.length} bloques, -${(ahorro / 1024).toFixed(1)} KB)`);
  }

  // 3) Activos de runtime — incluir TU clave pública (la de data/) si existe;
  //    si no, la de demostración. Así el paquete valida las licencias que tú firmas.
  const pubPropia = path.join(ROOT, 'data', 'license-public.pem');
  const pubFuente = fs.existsSync(pubPropia) ? pubPropia : path.join(ROOT, 'license-public.pem');
  fs.copyFileSync(pubFuente, path.join(DIST, 'license-public.pem'));
  log(fs.existsSync(pubPropia)
    ? 'clave publica PROPIA incluida (data/license-public.pem)'
    : '⚠️ clave publica DEMO incluida — ejecuta "node tools/licencia.js init" para usar la tuya');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  pkg.scripts = { start: 'node server.js' };
  fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(pkg, null, 2));
  log('package.json (producción)');

  // 4) node_modules (incluye bytenode, necesario para cargar el bytecode)
  fs.cpSync(path.join(ROOT, 'node_modules'), path.join(DIST, 'node_modules'), { recursive: true });
  log('node_modules copiado');

  console.log('\n✓ Listo. Entrega la carpeta dist/ al cliente.');
  console.log('  Para arrancarla:  cd dist && node server.js');
}

build().catch(e => { console.error('Error en build:', e); process.exit(1); });
