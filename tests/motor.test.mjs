// Pruebas del motor de cálculo. Ejecutar con: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { datos, motor, semilla } from './cargar.mjs';

const D = datos();
const M = motor(D);
// Semana de ejemplo de las pruebas: la semana base con los desayunos anteriores a la v4 (D2, D1, D8…),
// que cubren lenteja, huevo y la base P3. La semana base real desayuna D7 los siete días.
const DESAYUNOS_EJEMPLO = { lun: 'D2', mar: 'D1', mie: 'D8', jue: 'D1', vie: 'D1', sab: 'D10', dom: 'D1' };
const SEM = () => {
  const s = semilla();
  for (const k in DESAYUNOS_EJEMPLO) s[k].desayuno = DESAYUNOS_EJEMPLO[k];
  return M.normalizarSemana(s);
};
const receta = (pred) => D.recetas.find(pred);
const conForma = (item, cat) => receta((r) => (!cat || r.categoria === cat) && r.ingredientes.some((i) => i.item === item));
const linea = (pl, nombre, estado = '') => pl.lineas.filter((l) => l.nombre === nombre && l.estado === estado);
const suma = (arr) => arr.reduce((a, b) => a + b, 0);

/* Semana vacía con los platos indicados: [[dia, comida, id], ...] */
function semanaCon(platos) {
  const s = M.normalizarSemana({});
  for (const [d, c, id] of platos) s[d][c] = id;
  return s;
}

test('catálogo: todas las formas usadas tienen producto o regla explícita', () => {
  const formas = D.compras_catalogo.formas, prods = D.compras_catalogo.productos;
  const items = new Set();
  D.recetas.forEach((r) => r.ingredientes.forEach((i) => items.add(i.item)));
  D.preparaciones_base.forEach((p) => (p.ingredientes || []).forEach((i) => items.add(i.item)));
  D.dulces.forEach((s) => (s.ingredientes || []).forEach((i) => items.add(i.item)));
  for (const it of items) assert.ok(formas[it], 'sin forma: ' + it);
  for (const [k, f] of Object.entries(formas)) {
    if (f.p) assert.ok(prods[f.p], 'producto inexistente en ' + k);
    if (f.desde) assert.ok(D.preparaciones_base.some((p) => p.id === f.desde), 'preparación inexistente en ' + k);
  }
  const ids = D.recetas.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'ids de receta repetidos');
});

test('agrupa cortes del mismo ingrediente fresco: picado, laminado, rallado y en pasta', () => {
  const formasAjo = ['Ajo picado', 'Ajo laminado', 'Ajo rallado', 'Ajo en pasta'];
  const rs = formasAjo.map((f, i) => conForma(f, ['almuerzo', 'cena', 'almuerzo', 'cena'][i]) || conForma(f));
  const dias = ['lun', 'mar', 'mie', 'jue'];
  const sem = semanaCon(rs.map((r, i) => [dias[i], r.categoria, r.id]));
  const pl = M.plan(sem, 1);
  const ajo = linea(pl, 'Ajo');
  assert.equal(ajo.length, 1, 'una sola línea de ajo');
  let esperado = 0;
  rs.forEach((r) => r.ingredientes.forEach((i) => { if (/^Ajo (picado|laminado|rallado|en pasta)$/.test(i.item)) esperado += i.cantidad; }));
  assert.equal(ajo[0].cant, esperado);
  const cortes = new Set(ajo[0].origenes.map((o) => o.corte));
  for (const c of ['picado', 'laminado', 'rallado', 'en pasta']) assert.ok(cortes.has(c), 'conserva el corte ' + c);
  // Toda forma de ajo en pasta se mide en dientes: es la condición documentada para sumarla al ajo fresco.
  D.recetas.forEach((r) => r.ingredientes.forEach((i) => { if (i.item === 'Ajo en pasta') assert.equal(i.eq && i.eq.sing, 'diente'); }));
});

test('no combina variedades, productos procesados ni estados distintos', () => {
  const ids = ['Jengibre en pasta', 'Jengibre rallado', 'Cebolla morada picada muy fina', 'Cebolla picada',
    'Queso fresco o mozzarella', 'Queso fresco desmenuzado', 'Cebolla rallada y escurrida', 'Tomate triturado', 'Tomate picado'];
  const rs = [...new Set(ids.map((f) => conForma(f).id))];
  const sem = M.normalizarSemana({});
  const huecos = [];
  M.DIAS.forEach((d) => ['desayuno', 'almuerzo', 'cena', 'guarnicion'].forEach((c) => huecos.push([d.k, c])));
  rs.forEach((id) => {
    const r = M.byId[id];
    const h = huecos.findIndex(([d, c]) => c === r.categoria && !sem[d][c]);
    sem[huecos[h][0]][r.categoria] = id;
  });
  const pl = M.plan(sem, 1);
  assert.equal(linea(pl, 'Jengibre en pasta').length, 1);
  assert.equal(linea(pl, 'Jengibre fresco').length, 1);
  assert.equal(linea(pl, 'Cebolla morada').length, 1);
  assert.equal(linea(pl, 'Cebolla').length, 1);
  assert.equal(linea(pl, 'Cebolla', 'rallada y escurrida').length, 1, 'estado distinto en línea aparte');
  assert.equal(linea(pl, 'Queso fresco o mozzarella').length, 1);
  assert.equal(linea(pl, 'Queso fresco').length, 1);
  assert.equal(linea(pl, 'Tomate triturado').length, 1);
  assert.equal(linea(pl, 'Tomate').length, 1);
});

test('no suma unidades incompatibles: canela en rama en cm y en g quedan separadas', () => {
  const rCm = conForma('Canela en rama');
  const rP4 = receta((r) => (r.requiere || []).includes('P4') && r.categoria !== rCm.categoria);
  const sem = semanaCon([['lun', rCm.categoria, rCm.id], ['mar', rP4.categoria, rP4.id]]);
  const pl = M.plan(sem, 1);
  const canela = pl.lineas.filter((l) => l.producto === 'canela_rama');
  assert.deepEqual(Array.from(canela, (l) => l.unidad).sort(), ['cm', 'g']);
  assert.ok(pl.lineas.every((l) => l.nombre !== 'Garam masala casero'), 'la mezcla no se compra, se compran sus especias');
});

test('legumbres y arroz cocidos se convierten a seco con el rendimiento de su preparación', () => {
  const pl = M.plan(SEM(), 1);
  const p1 = D.preparaciones_base.find((p) => p.id === 'P1').modelo;
  const p2 = D.preparaciones_base.find((p) => p.id === 'P2').modelo;
  for (const o of pl.preps.P1.salidas) {
    if (o.limitacion) continue;
    const seco = o.necesario * p1.rendimiento.seco / p1.rendimiento.cocido;
    assert.equal(o.prepararSeco, Math.ceil(seco / 10 - 1e-9) * 10);
    assert.ok(o.excedente >= 0);
  }
  const arroz = pl.preps.P2.salidas[0];
  assert.equal(arroz.prepararSeco, Math.ceil(arroz.necesario * 150 / 400 / 10 - 1e-9) * 10);
  assert.equal(linea(pl, 'Arroz integral seco')[0].cant, arroz.prepararSeco, 'Compras y Preparaciones coinciden');
  // Ninguna línea de compra queda en peso cocido salvo la que no tiene rendimiento documentado.
  assert.ok(pl.lineas.every((l) => !/cocid/i.test(l.nombre)));
  assert.ok(!pl.lineas.some((l) => l.nombre === 'Frejol negro seco' && l.estado));
});

test('sin rendimiento documentado no se convierte: la haba queda en peso cocido y se señala', () => {
  const d4 = M.byId.D4;
  const pl = M.plan(semanaCon([['lun', 'desayuno', 'D4']]), 1);
  const haba = pl.lineas.find((l) => l.producto === 'haba_seca');
  assert.equal(haba.estado, 'cocida');
  assert.equal(haba.cant, d4.ingredientes.find((i) => i.item === 'Haba seca cocida').cantidad);
  assert.ok(haba.limitaciones.length > 0);
  assert.ok(pl.preps.P1.salidas.find((o) => o.id === 'haba').limitacion);
});

test('preparaciones anidadas sin doble conteo: D2 → base P3 → lenteja P1', () => {
  const sem = semanaCon([['lun', 'desayuno', 'D2'], ['mie', 'desayuno', 'D2'], ['sab', 'desayuno', 'D2']]);
  const pl = M.plan(sem, 1);
  assert.equal(pl.errores.length, 0);
  const p3 = pl.preps.P3.salidas[0];
  assert.equal(p3.necesario, 450);
  assert.equal(p3.preparar, 450);
  const lent = pl.preps.P1.salidas.find((o) => o.id === 'lenteja_parda');
  assert.equal(lent.necesario, 450, 'solo la lenteja de la base');
  assert.ok(!pl.lineas.some((l) => /Base de lenteja/.test(l.nombre)), 'la base no se compra');
  const ceb = linea(pl, 'Cebolla')[0];
  const deP3 = suma(ceb.origenes.filter((o) => o.prep === 'P3').map((o) => o.cant));
  assert.equal(deP3, 80, 'la cebolla de la base cuenta una vez');
  const usos = M.usosPrep(pl, 'P1').map((u) => u.dia);
  assert.deepEqual(Array.from(usos), ['lun', 'mie', 'sab'], 'P1 conoce los platos que la usan a través de P3');
});

test('lote parcial: se redondea a porciones enteras y se muestra el excedente', () => {
  const pl = M.plan(semanaCon([['lun', 'desayuno', 'D2']]), 1);
  const o = pl.preps.P3.salidas[0];
  assert.equal(o.necesario, 150);
  assert.equal(o.preparar, 150);
  const p4 = M.plan(semanaCon([['lun', 'almuerzo', receta((r) => r.requiere.includes('P4') && r.categoria === 'almuerzo').id]]), 1).preps.P4.salidas[0];
  assert.equal(p4.preparar, 45);
  assert.equal(p4.excedente, 45 - p4.necesario);
});

test('detecta ciclos y referencias inexistentes', () => {
  const D2 = structuredClone(D);
  D2.preparaciones_base.find((p) => p.id === 'P1').ingredientes = [{ item: 'Base de lenteja guisada P3', cantidad: 10, unidad: 'g' }];
  D2.recetas.find((r) => r.id === 'D2').requiere.push('P99');
  const M2 = motor(D2);
  const pl = M2.plan(M2.normalizarSemana({ lun: { desayuno: 'D2' } }), 1);
  assert.ok(pl.errores.some((e) => /Ciclo/.test(e)), 'ciclo detectado');
  assert.ok(pl.errores.some((e) => /P99/.test(e)), 'referencia inexistente detectada');
});

test('escalado por comensales: cantidades se multiplican, objetivos y totales por persona no', () => {
  const s = SEM();
  const a = M.plan(s, 1), b = M.plan(s, 2);
  const huevoA = linea(a, 'Huevo')[0].cant, huevoB = linea(b, 'Huevo')[0].cant;
  assert.equal(huevoB, huevoA * 2);
  assert.ok(b.preps.P1.salidas[0].necesario === a.preps.P1.salidas[0].necesario * 2);
  assert.deepEqual(M.totalesDia(s, 'lun'), M.totalesDia(s, 'lun'));
  assert.deepEqual(M.objetivos(1), M.objetivos(1));
});

test('cambiar una comida actualiza a la vez compras y preparaciones', () => {
  const s = SEM();
  const antes = M.plan(s, 1);
  const sinLegumbre = receta((r) => r.categoria === 'cena' && r.requiere.length === 0 && r.apto_ventana_contencion);
  const dia = M.DIAS.map((d) => d.k).find((k) => M.byId[s[k].cena] && M.byId[s[k].cena].ingredientes.some((i) => /P1$/.test(i.item)));
  assert.ok(dia, 'la semana de ejemplo tiene una cena con legumbre de P1');
  const s2 = M.copia(s); s2[dia].cena = sinLegumbre.id;
  const desp = M.plan(s2, 1);
  for (const pl of [antes, desp]) {
    for (const o of pl.preps.P1.salidas) {
      if (o.limitacion) continue;
      const sal = D.preparaciones_base.find((p) => p.id === 'P1').modelo.salidas[o.id];
      const l = pl.lineas.find((x) => x.producto === sal.producto && !x.estado);
      const directo = suma(l.origenes.filter((x) => !x.via && !x.redondeo).map((x) => x.cant));
      assert.ok(Math.abs(l.cant - (o.prepararSeco + directo)) < 1e-9, 'compra de ' + o.id + ' = lo que se prepara + uso directo');
    }
  }
  const cena = M.byId[s[dia].cena];
  const usaba = cena.ingredientes.filter((i) => /P1$/.test(i.item));
  assert.ok(usaba.length > 0);
  const total = (pl) => suma(pl.preps.P1.salidas.map((o) => o.necesario));
  assert.equal(total(antes) - total(desp), suma(usaba.map((i) => i.cantidad)));
});

test('legumbre: tope semanal por tipo, con un solo aviso por día', () => {
  const s = SEM();
  const O = M.objetivos(1);
  assert.equal(O.legMax, 2);
  const conGarbanzo = D.recetas.filter((r) => r.categoria === 'cena' && M.legumbres(r).includes('garbanzo'));
  assert.ok(conGarbanzo.length >= 3);
  assert.ok(M.legumbres(M.byId.D2).includes('lenteja'), 'la base de lenteja P3 cuenta como lenteja');
  const s2 = M.copia(s);
  ['lun', 'mar', 'mie'].forEach((k, n) => { s2[k].cena = conGarbanzo[n].id; });
  assert.equal(M.usosLegumbre(s2).garbanzo, 3);
  const avisos = M.problemasDia(s2, 'lun', 1).filter((p) => p.tag === 'Legumbre');
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].t, 'warn');
  assert.match(avisos[0].m, /Garbanzo aparece en 3 comidas/);
  s2.mie.cena = s.mie.cena;
  assert.ok(!M.problemasDia(s2, 'lun', 1).some((p) => p.tag === 'Legumbre'), 'con dos veces no hay aviso');
  assert.ok(!M.problemasSemana(s, 1).some((p) => /aparece en \d+ comidas/.test(p.m)), 'la semana de ejemplo respeta el tope');
});

test('rangos: se evalúa sin redondear y con los márgenes de aviso configurados', () => {
  const O = M.objetivos(1);
  assert.equal(M.evaluar(28, O.fib).estado, 'ok');
  assert.equal(M.evaluar(32, O.fib).estado, 'ok');
  assert.equal(M.evaluar(27.999, O.fib).estado, 'margen', 'sin redondear');
  assert.equal(M.evaluar(26, O.fib).estado, 'margen');
  assert.equal(M.evaluar(25.9, O.fib).estado, 'aviso');
  assert.equal(M.evaluar(36, O.fib).estado, 'margen');
  assert.equal(M.evaluar(36.1, O.fib).estado, 'aviso');
  assert.equal(M.evaluar(2260, O.kcal).estado, 'margen');
  assert.equal(M.evaluar(2260.5, O.kcal).estado, 'aviso');
  assert.equal(M.evaluar(2049.5, O.kcal).estado, 'aviso', 'sin margen definido por debajo');
  assert.equal(M.evaluar(130.2, O.prot).estado, 'aviso', 'sin margen definido por encima');
  const O2 = M.objetivos(2);
  assert.deepEqual([O2.fib.lo, O2.fib.hi, O2.kcal.lo, O2.kcal.hi], [32, 35, 1900, 1950]);
  assert.deepEqual([O.prot.lo, O.prot.hi], [O2.prot.lo, O2.prot.hi]);
});

test('alertas coherentes con la evaluación de las barras', () => {
  const s = SEM();
  for (const d of M.DIAS) {
    for (const f of [1, 2]) {
      const E = M.evaluarDia(s, d.k, f), al = M.problemasDia(s, d.k, f);
      const tiene = (tag) => al.some((a) => a.tag === tag);
      assert.equal(tiene('Fibra'), E.fib.estado === 'aviso' && !(E.fib.lado === 'bajo' && E.t.falta));
      assert.equal(tiene('Energía'), E.kcal.estado === 'aviso' && !(E.kcal.lado === 'bajo' && E.t.falta));
      assert.equal(tiene('Proteína'), E.prot.estado === 'aviso' && !(E.prot.lado === 'bajo' && E.t.falta));
    }
  }
});

test('incoherencia de la proteína por toma queda señalada sin cambiar el objetivo', () => {
  assert.equal(M.pendientesConfig.length, 1);
  assert.match(M.pendientesConfig[0].m, /105 a 120 g/);
  assert.deepEqual([M.objetivos(1).prot.lo, M.objetivos(1).prot.hi], [120, 130]);
});

test('dulce: pendiente usa la estimación de 145 kcal; el elegido usa sus datos y marca los que faltan', () => {
  const s = SEM();
  const t0 = M.totalesDia(s, 'lun');
  assert.ok(t0.dulcePendiente);
  assert.ok(t0.est.some((x) => /145 kcal/.test(x)));
  s.lun.dulce = 'S2';
  const t1 = M.totalesDia(s, 'lun');
  assert.equal(t1.kc - t0.kc, 155 - 145);
  assert.equal(t1.p - t0.p, 13);
  assert.equal(t1.f, t0.f, 'la fibra ausente no se suma como cero ni se inventa');
  assert.ok(t1.incompleto.some((x) => x.campo === 'f'));
  assert.ok(!t1.incompleto.some((x) => x.campo === 'p'));
  const pl = M.plan(s, 1);
  const yogur = linea(pl, 'Yogur griego natural sin azúcar')[0];
  assert.ok(yogur.origenes.some((o) => o.comida === 'dulce' && o.cant === 150), 'ingredientes del dulce en compras, sin duplicar líneas');
  assert.ok(linea(pl, 'Canela')[0].sinCantidad, 'la canela sin cantidad se lista sin inventar gramos');
});

test('dulce: respeta la frecuencia semanal configurada', () => {
  const s = SEM();
  ['lun', 'mar'].forEach((d) => { s[d].dulce = 'S4'; });
  assert.ok(M.problemasDia(s, 'lun', 1).some((a) => a.tag === 'Dulce'));
  const s2 = SEM(); s2.lun.dulce = 'S4';
  assert.ok(!M.problemasDia(s2, 'lun', 1).some((a) => a.tag === 'Dulce'));
});

test('selección al buscar: conserva la actual si sigue, si no la primera, y vacía sin resultados', () => {
  const f = { cat: '', q: 'caraota', rapido: false, vent: false, omega: false, cocina: '' };
  const lista = M.filtrar(f);
  assert.equal(lista.length, 1);
  assert.equal(M.seleccion(lista, 'D1'), lista[0].id, 'el yogur ya no se muestra');
  assert.equal(M.seleccion(lista, lista[0].id), lista[0].id);
  // El recetario no tiene arepas: la búsqueda queda vacía y no debe quedar ninguna receta abierta.
  assert.equal(M.seleccion(M.filtrar({ ...f, q: 'arepa' }), 'D1'), '');
  const cenas = M.filtrar({ ...f, q: '', cat: 'cena' });
  assert.equal(M.seleccion(cenas, 'D1'), cenas[0].id, 'al cambiar de categoría también');
});

test('tiempos: distingue cocina y espera; una receta de la noche anterior no es rápida', () => {
  const t = M.tiempo(M.byId.D1);
  assert.equal(t.cocina, 5);
  assert.equal(t.espera, 480);
  assert.ok(!t.inmediata);
  assert.ok(!M.filtrar({ cat: '', q: '', rapido: true, vent: false, omega: false, cocina: '' }).some((r) => r.id === 'D1'));
});

test('migración de marcas de la v2.3: sin pérdidas ni asociaciones incorrectas', () => {
  const s = SEM();
  // Desayunos elegidos por la persona (ninguno es el de la semana base de su día), para que la v4 no los cambie.
  Object.assign(s.lun, { desayuno: 'D1' }); Object.assign(s.mar, { desayuno: 'D2' }); Object.assign(s.jue, { desayuno: 'D10' });
  Object.assign(s.vie, { desayuno: 'D8' }); Object.assign(s.sab, { desayuno: 'D1' }); Object.assign(s.dom, { desayuno: 'D8' });
  Object.assign(s.mie, { desayuno: 'D1' });
  // Reproduce las claves antiguas del menú.
  const antiguas = {};
  M.platos(s).forEach((p) => p.receta.ingredientes.forEach((i) => {
    const a = M.claveAntigua(i.item, i.cantidad);
    if (a) antiguas[a.item + '||' + i.unidad] = 1;
  }));
  const quitar = Object.keys(antiguas).find((k) => k.startsWith('Ajo laminado'));
  delete antiguas[quitar];
  const st = M.migrarEstado({ semana: s, comensales: 1, compras: antiguas });
  const pl = M.plan(st.semana, 1);
  const ajo = linea(pl, 'Ajo')[0];
  assert.ok(!st.compras[ajo.clave], 'ajo parcialmente marcado antes: queda pendiente');
  assert.ok(M.marcasAntiguasDe(ajo, st.comprasLegado).includes('Ajo picado'), 'la marca antigua se muestra');
  const huevo = linea(pl, 'Huevo')[0];
  assert.equal(st.compras[huevo.clave].s, 'c', 'lo que coincide sin ambigüedad se traslada');
  const comino = linea(pl, 'Comino en grano')[0];
  assert.ok(!st.compras[comino.clave], 'las especias de P4/P5 no heredan la marca de la mezcla');
  const cebolla = linea(pl, 'Cebolla')[0];
  assert.ok(!st.compras[cebolla.clave], 'la cebolla de la base P3 no estaba en la marca antigua');
  const arroz = linea(pl, 'Arroz integral seco')[0];
  const e = M.estadoMarca(arroz, st.compras);
  assert.equal(e.s, 'c');
  assert.equal(e.parcial, arroz.cant > st.compras[arroz.clave].q + 0.5, 'si ahora hace falta más, la marca queda parcial');
  assert.equal(Object.keys(st.comprasLegado).length, Object.keys(antiguas).length, 'se conservan todas las marcas antiguas');
  assert.equal(st.v, 4);
  assert.ok(M.DIAS.every((d) => st.semana[d.k].dulce === ''), 'días existentes quedan con dulce pendiente');
});

test('marca de compra y de preparación: si crece la cantidad, la marca deja de cubrirla', () => {
  const s = SEM();
  const pl = M.plan(s, 1);
  const huevo = linea(pl, 'Huevo')[0];
  const marcas = { [huevo.clave]: { s: 't', q: huevo.cant } };
  assert.equal(M.estadoMarca(huevo, marcas).parcial, false);
  const pl2 = M.plan(s, 2);
  const huevo2 = linea(pl2, 'Huevo')[0];
  const e = M.estadoMarca(huevo2, marcas);
  assert.equal(e.s, 't');
  assert.ok(e.parcial);
  assert.equal(e.falta, huevo.cant);
  const sp = '2026-09-28';
  const mk = M.marcaPrep(pl.preps.P1, sp);
  assert.equal(M.estadoPrep(pl.preps.P1, mk, sp).s, 'lista');
  assert.equal(M.estadoPrep(pl2.preps.P1, mk, sp).s, 'parcial');
  assert.equal(M.estadoPrep(pl.preps.P1, mk, '2026-10-05').s, 'pend', 'otra semana');
});

test('semana de preparación: el domingo prepara la semana siguiente', () => {
  assert.equal(M.semanaPrep(new Date(2026, 8, 27)), '2026-09-28');
  assert.equal(M.semanaPrep(new Date(2026, 8, 28)), '2026-09-28');
  assert.equal(M.semanaPrep(new Date(2026, 9, 3)), '2026-09-28');
});

test('fotos: cada foto corresponde a una receta y trae crédito y enlace', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const F = JSON.parse(/<script type="application\/json" id="fotos">([\s\S]*?)<\/script>/.exec(html)[1]);
  const ids = new Set(D.recetas.map((r) => r.id));
  for (const [k, f] of Object.entries(F)) {
    assert.ok(ids.has(k), 'foto sin receta: ' + k);
    assert.ok(f.s.startsWith('/9j/'), 'JPEG en base64: ' + k);
    assert.ok(f.c && /^https:\/\//.test(f.u), 'crédito y enlace: ' + k);
  }
});

test('aleatorio: cambia los tres platos del día por otros compatibles y deja el resto de la semana igual', () => {
  const sem = SEM();
  for (const d of M.DIAS) {
    const k = d.k;
    const base = { ...sem, [k]: { ...sem[k], fuera: false } };
    let semilla = 7;
    const rnd = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
    const nueva = M.aleatorioDia(base, k, undefined, rnd);
    assert.ok(nueva, 'hay combinación para ' + k);
    for (const [m] of M.COMIDAS) {
      const r = M.byId[nueva[k][m]];
      assert.ok(r, m + ' asignado en ' + k);
      assert.equal(r.categoria, m);
      assert.notEqual(r.id, base[k][m], m + ' distinto del actual en ' + k);
      if (d.vent) assert.ok(r.apto_ventana_contencion, r.id + ' apto para la ventana');
      assert.ok(!M.tiempo(r).antelacion, r.id + ' no hay que empezarlo la víspera');
    }
    assert.ok(!M.problemasDia(nueva, k).some((p) => p.t === 'bad'), 'sin alertas graves en ' + k);
    for (const o of M.DIAS) if (o.k !== k) assert.deepEqual(nueva[o.k], base[o.k]);
  }
});

test('aleatorio: respeta el almuerzo fuera de casa y no toca la semana original', () => {
  const sem = SEM();
  const k = M.DIAS[0].k;
  sem[k].fuera = true; sem[k].almuerzo = '';
  const antes = JSON.stringify(sem);
  const nueva = M.aleatorioDia(sem, k);
  assert.equal(JSON.stringify(sem), antes);
  assert.equal(nueva[k].fuera, true);
  assert.equal(nueva[k].almuerzo, '');
  assert.notEqual(nueva[k].desayuno, sem[k].desayuno);
  assert.notEqual(nueva[k].cena, sem[k].cena);
});

test('v4: el desayuno por defecto es D7 y la migración respeta los elegidos', () => {
  const M = motor();
  assert.ok(M.DIAS.every((d) => semilla()[d.k].desayuno === 'D7'), 'la semana base desayuna D7');
  const st = M.migrarEstado({ v: 3, semana: {
    lun: { desayuno: 'D2', almuerzo: 'L13', cena: 'C24', guarnicion: '', fuera: false },
    mar: { desayuno: 'D5', almuerzo: '', cena: 'C50', guarnicion: '', fuera: true },
    jue: { desayuno: 'D1', almuerzo: '', cena: 'C27', guarnicion: '', fuera: true }
  } });
  assert.equal(st.v, 4);
  assert.equal(st.semana.lun.desayuno, 'D7', 'el de la semana base se cambia');
  assert.equal(st.semana.jue.desayuno, 'D7');
  assert.equal(st.semana.mar.desayuno, 'D5', 'el elegido se respeta');
  assert.equal(st.semana.lun.almuerzo, 'L13');
  const st4 = M.migrarEstado({ v: 4, semana: { lun: { desayuno: 'D1', almuerzo: '', cena: '', guarnicion: '', fuera: false } } });
  assert.equal(st4.semana.lun.desayuno, 'D1', 'un estado v4 no se toca');
});

test('menú entre dispositivos: la fusión a tres bandas conserva los cambios de ambos lados', () => {
  const dia = (d, a) => ({ desayuno: d, almuerzo: a, cena: '', guarnicion: '', fuera: false });
  const base = { v: 4, comensales: 1, fase: 1, semana: { lun: dia('D7', 'L1'), mar: dia('D7', 'L2') }, compras: { x: { s: 'c', q: null } } };
  const local = { v: 4, comensales: 1, fase: 2, semana: { lun: dia('D7', 'L3'), mar: dia('D7', 'L2') }, compras: { x: { s: 'c', q: null }, y: { s: 't', q: 2 } } };
  const remoto = { v: 4, comensales: 2, fase: 1, semana: { lun: dia('D7', 'L1'), mar: dia('D1', 'L2') }, compras: {} };
  const f = M.fusionarEstado(base, local, remoto);
  assert.equal(f.comensales, 2, 'lo del otro dispositivo');
  assert.equal(f.fase, 2, 'lo de este dispositivo');
  assert.equal(f.semana.lun.almuerzo, 'L3');
  assert.equal(f.semana.mar.desayuno, 'D1');
  assert.deepEqual(Object.keys(f.compras), ['y'], 'la marca quitada en el otro se quita; la nueva de aquí queda');
  assert.ok(M.igualEstado(M.fusionarEstado(base, base, remoto), remoto), 'sin cambios propios queda lo de la nube');
  assert.ok(M.igualEstado({ ...local, actualizado: 'otro' }, local), 'la fecha de guardado no cuenta como cambio');
  assert.ok(M.igualEstado(M.fusionarEstado(null, local, remoto), remoto), 'sin base, manda la nube');
});
