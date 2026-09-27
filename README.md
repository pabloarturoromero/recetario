# Recetario Intercambiable

Plan nutricional de cuatro semanas con 100 recetas intercambiables de 48 cocinas, organizadas en desayunos, almuerzos, cenas y guarniciones. Incluye armado de la semana con validación de proteína, fibra, energía y pescado marino, lista de compras generada automáticamente y preparaciones base.

Toda la aplicación vive en un solo archivo, `index.html`, sin dependencias ni paso de compilación.

## Publicación

Sitio público: https://recetario-intercambiable.pages.dev

Para publicar una nueva versión desde una copia local del repositorio:

```
npx wrangler pages deploy . --project-name=recetario-intercambiable
```

Si el proyecto de Cloudflare Pages se conecta a este repositorio (Workers & Pages, proyecto `recetario-intercambiable`, Settings, Builds, Connect to Git), cada cambio en `main` se publica solo. En ese caso no hace falta comando de compilación y el directorio de salida es la raíz.

## Datos

Las recetas están en el bloque `<script type="application/json" id="datos">` de `index.html`. Las cantidades son por porción y las kcal son estimación de tabla de composición, con margen de más menos 10 por ciento.

Fuera de Claude, el plan semanal y las marcas de compras se guardan solo en el navegador de cada persona.
