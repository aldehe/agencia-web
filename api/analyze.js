export const config = { runtime: 'edge' };

import { filterPagespeed } from '../lib/filterPagespeed.js';

// Timeouts: total Edge = 25s, dejamos margen.
const PAGESPEED_TIMEOUT_MS = 10000;   // 10s por strategy (mobile/desktop)
const HTML_FETCH_TIMEOUT_MS = 8000;
const ROBOTS_TIMEOUT_MS = 4000;

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return jsonResponse({ error: 'URL requerida' }, 400);
  }

  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  let originUrl;
  try {
    originUrl = new URL(targetUrl).origin;
  } catch {
    return jsonResponse({ error: 'URL inválida' }, 400);
  }

  const startTime = Date.now();

  const results = {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    pagespeed: null,
    html_analysis: null,
    robots: null,
    sitemap: null,
    llms_txt: null,
    errors: [],
    duration_ms: 0,
  };

  // ─────────────────────────────────────────────────────────────────
  // 1. PAGESPEED (mobile + desktop con timeout duro)
  // ─────────────────────────────────────────────────────────────────
  const psBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const cats = 'category=performance&category=accessibility&category=best-practices&category=seo';
  const apiKey = ''; // Sin API key (cuota gratuita anónima ~ 25k/día)

  const psMobileUrl = `${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=mobile&${cats}${apiKey}`;
  const psDesktopUrl = `${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=desktop&${cats}${apiKey}`;

  // Lanzamos las 4 tareas en paralelo (PageSpeed mobile + desktop + HTML + robots)
  // Cada una con su propio timeout. Si PageSpeed tarda demasiado, el resto sigue.
  const [psMobRes, psDeskRes, htmlRes, robotsRes, sitemapRes, llmsRes] = await Promise.allSettled([
    fetchWithTimeout(psMobileUrl, PAGESPEED_TIMEOUT_MS).then(r => r.json()),
    fetchWithTimeout(psDesktopUrl, PAGESPEED_TIMEOUT_MS).then(r => r.json()),
    fetchHtml(targetUrl, HTML_FETCH_TIMEOUT_MS),
    fetchText(originUrl + '/robots.txt', ROBOTS_TIMEOUT_MS),
    fetchText(originUrl + '/sitemap.xml', ROBOTS_TIMEOUT_MS),
    fetchText(originUrl + '/llms.txt', ROBOTS_TIMEOUT_MS),
  ]);

  // ─── Procesar PageSpeed ───
  let rawMobile = null;
  let rawDesktop = null;

  if (psMobRes.status === 'fulfilled' && !psMobRes.value?.error) {
    rawMobile = psMobRes.value;
  } else {
    results.errors.push('PageSpeed mobile: ' + (psMobRes.reason?.message || psMobRes.value?.error?.message || 'timeout'));
  }

  if (psDeskRes.status === 'fulfilled' && !psDeskRes.value?.error) {
    rawDesktop = psDeskRes.value;
  } else {
    results.errors.push('PageSpeed desktop: ' + (psDeskRes.reason?.message || psDeskRes.value?.error?.message || 'timeout'));
  }

  // Aplicar filtro (devuelve null si ambos fallaron)
  if (rawMobile || rawDesktop) {
    try {
      results.pagespeed = filterPagespeed(rawMobile, rawDesktop, { url: targetUrl });
    } catch (e) {
      results.errors.push('Filter pagespeed: ' + e.message);
    }
  }

  // ─── Procesar HTML ───
  let html = null;
  if (htmlRes.status === 'fulfilled' && htmlRes.value) {
    html = htmlRes.value;
    results.html_analysis = analyzeHtml(html, targetUrl);
  } else {
    results.errors.push('HTML fetch: ' + (htmlRes.reason?.message || 'failed'));
  }

  // ─── Procesar robots.txt ───
  results.robots = processRobotsTxt(robotsRes);

  // ─── Procesar sitemap.xml ───
  results.sitemap = processSitemap(sitemapRes);

  // ─── Procesar llms.txt ───
  results.llms_txt = processLlmsTxt(llmsRes);

  results.duration_ms = Date.now() - startTime;

  return jsonResponse(results, 200);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgenciaBot/1.0)' },
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fetchHtml(url, timeoutMs) {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function fetchText(url, timeoutMs) {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) return { exists: false, status: res.status };
    const text = await res.text();
    return { exists: true, status: res.status, content: text };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

// ─── HTML ANALYSIS ───
function analyzeHtml(html, url) {
  if (!html) return null;

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : null;

  const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;

  // Headings
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => stripTags(m[1]).trim()).filter(Boolean);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => stripTags(m[1]).trim()).filter(Boolean);
  const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => stripTags(m[1]).trim()).filter(Boolean);

  // Hreflang
  const hreflangs = [...html.matchAll(/<link[^>]+hreflang=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);

  // Open Graph
  const ogTitle = (html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i) || [])[1] || null;
  const ogDesc = (html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i) || [])[1] || null;
  const ogImage = (html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i) || [])[1] || null;
  const ogType = (html.match(/<meta\s+property=["']og:type["']\s+content=["']([^"']*)["']/i) || [])[1] || null;

  // Twitter Card
  const twitterCard = (html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']*)["']/i) || [])[1] || null;

  // Schema JSON-LD
  const schemas = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const schemaTypes = [];
  let hasOrg = false, hasArticle = false, hasFaq = false, hasBreadcrumb = false, hasLocal = false, hasWebsite = false, hasProduct = false, hasHowto = false;

  for (const m of schemas) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const it of items) {
        const t = it['@type'];
        if (!t) continue;
        const types = Array.isArray(t) ? t : [t];
        for (const tt of types) {
          if (!schemaTypes.includes(tt)) schemaTypes.push(tt);
          if (tt === 'Organization') hasOrg = true;
          if (tt === 'WebSite') hasWebsite = true;
          if (tt === 'Article' || tt === 'BlogPosting' || tt === 'NewsArticle') hasArticle = true;
          if (tt === 'FAQPage') hasFaq = true;
          if (tt === 'BreadcrumbList') hasBreadcrumb = true;
          if (tt === 'LocalBusiness') hasLocal = true;
          if (tt === 'Product') hasProduct = true;
          if (tt === 'HowTo') hasHowto = true;
        }
      }
    } catch (e) { /* skip invalid JSON-LD */ }
  }

  // Imágenes
  const imgs = [...html.matchAll(/<img\s[^>]*>/gi)];
  const imgsWithoutAlt = imgs.filter(m => !/\salt\s*=/i.test(m[0])).length;

  // Links
  const links = [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)].map(m => m[1]);
  let internalLinks = 0, externalLinks = 0;
  try {
    const origin = new URL(url).origin;
    for (const l of links) {
      if (!l || l.startsWith('#') || l.startsWith('mailto:') || l.startsWith('tel:') || l.startsWith('javascript:')) continue;
      try {
        const abs = new URL(l, url);
        if (abs.origin === origin) internalLinks++;
        else externalLinks++;
      } catch {}
    }
  } catch {}

  // Technical
  const hasViewport = /<meta\s+name=["']viewport["']/i.test(html);
  const hasCharset = /<meta\s+charset=/i.test(html);
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const lang = langMatch ? langMatch[1] : null;
  const robotsMetaMatch = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  const robotsMeta = robotsMetaMatch ? robotsMetaMatch[1] : null;
  const isHttps = url.startsWith('https://');

  return {
    title: {
      value: title,
      length: title ? title.length : 0,
      ok: !!title && title.length >= 10 && title.length <= 70,
    },
    meta_description: {
      value: metaDesc,
      length: metaDesc ? metaDesc.length : 0,
      ok: !!metaDesc && metaDesc.length >= 50 && metaDesc.length <= 165,
    },
    canonical: {
      value: canonical,
      ok: !!canonical,
    },
    headings: {
      h1: h1s,
      h2: h2s,
      h3: h3s,
      h1_count: h1s.length,
      h2_count: h2s.length,
      h3_count: h3s.length,
      ok: h1s.length === 1,
    },
    hreflang: {
      values: hreflangs,
      count: hreflangs.length,
      ok: hreflangs.length >= 1,
    },
    open_graph: {
      title: ogTitle,
      description: ogDesc,
      image: ogImage,
      type: ogType,
      ok: !!(ogTitle && ogDesc && ogImage),
    },
    twitter_card: { value: twitterCard, ok: !!twitterCard },
    schema: {
      count: schemas.length,
      types: schemaTypes,
      has_schema: schemas.length > 0,
      has_organization: hasOrg,
      has_website: hasWebsite,
      has_article: hasArticle,
      has_product: hasProduct,
      has_faq: hasFaq,
      has_howto: hasHowto,
      has_breadcrumb: hasBreadcrumb,
      has_local_business: hasLocal,
    },
    images: {
      total: imgs.length,
      without_alt: imgsWithoutAlt,
      ok: imgs.length > 0 && imgsWithoutAlt === 0,
    },
    links: {
      internal: internalLinks,
      external: externalLinks,
      total: internalLinks + externalLinks,
    },
    technical: {
      https: isHttps,
      has_viewport: hasViewport,
      has_charset: hasCharset,
      lang,
      robots_meta: robotsMeta,
    },
    html_length: html.length,
  };
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function processRobotsTxt(res) {
  if (res.status !== 'fulfilled' || !res.value?.exists) {
    return { exists: false };
  }
  const content = res.value.content || '';
  const sitemapMatch = content.match(/sitemap:\s*(\S+)/i);
  return {
    exists: true,
    has_sitemap: !!sitemapMatch,
    sitemap_url: sitemapMatch ? sitemapMatch[1] : null,
    length: content.length,
  };
}

function processSitemap(res) {
  if (res.status !== 'fulfilled' || !res.value?.exists) {
    return { exists: false };
  }
  const content = res.value.content || '';
  const urlMatches = [...content.matchAll(/<loc>([^<]+)<\/loc>/gi)];
  return {
    exists: true,
    url_count: urlMatches.length,
    sample: urlMatches.slice(0, 5).map(m => m[1]),
  };
}

function processLlmsTxt(res) {
  if (res.status !== 'fulfilled' || !res.value?.exists) {
    return { exists: false };
  }
  return {
    exists: true,
    length: (res.value.content || '').length,
    content: res.value.content,
  };
}
