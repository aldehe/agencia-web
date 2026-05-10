/**
 * /api/notify-report — envía PDF de la jornada por email + lo sube a Notion.
 *
 * Disparado por Vercel Cron diariamente a las 19:00 UTC (= 20:00 hora España).
 * También llamable manualmente: GET /api/notify-report?date=YYYY-MM-DD
 *
 * Lógica:
 *   1. Determina la fecha (param ?date= o "hoy" en zona Madrid)
 *   2. Lee el PDF desde GitHub raw (docs/reportes/YYYY-MM-DD-jornada.pdf)
 *   3. Si existe:
 *      a) Envía email con adjunto vía Resend
 *      b) Sube el PDF al storage de Notion (file_uploads API)
 *      c) Crea fila en la database de Notion con el PDF adjunto
 *   4. Si no existe: responde 200 con skipped
 *
 * Variables de entorno requeridas (Vercel → Project → Settings → Env):
 *   - RESEND_API_KEY      → API key de https://resend.com
 *   - REPORT_EMAIL_TO     → email destino
 *   - REPORT_EMAIL_FROM   → opcional, default 'onboarding@resend.dev'
 *   - GITHUB_REPO_RAW     → ej: https://raw.githubusercontent.com/aldehe/agencia-web/main
 *   - NOTION_TOKEN        → Internal Integration Secret de https://notion.so/profile/integrations
 *   - NOTION_DATABASE_ID  → ID de la database (32 chars hex sin guiones)
 */

export const config = { runtime: 'edge' };

const NOTION_VERSION = '2022-06-28';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get('date');
  const force = searchParams.get('force') === '1';
  const skipNotion = searchParams.get('skip_notion') === '1';
  const skipEmail = searchParams.get('skip_email') === '1';

  const date = dateParam || todayMadrid();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: 'date inválida (YYYY-MM-DD)' }, 400);
  }

  // Leer envs
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL_TO;
  const from = process.env.REPORT_EMAIL_FROM || 'onboarding@resend.dev';
  const repoRaw = process.env.GITHUB_REPO_RAW;
  const notionToken = process.env.NOTION_TOKEN;
  const notionDbId = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !to || !repoRaw) {
    return jsonResponse({
      error: 'env vars de email faltantes',
      needed: ['RESEND_API_KEY', 'REPORT_EMAIL_TO', 'GITHUB_REPO_RAW'],
    }, 500);
  }

  const result = {
    date,
    email: { sent: false },
    notion: { sent: false },
  };

  // 1) Descargar PDF
  const pdfUrl = `${repoRaw.replace(/\/$/, '')}/docs/reportes/${date}-jornada.pdf`;
  const pdfRes = await fetch(pdfUrl);

  if (!pdfRes.ok) {
    if (pdfRes.status === 404 && !force) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'No hay PDF para esta fecha',
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

  const pdfBuf = await pdfRes.arrayBuffer();
  const pdfBase64 = arrayBufferToBase64(pdfBuf);
  const filename = `${date}-jornada.pdf`;

  // 2) Email vía Resend
  if (!skipEmail) {
    try {
      const subject = `Bitácora agencia-web · jornada ${date}`;
      const html = renderEmailHtml(date);

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from, to, subject, html,
          attachments: [{ filename, content: pdfBase64 }],
        }),
      });

      const resendBody = await resendRes.json().catch(() => ({}));

      if (resendRes.ok) {
        result.email = {
          sent: true,
          resend_id: resendBody.id || null,
          to,
        };
      } else {
        result.email = {
          sent: false,
          error: 'Resend rechazó el envío',
          status: resendRes.status,
          details: resendBody,
        };
      }
    } catch (e) {
      result.email = { sent: false, error: e.message };
    }
  }

  // 3) Notion (si está configurado)
  if (!skipNotion && notionToken && notionDbId) {
    try {
      // 3a) Subir el PDF al storage de Notion
      // Esta API soporta single-part upload directo (archivos < 20 MB)
      const uploadCreateRes = await fetch('https://api.notion.com/v1/file_uploads', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'single_part',
          filename,
          content_type: 'application/pdf',
        }),
      });

      const uploadCreateBody = await uploadCreateRes.json().catch(() => ({}));

      if (!uploadCreateRes.ok) {
        result.notion = {
          sent: false,
          error: 'Notion: error creando file_upload',
          status: uploadCreateRes.status,
          details: uploadCreateBody,
        };
      } else {
        const uploadId = uploadCreateBody.id;
        const uploadUrl = uploadCreateBody.upload_url;

        // 3b) Subir bytes al endpoint de upload (multipart/form-data)
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(pdfBuf)], { type: 'application/pdf' });
        formData.append('file', blob, filename);

        const uploadSendRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': NOTION_VERSION,
          },
          body: formData,
        });

        if (!uploadSendRes.ok) {
          const errBody = await uploadSendRes.text().catch(() => '');
          result.notion = {
            sent: false,
            error: 'Notion: fallo subiendo bytes del PDF',
            status: uploadSendRes.status,
            details: errBody.slice(0, 500),
          };
        } else {
          // 3c) Crear página (fila) en la database referenciando el file_upload
          const pageRes = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': NOTION_VERSION,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              parent: { database_id: notionDbId },
              properties: {
                'Título': {
                  title: [{ text: { content: `${date}-jornada` } }],
                },
                'PDF': {
                  files: [{
                    type: 'file_upload',
                    name: filename,
                    file_upload: { id: uploadId },
                  }],
                },
                'Tipo': {
                  select: { name: 'Diario' },
                },
              },
            }),
          });

          const pageBody = await pageRes.json().catch(() => ({}));

          if (pageRes.ok) {
            result.notion = {
              sent: true,
              page_id: pageBody.id,
              page_url: pageBody.url,
            };
          } else {
            result.notion = {
              sent: false,
              error: 'Notion: fallo creando fila',
              status: pageRes.status,
              details: pageBody,
            };
          }
        }
      }
    } catch (e) {
      result.notion = { sent: false, error: 'Notion exception: ' + e.message };
    }
  } else if (!notionToken || !notionDbId) {
    result.notion = { sent: false, skipped: 'Notion no configurado (NOTION_TOKEN o NOTION_DATABASE_ID faltan)' };
  }

  // Resultado final
  const overallOk = result.email.sent || result.notion.sent;
  return jsonResponse({
    ok: overallOk,
    date,
    pdf_size_bytes: pdfBuf.byteLength,
    ...result,
  }, overallOk ? 200 : 500);
}

// ─── Helpers ────────────────────────────────────────────────────────

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function todayMadrid() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
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
      Adjunto va el PDF con el resumen de la jornada: trabajo realizado, decisiones, pendientes y conclusiones. También se ha guardado en la tabla de Notion.
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
