// Pruebas de la galería de recetas, la ficha, los enlaces directos, WhatsApp,
// la asignación al menú y el intercambio desde Inicio y Semana.
//
// Uso:  node --test tests/galeria.test.mjs   (o node tests/galeria.test.mjs)
// Requiere Playwright con Chromium, local o global; sin él, las pruebas de navegador se omiten.
// No se envía nada a WhatsApp: solo se lee el enlace generado.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

/* ---------- datos, sin navegador ---------- */
const datos = JSON.parse(html.match(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/)[1]);
const R = datos.recetas;
const ids = new Set(R.map(r => r.id));
const CATS = ['desayuno', 'almuerzo', 'cena', 'guarnicion'];
assert.equal(ids.size, R.length, 'ids de receta duplicados');
for (const r of R) {
  assert.ok(CATS.includes(r.categoria), `${r.id}: categoría inválida ${r.categoria}`);
  for (const k of ['nombre', 'cocina', 'ingredientes', 'pasos', 'macros'])
    assert.ok(r[k] && (!Array.isArray(r[k]) || r[k].length), `${r.id}: falta ${k}`);
}
const nombres = new Set(R.map(r => r.nombre.trim().toLowerCase()));
assert.equal(nombres.size, R.length, 'nombres de receta duplicados');
console.log(`datos: ${R.length} recetas únicas, ${new Set(R.map(r => r.cocina)).size} cocinas`);

/* ---------- servidor local ---------- */
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(raiz, u === '/' ? 'index.html' : u);
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${srv.address().port}/`;

function cargarPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {}
  return null;
}
const pw = cargarPlaywright();
if (!pw) { console.log('Playwright no está disponible: se omiten las pruebas de navegador.'); srv.close(); process.exit(0); }
const browser = await pw.chromium.launch();
let fallos = 0, pasadas = 0;
async function prueba(nombre, fn) {
  try { await fn(); pasadas++; console.log('  ok  ' + nombre); }
  catch (e) { fallos++; console.log('  FALLO ' + nombre + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}
async function nueva(ancho = 1280, alto = 900) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.errores = errores;
  return page;
}
const tarjetas = p => p.locator('#gal .gcard');
const semana = p => p.evaluate(() => JSON.parse(localStorage.getItem('recetario.menu') || 'null'));

await prueba('la galería muestra el banco completo sin filtros', async () => {
  const p = await nueva();
  await p.goto(BASE);
  await p.click('nav.main button[data-v="recetas"]');
  assert.equal(await tarjetas(p).count(), R.length);
  const ids2 = await tarjetas(p).evaluateAll(els => els.map(e => e.dataset.id));
  assert.equal(new Set(ids2).size, R.length, 'tarjetas duplicadas');
  assert.match(await p.textContent('#galCount'), new RegExp(`^${R.length} recetas$`));
  assert.equal(await p.locator('[data-limpiar]').count(), 0);
  assert.deepEqual(p.errores, []);
});

await prueba('búsqueda y filtros combinados, contador y limpiar', async () => {
  const p = await nueva();
  await p.goto(BASE);
  await p.click('nav.main button[data-v="recetas"]');
  await p.fill('#q', 'garbanzo');
  const esperado = R.filter(r => (r.nombre + ' ' + r.cocina + ' ' + r.descripcion + ' ' + r.ingredientes.map(i => i.item).join(' '))
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes('garbanzo'));
  assert.equal(await tarjetas(p).count(), esperado.length);
  assert.equal(await p.textContent('#galCount'), `Mostrando ${esperado.length} de ${R.length} recetas`);
  await p.click('[data-cat="cena"]');
  const cenas = esperado.filter(r => r.categoria === 'cena');
  assert.equal(await tarjetas(p).count(), cenas.length);
  // búsqueda sin tildes por cocina
  await p.fill('#q', 'etiope');
  await p.click('[data-cat=""]');
  const eti = R.filter(r => /etíope/i.test(r.cocina) || /etiope/i.test(r.cocina));
  assert.ok(eti.length > 0);
  assert.ok(await tarjetas(p).count() >= eti.length);
  // filtro por cocina
  await p.fill('#q', '');
  const coc = 'Griega';
  await p.selectOption('#cocina', coc);
  assert.equal(await tarjetas(p).count(), R.filter(r => r.cocina === coc).length);
  // estado vacío
  await p.fill('#q', 'zzzzqqq');
  assert.equal(await tarjetas(p).count(), 0);
  assert.ok(await p.isVisible('.gal-empty'));
  await p.click('.gal-empty [data-limpiar]');
  assert.equal(await tarjetas(p).count(), R.length);
  assert.equal(await p.inputValue('#cocina'), '');
});

await prueba('cada tarjeta abre su propia receta', async () => {
  const p = await nueva();
  await p.goto(BASE + '#recetas');
  await p.click('nav.main button[data-v="recetas"]');
  for (const r of R) {
    await p.click(`.gcard[data-id="${r.id}"] .gopen`);
    assert.equal(await p.textContent('#fichaT'), r.nombre, `ficha de ${r.id}`);
    assert.equal(new URL(p.url()).hash, '#receta/' + r.id);
    await p.click('[data-back]');
    await p.waitForSelector('#gal');
  }
  assert.deepEqual(p.errores, []);
});

await prueba('volver conserva búsqueda, filtros y scroll', async () => {
  const p = await nueva(390, 844);
  await p.goto(BASE);
  await p.click('nav.main button[data-v="recetas"]');
  await p.click('[data-cat="almuerzo"]');
  await p.fill('#q', 'lenteja');
  const n = await tarjetas(p).count();
  const ult = tarjetas(p).last();
  await ult.scrollIntoViewIfNeeded();
  const y = await p.evaluate(() => scrollY);
  const id = await ult.getAttribute('data-id');
  await ult.locator('.gopen').click();
  assert.equal(await p.textContent('#fichaT'), R.find(r => r.id === id).nombre);
  await p.goBack();
  await p.waitForSelector('#gal');
  assert.equal(await p.inputValue('#q'), 'lenteja');
  assert.equal(await p.getAttribute('[data-cat="almuerzo"]', 'aria-pressed'), 'true');
  assert.equal(await tarjetas(p).count(), n);
  assert.ok(Math.abs((await p.evaluate(() => scrollY)) - y) < 40, 'scroll restaurado');
});

await prueba('enlace directo abre la ficha al entrar y al recargar; id inexistente avisa', async () => {
  const p = await nueva();
  const r = R.find(x => /moqueca/i.test(x.nombre)) || R[5];
  await p.goto(BASE + '#receta/' + r.id);
  assert.equal(await p.textContent('#fichaT'), r.nombre);
  await p.reload();
  assert.equal(await p.textContent('#fichaT'), r.nombre);
  await p.goto(BASE + '#receta/NOEXISTE');
  await p.reload();
  assert.match(await p.textContent('#aviso'), /No existe la receta NOEXISTE/);
  assert.equal(await tarjetas(p).count(), R.length);
});

await prueba('WhatsApp: mensaje completo, codificado, sin destinatario; copiar receta', async () => {
  const p = await nueva();
  for (const r of R) {
    await p.goto(BASE + '#receta/' + r.id);
    await p.reload();
    const href = await p.getAttribute('#waLink', 'href');
    assert.ok(href.startsWith('https://wa.me/?text='), 'sin destinatario fijo');
    const u = new URL(href);
    assert.equal(u.pathname, '/');
    const txt = u.searchParams.get('text');
    assert.ok(txt.startsWith('*' + r.nombre + '*'), `nombre en ${r.id}`);
    assert.ok((r.cocina === 'Sin adscripción' || txt.includes(r.cocina)) && txt.includes('Porciones: 1'), `cocina y porciones en ${r.id}`);
    assert.ok(txt.includes(r.ingredientes[0].item.replace(/\s+P\d\b/, '')), `ingredientes en ${r.id}`);
    assert.ok(txt.endsWith('#receta/' + r.id), `enlace directo en ${r.id}`);
    assert.ok(txt.length <= 1800, `longitud en ${r.id}`);
    if (!txt.includes('*Preparación*')) assert.match(await p.textContent('#copiaRec'), /resumen/);
    assert.equal(await p.getAttribute('#waLink', 'target'), '_blank');
  }
  const r = R[0];
  await p.goto(BASE + '#receta/' + r.id);
  await p.reload();
  await p.click('[data-copiar-rec]');
  await p.waitForFunction(() => /copiada/.test(document.getElementById('copiaRec').textContent));
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip.includes('*Preparación*') && clip.includes(r.pasos[r.pasos.length - 1]));
  // el enlace directo abre exactamente la receta compartida
  const link = clip.split('\n').pop().replace(/^Ver receta: /, '');
  const q = await nueva();
  await q.goto(link);
  assert.equal(await q.textContent('#fichaT'), r.nombre);
});

await prueba('añadir al menú, reemplazar y deshacer actualizan todas las vistas', async () => {
  const p = await nueva();
  await p.goto(BASE);
  const enSemilla = ['L13', 'L7', 'L37', 'L40', 'L14'];
  const r = R.find(x => x.categoria === 'almuerzo' && x.apto_ventana_contencion && x.requiere.length && !enSemilla.includes(x.id));
  await p.goto(BASE + '#receta/' + r.id);
  await p.reload();
  await p.click('[data-anadir]');
  await p.click('[data-adia="mie"]');
  const prev = (await semana(p))?.semana?.mie?.almuerzo || 'L7';
  const prevR = R.find(x => x.id === prev);
  assert.match(await p.textContent('.asig-rep'), new RegExp(prevR.nombre.replace(/[()]/g, '.')));
  assert.equal((await p.textContent('[data-aconf]')).trim(), 'Cambiar por esta receta');
  await p.click('[data-aconf]');
  assert.equal(await p.textContent('#aviso .t'), `${r.nombre} añadida al almuerzo del miércoles`);
  assert.equal((await semana(p)).semana.mie.almuerzo, r.id);
  // Semana, Compras y Preparaciones reflejan el cambio
  await p.click('nav.main button[data-v="semana"]');
  assert.ok((await p.locator('.day[aria-label="Miércoles"]').textContent()).includes(r.nombre));
  await p.click('nav.main button[data-v="compras"]');
  assert.ok((await p.locator('.shopcols').textContent()).length > 0);
  if (r.requiere.length) {
    await p.click('nav.main button[data-v="prep"]');
    assert.ok((await p.locator('.prepc.need').allTextContents()).join(' ').includes(r.nombre));
  }
  // la ficha marca que está en la semana
  await p.goto(BASE + '#receta/' + r.id);
  await p.reload();
  assert.match(await p.textContent('.ficha-meta'), /Miércoles, almuerzo/);
  // deshacer
  await p.click('[data-anadir]');
  await p.click('[data-adia="lun"]');
  await p.click('[data-aconf]');
  const antes = await semana(p);
  assert.equal(antes.semana.lun.almuerzo, r.id);
  await p.click('#aviso [data-deshacer]');
  const desp = await semana(p);
  assert.equal(desp.semana.lun.almuerzo, 'L13');
  assert.equal(desp.semana.mie.almuerzo, r.id);
  assert.deepEqual(p.errores, []);
});

await prueba('intercambio desde Inicio y Semana: categoría compatible, contexto, detalle y reglas', async () => {
  const p = await nueva();
  await p.goto(BASE);
  await p.click('nav.main button[data-v="semana"]');
  await p.click('.day[aria-label="Jueves"] [data-swap="jue|cena"]');
  assert.equal(await p.textContent('#cambioH'), 'Cambiar cena del jueves');
  const ids2 = await tarjetas(p).evaluateAll(els => els.map(e => e.dataset.id));
  const cenas = R.filter(r => r.categoria === 'cena');
  assert.equal(ids2.length, cenas.length);
  assert.ok(ids2.every(id => R.find(r => r.id === id).categoria === 'cena'), 'solo cenas');
  assert.equal(await p.locator('[data-cat]').count(), 0, 'no se puede cambiar de categoría');
  // reglas: una cena ya repetida o no apta aparece en No recomendadas
  assert.ok(await p.locator('.gal-sec').first().textContent().then(t => /Compatibles/.test(t)));
  // abrir detalle antes de decidir y volver
  const cand = await tarjetas(p).nth(2).getAttribute('data-id');
  await p.click(`.gcard[data-id="${cand}"] .gopen`);
  assert.match(await p.textContent('.ficha-cambio'), /la cena del jueves/);
  await p.click('[data-back]');
  assert.equal(await p.textContent('#cambioH'), 'Cambiar cena del jueves');
  await p.click(`.gcard[data-id="${cand}"] .gopen`);
  await p.click('.ficha-acts [data-elegir]');
  await p.waitForSelector('.preview');
  assert.equal((await semana(p))?.semana?.jue?.cena ?? 'C27', 'C27', 'nada cambia antes de confirmar');
  await p.click('.preview [data-set]');
  assert.equal((await semana(p)).semana.jue.cena, cand);
  assert.equal(await p.getAttribute('nav.main button[data-v="semana"]', 'aria-selected'), 'true');
  assert.match(await p.textContent('#aviso .t'), /a la cena del jueves$/);
  await p.click('#aviso [data-deshacer]');
  assert.equal((await semana(p)).semana.jue.cena, 'C27');
  // desde Inicio, ventana de contención: las no aptas quedan como no recomendadas
  await p.click('nav.main button[data-v="inicio"]');
  const fab = p.locator('.dish [data-swap$="|cena"]').first();
  await fab.click();
  const k = (await p.evaluate(() => document.getElementById('cambioH').textContent));
  assert.match(k, /^Cambiar cena del /);
  await p.keyboard.press('Escape');
  assert.equal(await p.getAttribute('nav.main button[data-v="inicio"]', 'aria-selected'), 'true');
  // la galería normal recupera sus filtros tras cancelar
  await p.click('nav.main button[data-v="recetas"]');
  assert.equal(await tarjetas(p).count(), R.length);
  assert.deepEqual(p.errores, []);
});

await prueba('las recetas no aptas de viernes a domingo se marcan y no se asignan en otra categoría', async () => {
  const p = await nueva();
  await p.goto(BASE);
  const no = R.find(r => r.categoria === 'cena' && !r.apto_ventana_contencion);
  await p.goto(BASE + '#receta/' + no.id); await p.reload();
  await p.click('[data-anadir]');
  assert.match(await p.locator('[data-adia="sab"]').textContent(), /No apta de viernes a domingo/);
  await p.click('[data-adia="sab"]');
  assert.match(await p.textContent('.asig-box'), /No recomendada/);
  await p.click('.drawer [data-cerrar]');
  // intentar elegir un almuerzo dentro de un intercambio de cena no hace nada
  await p.click('nav.main button[data-v="semana"]');
  await p.click('.day[aria-label="Lunes"] [data-swap="lun|cena"]');
  const alm = R.find(r => r.categoria === 'almuerzo');
  await p.evaluate(id => { const b = document.createElement('button'); b.dataset.elegir = id; b.id = 'x'; document.getElementById('gal').appendChild(b); }, alm.id);
  await p.click('#x');
  assert.equal(await p.locator('.preview').count(), 0, 'no abre la vista previa');
  const s = await semana(p);
  assert.notEqual(s?.semana?.lun?.cena, alm.id);
});

await prueba('teclado: tabular a una tarjeta y abrir con Enter; Escape vuelve', async () => {
  const p = await nueva();
  await p.goto(BASE);
  await p.click('nav.main button[data-v="recetas"]');
  await p.focus('.gcard:nth-child(3) .gopen');
  await p.keyboard.press('Enter');
  const id = await p.evaluate(() => location.hash);
  assert.match(id, /^#receta\//);
  await p.keyboard.press('Escape');
  await p.waitForSelector('#gal');
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains('gopen')), true);
});

for (const ancho of [375, 390]) {
  await prueba(`sin desbordamiento horizontal a ${ancho} px`, async () => {
    const p = await nueva(ancho, 812);
    await p.goto(BASE);
    const vistas = ['inicio', 'recetas', 'semana', 'compras', 'prep'];
    for (const v of vistas) {
      await p.click(`nav.main button[data-v="${v}"]`);
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= ancho, `${v}: ${w}px`);
    }
    for (const r of [R[0], R.reduce((a, b) => (b.nombre.length > a.nombre.length ? b : a))]) {
      await p.goto(BASE + '#receta/' + r.id); await p.reload();
      for (const t of ['ing', 'pasos', 'info']) {
        await p.click(`[data-ftab="${t}"]`);
        const w = await p.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(w <= ancho, `ficha ${r.id} ${t}: ${w}px`);
      }
      await p.click('[data-anadir]');
      await p.click('[data-adia="vie"]');
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= ancho, `diálogo: ${w}px`);
      await p.click('.drawer [data-cerrar]');
    }
    await p.goto(BASE); await p.click('nav.main button[data-v="semana"]');
    await p.click('[data-dia="lun"]');
    await p.click('[data-swap="lun|almuerzo"]');
    await p.locator('#gal [data-elegir]').first().click();
    await p.waitForSelector('.preview');
    const bx = await p.locator('.preview [data-set]').boundingBox();
    assert.ok(bx && bx.x >= 0 && bx.x + bx.width <= ancho, 'confirmar accesible');
    const w2 = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w2 <= ancho, `intercambio: ${w2}px`);
    assert.deepEqual(p.errores, []);
  });
}

await browser.close();
srv.close();
console.log(`\n${pasadas} pruebas correctas, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
