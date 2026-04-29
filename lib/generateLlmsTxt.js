/**
 * Generador automático de llms.txt
 *
 * llms.txt es el "robots.txt para LLMs" — un archivo en la raíz del sitio que
 * orienta a crawlers de IA sobre el contenido relevante.
 *
 * Spec: https://llmstxt.org/
 *
 * Genera un llms.txt sugerido a partir de:
 *   - Datos del análisis de la home (parsePage output)
 *   - Páginas descubiertas en el crawl (sitemap o crawl)
 *   - Schemas Organization detectados (para descripción)
 *
 * Output: string listo para copiar a /public/llms.txt
 */

export function generateLlmsTxt({ siteUrl, homePage, allPages, organizationSchema }) {
  const lines = [];

  // Título: del schema Organization, o del title de la home
  const orgName = organizationSchema?.name
    || homePage?.title?.value?.split(/[—|–\-:]/)[0]?.trim()
    || extractDomainName(siteUrl);

  lines.push(`# ${orgName}`);
  lines.push('');

  // Descripción: meta description o description del schema Organization
  const description =
    homePage?.meta?.value
    || organizationSchema?.description
    || homePage?.open_graph?.description
    || '';

  if (description) {
    lines.push(`> ${description}`);
    lines.push('');
  }

  // Detalles adicionales (URL principal)
  const baseUrl = normalizeUrl(siteUrl);
  if (baseUrl) {
    lines.push(`URL: ${baseUrl}`);
    lines.push('');
  }

  // Categorizar páginas por tipo (heurística desde URL)
  const categorized = categorizePages(allPages || [], baseUrl);

  // Sección: Páginas principales
  if (categorized.main.length > 0) {
    lines.push('## Páginas principales');
    lines.push('');
    for (const p of categorized.main.slice(0, 10)) {
      lines.push(`- [${cleanTitle(p.title)}](${p.url})${p.description ? `: ${p.description}` : ''}`);
    }
    lines.push('');
  }

  // Sección: Productos/Servicios
  if (categorized.products.length > 0) {
    lines.push('## Productos y servicios');
    lines.push('');
    for (const p of categorized.products.slice(0, 15)) {
      lines.push(`- [${cleanTitle(p.title)}](${p.url})${p.description ? `: ${p.description}` : ''}`);
    }
    lines.push('');
  }

  // Sección: Blog/Contenido
  if (categorized.blog.length > 0) {
    lines.push('## Blog y recursos');
    lines.push('');
    for (const p of categorized.blog.slice(0, 20)) {
      lines.push(`- [${cleanTitle(p.title)}](${p.url})${p.description ? `: ${p.description}` : ''}`);
    }
    lines.push('');
  }

  // Sección: Sobre / Contacto
  if (categorized.about.length > 0) {
    lines.push('## Información corporativa');
    lines.push('');
    for (const p of categorized.about) {
      lines.push(`- [${cleanTitle(p.title)}](${p.url})${p.description ? `: ${p.description}` : ''}`);
    }
    lines.push('');
  }

  // Sección: Optional (legales, soporte) → la convención es ## Optional
  if (categorized.optional.length > 0) {
    lines.push('## Optional');
    lines.push('');
    for (const p of categorized.optional) {
      lines.push(`- [${cleanTitle(p.title)}](${p.url})`);
    }
    lines.push('');
  }

  return {
    content: lines.join('\n').trim() + '\n',
    stats: {
      total_pages_categorized:
        categorized.main.length +
        categorized.products.length +
        categorized.blog.length +
        categorized.about.length +
        categorized.optional.length,
      sections: Object.keys(categorized).filter((k) => categorized[k].length > 0),
    },
    suggested_path: '/public/llms.txt',
    instructions:
      'Copia este contenido a /public/llms.txt en tu proyecto. ' +
      'Vercel lo servirá automáticamente desde https://tu-dominio/llms.txt',
  };
}

// ─── Categorización por URL ──────────────────────────────────────────────────

function categorizePages(pages, baseUrl) {
  const buckets = {
    main: [],
    products: [],
    blog: [],
    about: [],
    optional: [],
  };

  for (const p of pages) {
    if (!p.url) continue;
    if (!p.title?.value) continue;

    const path = getPath(p.url, baseUrl).toLowerCase();
    const item = {
      url: p.url,
      title: p.title.value,
      description: p.meta?.value || null,
    };

    // Home
    if (path === '/' || path === '') {
      buckets.main.unshift(item); // primero
      continue;
    }

    // Optional (legales, sitemap, etc.)
    if (/\/(privacy|privacidad|terms|terminos|cookies|legal|sitemap|404)/.test(path)) {
      buckets.optional.push(item);
      continue;
    }

    // Blog
    if (/\/(blog|noticias|news|articles?|posts?|recursos|resources)/.test(path)) {
      buckets.blog.push(item);
      continue;
    }

    // About
    if (/\/(about|sobre|nosotros|equipo|team|company|empresa|contact|contacto|careers|empleo)/.test(path)) {
      buckets.about.push(item);
      continue;
    }

    // Products / Services
    if (/\/(products?|productos?|services?|servicios?|features?|funcionalidades?|soluciones?|solutions?|pricing|precios|planes)/.test(path)) {
      buckets.products.push(item);
      continue;
    }

    // Otros: secciones principales (path con 1 segmento)
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 1) {
      buckets.main.push(item);
    } else {
      // Páginas profundas que no encajan: las agrupamos como blog si parecen contenido
      if (p.word_count && p.word_count > 300) {
        buckets.blog.push(item);
      } else {
        buckets.optional.push(item);
      }
    }
  }

  return buckets;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

function getPath(url, base) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function extractDomainName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Site';
  }
}

function cleanTitle(title) {
  if (!title) return '';
  // Quitar el nombre de la marca al final ("Página | Marca" → "Página")
  return title.split(/\s*[|—–]\s*/)[0].trim().slice(0, 80);
}
