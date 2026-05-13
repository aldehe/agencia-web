/**
 * Detector de stack digital. Sesión #7.
 *
 * Parsea el HTML inicial de la home y el robots.txt y devuelve qué
 * herramientas tiene/no tiene el sitio en 5 categorías:
 *   - CRM / Captación
 *   - Analytics & BI
 *   - Paid Media / Ads
 *   - Chatbots
 *   - Política bots-IA
 *
 * Limitaciones honestas:
 *   - Solo detecta scripts en HTML inicial, no carga dinámica (React
 *     lazy, GTM containers internos).
 *   - GTM detectado pero no su contenido: no sabemos qué tags carga.
 *   - "GA4 instalado" no equivale a "GA4 configurado correctamente".
 */

import {
  CRM_SIGNATURES,
  ANALYTICS_SIGNATURES,
  ADS_SIGNATURES,
  CHAT_SIGNATURES,
  AI_BOTS,
} from './stackSignatures.js';

/**
 * Punto de entrada.
 * @param {string} html - HTML inicial de la home (puede ser null)
 * @param {string|null} robotsTxt - Contenido de robots.txt (puede ser null)
 * @returns {Object} Estructura con detecciones + score + recomendaciones
 */
export function detectStack(html, robotsTxt) {
  const safeHtml = html || '';

  // Para reducir ruido: solo buscamos en <script>, <link>, <iframe>
  // y bloques inline de JS, no en texto narrativo. Eso evita falsos
  // positivos de blogs que mencionen "HubSpot" en un párrafo.
  const techZone = extractTechZone(safeHtml);

  const crm = CRM_SIGNATURES
    .map((sig) => detectOne(sig, techZone))
    .filter(Boolean);

  const analytics = ANALYTICS_SIGNATURES
    .map((sig) => detectOne(sig, techZone))
    .filter(Boolean);

  const ads = ADS_SIGNATURES
    .map((sig) => detectOne(sig, techZone))
    .filter(Boolean);

  const chat = CHAT_SIGNATURES
    .map((sig) => detectOne(sig, techZone))
    .filter(Boolean);

  const aiBotsPolicy = analyzeAIBotsPolicy(robotsTxt);

  // Recomendaciones derivadas (gancho de venta para la agencia)
  const recommendations = buildRecommendations({
    crm, analytics, ads, chat, aiBotsPolicy,
  });

  // Score de madurez digital (0-100) basado en cuántas categorías cubre
  const maturityScore = computeMaturityScore({
    crm, analytics, ads, chat, aiBotsPolicy,
  });

  return {
    crm: {
      detected: crm,
      count: crm.length,
      has_any: crm.length > 0,
    },
    analytics: {
      detected: analytics,
      count: analytics.length,
      has_ga4: analytics.some((d) => d.id === 'ga4'),
      has_gtm: analytics.some((d) => d.id === 'gtm'),
      has_legacy_ua: analytics.some((d) => d.id === 'ua_legacy'),
      has_heatmap: analytics.some((d) => ['hotjar', 'ms_clarity'].includes(d.id)),
    },
    ads: {
      detected: ads,
      count: ads.length,
      has_any: ads.length > 0,
    },
    chat: {
      detected: chat,
      count: chat.length,
      has_any: chat.length > 0,
    },
    ai_bots_policy: aiBotsPolicy,
    maturity_score: maturityScore,
    recommendations,
  };
}

// ─── Helpers internos ────────────────────────────────────────────────────

function detectOne(sig, html) {
  for (const pat of sig.patterns) {
    if (pat.test(html)) {
      const result = {
        id: sig.id,
        name: sig.name,
      };
      if (sig.legacy) result.legacy = true;
      if (sig.ai) result.ai_capability = sig.ai;
      if (sig.extract_id) {
        const m = html.match(sig.extract_id);
        if (m && m[1]) result.detected_id = m[1];
      }
      return result;
    }
  }
  return null;
}

/**
 * Extrae solo las zonas técnicas del HTML para reducir falsos positivos.
 * Concatena: tags <script>, <link>, <iframe> + valores de src/href/onclick.
 * Si el HTML es muy corto o no tiene esas zonas, devuelve el HTML entero.
 */
function extractTechZone(html) {
  if (!html || html.length < 200) return html;

  const parts = [];
  // Bloques de script (inline + con src)
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  parts.push(...scripts);
  // Bloques de script self-closing o con src y sin contenido
  const scriptTags = html.match(/<script\b[^>]*\/?>/gi) || [];
  parts.push(...scriptTags);
  // Links (CSS, preconnect, dns-prefetch)
  const links = html.match(/<link\b[^>]+>/gi) || [];
  parts.push(...links);
  // Iframes (chats embebidos, calendly, etc.)
  const iframes = html.match(/<iframe\b[^>]+>/gi) || [];
  parts.push(...iframes);
  // Meta tags (algunos pixels usan meta)
  const metas = html.match(/<meta\b[^>]+>/gi) || [];
  parts.push(...metas);
  // <noscript> (Meta Pixel y GTM dejan fallback ahí)
  const noscripts = html.match(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi) || [];
  parts.push(...noscripts);

  if (parts.length === 0) return html;
  return parts.join('\n');
}

/**
 * Analiza la política de bots IA en robots.txt.
 * Para cada bot del catálogo, devuelve si está allowed, disallowed o not_specified.
 */
function analyzeAIBotsPolicy(robotsTxt) {
  const result = {
    has_robots: !!robotsTxt,
    bots: [],
    summary: { allowed: 0, disallowed: 0, not_specified: 0 },
    has_any_block: false,
  };

  if (!robotsTxt) {
    for (const bot of AI_BOTS) {
      result.bots.push({ ...bot, status: 'not_specified' });
      result.summary.not_specified++;
    }
    return result;
  }

  // Parsear robots.txt en bloques User-agent / Disallow / Allow
  const lines = robotsTxt.split(/\r?\n/);
  const blocks = []; // [{ uas: [...], disallows: [...], allows: [...] }]
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const directive = m[1].toLowerCase();
    const value = m[2].trim();

    if (directive === 'user-agent') {
      // Si current ya tiene reglas, nuevo bloque. Si no, agregar UA al actual.
      if (!current || current.disallows.length || current.allows.length) {
        current = { uas: [value], disallows: [], allows: [] };
        blocks.push(current);
      } else {
        current.uas.push(value);
      }
    } else if (directive === 'disallow' && current) {
      current.disallows.push(value);
    } else if (directive === 'allow' && current) {
      current.allows.push(value);
    }
  }

  // Para cada bot, ver si tiene bloque específico o cae en el wildcard *
  for (const bot of AI_BOTS) {
    let status = 'not_specified';

    // Buscar bloque específico (case-insensitive)
    const specific = blocks.find((b) =>
      b.uas.some((ua) => ua.toLowerCase() === bot.ua.toLowerCase())
    );

    if (specific) {
      // Si tiene Disallow: / → disallowed total
      // Si solo tiene Disallow vacío o Allow → allowed
      const hasFullDisallow = specific.disallows.some(
        (d) => d === '/' || d.trim() === '/'
      );
      const hasAnyDisallow = specific.disallows.some(
        (d) => d.trim() !== ''
      );
      if (hasFullDisallow) status = 'disallowed';
      else if (hasAnyDisallow) status = 'partial';
      else status = 'allowed';
    }

    result.bots.push({ ...bot, status });
    if (status === 'disallowed') {
      result.summary.disallowed++;
      result.has_any_block = true;
    } else if (status === 'allowed' || status === 'partial') {
      result.summary.allowed++;
    } else {
      result.summary.not_specified++;
    }
  }

  return result;
}

/**
 * Genera recomendaciones de venta basadas en los gaps detectados.
 * Cada una es un anzuelo para una de las 6 soluciones de la agencia.
 */
function buildRecommendations({ crm, analytics, ads, chat, aiBotsPolicy }) {
  const recs = [];

  // CRM / RevOps
  if (crm.length === 0) {
    recs.push({
      area: 'CRM & RevOps',
      severity: 'high',
      title: 'No detectamos sistema de captación o CRM',
      detail: 'No hay HubSpot, Pipedrive, Salesforce, ni un sistema equivalente en la web. Los visitantes que muestran interés no quedan registrados en ninguna parte.',
    });
  }

  // Analytics
  if (!analytics.some((d) => d.id === 'ga4' || d.id === 'gtm')) {
    recs.push({
      area: 'Analytics & BI',
      severity: 'high',
      title: 'No detectamos analítica básica',
      detail: 'Sin GA4 ni GTM, no se puede medir tráfico, conversiones ni rendimiento de campañas. Cualquier decisión basada en datos es ciega.',
    });
  }
  if (analytics.some((d) => d.id === 'ua_legacy')) {
    recs.push({
      area: 'Analytics & BI',
      severity: 'high',
      title: 'Universal Analytics aún instalado (deprecado en julio 2023)',
      detail: 'UA dejó de procesar datos hace tiempo. Si los reportes siguen entrando, no son reales. Migración a GA4 urgente.',
    });
  }
  if (!analytics.some((d) => ['hotjar', 'ms_clarity'].includes(d.id))) {
    recs.push({
      area: 'Analytics & BI',
      severity: 'med',
      title: 'Sin herramienta de mapas de calor / grabación de sesiones',
      detail: 'Hotjar o Microsoft Clarity (gratis) revelan dónde abandonan los usuarios. Sin esto, optimizar el funnel es a ciegas.',
    });
  }

  // Ads
  if (ads.length === 0) {
    recs.push({
      area: 'Paid Media',
      severity: 'med',
      title: 'No detectamos píxeles de remarketing',
      detail: 'Sin Meta Pixel, Google Ads tag ni LinkedIn Insight, no se puede hacer remarketing a los visitantes ni medir conversiones de campañas pagadas.',
    });
  }

  // Chat
  if (chat.length === 0) {
    recs.push({
      area: 'IA & Automatización',
      severity: 'med',
      title: 'Sin chat ni atención automatizada',
      detail: 'Los visitantes con dudas se van sin convertir. Un chatbot IA o widget de chat humano captura entre el 5% y el 15% extra de leads.',
    });
  }

  // AI bots
  if (!aiBotsPolicy.has_robots) {
    recs.push({
      area: 'SEO/AEO/GEO',
      severity: 'med',
      title: 'Sin robots.txt — política de bots-IA indefinida',
      detail: 'No estás controlando qué bots pueden leer tu contenido. ChatGPT, Claude y Perplexity entran sin restricciones (ni permisos explícitos).',
    });
  } else if (aiBotsPolicy.summary.not_specified === aiBotsPolicy.bots.length) {
    recs.push({
      area: 'SEO/AEO/GEO',
      severity: 'low',
      title: 'robots.txt no menciona bots-IA',
      detail: 'Los bots de OpenAI, Anthropic, Perplexity y Google-Extended pueden entrar por defecto (regla wildcard). Decisión consciente recomendada.',
    });
  } else if (aiBotsPolicy.has_any_block) {
    recs.push({
      area: 'SEO/AEO/GEO',
      severity: 'low',
      title: 'Bloqueas algunos bots-IA',
      detail: `Bloqueas ${aiBotsPolicy.summary.disallowed} bot(s) IA. Si quieres aparecer en respuestas de ChatGPT/Claude/Perplexity, conviene revisar qué bloqueas.`,
    });
  }

  return recs;
}

/**
 * Score 0-100 de madurez digital del stack detectado.
 * 5 categorías × 20 puntos cada una con ajustes por calidad.
 */
function computeMaturityScore({ crm, analytics, ads, chat, aiBotsPolicy }) {
  let score = 0;

  // CRM (20 pts)
  if (crm.length > 0) score += 20;

  // Analytics (20 pts): GA4 vale 15, GTM extra 5, legacy UA penaliza
  if (analytics.some((d) => d.id === 'ga4')) score += 15;
  if (analytics.some((d) => d.id === 'gtm')) score += 5;
  if (analytics.some((d) => d.id === 'ua_legacy')) score -= 5;
  if (analytics.some((d) => ['hotjar', 'ms_clarity', 'mixpanel', 'amplitude'].includes(d.id))) score += 5;

  // Ads (20 pts máx): cada pixel vale 5, capped a 20
  score += Math.min(20, ads.length * 5);

  // Chat (15 pts)
  if (chat.length > 0) score += 15;

  // AI bots policy (20 pts): tener robots vale 5, posición consciente extra
  if (aiBotsPolicy.has_robots) score += 5;
  if (aiBotsPolicy.summary.allowed + aiBotsPolicy.summary.disallowed >= 3) score += 15;

  return Math.max(0, Math.min(100, score));
}
