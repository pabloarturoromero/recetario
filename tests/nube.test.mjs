// Pruebas de la nube propia: las funciones de Cloudflare Pages (functions/api) con un KV en memoria
// y claves de Access generadas aquí, y la app en dos navegadores que comparten datos a través de ellas.
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
import * as entrar from '../functions/api/entrar.js';
import * as doc from '../functions/api/doc/[col]/[id].js';

const EQUIPO = 'amor.cloudflareaccess.com', AUD = 'aud-prueba';

/* ---------- claves y tokens de Access simulados ---------- */
const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const otro = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256' };
const b64 = (u8) => Buffer.from(u8).toString('base64url');
async function token(carga, clave = par.privateKey, kid = 'k1') {
  const c = b64(Buffer.from(JSON.stringify({ alg: 'RS256', kid })));
  const p = b64(Buffer.from(JSON.stringify(carga)));
  const f = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(c + '.' + p));
  return c + '.' + p + '.' + b64(new Uint8Array(f));
}
const ahora = () => Math.floor(Date.now() / 1000);
const valido = (email = 'Arturo@Ejemplo.com', extra = {}) => token({ aud: [AUD], iss: `https://${EQUIPO}`, exp: ahora() + 3600, email, ...extra });

const fetchReal = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u) === `https://${EQUIPO}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
  return fetchReal(u, o);
};

function kv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); } };
}
const envCon = (DATOS = kv(), extra = {}) => ({ DATOS, ACCESS_TEAM_DOMAIN: EQUIPO, ACCESS_AUD: AUD, ...extra });

/* Ejecuta middleware + ruta como lo haría Pages. */
async function llamar(env, metodo, ruta, { jwt, cuerpo } = {}) {
  const headers = new Headers();
  if (jwt) headers.set('Cf-Access-Jwt-Assertion', jwt);
  if (cuerpo !== undefined) headers.set('content-type', 'application/json');
  const request = new Request('https://recetario-intercambiable.pages.dev' + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let handler, params = {};
  const m = /^\/api\/doc\/([^/]+)\/([^/]+)$/.exec(ruta);
  if (ruta === '/api/nube') handler = nube.onRequestGet;
  else if (ruta === '/api/entrar') handler = entrar.onRequestGet;
  else if (m) { params = { col: m[1], id: m[2] }; handler = metodo === 'PUT' ? doc.onRequestPut : doc.onRequestGet; }
  const context = { request, env, params, data: {}, next: () => handler(context) };
  return mw.onRequest(context);
}

test('sin configuración la nube responde 503 y no lee nada', async () => {
  const r = await llamar({}, 'GET', '/api/nube', { jwt: await valido() });
  assert.equal(r.status, 503);
});

test('el candado rechaza sin token, con firma ajena, vencido, de otra audiencia o de otro correo', async () => {
  const env = envCon();
  assert.equal((await llamar(env, 'GET', '/api/nube')).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { jwt: await token({ aud: [AUD], iss: `https://${EQUIPO}`, exp: ahora() + 60, email: 'a@b.c' }, otro.privateKey) })).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { jwt: await valido('a@b.c', { exp: ahora() - 10 }) })).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { jwt: await valido('a@b.c', { aud: ['otra'] }) })).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { jwt: await valido('a@b.c', { iss: 'https://otro.cloudflareaccess.com' }) })).status, 401);
  assert.equal((await llamar(env, 'GET', '/api/nube', { jwt: 'x.y' })).status, 401);
  const lista = envCon(kv(), { CORREOS_PERMITIDOS: 'arturo@ejemplo.com' });
  assert.equal((await llamar(lista, 'GET', '/api/nube', { jwt: await valido('intruso@ejemplo.com') })).status, 403);
  const ok = await llamar(lista, 'GET', '/api/nube', { jwt: await valido() });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, email: 'arturo@ejemplo.com' });
});

test('documentos por persona, con versión y conflicto', async () => {
  const env = envCon(), jwt = await valido();
  let r = await llamar(env, 'GET', '/api/doc/salud/actual', { jwt });
  assert.equal(r.status, 404);
  r = await llamar(env, 'PUT', '/api/doc/salud/actual', { jwt, cuerpo: { base: null, data: { v: 1, agua: {} } } });
  assert.equal(r.status, 200); assert.equal((await r.json()).version, 1);
  r = await llamar(env, 'PUT', '/api/doc/salud/actual', { jwt, cuerpo: { base: 1, data: { v: 1, agua: { x: 1 } } } });
  assert.equal((await r.json()).version, 2);
  r = await llamar(env, 'PUT', '/api/doc/salud/actual', { jwt, cuerpo: { base: 1, data: { v: 1, pisado: true } } });
  assert.equal(r.status, 409, 'una versión vieja no pisa lo guardado');
  const c = await r.json();
  assert.equal(c.version, 2); assert.deepEqual(c.data, { v: 1, agua: { x: 1 } });
  r = await llamar(env, 'GET', '/api/doc/salud/actual', { jwt });
  assert.deepEqual((await r.json()).data, { v: 1, agua: { x: 1 } });
  const ajeno = await llamar(env, 'GET', '/api/doc/salud/actual', { jwt: await valido('otra@ejemplo.com') });
  assert.equal(ajeno.status, 404, 'otra persona no ve estos datos');
  assert.equal((await llamar(env, 'GET', '/api/doc/secreto/x', { jwt })).status, 404);
  assert.equal((await llamar(env, 'PUT', '/api/doc/menu/actual', { jwt, cuerpo: { base: null, data: [1] } })).status, 400);
  assert.ok([...env.DATOS.m.keys()].every((k) => k.startsWith('u:arturo@ejemplo.com:')));
});

test('entrar vuelve a la app en Salud', async () => {
  const r = await llamar(envCon(), 'GET', '/api/entrar', { jwt: await valido() });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://recetario-intercambiable.pages.dev/#salud');
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

/* Servidor local: archivos estáticos y /api/* por las funciones reales. El correo lo decide la cookie
   «quien» (así se simula Access); sin ella, /api responde como Access sin sesión. */
function servidor(env) {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const quien = /(?:^|; )quien=([^;]+)/.exec(req.headers.cookie || '');
      if (!quien) { res.writeHead(302, { location: 'https://amor.cloudflareaccess.com/cdn-cgi/access/login' }); return res.end(); }
      let cuerpo;
      if (req.method === 'PUT') { const b = []; for await (const c of req) b.push(c); cuerpo = JSON.parse(Buffer.concat(b).toString()); }
      const r = await llamar(env, req.method, u.pathname, { jwt: await valido(decodeURIComponent(quien[1])), cuerpo });
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
    }
    const f = path.join(raiz, decodeURIComponent(u.pathname === '/' ? 'index.html' : u.pathname));
    if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

let browser, srv, BASE, env;
test.before(async () => {
  if (!pw) return;
  browser = await pw.chromium.launch();
  env = envCon();
  srv = servidor(env);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  BASE = `http://127.0.0.1:${srv.address().port}/`;
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

async function dispositivo(email, ancho = 390) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  if (email) await ctx.addCookies([{ name: 'quien', value: encodeURIComponent(email), url: BASE }]);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  return { ctx, page, errores };
}
const sincronizado = (p) => p.waitForFunction(() => document.getElementById('syncTxt').textContent === 'Sincronizado', null, { timeout: 8000 });

test('sin sesión: la app funciona y ofrece conectar la nube', { skip: saltar }, async () => {
  const { ctx, page, errores } = await dispositivo(null);
  await page.goto(BASE);
  await page.waitForSelector('a[href="/api/entrar"]');
  assert.equal(await page.textContent('#syncTxt'), 'Guardado en este dispositivo');
  await page.click('nav.main button[data-v="salud"]');
  assert.match(await page.textContent('#sa-nube'), /Conectar mi nube/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('dos dispositivos con el mismo correo comparten menú y Salud; lo local se sube la primera vez', { skip: saltar }, async () => {
  const tel = await dispositivo('arturo@ejemplo.com');
  await tel.page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('recetario.salud', JSON.stringify({ v: 1, agua: {}, medidas: [{ f: '2026-09-20', kg: 83.5 }], examenes: [] }));
  });
  await tel.page.goto(BASE + '#salud');
  await sincronizado(tel.page);
  assert.match(await tel.page.textContent('#sa-nube'), /arturo@ejemplo\.com/);
  assert.match(await tel.page.textContent('#sa-peso'), /83,5/);
  await tel.page.click('[data-sa="agua|agua|500"]');
  await sincronizado(tel.page);
  await tel.page.selectOption('#comensales', '2');
  await sincronizado(tel.page);
  await tel.page.waitForFunction(() => true);

  const pc = await dispositivo('arturo@ejemplo.com', 1280);
  await pc.page.goto(BASE + '#salud');
  await pc.page.waitForFunction(() => /^0,5 /.test(document.getElementById('aguaTot').textContent), null, { timeout: 8000 });
  assert.match(await pc.page.textContent('#sa-peso'), /83,5/, 'el peso del teléfono llegó al computador');
  assert.equal(await pc.page.inputValue('#comensales'), '2', 'el menú también se comparte');

  await pc.page.click('[data-sa="agua|agua|250"]');
  await sincronizado(pc.page);
  await tel.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tel.page.waitForFunction(() => /^0,75 /.test(document.getElementById('aguaTot').textContent), null, { timeout: 8000 });

  const otra = await dispositivo('otra@ejemplo.com');
  await otra.page.goto(BASE + '#salud');
  await sincronizado(otra.page);
  assert.match(await otra.page.textContent('#aguaTot'), /^0,0 /, 'otra persona empieza vacía');
  assert.deepEqual([...tel.errores, ...pc.errores, ...otra.errores], []);
  await Promise.all([tel.ctx.close(), pc.ctx.close(), otra.ctx.close()]);
});

test('conflicto: si otro dispositivo guardó antes, se cargan sus datos y se avisa', { skip: saltar }, async () => {
  const a = await dispositivo('conflicto@ejemplo.com'), b = await dispositivo('conflicto@ejemplo.com');
  await a.page.goto(BASE + '#salud'); await sincronizado(a.page);
  await a.page.click('[data-sa="agua|agua|250"]'); await sincronizado(a.page);
  await b.page.goto(BASE + '#salud');
  await b.page.waitForFunction(() => /^0,25 /.test(document.getElementById('aguaTot').textContent), null, { timeout: 8000 });
  await a.page.click('[data-sa="agua|agua|500"]'); await sincronizado(a.page);
  await b.page.click('[data-sa="agua|infusion|250"]');
  await b.page.waitForFunction(() => /otro dispositivo/.test(document.getElementById('aviso').textContent), null, { timeout: 8000 });
  assert.match(await b.page.textContent('#aguaTot'), /^0,75 /, 'queda lo guardado por el otro dispositivo, no se pisa');
  await Promise.all([a.ctx.close(), b.ctx.close()]);
});

test('si la sesión vence, la app vuelve a ofrecer conectar la nube', { skip: saltar }, async () => {
  const d = await dispositivo('vence@ejemplo.com');
  await d.page.goto(BASE + '#salud'); await sincronizado(d.page);
  await d.ctx.clearCookies();
  await d.page.click('[data-sa="agua|agua|250"]');
  await d.page.waitForSelector('#nubeEntrar', { timeout: 8000 });
  assert.match(await d.page.textContent('#syncTxt'), /Error al sincronizar/);
  assert.match(await d.page.textContent('#aguaTot'), /^0,25 /, 'lo local no se pierde');
  assert.deepEqual(d.errores, []);
  await d.ctx.close();
});
