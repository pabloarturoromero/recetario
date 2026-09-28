// Candado de la nube: toda ruta /api/* exige una sesión válida de Cloudflare Access.
// Access pone en cada petición el encabezado Cf-Access-Jwt-Assertion, un JWT firmado (RS256)
// con las claves públicas del equipo. Aquí se verifica la firma, la audiencia, el emisor y el
// vencimiento, y el correo queda en context.data.email para que cada persona lea solo lo suyo.
// Sin configuración (KV, dominio del equipo y audiencia), la nube responde 503 y la app
// sigue funcionando con el guardado del dispositivo.

const certs = { equipo: '', claves: [], hasta: 0 };

function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const texto = (u8) => new TextDecoder().decode(u8);

async function clavesDe(equipo, forzar) {
  if (!forzar && certs.equipo === equipo && certs.hasta > Date.now()) return certs.claves;
  const r = await fetch(`https://${equipo}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  const j = await r.json();
  certs.equipo = equipo; certs.claves = j.keys || []; certs.hasta = Date.now() + 10 * 60 * 1000;
  return certs.claves;
}

export function respuesta(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function verificarAcceso(request, env, ahora = Date.now()) {
  const equipo = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = String(env.ACCESS_AUD || '').trim();
  if (!equipo || !aud || !env.DATOS) return { status: 503, error: 'La nube no está configurada.' };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { status: 401, error: 'Hace falta iniciar sesión.' };
  const p = token.split('.');
  if (p.length !== 3) return { status: 401, error: 'Sesión no válida.' };
  let cab, carga;
  try { cab = JSON.parse(texto(b64url(p[0]))); carga = JSON.parse(texto(b64url(p[1]))); }
  catch { return { status: 401, error: 'Sesión no válida.' }; }
  if (cab.alg !== 'RS256') return { status: 401, error: 'Sesión no válida.' };
  let claves = await clavesDe(equipo, false);
  let jwk = claves.find((k) => k.kid === cab.kid);
  if (!jwk) { claves = await clavesDe(equipo, true); jwk = claves.find((k) => k.kid === cab.kid); }
  if (!jwk) return { status: 401, error: 'Sesión no válida.' };
  const clave = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', clave, b64url(p[2]), new TextEncoder().encode(p[0] + '.' + p[1]));
  if (!ok) return { status: 401, error: 'Sesión no válida.' };
  const auds = Array.isArray(carga.aud) ? carga.aud : [carga.aud];
  const seg = Math.floor(ahora / 1000);
  if (!auds.includes(aud) || carga.iss !== `https://${equipo}` || !(carga.exp > seg) || (carga.nbf && carga.nbf > seg + 60))
    return { status: 401, error: 'Sesión vencida o de otra aplicación.' };
  const email = String(carga.email || '').trim().toLowerCase();
  if (!email) return { status: 401, error: 'La sesión no trae un correo.' };
  const permitidos = String(env.CORREOS_PERMITIDOS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (permitidos.length && !permitidos.includes(email)) return { status: 403, error: 'Este correo no tiene acceso.' };
  return { email };
}

export async function onRequest(context) {
  let v;
  try { v = await verificarAcceso(context.request, context.env); }
  catch { v = { status: 502, error: 'No se pudo verificar la sesión.' }; }
  if (v.error) return respuesta({ ok: false, error: v.error }, v.status);
  context.data.email = v.email;
  return context.next();
}
