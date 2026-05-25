// middleware.js — detecta bots y llama a /api/bot-logger internamente

export default async function middleware(request) {
  const ua   = request.headers.get('user-agent') || '';
  const u    = ua.toLowerCase();
  const path = new URL(request.url).pathname;
  const host = request.headers.get('host') || 'nexomarketing.io';

  // Ignorar assets
  if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map)$/.test(path)) {
    return new Response(null, { status: 200, headers: { 'x-middleware-next': '1' } });
  }

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
  const SEO_BOTS  = ['googlebot','bingbot','slurp','duckduckbot','yandexbot','applebot','msnbot'];
  const MALICIOUS = ['scrapy','python-requests','python-urllib','headlesschrome','phantomjs','selenium','puppeteer','playwright'];

  let botType = null;
  for (const b of AI_BOTS)   { if (u.includes(b.k)) { botType = b.n; break; } }
  if (!botType) for (const b of SEO_BOTS)   { if (u.includes(b)) { botType = 'seo_' + b; break; } }
  if (!botType) for (const b of MALICIOUS)  { if (u.includes(b)) { botType = 'malicious'; break; } }
  if (!botType && /bot[\/;]|crawler|spider/.test(u)) botType = 'unknown_bot';

  if (botType) {
    // Llamar a la API serverless que SÍ puede usar @supabase/supabase-js
    const logUrl = 'https://' + host + '/api/bot-logger'
      + '?path=' + encodeURIComponent(path)
      + '&url='  + encodeURIComponent(request.url)
      + '&ua='   + encodeURIComponent(ua)
      + '&bot='  + encodeURIComponent(botType);

    // await para que Vercel Edge no cierre antes
    await fetch(logUrl).catch(err => console.error('bot-logger call failed:', err));
  }

  return new Response(null, { status: 200, headers: { 'x-middleware-next': '1' } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
