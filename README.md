# Amor de Mamá

Antes «Recetario Intercambiable».

Plan nutricional de cuatro semanas con 100 recetas intercambiables de 48 cocinas, con fotografía de referencia en las 100, organizadas en desayunos, almuerzos, cenas y guarniciones. Incluye armado de la semana con validación de proteína, fibra, energía y pescado marino, lista de compras generada automáticamente, preparaciones base y una sección Salud con el medidor de agua del día (meta de las reglas del plan, 2,5 a 3 L), el registro de peso y medidas y los exámenes de laboratorio.

Toda la aplicación vive en un solo archivo, `index.html`, sin dependencias ni paso de compilación. La interfaz sigue el diseño Savora: navegación inferior en el móvil, carrusel del menú de hoy y una galería de recetas con fotos, ficha compartible por WhatsApp y enlace directo por receta (`#receta/L64`).

## Publicación

Sitio público: https://recetario-intercambiable.pages.dev

Para publicar una nueva versión desde una copia local del repositorio:

```
npx wrangler pages deploy . --project-name=recetario-intercambiable
```

Si el proyecto de Cloudflare Pages se conecta a este repositorio (Workers & Pages, proyecto `recetario-intercambiable`, Settings, Builds, Connect to Git), cada cambio en `main` se publica solo. En ese caso no hace falta comando de compilación y el directorio de salida es la raíz.

## Datos

Las recetas están en el bloque `<script type="application/json" id="datos">` de `index.html`. Las cantidades son por porción y las kcal son estimación de tabla de composición, con margen de más menos 10 por ciento.

Fuera de Claude, el plan semanal, las marcas de compras y las preparaciones listas se guardan solo en el navegador de cada persona (clave `recetario.menu`), y los datos de Salud en la clave aparte `recetario.salud`, con exportación e importación en JSON como respaldo; la cabecera lo indica como «Guardado en este dispositivo». Dentro del artifact de Claude se sincronizan con su base, y la cabecera muestra el estado real: pendiente, sincronizando, sincronizado o error.

La lista de compras y las preparaciones salen del mismo cálculo. El bloque `compras_catalogo` asigna cada forma de ingrediente a un producto de compra, y el campo `modelo` de cada preparación base define su rendimiento o su lote.

## Pruebas

Sin dependencias propias. El motor de cálculo (`<script id="motor">` en `index.html`) se prueba con Node 20 o superior; la interfaz, con Playwright si está instalado (local o global):

```
node --test tests/motor.test.mjs tests/ui.test.mjs tests/galeria.test.mjs
```

`galeria.test.mjs` cubre la galería de recetas, los filtros, las fichas, los enlaces directos `#receta/ID`, el mensaje de WhatsApp (sin enviarlo), «Añadir al menú», el intercambio con vista previa, «Deshacer» y los anchos de 375 y 390 px.

Si Playwright no está disponible, las pruebas de interfaz se omiten y lo indican.

## Nube propia (Cloudflare)

Fuera de Claude, la app puede guardar el menú, las compras y Salud en una nube propia, para verlos igual en el teléfono y en el computador. Son funciones de Cloudflare Pages (`functions/api/`) que guardan en Cloudflare KV un documento por persona, identificada por su correo; un candado de Cloudflare Access protege solo `/api/*`, así que la app y los enlaces de recetas compartidos siguen abiertos para todos. Mientras no se configure, la API responde 503 y la app sigue guardando en el dispositivo.

Configuración, una sola vez, en el panel de Cloudflare:

1. **Almacén.** Storage & Databases › KV › Create: nombre `amor-de-mama-datos`.
2. **Enlace.** Workers & Pages › `recetario-intercambiable` › Settings › Bindings › Add › KV namespace: nombre de variable `DATOS`, espacio `amor-de-mama-datos` (en Production).
3. **Candado.** En el mismo proyecto, Settings › General › Access policy › Enable. Luego Manage (abre Zero Trust) y edita la aplicación creada: en Public hostname borra el `*` del subdominio, para que quede `recetario-intercambiable.pages.dev`, y escribe `api` en Path. En Policies deja una regla Allow con Include › Emails › el correo autorizado. En Login methods, One-time PIN. Session duration: 1 month. Guarda.
4. **Datos del candado.** De esa aplicación copia el Application Audience (AUD) Tag (Configure › Additional settings). El dominio del equipo tiene la forma `<equipo>.cloudflareaccess.com` (Zero Trust › Settings, o la dirección de la página de inicio de sesión de Access).
5. **Variables.** Workers & Pages › `recetario-intercambiable` › Settings › Variables and Secrets › Add, en Production: `ACCESS_TEAM_DOMAIN` = `<equipo>.cloudflareaccess.com`, `ACCESS_AUD` = el AUD copiado, `CORREOS_PERMITIDOS` = el correo autorizado (varios, separados por comas).
6. **Redesplegar.** Deployments › el último despliegue › Retry deployment (los enlaces y variables se aplican en el siguiente despliegue).

Luego, en la app, Salud › Tus datos en la nube › Conectar mi nube: Access pide el correo y envía un código. Lo que ya estaba en ese dispositivo se sube la primera vez; en los demás dispositivos se carga desde la nube. Si dos dispositivos guardan a la vez, el segundo recibe lo del primero en vez de pisarlo y lo avisa.

