/**
 * Crawler que descubre URLs y las parsea concurrentemente.
 *
 * Estrategia:
 *   1. Intenta sitemap.xml (puede tener sub-sitemaps en index)
 *   2. Si falla o trae pocas URLs, hace crawl recursivo desde la home
 *   3. Filtra al mismo dominio, deduplica, cap configurable
 *   4. Fetch en paralelo con limite de concurrencia
 *   5. Parsea cada página con parsePage()
 */

import { parsePage } from './parsePage.js';

const DEFAULTS = {
  maxUrls: 100,
  concurrency: 8,
  timeoutPerUrl: 10000, // 10s
  userAgent: 'Mozilla/5.0 (compatible; AgenciaBot/1.0; +https://agencia.ai/bot)',
  crawlDepth: 2,
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

  // 1. Descubrir URLs
  const discovery = await discoverUrls(startUrl, cfg, log);
  const urls = discovery.urls.slice(0, cfg.maxUrls);
  log.push(`📋 ${urls.length} URLs a analizar (de ${discovery.urls.length} descubiertas, fuente: ${discovery.source})`);

  // 2. Fetch + parse concurrente
  const pages = await fetchAndParseAll(urls, cfg, log);

  // 3. Análisis agregado del sitio
  const analysis = aggregate(pages, origin);

  return {
    site: origin,
    discovery: {
      source: discovery.source,
      total_discovered: discovery.urls.length,
      analyzed: urls.length,
      truncated: discovery.urls.length > cfg.maxUrls,
    },
    pages,
    analysis,
    duration_ms: Date.now() - t0,
    log,
  };
}

// ─── Descubrimiento de URLs ──────────────────────────────────────────────────

async function discoverUrls(startUrl, cfg, log) {
  const origin = new URL(startUrl).origin;

  // Intento 1: sitemap.xml
  const sitemapUrls = await fetchSitemap(`${origin}/sitemap.xml`, cfg, log);
  if (sitemapUrls.length >= 3) {
    return { source: 'sitemap', urls: dedupe(sitemapUrls) };
  }

  // Intento 2: sitemap_index.xml
  const indexUrls = await fetchSitemap(`${origin}/sitemap_index.xml`, cfg, log);
  if (indexUrls.length >= 3) {
    return { source: 'sitemap_index', urls: dedupe(indexUrls) };
  }

  // Fallback: crawl desde la home
  log.push(`⚠️ Sitemap insuficiente, haciendo crawl desde home`);
  const crawled = await crawlFromHome(startUrl, cfg, log);
  return { source: 'crawl', urls: dedupe(crawled) };
}

async function fetchSitemap(sitemapUrl, cfg, log, depth = 0) {
  if (depth > 2) return []; // Evitar loops infinitos en sitemap index

  try {
    const xml = await fetchText(sitemapUrl, cfg);
    if (!xml) return [];

    log.push(`   📄 ${sitemapUrl} OK`);

    // ¿Es un sitemap index? (contiene <sitemap> children)
    if (/<sitemap>/i.test(xml)) {
      const childSitemaps = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
      log.push(`   📚 Sitemap index con ${childSitemaps.length} sub-sitemaps`);
      const all = [];
      for (const child of childSitemaps.slice(0, 10)) {
        // Limitar a 10 sub-sitemaps
        const sub = await fetchSitemap(child, cfg, log, depth + 1);
        all.push(...sub);
        if (all.length >= cfg.maxUrls * 2) break; // Suficiente
      }
      return all;
    }

    // Sitemap normal
    const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
    return urls;
  } catch (e) {
    log.push(`   ❌ Sitemap ${sitemapUrl}: ${e.message}`);
    return [];
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
    if (!ct.includes('html')) {
      return { url, ok: false, status: res.status, error: 'not_html', content_type: ct, fetch_ms: Date.now() - t0 };
    }

    const html = await res.text();
    const parsed = parsePage(html, url);

    return {
      url,
      final_url: res.url, // por si hubo redirects
      ok: res.ok,
      status: res.status,
      redirected: res.url !== url,
      fetch_ms: Date.now() - t0,
      ...parsed,
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

  const noCanonical = ok.filter((p) => !p.canonical?.value);
  const noSchema = ok.filter((p) => p.schema?.count === 0);

  const totalImages = ok.reduce((s, p) => s + (p.images?.total || 0), 0);
  const totalImagesWithoutAlt = ok.reduce((s, p) => s + (p.images?.without_alt || 0), 0);

  // Internal linking graph
  const linkGraph = buildLinkGraph(ok, origin);

  // Broken links (internos): URLs que aparecen como link pero devolvieron error
  const brokenInternal = findBrokenInternal(pages);

  return {
    summary: {
      pages_analyzed: pages.length,
      pages_ok: ok.length,
      pages_failed: failed.length,
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
      missing_canonical: noCanonical.length,
      missing_schema: noSchema.length,
      images_without_alt: totalImagesWithoutAlt,
      images_total: totalImages,
      broken_internal_links: brokenInternal.length,
    },
    samples: {
      // Top 5 ejemplos de cada problema, para que dev sepa dónde ir
      missing_title: missingTitle.slice(0, 5).map((p) => p.url),
      duplicate_titles: duplicateTitles.slice(0, 5),
      no_h1: noH1.slice(0, 5).map((p) => p.url),
      multiple_h1: multipleH1.slice(0, 5).map((p) => ({ url: p.url, h1_count: p.headings.h1_count })),
      missing_meta: missingMeta.slice(0, 5).map((p) => p.url),
      missing_canonical: noCanonical.slice(0, 5).map((p) => p.url),
      missing_schema: noSchema.slice(0, 5).map((p) => p.url),
      broken_internal: brokenInternal.slice(0, 10),
      orphan_pages: linkGraph.orphans.slice(0, 5),
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
  const inboundCount = new Map(); // URL → cuántas páginas internas la enlazan
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
  // URLs con status >= 400 o error de fetch
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
