export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL requerida' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Normalize URL
  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  const results = {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    pagespeed: null,
    html_analysis: null,
    robots: null,
    sitemap: null,
    llms_txt: null,
    errors: []
  };

  try {
    const hostname = new URL(targetUrl).origin;

    // ── 1. PageSpeed API (mobile + desktop) ──────────────────────────
    const psBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const cats = 'category=performance&category=seo&category=accessibility&category=best-practices';

    const [psMobile, psDesktop] = await Promise.allSettled([
      fetch(`${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=mobile&${cats}`).then(r => r.json()),
      fetch(`${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=desktop&${cats}`).then(r => r.json())
    ]);

    results.pagespeed = {
      mobile:  psMobile.status  === 'fulfilled' ? psMobile.value  : null,
      desktop: psDesktop.status === 'fulfilled' ? psDesktop.value : null
    };

    // ── 2. Fetch HTML ─────────────────────────────────────────────────
    let html = '';
    try {
      const htmlRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NuvexBot/1.0; +https://nuvex.ai/bot)' },
        signal: AbortSignal.timeout(8000)
      });
      html = await htmlRes.text();
    } catch(e) {
      results.errors.push('No se pudo obtener el HTML: ' + e.message);
    }

    // ── 3. Analyze HTML ───────────────────────────────────────────────
    if (html) {
      const h = html.toLowerCase();

      // Title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : null;

      // Meta description
      const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
      const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : null;

      // Headings
      const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => m[1].trim());
      const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => m[1].trim());
      const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => m[1].trim());

      // Canonical
      const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
      const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;

      // Open Graph
      const ogTitle    = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      const ogDesc     = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      const ogImage    = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;

      // Twitter Card
      const twitterCard = html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;

      // Hreflang
      const hreflangs = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["']/gi)].map(m => m[1]);

      // Schema markup
      const schemaBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      const schemas = [];
      for (const block of schemaBlocks) {
        try {
          const parsed = JSON.parse(block[1]);
          schemas.push(parsed);
        } catch(e) {}
      }
      const schemaTypes = schemas.map(s => s['@type'] || (Array.isArray(s['@graph']) ? s['@graph'].map(g => g['@type']) : null)).flat().filter(Boolean);

      // Microdata
      const microdataTypes = [...html.matchAll(/itemtype=["']https?:\/\/schema\.org\/([^"']+)["']/gi)].map(m => m[1]);

      // Viewport
      const hasViewport = h.includes('name="viewport"') || h.includes("name='viewport'");

      // Charset
      const hasCharset = h.includes('charset=');

      // Robots meta
      const robotsMeta = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;

      // Images without alt
      const allImgs = [...html.matchAll(/<img[^>]+>/gi)];
      const imgsWithoutAlt = allImgs.filter(m => !m[0].includes('alt=')).length;

      // Links
      const internalLinks = [...html.matchAll(/href=["']\/[^"']+["']/gi)].length;
      const externalLinks = [...html.matchAll(/href=["']https?:\/\/[^"']+["']/gi)].length;

      results.html_analysis = {
        title: { value: title, length: title?.length || 0, ok: !!title && title.length >= 10 && title.length <= 70 },
        meta_description: { value: metaDesc, length: metaDesc?.length || 0, ok: !!metaDesc && metaDesc.length >= 50 && metaDesc.length <= 165 },
        headings: { h1: h1s, h2: h2s, h3: h3s, h1_count: h1s.length, h2_count: h2s.length, h3_count: h3s.length, ok: h1s.length === 1 },
        canonical: { value: canonical, ok: !!canonical },
        open_graph: { title: ogTitle, description: ogDesc, image: ogImage, ok: !!(ogTitle && ogDesc && ogImage) },
        twitter_card: { value: twitterCard, ok: !!twitterCard },
        hreflang: { values: hreflangs, count: hreflangs.length, ok: hreflangs.length > 0 },
        schema: { blocks: schemas, types: schemaTypes, microdata_types: microdataTypes, has_schema: schemas.length > 0 || microdataTypes.length > 0,
          has_organization: schemaTypes.includes('Organization') || schemaTypes.includes('LocalBusiness'),
          has_faq: schemaTypes.includes('FAQPage'),
          has_breadcrumb: schemaTypes.includes('BreadcrumbList'),
          has_article: schemaTypes.includes('Article') || schemaTypes.includes('BlogPosting'),
          has_local_business: schemaTypes.includes('LocalBusiness'),
          has_product: schemaTypes.includes('Product'),
          has_website: schemaTypes.includes('WebSite'),
        },
        technical: { has_viewport: hasViewport, has_charset: hasCharset, robots_meta: robotsMeta, https: targetUrl.startsWith('https://') },
        images: { total: allImgs.length, without_alt: imgsWithoutAlt, ok: imgsWithoutAlt === 0 },
        links: { internal: internalLinks, external: externalLinks }
      };
    }

    // ── 4. robots.txt ─────────────────────────────────────────────────
    try {
      const robotsRes = await fetch(`${hostname}/robots.txt`, { signal: AbortSignal.timeout(5000) });
      if (robotsRes.ok) {
        const robotsTxt = await robotsRes.text();
        results.robots = {
          exists: true,
          content: robotsTxt.substring(0, 2000),
          has_sitemap: robotsTxt.toLowerCase().includes('sitemap:'),
          blocks_googlebot: robotsTxt.toLowerCase().includes('disallow: /') && robotsTxt.toLowerCase().includes('user-agent: googlebot'),
          blocks_all: robotsTxt.includes('User-agent: *') && robotsTxt.includes('Disallow: /')
        };
      } else {
        results.robots = { exists: false };
      }
    } catch(e) {
      results.robots = { exists: false, error: e.message };
    }

    // ── 5. sitemap.xml ────────────────────────────────────────────────
    try {
      const sitemapRes = await fetch(`${hostname}/sitemap.xml`, { signal: AbortSignal.timeout(5000) });
      if (sitemapRes.ok) {
        const sitemapTxt = await sitemapRes.text();
        const urlCount = (sitemapTxt.match(/<url>/gi) || []).length;
        const hasImages = sitemapTxt.includes('image:image');
        results.sitemap = { exists: true, url_count: urlCount, has_images: hasImages };
      } else {
        results.sitemap = { exists: false };
      }
    } catch(e) {
      results.sitemap = { exists: false, error: e.message };
    }

    // ── 6. llms.txt ───────────────────────────────────────────────────
    try {
      const llmsRes = await fetch(`${hostname}/llms.txt`, { signal: AbortSignal.timeout(5000) });
      if (llmsRes.ok) {
        const llmsTxt = await llmsRes.text();
        results.llms_txt = { exists: true, content: llmsTxt.substring(0, 1000) };
      } else {
        results.llms_txt = { exists: false };
      }
    } catch(e) {
      results.llms_txt = { exists: false };
    }

  } catch(err) {
    results.errors.push('Error general: ' + err.message);
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
