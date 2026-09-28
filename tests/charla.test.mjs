// Charla con la cocinera: base cerrada, sin IA. Uso: node --test tests/charla.test.mjs
// La parte de interfaz requiere Playwright (local o global) y se salta si no está.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { charla, semilla } from './cargar.mjs';

const { CH, M } = charla();
const ctx = {
  semana: M.normalizarSemana(semilla()), hoy: 'lun', fase: 1, comensales: 2,
  compras: { total: 40, pendientes: 12, muestra: ['lenteja parda seca'] }, prep: { total: 3, pendientes: 1 },
  agua: { txt: '1,2 L', meta: false, minimo: false, falta: '1,3 L' }
};
const r = (q) => CH.responder(q, ctx);

test('el menú de hoy sale de la semana guardada, y también el de otro día', () => {
  const h = r('¿Qué como hoy?');
  assert.equal(h.id, 'hoy');
  const dia = ctx.semana.lun;
  assert.deepEqual([...h.recetas], [dia.desayuno, dia.almuerzo, dia.cena].filter(Boolean));
  const v = r('qué hay el viernes');
  assert.equal(v.titulo, 'Viernes');
  assert.ok(v.parrafos.some((p) => /ventana de contención/.test(p)));
});

test('busca recetas por comida, tiempo, ingrediente y exclusiones', () => {
  const a = r('cena rápida con pescado');
  assert.equal(a.id, 'buscar');
  assert.ok(a.recetas.length > 0);
  for (const id of a.recetas) {
    const x = M.byId[id];
    assert.equal(x.categoria, 'cena');
    assert.ok(M.tiempo(x).total <= 30);
    assert.match(x.ingredientes.map((i) => i.item).join(' ').toLowerCase(), /corvina|dorado|picudo|atún/);
  }
  const b = r('almuerzo sin cerdo con lenteja');
  assert.ok(b.recetas.length > 0);
  for (const id of b.recetas) {
    const t = M.byId[id].ingredientes.map((i) => i.item).join(' ').toLowerCase();
    assert.ok(!/cerdo/.test(t) && /lenteja/.test(t), id);
  }
  const v = r('algo vegetariano para la cena');
  for (const id of v.recetas) assert.ok(!/res |cerdo|pollo|corvina|dorado|picudo|atún/i.test(M.byId[id].ingredientes.map((i) => i.item).join(' ') + ' '), id);
});

test('«dulce» pregunta por el dulce del día, no por el pimentón dulce', () => {
  assert.equal(r('quiero algo dulce').id, 'dulce');
  assert.match(r('¿puedo usar miel?').parrafos[0], /miel no entran/);
});

test('una receta por código o por nombre', () => {
  assert.deepEqual([...r('L64').recetas], ['L64']);
  assert.deepEqual([...r('curry birmano de garbanzo').recetas], ['C50']);
});

test('reemplazos: respetan las reglas que no se sustituyen', () => {
  const at = r('no tengo atún');
  assert.equal(at.id, 'sustituir');
  assert.ok(at.parrafos.some((p) => /pescado marino no se sustituye/.test(p)));
  assert.ok(!at.parrafos.some((p) => /res magra|pollo \(/.test(p)), 'no ofrece carne en lugar de pescado');
  const le = r('con qué cambio la lenteja');
  assert.ok(le.parrafos.some((p) => /legumbre no se sustituye por verdura/.test(p)));
  assert.ok(!le.parrafos.some((p) => /arroz integral/i.test(p)), 'no ofrece carbohidratos en lugar de legumbre');
  assert.ok(r('¿con qué reemplazo el pollo?').parrafos.some((p) => /res magra/.test(p)));
});

test('bebidas, alcohol y objetivos se leen de los datos', () => {
  assert.ok(r('puedo tomar café').parrafos.some((p) => /antes de las 11:00/.test(p)));
  assert.equal(r('¿puedo tomar vino?').id, 'alcohol');
  assert.ok(r('agua con gas').parrafos[0].startsWith('Agua con gas'));
  const o = r('cuánta proteína necesito');
  assert.ok(o.parrafos.some((p) => /120 a 130 g/.test(p)));
  assert.ok(CH.responder('cuánta fibra', { fase: 2 }).parrafos.some((p) => /32 a 35/.test(p)));
});

test('estado de la semana: compras, preparaciones y agua', () => {
  assert.match(r('qué me falta comprar').parrafos[0], /12 de 40/);
  assert.ok(r('qué dejo listo el domingo').parrafos.some((p) => /una sigue pendiente/.test(p)));
  assert.ok(r('cuánta agua llevo').parrafos.some((p) => /1,2 L/.test(p)));
});

test('síntomas: no evalúa y remite al 911 y al médico', () => {
  const s = r('me duele el pecho después de comer lenteja');
  assert.equal(s.id, 'sintomas');
  assert.ok(s.alerta);
  assert.ok(s.parrafos.some((p) => /911/.test(p)));
});

test('sin coincidencia: lo dice y no inventa', () => {
  const n = r('xyz qwe');
  assert.equal(n.id, 'nada');
  assert.ok(n.sugerir);
  assert.equal(r('').id, 'nada');
});

test('las sugerencias iniciales tienen respuesta', () => {
  for (const [, s] of CH.SUGERENCIAS) {
    const x = s.startsWith('q:') ? r(s.slice(2)) : CH.porId(s, ctx);
    assert.ok(x && x.parrafos.length, s);
    assert.notEqual(x.id, 'nada', s);
  }
});

function cargarPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {}
  return null;
}
const pw = cargarPlaywright();
const URL_APP = 'file://' + fileURLToPath(new URL('../index.html', import.meta.url));
const saltar = pw ? false : 'Playwright no está disponible';

for (const ancho of [390, 1280]) {
  test(`interfaz de la charla a ${ancho} px: pregunta, receta y cierre`, { skip: saltar }, async () => {
    const browser = await pw.chromium.launch();
    const ctxB = await browser.newContext({ viewport: { width: ancho, height: 844 } });
    const page = await ctxB.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.route(/fonts\.(googleapis|gstatic)/, (x) => x.abort());
    await page.goto(URL_APP);
    const cab = await page.evaluate(() => document.querySelector('.top-in').scrollWidth - document.querySelector('.top-in').clientWidth);
    assert.ok(cab <= 0, `la cabecera desborda ${cab}px`);
    const bt = await page.locator('#charlaBtn').boundingBox();
    assert.ok(bt && bt.x >= 0 && bt.x + bt.width <= ancho && bt.y + bt.height <= 844, 'el botón de la charla se ve');
    await page.click('#charlaBtn');
    assert.equal(await page.locator('#charla').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'chIn');
    await page.fill('#chIn', 'cena rápida con pescado');
    await page.press('#chIn', 'Enter');
    await page.locator('.ch-m.yo', { hasText: 'cena rápida con pescado' }).waitFor();
    const n = await page.locator('.ch-rec').count();
    assert.ok(n > 0, 'muestra recetas');
    const panel = await page.locator('#charla').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= ancho, 'el panel cabe en la pantalla');
    const id = await page.locator('.ch-rec').first().getAttribute('data-ch-receta');
    await page.locator('.ch-rec').first().click();
    assert.equal(await page.locator('#charla').isVisible(), false);
    assert.equal(await page.evaluate(() => location.hash), '#receta/' + id);
    await page.click('#charlaBtn');
    assert.equal(await page.locator('.ch-m.yo').count(), 1, 'la conversación se conserva al reabrir');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#charla').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('recetario.menu') !== null && /charla|chIn/.test(localStorage.getItem('recetario.menu'))), false);
    assert.deepEqual(errores, []);
    await browser.close();
  });
}
