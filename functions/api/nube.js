// Estado de la nube para la app: responde solo si la clave es correcta.
import { respuesta } from './_middleware.js';

export function onRequestGet() {
  return respuesta({ ok: true });
}
