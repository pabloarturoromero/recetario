# Amor de Mamá (antes Recetario Intercambiable): procedimiento de cambios

Toda la aplicación es un solo archivo, `index.html`. Las recetas y reglas viven en el bloque JSON `<script type="application/json" id="datos">`; la lógica, en el `<script>` que sigue.

## Publicación automática

Cloudflare Pages (proyecto `recetario-intercambiable`) está conectado a este repositorio. Cada push a la rama `main` publica en https://recetario-intercambiable.pages.dev en uno o dos minutos. No se usa Wrangler ni pasos manuales.

## Flujo obligatorio para cada cambio

1. Partir de `main` actualizado: `git fetch origin main && git checkout main && git reset --hard origin/main`.
2. Editar `index.html`. Para recetas nuevas, seguir el esquema de las existentes (id único por categoría: D, L, C, G), con `macros`, `apto_ventana_contencion`, `aporta_omega3_marino`, `requiere`, `ingredientes` con `vol_ml` y `volumen`, `pasos`, `sustitutos_locales` y `video_busqueda`. Las cenas llevan `version_aligerada`.
3. Respetar los preceptos del plan: legumbre en cada plato principal, pan y pasta integrales, cero alcohol, cero azúcar y miel, ingredientes disponibles en Guayaquil. Rangos por porción: desayuno 600 a 700 kcal, almuerzo 630 a 760, cena 560 a 660, guarnición hasta 200; proteína 35 a 46 g por comida principal.
4. Subir `meta.version` y `meta.fecha`.
5. Validar antes de subir:
   - que el JSON de `datos` sea válido y los id no se repitan;
   - que pasen las pruebas: `node --test tests/motor.test.mjs tests/ui.test.mjs tests/galeria.test.mjs tests/cocinera.test.mjs tests/salud.test.mjs` (cubren catálogo de compras, preparaciones, alertas, dulce, búsqueda, persistencia, anchos móviles, la cocinera y la sección Salud);
   - si se añade una receta con un ingrediente nuevo, asignar su forma en `compras_catalogo.formas` (la prueba de catálogo falla si falta);
   - abrir la página en un navegador (Playwright) y comprobar que carga sin errores, que la cabecera muestra el total correcto de recetas y que la lista de compras se genera.
6. Commit en `main` con mensaje descriptivo en español y push: `git push origin main`.
7. Si existe el artifact de Claude del recetario (https://claude.ai/artifact/LRsQg1oJpf6PTJMVcASPGr), republicarlo con el mismo `index.html` para que ambas versiones coincidan.
8. Informar al usuario la versión publicada y recordarle verificar https://recetario-intercambiable.pages.dev en el teléfono.

## Ramas

- `main`: producción. Todo lo que entra aquí se publica.
- Otras ramas generan vistas previas en `https://<rama>.recetario-intercambiable.pages.dev`. Se usan para probar cambios grandes (por ejemplo, rediseños) antes de fusionarlos en `main`.

## Datos del usuario

Fuera de Claude, el plan semanal y las compras se guardan en el `localStorage` del navegador de cada persona. No cambiar la clave `recetario.menu` ni la estructura de `S.semana` sin migrar los datos existentes. El estado guardado lleva `v: 3`; la función `migrarEstado` del motor convierte las versiones anteriores y conserva las marcas antiguas en `comprasLegado`.

Los enlaces directos a recetas usan `#receta/ID` (por ejemplo `#receta/L64`) y se comparten por WhatsApp. No renombrar ids de recetas existentes: romperían los enlaces ya enviados.

La sección Salud (agua del día, peso y medidas, exámenes de laboratorio) vive en su propio motor, `<script id="salud">`, y se guarda aparte en la clave `recetario.salud` (`v: 1`); en el artifact se sincroniza en el documento `salud/actual`. La meta de agua se lee de `meta.reglas_de_armado.liquido_dia`: no escribirla a mano en el código. Las seis ilustraciones del medidor son `img/agua-1.webp` a `img/agua-6.webp` (cinco tramos iguales hasta el mínimo y la sexta desde el mínimo). El enlace directo es `#salud`. Los rangos de laboratorio son orientativos y la app no diagnostica.

El nombre visible de la app es «Amor de Mamá», con el logo en `img/logo.webp` y `img/logo-128.webp` (el favicon y el apple-touch-icon salen del mismo logo). Las claves `recetario.*`, los ids de recetas, el proyecto de Cloudflare y la URL `recetario-intercambiable.pages.dev` conservan su nombre anterior a propósito: cambiarlos rompería datos guardados y enlaces compartidos.

La interfaz es la de Savora (tokens de color rojos, Poppins, barra inferior en móvil). Los cambios de aspecto deben conservarla salvo que el usuario pida otra cosa.
