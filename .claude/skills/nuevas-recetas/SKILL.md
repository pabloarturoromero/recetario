---
name: nuevas-recetas
description: Crear recetas nuevas para Amor de Mamá (el recetario de index.html) y publicarlas directamente en https://recetario-intercambiable.pages.dev. Usar siempre que el usuario pida más recetas, recetas nuevas, otra receta de una cocina, más desayunos, almuerzos, cenas o guarniciones, o ampliar el recetario, aunque no nombre la skill. También al cambiar ingredientes de recetas existentes por otros más comunes.
---

# Nuevas recetas para Amor de Mamá

El usuario pidió que las recetas nuevas se publiquen directamente, sin pedir confirmación antes: se escriben, se validan y se suben a `main` siguiendo el flujo de CLAUDE.md. Al terminar se le informa la versión publicada.

## Parámetros de contenido (decididos por el usuario)

**Legumbres**
- La legumbre va solo donde el plato original la lleva. No se añade para subir la fibra.
- Garbanzo, lenteja y frejol: como máximo 2 veces cada uno por semana (`meta.reglas_de_armado.legumbre_por_semana`). Hay demasiado garbanzo: evitarlo en recetas nuevas salvo que sea el corazón del plato.
- Nunca: arveja tierna, haba tierna, arveja partida, chocho ni edamame (no le gustan).
- El tofu sí le gusta, sobre todo donde es propio del plato (cocina china, japonesa, coreana, del sudeste asiático).
- Si una receta nueva lleva garbanzo, lenteja o frejol en una forma nueva, añadirla a `meta.tipos_legumbre`.

**Fibra y proteína sin legumbre**
- La fibra sale del cereal integral propio de la cocina del plato y de 150 a 300 g de verdura:
  - India: chapati de harina integral (`Harina integral para chapati`, 45 a 65 g), arroz integral.
  - Grecia, Turquía, Levante: bulgur (pligouri, bulgur pilavı), pan integral, pasta integral corta.
  - Japón y Corea: arroz integral con cebada (mugi gohan, boribap) con `Arroz de cebada seco`.
  - Magreb: belboula (cebada) o bulgur. Etiopía: cebada o pan integral.
  - China, Filipinas, Tailandia, Indonesia: arroz integral y verduras salteadas; nada ajeno a esas cocinas.
  - Italia: pasta integral y pan integral. América Latina: choclo, camote, yuca, plátano verde, arroz integral.
- Proteína: más carne, pescado o huevo, o tofu. Rangos: 35 a 46 g por comida principal.

**Ingredientes: siempre el equivalente más común en Guayaquil**
- Escribir en la receta directamente el ingrediente común, no el exótico con un sustituto aparte:
  - col rizada, kale, cavolo nero, col de hoja → `Repollo en tiras` (col) o acelga;
  - okra → vainita; frejol largo o vainita china → vainita;
  - eneldo → perejil; hojas de curry, pandan, kaffir → se omiten;
  - pera asiática → pera común; bok choy o pak choi → acelga o repollo; galanga → jengibre.
- Verduras de uso normal: tomate, cebolla, pimiento, zanahoria, zucchini, berenjena, espinaca, acelga, vainita, zapallo, brócoli, coliflor, repollo, camote, yuca, plátano verde, choclo, champiñón.
- Pan pita integral y tortilla de maíz integral: poco, solo donde el plato lo exige (hoy hay 2 recetas con pita y 3 con tortilla).
- Papa: está bien de vez en cuando, no como base habitual.
- Cero alcohol (tampoco para cocinar), cero azúcar y miel, pan y pasta siempre integrales.

**Rangos por porción** (receta para 1 persona)
- Desayuno 600 a 700 kcal; almuerzo 630 a 760; cena 560 a 660; guarnición hasta 200.
- Proteína 35 a 46 g en desayuno, almuerzo y cena. La fibra de cada plato debe acercarse a la media de su categoría (desayuno 11, almuerzo 12, cena 12 a 13 g).

## Esquema de cada receta

Copiar la forma de una receta existente de la misma categoría. Campos: `id` (siguiente libre: D, L, C o G), `categoria`, `nombre`, `cocina`, `descripcion`, `tiempo_min`, `macros` (`proteina_g`, `fibra_g`, `kcal_aprox`), `apto_ventana_contencion`, `aporta_omega3_marino`, `requiere` (las preparaciones base P1 a P8 cuyo nombre termina el ítem, por ejemplo `Arroz integral cocido P2`), `ingredientes` (con `vol_ml` y `volumen` calculados desde `meta.tabla_densidades`; carnes y pescados sin volumen), `pasos`, `sustitutos_locales`, `video_directo` o `null`, `video_confianza`, `video_busqueda`. Las cenas llevan `version_aligerada`. Las esperas largas van en `tiempo_espera`.

- Cada ingrediente nuevo necesita su forma en `compras_catalogo.formas` y, si es un producto nuevo, su entrada en `compras_catalogo.productos` con sección.
- Las kcal y los gramos se estiman con tabla de composición. Valores de referencia por 100 g: pechuga 110 kcal y 23 g de proteína; res magra 130 a 160 kcal y 23 g; cerdo 140 kcal y 23 g; corvina, dorado o picudo 95 kcal y 21 g; huevo, por unidad, 72 kcal y 6 g; tofu firme 144 kcal, 15 g de proteína y 2 g de fibra; bulgur seco 342 kcal, 12 g y 12,5 g; arroz de cebada seco 352 kcal, 10 g y 12 g; harina integral 340 kcal, 13 g y 11 g; pan integral 250 kcal, 12 g y 6,5 g; arroz integral cocido 123 kcal, 3 g y 1,6 g; espinaca 23 kcal y 2,2 g de fibra; brócoli 34 kcal y 2,6 g; vainita 31 kcal y 2,7 g; berenjena 25 kcal y 3 g; repollo 25 kcal y 2,5 g; acelga 19 kcal y 1,6 g.
- No reutilizar ni renombrar ids existentes: se comparten por WhatsApp como `#receta/ID`.

## Publicación directa (flujo de CLAUDE.md)

1. `git fetch origin main && git checkout main && git reset --hard origin/main`. Si hay trabajo sin fusionar en otra rama que el usuario ya aprobó, fusionarlo antes.
2. Añadir las recetas al bloque JSON `datos` de `index.html` (editar con un script de Python que cargue el JSON, lo modifique y lo vuelva a escribir con `json.dumps(..., ensure_ascii=False, indent=2)`, que conserva el formato del archivo).
3. Subir `meta.version` (menor: 2.12.0 → 2.13.0) y `meta.fecha`.
4. Validar:
   - JSON válido e ids únicos; macros dentro de los rangos;
   - `node --test tests/motor.test.mjs tests/ui.test.mjs tests/galeria.test.mjs tests/cocinera.test.mjs tests/salud.test.mjs tests/nube.test.mjs tests/chat.test.mjs`;
   - Playwright (global: `require(execSync('npm root -g').toString().trim() + '/playwright')`): la página carga sin errores de página, `#sub` muestra el total nuevo de recetas, la lista de compras se genera (botón `[data-goto="compras"]`) y la receta nueva abre en `#receta/ID`.
5. Commit en `main` con mensaje en español (`vX.Y.Z: ...`) y `git push origin main`. Si el push falla por red, reintentar con espera creciente.
6. Si existe el artifact del recetario (https://claude.ai/artifact/LRsQg1oJpf6PTJMVcASPGr), republicarlo con el mismo `index.html`.
7. Responder con la versión publicada, la lista de recetas nuevas (id, nombre, cocina, proteína, fibra y kcal) y el recordatorio de verificar https://recetario-intercambiable.pages.dev en el teléfono.
