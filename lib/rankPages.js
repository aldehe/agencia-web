/**
 * Ranking de páginas: decide cuáles son las "Top Landing Pages" del sitio.
 *
 * Sin GA ni Search Console, usamos una heurística que combina:
 *   1. Inbound internal links (cuántas páginas internas la enlazan)
 *   2. Tipo de página inferido por URL (servicios/productos pesan más que blog)
 *   3. Profundidad del path (raíz = más estratégica)
 *   4. Word count razonable (>300, indica contenido real)
 *   5. Citability score (penaliza páginas vacías o débiles)
 *
 * Excluye home (se muestra aparte) y legales/404/etc.
 *
 * Output: array ordenado descendente por score.
 */

const TYPE_WEIGHTS = {
  pricing: 100,        // /precios, /pricing, /planes — máxima intención comercial
  service: 90,         // /servicios, /soluciones
  product: 85,         // /productos, /features
  case_study: 70,      // /casos, /clientes, /case-studies
  about: 60,           // /sobre-nosotros, /empresa
  contact: 55,         // /contacto
  blog_post: 35,       // /blog/x
  other: 20,
};

const EXCLUDE_PATTERNS = [
  /\/(privacy|privacidad|terms|terminos|cookies|legal|aviso-legal)/i,
  /\/(404|500|error)/i,
  /\/(login|signin|signup|register|registro)/i,
  /\/(cart|checkout|carrito)/i,
  /\/(sitemap|robots)/i,
  /\/feed\/?$/i,
  /\/(wp-admin|wp-login)/i,
];

/**
 * Punto de entrada principal.
 * @param {Array} pages - Páginas parseadas del crawler (con citability)
 * @param {string} origin - URL origen (ej: "https://celes.ai")
 * @param {Array} mostLinked - Output de buildLinkGraph: [{url, inbound_count}]
 * @param {number} [top=5] - Cuántas LP devolver
 * @returns {Array} - Top N páginas ordenadas con su score y detalles
 */
export function rankLandingPages(pages, origin, mostLinked, top = 5) {
  if (!Array.isArray(pages) || pages.length === 0) return [];

  // Mapa de inbound counts para lookup O(1)
  const inboundMap = new Map();
  for (const entry of mostLinked || []) {
    inboundMap.set(normalizeForCompare(entry.url), entry.inbound_count || 0);
  }

  const homeUrls = new Set([
    origin,
    `${origin}/`,
    normalizeForCompare(origin),
  ]);

  const candidates = pages
    .filter((p) => p.ok)
    .filter((p) => !homeUrls.has(normalizeForCompare(p.url)))
    .filter((p) => !isExcluded(p.url))
    .map((p) => {
      const pageType = inferPageType(p.url);
      const depth = pathDepth(p.url);
      const inbound = inboundMap.get(normalizeForCompare(p.url)) || 0;
      const wordCount = p.word_count || 0;
      const citability = p.citability?.score || 0;

      const score = computeScore({ pageType, depth, inbound, wordCount, citability });

      return {
        url: p.url,
        title: p.title?.value || '(sin title)',
        page_type: pageType,
        depth,
        inbound_count: inbound,
        word_count: wordCount,
        citability_score: citability,
        rank_score: score,
        // Datos completos para el mini-dashboard
        _full: p,
      };
    })
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, top);

  return candidates;
}

/**
 * Construye el mini-dashboard de una landing page individual.
 * Calcula mini-scores SEO y AEO, y devuelve los top 3 issues específicos.
 *
 * @param {Object} ranked - Entry del array de rankLandingPages (con _full)
 * @returns {Object} - Mini-dashboard sin la página raw
 */
export function buildLandingDashboard(ranked) {
  const p = ranked._full;
  if (!p) return null;

  // Mini SEO score (sobre los checks de la página, no del sitio entero)
  const seoChecks = [
    p.title?.ok,
    p.meta?.ok,
    p.headings?.h1_count === 1,
    p.canonical?.ok,
    p.open_graph?.ok,
    p.images?.ok,
    !!(p.headings?.h2_count > 0),
  ].filter(Boolean).length;
  const miniSeo = Math.round((seoChecks / 7) * 100);

  // Mini AEO: usa citability si existe, fallback a checks de schema
  const miniAeo = p.citability?.score != null
    ? p.citability.score
    : Math.round(([
        p.schema?.has_schema,
        p.schema?.has_article || p.schema?.has_organization,
        p.schema?.has_faq,
        p.schema?.has_breadcrumb,
      ].filter(Boolean).length / 4) * 100);

  // Issues específicos de esta página (top 3)
  const issues = [];
  if (!p.title?.ok) {
    issues.push({
      p: 'high',
      t: 'Title fuera de rango',
      d: `Actual: ${p.title?.length || 0} chars. Objetivo: 30-60.`,
      cat: 'SEO',
    });
  }
  if (!p.meta?.ok) {
    issues.push({
      p: 'high',
      t: 'Meta description fuera de rango',
      d: `Actual: ${p.meta?.length || 0} chars. Objetivo: 120-160.`,
      cat: 'SEO',
    });
  }
  if (p.headings?.h1_count !== 1) {
    issues.push({
      p: 'high',
      t: `H1 incorrecto (${p.headings?.h1_count || 0})`,
      d: 'Cada página debe tener exactamente un H1.',
      cat: 'SEO',
    });
  }
  if (!p.schema?.has_schema && !p.schema?.count) {
    issues.push({
      p: 'high',
      t: 'Sin schema markup',
      d: 'Esta página no expone JSON-LD. LLMs no la entienden bien.',
      cat: 'AEO',
    });
  }
  if (!p.canonical?.ok) {
    issues.push({
      p: 'med',
      t: 'Sin canonical',
      d: 'Sin tag canonical, riesgo de contenido duplicado.',
      cat: 'SEO',
    });
  }
  if (!p.open_graph?.ok) {
    issues.push({
      p: 'med',
      t: 'Open Graph incompleto',
      d: 'Faltan tags og:title/og:description/og:image para compartir bien en redes.',
      cat: 'Social',
    });
  }
  if ((p.images?.without_alt || 0) > 0) {
    issues.push({
      p: 'low',
      t: `${p.images.without_alt} imágenes sin alt`,
      d: 'Mal para SEO y accesibilidad.',
      cat: 'SEO',
    });
  }
  if ((p.word_count || 0) < 300) {
    issues.push({
      p: 'med',
      t: `Thin content (${p.word_count || 0} palabras)`,
      d: 'Páginas con poco texto rinden mal en SEO y AEO. Objetivo mínimo: 300.',
      cat: 'SEO',
    });
  }
  // Gap principal de citability si existe
  if (p.citability?.gaps?.[0]) {
    const g = p.citability.gaps[0];
    issues.push({
      p: g.priority || 'med',
      t: g.message,
      d: g.fix || '',
      cat: 'AEO',
    });
  }

  const prioOrder = { high: 0, med: 1, low: 2 };
  issues.sort((a, b) => prioOrder[a.p] - prioOrder[b.p]);

  return {
    url: ranked.url,
    title: ranked.title,
    page_type: ranked.page_type,
    rank_score: ranked.rank_score,
    inbound_count: ranked.inbound_count,
    word_count: ranked.word_count,
    mini_seo_score: miniSeo,
    mini_aeo_score: miniAeo,
    citability_score: ranked.citability_score,
    schema_types: p.schema?.types || [],
    has_canonical: !!p.canonical?.ok,
    has_h1: p.headings?.h1_count === 1,
    top_issues: issues.slice(0, 3),
    issue_count: issues.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferPageType(url) {
  const u = url.toLowerCase();
  if (/\/(pricing|precios|planes|tarifas)/.test(u)) return 'pricing';
  if (/\/(servicios?|services?|soluciones?|solutions?)/.test(u)) return 'service';
  if (/\/(productos?|products?|features?|funcionalidades?)/.test(u)) return 'product';
  if (/\/(casos?|case-stud(y|ies)|clientes?|customers?|portfolio)/.test(u)) return 'case_study';
  if (/\/(about|sobre|nosotros|empresa|equipo|team|company)/.test(u)) return 'about';
  if (/\/(contact|contacto|hire|contrata)/.test(u)) return 'contact';
  if (/\/(blog|noticias|news|articles?|posts?|recursos|resources)/.test(u)) return 'blog_post';
  return 'other';
}

function pathDepth(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

function isExcluded(url) {
  return EXCLUDE_PATTERNS.some((re) => re.test(url));
}

function normalizeForCompare(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    // Quitar trailing slash para comparación
    let s = u.href;
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

function computeScore({ pageType, depth, inbound, wordCount, citability }) {
  let score = 0;

  // Tipo de página (peso 0-100)
  score += TYPE_WEIGHTS[pageType] || TYPE_WEIGHTS.other;

  // Inbound links (cap a 30 puntos: ~3 puntos por link, max 10)
  score += Math.min(30, inbound * 3);

  // Profundidad (penaliza páginas muy profundas)
  // depth 1 → +20, depth 2 → +10, depth 3 → 0, depth 4+ → -10
  if (depth === 1) score += 20;
  else if (depth === 2) score += 10;
  else if (depth >= 4) score -= 10;

  // Word count razonable (señal de contenido real)
  if (wordCount >= 300 && wordCount <= 3000) score += 15;
  else if (wordCount > 3000) score += 10;
  else if (wordCount < 100) score -= 15; // thin content fuerte

  // Citability: bonus pequeño si la página ya es citable
  if (citability >= 60) score += 10;
  else if (citability >= 40) score += 5;

  return score;
}
