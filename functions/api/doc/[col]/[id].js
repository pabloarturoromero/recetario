// Documentos en Cloudflare KV (enlace DATOS), bajo la clave u:<usuario>:<ruta>.
// Existen tres: menu/actual (el plan de la semana), salud/actual (agua, peso, exámenes y ejercicio) y
// ruso/progreso (el avance de la app Ruso para Recepciones, que usa esta misma nube desde su propio sitio).
// Cada escritura trae la versión que el dispositivo leyó; si otro dispositivo guardó antes,
// responde 409 con lo guardado para que el dispositivo se ponga al día en vez de pisarlo.
import { respuesta } from '../../_middleware.js';

const RUTAS = new Set(['menu/actual', 'salud/actual', 'ruso/progreso']);
const MAX_BYTES = 1000000;
// KV guarda copias en cada región hasta 60 s por defecto; 30 s es el mínimo que admite.
const CACHE_KV = 30;

function ruta(params) { return params.col + '/' + params.id; }
function clave(email, r) { return 'u:' + email + ':' + r; }

export async function onRequestGet({ params, env, data }) {
  const r = ruta(params);
  if (!RUTAS.has(r)) return respuesta({ ok: false, error: 'Ruta desconocida.' }, 404);
  const v = await env.DATOS.get(clave(data.usuario, r), { type: 'json', cacheTtl: CACHE_KV });
  if (!v) return respuesta({ exists: false }, 404);
  return respuesta({ exists: true, version: v.version, actualizado: v.actualizado, data: v.data });
}

export async function onRequestPut({ request, params, env, data }) {
  const r = ruta(params);
  if (!RUTAS.has(r)) return respuesta({ ok: false, error: 'Ruta desconocida.' }, 404);
  const txt = await request.text();
  if (new TextEncoder().encode(txt).length > MAX_BYTES) return respuesta({ ok: false, error: 'Documento demasiado grande.' }, 413);
  let cuerpo;
  try { cuerpo = JSON.parse(txt); } catch { return respuesta({ ok: false, error: 'JSON no válido.' }, 400); }
  if (!cuerpo || typeof cuerpo.data !== 'object' || cuerpo.data === null || Array.isArray(cuerpo.data))
    return respuesta({ ok: false, error: 'Falta el documento.' }, 400);
  const k = clave(data.usuario, r);
  const actual = await env.DATOS.get(k, { type: 'json', cacheTtl: CACHE_KV });
  const base = typeof cuerpo.base === 'number' ? cuerpo.base : null;
  const va = actual ? actual.version : 0;
  // Conflicto solo si la nube tiene algo que el dispositivo no ha visto. Si el dispositivo conoce una versión
  // más nueva que la leída aquí (copia de KV aún sin propagar a esta región), se guarda encima de la suya.
  if (actual && (base === null || base < va))
    return respuesta({ ok: false, conflicto: true, version: actual.version, data: actual.data }, 409);
  const nuevo = { version: Math.max(va, base || 0) + 1, actualizado: new Date().toISOString(), data: cuerpo.data };
  await env.DATOS.put(k, JSON.stringify(nuevo));
  return respuesta({ ok: true, version: nuevo.version, actualizado: nuevo.actualizado });
}
