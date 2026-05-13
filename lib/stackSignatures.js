/**
 * Diccionario de huellas de stack digital.
 *
 * Cada categoría es un array de detectores. Un detector match cuando
 * cualquiera de sus patrones aparece en el HTML inicial (no carga
 * dinámica). Sesión #7.
 *
 * Estructura de cada detector:
 *   {
 *     id: identificador único (string snake_case)
 *     name: nombre legible para UI (string)
 *     patterns: array de regex que matchean en HTML
 *     extract_id?: regex opcional con grupo 1 = id del recurso (ej. GTM-XXXX, G-XXXX)
 *     ai?: true si el chatbot es IA-powered
 *     legacy?: true si es una tecnología deprecada (gancho duro de venta)
 *   }
 *
 * Diseño: regex precisas. Preferir matchear scripts/dominios cargados,
 * no nombres genéricos en el HTML (un blog post mencionando "HubSpot"
 * no debe falsar el detector).
 */

export const CRM_SIGNATURES = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    patterns: [
      /js\.hs-scripts\.com/i,
      /js\.hs-analytics\.net/i,
      /hbspt\.forms\.create/i,
      /js\.usemessages\.com/i,
      /forms\.hsforms\.com/i,
    ],
    extract_id: /hs-scripts\.com\/(\d+)\.js/i,
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    patterns: [
      /pipedrivewebforms\.com/i,
      /lc\.pipedrive\.com/i,
      /leadbooster-chat\.pipedrive\.com/i,
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    patterns: [
      /salesforce\.com\/embeddedservice/i,
      /service\.force\.com/i,
      /salesforceliveagent/i,
    ],
  },
  {
    id: 'pardot',
    name: 'Pardot (Salesforce Marketing)',
    patterns: [
      /pi\.pardot\.com/i,
      /go\.pardot\.com/i,
    ],
  },
  {
    id: 'zoho',
    name: 'Zoho CRM',
    patterns: [
      /zohopublic\.com/i,
      /salesiq\.zohopublic\.com/i,
      /desk\.zoho\.com/i,
      /\.zoho\.com\/crm/i,
    ],
  },
  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    patterns: [
      /\.activehosted\.com/i,
      /trackcmp\.net/i,
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    patterns: [
      /chimpstatic\.com/i,
      /list-manage\.com/i,
      /mc\.us\d+\.list-manage\.com/i,
    ],
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    patterns: [
      /static\.klaviyo\.com/i,
      /a\.klaviyo\.com/i,
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly (booking)',
    patterns: [
      /assets\.calendly\.com/i,
      /calendly\.com\/[a-z0-9\-_]+/i,
    ],
  },
  {
    id: 'cal_com',
    name: 'Cal.com (booking)',
    patterns: [
      /app\.cal\.com\/embed/i,
      /\bcal\.com\/embed/i,
    ],
  },
];

export const ANALYTICS_SIGNATURES = [
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    patterns: [
      /googletagmanager\.com\/gtag\/js\?id=G-/i,
      /gtag\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+['"]/i,
    ],
    extract_id: /\b(G-[A-Z0-9]+)\b/,
  },
  {
    id: 'gtm',
    name: 'Google Tag Manager',
    patterns: [
      /googletagmanager\.com\/gtm\.js/i,
      /\(window,document,['"]script['"],['"]dataLayer['"],['"]GTM-/i,
    ],
    extract_id: /\b(GTM-[A-Z0-9]+)\b/,
  },
  {
    id: 'ua_legacy',
    name: 'Universal Analytics (deprecado)',
    patterns: [
      /google-analytics\.com\/analytics\.js/i,
      /ga\(\s*['"]create['"]\s*,\s*['"]UA-/i,
    ],
    extract_id: /\b(UA-\d+-\d+)\b/,
    legacy: true,
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    patterns: [
      /static\.hotjar\.com/i,
      /hotjar-\d+\.js/i,
      /hjid\s*[:=]\s*\d+/i,
    ],
  },
  {
    id: 'ms_clarity',
    name: 'Microsoft Clarity',
    patterns: [
      /www\.clarity\.ms\/tag/i,
      /clarity\.ms\/clarity\.js/i,
      /\(c,l,a,r,i,t,y\)/i,
    ],
  },
  {
    id: 'plausible',
    name: 'Plausible',
    patterns: [
      /plausible\.io\/js/i,
      /plausible\.io\/api\/event/i,
    ],
  },
  {
    id: 'fathom',
    name: 'Fathom Analytics',
    patterns: [
      /cdn\.usefathom\.com/i,
    ],
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    patterns: [
      /cdn\.mxpnl\.com/i,
      /mixpanel\.init/i,
    ],
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    patterns: [
      /cdn\.amplitude\.com/i,
      /api\.amplitude\.com/i,
      /amplitude\.getInstance\(\)/i,
    ],
  },
  {
    id: 'segment',
    name: 'Segment',
    patterns: [
      /cdn\.segment\.com\/analytics\.js/i,
      /analytics\.load\(/i,
    ],
  },
  {
    id: 'matomo',
    name: 'Matomo',
    patterns: [
      /matomo\.js/i,
      /_paq\.push/i,
    ],
  },
];

export const ADS_SIGNATURES = [
  {
    id: 'meta_pixel',
    name: 'Meta Pixel (Facebook)',
    patterns: [
      /connect\.facebook\.net\/[a-z_]+\/fbevents\.js/i,
      /fbq\(\s*['"]init['"]/i,
    ],
    extract_id: /fbq\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/i,
  },
  {
    id: 'google_ads',
    name: 'Google Ads Conversion',
    patterns: [
      /googleadservices\.com\/pagead\/conversion/i,
      /gtag\(\s*['"]event['"]\s*,\s*['"]conversion['"]/i,
      /www\.googletagmanager\.com\/gtag\/js\?id=AW-/i,
    ],
    extract_id: /\b(AW-\d+)\b/,
  },
  {
    id: 'linkedin_insight',
    name: 'LinkedIn Insight Tag',
    patterns: [
      /snap\.licdn\.com\/li\.lms-analytics/i,
      /_linkedin_partner_id/i,
    ],
  },
  {
    id: 'tiktok_pixel',
    name: 'TikTok Pixel',
    patterns: [
      /analytics\.tiktok\.com\/i18n\/pixel/i,
      /ttq\.load\(/i,
    ],
  },
  {
    id: 'bing_uet',
    name: 'Microsoft Ads (Bing UET)',
    patterns: [
      /bat\.bing\.com\/bat\.js/i,
      /uetq\s*=\s*window\.uetq/i,
    ],
  },
  {
    id: 'pinterest',
    name: 'Pinterest Tag',
    patterns: [
      /s\.pinimg\.com\/ct\/core\.js/i,
      /pintrk\(\s*['"]load['"]/i,
    ],
  },
  {
    id: 'twitter_pixel',
    name: 'X/Twitter Pixel',
    patterns: [
      /static\.ads-twitter\.com\/uwt\.js/i,
      /twq\(\s*['"]config['"]/i,
    ],
  },
  {
    id: 'reddit_pixel',
    name: 'Reddit Pixel',
    patterns: [
      /www\.redditstatic\.com\/ads/i,
      /rdt\(\s*['"]init['"]/i,
    ],
  },
];

export const CHAT_SIGNATURES = [
  {
    id: 'intercom',
    name: 'Intercom',
    patterns: [
      /widget\.intercom\.io/i,
      /js\.intercomcdn\.com/i,
      /Intercom\(\s*['"]boot['"]/i,
    ],
    ai: 'optional', // Intercom Fin es IA, pero el widget base no
  },
  {
    id: 'drift',
    name: 'Drift',
    patterns: [
      /js\.driftt\.com/i,
      /js\.drift\.com/i,
      /drift\.load\(/i,
    ],
    ai: 'optional',
  },
  {
    id: 'hubspot_chat',
    name: 'HubSpot Chat',
    patterns: [
      /js\.usemessages\.com/i,
      /js\.hs-scripts\.com.*hs-chat/i,
    ],
    ai: 'optional',
  },
  {
    id: 'tidio',
    name: 'Tidio',
    patterns: [
      /code\.tidio\.co/i,
      /widget-v4\.tidiochat\.com/i,
    ],
    ai: 'optional',
  },
  {
    id: 'tawk',
    name: 'Tawk.to',
    patterns: [
      /embed\.tawk\.to/i,
      /Tawk_API/i,
    ],
  },
  {
    id: 'crisp',
    name: 'Crisp',
    patterns: [
      /client\.crisp\.chat/i,
      /\$crisp\s*=/i,
    ],
  },
  {
    id: 'zendesk',
    name: 'Zendesk Chat',
    patterns: [
      /static\.zdassets\.com\/ekr/i,
      /v2\.zopim\.com/i,
      /zE\(\s*['"]webWidget['"]/i,
    ],
    ai: 'optional',
  },
  {
    id: 'livechat',
    name: 'LiveChat',
    patterns: [
      /cdn\.livechatinc\.com\/tracking/i,
      /__lc\s*=/i,
    ],
  },
  {
    id: 'olark',
    name: 'Olark',
    patterns: [
      /static\.olark\.com\/jsclient/i,
    ],
  },
  {
    id: 'freshchat',
    name: 'Freshchat',
    patterns: [
      /wchat\.eu\.freshchat\.com/i,
      /wchat\.freshchat\.com/i,
    ],
  },
];

/**
 * Bots de IA que pueden aparecer en robots.txt.
 * Para cada uno, su user-agent string esperado.
 * El resultado por bot es: 'allowed' | 'disallowed' | 'not_specified'
 */
export const AI_BOTS = [
  { id: 'gptbot', name: 'GPTBot (OpenAI)', ua: 'GPTBot' },
  { id: 'chatgpt_user', name: 'ChatGPT-User', ua: 'ChatGPT-User' },
  { id: 'oai_searchbot', name: 'OAI-SearchBot', ua: 'OAI-SearchBot' },
  { id: 'claudebot', name: 'ClaudeBot (Anthropic)', ua: 'ClaudeBot' },
  { id: 'claude_web', name: 'Claude-Web', ua: 'Claude-Web' },
  { id: 'anthropic_ai', name: 'anthropic-ai', ua: 'anthropic-ai' },
  { id: 'perplexitybot', name: 'PerplexityBot', ua: 'PerplexityBot' },
  { id: 'google_extended', name: 'Google-Extended (Bard/Gemini)', ua: 'Google-Extended' },
  { id: 'ccbot', name: 'CCBot (Common Crawl)', ua: 'CCBot' },
  { id: 'bytespider', name: 'Bytespider (ByteDance/TikTok)', ua: 'Bytespider' },
  { id: 'applebot_extended', name: 'Applebot-Extended', ua: 'Applebot-Extended' },
  { id: 'cohere_ai', name: 'cohere-ai', ua: 'cohere-ai' },
  { id: 'amazonbot', name: 'Amazonbot', ua: 'Amazonbot' },
  { id: 'meta_externalagent', name: 'Meta-ExternalAgent', ua: 'meta-externalagent' },
];
