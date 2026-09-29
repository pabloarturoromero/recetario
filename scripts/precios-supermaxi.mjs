// Actualiza los precios de Supermaxi del bloque <script type="application/json" id="precios"> de index.html.
// Para cada producto del bloque abre su página en supermaxi.com, lee el precio y el nombre publicados
// (atributos data-precio y data-name del producto con el mismo data-sku) y deduce el tamaño del paquete.
// Uso: node scripts/precios-supermaxi.mjs [--seco]   (--seco muestra los cambios sin escribir)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUTA = fileURLToPath(new URL('../index.html', import.meta.url));
const RE_BLOQUE = /(<script type="application\/json" id="precios">)([\s\S]*?)(<\/script>)/;

const ENT = { '&#8217;': '’', '&#8211;': '–', '&#038;': '&', '&amp;': '&', '&quot;': '"', '&#8243;': '″' };
const texto = s => s.replace(/&#?\w+;/g, e => ENT[e] ?? e).replace(/\s+/g, ' ').trim();

// Tamaño del paquete a partir del nombre: «1000 g», «1 K G», «500 Ml», «X 12 Uds», «Al Peso».
export function tamano(nombre) {
  const n = nombre.replace(/,/g, '.');
  if (/\bal peso\b/i.test(n)) return { peso: 'kg' };
  let m = /\bx\s*(\d+)\s*(uds?|unidades)\b/i.exec(n);
  if (m) return { u: +m[1] };
  m = /(\d+(?:\.\d+)?)\s*(k\s?g|kilos?|kg)\b/i.exec(n);
  if (m) return { g: Math.round(+m[1] * 1000) };
  m = /(\d+(?:\.\d+)?)\s*(g|gr|grs)\b/i.exec(n);
  if (m) return { g: +m[1] };
  m = /(\d+(?:\.\d+)?)\s*(ml)\b/i.exec(n);
  if (m) return { ml: +m[1] };
  m = /(\d+(?:\.\d+)?)\s*(l|lt|litros?)\b/i.exec(n);
  if (m) return { ml: Math.round(+m[1] * 1000) };
  return null;
}

export function leerProducto(html, sku) {
  const re = /<a [^>]*class="evento-tipti[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = {};
    m[0].replace(/data-([a-z_]+)="([^"]*)"/g, (_, k, v) => { a[k] = v; });
    if (a.sku === sku) return { nombre: texto(a.name || ''), precio: +a.precio, oferta: a.offer ? +a.offer : null };
  }
  return null;
}

async function traer(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (recetario Amor de Mamá; precios semanales)' } });
      if (r.ok) return await r.text();
    } catch (e) { /* reintento */ }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}

async function main() {
  const seco = process.argv.includes('--seco');
  const html = readFileSync(RUTA, 'utf8');
  const b = RE_BLOQUE.exec(html);
  if (!b) throw new Error('No se encontró el bloque de precios en index.html');
  const P = JSON.parse(b[2]);
  const ids = Object.keys(P.productos);
  let cambios = 0, fallos = [];
  for (const id of ids) {
    const p = P.productos[id];
    const page = await traer(p.link);
    const x = page && leerProducto(page, p.sku);
    if (!x || !(x.precio > 0)) { fallos.push(id); continue; }
    const t = p.tam_fijo ? p.tam : tamano(x.nombre);
    if (!t) { fallos.push(id + ' (sin tamaño en «' + x.nombre + '»)'); continue; }
    if (p.precio !== x.precio || p.nombre !== x.nombre || JSON.stringify(p.tam) !== JSON.stringify(t)) {
      cambios++;
      console.log(`${id}: ${p.nombre ?? '—'} $${p.precio ?? '—'} → ${x.nombre} $${x.precio}`);
    }
    Object.assign(p, { nombre: x.nombre, precio: x.precio, tam: t });
    await new Promise(r => setTimeout(r, 400));
  }
  P.fecha = new Date().toISOString().slice(0, 10);
  if (fallos.length) console.log('Sin precio nuevo (se conserva el anterior): ' + fallos.join(', '));
  console.log(`${cambios} cambios en ${ids.length} productos.`);
  if (seco || (!cambios && !process.argv.includes('--fecha'))) return;
  // Un producto por línea: los cambios semanales quedan legibles en el historial de git.
  const cab = Object.keys(P).filter(k => k !== 'productos').map(k => ' ' + JSON.stringify(k) + ': ' + JSON.stringify(P[k]));
  const prods = ids.map(id => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(P.productos[id]));
  const json = '{\n' + cab.join(',\n') + ',\n "productos": {\n' + prods.join(',\n') + '\n }\n}';
  writeFileSync(RUTA, html.replace(RE_BLOQUE, (_, a, __, c) => a + json + c));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
