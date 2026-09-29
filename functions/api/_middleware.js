// Candado de la nube: toda ruta /api/* exige la clave personal de sincronización.
// La clave vive como secreto del proyecto en Cloudflare (CLAVE_NUBE, 20 caracteres o más) y el
// dispositivo la envía en Authorization: Bearer <clave>. Se comparan los SHA-256 de ambas en
// tiempo constante. Sin KV o sin clave configurada, la nube responde 503 y la app sigue
// guardando en el dispositivo.

export const MIN_CLAVE = 20;

export function respuesta(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function sha(txt) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
}

export async function verificarClave(request, env) {
  const clave = String(env.CLAVE_NUBE || '').trim();
  if (!env.DATOS || clave.length < MIN_CLAVE) return { status: 503, error: 'La nube no está configurada.' };
  const m = /^Bearer\s+(.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return { status: 401, error: 'Falta la clave.' };
  const [a, b] = await Promise.all([sha(m[1].trim()), sha(clave)]);
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  if (dif !== 0) return { status: 401, error: 'Clave incorrecta.' };
  return { usuario: 'principal' };
}

// La app de ruso (ruso-recepciones.pages.dev y sus vistas previas) guarda su progreso en esta misma
// nube, con la misma clave, desde otro origen: solo a ese origen se le permite CORS. ORIGENES_NUBE
// (lista separada por comas) añade otros, por ejemplo para pruebas locales.
const ORIGEN_RUSO = /^https:\/\/([a-z0-9-]+\.)?ruso-recepciones\.pages\.dev$/;
export function origenPermitido(origen, env) {
  if (!origen) return false;
  if (ORIGEN_RUSO.test(origen)) return true;
  return String(env.ORIGENES_NUBE || '').split(',').map((x) => x.trim()).filter(Boolean).includes(origen);
}
function conCors(res, origen) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', origen);
  r.headers.set('Vary', 'Origin');
  return r;
}

export async function onRequest(context) {
  const { request, env } = context;
  const origen = request.headers.get('Origin');
  const cors = origen && origenPermitido(origen, env) ? origen : null;
  if (request.method === 'OPTIONS') {
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': cors, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, PUT',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' } });
  }
  const v = await verificarClave(request, env);
  let res;
  if (v.error) res = respuesta({ ok: false, error: v.error }, v.status);
  else { context.data.usuario = v.usuario; res = await context.next(); }
  return cors ? conCors(res, cors) : res;
}
