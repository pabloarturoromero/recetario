// Documentos en Cloudflare KV (enlace DATOS), bajo la clave u:<usuario>:<ruta>.
// Solo existen dos: menu/actual (el plan de la semana) y salud/actual (agua, peso y exámenes).
// Cada escritura trae la versión que el dispositivo leyó; si otro dispositivo guardó antes,
// responde 409 con lo guardado para que el dispositivo se ponga al día en vez de pisarlo.
import { respuesta } from '../../_middleware.js';

const RUTAS = new Set(['menu/actual', 'salud/actual']);
const MAX_BYTES = 1000000;

function ruta(params) { return params.col + '/' + params.id; }
function clave(email, r) { return 'u:' + email + ':' + r; }

export async function onRequestGet({ params, env, data }) {
  const r = ruta(params);
  if (!RUTAS.has(r)) return respuesta({ ok: false, error: 'Ruta desconocida.' }, 404);
  const v = await env.DATOS.get(clave(data.usuario, r), 'json');
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
  const actual = await env.DATOS.get(k, 'json');
  const base = cuerpo.base === undefined ? null : cuerpo.base;
  if (actual && actual.version !== base)
    return respuesta({ ok: false, conflicto: true, version: actual.version, data: actual.data }, 409);
  const nuevo = { version: (actual ? actual.version : 0) + 1, actualizado: new Date().toISOString(), data: cuerpo.data };
  await env.DATOS.put(k, JSON.stringify(nuevo));
  return respuesta({ ok: true, version: nuevo.version, actualizado: nuevo.actualizado });
}
