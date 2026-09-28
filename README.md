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
