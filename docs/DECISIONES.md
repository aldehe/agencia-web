# DECISIONES · agencia-web

Log cronológico de decisiones técnicas y de negocio. Una decisión por bloque. Sin rehacer historia: si una decisión cambia, se añade una nueva en lugar de editar la antigua.

Formato:
```
## YYYY-MM-DD · Título corto
**Contexto**: por qué surgió la decisión
**Opciones consideradas**: A, B, C
**Elegida**: X
**Motivo**: razón principal
**Consecuencias**: efectos esperados o costes
```

---

## 2026-04-30 · Modelo de servicio en 3 etapas

**Contexto**: hay que monetizar el conocimiento técnico SEO/AEO/GEO sin caer en consultoría hora-paquete.  
**Opciones consideradas**: (a) servicio mensual desde día 1, (b) proyecto único cerrado, (c) embudo en 3 etapas con free→one-time→recurring.  
**Elegida**: opción (c).  
**Motivo**: el lead magnet gratuito convierte mejor a PYMEs sin presupuesto para SEO. La implementación one-time engancha. El recurrente queda para los que vean valor real.  
**Consecuencias**: se necesita el analizador como lead magnet (este proyecto). El recurrente requiere infraestructura de histórico (Tier 3).

---

## 2026-04-30 · Stack: Vercel Edge + cero deps

**Contexto**: hay que decidir runtime y tecnología del backend del analizador.  
**Opciones consideradas**: Node tradicional en Vercel, Edge Runtime, Cloudflare Workers, Netlify Functions.  
**Elegida**: Vercel Edge Runtime + ESM puro + cero dependencias npm.  
**Motivo**: 100k req/mes gratis, deploys instantáneos, sin lock-in pesado, código tan pequeño que es fácil mantener. Las regex puras evitan tener que actualizar libs como cheerio.  
**Consecuencias**: no se pueden usar libs Node (`fs`, `Buffer`, etc.). Hay que parsear HTML con regex. Para Tier 2 (DNS) habrá que ver compatibilidad con Edge.

---

## 2026-05-01 · 8 dimensiones del Citability Score

**Contexto**: hace falta una métrica AEO clara y vendible. No existe API oficial para "qué citan los LLMs".  
**Opciones consideradas**: (a) usar score AEO de un tercero, (b) heurística propia transparente, (c) llamar a un LLM real para evaluar cada página.  
**Elegida**: heurística propia con 8 dimensiones ponderadas (Authorship 18%, Machine-readable 14%, Factuality 14%, Freshness 12%, Structure 12%, Citations 10%, Expertise 10%, Answer-format 10%).  
**Motivo**: transparente (parte del valor de la agencia es explicar qué se mide), gratis, sin dependencias externas, basada en E-E-A-T y patrones observados en LLMs.  
**Consecuencias**: los pesos son discutibles. Hay que comunicar honestamente que es heurística, no medición exacta.

---

## 2026-05-07 · Validador de schemas propio (22 tipos)

**Contexto**: necesitamos validar la calidad de los JSON-LD detectados en cada página.  
**Opciones consideradas**: (a) Google Rich Results Test API (no pública), (b) librería npm de validación de schema.org, (c) validador propio.  
**Elegida**: validador propio cubriendo 22 tipos relevantes (Organization, LocalBusiness, WebSite, Article, BlogPosting, NewsArticle, Product, FAQPage, HowTo, BreadcrumbList, etc.).  
**Motivo**: cero deps, control total, suficiente para diagnóstico. Para producción seria, comunicamos al cliente que complemente con Google Rich Results Test manualmente.  
**Consecuencias**: hay que mantener las reglas alineadas con specs de schema.org. Documentado en `lib/validateSchema.js`.

---

## 2026-05-07 · Sin OAuth/Search Console del cliente en Etapa 1

**Contexto**: ¿pedimos acceso a Search Console / GA del cliente para el diagnóstico gratis?  
**Opciones consideradas**: (a) sí, da más datos, (b) no, fricción innecesaria, (c) opcional con incentivo.  
**Elegida**: NO. Solo URL como input.  
**Motivo**: el lead magnet debe ser sin fricción. Cualquier requisito extra mata conversión. Si el cliente cierra Etapa 2, ahí pedimos accesos.  
**Consecuencias**: el diagnóstico es menos "completo" que si tuviéramos GA, pero es suficiente para mostrar problemas visibles desde fuera.

---

## 2026-05-08 · Frontend tolerante a fallos en lugar de optimizar backend a toda costa

**Contexto**: `/api/analyze` daba 504 intermitente porque Google PageSpeed API tardaba >25s y Vercel Edge corta a los 25s.  
**Opciones consideradas**: (a) cambiar a runtime Node con timeout más largo, (b) cachear PageSpeed agresivamente, (c) hacer el dashboard tolerante a fallos + timeout duro de 10s en backend.  
**Elegida**: opción (c).  
**Motivo**: doble defensa. El dashboard nunca se rompe del todo (Promise.allSettled, banner amarillo, fallback a datos del crawl). El backend no espera más de 10s por PageSpeed. El valor diferencial está en AEO/GEO, no en velocidad — si falta velocidad, el resto sigue siendo vendible.  
**Consecuencias**: usuarios verán "PageSpeed no disponible" cuando Google esté lento. Aceptable. Métrica a vigilar: % de análisis sin datos de velocidad.

---

## 2026-05-08 · Sistema de bitácora con email diario automático

**Contexto**: se necesita continuidad entre sesiones de Claude. Cada chat empezaba en blanco perdiendo contexto técnico y de proceso.  
**Opciones consideradas**: (a) solo skill de Claude, (b) solo bitácora en repo, (c) ambos combinados con email diario, (d) Make.com como orquestador.  
**Elegida**: combo skill + bitácora viva (`docs/BITACORA.md`, `ROADMAP.md`, `DECISIONES.md`) + reportes PDF diarios (`docs/reportes/`) + Edge Function con Vercel Cron que envía PDF por email a las 20:00 vía Resend.  
**Motivo**: skill cubre conocimiento estable (cómo está hecho), bitácora cubre estado cambiante (dónde estamos). Email diario fuerza el ritual de cierre y deja un rastro físico fuera del repo.  
**Consecuencias**: 3 minutos de configuración inicial (cuenta Resend, env var). Cero coste recurrente (free tier cubre con holgura). Disciplina necesaria: actualizar la bitácora al cerrar cada sesión.

---

## 2026-05-08 · Resend en lugar de SendGrid/Brevo

**Contexto**: para enviar el email diario desde Edge Function hace falta API SMTP/email.  
**Opciones consideradas**: Resend, SendGrid, Brevo (ex-Sendinblue), Postmark.  
**Elegida**: Resend.  
**Motivo**: 3.000 emails/mes gratis (más que suficiente), API simple (1 endpoint, JSON, soporta adjuntos base64), pensada para developers, sin sales calls. SendGrid es más enterprise y complicado para este caso.  
**Consecuencias**: depender de Resend. Si quiebra o cambia free tier, migrar a otro requiere ~30 min. Bajo riesgo.

---

## 2026-05-08 · Vercel Cron en lugar de webhook de deploy o Make

**Contexto**: cómo disparar el envío del email diario.  
**Opciones consideradas**: (a) trigger manual via link en chat, (b) webhook de Vercel cada deploy, (c) GitHub Action al detectar PDF nuevo, (d) Vercel Cron en horario fijo, (e) Make.com.  
**Elegida**: Vercel Cron a las 19:00 UTC (= 20:00 hora España).  
**Motivo**: nativo de Vercel (mismo stack), free tier incluye 2 cron jobs, predecible (a esa hora SIEMPRE se intenta), si no hay PDF nuevo simplemente no envía nada. No requiere servicios externos.  
**Consecuencias**: si trabajas a las 22:00, el email del día sale al día siguiente a las 20:00. Aceptable. En verano (UTC+2) llegará a las 21:00 hora España; ajustar el cron si molesta.

---

## 2026-05-12 · Heurística de ranking para "Top 5 Landing Pages"

**Contexto**: el dashboard hoy muestra solo la home a fondo + un agregado del sitio. Falta análisis individual de las páginas más importantes (las que el cliente quiere ver primero). Sin acceso a GA ni Search Console (decisión 2026-05-07), no podemos usar tráfico real.
**Opciones consideradas**: (a) mostrar siempre las N páginas con mayor citability, (b) mostrar siempre las primeras N del sitemap, (c) heurística compuesta con varios factores ponderados, (d) que el usuario elija qué páginas analizar.
**Elegida**: opción (c) — heurística compuesta con 5 factores: tipo de página (pricing/service/product pesan más), profundidad del path (raíz > profundo), inbound internal links (señal de relevancia), word count razonable, citability bonus.
**Motivo**: replica lo que un humano haría al abrir el sitio a ojo. No requiere accesos extra. La opción (d) añade fricción al lead magnet (decisión 2026-05-07). La opción (a) descarta páginas estratégicas con baja citability (que son justo las que hay que arreglar).
**Consecuencias**: el ranking puede equivocarse en sitios atípicos (blogs sin estructura comercial, e-commerce con miles de SKUs). Para esos casos, el cliente ya verá toda la lista de issues agregados del sitio. Pesos en `lib/rankPages.js`, ajustables. Excluye legales/404/login automáticamente.

---

## 2026-05-12 · Mini-dashboards por LP con su propio score, no solo issues

**Contexto**: al exponer las Top 5 LP, ¿qué nivel de detalle mostrar por cada una?
**Opciones consideradas**: (a) solo la URL y un enlace, (b) lista de issues por página, (c) mini-dashboard completo con score SEO + AEO + meta-pills + top 3 issues.
**Elegida**: opción (c).
**Motivo**: el cliente entiende mejor un número que una lista. Dos scores (SEO/AEO) en colores semáforo son leíbles de un vistazo. Top 3 issues por página dan accionabilidad. Cap a 3 evita avalancha visual.
**Consecuencias**: más HTML que renderizar y más cómputo en backend (build de mini-dashboard por LP). Coste despreciable: ya tenemos `parsePage` y `citability` calculados para cada página. Hay que mantener consistencia visual con el resto del dashboard (mismos colores y pills).

---

## 2026-05-12 · Sitemap quality score, no solo "existe"

**Contexto**: hoy el analyzer dice "sitemap.xml: presente, 40 URLs" o "no encontrado". No mide calidad real.
**Opciones consideradas**: (a) dejarlo así, (b) medir solo lastmod, (c) score 0-100 combinando lastmod, priority, changefreq y % de URLs que responden 200.
**Elegida**: opción (c). Peso 40% lastmod + 20% priority + 30% URLs OK + 10% changefreq presente.
**Motivo**: lastmod es lo que más usan los crawlers IA (Google-Extended, GPTBot) para priorizar. priority guía a Google. URLs rotas en sitemap penalizan crawl budget. Un score compuesto comunica mejor que métricas sueltas.
**Consecuencias**: solo aplica cuando el sitemap es legible (no si se generó por crawl desde home). Comprobamos status real solo para URLs que cabe en `maxUrls` (50 por defecto), no para todas las del sitemap si supera el cap. Aceptable: las muestras representativas son suficientes.


---

## 2026-05-12 · Stack detection por regex en HTML inicial, no headless browser

**Contexto**: para detectar qué herramientas (CRM, Analytics, Ads, chatbots) tiene un sitio, hay dos enfoques: parsear el HTML inicial con regex o ejecutar un navegador headless tipo Puppeteer/Playwright.
**Opciones consideradas**: (a) regex sobre HTML inicial, (b) headless browser que ejecuta JS y captura todas las requests, (c) servicio externo tipo BuiltWith/Wappalyzer API.
**Elegida**: opción (a) — regex sobre HTML inicial.
**Motivo**: (b) requiere runtime Node (no Edge), añade 5-10s por análisis, multiplica costes y rompe la convención técnica del proyecto. (c) es pago, mete dependencia externa y latencia. (a) cubre el 90% de los casos porque las huellas más usadas (HubSpot, GA4, GTM, Meta Pixel, Intercom, etc.) cargan desde HTML inicial. Lo que se inyecta dinámicamente es raro y minoritario.
**Consecuencias**: aceptamos no detectar tags inyectados por GTM containers (no vemos qué hay dentro de GTM). Lo comunicamos en el dashboard: "Tienes GTM, no sabemos qué tags carga, lo revisamos en la llamada". Falso negativo: cero falso positivo en pruebas (sitio con palabra "HubSpot" en blog pero sin script real → no detectado). Si en producción aparecen falsos positivos frecuentes, se ajustan las regex.

---

## 2026-05-12 · Score de "madurez digital" 0-100 sobre stack

**Contexto**: ¿cómo comunicar de un vistazo si un sitio tiene "stack completo" o "stack pobre"?
**Opciones consideradas**: (a) mostrar solo la lista de detecciones sin score, (b) score binario "completo / incompleto", (c) score 0-100 ponderado por categoría.
**Elegida**: opción (c) — score 0-100 con 5 categorías de 20 puntos cada una con ajustes (GA4 vale 15, GTM extra 5, UA legacy penaliza, etc.).
**Motivo**: un número en el badge del tab comunica al instante. Combinar el score con la idea de "los 6 servicios de la agencia" abre la conversación natural: "Tu madurez digital está en 35/100, tenemos margen para mejorar 5 áreas".
**Consecuencias**: el cálculo del score puede sentirse arbitrario al cliente; explicamos en el panel cómo se compone. Si discutible, ajustar pesos en `computeMaturityScore` de `detectStack.js`.

---

## 2026-05-12 · Recomendaciones derivadas como gancho de venta integrado

**Contexto**: ¿el panel Stack solo informa de qué hay, o también recomienda qué falta?
**Opciones consideradas**: (a) solo informar, (b) recomendar también explícitamente con CTA por área.
**Elegida**: opción (b) — al detectar gaps, generar `recommendations[]` con `area`, `severity`, `title`, `detail`. Cada recomendación mapea a una solución vendible de la agencia (CRM & RevOps, Analytics & BI, IA & Automatización, etc.).
**Motivo**: lead magnet integral. Si el cliente no tiene CRM y no se lo dices, no abrirás esa conversación. El analizador deja de ser solo SEO/AEO/GEO para convertirse en diagnóstico de las 6 soluciones.
**Consecuencias**: cuidado con sonar a "vende-humo" (instrucción explícita del usuario). Cada recomendación dice qué falta y por qué importa con un dato concreto, sin promesas vagas. La oferta sigue saliendo solo en el CTA final, no en cada panel.

