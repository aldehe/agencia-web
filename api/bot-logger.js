const { createClient } = require('@supabase/supabase-js');

const AI_BOTS = [
  { k: 'gptbot',              n: 'ai_openai' },
  { k: 'chatgpt-user',        n: 'ai_openai' },
  { k: 'oai-searchbot',       n: 'ai_openai' },
  { k: 'claudebot',           n: 'ai_anthropic' },
  { k: 'anthropic-ai',        n: 'ai_anthropic' },
  { k: 'claude-web',          n: 'ai_anthropic' },
  { k: 'perplexitybot',       n: 'ai_perplexity' },
  { k: 'bytespider',          n: 'ai_bytedance' },
  { k: 'google-extended',     n: 'ai_google' },
  { k: 'cohere-ai',           n: 'ai_cohere' },
  { k: 'diffbot',             n: 'ai_diffbot' },
  { k: 'meta-externalagent',  n: 'ai_meta' },
  { k: 'youbot',              n: 'ai_you' },
  { k: 'applebot-extended',   n: 'ai_apple' },
];

const SEO_BOTS = ['googlebot','bingbot','slurp','duckduckbot','baiduspider','yandexbot','applebot','msnbot'];
const MALICIOUS = ['scrapy','python-requests','python-urllib','curl/','wget/','headlesschrome','phantomjs','selenium','puppeteer','playwright'];

function detectBot(ua) {
  if (!ua) return null;
  const u = ua.toLowerCase();
  for (const b of AI_BOTS) { if (u.includes(b.k)) return { type: b.n, category: 'ai' }; }
  for (const b of SEO_BOTS) { if (u.includes(b)) return { type: 'seo_' + b, category: 'seo' }; }
  for (const b of MALICIOUS) { if (u.includes(b)) return { type: 'malicious', category: 'malicious' }; }
  if (/bot[\/;]|crawler|spider|crawl/.test(u)) return { type: 'unknown_bot', category: 'unknown' };
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ua  = req.headers['user-agent'] || '';
  const ip  = req.headers['x-forwarded-for'] || 'unknown';
  const path = req.query.path || '/';
  const url  = req.query.url  || '';

  const bot = detectBot(ua);
  if (!bot) {
    // No es bot — devolver pixel transparente igualmente
    return sendPixel(res);
  }

  // Es un bot — guardar en Supabase
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    const sessionId = require('crypto').randomUUID();
    const now = new Date().toISOString();
    const tenantId = process.env.DEFAULT_TENANT_ID || null;

    await supabase.from('sessions').insert({
      id:           sessionId,
      tenant_id:    tenantId,
      started_at:   now,
      last_active:  now,
      page_count:   1,
      event_count:  1,
      channel:      'bot',
      landing_page: path,
      is_bot:       true,
      bot_type:     bot.type,
      quality_score: 0,
    });

    await supabase.from('events').insert({
      session_id: sessionId,
      tenant_id:  tenantId,
      type:       'pageview',
      ts:         now,
      url:        url,
      path:       path,
      bot_type:   bot.type,
      payload:    JSON.stringify({ user_agent: ua, ip, category: bot.category }),
    });

    console.log('🤖 Bot detectado:', bot.type, ua.slice(0, 80));
  } catch (err) {
    console.error('bot-logger error:', err.message);
  }

  return sendPixel(res);
};

function sendPixel(res) {
  // Pixel GIF 1x1 transparente
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache');
  return res.status(200).end(pixel);
}
