/**
 * Parser de página individual. Recibe HTML como string, devuelve datos SEO.
 *
 * Sin dependencias externas (sin cheerio/jsdom) para que funcione en cualquier
 * runtime de Vercel sin inflar el bundle. Regex es suficiente para SEO técnico.
 *
 * @param {string} html - HTML completo de la página
 * @param {string} pageUrl - URL canónica de la página (para resolver enlaces relativos)
 * @returns {Object} - Datos estructurados de la página
 */
export function parsePage(html, pageUrl) {
  if (!html || typeof html !== 'string') {
    return { error: 'No HTML' };
  }

  return {
    url: pageUrl,
    title: extractTitle(html),
    meta: extractMeta(html),
    headings: extractHeadings(html),
    canonical: extractCanonical(html),
    hreflang: extractHreflang(html),
    open_graph: extractOpenGraph(html),
    twitter_card: extractMeta(html, 'twitter:card'),
    schema: extractSchema(html),
    images: extractImages(html, pageUrl),
    links: extractLinks(html, pageUrl),
    word_count: estimateWordCount(html),
    html_length: html.length,
    technical: {
      has_viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
      has_charset: /<meta[^>]+charset=/i.test(html),
      lang: extractHtmlLang(html),
      robots_meta: extractMeta(html, 'robots'),
    },
  };
}

// ─── Extractores individuales ────────────────────────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const value = m ? decode(m[1]).trim() : null;
  return {
    value,
    length: value?.length ?? 0,
    ok: !!value && value.length >= 30 && value.length <= 60,
  };
}

function extractMeta(html, name = 'description') {
  // Soporta name="..." y property="..." (para OG, twitter)
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  const reInverse = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
    'i'
  );
  const m = html.match(re) || html.match(reInverse);
  if (!m) return name === 'description' ? { value: null, length: 0, ok: false } : null;

  const value = decode(m[1]).trim();
  if (name === 'description') {
    return {
      value,
      length: value.length,
      ok: value.length >= 120 && value.length <= 160,
    };
  }
  return value;
}

function extractHeadings(html) {
  const out = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = decode(stripTags(m[1])).trim();
      if (text) out[`h${i}`].push(text);
    }
  }
  return {
    ...out,
    h1_count: out.h1.length,
    h2_count: out.h2.length,
    h3_count: out.h3.length,
    ok: out.h1.length === 1, // Buena práctica SEO: un único H1
  };
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
       || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const value = m ? m[1] : null;
  return { value, ok: !!value };
}

function extractHreflang(html) {
  const re = /<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["'][^>]+href=["']([^"']+)["']/gi;
  const reInv = /<link[^>]+hreflang=["']([^"']+)["'][^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/gi;
  const values = [];
  let m;
  while ((m = re.exec(html)) !== null) values.push({ lang: m[1], href: m[2] });
  while ((m = reInv.exec(html)) !== null) values.push({ lang: m[1], href: m[2] });
  return { values, count: values.length };
}

function extractOpenGraph(html) {
  return {
    title: extractMeta(html, 'og:title'),
    description: extractMeta(html, 'og:description'),
    image: extractMeta(html, 'og:image'),
    type: extractMeta(html, 'og:type'),
    url: extractMeta(html, 'og:url'),
    ok: !!(extractMeta(html, 'og:title') && extractMeta(html, 'og:description')),
  };
}

function extractSchema(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks = [];
  const types = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1].trim());
      blocks.push(json);
      collectSchemaTypes(json, types);
    } catch {
      // JSON inválido — lo ignoramos pero contamos como bloque roto
      blocks.push({ _invalid: true });
    }
  }
  const typesArr = [...types];
  return {
    count: blocks.length,
    types: typesArr,
    has_organization: typesArr.includes('Organization'),
    has_website: typesArr.includes('WebSite'),
    has_article: typesArr.includes('Article') || typesArr.includes('BlogPosting'),
    has_product: typesArr.includes('Product'),
    has_faq: typesArr.includes('FAQPage'),
    has_howto: typesArr.includes('HowTo'),
    has_breadcrumb: typesArr.includes('BreadcrumbList'),
    has_local_business: typesArr.includes('LocalBusiness'),
  };
}

function collectSchemaTypes(node, set) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectSchemaTypes(n, set));
    return;
  }
  if (node['@type']) {
    if (Array.isArray(node['@type'])) node['@type'].forEach((t) => set.add(t));
    else set.add(node['@type']);
  }
  if (node['@graph']) collectSchemaTypes(node['@graph'], set);
}

function extractImages(html, pageUrl) {
  const re = /<img[^>]*>/gi;
  const imgs = html.match(re) || [];
  let withoutAlt = 0;
  let withoutSrc = 0;
  const samples = [];

  for (const tag of imgs) {
    const hasAlt = /\salt=["'][^"']*["']/i.test(tag);
    const altMatch = tag.match(/\salt=["']([^"']*)["']/i);
    const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);

    if (!hasAlt || (altMatch && altMatch[1].trim() === '')) {
      withoutAlt++;
      if (samples.length < 5 && srcMatch) {
        samples.push(resolveUrl(srcMatch[1], pageUrl));
      }
    }
    if (!srcMatch) withoutSrc++;
  }

  return {
    total: imgs.length,
    without_alt: withoutAlt,
    without_src: withoutSrc,
    samples_without_alt: samples,
    ok: withoutAlt === 0,
  };
}

function extractLinks(html, pageUrl) {
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const internal = [];
  const external = [];
  const origin = safeOrigin(pageUrl);

  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    const resolved = resolveUrl(href, pageUrl);
    if (!resolved) continue;

    const linkOrigin = safeOrigin(resolved);
    const anchor = decode(stripTags(m[2])).trim().slice(0, 100);
    const entry = { href: resolved, anchor };

    if (linkOrigin === origin) internal.push(entry);
    else external.push(entry);
  }

  return {
    internal,
    external,
    internal_count: internal.length,
    external_count: external.length,
  };
}

function extractHtmlLang(html) {
  const m = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function estimateWordCount(html) {
  // Quitar scripts, styles, tags, contar palabras
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.split(' ').filter(Boolean).length;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

function decode(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function resolveUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
