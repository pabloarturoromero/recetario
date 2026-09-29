// Precios de Supermaxi y exportación de lo que falta comprar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { datos, motor, semilla } from './cargar.mjs';
import { tamano, leerProducto } from '../scripts/precios-supermaxi.mjs';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const PRECIOS = JSON.parse(/<script type="application\/json" id="precios">([\s\S]*?)<\/script>/.exec(html)[1]);
const D = datos();
const M = motor(D);

test('cada producto con precio existe en el catálogo de compras y tiene datos completos', () => {
  assert.match(PRECIOS.fecha, /^\d{4}-\d{2}-\d{2}$/);
  const cat = D.compras_catalogo.productos;
  for (const [id, p] of Object.entries(PRECIOS.productos)) {
    assert.ok(cat[id], `${id} no está en compras_catalogo.productos`);
    assert.match(p.sku, /^\d+$/, id);
    assert.match(p.link, /^https:\/\/www\.supermaxi\.com\/producto\//, id);
    assert.ok(p.precio > 0, `${id} sin precio`);
    assert.ok(p.nombre, id);
    const t = p.tam || {};
    assert.ok(t.peso === 'kg' || t.g > 0 || t.ml > 0 || t.u > 0, `${id}: tamaño inválido`);
  }
  assert.ok(Object.keys(PRECIOS.productos).length >= 100);
});

test('el tamaño del paquete se deduce del nombre', () => {
  assert.deepEqual(tamano('Arroz Gourmet Integral CASA DEL ARROZ 1000 g'), { g: 1000 });
  assert.deepEqual(tamano('Harina Integral TOSCANA 1 K G'), { g: 1000 });
  assert.deepEqual(tamano('Limón Sutil LA ORIGINAL 2.5 Kg'), { g: 2500 });
  assert.deepEqual(tamano('Nuez Moscada Molida BADIA 14.20 G'), { g: 14.2 });
  assert.deepEqual(tamano('Vinagre Blanco LA ORIGINAL 500 Ml'), { ml: 500 });
  assert.deepEqual(tamano('Huevos Medianos SUPERMAXI X 12 Uds'), { u: 12 });
  assert.deepEqual(tamano('Pechuga Sin Piel SUPERMAXI Al Peso'), { peso: 'kg' });
  assert.equal(tamano('Limón Sutil SUPERMAXI Malla'), null);
});

test('el precio se lee del producto con el mismo código', () => {
  const pag = '<a href="x" class="evento-tipti a" data-name="Otro 1 G" data-precio="9.99" data-sku="1">' +
    '<a href="x" class="evento-tipti b" data-name="Arroz Envejecido SUPERMAXI 2000 G" data-precio="3.39" data-sku="1960614" data-offer="">';
  assert.deepEqual(leerProducto(pag, '1960614'), { nombre: 'Arroz Envejecido SUPERMAXI 2000 G', precio: 3.39, oferta: null });
  assert.equal(leerProducto(pag, '5'), null);
});

const P = { productos: {
  arroz_integral: { nombre: 'Arroz 1000 g', precio: 1.64, tam: { g: 1000 } },
  pollo: { nombre: 'Pechuga Al Peso', precio: 7.22, tam: { peso: 'kg' } },
  huevo: { nombre: 'Huevos X 12 Uds', precio: 2.29, tam: { u: 12 } },
  laurel: { nombre: 'Laurel 15 G', precio: 0.49, tam: { g: 15 } }
} };
const L = (producto, unidad, cant, extra = {}) => ({ producto, unidad, cant, sinCantidad: false, ...extra });

test('costo: paquetes enteros, al peso por kilo y un paquete si la unidad no se convierte', () => {
  let c = M.costoLinea(L('arroz_integral', 'g', 1450), 1450, P);
  assert.equal(c.paquetes, 2); assert.equal(c.costo, 3.28); assert.ok(c.exacto);
  c = M.costoLinea(L('arroz_integral', 'g', 1000.3), 1000.3, P);
  assert.equal(c.paquetes, 1, 'el redondeo de medio gramo no obliga a otro paquete');
  c = M.costoLinea(L('pollo', 'g', 450), 450, P);
  assert.ok(c.peso); assert.ok(Math.abs(c.costo - 3.249) < 1e-9);
  c = M.costoLinea(L('huevo', 'unidad', 13), 13, P);
  assert.equal(c.paquetes, 2);
  c = M.costoLinea(L('laurel', 'hoja', 7), 7, P);
  assert.equal(c.paquetes, 1); assert.equal(c.exacto, false);
  assert.equal(M.costoLinea(L('tofu', 'g', 200), 200, P), null);
  assert.equal(M.costoLinea(L('arroz_integral', 'g', 10), 10, null), null);
});

test('faltantes: excluye «Comprado» y «Ya tengo»; de lo parcial toma solo la diferencia', () => {
  const pl = M.plan(semilla(), 2);
  const [a, b, c] = pl.lineas;
  const marcas = { [a.clave]: { s: 'c', q: a.cant }, [b.clave]: { s: 't', q: b.cant }, [c.clave]: { s: 't', q: c.cant / 2 } };
  const fal = M.faltantes(pl.lineas, marcas);
  assert.equal(fal.length, pl.lineas.length - 2);
  assert.ok(!fal.some((f) => f.l === a || f.l === b));
  const fc = fal.find((f) => f.l === c);
  assert.ok(fc.parcial); assert.ok(Math.abs(fc.cant - c.cant / 2) < 1e-9);
});

test('con el menú de ejemplo, casi toda la lista tiene precio', () => {
  const pl = M.plan(semilla(), 2);
  const con = pl.lineas.filter((l) => M.costoLinea(l, l.cant, PRECIOS));
  assert.ok(con.length / pl.lineas.length > 0.8, `${con.length} de ${pl.lineas.length}`);
});

function cargarPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return req(execSync('npm root -g').toString().trim() + '/playwright'); } catch {}
  return null;
}
const pw = cargarPlaywright();

test('Compras: el enlace de WhatsApp lleva solo lo que falta y el total', { skip: pw ? false : 'Playwright no está disponible' }, async () => {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto('file://' + fileURLToPath(new URL('../index.html', import.meta.url)));
  await page.click('nav.main button[data-v="compras"]');
  const texto = async () => decodeURIComponent((await page.getAttribute('#waFaltan', 'href')).replace('https://wa.me/?text=', ''));
  const total = await page.locator('.sitem').count();
  let t = await texto();
  assert.match(t, /Total aproximado en Supermaxi: \$\d+,\d\d/);
  assert.equal((t.match(/^• /gm) || []).length, total);
  assert.match(await page.textContent('.faltan'), new RegExp(`Falta comprar: ${total} productos`));
  const primero = (await page.locator('.sitem .nm').first().textContent()).split(' · ')[0].trim();
  await page.locator('.sitem').first().locator('.tng').click();
  await page.locator('.sitem').nth(1).locator('.chk').click();
  t = await texto();
  assert.equal((t.match(/^• /gm) || []).length, total - 2);
  assert.ok(!t.includes('• ' + primero + ':'), 'lo que ya está en casa no se envía');
  assert.ok(await page.locator('.sitem .px').count() > 10, 'cada línea pendiente muestra su precio');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, 'sin desbordes a lo ancho en el teléfono');
  assert.deepEqual(errores, []);
  await browser.close();
});
