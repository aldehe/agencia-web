# Sistema de bitácora · agencia-web

Sistema de memoria del proyecto: archivos vivos en repo + reportes PDF diarios + email automático.

## ¿Qué incluye?

| Archivo | Para qué |
|---|---|
| `docs/BITACORA.md` | Estado actual, próxima sesión, histórico de sesiones |
| `docs/ROADMAP.md` | Backlog priorizado |
| `docs/DECISIONES.md` | Log cronológico de decisiones (no se editan, se añaden) |
| `docs/reportes/YYYY-MM-DD-jornada.pdf` | PDF generado al cerrar cada sesión |
| `api/notify-report.js` | Edge Function que envía el PDF por email |
| `vercel.json` (cron) | Programa el envío diario a las 20:00 hora España |
| `generate_report.py` | Script Python local para generar el PDF (no va al repo) |

---

## Setup inicial (solo se hace UNA vez)

### 1. Crear cuenta Resend (3 min)

1. Ir a [resend.com](https://resend.com) → Sign up (gratis, sin tarjeta)
2. Verificar email
3. Dashboard → **API Keys** → Create API key (con permiso **Sending access**)
4. Copiar la key (formato: `re_xxxxxxxx...`)

### 2. Configurar variables de entorno en Vercel

En `vercel.com/dashboard` → proyecto `agencia-web` → **Settings** → **Environment Variables**.

Añadir 3 variables (todas en `Production` y `Preview`):

| Nombre | Valor | Comentario |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxx...` | La key del paso anterior |
| `REPORT_EMAIL_TO` | `albertodelgadohernando@gmail.com` | Tu email |
| `GITHUB_REPO_RAW` | `https://raw.githubusercontent.com/TU_USUARIO/agencia-web/main` | Reemplaza TU_USUARIO |

Opcional (si tienes dominio verificado en Resend):

| Nombre | Valor |
|---|---|
| `REPORT_EMAIL_FROM` | `bitacora@tudominio.com` |

Si no lo configuras, usará `onboarding@resend.dev` (funciona pero llega como "noreply").

### 3. Subir todo al repo

```cmd
cd C:\Users\sandr\Desktop\agencia-web
git add docs/ api/notify-report.js vercel.json
git commit -m "feat: sistema bitácora + cron diario email"
git push
```

Vercel re-deploya automáticamente. El cron queda activo desde el primer deploy.

### 4. Test manual del envío

Para verificar que todo funciona sin esperar a las 20:00:

Abrir en el navegador:
```
https://agencia-web-pi.vercel.app/api/notify-report?date=2026-05-08
```

Debería responder con `{"ok": true, "sent": true, ...}` y llegarte el email.

Si responde `{"ok": true, "skipped": true}` significa que no encuentra el PDF en GitHub raw — verifica que `docs/reportes/2026-05-08-jornada.pdf` está en el repo.

Si da error 500, revisa env vars y los logs en Vercel.

---

## Uso diario

### Al inicio de cada sesión con Claude

```
Lee docs/BITACORA.md y dime el contexto
```

Claude resume estado, último cambio y top 3 pendientes.

### Durante la sesión

Trabajar normal. Claude irá guardando mentalmente cosas para el resumen final.

### Al cerrar la sesión

```
Cierre del día — actualiza bitácora y genera PDF de jornada
```

Claude:
1. Genera versión actualizada de `BITACORA.md` (añade entrada en histórico)
2. Genera nuevo `docs/reportes/YYYY-MM-DD-jornada.pdf`
3. Si hay decisiones nuevas, las añade a `DECISIONES.md`
4. Si hay cambios de prioridad, actualiza `ROADMAP.md`
5. Te entrega los archivos para `git push`

Tú haces el push:
```cmd
cd C:\Users\sandr\Desktop\agencia-web
git add docs/
git commit -m "bitácora: jornada YYYY-MM-DD"
git push
```

A las 20:00 te llega el email automáticamente con el PDF adjunto.

---

## Generar PDF manualmente (sin Claude)

Si por alguna razón quieres regenerar un PDF localmente:

```bash
pip install reportlab
python generate_report.py jornada-2026-05-08.json docs/reportes/
```

El JSON tiene la estructura definida en `generate_report.py` (ver docstring).

---

## Troubleshooting

### El email no llega
1. Verificar Vercel → Logs → buscar invocaciones a `/api/notify-report`
2. Comprobar carpeta SPAM
3. Si usas `onboarding@resend.dev` como FROM, Gmail puede filtrarlo. Solución: verificar tu propio dominio en Resend.

### El PDF no se encuentra
- El cron busca `docs/reportes/YYYY-MM-DD-jornada.pdf` en `main` del repo. Si trabajas en otra rama, no se encuentra.
- Si no hiciste push antes de las 20:00, no hay PDF que enviar (responde `skipped`).

### El cron no se dispara
- Vercel Cron solo funciona en plan **Hobby** y superiores (gratis). En el plan free hay 2 cron jobs incluidos.
- Verificar que `vercel.json` tiene la sección `"crons"` y que está en la raíz del repo.
- El primer cron tarda ~1 hora en activarse tras el deploy.

### Cambiar la hora del envío
Editar `vercel.json` → `crons[0].schedule`. Formato cron en UTC. Para Europa/Madrid:
- Invierno (UTC+1): restar 1h
- Verano (UTC+2): restar 2h

Ejemplo: para que llegue a las 22:00 hora España en invierno → `"0 21 * * *"` (21:00 UTC).

---

## Coste

- Resend: 0€/mes (free tier 3.000 emails, usaremos ~30/mes)
- Vercel Cron: 0€/mes (incluido en free, 2 crons disponibles)
- Storage en GitHub: irrelevante (PDFs ~10KB cada uno)

**Total**: 0€/mes.
