// Punto de entrada para iniciar sesión: Access pide el correo antes de llegar aquí;
// después se vuelve a la app, en la sección Salud.
export function onRequestGet({ request }) {
  return Response.redirect(new URL('/#salud', request.url).toString(), 302);
}
