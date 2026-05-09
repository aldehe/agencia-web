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
