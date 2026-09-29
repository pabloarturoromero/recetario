// Pruebas del plan de ejercicio de Salud: programa, progresión, registro y la interfaz a varios anchos.
// Uso: node --test tests/ejercicio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { datos, salud, ejercicio } from './cargar.mjs';

const D = datos();
const P = ejercicio();
const { SA } = salud(D, P);
const plano = (o) => JSON.parse(JSON.stringify(o));

test('el programa está completo: cada día tiene sesión y cada sesión cuatro semanas', () => {
  for (let d = 0; d < 7; d++) assert.ok(P.sesiones[P.semana_tipo[String(d)]], `día ${d}`);
  const princ = Object.values(P.semana_tipo).filter((s) => P.sesiones[s].principal);
  assert.equal(princ.length, 4, 'dos de fuerza y dos de yoga');
  assert.equal(princ.filter((s) => P.sesiones[s].tipo === 'fuerza').length, 2);
  assert.equal(princ.filter((s) => P.sesiones[s].tipo === 'yoga').length, 2);
  for (const s of Object.values(P.sesiones)) if (s.tipo === 'cardio') {
    assert.equal(s.principal, false, 'la caminata es opcional');
    assert.ok(s.vid && s.fig, `${s.n}: video e ilustración`);
  }
  for (const [id, s] of Object.entries(P.sesiones)) {
    assert.equal(s.min.length, P.semanas, `${id}: minutos por semana`);
    for (const e of s.ej || []) {
      assert.ok(e.reps.length === 1 || e.reps.length === P.semanas, `${id}: ${e.n}`);
      assert.ok(e.c && e.v, `${id}: ${e.n} trae indicación y búsqueda de videos`);
      assert.match(e.vid && e.vid.id, /^[\w-]{11}$/, `${id}: ${e.n} trae un video concreto`);
      assert.ok(e.fig && e.fig.a && e.fig.a.n && e.fig.a.p, `${id}: ${e.n} trae ilustración`);
    }
  }
  assert.ok(P.seguridad.some((x) => /respiración/.test(x)), 'no aguantar la respiración');
  assert.ok(P.seguridad.some((x) => /pecho/.test(x)), 'señales para detenerse');
});

test('la semana del plan cuenta desde el lunes y el nivel se detiene en la semana 4', () => {
  const st = SA.vacio();
  assert.equal(SA.semanaEj(st, '2026-09-30'), 0, 'sin empezar');
  assert.equal(SA.empezarEj(st, '2026-09-30'), '2026-09-28', 'un miércoles empieza en su lunes');
  assert.equal(SA.semanaEj(st, '2026-10-04'), 1);
  assert.equal(SA.semanaEj(st, '2026-10-05'), 2);
  assert.equal(SA.semanaEj(st, '2026-11-02'), 6);
  assert.equal(SA.nivelEj(st, '2026-11-02'), 4);
  assert.equal(SA.sesionDia('2026-09-28'), 'fa');
  assert.equal(SA.sesionDia('2026-09-29'), 'yoga');
  assert.equal(SA.sesionDia('2026-10-04'), 'desc');
});

test('la progresión sube minutos, vueltas y repeticiones', () => {
  const c1 = SA.detalleSesion('cam', 1), c4 = SA.detalleSesion('cam', 4);
  assert.ok(c4.min > c1.min);
  const f1 = SA.detalleSesion('fa', 1), f3 = SA.detalleSesion('fa', 3);
  assert.equal(f1.vueltas, 2); assert.equal(f3.vueltas, 3);
  assert.equal(f1.ej[0].reps, '10');
  assert.equal(SA.detalleSesion('fa', 2).ej[0].reps, '12');
  assert.equal(SA.detalleSesion('yoga', 3).vueltas, 1); assert.equal(SA.detalleSesion('yoga', 4).vueltas, 2);
  assert.equal(SA.detalleSesion('yoga', 1).ej.length, 8);
  assert.ok(SA.detalleSesion('fa', 1).ej[0].vid.id && SA.detalleSesion('cam', 1).fig, 'el detalle lleva video e ilustración');
  assert.equal(SA.detalleSesion('fa', 9).vueltas, 3, 'fuera de rango usa la última semana');
});

test('marcar, reemplazar y desmarcar sesiones; el resumen semanal cuenta las principales', () => {
  const st = SA.vacio();
  SA.empezarEj(st, '2026-09-28');
  assert.ok(SA.marcarEj(st, '2026-09-28', 'fa'));
  assert.equal(SA.hechaEj(st, '2026-09-28', 'fa').min, 30, 'sin minutos, los del plan');
  assert.ok(SA.marcarEj(st, '2026-09-28', 'fa', 40, 6));
  assert.equal(st.ejercicio.hechas.length, 1, 'la misma sesión el mismo día se reemplaza');
  assert.equal(SA.marcarEj(st, '2026-09-28', 'desc'), false, 'el descanso no se marca');
  assert.equal(SA.marcarEj(st, '2026-09-28', 'pilates'), false, 'solo sesiones del plan');
  assert.equal(SA.marcarEj(st, '2026-09-28', 'cam', 0), false);
  assert.ok(SA.marcarEj(st, '2026-09-29', 'yoga', 35, 12), 'un esfuerzo fuera de escala se descarta');
  assert.equal(SA.hechaEj(st, '2026-09-29', 'yoga').esf, null);
  SA.marcarEj(st, '2026-10-01', 'cam', 30);   // jueves de fuerza B: caminó en su lugar
  const R = SA.semanaResumenEj(st, '2026-10-01');
  assert.equal(R.principales, 4);
  assert.equal(R.hechasPrincipales, 2);
  assert.equal(R.extras, 1);
  assert.equal(R.minutos, 105);
  assert.equal(R.dias[3].hecha, false); assert.equal(R.dias[3].hechas.length, 1);
  assert.ok(SA.desmarcarEj(st, '2026-10-01', 'cam'));
  assert.equal(SA.desmarcarEj(st, '2026-10-01', 'cam'), false);
});

test('el ejercicio viaja en el respaldo y en el resumen para el médico', () => {
  const st = SA.vacio();
  SA.empezarEj(st, '2026-09-28');
  SA.marcarEj(st, '2026-09-28', 'fa', 30, 5);
  SA.marcarEj(st, '2026-09-29', 'cam', 30, 4);
  const back = SA.importar(SA.exportar(st));
  assert.deepEqual(plano(back.ejercicio), plano(st.ejercicio));
  assert.match(SA.textoResumen(st, '2026-09-30'), /Ejercicio, últimos 7 días: 2 sesiones, 60 min \(semana 1/);
  const viejo = SA.normalizar({ v: 1, agua: {}, medidas: [], examenes: [] });
  assert.deepEqual(plano(viejo.ejercicio), { inicio: '', hechas: [] }, 'un estado anterior sigue abriendo');
  const soloEx = SA.normalizar({ examenes: [{ f: '2026-09-01', valores: { glucosa: 90 } }], ejercicio: { hechas: [{ f: '2026-09-02', s: 'cam', min: 30 }] } });
  assert.equal(SA.soloExamenes(soloEx), false, 'un respaldo con ejercicio no se suma como si fuera solo de exámenes');
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
let browser;
test.before(async () => { if (pw) browser = await pw.chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

for (const ancho of [320, 390, 1280]) {
  test(`ejercicio a ${ancho} px: empezar, ver la rutina, marcar y registrar persiste tras recargar`, { skip: saltar }, async () => {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: 844 } });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await page.goto(URL_APP);
    assert.match(await page.textContent('.ej-mini'), /Plan de ejercicio en casa/);
    await page.click('.ej-mini [data-sa="ejver"]');
    assert.equal(await page.getAttribute('nav.main button[data-v="salud"]', 'aria-selected'), 'true');
    assert.ok(await page.locator('#sa-ejercicio details[open]').count() >= 1, 'la seguridad se ve abierta antes de empezar');
    await page.click('[data-sa="ejempezar"]');
    assert.match(await page.textContent('#sa-ejercicio .sa-stat'), /1\s*de 4/);
    assert.equal(await page.locator('.ej-dia').count(), 7);
    // Lunes de esta semana: Fuerza A con su circuito.
    await page.locator('.ej-dia').first().click();
    assert.match(await page.textContent('#ejSes h3'), /Fuerza A/);
    assert.equal(await page.locator('#ejSes .ej-list li').count(), 6);
    assert.equal(await page.locator('#ejSes .ej-list li .ej-anim svg.fg').count(), 6, 'una figura animada por ejercicio');
    // La figura se mueve sola; al tocarla se detiene y la barra la lleva a mano hasta el final.
    const fig = page.locator('#ejSes .ej-anim').first(), dibujo = () => fig.locator('svg.fg').innerHTML();
    const d0 = await dibujo();
    await page.waitForTimeout(700);
    assert.notEqual(await dibujo(), d0, 'la figura se mueve');
    await fig.locator('.fg-btn').click();
    assert.equal(await fig.locator('.fg-btn').getAttribute('aria-pressed'), 'false', 'queda en pausa');
    const d1 = await dibujo();
    await page.waitForTimeout(400);
    assert.equal(await dibujo(), d1, 'en pausa no cambia');
    await fig.locator('.fg-rango').fill('1000');
    assert.equal(await fig.locator('figcaption').textContent(), 'Final');
    await fig.locator('.fg-btn').click();
    assert.equal(await fig.locator('.fg-btn').getAttribute('aria-pressed'), 'true', 'se reanuda');
    await page.locator('#ejSes [data-sa^="ejvideo|"]').first().click();
    assert.match(await page.getAttribute('#ejSes .ej-player iframe', 'src'), /youtube-nocookie\.com\/embed\/[\w-]{11}/);
    await page.locator('#ejSes [data-sa^="ejvideo|"]').first().click();
    assert.equal(await page.locator('#ejSes .ej-player iframe').count(), 0, 'se cierra');
    // Martes: yoga con ocho posturas; miércoles: caminata opcional con ilustración y video.
    await page.locator('.ej-dia').nth(1).click();
    assert.match(await page.textContent('#ejSes h3'), /Yoga/);
    assert.equal(await page.locator('#ejSes .ej-list li').count(), 8);
    await page.locator('.ej-dia').nth(2).click();
    assert.match(await page.textContent('#ejSes h3'), /Caminata.*opcional/s);
    assert.ok(await page.locator('#ejSes .ej-card .ej-anim svg.fg').count() === 1);
    assert.ok(await page.locator('#ejSes [data-sa^="ejvideo|"]').count() === 1);
    await page.locator('.ej-dia').first().click();
    const lunesMarcable = await page.locator('#ejSes [data-sa^="ejmarcar|"]').count();
    if (lunesMarcable) {
      await page.click('#ejSes [data-sa^="ejmarcar|"]');
      assert.match(await page.textContent('#ejSes'), /Hecha · 30 min/);
    }
    // Hoy: registrar una caminata con minutos y esfuerzo.
    await page.click('.ej-dia.hoy');
    await page.selectOption('#ejForm [name=s]', 'cam');
    await page.fill('#ejForm [name=min]', '35');
    await page.selectOption('#ejForm [name=esf]', '5');
    await page.click('#ejForm [type=submit]');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(ov <= 0, `sin desborde horizontal (${ov} px)`);
    await page.reload();
    const g = await page.evaluate(() => JSON.parse(localStorage.getItem('recetario.salud')).ejercicio);
    assert.ok(g.inicio);
    assert.ok(g.hechas.some((h) => h.s === 'cam' && h.min === 35 && h.esf === 5));
    assert.equal(g.hechas.length, lunesMarcable ? (g.hechas.some((h) => h.s === 'fa') ? 2 : 1) : 1);
    assert.match(await page.textContent('#sa-ejercicio'), /Último esfuerzo\s*5/);
    await page.click('#marca');
    assert.ok(await page.locator('.ej-mini').count() === 1);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('sesión en curso: cada ejercicio por vuelta; al completar el último queda marcada', () => {
  const st = SA.vacio();
  SA.empezarEj(st, '2026-09-28');
  assert.equal(SA.progresoEj(st, '2026-09-28', 'cam'), null, 'la caminata se marca de una vez');
  const todos = SA.pasosSesion(st, '2026-09-28', 'fa');
  assert.equal(todos.length, 12, 'semana 1: dos vueltas de seis ejercicios');
  let p = SA.pasoEj(st, '2026-09-28', 'fa', '1.1');
  assert.equal(p.hechos, 1); assert.equal(p.completa, false);
  p = SA.pasoEj(st, '2026-09-28', 'fa', '1.1');
  assert.equal(p.hechos, 0, 'tocar otra vez lo desmarca');
  assert.equal(SA.pasoEj(st, '2026-09-28', 'fa', '9.9'), null);
  todos.slice(0, -1).forEach((k) => SA.pasoEj(st, '2026-09-28', 'fa', k));
  assert.equal(SA.hechaEj(st, '2026-09-28', 'fa'), null);
  const back = SA.normalizar(plano(st));
  assert.equal(back.ejercicio.curso.m.length, 11, 'lo hecho a medias se guarda y se sincroniza');
  p = SA.pasoEj(st, '2026-09-28', 'fa', todos[todos.length - 1]);
  assert.ok(p.completa && p.recien);
  assert.equal(SA.hechaEj(st, '2026-09-28', 'fa').min, 30);
  assert.equal(st.ejercicio.curso, undefined);
  assert.equal(SA.progresoEj(st, '2026-09-28', 'fa').completa, true);
  assert.equal(SA.pasoEj(st, '2026-09-28', 'fa', '1.1'), null, 'ya hecha: no se toca');
});

test('fusión entre dispositivos: lo que cada uno hizo se suma y lo borrado no vuelve', () => {
  const base = SA.vacio();
  SA.empezarEj(base, '2026-09-28');
  SA.marcarEj(base, '2026-09-28', 'fa', 30, 5);
  SA.registrar(base, '2026-09-29', 'agua', 250, '08:00');
  const tel = SA.normalizar(plano(base)), pc = SA.normalizar(plano(base));
  // En el teléfono: yoga de hoy a medias, un vaso más y borra la fuerza del lunes.
  SA.pasoEj(tel, '2026-09-29', 'yoga', '1.1'); SA.pasoEj(tel, '2026-09-29', 'yoga', '1.2');
  SA.registrar(tel, '2026-09-29', 'agua', 250, '09:00');
  SA.desmarcarEj(tel, '2026-09-28', 'fa');
  // En la computadora, a la vez: otro paso del yoga, un café y una caminata del domingo.
  SA.pasoEj(pc, '2026-09-29', 'yoga', '1.3');
  SA.registrar(pc, '2026-09-29', 'cafe', 200, '09:05');
  SA.marcarEj(pc, '2026-09-27', 'larga', 40, 3);
  SA.guardarMedida(pc, { f: '2026-09-29', kg: 84.2 });
  const r = SA.fusionar(base, tel, pc);
  assert.deepEqual(plano(r.ejercicio.curso.m), ['1.1', '1.2', '1.3']);
  assert.equal(r.agua['2026-09-29'].length, 3);
  assert.equal(SA.hechaEj(r, '2026-09-28', 'fa'), null, 'lo desmarcado no reaparece');
  assert.ok(SA.hechaEj(r, '2026-09-27', 'larga'));
  assert.equal(r.medidas[0].kg, 84.2);
  // Sin cambios propios, queda lo remoto; y la misma sesión editada en ambos lados, gana lo local.
  assert.ok(SA.igualSalud(SA.fusionar(base, base, pc), SA.normalizar(plano(pc))));
  const a = SA.normalizar(plano(base)), b = SA.normalizar(plano(base));
  SA.marcarEj(a, '2026-09-28', 'fa', 35, 6); SA.marcarEj(b, '2026-09-28', 'fa', 40, 7);
  assert.equal(SA.hechaEj(SA.fusionar(base, a, b), '2026-09-28', 'fa').min, 35);
  // Si en un lado la sesión en curso se completó, no queda a medias.
  const c = SA.normalizar(plano(base)), d = SA.normalizar(plano(base));
  SA.pasoEj(c, '2026-09-29', 'yoga', '1.1');
  SA.pasosSesion(d, '2026-09-29', 'yoga').forEach((k) => SA.pasoEj(d, '2026-09-29', 'yoga', k));
  const e = SA.fusionar(base, c, d);
  assert.ok(SA.hechaEj(e, '2026-09-29', 'yoga'));
  assert.equal(e.ejercicio.curso, undefined);
});
