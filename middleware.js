// middleware.js — Vercel Edge Middleware
// Detecta bots de IA leyendo el User-Agent server-side
// No requiere Next.js — funciona con HTML estático

export default async function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  const u  = ua.toLowerCase();

  const AI_BOTS = [
    { k: 'gptbot',             n: 'ai_openai' },
    { k: 'chatgpt-user',       n: 'ai_openai' },
    { k: 'oai-searchbot',      n: 'ai_openai' },
    { k: 'claudebot',          n: 'ai_anthropic' },
    { k: 'anthropic-ai',       n: 'ai_anthropic' },
    { k: 'perplexitybot',      n: 'ai_perplexity' },
    { k: 'bytespider',         n: 'ai_bytedance' },
    { k: 'google-extended',    n: 'ai_google' },
    { k: 'cohere-ai',          n: 'ai_cohere' },
    { k: 'diffbot',            n: 'ai_diffbot' },
    { k: 'meta-externalagent', n: 'ai_meta' },
    { k: 'youbot',             n: 'ai_you' },
  ];

  const SEO_BOTS = ['googlebot','bingbot','slurp','duckduckbot','yandexbot','applebot','msnbot'];
  const MALICIOUS = ['scrapy','python-requests','python-urllib','headlesschrome','phantomjs','selenium','puppeteer','playwright'];

  let botType = null;
  for (const b of AI_BOTS)  { if (u.includes(b.k)) { botType = b.n; break; } }
  if (!botType) for (const b of SEO_BOTS)   { if (u.includes(b)) { botType = 'seo_' + b; break; } }
  if (!botType) for (const b of MALICIOUS)  { if (u.includes(b)) { botType = 'malicious'; break; } }
  if (!botType && /bot[\/;]|crawler|spider/.test(u)) botType = 'unknown_bot';

  if (botType) {
    const supabaseUrl = 'https://kzhbyltkmrpyxwxxwodv.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6aGJ5bHRrbXJweXh3eHh3b2R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0Mzg5MTEsImV4cCI6MjA5MzAxNDkxMX0.a2BVqewKjzEduoGNrSLnG3XD5wWGI53PpzvhXYQjXD4';
    const tenantId   = '87815537-9181-4495-95f2-d1bf68189fcf';

    const url  = request.url;
    const path = new URL(url).pathname;
    const ip   = request.headers.get('x-forwarded-for') || 'unknown';
    const now  = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    // Fire and forget — no bloquea la respuesta
    Promise.all([
      fetch(supabaseUrl + '/rest/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
        },
        body: JSON.stringify({
          id:            sessionId,
          tenant_id:     tenantId,
          started_at:    now,
          last_active:   now,
          page_count:    1,
          event_count:   1,
          channel:       'bot',
          landing_page:  path,
          is_bot:        true,
          bot_type:      botType,
          quality_score: 0,
        }),
      }),
      fetch(supabaseUrl + '/rest/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
        },
        body: JSON.stringify({
          session_id: sessionId,
          tenant_id:  tenantId,
          type:       'pageview',
          ts:         now,
          url:        url,
          path:       path,
          bot_type:   botType,
          payload:    JSON.stringify({ user_agent: ua, ip }),
        }),
      }),
    ]).catch(err => console.error('middleware bot save error:', err));
  }

  // Siempre dejar pasar
  return new Response(null, { status: 200, headers: { 'x-middleware-next': '1' } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
