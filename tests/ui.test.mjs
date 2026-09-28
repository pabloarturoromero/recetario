// Pruebas de la interfaz en Chromium. Requiere Playwright (global o local): node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function cargarPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {}
  return null;
}
const pw = cargarPlaywright();
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
  assert.match(await page.textContent('#sub'), /^100 recetas/);
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
  assert.equal(await page.locator('#gal .gcard').count(), 100);
  await page.fill('#q', 'caraota');
  const n = await page.locator('#gal .gcard').count();
  assert.ok(n >= 1);
  assert.match(await page.textContent('#galCount'), new RegExp(`Mostrando ${n} de 100`));
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
  assert.equal(st.v, 3);
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
    for (const v of ['inicio', 'semana', 'recetas', 'compras', 'prep', 'reglas']) {
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
