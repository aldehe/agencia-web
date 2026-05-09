# BITÁCORA · agencia-web

Bitácora viva del proyecto. Última actualización: **2026-05-08**.

> 📖 **Cómo usar este archivo**: leer al inicio de cada sesión para retomar contexto. Actualizar al final con un resumen breve de la sesión. El detalle completo de cada jornada está en `docs/reportes/YYYY-MM-DD-jornada.pdf`.

---

## 📍 Estado actual

**Etapa**: MVP del analizador desplegado y estable. Lista para captación.

**Producción**: https://agencia-web-pi.vercel.app  
**Analizador**: https://agencia-web-pi.vercel.app/analyzer  
**Repo local**: `C:\Users\sandr\Desktop\agencia-web`

**Último cambio**: dashboard tolerante a fallos + sistema de bitácora con email diario.

**Bloqueos / dependencias externas**: ninguno. Cuenta de Resend pendiente de crear (3 min) para activar emails diarios.

---

## 🎯 Próxima sesión

1. Crear cuenta en Resend, obtener API key, configurar en Vercel (`RESEND_API_KEY`)
2. Hacer primer push del sistema de bitácora completo
3. Verificar que el primer email diario llegue correctamente a las 20:00
4. Probar el analizador con 2-3 sites más (stripe.com, una PYME ES, una Latam)

---

## 🗓 Histórico de sesiones

| Fecha | Sesión | Foco | PDF |
|---|---|---|---|
| 2026-04-30 | #1 | Arquitectura inicial, filtrado PageSpeed, primer endpoint analyze | (retroactivo, sin PDF) |
| 2026-05-01 | #2 | Crawler de sitio, validador de schemas, AEO Citability Score | (retroactivo) |
| 2026-05-02 | #3 | Generador llms.txt, integración Capa 1, dashboard inicial | (retroactivo) |
| 2026-05-07 | #4 | Despliegue, debug bug crítico de scores, validación celes.ai | (retroactivo) |
| 2026-05-08 | #5 | Tolerancia a fallos, optimización analyze, sistema bitácora, skill | [PDF](reportes/2026-05-08-jornada.pdf) |

---

## 📂 Estructura del proyecto

```
agencia-web/
├── index.html                       Landing pública
├── analyzer/
│   └── index.html                   Dashboard del analizador
├── api/
│   ├── analyze.js                   Edge: PageSpeed + HTML home + robots/sitemap/llms.txt
│   ├── crawl.js                     Edge: crawler del sitio completo
│   └── notify-report.js             Edge: cron diario que envía PDF por email
├── lib/
│   ├── filterPagespeed.js
│   ├── parsePage.js
│   ├── crawler.js
│   ├── citabilityScore.js
│   ├── validateSchema.js
│   └── generateLlmsTxt.js
├── docs/
│   ├── BITACORA.md                  ← este archivo
│   ├── ROADMAP.md                   Backlog priorizado
│   ├── DECISIONES.md                Log cronológico de decisiones
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
- **Diferencial**: 50/50 SEO técnico + AEO/GEO (visibilidad en LLMs)

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

---

## 📚 Recursos clave

- **Caso de prueba**: celes.ai (PYME LATAM AI/SaaS, 10 páginas, 0 schemas)
- **Dashboard Vercel**: https://vercel.com/dashboard
- **Email destino reportes**: albertodelgadohernando@gmail.com
- **Skill Claude**: `agencia-analyzer.skill` (instalar en Settings de Claude.ai)

---

## 🔄 Ritual diario

**Inicio sesión**: "Lee `docs/BITACORA.md` y dime el contexto"  
**Cierre sesión**: "Cierre del día — actualiza bitácora y genera PDF de jornada"  
**Email automático**: cada día a las 20:00 hora España (cron Vercel)
