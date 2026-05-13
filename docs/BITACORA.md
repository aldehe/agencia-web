# BITÁCORA · agencia-web

Bitácora viva del proyecto. Última actualización: **2026-05-12**.

> 📖 **Cómo usar este archivo**: leer al inicio de cada sesión para retomar contexto. Actualizar al final con un resumen breve de la sesión. El detalle completo de cada jornada está en `docs/reportes/YYYY-MM-DD-jornada.pdf`.

---

## 📍 Estado actual

**Etapa**: MVP del analizador desplegado y estable. Profundización en curso (sesiones #6+#7 hechas, #8 pendiente).

**Producción**: https://agencia-web-pi.vercel.app
**Analizador**: https://agencia-web-pi.vercel.app/analyzer
**Repo local**: `C:\Users\sandr\Desktop\agencia-web`

**Último cambio** — Sesiones #6 y #7 combinadas:
- **#6** identificó las Top 5 Landing Pages del sitio (ranking heurístico), generó mini-dashboards por LP con SEO/AEO scores y top 3 issues, midió calidad real del sitemap.xml y detectó thin content y H1 duplicados.
- **#7** añadió detección de stack digital: CRM (HubSpot, Pipedrive, Salesforce, Zoho...), Analytics (GA4, GTM, UA legacy, Hotjar, Clarity, Mixpanel, Amplitude...), Ads (Meta Pixel, Google Ads, LinkedIn, TikTok, Bing UET, Pinterest, X/Twitter, Reddit), Chat (Intercom, Drift, HubSpot Chat, Tidio, Tawk, Crisp, Zendesk, LiveChat, Olark, Freshchat), Política bots-IA en robots.txt (14 bots catalogados: GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Bytespider, Applebot-Extended, etc.). Score de madurez digital 0-100. Recomendaciones automáticas por categoría como gancho de venta.

**Bloques nuevos en el JSON**:
- `/api/crawl`: `top_landing_pages[]`, `sitemap_quality`
- `/api/analyze`: `stack_detected` con `crm`, `analytics`, `ads`, `chat`, `ai_bots_policy`, `maturity_score`, `recommendations`

**Bloqueos / dependencias externas**: ninguno. Sesión #8 requerirá `ANTHROPIC_API_KEY` en Vercel.

---

## 🎯 Próxima sesión

**Sesión #8 — Prueba LLM real + refundir frontend final**:
1. Crear `api/llm-check.js` (Edge) que llama a Claude API con prompt fijo: "¿Conoces la empresa X? Si la conoces, descríbela en 3 frases. Si no, dilo." Coste estimado: 0,0005€/análisis.
2. Mostrar respuesta literal del LLM en panel nuevo "Visibilidad IA real".
3. Rate limit por IP (cookie + KV de Vercel) para evitar abuso.
4. Refundir sección final del dashboard con "Plan de acción agrupado por solución de agencia" (SEO, RevOps, Analytics, IA, Ads, Transformación).
5. Pulir CTA final con email + WhatsApp.

**Pendiente del usuario antes de #8**: confirmar `ANTHROPIC_API_KEY` en Vercel env vars.

---

## 🗓 Histórico de sesiones

| Fecha | Sesión | Foco | PDF |
|---|---|---|---|
| 2026-04-30 | #1 | Arquitectura inicial, filtrado PageSpeed, primer endpoint analyze | (retroactivo, sin PDF) |
| 2026-05-01 | #2 | Crawler de sitio, validador de schemas, AEO Citability Score | (retroactivo) |
| 2026-05-02 | #3 | Generador llms.txt, integración Capa 1, dashboard inicial | (retroactivo) |
| 2026-05-07 | #4 | Despliegue, debug bug crítico de scores, validación celes.ai | (retroactivo) |
| 2026-05-08 | #5 | Tolerancia a fallos, optimización analyze, sistema bitácora, skill | [PDF](reportes/2026-05-08-jornada.pdf) |
| 2026-05-12 | #6 | Top 5 LPs, sitemap quality, thin content, H1 duplicados | (cierre pendiente) |
| 2026-05-12 | #7 | Stack detection (CRM, Analytics, Ads, Chat, bots-IA) + madurez digital | (cierre pendiente) |

---

## 📂 Estructura del proyecto

```
agencia-web/
├── index.html                       Landing pública
├── analyzer/
│   └── index.html                   Dashboard con tabs Top LP + Stack
├── api/
│   ├── analyze.js                   Edge: PageSpeed + HTML + robots/sitemap/llms.txt + stack_detected
│   ├── crawl.js                     Edge: crawler + top_landing_pages + sitemap_quality
│   └── notify-report.js             Edge: cron diario que envía PDF por email
├── lib/
│   ├── filterPagespeed.js
│   ├── parsePage.js
│   ├── crawler.js                   ← actualizado sesión #6
│   ├── rankPages.js                 ← NUEVO sesión #6
│   ├── stackSignatures.js           ← NUEVO sesión #7 (diccionario de huellas)
│   ├── detectStack.js               ← NUEVO sesión #7
│   ├── citabilityScore.js
│   ├── validateSchema.js
│   └── generateLlmsTxt.js
├── docs/
│   ├── BITACORA.md                  ← este archivo
│   ├── ROADMAP.md
│   ├── DECISIONES.md
│   └── reportes/
│       └── YYYY-MM-DD-jornada.pdf
├── llms.txt
├── robots.txt
├── vercel.json
└── README.md
```

---

## 🧠 Contexto del negocio (no olvidar)

- **Modelo 3 etapas**:
  1. Diagnóstico gratis (este analizador es el lead magnet)
  2. Implementación 4-6 semanas (cobro único)
  3. Recurrente mensual (optimización continua)
- **Target**: PYMEs 10-250 empleados, España + Latam
- **6 soluciones que vende la agencia** (todas con gancho en el analizador tras #7):
  1. CRM & RevOps (gancho: `crm.has_any === false`)
  2. Analytics & BI (gancho: `analytics.has_legacy_ua` o `!has_ga4`)
  3. IA & Automatización (gancho: `chat.has_any === false`, `ai_bots_policy`)
  4. SEO/AEO/GEO (gancho directo: scores SEO/AEO/GEO + sitemap quality)
  5. Paid Media (gancho: `ads.has_any === false`)
  6. Transformación Digital (gancho: `maturity_score < 50`)

---

## ⚙️ Convenciones técnicas (no negociables)

- Edge Runtime para todos los `/api/*`
- ESM con extensión `.js` explícita en imports
- Cero dependencias npm en `lib/` y `api/`
- Vercel free plan: 25s timeout, 100k req/mes
- Spanish en UI, English en código

---

## 🐛 Issues conocidos

| Issue | Estado | Mitigación |
|---|---|---|
| `/api/analyze` 504 ocasional | activo, baja severidad | Frontend tolera fallo, banner amarillo si pasa |
| Google PageSpeed >25s en sitios reales | externo, no fixable | Timeout 10s/strategy en backend, fallback a crawl |
| `/api/crawl` con maxUrls=50 puede acercarse al timeout en sitios lentos | activo, baja severidad | Cap configurable vía `?max=`, por defecto 50 |
| Stack detection no ve scripts inyectados dinámicamente por GTM | conocido y aceptado | Comunicado en el dashboard como nota al pie |

---

## 📚 Recursos clave

- **Caso de prueba**: celes.ai (PYME LATAM AI/SaaS)
- **Dashboard Vercel**: https://vercel.com/dashboard
- **Email destino reportes**: albertodelgadohernando@gmail.com
- **Skill Claude**: `agencia-analyzer.skill`

---

## 🔄 Ritual diario

**Inicio sesión**: "Lee `docs/BITACORA.md` y dime el contexto"
**Cierre sesión**: "Cierre del día — actualiza bitácora y genera PDF de jornada"
**Email automático**: cada día a las 20:00 hora España (cron Vercel)
