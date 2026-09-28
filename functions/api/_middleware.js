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

export async function onRequest(context) {
  const v = await verificarClave(context.request, context.env);
  if (v.error) return respuesta({ ok: false, error: v.error }, v.status);
  context.data.usuario = v.usuario;
  return context.next();
}
