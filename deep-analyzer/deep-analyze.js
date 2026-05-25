/**
 * Deep Analyzer v2 — análisis profundo local para uso interno.
 *
 * v2 vs v1 (sesión #11, 2026-05-19):
 *   - Bugs corregidos: lee parsePage correctamente (page.title.value, page.meta.value, headings.h1_count)
 *   - Integra detectStack (CRM/Analytics/Ads/Chat/bots-IA + madurez digital)
 *   - Integra rankLandingPages + buildLandingDashboard (Top 5 LPs)
 *   - Integra filterPagespeed (opportunities, diagnostics, SEO/A11y issues)
 *   - PageSpeed con captura de errores real
 *   - HTML coherente con el dashboard del front: dark indigo/lime
 *
 * USO desde CMD (Windows):
 *   cd C:\Users\sandr\Desktop\agencia-web\deep-analyzer
 *   set PAGESPEED_API_KEY=tu_clave_aqui
 *   node deep-analyze.js https://celes.ai
 *
 * Flags:
 *   --max=N             N máximo de páginas (default 100, cap 200)
 *   --no-pagespeed      Skip PageSpeed
 *   --concurrency=N     Páginas en paralelo (default 5)
 *
 * Salida en reports/:
 *   dominio_YYYY-MM-DD_HH-mm.html
 *   dominio_YYYY-MM-DD_HH-mm.json
 */

import { parsePage } from '../lib/parsePage.js';
import { analyzeCitability } from '../lib/citabilityScore.js';
import { detectStack } from '../lib/detectStack.js';
import { filterPagespeed } from '../lib/filterPagespeed.js';
import { rankLandingPages, buildLandingDashboard } from '../lib/rankPages.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ───── CONFIG ─────
const DEFAULT_MAX_PAGES = 100;
const HARD_CAP_PAGES = 200;
const DEFAULT_CONCURRENCY = 5;
const PAGESPEED_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'NexoDeepAnalyzer/2.0 (+seo-audit)';

// ───── ARGS ─────
const args = process.argv.slice(2);
const targetUrl = args.find(a => a.startsWith('http'));
const maxArg = args.find(a => a.startsWith('--max='));
const maxPages = Math.min(HARD_CAP_PAGES, maxArg ? parseInt(maxArg.split('=')[1], 10) : DEFAULT_MAX_PAGES);
const concArg = args.find(a => a.startsWith('--concurrency='));
const concurrency = concArg ? parseInt(concArg.split('=')[1], 10) : DEFAULT_CONCURRENCY;
const skipPageSpeed = args.includes('--no-pagespeed');
const apiKey = process.env.PAGESPEED_API_KEY;

if (!targetUrl) {
  console.error('ERROR: Falta URL. Uso: node deep-analyze.js https://example.com [--max=50] [--no-pagespeed]');
  process.exit(1);
}

if (!apiKey && !skipPageSpeed) {
  console.warn('AVISO: PAGESPEED_API_KEY no definida. Usa --no-pagespeed o exporta la variable.');
  console.warn('       set PAGESPEED_API_KEY=tu_clave_aqui   (Windows CMD)');
  process.exit(1);
}

// ───── HELPERS DE RED ─────

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, error: null };
  } catch (err) {
    return { ok: false, status: 0, text: null, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

async function fetchSitemap(rootUrl) {
  const base = new URL(rootUrl);
  const candidates = [
    `${base.origin}/sitemap.xml`,
    `${base.origin}/sitemap_index.xml`,
    `${base.origin}/sitemap-index.xml`
  ];

  const collected = new Set();
  const visited = new Set();

  async function processOne(sitemapUrl) {
    if (visited.has(sitemapUrl)) return;
    visited.add(sitemapUrl);
    const res = await fetchWithTimeout(sitemapUrl);
    if (!res.ok || !res.text) return;

    const xml = res.text;
    const isIndex = /<sitemapindex/i.test(xml);

    if (isIndex) {
      const childMatches = xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi);
      for (const m of childMatches) {
        if (collected.size >= maxPages * 3) break;
        await processOne(m[1].trim());
      }
    } else {
      const urlMatches = xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi);
      for (const m of urlMatches) {
        collected.add(m[1].trim());
        if (collected.size >= maxPages * 3) break;
      }
    }
  }

  for (const sm of candidates) {
    await processOne(sm);
    if (collected.size > 0) break;
  }

  if (collected.size === 0) {
    const robots = await fetchWithTimeout(`${base.origin}/robots.txt`);
    if (robots.ok && robots.text) {
      const sitemapLines = robots.text.match(/Sitemap:\s*(\S+)/gi);
      if (sitemapLines) {
        for (const line of sitemapLines) {
          const url = line.replace(/Sitemap:\s*/i, '').trim();
          await processOne(url);
        }
      }
    }
  }

  if (collected.size === 0) {
    collected.add(rootUrl);
  }

  return Array.from(collected).slice(0, maxPages);
}

// ───── PAGESPEED ─────

async function fetchPageSpeedRaw(url, strategy) {
  const params = new URLSearchParams({ url, key: apiKey, strategy });
  ['performance', 'seo', 'accessibility', 'best-practices'].forEach(c => params.append('category', c));

  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`;
  const res = await fetchWithTimeout(apiUrl, {}, PAGESPEED_TIMEOUT_MS);

  if (!res.ok) {
    let detail = res.error || `HTTP ${res.status}`;
    if (res.text) {
      try {
        const j = JSON.parse(res.text);
        if (j.error?.message) detail += ` — ${j.error.message}`;
      } catch {}
    }
    return { raw: null, error: detail };
  }

  try {
    const data = JSON.parse(res.text);
    if (data.error) return { raw: null, error: data.error.message || 'PS error' };
    return { raw: data, error: null };
  } catch (err) {
    return { raw: null, error: 'parse_error: ' + err.message };
  }
}

// ───── ANÁLISIS POR PÁGINA ─────

async function analyzePage(url, index, total, isHome = false) {
  const startedAt = Date.now();
  process.stdout.write(`[${index + 1}/${total}] ${truncate(url, 60)} ... `);

  const result = {
    url, is_home: isHome, ok: false,
    fetched_at: new Date().toISOString(),
    page: null, citability: null,
    pagespeed: null,
    pagespeed_errors: { mobile: null, desktop: null },
    error: null, duration_ms: 0
  };

  const htmlRes = await fetchWithTimeout(url);
  if (!htmlRes.ok || !htmlRes.text) {
    result.error = htmlRes.error || `HTTP ${htmlRes.status}`;
    result.duration_ms = Date.now() - startedAt;
    console.log(`ERROR (${result.error})`);
    return result;
  }

  const html = htmlRes.text;

  try {
    result.page = parsePage(html, url);
    result.citability = analyzeCitability(html, result.page);
    result.ok = true;
  } catch (err) {
    result.error = 'parse_error: ' + err.message;
    result.duration_ms = Date.now() - startedAt;
    console.log(`ERROR (${result.error})`);
    return result;
  }

  if (!skipPageSpeed) {
    const [m, d] = await Promise.all([
      fetchPageSpeedRaw(url, 'mobile'),
      fetchPageSpeedRaw(url, 'desktop')
    ]);
    result.pagespeed_errors.mobile = m.error;
    result.pagespeed_errors.desktop = d.error;

    if (m.raw || d.raw) {
      try {
        result.pagespeed = filterPagespeed(m.raw, d.raw, { url });
      } catch (err) {
        result.pagespeed = null;
        result.error = (result.error ? result.error + ' | ' : '') + 'filterPagespeed: ' + err.message;
      }
    }
  }

  result.duration_ms = Date.now() - startedAt;
  const psNote = skipPageSpeed
    ? ''
    : (result.pagespeed ? '' : ` [PS:${result.pagespeed_errors.mobile || result.pagespeed_errors.desktop || 'null'}]`);
  console.log(`OK (${(result.duration_ms / 1000).toFixed(1)}s)${psNote}`);

  if (isHome) result._html = html;
  return result;
}

// ───── LINK GRAPH ─────

function buildLinkGraph(pages, origin) {
  const counts = new Map();
  for (const p of pages) {
    if (!p.ok || !p.page?.links?.internal) continue;
    for (const link of p.page.links.internal) {
      const href = (link.href || '').replace(/#.*$/, '').replace(/\?.*$/, '');
      if (!href) continue;
      const norm = href.endsWith('/') && href !== origin + '/' ? href.slice(0, -1) : href;
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([url, inbound_count]) => ({ url, inbound_count }))
    .sort((a, b) => b.inbound_count - a.inbound_count);
}

// ───── CONCURRENCIA ─────

async function runWithConcurrency(items, fn, conc) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i, items.length);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return results;
}

// ───── AGREGACIÓN ─────

function aggregateResults(pages) {
  const valid = pages.filter(p => p.ok && p.page);

  const avg = (getter) => {
    const vals = valid.map(getter).filter(v => v != null && !isNaN(v));
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  const citAvg = avg(p => p.citability?.score);
  const citDist = { excellent: 0, good: 0, fair: 0, poor: 0 };
  valid.forEach(p => {
    const s = p.citability?.score || 0;
    if (s >= 80) citDist.excellent++;
    else if (s >= 60) citDist.good++;
    else if (s >= 40) citDist.fair++;
    else citDist.poor++;
  });

  const psMobPerf = avg(p => p.pagespeed?.mobile?.scores?.performance);
  const psDeskPerf = avg(p => p.pagespeed?.desktop?.scores?.performance);
  const psMobSeo = avg(p => p.pagespeed?.mobile?.scores?.seo);
  const psDeskSeo = avg(p => p.pagespeed?.desktop?.scores?.seo);
  const psMobA11y = avg(p => p.pagespeed?.mobile?.scores?.accessibility);
  const psMobBp = avg(p => p.pagespeed?.mobile?.scores?.best_practices);
  const lcpMobAvg = avg(p => p.pagespeed?.mobile?.lab_metrics?.lcp?.value);

  const clsMobAvg = (() => {
    const vals = valid.map(p => p.pagespeed?.mobile?.lab_metrics?.cls?.value).filter(v => v != null);
    if (vals.length === 0) return null;
    return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3));
  })();

  const withAnySchema = valid.filter(p => (p.page.schema?.count || 0) > 0).length;
  const allSchemaTypes = new Set();
  valid.forEach(p => (p.page.schema?.types || []).forEach(t => allSchemaTypes.add(t)));

  const missingTitle = valid.filter(p => !p.page.title?.value).length;
  const titleOutOfRange = valid.filter(p => p.page.title?.value && !p.page.title.ok).length;
  const missingDesc = valid.filter(p => !p.page.meta?.value).length;
  const descOutOfRange = valid.filter(p => p.page.meta?.value && !p.page.meta.ok).length;
  const missingH1 = valid.filter(p => (p.page.headings?.h1_count || 0) === 0).length;
  const multipleH1 = valid.filter(p => (p.page.headings?.h1_count || 0) > 1).length;
  const missingCanonical = valid.filter(p => !p.page.canonical?.value).length;
  const missingOg = valid.filter(p => !p.page.open_graph?.ok).length;
  const imgsNoAlt = valid.reduce((sum, p) => sum + (p.page.images?.without_alt || 0), 0);
  const thinContent = valid.filter(p => (p.page.word_count || 0) < 300).length;
  const noViewport = valid.filter(p => !p.page.technical?.has_viewport).length;

  const oppByType = new Map();
  for (const p of valid) {
    const opps = p.pagespeed?.mobile?.opportunities || [];
    for (const o of opps) {
      const entry = oppByType.get(o.id) || { id: o.id, title: o.title, count: 0, total_savings_ms: 0 };
      entry.count++;
      entry.total_savings_ms += (o.savings_ms || 0);
      oppByType.set(o.id, entry);
    }
  }
  const topOpportunities = Array.from(oppByType.values())
    .sort((a, b) => b.total_savings_ms - a.total_savings_ms)
    .slice(0, 8);

  return {
    total_pages: pages.length,
    valid_pages: valid.length,
    failed_pages: pages.length - valid.length,
    citability: { avg: citAvg, distribution: citDist },
    pagespeed: {
      mobile: { performance: psMobPerf, seo: psMobSeo, accessibility: psMobA11y, best_practices: psMobBp },
      desktop: { performance: psDeskPerf, seo: psDeskSeo },
      lcp_mobile_avg_ms: lcpMobAvg,
      cls_mobile_avg: clsMobAvg,
      top_opportunities: topOpportunities
    },
    schema: {
      pages_with_any: withAnySchema,
      types_found: Array.from(allSchemaTypes).sort()
    },
    issues: {
      missing_title: missingTitle,
      title_out_of_range: titleOutOfRange,
      missing_description: missingDesc,
      description_out_of_range: descOutOfRange,
      missing_h1: missingH1,
      multiple_h1: multipleH1,
      missing_canonical: missingCanonical,
      missing_og: missingOg,
      images_without_alt: imgsNoAlt,
      thin_content: thinContent,
      no_viewport: noViewport
    }
  };
}

// ───── HTML REPORT (dark indigo/lime, coherente con dashboard front) ─────

function generateHtmlReport({ targetUrl, pages, summary, stack, topLPs, meta }) {
  const valid = pages.filter(p => p.ok);
  const errors = pages.filter(p => !p.ok);

  const fmtMs = ms => ms == null ? '—' : (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
  const fmtScore = s => s == null ? '—' : s;
  const scoreColor = s => s == null ? '#64748B' : s >= 80 ? '#A3E635' : s >= 50 ? '#F59E0B' : '#EF4444';
  const ratingLabel = s => s == null ? '—' : s >= 80 ? 'Excelente' : s >= 60 ? 'Bueno' : s >= 40 ? 'Aceptable' : 'Pobre';

  const sortedPages = [...valid].sort((a, b) => (a.citability?.score || 0) - (b.citability?.score || 0));
  const pageRows = sortedPages.map(p => {
    const cit = p.citability?.score;
    const pm = p.pagespeed?.mobile?.scores?.performance;
    const pd = p.pagespeed?.desktop?.scores?.performance;
    const seo = p.pagespeed?.mobile?.scores?.seo;
    const lcp = p.pagespeed?.mobile?.lab_metrics?.lcp?.value;
    const schemaCount = p.page.schema?.count || 0;
    const types = (p.page.schema?.types || []).slice(0, 3).join(', ');
    const title = p.page.title?.value || '(sin title)';
    const h1n = p.page.headings?.h1_count || 0;
    const words = p.page.word_count || 0;
    return `
      <tr>
        <td class="url"><a href="${esc(p.url)}" target="_blank">${esc(truncate(p.url, 50))}</a></td>
        <td class="title" title="${esc(title)}">${esc(truncate(title, 45))}</td>
        <td class="num" style="color:${scoreColor(cit)}"><b>${fmtScore(cit)}</b></td>
        <td class="num" style="color:${scoreColor(pm)}">${fmtScore(pm)}</td>
        <td class="num" style="color:${scoreColor(pd)}">${fmtScore(pd)}</td>
        <td class="num" style="color:${scoreColor(seo)}">${fmtScore(seo)}</td>
        <td class="num">${fmtMs(lcp)}</td>
        <td class="num">${schemaCount}</td>
        <td class="mono small">${esc(types)}</td>
        <td class="num">${words.toLocaleString()}</td>
        <td>${h1n === 1 ? '<span class="ok">✓</span>' : h1n === 0 ? '<span class="bad">0</span>' : `<span class="warn">${h1n}</span>`}</td>
      </tr>`;
  }).join('');

  const errorRows = errors.map(p => `
    <tr>
      <td class="url"><a href="${esc(p.url)}" target="_blank">${esc(truncate(p.url, 60))}</a></td>
      <td class="mono small bad">${esc(p.error || 'unknown')}</td>
    </tr>`).join('');

  const topLPsHtml = topLPs.length === 0 ? '' : `
    <h2>Top ${topLPs.length} Landing Pages</h2>
    <p class="sub">Páginas estratégicas del sitio según ranking heurístico (tipo de página, profundidad, inbound links, contenido, citability).</p>
    <div class="lp-grid">
      ${topLPs.map(lp => `
        <div class="lp-card">
          <div class="lp-head">
            <span class="lp-type">${esc(lp.page_type)}</span>
            <span class="lp-rank">rank ${lp.rank_score}</span>
          </div>
          <div class="lp-title">${esc(truncate(lp.title || '(sin title)', 60))}</div>
          <div class="lp-url"><a href="${esc(lp.url)}" target="_blank">${esc(truncate(lp.url, 70))}</a></div>
          <div class="lp-scores">
            <div><span class="lbl">SEO</span> <b style="color:${scoreColor(lp.mini_seo_score)}">${lp.mini_seo_score}</b></div>
            <div><span class="lbl">AEO</span> <b style="color:${scoreColor(lp.mini_aeo_score)}">${lp.mini_aeo_score}</b></div>
            <div><span class="lbl">Inbound</span> <b>${lp.inbound_count}</b></div>
            <div><span class="lbl">Words</span> <b>${(lp.word_count || 0).toLocaleString()}</b></div>
          </div>
          ${lp.top_issues && lp.top_issues.length > 0 ? `
          <div class="lp-issues">
            ${lp.top_issues.map(iss => `
              <div class="lp-issue ${iss.p}">
                <span class="iss-cat">${esc(iss.cat || '')}</span>
                <span class="iss-t">${esc(iss.t)}</span>
              </div>`).join('')}
          </div>` : ''}
        </div>
      `).join('')}
    </div>`;

  let stackHtml = '';
  if (stack) {
    const stackBlock = (title, items) => `
      <div class="stack-block">
        <div class="stack-block-h">${title} <span class="badge">${items.length}</span></div>
        ${items.length === 0
          ? '<div class="stack-empty">— No detectado</div>'
          : `<div class="stack-items">${items.map(d => `<span class="stack-pill">${esc(d.name)}${d.legacy ? ' <span class="legacy">legacy</span>' : ''}</span>`).join('')}</div>`
        }
      </div>`;

    const aiBots = stack.ai_bots_policy?.bots || [];
    const allowed = aiBots.filter(b => b.status === 'allowed' || b.status === 'partial');
    const disallowed = aiBots.filter(b => b.status === 'disallowed');
    const notSpec = aiBots.filter(b => b.status === 'not_specified');

    stackHtml = `
      <h2>Stack digital detectado <span class="kpi-pill">Madurez ${stack.maturity_score}/100</span></h2>
      <p class="sub">Detectado del HTML de la home y del robots.txt. No incluye scripts inyectados dinámicamente por GTM.</p>
      <div class="stack-grid">
        ${stackBlock('CRM & Captación', stack.crm?.detected || [])}
        ${stackBlock('Analytics & BI', stack.analytics?.detected || [])}
        ${stackBlock('Paid Media (pixels)', stack.ads?.detected || [])}
        ${stackBlock('Chat / Atención', stack.chat?.detected || [])}
      </div>
      <div class="ai-bots-block">
        <div class="stack-block-h">Política bots-IA en robots.txt</div>
        <div class="ai-summary">
          <span class="ai-stat allow">${allowed.length} permitidos</span>
          <span class="ai-stat block">${disallowed.length} bloqueados</span>
          <span class="ai-stat ns">${notSpec.length} no especificados</span>
        </div>
      </div>
      ${stack.recommendations && stack.recommendations.length > 0 ? `
        <h3 class="rec-h">Recomendaciones por área</h3>
        <div class="rec-list">
          ${stack.recommendations.map(r => `
            <div class="rec rec-${r.severity}">
              <div class="rec-head"><span class="rec-area">${esc(r.area)}</span><span class="rec-sev">${esc(r.severity)}</span></div>
              <div class="rec-t">${esc(r.title)}</div>
              <div class="rec-d">${esc(r.detail)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  const oppsHtml = (summary.pagespeed.top_opportunities || []).length === 0
    ? ''
    : `
      <h2>Top oportunidades de velocidad (mobile)</h2>
      <p class="sub">Sumario de las optimizaciones de PageSpeed con mayor potencial de ahorro agregado en el sitio.</p>
      <div class="opps-list">
        ${summary.pagespeed.top_opportunities.map(o => `
          <div class="opp">
            <div class="opp-t">${esc(o.title)}</div>
            <div class="opp-meta">
              <span class="opp-pill">${o.count} ${o.count === 1 ? 'página' : 'páginas'}</span>
              <span class="opp-save">~${(o.total_savings_ms / 1000).toFixed(1)}s ahorro total</span>
            </div>
          </div>
        `).join('')}
      </div>`;

  const psErrorList = [];
  for (const p of valid) {
    if (p.pagespeed_errors?.mobile) psErrorList.push({ url: p.url, strategy: 'mobile', error: p.pagespeed_errors.mobile });
    if (p.pagespeed_errors?.desktop) psErrorList.push({ url: p.url, strategy: 'desktop', error: p.pagespeed_errors.desktop });
  }
  const psErrorsHtml = psErrorList.length === 0 ? '' : `
    <h3 class="rec-h">⚠ PageSpeed: errores capturados (${psErrorList.length})</h3>
    <p class="sub">Si todos dicen lo mismo (ej: "API key not valid" o "Requests from referer ... are blocked"), revisa restricciones de la API key en Google Cloud Console.</p>
    <div class="ps-errors">
      ${psErrorList.slice(0, 10).map(e => `<div class="ps-err"><span class="mono small">${esc(e.strategy)}</span> ${esc(truncate(e.url, 50))} <span class="bad">${esc(e.error)}</span></div>`).join('')}
      ${psErrorList.length > 10 ? `<div class="ps-err-more">... y ${psErrorList.length - 10} más (ver JSON crudo)</div>` : ''}
    </div>`;

  const sevHigh =
    (summary.issues.missing_title + summary.issues.missing_description + summary.issues.missing_h1 + summary.issues.multiple_h1) +
    (stack?.recommendations?.filter(r => r.severity === 'high').length || 0);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Deep Analysis · ${esc(targetUrl)}</title>
<style>
  * { box-sizing: border-box; }
  :root {
    --bg: #0B1220; --bg2: #111827; --bg3: #0F1A2E; --bg4: #162035;
    --bord: rgba(255,255,255,0.08);
    --ind: #4F46E5; --ind2: #6366F1; --ind3: #818CF8;
    --lime: #A3E635; --lime2: #BEF264;
    --white: #FFFFFF; --gray: #94A3B8; --gray2: #64748B;
    --good: #A3E635; --warn: #F59E0B; --bad: #EF4444;
  }
  body {
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: var(--white); background: var(--bg); margin: 0; padding: 0;
  }
  .container { max-width: 1280px; margin: 0 auto; padding: 48px 36px 80px; }
  h1 { font-size: 30px; letter-spacing: -0.5px; margin: 0 0 10px; font-weight: 700; }
  h1 .accent { color: var(--lime); }
  h2 {
    font-size: 19px; font-weight: 600; margin: 56px 0 6px;
    letter-spacing: -0.2px; color: var(--white);
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  h2::before {
    content: '//'; color: var(--ind3);
    font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 500;
  }
  h3.rec-h {
    font-size: 14px; font-weight: 600; color: var(--gray); margin: 28px 0 12px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .sub { color: var(--gray); font-size: 13.5px; margin: 0 0 22px; line-height: 1.65; max-width: 720px; }
  .meta { color: var(--gray); font-size: 13px; margin-bottom: 6px; }
  .meta b { color: var(--white); font-weight: 600; }
  .domain { color: var(--lime); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 20px 0; }
  .card {
    background: var(--bg3); border: 1px solid var(--bord); border-radius: 12px;
    padding: 22px 20px; position: relative; overflow: hidden;
  }
  .card.hi { border-color: rgba(163,230,53,0.22); background: rgba(163,230,53,0.025); }
  .card .label {
    font-size: 11px; text-transform: uppercase; color: var(--gray2);
    letter-spacing: 0.06em; margin-bottom: 10px; font-weight: 600;
  }
  .card .value { font-size: 32px; font-weight: 700; line-height: 1; letter-spacing: -1px; }
  .card .sub { font-size: 11px; color: var(--gray); margin-top: 6px; font-weight: 400; }
  .banner {
    background: var(--bg2); border: 1px solid var(--bord); border-left: 3px solid var(--ind);
    border-radius: 10px; padding: 16px 22px; margin: 20px 0 28px;
    color: var(--gray); font-size: 13.5px; line-height: 1.65;
  }
  .banner.warn { border-left-color: var(--warn); }
  .banner.bad { border-left-color: var(--bad); }
  .banner b { color: var(--white); font-weight: 600; }
  .dist { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
  .dist .d { background: var(--bg3); border: 1px solid var(--bord); border-radius: 10px; padding: 16px 18px; }
  .dist .d .lbl { font-size: 11px; text-transform: uppercase; color: var(--gray2); letter-spacing: 0.05em; margin-bottom: 8px; }
  .dist .d .v { font-size: 22px; font-weight: 700; }
  .issues { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .issue {
    padding: 11px 16px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--bord);
    border-left: 2px solid var(--warn); font-size: 13px;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }
  .issue.ok { border-left-color: var(--good); opacity: 0.6; }
  .issue.bad { border-left-color: var(--bad); }
  .issue b { color: var(--white); font-weight: 700; font-family: 'JetBrains Mono', monospace; margin-right: 4px; }
  .issue .pct { color: var(--gray2); font-size: 11px; font-family: 'JetBrains Mono', monospace; }
  table {
    width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 10px;
    background: var(--bg3); border: 1px solid var(--bord); border-radius: 10px; overflow: hidden;
  }
  th {
    text-align: left; padding: 12px 10px; background: var(--bg4);
    border-bottom: 1px solid var(--bord); font-weight: 600; font-size: 10.5px;
    text-transform: uppercase; color: var(--gray); letter-spacing: 0.05em;
  }
  td { padding: 10px; border-bottom: 1px solid var(--bord); vertical-align: middle; color: var(--gray); }
  td.url { max-width: 280px; word-break: break-all; }
  td.url a { color: var(--ind3); text-decoration: none; }
  td.url a:hover { color: var(--ind2); text-decoration: underline; }
  td.title { color: var(--white); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.num { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
  td.mono { font-family: 'JetBrains Mono', monospace; color: var(--gray2); }
  td.small { font-size: 11px; }
  .ok { color: var(--good); }
  .bad { color: var(--bad); }
  .warn { color: var(--warn); }
  .stack-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 0; }
  .stack-block { background: var(--bg3); border: 1px solid var(--bord); border-radius: 10px; padding: 18px 20px; }
  .stack-block-h {
    font-size: 12px; font-weight: 600; color: var(--gray);
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .stack-block-h .badge {
    background: var(--bg4); color: var(--ind3); padding: 2px 8px;
    border-radius: 20px; font-size: 11px; font-family: 'JetBrains Mono', monospace; font-weight: 600;
  }
  .stack-empty { color: var(--gray2); font-style: italic; font-size: 13px; }
  .stack-items { display: flex; flex-wrap: wrap; gap: 6px; }
  .stack-pill {
    background: rgba(79,70,229,0.1); color: var(--ind3);
    border: 1px solid rgba(79,70,229,0.25); padding: 4px 10px; border-radius: 20px; font-size: 12px;
  }
  .stack-pill .legacy { background: var(--bad); color: var(--white); padding: 1px 6px; border-radius: 4px; font-size: 9px; margin-left: 4px; font-weight: 700; }
  .ai-bots-block { background: var(--bg3); border: 1px solid var(--bord); border-radius: 10px; padding: 18px 20px; margin: 12px 0; }
  .ai-summary { display: flex; gap: 14px; flex-wrap: wrap; }
  .ai-stat { font-size: 13px; font-family: 'JetBrains Mono', monospace; }
  .ai-stat.allow { color: var(--good); }
  .ai-stat.block { color: var(--warn); }
  .ai-stat.ns { color: var(--gray2); }
  .kpi-pill {
    background: rgba(163,230,53,0.12); border: 1px solid rgba(163,230,53,0.3);
    color: var(--lime); padding: 3px 11px; border-radius: 20px;
    font-size: 12px; font-family: 'JetBrains Mono', monospace; font-weight: 600;
  }
  .rec-list { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .rec {
    background: var(--bg3); border: 1px solid var(--bord); border-left: 3px solid var(--ind);
    border-radius: 8px; padding: 14px 18px;
  }
  .rec.rec-high { border-left-color: var(--bad); }
  .rec.rec-med { border-left-color: var(--warn); }
  .rec.rec-low { border-left-color: var(--gray2); }
  .rec-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
  .rec-area { font-size: 11px; font-weight: 600; color: var(--ind3); text-transform: uppercase; letter-spacing: 0.05em; }
  .rec-sev { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--gray2); text-transform: uppercase; }
  .rec.rec-high .rec-sev { color: var(--bad); }
  .rec.rec-med .rec-sev { color: var(--warn); }
  .rec-t { color: var(--white); font-weight: 600; font-size: 13.5px; margin-bottom: 4px; }
  .rec-d { color: var(--gray); font-size: 13px; line-height: 1.6; }
  .lp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; margin: 16px 0; }
  .lp-card { background: var(--bg3); border: 1px solid var(--bord); border-radius: 12px; padding: 20px; }
  .lp-head { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .lp-type {
    background: var(--bg4); color: var(--ind3); padding: 3px 10px; border-radius: 20px;
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .lp-rank { color: var(--gray2); font-family: 'JetBrains Mono', monospace; font-size: 11px; }
  .lp-title { color: var(--white); font-weight: 600; font-size: 15px; margin-bottom: 4px; }
  .lp-url { font-size: 11px; margin-bottom: 14px; }
  .lp-url a { color: var(--gray); text-decoration: none; }
  .lp-scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .lp-scores .lbl { font-size: 9px; color: var(--gray2); text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 2px; }
  .lp-scores b { font-size: 16px; font-weight: 700; }
  .lp-issues { display: flex; flex-direction: column; gap: 5px; }
  .lp-issue { display: flex; gap: 8px; font-size: 12px; padding: 6px 10px; border-radius: 6px; background: var(--bg4); align-items: center; }
  .lp-issue.high { border-left: 2px solid var(--bad); }
  .lp-issue.med { border-left: 2px solid var(--warn); }
  .lp-issue.low { border-left: 2px solid var(--gray2); }
  .iss-cat { font-size: 9px; background: rgba(255,255,255,0.05); padding: 1px 6px; border-radius: 4px; color: var(--gray); font-family: 'JetBrains Mono', monospace; }
  .iss-t { color: var(--white); }
  .opps-list { display: grid; grid-template-columns: 1fr; gap: 8px; }
  .opp {
    background: var(--bg3); border: 1px solid var(--bord); border-radius: 8px; padding: 12px 16px;
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
  }
  .opp-t { color: var(--white); font-size: 13px; font-weight: 500; }
  .opp-meta { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
  .opp-pill { background: var(--bg4); color: var(--gray); padding: 3px 9px; border-radius: 20px; font-size: 11px; font-family: 'JetBrains Mono', monospace; }
  .opp-save { color: var(--warn); font-size: 12px; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
  .ps-errors { display: flex; flex-direction: column; gap: 4px; }
  .ps-err { background: var(--bg3); padding: 8px 12px; border-radius: 6px; font-size: 12px; color: var(--gray); }
  .ps-err-more { padding: 8px 12px; color: var(--gray2); font-style: italic; font-size: 12px; }
  .footer {
    margin-top: 70px; padding-top: 24px; border-top: 1px solid var(--bord);
    color: var(--gray2); font-size: 11.5px; line-height: 1.6;
  }
  .footer .mono { font-family: 'JetBrains Mono', monospace; color: var(--gray); }
  @media print {
    body { background: white; color: #111; }
    .container { padding: 20px; max-width: none; }
    table, .card, .stack-block, .lp-card, .opp, .rec, .ai-bots-block, .banner, .dist .d, .issue, .ps-err { background: white; border-color: #e5e7eb; color: #111; }
    td, th { color: #333; border-color: #e5e7eb; }
    .card .value, .lp-title, .opp-t, .iss-t, .rec-t, h1, h2, h3 { color: #111; }
    h2::before { color: #6b7280; }
    tr { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .grid, .dist { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="container">

  <h1>Deep <span class="accent">Analysis</span> Report</h1>
  <div class="meta">Sitio: <span class="domain">${esc(targetUrl)}</span></div>
  <div class="meta">Generado: <b>${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</b> · <b>${summary.valid_pages}/${summary.total_pages}</b> páginas analizadas · Duración: <b>${meta.duration_min} min</b></div>

  ${sevHigh > 5 ? `<div class="banner bad"><b>${sevHigh} issues críticos detectados.</b> Revisa "Issues SEO técnicos" y "Recomendaciones por área" para el plan de trabajo.</div>` : ''}

  <h2>Resumen ejecutivo</h2>
  <div class="grid">
    <div class="card hi">
      <div class="label">AEO Citability</div>
      <div class="value" style="color:${scoreColor(summary.citability.avg)}">${fmtScore(summary.citability.avg)}</div>
      <div class="sub">${ratingLabel(summary.citability.avg)} · media del sitio</div>
    </div>
    <div class="card">
      <div class="label">PageSpeed Mobile</div>
      <div class="value" style="color:${scoreColor(summary.pagespeed.mobile.performance)}">${fmtScore(summary.pagespeed.mobile.performance)}</div>
      <div class="sub">Performance</div>
    </div>
    <div class="card">
      <div class="label">PageSpeed Desktop</div>
      <div class="value" style="color:${scoreColor(summary.pagespeed.desktop.performance)}">${fmtScore(summary.pagespeed.desktop.performance)}</div>
      <div class="sub">Performance</div>
    </div>
    <div class="card">
      <div class="label">SEO Lighthouse</div>
      <div class="value" style="color:${scoreColor(summary.pagespeed.mobile.seo)}">${fmtScore(summary.pagespeed.mobile.seo)}</div>
      <div class="sub">SEO score mobile</div>
    </div>
  </div>

  <h2>Distribución AEO Citability</h2>
  <div class="dist">
    <div class="d"><div class="lbl">Excelente (80-100)</div><div class="v" style="color:var(--good)">${summary.citability.distribution.excellent}</div></div>
    <div class="d"><div class="lbl">Bueno (60-79)</div><div class="v" style="color:#84cc16">${summary.citability.distribution.good}</div></div>
    <div class="d"><div class="lbl">Aceptable (40-59)</div><div class="v" style="color:var(--warn)">${summary.citability.distribution.fair}</div></div>
    <div class="d"><div class="lbl">Pobre (0-39)</div><div class="v" style="color:var(--bad)">${summary.citability.distribution.poor}</div></div>
  </div>

  <h2>Issues SEO técnicos (agregado del sitio)</h2>
  <p class="sub">Conteo de páginas con cada tipo de problema. Verde si 0.</p>
  <div class="issues">
    ${issueLine('Sin &lt;title&gt;', summary.issues.missing_title, summary.valid_pages, 'bad')}
    ${issueLine('Title fuera de rango 30-60 chars', summary.issues.title_out_of_range, summary.valid_pages)}
    ${issueLine('Sin meta description', summary.issues.missing_description, summary.valid_pages, 'bad')}
    ${issueLine('Description fuera de rango 120-160', summary.issues.description_out_of_range, summary.valid_pages)}
    ${issueLine('Sin H1', summary.issues.missing_h1, summary.valid_pages, 'bad')}
    ${issueLine('Múltiples H1', summary.issues.multiple_h1, summary.valid_pages)}
    ${issueLine('Sin canonical', summary.issues.missing_canonical, summary.valid_pages)}
    ${issueLine('Open Graph incompleto', summary.issues.missing_og, summary.valid_pages)}
    ${issueLine('Sin schema markup', summary.valid_pages - summary.schema.pages_with_any, summary.valid_pages, 'bad')}
    ${issueLine('Thin content (&lt;300 palabras)', summary.issues.thin_content, summary.valid_pages)}
    ${issueLine('Imágenes sin alt (total)', summary.issues.images_without_alt, summary.valid_pages * 5, 'count')}
    ${issueLine('Sin viewport meta', summary.issues.no_viewport, summary.valid_pages, 'bad')}
  </div>

  <h2>Schema markup encontrado</h2>
  <div class="banner">
    <b>${summary.schema.pages_with_any}/${summary.valid_pages}</b> páginas con JSON-LD · Tipos detectados:
    ${summary.schema.types_found.length === 0 ? '<span class="bad">ninguno</span>' : summary.schema.types_found.map(t => `<span class="stack-pill" style="margin-left:6px">${esc(t)}</span>`).join(' ')}
  </div>

  ${stackHtml}

  ${topLPsHtml}

  ${oppsHtml}

  <h2>Detalle por página · ordenado por AEO ascendente</h2>
  <p class="sub">Las páginas con peor citability arriba: empieza por ahí para detectar los problemas más graves.</p>
  <table>
    <thead>
      <tr>
        <th>URL</th><th>Title</th>
        <th class="num">AEO</th><th class="num">PS Mob</th><th class="num">PS Desk</th><th class="num">SEO</th>
        <th class="num">LCP</th><th class="num">Schemas</th><th>Types</th><th class="num">Words</th><th>H1</th>
      </tr>
    </thead>
    <tbody>${pageRows}</tbody>
  </table>

  ${errors.length > 0 ? `
  <h2>Páginas con error (${errors.length})</h2>
  <table>
    <thead><tr><th>URL</th><th>Error</th></tr></thead>
    <tbody>${errorRows}</tbody>
  </table>` : ''}

  ${psErrorsHtml}

  <div class="footer">
    Deep Analysis v2 · Generado con el repo agencia-web · reutiliza <span class="mono">lib/parsePage.js</span>, <span class="mono">lib/citabilityScore.js</span>, <span class="mono">lib/detectStack.js</span>, <span class="mono">lib/filterPagespeed.js</span>, <span class="mono">lib/rankPages.js</span>.<br>
    Para PDF: <b>Ctrl+P</b> → "Guardar como PDF" en el navegador.<br>
    Informe interno · no compartir sin sanitizar.
  </div>
</div>
</body>
</html>`;
}

function issueLine(label, count, total, mode = 'normal') {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const isOk = count === 0;
  const cls = isOk ? 'ok' : (mode === 'bad' ? 'bad' : '');
  const pctStr = mode === 'count' ? '' : ` <span class="pct">${pct}%</span>`;
  return `<div class="issue ${cls}"><span><b>${count}</b> ${label}</span>${pctStr}</div>`;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ───── MAIN ─────

(async () => {
  const startedAt = Date.now();

  console.log('');
  console.log('═══ DEEP ANALYZE v2 ═══');
  console.log(`Target:      ${targetUrl}`);
  console.log(`Max pages:   ${maxPages}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`PageSpeed:   ${skipPageSpeed ? 'OFF' : 'ON (mobile+desktop)'}`);
  console.log('');

  console.log('1) Leyendo sitemap...');
  const urls = await fetchSitemap(targetUrl);
  console.log(`   ${urls.length} URLs encontradas.`);

  const origin = new URL(targetUrl).origin;
  const homeIdx = urls.findIndex(u => u === origin || u === origin + '/' || u === targetUrl);
  if (homeIdx === -1) urls.unshift(origin);
  else if (homeIdx > 0) {
    const [home] = urls.splice(homeIdx, 1);
    urls.unshift(home);
  }

  console.log('');
  console.log(`2) Analizando ${urls.length} páginas (concurrencia ${concurrency})...`);

  const pages = await runWithConcurrency(
    urls,
    (url, i, total) => analyzePage(url, i, total, i === 0),
    concurrency
  );

  console.log('');

  console.log('3) Detectando stack digital (sobre home)...');
  let stack = null;
  const homePage = pages.find(p => p.is_home);
  if (homePage && homePage._html) {
    const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`);
    const robotsTxt = robotsRes.ok ? robotsRes.text : null;
    try {
      stack = detectStack(homePage._html, robotsTxt);
      console.log(`   Madurez digital: ${stack.maturity_score}/100`);
    } catch (err) {
      console.log(`   ERROR: ${err.message}`);
    }
  } else {
    console.log('   No hay HTML de home, skip.');
  }

  console.log('4) Calculando Top Landing Pages...');
  const pagesForRanking = pages.filter(p => p.ok).map(p => ({
    ...p.page,
    ok: true,
    citability: p.citability
  }));
  const linkGraph = buildLinkGraph(pages, origin);
  const ranked = rankLandingPages(pagesForRanking, origin, linkGraph, 5);
  const topLPs = ranked.map(r => buildLandingDashboard(r)).filter(Boolean);
  console.log(`   ${topLPs.length} LPs identificadas.`);

  console.log('5) Agregando métricas...');
  const summary = aggregateResults(pages);

  const durationMs = Date.now() - startedAt;
  const meta = {
    started_at: new Date(startedAt).toISOString(),
    duration_ms: durationMs,
    duration_min: (durationMs / 60000).toFixed(1),
    config: { maxPages, concurrency, skipPageSpeed }
  };

  for (const p of pages) delete p._html;

  const reportsDir = join(__dirname, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const safeName = targetUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const baseName = `${safeName}_${stamp}`;

  const jsonPath = join(reportsDir, `${baseName}.json`);
  const htmlPath = join(reportsDir, `${baseName}.html`);

  const jsonOutput = { target: targetUrl, meta, summary, stack, top_landing_pages: topLPs, pages };
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2), 'utf8');
  writeFileSync(htmlPath, generateHtmlReport({ targetUrl, pages, summary, stack, topLPs, meta }), 'utf8');

  console.log('');
  console.log('═══ DONE ═══');
  console.log(`Duración:     ${meta.duration_min} min`);
  console.log(`Válidas:      ${summary.valid_pages}/${summary.total_pages}`);
  console.log(`AEO media:    ${summary.citability.avg ?? '—'}/100`);
  console.log(`PS Mobile:    ${summary.pagespeed.mobile.performance ?? '—'}/100`);
  console.log(`PS Desktop:   ${summary.pagespeed.desktop.performance ?? '—'}/100`);
  if (stack) console.log(`Stack score:  ${stack.maturity_score}/100`);
  console.log(`Top LPs:      ${topLPs.length}`);
  console.log('');
  console.log(`HTML:  ${htmlPath}`);
  console.log(`JSON:  ${jsonPath}`);
  console.log('');
  console.log('Abre el HTML en navegador. Ctrl+P → "Guardar como PDF" para entregable.');
})().catch(err => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
