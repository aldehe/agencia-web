# ROADMAP · agencia-web

Backlog priorizado. Marcar como `[x]` cuando se complete.

---

## 🔥 Inmediato (esta semana)

- [x] Crear cuenta Resend + obtener API key
- [x] Configurar `RESEND_API_KEY` en Vercel env vars
- [x] Subir sistema bitácora completo al repo (`docs/`, `api/notify-report.js`, `vercel.json` actualizado con cron)
- [x] Verificar que el cron de las 20:00 envía el primer email correctamente
- [x] **Sesión #6: Top 5 Landing Pages + Sitemap quality + Thin content + H1 duplicados**
- [x] **Sesión #7: Stack detection (CRM, Analytics, Ads, Chat, bots-IA)**
- [ ] **Sesión #8: Prueba LLM real (Claude API) + refundir frontend final con plan de acción agrupado por solución de agencia**
- [ ] Probar el analizador con 2-3 sites adicionales (stripe.com, una PYME ES, una Latam) tras sesiones #6+#7
- [ ] Decidir copy persuasivo del CTA en el dashboard

---

## 📅 Corto plazo (próximas 2-3 semanas)

- [ ] **Frontend persuasivo del informe**
  - [x] Sección "Top páginas estratégicas del sitio" (sesión #6)
  - [x] Sección "Stack digital detectado" con recomendaciones por área (sesión #7)
  - [ ] Sección "Tu posición vs benchmark del sector"
  - [x] Quick wins de impacto inmediato (top 3 ya en el banner)
  - [ ] Plan de implementación 4-6 semanas visualizado (sesión #8)
  - [ ] CTA final fuerte con email/WhatsApp
- [ ] **PDF descargable del informe del cliente**
  - Reusar el sistema de PDF de bitácoras pero con plantilla "informe ejecutivo"
  - Botón "Descargar informe en PDF" en el dashboard
- [ ] **Captar primer cliente piloto**
  - Lista de 10 PYMEs target (ES + Latam)
  - Análisis previo con el analizador
  - Email outreach con el PDF del diagnóstico

---

## 🛠 Medio plazo (Tier 2 backend)

Solo cuando el MVP tenga tracción real (>5 leads). NO desarrollar antes.

- [ ] **Mozilla Observatory** — scoring de seguridad HTTP headers (gratis)
- [ ] **SSL Labs API** — calidad del certificado SSL (gratis)
- [ ] **DNS health** — SPF/DMARC/DKIM vía Cloudflare DoH (gratis)
- [ ] **Wayback Machine** — frescura histórica (gratis)
- [ ] Integrar todo en un nuevo endpoint `/api/security` o ampliar `/api/analyze`

---

## 🚀 Largo plazo (Etapa 3 recurrente)

Para cuando haya cliente pagando recurrente. Requiere infraestructura nueva.

- [ ] **Histórico de análisis en Supabase**
  - Schema: `clients`, `analyses`, `metrics_evolution`
  - Snapshot mensual automático
  - Dashboard de evolución para el cliente
- [ ] **Panel del cliente** (login)
  - Acceso solo a sus análisis
  - Comparativa mes a mes
  - Tareas pendientes asignadas por la agencia
- [ ] **Alertas automáticas**
  - Nuevo schema detectado en competencia
  - Caída brusca de score
  - Cambios en sitemap

---

## 💡 Ideas sin priorizar

Aparcadas hasta que haya señal de demanda real.

- Versión inglés del analizador
- API pública del analizador (con API key, rate limited)
- Integración con HubSpot para tracking de leads (HubSpot ya conectado en MCPs de Claude)
- Comparativa con competidores (analizar 3 URLs simultáneas)
- Sección "Histórico" en el dashboard que muestre cambios desde último análisis
- White-label del analizador para revenders
- Plugin de WordPress / extensión de Chrome
- Ampliar diccionario de stack: e-commerce (Shopify, WooCommerce), CMS detection, A/B testing tools (Optimizely, VWO), email marketing (Convertkit, Mailerlite)

---

## ❌ Descartado (para no volver a discutir)

- Make/Zapier para emails diarios → reemplazado por Vercel Cron + Edge Function
- Serper.dev para SERPs → no aporta valor a target PYME, solo si llega cliente Etapa 2
- Scraping directo Google → bloqueado en Vercel
- Backlinks/DA/PA pagados → no necesarios para el diferencial AEO/GEO
- Search Console / GA / OAuth del cliente en Etapa 1 → fricción que no compensa
- Headless browser para stack detection → rompe Edge Runtime, multiplica costes (decisión 2026-05-12)
- BuiltWith/Wappalyzer API → pago y latencia, no aporta vs regex (decisión 2026-05-12)

---

**Última actualización**: 2026-05-12 (sesión #7)
