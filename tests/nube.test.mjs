// Pruebas de la nube propia: las funciones de Cloudflare Pages (functions/api) con un KV en memoria,
// y la app en varios navegadores que comparten datos a través de esas mismas funciones.
// Uso: node --test tests/nube.test.mjs   (la parte de navegador requiere Playwright)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mw from '../functions/api/_middleware.js';
import * as nube from '../functions/api/nube.js';
import * as doc from '../functions/api/doc/[col]/[id].js';

const CLAVE = 'abcde-fghjk-mnpqr-stuvw';

function kv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.get(k); const tipo = t && typeof t === 'object' ? t.type : t; return v === undefined ? null : (tipo === 'json' ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); } };
}
const envCon = (DATOS = kv(), extra = {}) => ({ DATOS, CLAVE_NUBE: CLAVE, ...extra });

/* Ejecuta middleware + ruta como lo haría Pages. */
async function llamar(env, metodo, ruta, { clave, auth, cuerpo, origen } = {}) {
  const headers = new Headers();
  if (origen) headers.set('Origin', origen);
  if (auth !== undefined) headers.set('Authorization', auth);
  else if (clave !== undefined) headers.set('Authorization', 'Bearer ' + clave);
  if (cuerpo !== undefined) headers.set('content-type', 'application/json');
  const request = new Request('https://recetario-intercambiable.pages.dev' + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) });
  let handler = () => new Response('no', { status: 404 }), params = {};
  const m = /^\/api\/doc\/([^/]+)\/([^/]+)$/.exec(ruta);
  if (ruta === '/api/nube') handler = nube.onRequestGet;
  else if (m) { params = { col: m[1], id: m[2] }; handler = metodo === 'PUT' ? doc.onRequestPut : doc.onRequestGet; }
  const context = { request, env, params, data: {}, next: () => handler(context) };
  return mw.onRequest(context);
}

test('sin KV o sin clave configurada (o demasiado corta) la nube responde 503', async () => {
  assert.equal((await llamar({ CLAVE_NUBE: CLAVE }, 'GET', '/api/nube', { clave: CLAVE })).status, 503);
  assert.equal((await llamar({ DATOS: kv() }, 'GET', '/api/nube', { clave: CLAVE })).status, 503);
  assert.equal((await llamar({ DATOS: kv(), CLAVE_NUBE: 'corta' }, 'GET', '/api/nube', { clave: 'corta' })).status, 503);
});

test('el candado exige la clave exacta', async () => {
  const env = envCon();
  assert.equal((await llamar(env, 'GET', '/api/nube')).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { clave: CLAVE + 'x' })).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { auth: CLAVE })).status, 401, 'sin Bearer');
  assert.equal((await llamar(env, 'GET', '/api/doc/salud/actual', { clave: 'otra-clave-de-veinte-car' })).status, 401);
  const ok = await llamar(env, 'GET', '/api/nube', { clave: CLAVE });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('documentos con versión y conflicto; rutas y cuerpos inválidos rechazados', async () => {
  const env = envCon(), clave = CLAVE;
  let r = await llamar(env, 'GET', '/api/doc/salud/actual', { clave });
  assert.equal(r.status, 404);
  r = await llamar(env, 'PUT', '/api/doc/salud/actual', { clave, cuerpo: { base: null, data: { v: 1, agua: {} } } });
  assert.equal(r.status, 200); assert.equal((await r.json()).version, 1);
  r = await llamar(env, 'PUT', '/api/doc/salud/actual', { clave, cuerpo: { base: 1, data: { v: 1, agua: { x: 1 } } } });
  assert.equal((await r.json()).version, 2);
  r = await llamar(env, 'PUT', '/api/doc/salud/actual', { clave, cuerpo: { base: 1, data: { v: 1, pisado: true } } });
  assert.equal(r.status, 409, 'una versión vieja no pisa lo guardado');
  const c = await r.json();
  assert.equal(c.version, 2); assert.deepEqual(c.data, { v: 1, agua: { x: 1 } });
  r = await llamar(env, 'GET', '/api/doc/salud/actual', { clave });
  assert.deepEqual((await r.json()).data, { v: 1, agua: { x: 1 } });
  assert.equal((await llamar(env, 'GET', '/api/doc/secreto/x', { clave })).status, 404);
  assert.equal((await llamar(env, 'PUT', '/api/doc/menu/actual', { clave, cuerpo: { base: null, data: [1] } })).status, 400);
  assert.equal((await llamar(env, 'PUT', '/api/doc/menu/actual', { clave, cuerpo: '{roto' })).status, 400);
  assert.deepEqual([...env.DATOS.m.keys()], ['u:principal:salud/actual']);
  r = await llamar(env, 'PUT', '/api/doc/viaje/actual', { clave, cuerpo: { base: null, data: { v: 1, items: [] } } });
  assert.equal(r.status, 200, 'la lista del viaje también se guarda en la nube');
});

test('una copia de KV atrasada en otra región no rechaza al dispositivo que ya vio una versión más nueva', async () => {
  const env = envCon(), clave = CLAVE;
  env.DATOS.m.set('u:principal:menu/actual', JSON.stringify({ version: 3, data: { v: 4, fase: 1 } }));
  let r = await llamar(env, 'PUT', '/api/doc/menu/actual', { clave, cuerpo: { base: 5, data: { v: 4, fase: 2 } } });
  assert.equal(r.status, 200); assert.equal((await r.json()).version, 6);
  r = await llamar(env, 'PUT', '/api/doc/menu/actual', { clave, cuerpo: { base: null, data: { v: 4, fase: 1 } } });
  assert.equal(r.status, 409, 'sin versión no se pisa lo guardado');
});

test('la app de ruso usa la misma nube desde su sitio: CORS solo para ese origen y su documento propio', async () => {
  const env = envCon(), RU = 'https://ruso-recepciones.pages.dev';
  let r = await llamar(env, 'OPTIONS', '/api/doc/ruso/progreso', { origen: RU });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), RU);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal((await llamar(env, 'OPTIONS', '/api/doc/ruso/progreso', { origen: 'https://malicioso.example' })).status, 403);
  r = await llamar(env, 'OPTIONS', '/api/nube', { origen: 'https://rama.ruso-recepciones.pages.dev' });
  assert.equal(r.status, 204, 'las vistas previas de ramas también');
  assert.equal((await llamar(env, 'OPTIONS', '/api/nube', { origen: 'https://ruso-recepciones.pages.dev.malicioso.example' })).status, 403);
  r = await llamar(env, 'PUT', '/api/doc/ruso/progreso', { clave: CLAVE, origen: RU, cuerpo: { base: null, data: { v: 2, progress: { 1: { A: true } } } } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), RU);
  r = await llamar(env, 'GET', '/api/doc/ruso/progreso', { clave: 'mala-clave-de-veinte-caract', origen: RU });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), RU, 'el 401 también es legible para pedir la clave');
  r = await llamar(env, 'GET', '/api/nube', { clave: CLAVE, origen: 'https://malicioso.example' });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  r = await llamar(env, 'GET', '/api/doc/ruso/progreso', { clave: CLAVE });
  assert.equal((await r.json()).data.progress[1].A, true);
});

/* ---------- la app con la nube, en el navegador ---------- */
function cargarPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {}
  return null;
}
const pw = cargarPlaywright();
const saltar = pw ? false : 'Playwright no está disponible';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Servidor local: archivos estáticos y /api/* por las funciones reales, con el env que diga la prueba. */
function servidor(estado) {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      let cuerpo;
      if (req.method === 'PUT') { const b = []; for await (const c of req) b.push(c); cuerpo = Buffer.concat(b).toString(); }
      const r = await llamar(estado.env, req.method, u.pathname, { auth: req.headers.authorization || '', cuerpo });
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
    }
    const f = path.join(raiz, decodeURIComponent(u.pathname === '/' ? 'index.html' : u.pathname));
    if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

let browser, srv, BASE;
const estado = { env: envCon() };
test.before(async () => {
  if (!pw) return;
  browser = await pw.chromium.launch();
  srv = servidor(estado);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  BASE = `http://127.0.0.1:${srv.address().port}/`;
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

async function dispositivo(clave, ancho = 390) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  /* Solo en la primera carga: así «Desconectar» puede borrarla de verdad. */
  if (clave) await ctx.addInitScript((c) => { if (sessionStorage.getItem('clave-puesta')) return; sessionStorage.setItem('clave-puesta', '1'); localStorage.setItem('recetario.clave', c); }, clave);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  return { ctx, page, errores };
}
const sincronizado = (p) => p.waitForFunction(() => document.getElementById('syncTxt').textContent === 'Sincronizado', null, { timeout: 8000 });
const agua = (p, re) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('aguaTot').textContent), re, { timeout: 8000 });

test('nube sin configurar: la app genera una clave localmente y sigue guardando en el dispositivo', { skip: saltar }, async () => {
  estado.env = { DATOS: kv() };
  const { ctx, page, errores } = await dispositivo(null);
  await page.goto(BASE + '#salud');
  await page.waitForSelector('[data-nube="generar"]');
  assert.equal(await page.textContent('#syncTxt'), 'Guardado en este dispositivo');
  await page.click('[data-nube="generar"]');
  const c = (await page.textContent('#nubeGenerada')).trim();
  assert.match(c, /^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
  await page.click('[data-nube="copiar"]');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), c);
  assert.equal(await page.evaluate(() => localStorage.getItem('recetario.clave')), null, 'generar no la guarda ni la envía');
  assert.deepEqual(errores, []);
  await ctx.close();
  estado.env = envCon();
});

test('sin clave: aviso en Inicio; clave incorrecta se rechaza; la correcta conecta y sube lo local', { skip: saltar }, async () => {
  estado.env = envCon();
  const { ctx, page, errores } = await dispositivo(null);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('recetario.salud', JSON.stringify({ v: 1, agua: {}, medidas: [{ f: '2026-09-20', kg: 83.5 }], examenes: [] }));
  });
  await page.goto(BASE);
  await page.waitForSelector('.agua-mini [data-goto="salud"] >> text=Conectar mi nube');
  await page.click('text=Conectar mi nube');
  await page.fill('#nubeClave', 'clave-equivocada-de-prueba');
  await page.click('#nubeForm [type=submit]');
  await page.waitForSelector('#sa-nube [role=alert]');
  assert.match(await page.textContent('#sa-nube'), /Clave incorrecta/);
  await page.fill('#nubeClave', CLAVE);
  await Promise.all([page.waitForEvent('load'), page.click('#nubeForm [type=submit]')]);
  await sincronizado(page);
  assert.match(await page.textContent('#sa-nube'), /Conectada/);
  assert.match(await page.textContent('#sa-peso'), /83,5/);
  const guardado = JSON.parse(estado.env.DATOS.m.get('u:principal:salud/actual'));
  assert.equal(guardado.data.medidas[0].kg, 83.5, 'lo local se subió a la nube');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('dos dispositivos con la misma clave comparten menú y Salud; el enlace conecta otro dispositivo', { skip: saltar }, async () => {
  estado.env = envCon();
  const tel = await dispositivo(CLAVE);
  await tel.page.goto(BASE + '#salud');
  await sincronizado(tel.page);
  await tel.page.click('[data-sa="agua|agua|500"]');
  await sincronizado(tel.page);
  await tel.page.selectOption('#comensales', '2');
  await sincronizado(tel.page);
  await tel.page.click('[data-nube="enlace"]');
  const enlace = await tel.page.evaluate(() => navigator.clipboard.readText());
  assert.match(enlace, /#nube=abcde-fghjk-mnpqr-stuvw$/);

  const pc = await dispositivo(null, 1280);
  await pc.page.goto(enlace);
  await agua(pc.page, '^0,5 ');
  assert.equal(await pc.page.evaluate(() => location.hash), '#salud', 'la clave no queda en la barra de direcciones');
  assert.equal(await pc.page.evaluate(() => localStorage.getItem('recetario.clave')), CLAVE);
  assert.equal(await pc.page.inputValue('#comensales'), '2', 'el menú también se comparte');

  await pc.page.click('[data-sa="agua|agua|250"]');
  await sincronizado(pc.page);
  await tel.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await agua(tel.page, '^0,75 ');
  assert.deepEqual([...tel.errores, ...pc.errores], []);
  await Promise.all([tel.ctx.close(), pc.ctx.close()]);
});

test('conflicto: si otro dispositivo guardó antes, se suman ambos registros sin pisar ninguno', { skip: saltar }, async () => {
  estado.env = envCon();
  const a = await dispositivo(CLAVE), b = await dispositivo(CLAVE);
  await a.page.goto(BASE + '#salud'); await sincronizado(a.page);
  await a.page.click('[data-sa="agua|agua|250"]'); await sincronizado(a.page);
  await b.page.goto(BASE + '#salud');
  await agua(b.page, '^0,25 ');
  await a.page.click('[data-sa="agua|agua|500"]'); await sincronizado(a.page);
  await b.page.click('[data-sa="agua|infusion|250"]');
  await agua(b.page, '^1,0 ');
  await sincronizado(b.page);
  const g = JSON.parse(estado.env.DATOS.m.get('u:principal:salud/actual')).data;
  assert.equal(Object.values(g.agua)[0].length, 3, 'en la nube quedan los tres registros');
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await agua(a.page, '^1,0 ');
  await Promise.all([a.ctx.close(), b.ctx.close()]);
});

test('menú: cambios hechos a la vez en dos dispositivos se suman y ninguno se pierde', { skip: saltar }, async () => {
  estado.env = envCon();
  const a = await dispositivo(CLAVE), b = await dispositivo(CLAVE, 1280);
  await a.page.goto(BASE); await sincronizado(a.page);
  await b.page.goto(BASE); await sincronizado(b.page);
  await a.page.selectOption('#comensales', '3'); await sincronizado(a.page);
  // b aún no ha consultado la nube: su cambio sale con una versión atrasada (409) y se fusiona.
  await b.page.selectOption('#fase', '2');
  await b.page.waitForFunction(() => document.getElementById('comensales').value === '3', null, { timeout: 8000 });
  await sincronizado(b.page);
  assert.equal(await b.page.inputValue('#fase'), '2', 'el cambio propio no se pierde');
  const g = JSON.parse(estado.env.DATOS.m.get('u:principal:menu/actual')).data;
  assert.equal(g.comensales, 3); assert.equal(g.fase, 2);
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.waitForFunction(() => document.getElementById('fase').value === '2', null, { timeout: 8000 });
  assert.equal(await a.page.inputValue('#comensales'), '3');
  assert.deepEqual([...a.errores, ...b.errores], []);
  await Promise.all([a.ctx.close(), b.ctx.close()]);
});

test('ejercicio en vivo: lo que marcas en el teléfono aparece solo en la computadora, y viceversa', { skip: saltar }, async () => {
  estado.env = envCon();
  const tel = await dispositivo(CLAVE), pc = await dispositivo(CLAVE, 1280);
  await tel.page.goto(BASE + '#salud'); await sincronizado(tel.page);
  await tel.page.click('[data-sa="ejempezar"]'); await sincronizado(tel.page);
  await pc.page.goto(BASE + '#salud'); await sincronizado(pc.page);
  // Lunes de esta semana: Fuerza A, con su lista de pasos (el lunes nunca es futuro).
  for (const p of [tel.page, pc.page]) await p.locator('.ej-dia').first().click();
  const pasos = await tel.page.locator('#ejSes .ej-paso').count();
  assert.ok(pasos >= 12, 'un botón por ejercicio y vuelta');
  await tel.page.locator('#ejSes .ej-paso').nth(0).click(); await sincronizado(tel.page);
  await pc.page.locator('#ejSes .ej-paso').nth(1).click(); await sincronizado(pc.page);
  // Sin tocar nada más: la consulta periódica trae el paso del otro dispositivo.
  const dos = (p) => p.waitForFunction(() => /^2 de /.test(document.querySelector('#ejProg .ej-prog-tx span').textContent), null, { timeout: 25000 });
  await Promise.all([dos(tel.page), dos(pc.page)]);
  // Completar desde la computadora marca la sesión en ambos.
  const faltan = await pc.page.locator('#ejSes .ej-paso:not(.ok)').count();
  for (let i = 0; i < faltan; i++) { await pc.page.locator('#ejSes .ej-paso:not(.ok)').first().click(); }
  await pc.page.waitForSelector('#ejSes >> text=Sesión completa');
  await sincronizado(pc.page);
  await tel.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tel.page.waitForSelector('#ejSes .chip-s.ok >> text=Hecha', { timeout: 8000 });
  const g = JSON.parse(estado.env.DATOS.m.get('u:principal:salud/actual')).data.ejercicio;
  assert.equal(g.hechas.length, 1); assert.equal(g.curso, undefined);
  assert.deepEqual([...tel.errores, ...pc.errores], []);
  await Promise.all([tel.ctx.close(), pc.ctx.close()]);
});

test('si cambias la clave en Cloudflare, la app la vuelve a pedir sin perder lo local', { skip: saltar }, async () => {
  estado.env = envCon();
  const d = await dispositivo(CLAVE);
  await d.page.goto(BASE + '#salud'); await sincronizado(d.page);
  estado.env = { ...estado.env, CLAVE_NUBE: 'nueva-clave-distinta-xyz' };
  await d.page.click('[data-sa="agua|agua|250"]');
  await d.page.waitForSelector('#nubeClave', { timeout: 8000 });
  assert.match(await d.page.textContent('#syncTxt'), /Error al sincronizar/);
  assert.match(await d.page.textContent('#aguaTot'), /^0,25 /, 'lo local no se pierde');
  await d.page.click('[data-sa="deshacer"]');
  assert.deepEqual(d.errores, []);
  await d.ctx.close();
  estado.env = envCon();
});

test('desconectar olvida la clave en este dispositivo', { skip: saltar }, async () => {
  estado.env = envCon();
  const d = await dispositivo(CLAVE);
  d.page.on('dialog', (x) => x.accept());
  await d.page.goto(BASE + '#salud'); await sincronizado(d.page);
  await Promise.all([d.page.waitForEvent('load'), d.page.click('[data-nube="olvidar"]')]);
  await d.page.waitForSelector('#nubeClave');
  assert.equal(await d.page.evaluate(() => localStorage.getItem('recetario.clave')), null);
  await d.ctx.close();
});
