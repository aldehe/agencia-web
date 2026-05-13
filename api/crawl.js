// Endpoint /api/crawl?url=https://ejemplo.com
//
// Hace inventario completo del sitio: descubre URLs (sitemap o crawl),
// analiza cada página (title, meta, headings, schema, imágenes, links),
// rankea las Top 5 Landing Pages (Sesión #6) y devuelve un análisis
// agregado con issues priorizados.
//
// Runtime: Edge — compatible con plan free de Vercel (25s timeout).
// Para sitios PYME hasta 50 URLs cabe bien en el timeout.
//
// Respuesta incluye:
//   - discovery: { source, total_discovered, analyzed, truncated }
//   - sitemap_quality: { score, pct_lastmod, pct_priority, ... } | null
//   - pages: [...]
//   - analysis: { summary, issues, samples, link_graph, schema_types_found }
//   - top_landing_pages: [...]  ← NUEVO Sesión #6
//   - llms_txt_suggested: { content, stats } | null
//   - duration_ms, log

import { crawlSite } from '../lib/crawler.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return jsonResponse(
      { error: 'URL requerida (?url=https://ejemplo.com)' },
      400,
      corsHeaders
    );
  }

  // Normalizar
  let target = url;
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  try {
    new URL(target);
  } catch {
    return jsonResponse({ error: 'URL inválida' }, 400, corsHeaders);
  }

  // Parámetros opcionales
  // Cap default 50 para caber en 25s de Edge en plan free.
  // Subir solo si tienes pro o sitios muy rápidos.
  const maxUrls = clamp(parseInt(searchParams.get('max')) || 50, 1, 100);
  const concurrency = clamp(parseInt(searchParams.get('concurrency')) || 8, 1, 15);
  const topLanding = clamp(parseInt(searchParams.get('top_landing')) || 5, 1, 10);

  console.log(`🕷 Crawl: ${target} (max=${maxUrls}, conc=${concurrency}, top_landing=${topLanding})`);

  try {
    const result = await crawlSite(target, {
      maxUrls,
      concurrency,
      topLandingCount: topLanding,
    });
    return jsonResponse(result, 200, {
      ...corsHeaders,
      'Cache-Control': 'no-store',
    });
  } catch (e) {
    console.error('❌ Crawl fatal:', e);
    return jsonResponse(
      { error: 'Crawl failed', message: e.message },
      500,
      corsHeaders
    );
  }
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
