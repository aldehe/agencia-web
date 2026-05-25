// middleware.js — raíz del proyecto Vercel
// Intercepta TODAS las peticiones HTTP, incluso bots que no ejecutan JS
// Compatible con Vercel Edge Runtime

import { NextResponse } from 'next/server';

// ── BOT DETECTION (mismo que track.js pero en Edge) ──────────
function detectBot(ua) {
  if (!ua) return { is_bot: false, bot_type: 'human' };
  var u = ua.toLowerCase();

  var aiBots = [
    { k: 'gptbot',           n: 'ai_openai' },
    { k: 'chatgpt-user',     n: 'ai_openai' },
    { k: 'oai-searchbot',    n: 'ai_openai' },
    { k: 'claudebot',        n: 'ai_anthropic' },
    { k: 'anthropic-ai',     n: 'ai_anthropic' },
    { k: 'claude-web',       n: 'ai_anthropic' },
    { k: 'perplexitybot',    n: 'ai_perplexity' },
    { k: 'bytespider',       n: 'ai_bytedance' },
    { k: 'google-extended',  n: 'ai_google' },
    { k: 'cohere-ai',        n: 'ai_cohere' },
    { k: 'diffbot',          n: 'ai_diffbot' },
    { k: 'meta-externalagent', n: 'ai_meta' },
    { k: 'youbot',           n: 'ai_you' },
    { k: 'applebot-extended',n: 'ai_apple' },
  ];

  var seoBots = [
    'googlebot', 'bingbot', 'slurp', 'duckduckbot',
    'baiduspider', 'yandexbot', 'applebot', 'msnbot',
  ];

  var malicious = [
    'scrapy', 'python-requests', 'python-urllib', 'curl/',
    'wget/', 'headlesschrome', 'phantomjs', 'selenium',
    'puppeteer', 'playwright', 'sqlmap', 'nikto',
  ];

  for (var i = 0; i < aiBots.length; i++) {
    if (u.includes(aiBots[i].k)) return { is_bot: true, bot_type: aiBots[i].n };
  }
  for (var j = 0; j < seoBots.length; j++) {
    if (u.includes(seoBots[j])) return { is_bot: true, bot_type: 'seo_' + seoBots[j] };
  }
  for (var k = 0; k < malicious.length; k++) {
    if (u.includes(malicious[k])) return { is_bot: true, bot_type: 'malicious' };
  }

  var generic = ['bot/', 'bot;', 'crawler', 'spider', 'crawl', 'fetch/', 'monitor', 'uptime'];
  for (var l = 0; l < generic.length; l++) {
    if (u.includes(generic[l])) return { is_bot: true, bot_type: 'unknown_bot' };
  }

  return { is_bot: false, bot_type: 'human' };
}

// ── GUARDAR EN SUPABASE (fetch directo, sin SDK) ─────────────
async function saveBotVisit({ botType, ua, ip, path, url, tenant_id }) {
  var supabaseUrl  = process.env.SUPABASE_URL;
  var supabaseKey  = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return;

  var sessionId = crypto.randomUUID();
  var now       = new Date().toISOString();

  // Upsert sesión del bot
  await fetch(supabaseUrl + '/rest/v1/sessions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id:           sessionId,
      tenant_id:    tenant_id || null,
      started_at:   now,
      last_active:  now,
      page_count:   1,
      event_count:  1,
      channel:      'bot',
      landing_page: path,
      is_bot:       true,
      bot_type:     botType,
      quality_score:0,
    }),
  });

  // Insertar evento de pageview del bot
  await fetch(supabaseUrl + '/rest/v1/events', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
    },
    body: JSON.stringify({
      session_id: sessionId,
      tenant_id:  tenant_id || null,
      type:       'pageview',
      ts:         now,
      url:        url,
      path:       path,
      bot_type:   botType,
      payload:    JSON.stringify({ user_agent: ua, ip }),
    }),
  });
}

// ── MIDDLEWARE PRINCIPAL ──────────────────────────────────────
export async function middleware(request) {
  var ua   = request.headers.get('user-agent') || '';
  var path = request.nextUrl.pathname;
  var url  = request.url;
  var ip   = request.headers.get('x-forwarded-for') ||
             request.headers.get('x-real-ip') || 'unknown';

  // Solo procesar páginas HTML, ignorar assets
  var isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json)$/.test(path);
  if (isAsset) return NextResponse.next();

  var { is_bot, bot_type } = detectBot(ua);

  if (is_bot) {
    // Guardar en Supabase en background (no bloquea la respuesta)
    var tenant_id = process.env.DEFAULT_TENANT_ID || null;

    // No await — fire and forget para no añadir latencia al bot
    saveBotVisit({ botType: bot_type, ua, ip, path, url, tenant_id })
      .catch(function(err) { console.error('middleware bot save error:', err); });
  }

  // Siempre dejar pasar la petición original
  return NextResponse.next();
}

// ── CONFIGURACIÓN: qué rutas aplica el middleware ────────────
export const config = {
  matcher: [
    // Aplica a todas las rutas excepto _next y archivos estáticos
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
