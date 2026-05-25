const { createClient } = require('@supabase/supabase-js');

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
  { k: 'googlebot',          n: 'seo_google' },
  { k: 'bingbot',            n: 'seo_bing' },
  { k: 'yandexbot',          n: 'seo_yandex' },
  { k: 'duckduckbot',        n: 'seo_duckduck' },
];

function detectBot(ua) {
  if (!ua) return null;
  const u = ua.toLowerCase();
  for (const b of AI_BOTS) { if (u.includes(b.k)) return b.n; }
  if (/bot[\/;]|crawler|spider/.test(u)) return 'unknown_bot';
  return null;
}

function sendPixel(res) {
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache');
  return res.status(200).end(pixel);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Detectar bot desde el User-Agent real de la request
  const ua      = req.headers['user-agent'] || '';
  const botType = detectBot(ua);
  const path    = req.query.path || req.url?.split('?')[0] || '/';
  const url     = req.query.url  || '';
  const ip      = req.headers['x-forwarded-for'] || 'unknown';

  console.log('bot-logger called | UA:', ua.slice(0, 80), '| bot:', botType);

  if (!botType) return sendPixel(res);

  try {
    const supabase  = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    const sessionId = require('crypto').randomUUID();
    const now       = new Date().toISOString();
    const tenantId  = process.env.DEFAULT_TENANT_ID || null;

    const [s, e] = await Promise.all([
      supabase.from('sessions').insert({
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
      supabase.from('events').insert({
        session_id: sessionId,
        tenant_id:  tenantId,
        type:       'pageview',
        ts:         now,
        url,
        path,
        bot_type:   botType,
        payload:    JSON.stringify({ user_agent: ua, ip }),
      }),
    ]);

    if (s.error) console.error('session error:', s.error.message);
    if (e.error) console.error('event error:', e.error.message);
    else console.log('✅ Bot guardado:', botType, path);

  } catch (err) {
    console.error('bot-logger error:', err.message);
  }

  return sendPixel(res);
};
