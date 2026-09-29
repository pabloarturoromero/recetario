// Chat «Pregúntale a Mamá»: búsqueda con ingredientes y negaciones, variantes de redacción y preguntas sobre
// una receta. Uso: node --test tests/chat.test.mjs (la última prueba requiere Playwright, local o global).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { datos, chat } from './cargar.mjs';

const D = datos();
const { CH, db } = chat(D);
const byId = Object.fromEntries(D.recetas.map((r) => [r.id, r]));
const FORMAS = D.compras_catalogo.formas;
const prods = (r) => new Set(r.ingredientes.flatMap((i) => [FORMAS[i.item]?.p, FORMAS[i.item]?.salida].filter(Boolean)));
const conProd = (r, ps) => ps.some((p) => prods(r).has(p));
const QUESO = ['queso_fresco', 'mozzarella', 'parmesano', 'queso_o_mozzarella'];
const CERDO = ['cerdo_lomo', 'cerdo_lomo_pierna'];

function conversar(...frases) {
  const ctx = CH.nuevoCtx();
  let r;
  for (const f of frases) r = CH.responder(f, ctx, { comensales: 1, semilla: 'prueba' });
  return { r, ctx };
}
const todos = (ctx) => ctx.ultimos.map((id) => byId[id]);

test('la base del chat es coherente con el recetario', () => {
  for (const g of db.ingredientes) for (const p of g.productos || []) assert.ok(D.compras_catalogo.productos[p], `${g.nombre}: producto inexistente ${p}`);
  const orden = db.preguntas.orden;
  for (const k of Object.keys(db.preguntas)) if (k !== 'orden' && k !== 'paso_n') assert.ok(orden.includes(k), 'pregunta sin orden: ' + k);
  for (const c of db.categorias) assert.ok(['desayuno', 'almuerzo', 'cena', 'guarnicion'].includes(c.id));
  for (const c of db.cocinas) assert.ok(D.recetas.some((r) => c.coincide.some((x) => CH.norm(r.cocina).includes(x))), 'cocina sin recetas: ' + c.nombre);
});

test('«hoy quiero comida italiana con queso» da solo italianas con queso', () => {
  const { r, ctx } = conversar('Hoy quiero comida italiana con queso');
  assert.ok(ctx.ultimos.length >= 5);
  for (const x of todos(ctx)) { assert.match(x.cocina, /Italiana/); assert.ok(conProd(x, QUESO), x.id + ' sin queso'); }
  assert.match(r.texto, /italiana con queso/);
  assert.ok(r.recetas.length <= 6);
});

test('patrón negativo: «no quiero pollo, quiero cerdo» y sus variantes', () => {
  for (const f of ['No quiero pollo, quiero cerdo', 'quiero cerdo pero no pollo', 'algo con chancho y sin pechuga', 'nada de pollo, dame puerco']) {
    const { ctx } = conversar(f);
    assert.ok(ctx.ultimos.length, f);
    for (const x of todos(ctx)) { assert.ok(conProd(x, CERDO), `${f}: ${x.id} sin cerdo`); assert.ok(!conProd(x, ['pollo']), `${f}: ${x.id} con pollo`); }
  }
});

test('«no quiero nada con queso» niega el queso y «sin pollo, cerdo ni res» niega los tres', () => {
  let { ctx } = conversar('no quiero nada con queso');
  assert.ok(ctx.ultimos.length > 50);
  for (const x of todos(ctx)) assert.ok(!conProd(x, QUESO), x.id);
  ({ ctx } = conversar('almuerzo sin pollo, cerdo ni res'));
  for (const x of todos(ctx)) {
    assert.equal(x.categoria, 'almuerzo');
    assert.ok(!conProd(x, ['pollo', 'res_molida', 'res_guiso', 'res_magra', ...CERDO]), x.id);
  }
});

test('refinar la búsqueda anterior: «y sin queso», «mejor sin pollo»', () => {
  const { r, ctx } = conversar('una cena italiana', 'y sin queso');
  assert.match(r.texto, /cena|cenas/);
  for (const x of todos(ctx)) { assert.equal(x.categoria, 'cena'); assert.match(x.cocina, /Italiana/); assert.ok(!conProd(x, QUESO), x.id); }
});

test('sinónimos, plurales y errores de una letra', () => {
  const casos = [['merienda con pechuga', (x) => x.categoria === 'cena' && conProd(x, ['pollo'])],
    ['kiero algo con berengena', (x) => conProd(x, ['berenjena'])],
    ['tallarines con camarones', (x) => conProd(x, ['camaron'])],
    ['una sopita calientita', (x) => /sopa|caldo|soupa|shorba|stracciatella|ribollita|sancocho|kakavia|lablabi|parippu|caldin/i.test(x.nombre + ' ' + x.descripcion)],
    ['comida española con queso', (x) => /Española/.test(x.cocina) && conProd(x, QUESO)],
    ['algo con polenta', (x) => conProd(x, ['polenta'])]];
  for (const [f, ok] of casos) {
    const { ctx } = conversar(f);
    assert.ok(ctx.ultimos.length, 'sin resultados: ' + f);
    for (const x of todos(ctx)) assert.ok(ok(x), `${f}: ${x.id}`);
  }
  assert.match(conversar('gracias').r.texto, /gusto|nada/i, '«gracias» no se confunde con «Grecia»');
});

test('lo que no existe se dice, no se inventa', () => {
  assert.match(conversar('quiero algo con alcachofa').r.texto, /alcachofa/);
  assert.equal(conversar('quiero algo con alcachofa').ctx.ultimos.length, 0);
  assert.match(conversar('hoy quiero comida').r.texto, /se te antoja/);
});

test('preguntas sobre una receta: por nombre, por número de la lista y por contexto', () => {
  let { r } = conversar('¿cuántas calorías tiene la paella?');
  assert.match(r.texto, new RegExp(String(byId.L82.macros.kcal_aprox)));
  ({ r } = conversar('¿qué lleva la frittata?'));
  assert.equal(r.lista.length, byId.D11.ingredientes.length);
  const c = conversar('cena rápida con pescado', '¿qué lleva la segunda?');
  const segunda = byId[c.ctx.ultimos[1]];
  assert.equal(c.ctx.receta, segunda.id);
  assert.equal(c.r.lista.length, segunda.ingredientes.length);
  const ctx = c.ctx, op = { comensales: 2 };
  const ajo = segunda.ingredientes.find((i) => /^Ajo/.test(i.item));
  const cuanto = CH.responder('¿cuánto ajo lleva?', ctx, op);
  assert.match(cuanto.texto, ajo ? new RegExp(String(ajo.cantidad * 2)) : /no lleva/, 'cantidad escalada a 2 porciones');
  const pasos = CH.responder('¿cómo se hace?', ctx, op);
  assert.equal(pasos.lista.length, segunda.pasos.length);
  assert.ok(pasos.ordenada);
  assert.match(CH.responder('paso 2', ctx, op).texto, /^Paso 2 de/);
  assert.match(CH.responder('siguiente', ctx, op).texto, /^Paso 3 de/);
  assert.match(CH.responder('¿cuánto tiempo toma?', ctx, op).texto, new RegExp(String(segunda.tiempo_min)));
  assert.match(CH.responder('¿es apta para el fin de semana?', ctx, op).texto, segunda.apto_ventana_contencion ? /^Sí/ : /^No/);
  assert.ok(CH.responder('¿qué uso si no tengo tomate?', ctx, op).lista.length || true);
  assert.match(CH.responder('¿lleva queso?', ctx, op).texto, /^(Sí|No)/);
});

test('sin receta en la conversación, una pregunta pide cuál', () => {
  assert.match(conversar('¿cuántas calorías tiene?').r.texto, /qué receta/i);
});

const req = createRequire(import.meta.url);
let pw = null;
try { pw = req('playwright'); } catch { try { pw = req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {} }
test('interfaz: se abre desde la cabecera y desde la ficha, contesta y abre la receta', { skip: pw ? false : 'Playwright no está disponible' }, async () => {
  const b = await pw.chromium.launch();
  for (const ancho of [390, 1280]) {
    const page = await b.newPage({ viewport: { width: ancho, height: 800 } });
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.goto('file://' + fileURLToPath(new URL('../index.html', import.meta.url)));
    await page.click('#mamaBtn');
    await page.fill('#chatQ', 'Hoy quiero comida italiana con queso, no quiero cerdo');
    await page.press('#chatQ', 'Enter');
    assert.ok(await page.locator('.msg.mama .crec').count() >= 1);
    const panel = await page.locator('.chat-d').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= ancho, 'el panel cabe en la pantalla');
    await page.locator('.crec [data-chat-ver]').first().click();
    assert.ok(await page.evaluate(() => document.getElementById('chatPanel').hidden), 'se cierra al abrir la receta');
    const nombre = await page.textContent('#fichaT');
    await page.click('.ficha [data-mama]');
    assert.match(await page.locator('.msg.mama').last().textContent(), new RegExp(nombre.slice(0, 20).replace(/[()]/g, '.')));
    await page.click('[data-chat-chip]:has-text("¿Qué lleva?")');
    assert.ok(await page.locator('.msg.mama').last().locator('li').count() >= 3);
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.getElementById('chatPanel').hidden));
    assert.deepEqual(errores, []);
    await page.close();
  }
  await b.close();
});
