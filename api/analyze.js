export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 ANALYZE REQUEST STARTED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 Raw URL param:', url);

  if (!url) {
    console.log('❌ ERROR: No URL provided');
    return new Response(JSON.stringify({ error: 'URL requerida' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Normalize URL
  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  console.log('🔗 Normalized URL:', targetUrl);

  const hostname = (() => { try { return new URL(targetUrl).origin; } catch(e) { return null; }})();
  console.log('🏠 Hostname/Origin:', hostname);

  const results = {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    pagespeed: { mobile: null, desktop: null },
    html_analysis: null,
    robots: null,
    sitemap: null,
    llms_txt: null,
    errors: [],
    debug_log: [] // log visible en la respuesta JSON
  };

  const log = (msg) => {
    console.log(msg);
    results.debug_log.push(`${new Date().toISOString().split('T')[1].split('.')[0]} ${msg}`);
  };

  try {

    // ─────────────────────────────────────────────────
    // 1. PAGESPEED MOBILE + DESKTOP
    // ─────────────────────────────────────────────────
    log('📊 STEP 1: Calling Google PageSpeed API...');
    const apiKey = typeof process !== 'undefined' && process.env?.PAGESPEED_API_KEY
      ? `&key=${process.env.PAGESPEED_API_KEY}` : '';
    log(`🔑 API Key present: ${!!apiKey}`);

    const psBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const cats = 'category=performance&category=seo&category=accessibility&category=best-practices';
    const mobileUrl  = `${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=mobile&${cats}${apiKey}`;
    const desktopUrl = `${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=desktop&${cats}${apiKey}`;

    log(`📱 Fetching PageSpeed MOBILE...`);
    const psStart = Date.now();

    const [psMobileRes, psDesktopRes] = await Promise.allSettled([
      fetch(mobileUrl).then(r => {
        log(`📱 PageSpeed mobile HTTP status: ${r.status}`);
        return r.json();
      }),
      fetch(desktopUrl).then(r => {
        log(`🖥 PageSpeed desktop HTTP status: ${r.status}`);
        return r.json();
      })
    ]);

    log(`⏱ PageSpeed took: ${Date.now() - psStart}ms`);

    if (psMobileRes.status === 'fulfilled') {
      results.pagespeed.mobile = psMobileRes.value;
      const mob = psMobileRes.value;
      const perfScore = mob?.lighthouseResult?.categories?.performance?.score;
      const seoScore  = mob?.lighthouseResult?.categories?.seo?.score;
      log(`✅ Mobile PageSpeed OK — Performance: ${Math.round((perfScore||0)*100)}/100, SEO: ${Math.round((seoScore||0)*100)}/100`);

      // Log key audits
      const audits = mob?.lighthouseResult?.audits || {};
      log(`   🔍 LCP: ${audits['largest-contentful-paint']?.displayValue || 'N/A'} (score: ${audits['largest-contentful-paint']?.score})`);
      log(`   🔍 FCP: ${audits['first-contentful-paint']?.displayValue || 'N/A'} (score: ${audits['first-contentful-paint']?.score})`);
      log(`   🔍 CLS: ${audits['cumulative-layout-shift']?.displayValue || 'N/A'} (score: ${audits['cumulative-layout-shift']?.score})`);
      log(`   🔍 TBT: ${audits['total-blocking-time']?.displayValue || 'N/A'} (score: ${audits['total-blocking-time']?.score})`);
      log(`   🔍 Title audit: ${audits['document-title']?.score}`);
      log(`   🔍 Meta desc audit: ${audits['meta-description']?.score}`);
      log(`   🔍 Viewport audit: ${audits['viewport']?.score}`);
      log(`   🔍 HTTPS audit: ${audits['is-on-https']?.score}`);
      log(`   🔍 Image alt audit: ${audits['image-alt']?.score}`);
      log(`   🔍 Mobile friendly: ${audits['content-width']?.score}`);
    } else {
      log(`❌ Mobile PageSpeed FAILED: ${psMobileRes.reason}`);
      results.errors.push('PageSpeed mobile failed: ' + psMobileRes.reason);
    }

    if (psDesktopRes.status === 'fulfilled') {
      results.pagespeed.desktop = psDesktopRes.value;
      const desk = psDesktopRes.value;
      const perfScore = desk?.lighthouseResult?.categories?.performance?.score;
      log(`✅ Desktop PageSpeed OK — Performance: ${Math.round((perfScore||0)*100)}/100`);
    } else {
      log(`❌ Desktop PageSpeed FAILED: ${psDesktopRes.reason}`);
    }

    // ─────────────────────────────────────────────────
    // 2. FETCH HTML
    // ─────────────────────────────────────────────────
    log('');
    log('🌐 STEP 2: Fetching HTML from target URL...');
    let html = '';
    let htmlFetchStatus = null;

    try {
      const htmlStart = Date.now();
      const htmlRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AnalyzerBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        },
        signal: AbortSignal.timeout(8000)
      });
      htmlFetchStatus = htmlRes.status;
      log(`📄 HTML fetch HTTP status: ${htmlRes.status}`);
      log(`📄 Content-Type: ${htmlRes.headers.get('content-type')}`);
      log(`📄 X-Robots-Tag: ${htmlRes.headers.get('x-robots-tag') || 'none'}`);

      html = await htmlRes.text();
      log(`📄 HTML size: ${html.length} chars (${Math.round(html.length/1024)}KB) — took ${Date.now()-htmlStart}ms`);

      if (html.length < 100) {
        log(`⚠️ WARNING: HTML very short (${html.length} chars) — possible JS-rendered page or block`);
      }
    } catch(e) {
      log(`❌ HTML fetch FAILED: ${e.message}`);
      results.errors.push('HTML fetch failed: ' + e.message);
    }

    // ─────────────────────────────────────────────────
    // 3. ANALYZE HTML
    // ─────────────────────────────────────────────────
    if (html) {
      log('');
      log('🔬 STEP 3: Analyzing HTML content...');
      const h = html.toLowerCase();

      // Title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : null;
      log(`   📌 Title: "${title || 'NOT FOUND'}" (${title?.length || 0} chars)`);

      // Meta description
      const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
      const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : null;
      log(`   📌 Meta description: "${metaDesc ? metaDesc.substring(0,60)+'...' : 'NOT FOUND'}" (${metaDesc?.length || 0} chars)`);

      // Headings
      const h1s = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => m[1].trim());
      const h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => m[1].trim());
      const h3s = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map(m => m[1].trim());
      log(`   📌 H1 (${h1s.length}): ${h1s.length ? '"' + h1s[0].substring(0,50) + '"' : 'NOT FOUND'}`);
      log(`   📌 H2 count: ${h2s.length}`);
      log(`   📌 H3 count: ${h3s.length}`);

      // Canonical
      const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
      const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;
      log(`   📌 Canonical: ${canonical || 'NOT FOUND'}`);

      // Open Graph
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      const ogDesc  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      log(`   📌 OG Title: ${ogTitle ? '"'+ogTitle.substring(0,40)+'"' : 'NOT FOUND'}`);
      log(`   📌 OG Description: ${ogDesc ? 'FOUND' : 'NOT FOUND'}`);
      log(`   📌 OG Image: ${ogImage ? 'FOUND' : 'NOT FOUND'}`);

      // Twitter Card
      const twitterCard = html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      log(`   📌 Twitter Card: ${twitterCard || 'NOT FOUND'}`);

      // Hreflang
      const hreflangs = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["']/gi)].map(m => m[1]);
      log(`   📌 Hreflang langs: ${hreflangs.length ? hreflangs.join(', ') : 'NONE'}`);

      // Schema
      const schemaBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      log(`   📌 Schema blocks found: ${schemaBlocks.length}`);
      const schemas = [];
      for (const [i, block] of schemaBlocks.entries()) {
        try {
          const parsed = JSON.parse(block[1]);
          schemas.push(parsed);
          const type = parsed['@type'] || (parsed['@graph'] ? parsed['@graph'].map(g=>g['@type']).join('+') : 'unknown');
          log(`   📌 Schema block ${i+1}: @type = ${type}`);
        } catch(e) {
          log(`   ⚠️ Schema block ${i+1}: INVALID JSON — ${e.message}`);
        }
      }
      const schemaTypes = schemas.flatMap(s => {
        if (Array.isArray(s['@graph'])) return s['@graph'].map(g => g['@type']);
        return [s['@type']];
      }).filter(Boolean);
      log(`   📌 Schema types detected: ${schemaTypes.join(', ') || 'NONE'}`);

      // Microdata
      const microdataTypes = [...html.matchAll(/itemtype=["']https?:\/\/schema\.org\/([^"']+)["']/gi)].map(m => m[1]);
      if (microdataTypes.length) log(`   📌 Microdata types: ${microdataTypes.join(', ')}`);

      // Images
      const allImgs = [...html.matchAll(/<img[^>]+>/gi)];
      const imgsWithoutAlt = allImgs.filter(m => !m[0].includes('alt=')).length;
      log(`   📌 Images: ${allImgs.length} total, ${imgsWithoutAlt} without alt`);

      // Technical
      const hasViewport = h.includes('name="viewport"') || h.includes("name='viewport'");
      const hasCharset  = h.includes('charset=');
      const hasHTTPS    = targetUrl.startsWith('https://');
      const robotsMeta  = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
      log(`   📌 HTTPS: ${hasHTTPS}`);
      log(`   📌 Viewport: ${hasViewport}`);
      log(`   📌 Charset: ${hasCharset}`);
      log(`   📌 Robots meta: ${robotsMeta || 'none'}`);

      // Links
      const internalLinks = [...html.matchAll(/href=["']\/[^"']+["']/gi)].length;
      const externalLinks = [...html.matchAll(/href=["']https?:\/\/[^"']+["']/gi)].length;
      log(`   📌 Links: ${internalLinks} internal, ${externalLinks} external`);

      results.html_analysis = {
        title: { value: title, length: title?.length||0, ok: !!title && title.length>=10 && title.length<=70 },
        meta_description: { value: metaDesc, length: metaDesc?.length||0, ok: !!metaDesc && metaDesc.length>=50 && metaDesc.length<=165 },
        headings: { h1: h1s, h2: h2s, h3: h3s, h1_count: h1s.length, h2_count: h2s.length, h3_count: h3s.length, ok: h1s.length===1 },
        canonical: { value: canonical, ok: !!canonical },
        open_graph: { title: ogTitle, description: ogDesc, image: ogImage, ok: !!(ogTitle&&ogDesc&&ogImage) },
        twitter_card: { value: twitterCard, ok: !!twitterCard },
        hreflang: { values: hreflangs, count: hreflangs.length, ok: hreflangs.length>0 },
        schema: {
          blocks: schemas,
          types: schemaTypes,
          microdata_types: microdataTypes,
          has_schema: schemas.length>0 || microdataTypes.length>0,
          has_organization: schemaTypes.some(t => ['Organization','LocalBusiness'].includes(t)),
          has_faq: schemaTypes.includes('FAQPage'),
          has_breadcrumb: schemaTypes.includes('BreadcrumbList'),
          has_article: schemaTypes.some(t => ['Article','BlogPosting'].includes(t)),
          has_local_business: schemaTypes.includes('LocalBusiness'),
          has_product: schemaTypes.includes('Product'),
          has_website: schemaTypes.includes('WebSite'),
        },
        technical: { has_viewport: hasViewport, has_charset: hasCharset, robots_meta: robotsMeta, https: hasHTTPS },
        images: { total: allImgs.length, without_alt: imgsWithoutAlt, ok: imgsWithoutAlt===0 },
        links: { internal: internalLinks, external: externalLinks },
        html_length: html.length,
        fetch_status: htmlFetchStatus
      };

      log(`✅ HTML analysis complete`);
    } else {
      log(`⚠️ STEP 3 SKIPPED: No HTML available`);
    }

    // ─────────────────────────────────────────────────
    // 4. ROBOTS.TXT
    // ─────────────────────────────────────────────────
    log('');
    log('🤖 STEP 4: Fetching robots.txt...');
    try {
      const robotsUrl = `${hostname}/robots.txt`;
      log(`   Fetching: ${robotsUrl}`);
      const robotsRes = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
      log(`   robots.txt HTTP status: ${robotsRes.status}`);
      if (robotsRes.ok) {
        const robotsTxt = await robotsRes.text();
        const hasSitemap = robotsTxt.toLowerCase().includes('sitemap:');
        const blocksAll  = robotsTxt.includes('User-agent: *') && robotsTxt.includes('Disallow: /');
        log(`   ✅ robots.txt found (${robotsTxt.length} chars)`);
        log(`   📌 Has sitemap declaration: ${hasSitemap}`);
        log(`   📌 Blocks all crawlers: ${blocksAll}`);
        log(`   📌 First 200 chars: ${robotsTxt.substring(0,200).replace(/\n/g,' | ')}`);
        results.robots = { exists: true, content: robotsTxt.substring(0,2000), has_sitemap: hasSitemap, blocks_all: blocksAll };
      } else {
        log(`   ❌ robots.txt not found (${robotsRes.status})`);
        results.robots = { exists: false, status: robotsRes.status };
      }
    } catch(e) {
      log(`   ❌ robots.txt fetch error: ${e.message}`);
      results.robots = { exists: false, error: e.message };
    }

    // ─────────────────────────────────────────────────
    // 5. SITEMAP.XML
    // ─────────────────────────────────────────────────
    log('');
    log('🗺 STEP 5: Fetching sitemap.xml...');
    try {
      const sitemapUrl = `${hostname}/sitemap.xml`;
      log(`   Fetching: ${sitemapUrl}`);
      const sitemapRes = await fetch(sitemapUrl, { signal: AbortSignal.timeout(5000) });
      log(`   sitemap.xml HTTP status: ${sitemapRes.status}`);
      if (sitemapRes.ok) {
        const sitemapTxt = await sitemapRes.text();
        const urlCount   = (sitemapTxt.match(/<url>/gi)||[]).length;
        const hasImages  = sitemapTxt.includes('image:image');
        const isSitemapIndex = sitemapTxt.includes('<sitemapindex');
        log(`   ✅ sitemap.xml found (${sitemapTxt.length} chars)`);
        log(`   📌 URL entries: ${urlCount}`);
        log(`   📌 Is sitemap index: ${isSitemapIndex}`);
        log(`   📌 Has image sitemap: ${hasImages}`);
        results.sitemap = { exists: true, url_count: urlCount, has_images: hasImages, is_index: isSitemapIndex };
      } else {
        log(`   ❌ sitemap.xml not found (${sitemapRes.status})`);
        results.sitemap = { exists: false, status: sitemapRes.status };
      }
    } catch(e) {
      log(`   ❌ sitemap.xml fetch error: ${e.message}`);
      results.sitemap = { exists: false, error: e.message };
    }

    // ─────────────────────────────────────────────────
    // 6. LLMS.TXT
    // ─────────────────────────────────────────────────
    log('');
    log('🤖 STEP 6: Fetching llms.txt...');
    try {
      const llmsUrl = `${hostname}/llms.txt`;
      log(`   Fetching: ${llmsUrl}`);
      const llmsRes = await fetch(llmsUrl, { signal: AbortSignal.timeout(5000) });
      log(`   llms.txt HTTP status: ${llmsRes.status}`);
      if (llmsRes.ok) {
        const llmsTxt = await llmsRes.text();
        log(`   ✅ llms.txt found (${llmsTxt.length} chars)`);
        log(`   📌 Preview: ${llmsTxt.substring(0,100).replace(/\n/g,' | ')}`);
        results.llms_txt = { exists: true, content: llmsTxt.substring(0,1000) };
      } else {
        log(`   ❌ llms.txt not found (${llmsRes.status})`);
        results.llms_txt = { exists: false, status: llmsRes.status };
      }
    } catch(e) {
      log(`   ❌ llms.txt fetch error: ${e.message}`);
      results.llms_txt = { exists: false };
    }

    // ─────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('📋 ANALYSIS COMPLETE — SUMMARY');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`✅ PageSpeed mobile: ${results.pagespeed.mobile ? 'OK' : 'FAILED'}`);
    log(`✅ PageSpeed desktop: ${results.pagespeed.desktop ? 'OK' : 'FAILED'}`);
    log(`✅ HTML analyzed: ${results.html_analysis ? 'OK (' + results.html_analysis.html_length + ' chars)' : 'FAILED'}`);
    log(`✅ robots.txt: ${results.robots?.exists ? 'FOUND' : 'NOT FOUND'}`);
    log(`✅ sitemap.xml: ${results.sitemap?.exists ? 'FOUND (' + results.sitemap.url_count + ' URLs)' : 'NOT FOUND'}`);
    log(`✅ llms.txt: ${results.llms_txt?.exists ? 'FOUND' : 'NOT FOUND'}`);
    log(`⚠️ Errors: ${results.errors.length}`);
    if (results.errors.length) results.errors.forEach(e => log(`   - ${e}`));
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch(err) {
    log(`💥 FATAL ERROR: ${err.message}`);
    log(`Stack: ${err.stack}`);
    results.errors.push('Fatal: ' + err.message);
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
