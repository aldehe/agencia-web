/**
 * /api/notify-report — envía por email el PDF de la jornada de hoy.
 *
 * Disparado por Vercel Cron diariamente a las 19:00 UTC (= 20:00 hora España).
 * También se puede llamar manualmente: GET /api/notify-report?date=YYYY-MM-DD
 *
 * Lógica:
 *   1. Determina la fecha (param ?date= o "hoy" en zona Madrid)
 *   2. Lee el PDF desde GitHub raw (docs/reportes/YYYY-MM-DD-jornada.pdf)
 *   3. Si existe, envía email con adjunto vía Resend
 *   4. Si no existe, responde 200 sin hacer nada (no es error: significa que
 *      no se trabajó hoy o no se actualizó la bitácora)
 *
 * Variables de entorno requeridas (Vercel → Project → Settings → Env):
 *   - RESEND_API_KEY      → API key de https://resend.com (free tier 3k/mes)
 *   - REPORT_EMAIL_TO     → email destino (albertodelgadohernando@gmail.com)
 *   - REPORT_EMAIL_FROM   → remitente (ej: bitacora@tudominio.com o onboarding@resend.dev)
 *   - GITHUB_REPO_RAW     → URL base del repo raw, ej: https://raw.githubusercontent.com/USER/agencia-web/main
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get('date');
  const force = searchParams.get('force') === '1';

  // Determinar fecha (param o hoy zona Madrid)
  const date = dateParam || todayMadrid();

  // Validar formato YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: 'date inválida (YYYY-MM-DD)' }, 400);
  }

  // Leer envs
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL_TO;
  const from = process.env.REPORT_EMAIL_FROM || 'onboarding@resend.dev';
  const repoRaw = process.env.GITHUB_REPO_RAW;

  if (!apiKey || !to || !repoRaw) {
    return jsonResponse({
      error: 'env vars faltantes',
      needed: ['RESEND_API_KEY', 'REPORT_EMAIL_TO', 'GITHUB_REPO_RAW'],
    }, 500);
  }

  // Construir URL del PDF en GitHub raw
  const pdfUrl = `${repoRaw.replace(/\/$/, '')}/docs/reportes/${date}-jornada.pdf`;

  // Intentar descargar el PDF
  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) {
    if (pdfRes.status === 404 && !force) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'No hay PDF para esta fecha (probablemente no se trabajó o no se subió la bitácora)',
        date,
        pdf_url: pdfUrl,
      });
    }
    return jsonResponse({
      error: 'No se pudo descargar el PDF',
      status: pdfRes.status,
      pdf_url: pdfUrl,
    }, 500);
  }

  // PDF a base64
  const pdfBuf = await pdfRes.arrayBuffer();
  const pdfBase64 = arrayBufferToBase64(pdfBuf);

  // Construir email
  const subject = `Bitácora agencia-web · jornada ${date}`;
  const html = renderEmailHtml(date);
  const filename = `${date}-jornada.pdf`;

  // Enviar vía Resend
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      attachments: [
        { filename, content: pdfBase64 },
      ],
    }),
  });

  const resendBody = await resendRes.json().catch(() => ({}));

  if (!resendRes.ok) {
    return jsonResponse({
      error: 'Resend rechazó el envío',
      status: resendRes.status,
      details: resendBody,
    }, 500);
  }

  return jsonResponse({
    ok: true,
    sent: true,
    date,
    to,
    resend_id: resendBody.id || null,
    pdf_size_bytes: pdfBuf.byteLength,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function todayMadrid() {
  // Devuelve YYYY-MM-DD en horario Europa/Madrid
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // 'YYYY-MM-DD'
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Procesar en chunks para evitar stack overflow con PDFs grandes
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function renderEmailHtml(date) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1220; color: #fff; padding: 40px 20px; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #111827; border-radius: 12px; padding: 32px; border: 1px solid rgba(255,255,255,0.07);">
    <div style="font-size: 14px; font-weight: 600; color: #818CF8; letter-spacing: 0.5px; margin-bottom: 4px;">AGENCIA · BITÁCORA</div>
    <h1 style="font-size: 22px; color: #fff; margin: 0 0 8px 0; font-weight: 700;">Jornada ${date}</h1>
    <p style="color: #94A3B8; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
      Adjunto va el PDF con el resumen de la jornada: trabajo realizado, decisiones, pendientes y conclusiones.
    </p>
    <p style="color: #94A3B8; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0;">
      Para retomar el contexto en la próxima sesión, basta con decir a Claude:
      <br><span style="font-family: monospace; color: #A3E635;">"Lee docs/BITACORA.md y dime el contexto"</span>
    </p>
    <div style="border-top: 1px solid rgba(255,255,255,0.07); padding-top: 16px; margin-top: 20px;">
      <p style="color: #64748B; font-size: 12px; margin: 0;">
        Enviado automáticamente por <code>/api/notify-report</code> · Vercel Cron 20:00 hora España
      </p>
    </div>
  </div>
</body></html>`;
}
