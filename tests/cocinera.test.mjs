// La cocinera debe verse completa en todas las secciones y anchos: debajo de la barra
// superior fija, sin tapar el contenido que sigue y con la imagen cargada.
// Carga Poppins si hay red, porque con esa fuente las cabeceras son más altas.
// Uso: node --test tests/cocinera.test.mjs   (requiere Playwright, local o global)
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

const ANCHOS = [[390, 844], [768, 1024], [1041, 800], [1100, 800], [1280, 720], [1440, 900], [1920, 1080]];
const VISTAS = ['inicio', 'recetas', 'semana', 'compras', 'prep', 'reglas'];
/* Bloques que siguen a la cabecera y que la cocinera no debe tapar. */
const SIGUIENTES = '.carousel, .sec-head h2, .gal-tools, .daysel, .wk, .shopbar, .prep-tl, main h2.eyebrow';

let browser;
test.before(async () => { if (pw) browser = await pw.chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

for (const [ancho, alto] of ANCHOS) {
  test(`cocinera completa a ${ancho} px`, { skip: saltar }, async () => {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(URL_APP, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]));
    for (const v of VISTAS) {
      await page.click(`nav.main button[data-v="${v}"]`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => { const i = document.querySelector('main .coci'); return i && i.complete; });
      const m = await page.evaluate((sel) => {
        const i = document.querySelector('main .coci'), a = i.getBoundingClientRect();
        const barra = document.querySelector('.top').getBoundingClientRect().bottom;
        const tapa = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect())
          .filter((x) => x.height > 0 && x.top >= a.top)
          .some((x) => x.top < a.bottom && x.left < a.right && x.right > a.left);
        return { arriba: a.top, barra, cargada: i.naturalWidth > 0, tapa };
      }, SIGUIENTES);
      assert.ok(m.cargada, `${v}: la imagen no cargó`);
      assert.ok(m.arriba >= m.barra, `${v}: la barra superior tapa la cabeza (${m.arriba} < ${m.barra})`);
      assert.ok(!m.tapa, `${v}: la cocinera se superpone al contenido que sigue`);
    }
    await ctx.close();
  });
}
