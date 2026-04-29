export const config = { runtime: 'edge' };

import { filterPagespeed } from '../lib/filterPagespeed.js';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 ANALYZE REQUEST STARTED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL requerida' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  console.log('🔗 Target URL:', targetUrl);

  const hostname = (() => { try { return new URL(targetUrl).origin; } catch(e) { return null; }})();

  const results = {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    pagespeed: null,
    html_analysis: null,
    robots: null,
    sitemap: null,
    llms_txt: null,
    errors: [],
    debug_log: []
  };

  const log = (msg) => {
    console.log(msg);
    results.debug_log.push(`${new Date().toISOString().split('T')[1].split('.')[0]} ${msg}`);
  };

  // ─────────────────────────────────────────────────────
  // HELPER: detect if HTML is JS-rendered
  // ─────────────────────────────────────────────────────
  function isJsRendered(html) {
    const h = html.toLowerCase();
    const hasH1 = h.includes('<h1');
    const bodyContent = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || '').length;
    const hasMinContent = bodyContent > 5000;
    const isNextJs = h.includes('__next') || h.includes('_next');
    const isReact = h.includes('react') || h.includes('__react');
    const isNuxt = h.includes('__nuxt') || h.includes('_nuxt');
    const isAngular = h.includes('ng-version') || h.includes('ng-app');

    log(`   🔎 JS Framework detection:`);
    log(`      hasH1: ${hasH1}, bodyContent: ${bodyContent} chars`);
    log(`      Next.js: ${isNextJs}, React: ${isReact}, Nuxt: ${isNuxt}, Angular: ${isAngular}`);

    const likelyJsRendered = !hasH1 || !hasMinContent || isNextJs || isNuxt || isAngular;
    return likelyJsRendered;
  }

  // ─────────────────────────────────────────────────────
  // HELPER: extract all data from HTML string
  // ─────────────────────────────────────────────────────
  function extractFromHtml(html, source) {
    log(`🔬 Extracting data from HTML (source: ${source}, size: ${html.length} chars)...`);
    const h = html.toLowerCase();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    log(`   📌 Title: "${title || 'NOT FOUND'}" (${title?.length || 0} chars)`);

    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : null;
    log(`   📌 Meta desc: ${metaDesc ? metaDesc.substring(0,60)+'...' : 'NOT FOUND'} (${metaDesc?.length||0} chars)`);

    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g,'').trim()).filter(Boolean);
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g,'').trim()).filter(Boolean);
    const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => m[1].replace(/<[^>]+>/g,'').trim()).filter(Boolean);
    log(`   📌 H1 (${h1s.length}): ${h1s.length ? '"'+h1s[0].substring(0,60)+'"' : 'NOT FOUND'}`);
    log(`   📌 H2 (${h2s.length}): ${h2s.slice(0,3).map(h=>`"${h.substring(0,30)}"`).join(', ')}`);
    log(`   📌 H3 count: ${h3s.length}`);

    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;
    log(`   📌 Canonical: ${canonical || 'NOT FOUND'}`);

    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || null;
    const ogDesc  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] || null;
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] || null;
    log(`   📌 OG: title=${ogTitle?'✓':'✗'} desc=${ogDesc?'✓':'✗'} image=${ogImage?'✓':'✗'}`);

    const twitterCard = html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
    log(`   📌 Twitter Card: ${twitterCard || 'NOT FOUND'}`);

    const hreflangs = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["']/gi)].map(m => m[1]);
    log(`   📌 Hreflang: ${hreflangs.length ? hreflangs.join(', ') : 'NONE'}`);

    const schemaBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    log(`   📌 Schema blocks: ${schemaBlocks.length}`);
    const schemas = [];
    for (const [i, block] of schemaBlocks.entries()) {
      try {
        const parsed = JSON.parse(block[1]);
        schemas.push(parsed);
        const type = parsed['@type'] || (parsed['@graph'] ? parsed['@graph'].map(g=>g['@type']).join('+') : 'unknown');
        log(`      Schema ${i+1}: @type = ${type}`);
      } catch(e) {
        log(`      Schema ${i+1}: INVALID JSON`);
      }
    }
    const schemaTypes = schemas.flatMap(s => {
      if (Array.isArray(s['@graph'])) return s['@graph'].map(g => g['@type']);
      return [s['@type']];
    }).filter(Boolean);
    log(`   📌 Schema types: ${schemaTypes.join(', ') || 'NONE'}`);

    const microdataTypes = [...html.matchAll(/itemtype=["']https?:\/\/schema\.org\/([^"']+)["']/gi)].map(m => m[1]);

    const allImgs = [...html.matchAll(/<img[^>]+>/gi)];
    const imgsWithoutAlt = allImgs.filter(m => !m[0].toLowerCase().includes('alt=')).length;
    log(`   📌 Images: ${allImgs.length} total, ${imgsWithoutAlt} without alt`);

    const hasViewport = h.includes('name="viewport"') || h.includes("name='viewport'");
    const hasCharset  = h.includes('charset=');
    const hasHTTPS    = targetUrl.startsWith('https://');
    const robotsMeta  = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;

    const internalLinks = [...html.matchAll(/href=["']\/[^"']+["']/gi)].length;
    const externalLinks = [...html.matchAll(/href=["']https?:\/\/[^"']+["']/gi)].length;

    return {
      source,
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
    };
  }

  try {

    // ─────────────────────────────────────────────────
    // 1. PAGESPEED
    // ─────────────────────────────────────────────────
    log('📊 STEP 1: Google PageSpeed API...');
    // Vercel Edge Runtime reads env vars directly from process.env
    const rawKey = process.env.PAGESPEED_API_KEY || '';
    const apiKey = rawKey ? `&key=${rawKey}` : '';
    log(`🔑 API Key: ${rawKey ? 'YES (' + rawKey.substring(0,8) + '...)' : 'NO — using shared quota'}`);

    const psBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const cats   = 'category=performance&category=seo&category=accessibility&category=best-practices';

    const [psMob, psDesk] = await Promise.allSettled([
      fetch(`${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=mobile&${cats}${apiKey}`).then(r=>{
        log(`   📱 Mobile HTTP ${r.status}`); return r.json();
      }),
      fetch(`${psBase}?url=${encodeURIComponent(targetUrl)}&strategy=desktop&${cats}${apiKey}`).then(r=>{
        log(`   🖥 Desktop HTTP ${r.status}`); return r.json();
      })
    ]);

    let rawMobile = null;
    let rawDesktop = null;

    if (psMob.status==='fulfilled' && !psMob.value?.error) {
      rawMobile = psMob.value;
      const perf = Math.round((psMob.value?.lighthouseResult?.categories?.performance?.score||0)*100);
      const seo  = Math.round((psMob.value?.lighthouseResult?.categories?.seo?.score||0)*100);
      const audits = psMob.value?.lighthouseResult?.audits || {};
      log(`   ✅ Mobile OK — Perf: ${perf}, SEO: ${seo}`);
      log(`      LCP: ${audits['largest-contentful-paint']?.displayValue||'N/A'}`);
      log(`      FCP: ${audits['first-contentful-paint']?.displayValue||'N/A'}`);
      log(`      CLS: ${audits['cumulative-layout-shift']?.displayValue||'N/A'}`);
      log(`      TBT: ${audits['total-blocking-time']?.displayValue||'N/A'}`);
    } else {
      const errMsg = psMob.value?.error?.message || psMob.reason || 'unknown';
      log(`   ❌ Mobile FAILED: ${errMsg}`);
      results.errors.push('PageSpeed mobile: ' + errMsg);
    }

    if (psDesk.status==='fulfilled' && !psDesk.value?.error) {
      rawDesktop = psDesk.value;
      const perf = Math.round((psDesk.value?.lighthouseResult?.categories?.performance?.score||0)*100);
      log(`   ✅ Desktop OK — Perf: ${perf}`);
    } else {
      log(`   ❌ Desktop FAILED`);
    }

    // Aplicar filtro: reemplazamos el crudo por la versión compacta y accionable
    try {
      results.pagespeed = filterPagespeed(rawMobile, rawDesktop, { url: targetUrl });
      log(`   🎯 PageSpeed filtrado OK`);
    } catch (e) {
      log(`   ⚠️ Filter error: ${e.message}`);
      results.errors.push('Filter pagespeed: ' + e.message);
    }

    // ─────────────────────────────────────────────────
    // 2. FETCH HTML (normal)
    // ─────────────────────────────────────────────────
    log('');
    log('🌐 STEP 2: Fetching HTML (normal fetch)...');
    let html = '';
    let htmlSource = 'direct';

    try {
      const t0 = Date.now();
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AnalyzerBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000)
      });
      log(`   HTTP ${res.status} — ${res.headers.get('content-type')}`);
      html = await res.text();
      log(`   Size: ${html.length} chars (${Math.round(html.length/1024)}KB) in ${Date.now()-t0}ms`);
    } catch(e) {
      log(`   ❌ Direct fetch failed: ${e.message}`);
      results.errors.push('Direct fetch: ' + e.message);
    }

    // ─────────────────────────────────────────────────
    // 3. JINA AI FALLBACK (if JS-rendered)
    // ─────────────────────────────────────────────────
    log('');
    log('🔎 STEP 3: Checking if JS-rendered...');

    if (html && isJsRendered(html)) {
      log('⚡ JS-rendered detected — trying Jina AI Reader...');
      try {
        const jinaUrl = `https://r.jina.ai/${targetUrl}`;
        log(`   Fetching: ${jinaUrl}`);
        const t0 = Date.now();
        const jinaRes = await fetch(jinaUrl, {
          headers: {
            'Accept': 'text/html',
            'X-Return-Format': 'html',
          },
          signal: AbortSignal.timeout(15000)
        });
        log(`   Jina HTTP ${jinaRes.status} in ${Date.now()-t0}ms`);

        if (jinaRes.ok) {
          const jinaHtml = await jinaRes.text();
          log(`   Jina response size: ${jinaHtml.length} chars`);

          // Check if Jina gave us better H1 data
          const jinaH1s = [...jinaHtml.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>m[1].replace(/<[^>]+>/g,'').trim()).filter(Boolean);
          log(`   Jina H1s found: ${jinaH1s.length} — ${jinaH1s[0]||'none'}`);

          if (jinaH1s.length > 0 || jinaHtml.length > html.length) {
            log(`   ✅ Jina gave better data — using Jina HTML`);
            html = jinaHtml;
            htmlSource = 'jina_ai';
          } else {
            log(`   ℹ️ Jina didn't improve — keeping direct HTML`);
          }
        } else {
          log(`   ❌ Jina failed: ${jinaRes.status}`);
        }
      } catch(e) {
        log(`   ❌ Jina error: ${e.message}`);
      }
    } else if (html) {
      log('✅ HTML looks static — no Jina needed');
    }

    // ─────────────────────────────────────────────────
    // 4. EXTRACT FROM HTML
    // ─────────────────────────────────────────────────
    log('');
    log(`🔬 STEP 4: Extracting data (source: ${htmlSource})...`);
    if (html) {
      results.html_analysis = extractFromHtml(html, htmlSource);
      results.html_analysis.fetch_status = 200;
    } else {
      log('⚠️ No HTML — skipping extraction');
    }

    // ─────────────────────────────────────────────────
    // 5. ROBOTS.TXT
    // ─────────────────────────────────────────────────
    log('');
    log('🤖 STEP 5: robots.txt...');
    try {
      const res = await fetch(`${hostname}/robots.txt`, { signal: AbortSignal.timeout(5000) });
      log(`   HTTP ${res.status}`);
      if (res.ok) {
        const txt = await res.text();
        results.robots = {
          exists: true, content: txt.substring(0,2000),
          has_sitemap: txt.toLowerCase().includes('sitemap:'),
          blocks_all: txt.includes('User-agent: *') && txt.includes('Disallow: /')
        };
        log(`   ✅ Found (${txt.length} chars) — sitemap: ${results.robots.has_sitemap}`);
      } else {
        results.robots = { exists: false, status: res.status };
        log(`   ❌ Not found (${res.status})`);
      }
    } catch(e) {
      results.robots = { exists: false, error: e.message };
      log(`   ❌ Error: ${e.message}`);
    }

    // ─────────────────────────────────────────────────
    // 6. SITEMAP.XML
    // ─────────────────────────────────────────────────
    log('');
    log('🗺 STEP 6: sitemap.xml...');
    try {
      const res = await fetch(`${hostname}/sitemap.xml`, { signal: AbortSignal.timeout(5000) });
      log(`   HTTP ${res.status}`);
      if (res.ok) {
        const txt = await res.text();
        const urlCount = (txt.match(/<url>/gi)||[]).length;
        results.sitemap = { exists: true, url_count: urlCount, has_images: txt.includes('image:image'), is_index: txt.includes('<sitemapindex') };
        log(`   ✅ Found — ${urlCount} URLs, index: ${results.sitemap.is_index}`);
      } else {
        results.sitemap = { exists: false, status: res.status };
        log(`   ❌ Not found (${res.status})`);
      }
    } catch(e) {
      results.sitemap = { exists: false, error: e.message };
      log(`   ❌ Error: ${e.message}`);
    }

    // ─────────────────────────────────────────────────
    // 7. LLMS.TXT
    // ─────────────────────────────────────────────────
    log('');
    log('🤖 STEP 7: llms.txt...');
    try {
      const res = await fetch(`${hostname}/llms.txt`, { signal: AbortSignal.timeout(5000) });
      log(`   HTTP ${res.status}`);
      if (res.ok) {
        const txt = await res.text();
        results.llms_txt = { exists: true, content: txt.substring(0,1000) };
        log(`   ✅ Found (${txt.length} chars)`);
      } else {
        results.llms_txt = { exists: false, status: res.status };
        log(`   ❌ Not found (${res.status})`);
      }
    } catch(e) {
      results.llms_txt = { exists: false };
      log(`   ❌ Error: ${e.message}`);
    }

    // ─────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('📋 SUMMARY');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`PageSpeed mobile:  ${results.pagespeed?.mobile ? '✅' : '❌'}`);
    log(`PageSpeed desktop: ${results.pagespeed?.desktop ? '✅' : '❌'}`);
    log(`HTML source:       ${results.html_analysis?.source || '❌'} (${results.html_analysis?.html_length||0} chars)`);
    log(`H1 found:          ${results.html_analysis?.headings?.h1_count||0}`);
    log(`Schema types:      ${results.html_analysis?.schema?.types?.join(', ') || 'none'}`);
    log(`robots.txt:        ${results.robots?.exists ? '✅' : '❌'}`);
    log(`sitemap.xml:       ${results.sitemap?.exists ? '✅ ('+results.sitemap.url_count+' URLs)' : '❌'}`);
    log(`llms.txt:          ${results.llms_txt?.exists ? '✅' : '❌'}`);
    log(`Errors:            ${results.errors.length}`);
    results.errors.forEach(e => log(`  - ${e}`));
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch(err) {
    log(`💥 FATAL: ${err.message}`);
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
