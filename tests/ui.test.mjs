// Pruebas de la interfaz en Chromium. Requiere Playwright (global o local): node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { datos } from './cargar.mjs';

function cargarPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {}
  return null;
}
const pw = cargarPlaywright();
const TOTAL = datos().recetas.length;
const URL_APP = 'file://' + fileURLToPath(new URL('../index.html', import.meta.url));
const saltar = pw ? false : 'Playwright no está disponible';

let browser;
test.before(async () => { if (pw) browser = await pw.chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function abrir({ ancho = 1280, alto = 900, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  if (init) await page.addInitScript(init);
  await page.goto(URL_APP);
  return { page, ctx, errores };
}
const guardado = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('recetario.menu') || 'null'));

test('carga sin errores y muestra el guardado real', { skip: saltar }, async () => {
  const { page, ctx, errores } = await abrir();
  assert.equal(await page.textContent('#syncTxt'), 'Guardado en este dispositivo');
  assert.match(await page.textContent('#sub'), new RegExp(`^${TOTAL} recetas`));
  await page.click('nav.main button[data-v="compras"]');
  const pie = await page.textContent('.foot');
  assert.match(pie, /solo en este dispositivo/);
  assert.doesNotMatch(pie, /se sincronizan entre dispositivos/);
  assert.ok(await page.locator('.sitem').count() > 20, 'la lista de compras se genera');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('buscar: la galería sigue a la búsqueda y muestra el vacío', { skip: saltar }, async () => {
  const { page, ctx } = await abrir();
  await page.click('nav.main button[data-v="recetas"]');
  assert.equal(await page.locator('#gal .gcard').count(), TOTAL);
  await page.fill('#q', 'caraota');
  const n = await page.locator('#gal .gcard').count();
  assert.ok(n >= 1);
  assert.match(await page.textContent('#galCount'), new RegExp(`Mostrando ${n} de ${TOTAL}`));
  await page.locator('#gal .gcard .gopen').first().click();
  assert.match(await page.textContent('#fichaT'), /aracota|araota/i);
  await page.click('[data-back]');
  await page.fill('#q', 'arepa');
  assert.equal(await page.locator('#gal .gcard').count(), 0);
  assert.match(await page.textContent('.gal-empty'), /Ninguna receta coincide/);
  await page.fill('#q', '');
  await page.click('.seg button[data-cat="cena"]');
  const cats = await page.locator('#gal .gcard .kat').allTextContents();
  assert.ok(cats.length && cats.every((c) => c === 'Cena'), 'solo cenas');
  await ctx.close();
});

test('cambiar un plato: vista previa antes de confirmar; el menú solo cambia al confirmar', { skip: saltar }, async () => {
  const { page, ctx } = await abrir();
  const antes = await guardado(page);
  await page.click('nav.main button[data-v="semana"]');
  await page.click('.day.show [data-swap$="|cena"], .day [data-swap="lun|cena"]');
  const opcion = page.locator('#gal .gcard [data-elegir^="C"]').first();
  const id = await opcion.getAttribute('data-elegir');
  await opcion.click();
  await page.waitForSelector('.preview');
  const pv = await page.textContent('.preview');
  assert.match(pv, /Proteína/);
  assert.match(pv, /Alertas del día/);
  assert.match(pv, /Tiempo/);
  assert.match(pv, /Pescado marino/);
  assert.deepEqual(await guardado(page), antes, 'nada cambia antes de confirmar');
  await page.click('.preview [data-set]');
  const st = await guardado(page);
  const dia = Object.keys(st.semana).find((k) => st.semana[k].cena === id);
  assert.ok(dia, 'el cambio se guarda al confirmar');
  await ctx.close();
});

test('el dulce se elige por día y cambia el total de energía', { skip: saltar }, async () => {
  const { page, ctx } = await abrir();
  const energia = async () => page.textContent('.bars .bar:nth-child(3) .lab b');
  const e0 = await energia();
  assert.match(await page.textContent('.mk-dulce'), /Dulce pendiente/);
  await page.selectOption('.mk-dulce select', 'S1');
  const e1 = await energia();
  assert.equal(parseInt(e1) - parseInt(e0), 115 - 145);
  const st = await guardado(page);
  assert.ok(Object.values(st.semana).some((d) => d.dulce === 'S1'));
  await ctx.close();
});

test('compras: «Ya tengo» y «Comprado» son estados distintos y persisten', { skip: saltar }, async () => {
  const { page, ctx } = await abrir();
  await page.click('nav.main button[data-v="compras"]');
  const fila = page.locator('.sitem').first();
  await fila.locator('.tng').click();
  assert.equal(await page.locator('.sitem').first().locator('.tng').getAttribute('aria-pressed'), 'true');
  await page.locator('.sitem').nth(1).locator('.chk').click();
  const st = await guardado(page);
  const est = Object.values(st.compras).map((m) => m.s).sort();
  assert.deepEqual(est, ['c', 't']);
  await page.click('.seg button[data-cv="tengo"]');
  assert.equal(await page.locator('.sitem').count(), 1);
  await ctx.close();
});

test('preparaciones: se marcan listas para la semana y se ven los platos que las usan', { skip: saltar }, async () => {
  const { page, ctx } = await abrir();
  await page.click('nav.main button[data-v="prep"]');
  const p1 = page.locator('#prep-P1');
  assert.match(await p1.textContent(), /Necesario/);
  assert.doesNotMatch(await p1.textContent(), /Para [LCD]\d+/, 'sin códigos internos como información principal');
  await p1.locator('[data-prepok]').click();
  assert.match(await page.locator('#prep-P1').textContent(), /Lista para la semana/);
  const st = await guardado(page);
  assert.ok(st.prep.P1 && st.prep.P1.semana);
  await ctx.close();
});

test('migra el estado guardado de la v2.3 sin perder marcas', { skip: saltar }, async () => {
  const viejo = {
    semana: { lun: { desayuno: 'D2', almuerzo: 'L13', cena: 'C24', guarnicion: '', fuera: false } },
    comensales: 2, compras: { 'Huevo||unidad': 1, 'Especias para garam masala P4||g': 1 }, actualizado: '2026-09-20T10:00:00Z'
  };
  const { page, ctx, errores } = await abrir({ init: `if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');localStorage.setItem('recetario.menu', ${JSON.stringify(JSON.stringify(viejo))});}` });
  const st = await guardado(page);
  assert.equal(st.v, 4);
  assert.equal(st.comensales, 2);
  assert.equal(st.semana.lun.almuerzo, 'L13');
  assert.equal(st.semana.lun.dulce, '');
  assert.ok(st.comprasLegado['Especias para garam masala P4||g'], 'marca antigua conservada');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('sincronización simulada: no declara éxito antes de la confirmación y conserva lo local ante error', { skip: saltar }, async () => {
  const init = `
    window.__resolver = [];
    window.claude = { use: () => Promise.resolve({ doc: () => ({
      set: () => new Promise((ok, mal) => window.__resolver.push({ ok, mal })),
      onSnapshot: (cb) => { setTimeout(() => cb({ exists: false, metadata: {} }), 0); }
    }) }) };`;
  const { page, ctx } = await abrir({ init });
  await page.waitForFunction(() => window.__resolver.length === 1);
  assert.equal(await page.textContent('#syncTxt'), 'Sincronizando');
  await page.evaluate(() => window.__resolver[0].ok());
  await page.waitForFunction(() => document.getElementById('syncTxt').textContent === 'Sincronizado');
  await page.selectOption('#comensales', '3');
  assert.equal(await page.textContent('#syncTxt'), 'Cambios pendientes de sincronizar');
  await page.waitForFunction(() => window.__resolver.length === 2);
  await page.evaluate(() => window.__resolver[1].mal(new Error('x')));
  await page.waitForFunction(() => /Error al sincronizar/.test(document.getElementById('syncTxt').textContent));
  assert.equal((await guardado(page)).comensales, 3, 'el cambio sigue guardado localmente');
  await ctx.close();
});

for (const ancho of [375, 390, 1280]) {
  test(`sin desbordamiento horizontal a ${ancho} px`, { skip: saltar }, async () => {
    const { page, ctx, errores } = await abrir({ ancho, alto: 800 });
    const logo = await page.locator('.marca img').boundingBox();
    assert.ok(logo && logo.x >= 0 && logo.x + logo.width <= ancho && logo.width >= 38, 'el logo se ve en la cabecera');
    const cab = await page.evaluate(() => document.querySelector('.top-in').scrollWidth - document.querySelector('.top-in').clientWidth);
    assert.ok(cab <= 0, `la cabecera desborda ${cab}px`);
    for (const v of ['inicio', 'semana', 'recetas', 'compras', 'prep', 'salud', 'reglas']) {
      await page.click(`nav.main button[data-v="${v}"]`);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(ov <= 0, `${v} desborda ${ov}px`);
      const fuera = await page.evaluate(() => [...document.querySelectorAll('main button, nav button')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + 1 || r.left < -1); })
        .filter((b) => !b.closest('.tw, .daysel, .carousel, .seg')).length);
      assert.equal(fuera, 0, `${v}: botones fuera de la pantalla`);
    }
    await page.click('nav.main button[data-v="inicio"]');
    await page.click('.dish [data-swap$="|almuerzo"] >> nth=0');
    await page.locator('#gal .gcard [data-elegir]').nth(2).click();
    const box = await page.locator('.preview [data-set]').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= ancho, 'el botón de confirmar es accesible');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('fotos: la ficha muestra la foto con su crédito y la galería usa las fotos', { skip: saltar }, async () => {
  const { page, ctx, errores } = await abrir();
  await page.click('nav.main button[data-v="recetas"]');
  await page.locator('#gal .gcard .gopen').first().click();
  const img = page.locator('#ficha .hero img');
  assert.equal(await img.count(), 1);
  assert.ok(await img.evaluate((i) => i.complete && i.naturalWidth > 0), 'la imagen carga');
  assert.equal(await img.getAttribute('alt'), (await page.textContent('#fichaT')).trim());
  assert.match(await page.getAttribute('#ficha .cred a', 'href'), /^https:\/\//);
  await page.click('[data-back]');
  assert.ok(await page.locator('#gal .pic img').count() > 50);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('dulce pendiente: muestra la foto genérica con crédito, y el dulce elegido no la usa', { skip: saltar }, async () => {
  const { page, ctx, errores } = await abrir();
  const img = page.locator('.dish.mk-dulce .pic img');
  assert.equal(await img.count(), 1);
  assert.ok(await img.evaluate((i) => i.complete && i.naturalWidth > 0), 'la imagen carga');
  assert.match(await img.getAttribute('alt'), /foto de referencia/);
  assert.match(await page.getAttribute('.dish.mk-dulce .cred a', 'href'), /^https:\/\/commons\.wikimedia\.org\//);
  await page.selectOption('.dish.mk-dulce select', 'S1');
  assert.equal(await page.locator('.dish.mk-dulce .pic img').count(), 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('viaje: añadir, marcar, editar, borrar y conservar la lista al recargar', { skip: saltar }, async () => {
  const { page, ctx, errores } = await abrir({ ancho: 390, alto: 844 });
  page.on('dialog', (d) => d.accept());
  await page.click('nav.main button[data-v="viaje"]');
  assert.match(await page.textContent('.vj-vacio'), /vacía/);
  for (const [t, g] of [['Revisar pasaporte', 'Documentos'], ['Reservar hotel', 'Reservas'], ['Cambiar reales', 'Dinero']]) {
    await page.selectOption('#vjForm select', g);
    await page.fill('#vjForm input[name=t]', t);
    await page.press('#vjForm input[name=t]', 'Enter');
  }
  assert.equal(await page.locator('.vj .sitem').count(), 3);
  await page.click('[aria-label="Marcar como hecho: Revisar pasaporte"]');
  assert.match(await page.textContent('.vj-res'), /1 de 3/);
  await page.click('[aria-label="Editar: Reservar hotel"]');
  await page.fill('#vjEd input', 'Reservar hotel en Paulista');
  await page.press('#vjEd input', 'Enter');
  await page.click('[aria-label="Borrar: Cambiar reales"]');
  await page.click('.vj details summary');
  await page.fill('#vjAj input[type=date]', '2099-01-01');
  await page.click('#vjAj button[type=submit]');
  await page.reload();
  await page.click('nav.main button[data-v="viaje"]');
  const txt = await page.textContent('.vj');
  assert.match(txt, /Reservar hotel en Paulista/);
  assert.doesNotMatch(txt, /Cambiar reales/);
  assert.match(txt, /días para salir/);
  assert.match(await page.textContent('.vj-res'), /1 de 2/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('viaje: la fusión entre dispositivos conserva lo de ambos y no revive lo borrado', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const fuente = html.match(/var VJ_GRUPOS = [^\n]*\n/)[0] + html.match(/function vjNormalizar[\s\S]*?\nfunction vjIgual[^\n]*\n/)[0];
  const { vjFusionar } = new Function(fuente + 'return {vjFusionar};')();
  const it = (id, t, ts, h = false) => ({ id, t, g: 'Otros', h, c: '2026-10-01T00:00:00Z', ts });
  const a = { items: [it('1', 'Pasaporte', '2026-10-02T10:00:00Z', true), it('2', 'Hotel', '2026-10-01T00:00:00Z')], x: { '3': '2026-10-02T09:00:00Z' } };
  const b = { items: [it('1', 'Pasaporte', '2026-10-01T00:00:00Z'), it('2', 'Hotel', '2026-10-01T00:00:00Z'), it('3', 'Seguro', '2026-10-01T00:00:00Z'), it('4', 'Reales', '2026-10-02T11:00:00Z')], x: {} };
  const f = vjFusionar(a, b);
  assert.deepEqual(f.items.map((i) => i.id).sort(), ['1', '2', '4']);
  assert.equal(f.items.find((i) => i.id === '1').h, true, 'gana la marca más reciente');
  assert.deepEqual(vjFusionar(b, a).items.map((i) => i.id).sort(), ['1', '2', '4'], 'el orden de los lados no importa');
});
