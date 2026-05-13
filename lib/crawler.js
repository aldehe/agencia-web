/**
 * Crawler que descubre URLs y las parsea concurrentemente.
 *
 * Estrategia:
 *   1. Intenta sitemap.xml (puede tener sub-sitemaps en index)
 *   2. Si falla o trae pocas URLs, hace crawl recursivo desde la home
 *   3. Filtra al mismo dominio, deduplica, cap configurable
 *   4. Fetch en paralelo con limite de concurrencia
 *   5. Parsea cada página con parsePage()
 *   6. Rankea para elegir Top 5 Landing Pages (Sesión #6)
 *   7. Mide calidad del sitemap (lastmod, priority, status real) (Sesión #6)
 */

import { parsePage } from './parsePage.js';
import { analyzeCitability } from './citabilityScore.js';
import { generateLlmsTxt } from './generateLlmsTxt.js';
import { rankLandingPages, buildLandingDashboard } from './rankPages.js';

const DEFAULTS = {
  maxUrls: 100,
  concurrency: 8,
  timeoutPerUrl: 10000, // 10s
  userAgent: 'Mozilla/5.0 (compatible; AgenciaBot/1.0; +https://agencia.ai/bot)',
  crawlDepth: 2,
  topLandingCount: 5,
};

/**
 * Punto de entrada principal.
 * @param {string} startUrl - URL del sitio a crawlear
 * @param {Object} [opts]
 * @returns {Promise<Object>} Resultado completo del crawl
 */
export async function crawlSite(startUrl, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const origin = new URL(startUrl).origin;
  const log = [];
  const t0 = Date.now();

  log.push(`🚀 Crawl iniciado: ${origin}`);

  // 1. Descubrir URLs (devuelve también metadatos del sitemap si lo hay)
  const discovery = await discoverUrls(startUrl, cfg, log);
  const urls = discovery.urls.slice(0, cfg.maxUrls);
  log.push(`📋 ${urls.length} URLs a analizar (de ${discovery.urls.length} descubiertas, fuente: ${discovery.source})`);

  // 2. Fetch + parse concurrente
  const pages = await fetchAndParseAll(urls, cfg, log);

  // 3. Análisis agregado del sitio
  const analysis = aggregate(pages, origin);

  // 4. Generador de llms.txt sugerido
  const homePage = pages.find((p) => p.url === startUrl || p.url === origin || p.url === origin + '/') || pages[0];
  const orgSchema = homePage?.schema?.types?.includes('Organization')
    ? { name: homePage.title?.value, description: homePage.meta?.value }
    : null;

  let llmsTxt = null;
  try {
    llmsTxt = generateLlmsTxt({
      siteUrl: origin,
      homePage,
      allPages: pages.filter((p) => p.ok),
      organizationSchema: orgSchema,
    });
    log.push(`📝 llms.txt generado (${llmsTxt.stats.total_pages_categorized} páginas categorizadas)`);
  } catch (e) {
    log.push(`⚠️ Error generando llms.txt: ${e.message}`);
  }

  // 5. Top Landing Pages (NUEVO Sesión #6)
  let topLandingPages = [];
  try {
    const ranked = rankLandingPages(
      pages,
      origin,
      analysis.link_graph?.most_linked_pages || [],
      cfg.topLandingCount
    );
    topLandingPages = ranked.map(buildLandingDashboard).filter(Boolean);
    log.push(`🎯 Top ${topLandingPages.length} landing pages identificadas`);
  } catch (e) {
    log.push(`⚠️ Error rankeando LPs: ${e.message}`);
  }

  // 6. Calidad del sitemap (NUEVO Sesión #6)
  const sitemapQuality = discovery.sitemapMeta
    ? buildSitemapQuality(discovery.sitemapMeta, pages, origin)
    : null;

  return {
    site: origin,
    discovery: {
      source: discovery.source,
      total_discovered: discovery.urls.length,
      analyzed: urls.length,
      truncated: discovery.urls.length > cfg.maxUrls,
    },
    sitemap_quality: sitemapQuality,
    pages,
    analysis,
    top_landing_pages: topLandingPages,
    llms_txt_suggested: llmsTxt,
    duration_ms: Date.now() - t0,
    log,
  };
}

// ─── Descubrimiento de URLs ──────────────────────────────────────────────────

async function discoverUrls(startUrl, cfg, log) {
  const origin = new URL(startUrl).origin;

  // Intento 1: sitemap.xml
  const sitemapResult = await fetchSitemapWithMeta(`${origin}/sitemap.xml`, cfg, log);
  if (sitemapResult.urls.length >= 3) {
    return {
      source: 'sitemap',
      urls: dedupe(sitemapResult.urls),
      sitemapMeta: sitemapResult,
    };
  }

  // Intento 2: sitemap_index.xml
  const indexResult = await fetchSitemapWithMeta(`${origin}/sitemap_index.xml`, cfg, log);
  if (indexResult.urls.length >= 3) {
    return {
      source: 'sitemap_index',
      urls: dedupe(indexResult.urls),
      sitemapMeta: indexResult,
    };
  }

  // Fallback: crawl desde la home
  log.push(`⚠️ Sitemap insuficiente, haciendo crawl desde home`);
  const crawled = await crawlFromHome(startUrl, cfg, log);
  return { source: 'crawl', urls: dedupe(crawled), sitemapMeta: null };
}

/**
 * Lee un sitemap y devuelve urls + metadatos (lastmod, priority, changefreq).
 * Estos metadatos los usamos para calcular la "calidad" del sitemap.
 */
async function fetchSitemapWithMeta(sitemapUrl, cfg, log, depth = 0) {
  const result = { urls: [], entries: [], indexes: 0 };
  if (depth > 2) return result;

  try {
    const xml = await fetchText(sitemapUrl, cfg);
    if (!xml) return result;

    log.push(`   📄 ${sitemapUrl} OK`);

    // ¿Es un sitemap index?
    if (/<sitemap>/i.test(xml)) {
      const childSitemaps = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
      log.push(`   📚 Sitemap index con ${childSitemaps.length} sub-sitemaps`);
      result.indexes = childSitemaps.length;
      for (const child of childSitemaps.slice(0, 10)) {
        const sub = await fetchSitemapWithMeta(child, cfg, log, depth + 1);
        result.urls.push(...sub.urls);
        result.entries.push(...sub.entries);
        if (result.urls.length >= cfg.maxUrls * 2) break;
      }
      return result;
    }

    // Sitemap normal: extraer urls + lastmod + priority + changefreq
    const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
    for (const block of urlBlocks) {
      const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i);
      if (!loc) continue;
      const url = loc[1].trim();
      const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i);
      const priority = block.match(/<priority>\s*([^<]+?)\s*<\/priority>/i);
      const changefreq = block.match(/<changefreq>\s*([^<]+?)\s*<\/changefreq>/i);
      result.urls.push(url);
      result.entries.push({
        url,
        lastmod: lastmod ? lastmod[1].trim() : null,
        priority: priority ? parseFloat(priority[1]) : null,
        changefreq: changefreq ? changefreq[1].trim() : null,
      });
    }

    // Por si hay <loc> sueltos (sitemaps sin envolver en <url>)
    if (result.urls.length === 0) {
      const loose = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
      result.urls.push(...loose);
    }

    return result;
  } catch (e) {
    log.push(`   ❌ Sitemap ${sitemapUrl}: ${e.message}`);
    return result;
  }
}

async function crawlFromHome(startUrl, cfg, log) {
  const origin = new URL(startUrl).origin;
  const visited = new Set();
  const queue = [{ url: startUrl, depth: 0 }];
  const found = new Set([startUrl]);

  while (queue.length > 0 && found.size < cfg.maxUrls) {
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > cfg.crawlDepth) continue;
    visited.add(url);

    try {
      const html = await fetchText(url, cfg);
      if (!html) continue;

      const linkRe = /<a[^>]+href=["']([^"']+)["']/gi;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        const resolved = resolveSafe(m[1], url);
        if (!resolved) continue;
        try {
          const u = new URL(resolved);
          if (u.origin !== origin) continue;
          // Limpiar fragmentos y parámetros volátiles para deduplicar mejor
          u.hash = '';
          const clean = u.href;
          if (!found.has(clean) && !isAsset(clean)) {
            found.add(clean);
            queue.push({ url: clean, depth: depth + 1 });
          }
        } catch {}
      }
    } catch (e) {
      log.push(`   ❌ Crawl ${url}: ${e.message}`);
    }
  }

  return [...found];
}

// ─── Fetch + Parse concurrente ───────────────────────────────────────────────

async function fetchAndParseAll(urls, cfg, log) {
  const results = [];
  const queue = [...urls];

  // Pool de workers que consumen la cola
  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;
      const result = await fetchAndParseOne(url, cfg);
      results.push(result);
    }
  }

  const workers = Array.from({ length: cfg.concurrency }, () => worker());
  await Promise.all(workers);

  log.push(`✅ ${results.filter((r) => r.ok).length}/${results.length} páginas analizadas`);
  return results;
}

async function fetchAndParseOne(url, cfg) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutPerUrl);

    const res = await fetch(url, {
      headers: { 'User-Agent': cfg.userAgent },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const ct = res.headers.get('content-type') || '';
    const contentLength = parseInt(res.headers.get('content-length')) || null;

    // URL params analysis (detección de URLs problemáticas)
    const urlParams = analyzeUrlParams(url);

    if (!ct.includes('html')) {
      return {
        url, ok: false, status: res.status,
        error: 'not_html', content_type: ct,
        fetch_ms: Date.now() - t0,
        size_bytes: contentLength,
        url_params: urlParams,
      };
    }

    const html = await res.text();
    const parsed = parsePage(html, url);

    // AEO Citability Score
    const citability = analyzeCitability(html, parsed);

    return {
      url,
      final_url: res.url,
      ok: res.ok,
      status: res.status,
      redirected: res.url !== url,
      fetch_ms: Date.now() - t0,
      size_bytes: contentLength || html.length,
      content_type: ct,
      url_params: urlParams,
      ...parsed,
      citability,
    };
  } catch (e) {
    return {
      url,
      ok: false,
      error: e.name === 'AbortError' ? 'timeout' : e.message,
      fetch_ms: Date.now() - t0,
    };
  }
}

/**
 * Analiza la URL: parámetros, query strings problemáticos, fragmentos.
 */
function analyzeUrlParams(url) {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.keys()];
    const trackingParams = params.filter((p) =>
      /^(utm_|gclid|fbclid|mc_|_ga|sessionid|sid|ref)/i.test(p)
    );
    return {
      has_params: params.length > 0,
      param_count: params.length,
      params,
      tracking_params: trackingParams,
      has_fragment: !!u.hash,
      depth: u.pathname.split('/').filter(Boolean).length,
    };
  } catch {
    return null;
  }
}

// ─── Calidad del sitemap (NUEVO Sesión #6) ──────────────────────────────────

/**
 * Mide la calidad real del sitemap.xml. Va más allá de "existe":
 *   - % de URLs con lastmod
 *   - % de URLs con priority
 *   - % de URLs analizadas que respondieron 200
 *   - presencia de URLs huérfanas (en sitemap pero sin inbound links)
 *   - score 0-100 con problemas detectados
 */
function buildSitemapQuality(meta, pages, origin) {
  const entries = meta.entries || [];
  const totalEntries = entries.length;
  if (totalEntries === 0) {
    return {
      score: 0,
      total_entries: 0,
      problems: ['Sitemap sin URLs procesables'],
    };
  }

  const withLastmod = entries.filter((e) => e.lastmod).length;
  const withPriority = entries.filter((e) => e.priority != null).length;
  const withChangefreq = entries.filter((e) => e.changefreq).length;

  // Crear mapa rápido de status por URL para las páginas que sí crawleamos
  const statusByUrl = new Map();
  for (const p of pages) {
    statusByUrl.set(normalizeForCompare(p.url), { ok: p.ok, status: p.status });
  }

  let entriesChecked = 0;
  let entriesOk = 0;
  for (const e of entries) {
    const found = statusByUrl.get(normalizeForCompare(e.url));
    if (found) {
      entriesChecked++;
      if (found.ok) entriesOk++;
    }
  }

  const pctLastmod = Math.round((withLastmod / totalEntries) * 100);
  const pctPriority = Math.round((withPriority / totalEntries) * 100);
  const pctOk = entriesChecked > 0 ? Math.round((entriesOk / entriesChecked) * 100) : null;

  // Score: ponderado
  let score = 0;
  score += pctLastmod * 0.4;       // 40% peso a lastmod (lo más útil para LLMs)
  score += pctPriority * 0.2;      // 20% peso a priority
  score += (pctOk ?? 50) * 0.3;    // 30% peso a URLs que responden bien
  score += withChangefreq > 0 ? 10 : 0; // 10% bonus si hay changefreq

  const problems = [];
  if (pctLastmod < 50) problems.push(`Solo ${pctLastmod}% de URLs tienen <lastmod>`);
  if (pctPriority === 0) problems.push('Ninguna URL declara <priority>');
  if (pctOk != null && pctOk < 90) problems.push(`${100 - pctOk}% de URLs del sitemap fallan o redirigen`);
  if (meta.indexes > 0) problems.push(`Sitemap index con ${meta.indexes} sub-sitemaps`);

  return {
    score: Math.min(100, Math.round(score)),
    total_entries: totalEntries,
    with_lastmod: withLastmod,
    with_priority: withPriority,
    with_changefreq: withChangefreq,
    pct_lastmod: pctLastmod,
    pct_priority: pctPriority,
    pct_ok_responses: pctOk,
    is_index: meta.indexes > 0,
    sub_sitemaps: meta.indexes || 0,
    problems,
  };
}

// ─── Análisis agregado del sitio completo ────────────────────────────────────

function aggregate(pages, origin) {
  const ok = pages.filter((p) => p.ok);
  const failed = pages.filter((p) => !p.ok);

  // Issues comunes
  const missingTitle = ok.filter((p) => !p.title?.value);
  const titleTooShort = ok.filter((p) => p.title?.value && p.title.length < 30);
  const titleTooLong = ok.filter((p) => p.title?.length > 60);
  const duplicateTitles = findDuplicates(ok, (p) => p.title?.value);

  const missingMeta = ok.filter((p) => !p.meta?.value);
  const metaTooShort = ok.filter((p) => p.meta?.value && p.meta.length < 120);
  const metaTooLong = ok.filter((p) => p.meta?.length > 160);
  const duplicateMetas = findDuplicates(ok, (p) => p.meta?.value);

  const noH1 = ok.filter((p) => p.headings?.h1_count === 0);
  const multipleH1 = ok.filter((p) => p.headings?.h1_count > 1);
  // NUEVO Sesión #6: H1 duplicados literales entre páginas
  const duplicateH1 = findDuplicates(ok, (p) => p.headings?.h1?.[0]);

  const noCanonical = ok.filter((p) => !p.canonical?.value);
  const noSchema = ok.filter((p) => p.schema?.count === 0);

  // NUEVO Sesión #6: thin content (páginas <300 palabras)
  const thinContent = ok.filter((p) => (p.word_count || 0) < 300 && (p.word_count || 0) > 0);

  const totalImages = ok.reduce((s, p) => s + (p.images?.total || 0), 0);
  const totalImagesWithoutAlt = ok.reduce((s, p) => s + (p.images?.without_alt || 0), 0);

  // Internal linking graph
  const linkGraph = buildLinkGraph(ok, origin);

  // Broken links (internos): URLs que aparecen como link pero devolvieron error
  const brokenInternal = findBrokenInternal(pages);

  // Tamaños y redirects
  const totalBytes = ok.reduce((s, p) => s + (p.size_bytes || 0), 0);
  const avgBytes = ok.length > 0 ? Math.round(totalBytes / ok.length) : 0;
  const heavyPages = ok.filter((p) => p.size_bytes && p.size_bytes > 500000); // >500KB
  const redirectedPages = pages.filter((p) => p.redirected);

  // URLs con parámetros problemáticos
  const trackingUrls = pages.filter((p) => p.url_params?.tracking_params?.length > 0);
  const deepUrls = pages.filter((p) => p.url_params?.depth > 4);

  // Status codes
  const statusBreakdown = {};
  for (const p of pages) {
    const s = p.status || 'error';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // AEO Citability promedio
  const citabilityScores = ok.map((p) => p.citability?.score).filter((s) => s != null);
  const avgCitability = citabilityScores.length > 0
    ? Math.round(citabilityScores.reduce((a, b) => a + b, 0) / citabilityScores.length)
    : 0;
  const lowCitabilityPages = ok.filter((p) => p.citability?.score < 40);

  return {
    summary: {
      pages_analyzed: pages.length,
      pages_ok: ok.length,
      pages_failed: failed.length,
      total_bytes: totalBytes,
      avg_bytes_per_page: avgBytes,
      avg_citability_score: avgCitability,
      status_breakdown: statusBreakdown,
    },
    issues: {
      missing_title: missingTitle.length,
      title_too_short: titleTooShort.length,
      title_too_long: titleTooLong.length,
      duplicate_titles: duplicateTitles.length,
      missing_meta_description: missingMeta.length,
      meta_too_short: metaTooShort.length,
      meta_too_long: metaTooLong.length,
      duplicate_metas: duplicateMetas.length,
      no_h1: noH1.length,
      multiple_h1: multipleH1.length,
      duplicate_h1: duplicateH1.length, // NUEVO
      missing_canonical: noCanonical.length,
      missing_schema: noSchema.length,
      thin_content: thinContent.length, // NUEVO
      images_without_alt: totalImagesWithoutAlt,
      images_total: totalImages,
      broken_internal_links: brokenInternal.length,
      heavy_pages: heavyPages.length,
      redirected_pages: redirectedPages.length,
      urls_with_tracking_params: trackingUrls.length,
      deep_urls: deepUrls.length,
      low_citability_pages: lowCitabilityPages.length,
    },
    samples: {
      missing_title: missingTitle.slice(0, 5).map((p) => p.url),
      duplicate_titles: duplicateTitles.slice(0, 5),
      duplicate_h1: duplicateH1.slice(0, 5), // NUEVO
      no_h1: noH1.slice(0, 5).map((p) => p.url),
      multiple_h1: multipleH1.slice(0, 5).map((p) => ({ url: p.url, h1_count: p.headings.h1_count })),
      missing_meta: missingMeta.slice(0, 5).map((p) => p.url),
      missing_canonical: noCanonical.slice(0, 5).map((p) => p.url),
      missing_schema: noSchema.slice(0, 5).map((p) => p.url),
      thin_content: thinContent.slice(0, 5).map((p) => ({ url: p.url, words: p.word_count || 0 })), // NUEVO
      broken_internal: brokenInternal.slice(0, 10),
      orphan_pages: linkGraph.orphans.slice(0, 5),
      heavy_pages: heavyPages.slice(0, 5).map((p) => ({ url: p.url, size_kb: Math.round(p.size_bytes / 1024) })),
      redirected_pages: redirectedPages.slice(0, 5).map((p) => ({ from: p.url, to: p.final_url })),
      tracking_urls: trackingUrls.slice(0, 5).map((p) => ({ url: p.url, params: p.url_params.tracking_params })),
      low_citability: lowCitabilityPages.slice(0, 5).map((p) => ({ url: p.url, score: p.citability.score, top_gap: p.citability.gaps[0]?.message })),
    },
    link_graph: {
      total_internal_links: linkGraph.totalInternal,
      orphan_pages_count: linkGraph.orphans.length,
      most_linked_pages: linkGraph.mostLinked.slice(0, 10),
    },
    schema_types_found: aggregateSchemas(ok),
  };
}

function findDuplicates(pages, getter) {
  const map = new Map();
  for (const p of pages) {
    const k = getter(p);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p.url);
  }
  return [...map.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([value, urls]) => ({ value, urls, count: urls.length }));
}

function buildLinkGraph(pages, origin) {
  const inboundCount = new Map();
  let totalInternal = 0;

  for (const p of pages) {
    if (!p.links?.internal) continue;
    for (const link of p.links.internal) {
      try {
        const u = new URL(link.href);
        u.hash = '';
        const clean = u.href;
        inboundCount.set(clean, (inboundCount.get(clean) || 0) + 1);
        totalInternal++;
      } catch {}
    }
  }

  // Orphan pages: páginas analizadas que NO reciben ningún link interno
  const orphans = pages
    .filter((p) => p.url !== origin && p.url !== `${origin}/` && !inboundCount.has(p.url))
    .map((p) => p.url);

  const mostLinked = [...inboundCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url, count]) => ({ url, inbound_count: count }));

  return { totalInternal, orphans, mostLinked };
}

function findBrokenInternal(pages) {
  return pages
    .filter((p) => !p.ok && (p.status >= 400 || p.error))
    .map((p) => ({ url: p.url, status: p.status || null, error: p.error || null }));
}

function aggregateSchemas(pages) {
  const counts = {};
  for (const p of pages) {
    for (const t of p.schema?.types || []) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchText(url, cfg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutPerUrl);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': cfg.userAgent },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function dedupe(urls) {
  return [...new Set(urls.map((u) => {
    try {
      const url = new URL(u);
      url.hash = '';
      return url.href;
    } catch {
      return u;
    }
  }))];
}

function resolveSafe(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isAsset(url) {
  return /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|pdf|zip|mp4|webm|woff2?|ttf|eot|xml|json)(\?|$)/i.test(url);
}

function normalizeForCompare(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    let s = u.href;
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}
