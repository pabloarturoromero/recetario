// Estado de la nube para la app: responde solo si el candado dejó pasar la petición.
import { respuesta } from './_middleware.js';

export function onRequestGet({ data }) {
  return respuesta({ ok: true, email: data.email });
}
