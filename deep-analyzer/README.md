# Deep Analyzer

Análisis profundo de un sitio web entero. Para uso **interno** cuando contratamos un cliente — NO se despliega en Vercel, NO está en la web pública.

## Qué hace

1. Lee el sitemap del sitio (incluye sitemap index anidados)
2. Para cada URL (hasta 100 por defecto):
   - Descarga el HTML
   - Lo procesa con `lib/parsePage.js` (title, meta, headings, canonical, schema)
   - Valora citabilidad LLM con `lib/citabilityScore.js`
   - Llama a PageSpeed Insights mobile + desktop
3. Genera:
   - `reports/dominio_YYYY-MM-DD_HH-mm.html` — informe visual
   - `reports/dominio_YYYY-MM-DD_HH-mm.json` — datos crudos
4. Para PDF: abre el HTML en navegador → `Ctrl+P` → Guardar como PDF.

## Setup (una sola vez)

Requisitos:
- Node.js 18+ (incluye `fetch` nativo, sin dependencias extra)
- API key de PageSpeed Insights (la misma que ya usas en Vercel)

Ubicación: la carpeta `deep-analyzer/` vive **dentro del repo** `agencia-web/`, pero está en `.vercelignore` para que NO se despliegue.

## Uso desde CMD (Windows)

### Análisis básico

```cmd
cd C:\Users\sandr\Desktop\agencia-web\deep-analyzer
set PAGESPEED_API_KEY=tu_clave_aqui
node deep-analyze.js https://celes.ai
```

### Con límite custom

```cmd
node deep-analyze.js https://celes.ai --max=50
```

### Sin PageSpeed (más rápido, solo análisis interno de HTML/schema/AEO)

```cmd
node deep-analyze.js https://celes.ai --no-pagespeed
```

### Hacer la API key persistente

Para no escribirla cada vez, añádela a las variables de entorno de Windows:

```cmd
setx PAGESPEED_API_KEY "tu_clave_aqui"
```

Luego abre una **nueva** ventana de CMD (las viejas no la verán).

## Tiempos esperados

- **10 páginas con PageSpeed**: ~2 min
- **50 páginas con PageSpeed**: ~10 min
- **100 páginas con PageSpeed**: ~20-25 min
- **100 páginas SIN PageSpeed**: ~2-3 min

La concurrencia está fijada a 5 dentro del script. Es el balance que respeta el rate limit de PageSpeed (400 queries / 100s) sin romperse.

## Salida HTML

El informe tiene 6 bloques:

1. **Resumen ejecutivo**: 4 KPIs principales (AEO Citability media, PS Mobile, PS Desktop, SEO)
2. **Distribución AEO**: cuántas páginas en excelente/bueno/aceptable/pobre
3. **Issues**: páginas con problemas técnicos (sin title, sin H1, schema, etc.)
4. **Schema markup**: tipos JSON-LD encontrados
5. **Tabla por página**: ordenada por AEO ascendente (peores arriba, para detectar problemas)
6. **Errores**: páginas que fallaron al cargar

## Problemas frecuentes

**"Falta URL"** → Olvidaste pasar la URL como argumento.

**"PAGESPEED_API_KEY no definida"** → `set PAGESPEED_API_KEY=...` o usa `--no-pagespeed`.

**El sitemap no se encuentra** → El script prueba `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml` y `robots.txt`. Si el sitio no tiene ninguno, solo analiza la home. Para forzar un sitemap específico, edita la línea `sitemapUrls` en el script.

**PageSpeed devuelve errores 429** → Has hecho demasiadas queries seguidas. El script ya respeta concurrencia pero si lo lanzas dos veces en pocos minutos puede pasar. Espera 2 min y reintenta.

**Timeout en fetch** → Algunos sitios tardan demasiado o bloquean al bot. El script salta la página con error y sigue. Verás el error en la sección "Páginas con errores" del informe.

## Mantenimiento

Cuando se mejore alguna lib en el repo padre (`../parsePage.js`, `../validateSchema.js`, `../citabilityScore.js`), el deep-analyzer hereda las mejoras automáticamente. **No duplicar código aquí**.

## Privacidad

La carpeta `reports/` está en `.gitignore`. **Nunca subas informes de clientes al repo público**. Si necesitas compartir uno, hazlo por canal directo (Drive, email, etc.).
