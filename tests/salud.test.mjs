// Pruebas de Salud: agua, peso y exámenes. El motor se prueba en Node; la interfaz, con Playwright si está instalado.
// Uso: node --test tests/salud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { datos, salud } from './cargar.mjs';

const D = datos();
const { SA, mod } = salud(D);
const plano = (o) => JSON.parse(JSON.stringify(o));

test('la meta de agua sale de las reglas del plan', () => {
  assert.equal(D.meta.reglas_de_armado.liquido_dia, '2.5 a 3 L');
  assert.equal(SA.META.min, 2500);
  assert.equal(SA.META.max, 3000);
  const otra = salud({ meta: { reglas_de_armado: { liquido_dia: '2 a 2.5 L' } } }).SA;
  assert.deepEqual([otra.META.min, otra.META.max], [2000, 2500], 'si cambia la regla, cambia la meta');
});

test('ml a ilustración en los bordes de cada tramo', () => {
  const casos = [[0, 1], [499, 1], [500, 2], [999, 2], [1000, 3], [1500, 4], [1999, 4], [2000, 5], [2499, 5], [2500, 6], [3000, 6], [3500, 6]];
  for (const [ml, t] of casos) assert.equal(SA.tramo(ml), t, `${ml} ml`);
});

test('totales del día, mínimo, meta y deshacer', () => {
  const st = SA.vacio(), f = '2026-09-28';
  for (const ml of [500, 500, 500, 500]) SA.registrar(st, f, 'agua', ml, '09:00');
  SA.registrar(st, f, 'infusion', 250, '10:00');
  let t = SA.totalDia(st, f);
  assert.equal(t.ml, 2250); assert.equal(t.tramo, 5); assert.equal(t.minimo, false);
  SA.registrar(st, f, 'agua', 250, '11:00');
  t = SA.totalDia(st, f);
  assert.equal(t.ml, 2500); assert.equal(t.tramo, 6); assert.equal(t.minimo, true); assert.equal(t.meta, false);
  SA.registrar(st, f, 'agua', 500, '12:00');
  assert.equal(SA.totalDia(st, f).meta, true);
  assert.equal(SA.deshacer(st, f).ml, 500);
  assert.equal(SA.totalDia(st, f).ml, 2500);
  assert.equal(SA.registrar(st, f, 'jugo', 250), false, 'lo prohibido no existe como bebida');
  assert.equal(SA.registrar(st, f, 'agua', -5), false);
});

test('el contador es por día de Guayaquil y el historial guarda 30 días', () => {
  // 03:30 UTC del 29 son las 22:30 del 28 en Guayaquil.
  assert.equal(mod.hoyISO(new Date('2026-09-29T03:30:00Z')), '2026-09-28');
  assert.equal(mod.hoyISO(new Date('2026-09-29T05:00:00Z')), '2026-09-29');
  assert.equal(mod.horaGYE(new Date('2026-09-29T03:30:00Z')), '22:30');
  const st = SA.vacio();
  SA.registrar(st, '2026-09-28', 'agua', 2000);
  assert.equal(SA.totalDia(st, '2026-09-29').ml, 0, 'el día nuevo empieza en cero');
  SA.registrar(st, '2026-08-01', 'agua', 500);
  SA.podar(st, '2026-09-29');
  assert.deepEqual(plano(Object.keys(st.agua)), ['2026-09-28']);
  const h = SA.historial(st, '2026-09-29', 7);
  assert.equal(h.length, 7); assert.equal(h[5].ml, 2000); assert.equal(h[6].ml, 0);
});

test('topes de café y gaseosa light de las reglas de bebidas', () => {
  const st = SA.vacio(), lun = '2026-09-28', vie = '2026-10-02';
  SA.registrar(st, lun, 'cafe', 240, '07:30');
  SA.registrar(st, lun, 'cafe', 240, '10:30');
  assert.equal(SA.avisos(st, lun).length, 0);
  SA.registrar(st, lun, 'cafe', 240, '15:00');
  const k = SA.avisos(st, lun).map((a) => a.k);
  assert.ok(k.includes('cafe') && k.includes('cafe_hora'));
  SA.registrar(st, lun, 'gaseosa', 355, '16:00');
  assert.ok(!SA.avisos(st, lun).some((a) => a.k.startsWith('gaseosa')), 'una lata un lunes está permitida');
  SA.registrar(st, lun, 'gaseosa', 355, '17:00');
  assert.ok(SA.avisos(st, lun).some((a) => a.k === 'gaseosa_tope'));
  SA.registrar(st, vie, 'gaseosa', 355, '12:00');
  assert.ok(SA.avisos(st, vie).some((a) => a.k === 'gaseosa_finde'));
  const st2 = SA.vacio();
  ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].forEach((f) => SA.registrar(st2, f, 'gaseosa', 355));
  assert.ok(!SA.avisos(st2, '2026-10-01').some((a) => a.k === 'gaseosa_semana'));
  SA.registrar(st2, '2026-10-02', 'gaseosa', 355);
  assert.ok(SA.avisos(st2, '2026-10-02').some((a) => a.k === 'gaseosa_semana'));
  assert.ok(SA.totalDia(st, lun).ml === 240 * 3 + 355 * 2, 'café y gaseosa cuentan como líquido');
});

test('peso: alta, edición del mismo día, borrado y variación semanal', () => {
  const st = SA.vacio();
  assert.equal(SA.guardarMedida(st, { f: '2026-09-01', kg: '84,6' }), true);
  SA.guardarMedida(st, { f: '2026-09-15', kg: 83.9, cintura: 96 });
  SA.guardarMedida(st, { f: '2026-09-28', kg: 83.1 });
  SA.guardarMedida(st, { f: '2026-09-28', kg: 82.8, pas: 124, pad: 78 });
  assert.equal(st.medidas.length, 3, 'el mismo día se actualiza, no se duplica');
  assert.equal(SA.ultimaMedida(st, 'kg').kg, 82.8);
  assert.equal(SA.ultimaMedida(st, 'cintura').f, '2026-09-15');
  const v = SA.variacionSemanal(st);
  assert.equal(v.desde, '2026-09-15'); assert.equal(v.kg, -1.1); assert.equal(v.porSemana, -0.6);
  assert.equal(SA.estadoPresion(124, 78), 'ok'); assert.equal(SA.estadoPresion(135, 85), 'aviso');
  assert.equal(SA.guardarMedida(st, { f: '2026-09-20', kg: 5 }), false, 'peso imposible');
  assert.equal(SA.seriePeso(st, '2026-09-28', 30).length, 3);
  assert.equal(SA.borrarMedida(st, '2026-09-15'), true);
  assert.equal(st.medidas.length, 2);
});

test('exámenes: alta, edición, borrado, tendencia y rango orientativo', () => {
  const st = SA.vacio();
  const a = SA.guardarExamen(st, { f: '2026-03-10', valores: { glucosa: '108', ldl: 131, tg: 190 }, otros: [{ n: 'PCR', v: '2,1', u: 'mg/L' }] });
  const b = SA.guardarExamen(st, { f: '2026-09-01', valores: { glucosa: 97, ldl: 112, inexistente: 3 }, notas: 'Ayuno de 12 h' });
  assert.ok(a.id && b.id && a.id !== b.id);
  assert.deepEqual(Object.keys(plano(b.valores)).sort(), ['glucosa', 'ldl'], 'solo claves conocidas');
  const g = SA.historiaValor(st, 'glucosa');
  assert.deepEqual(plano(g.map((x) => x.v)), [97, 108], 'del más reciente al anterior');
  assert.equal(SA.estadoValor('glucosa', 97), 'ok');
  assert.equal(SA.estadoValor('ldl', 112), 'aviso');
  assert.equal(SA.estadoValor('hdl', 38), 'aviso');
  assert.equal(SA.textoRango('glucosa'), '70 a 99 mg/dL');
  assert.equal(SA.historiaValor(st, 'otro:pcr')[0].v, 2.1);
  SA.guardarExamen(st, { id: b.id, f: '2026-09-01', valores: { glucosa: 95 } });
  assert.equal(st.examenes.length, 2, 'editar no duplica');
  assert.equal(SA.historiaValor(st, 'glucosa')[0].v, 95);
  assert.equal(SA.guardarExamen(st, { f: '2026-09-02', valores: {} }), null, 'una toma vacía no se guarda');
  assert.equal(SA.borrarExamen(st, a.id), true);
  assert.equal(SA.historiaValor(st, 'glucosa').length, 1);
  assert.ok(SA.EXAMENES.every((e) => e.min !== undefined || e.max !== undefined), 'todos tienen rango');
});

test('respaldo: exportar e importar conservan todo; un archivo ajeno se rechaza', () => {
  const st = SA.vacio();
  SA.registrar(st, '2026-09-28', 'agua', 750, '08:00');
  SA.guardarMedida(st, { f: '2026-09-28', kg: 82.4 });
  SA.guardarExamen(st, { f: '2026-09-01', valores: { hba1c: 5.4 } });
  const back = SA.importar(SA.exportar(st));
  assert.deepEqual(plano(back.agua), plano(st.agua));
  assert.deepEqual(plano(back.medidas), plano(st.medidas));
  assert.deepEqual(plano(back.examenes), plano(st.examenes));
  assert.throws(() => SA.importar('{"tipo":"menu"}'));
  assert.throws(() => SA.importar('no es json'));
  const txt = SA.textoResumen(st, '2026-09-28');
  assert.match(txt, /Peso: 82,4 kg/);
  assert.match(txt, /HbA1c\): 5,4 %/);
});

/* ---------- interfaz ---------- */
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
async function abrir(ancho = 390, alto = 844, url = URL_APP) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(url);
  return { page, ctx, errores };
}
const ilus = (page, sel = '.agua-img') => page.getAttribute(sel, 'src');

for (const ancho of [390, 1280]) {
  test(`salud a ${ancho} px: el agua cambia la ilustración y todo persiste tras recargar`, { skip: saltar }, async () => {
    const { page, ctx, errores } = await abrir(ancho);
    assert.equal(await page.title(), 'Amor de Mamá');
    assert.equal(await page.getAttribute('.marca img', 'alt'), 'Amor de Mamá');
    assert.match(await page.textContent('#sub'), /^100 recetas/);
    await page.click('nav.main button[data-v="salud"]');
    assert.equal(await page.evaluate(() => location.hash), '#salud');
    const vistas = [await ilus(page)];
    for (let i = 0; i < 6; i++) { await page.click('[data-sa="agua|agua|500"]'); vistas.push(await ilus(page)); }
    assert.deepEqual(vistas, [1, 2, 3, 4, 5, 6, 6].map((n) => `img/agua-${n}.webp`));
    assert.match(await page.textContent('#aguaTot'), /^3,0 /);
    const cargadas = await page.evaluate(async () => {
      const r = [];
      for (let n = 1; n <= 6; n++) { const i = new Image(); i.src = `img/agua-${n}.webp`; try { await i.decode(); r.push(i.naturalWidth > 0); } catch { r.push(false); } }
      return r;
    });
    assert.deepEqual(cargadas, [true, true, true, true, true, true]);
    await page.click('[data-sa="deshacer"]');
    assert.match(await page.textContent('#aguaTot'), /^2,5 /);
    await page.fill('#medForm [name=kg]', '82,4');
    await page.click('#medForm [type=submit]');
    await page.click('[data-sa="exnuevo"]');
    await page.fill('[name=x_glucosa]', '104');
    await page.fill('[name=on_0]', 'PCR');
    await page.fill('[name=ov_0]', '1,2');
    await page.click('#exForm [type=submit]');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(ov <= 0, `desborda ${ov}px`);
    await page.reload();
    assert.equal(await page.getAttribute('nav.main button[data-v="salud"]', 'aria-selected'), 'true', '#salud abre la sección');
    assert.match(await page.textContent('#aguaTot'), /^2,5 /);
    assert.match(await page.textContent('#sa-peso'), /82,4/);
    const ex = await page.textContent('#sa-examenes');
    assert.match(ex, /Glucosa en ayunas/); assert.match(ex, /Fuera del rango/); assert.match(ex, /PCR/);
    const g = await page.evaluate(() => JSON.parse(localStorage.getItem('recetario.salud')));
    assert.equal(g.v, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('recetario.menu')), null, 'Salud no escribe en el menú');
    await page.click('nav.main button[data-v="compras"]');
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.ok(await page.locator('.sitem').count() > 20, 'la lista de compras se sigue generando');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('Inicio: el acceso de agua suma 250 ml y lleva a Salud', { skip: saltar }, async () => {
  const { page, ctx, errores } = await abrir(390);
  assert.match(await page.textContent('#aguaMiniTot'), /^0,0 de 3,0 L/);
  await page.click('.agua-mini [data-sa="agua|agua|250"]');
  assert.match(await page.textContent('#aguaMiniTot'), /^0,25 de 3,0 L/);
  await page.click('.agua-mini [data-goto="salud"]');
  assert.equal(await page.getAttribute('nav.main button[data-v="salud"]', 'aria-selected'), 'true');
  await page.click('#marca');
  assert.equal(await page.getAttribute('nav.main button[data-v="inicio"]', 'aria-selected'), 'true');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('topes de bebidas visibles en la interfaz', { skip: saltar }, async () => {
  const { page, ctx } = await abrir(390, 844, URL_APP + '#salud');
  for (let i = 0; i < 3; i++) await page.click('[data-sa="agua|cafe|240"]');
  assert.match(await page.textContent('#sa-agua'), /Van 3 tazas de café/);
  await ctx.close();
});

test('exportar respaldo descarga un JSON que se puede importar', { skip: saltar }, async () => {
  const { page, ctx } = await abrir(390, 844, URL_APP + '#salud');
  await page.click('[data-sa="agua|agua|500"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-sa="exportar"]')]);
  assert.match(dl.suggestedFilename(), /^amor-de-mama-salud-\d{4}-\d{2}-\d{2}\.json$/);
  const ruta = await dl.path();
  const txt = (await import('node:fs')).readFileSync(ruta, 'utf8');
  assert.equal(JSON.parse(txt).tipo, 'salud');
  await ctx.close();
});
