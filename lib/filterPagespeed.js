/**
 * Filtra la respuesta de PageSpeed API (mobile + desktop) y deja solo lo accionable.
 *
 * Pensado para 3 usos simultáneos:
 *   1. Informe al cliente (campos legibles, displayValue)
 *   2. Dashboard + histórico (scores y métricas numéricas comparables)
 *   3. Input a LLM que genera plan de 6 semanas (detalle técnico por archivo)
 *
 * @param {Object} mobileRaw - Respuesta cruda de PageSpeed mobile
 * @param {Object} desktopRaw - Respuesta cruda de PageSpeed desktop
 * @param {Object} [meta] - Metadata opcional ({ url, client, run_id })
 * @returns {Object} - Estructura compacta lista para los 3 usos
 */
function filterPagespeed(mobileRaw, desktopRaw, meta = {}) {
  return {
    url: meta.url || mobileRaw?.lighthouseResult?.finalUrl || null,
    client: meta.client || null,
    run_id: meta.run_id || null,
    fetched_at: new Date().toISOString(),

    mobile: extractStrategy(mobileRaw),
    desktop: extractStrategy(desktopRaw),

    summary: buildSummary(mobileRaw, desktopRaw),
  };
}

function extractStrategy(raw) {
  if (!raw?.lighthouseResult) return null;
  const lh = raw.lighthouseResult;
  const audits = lh.audits || {};
  const cats = lh.categories || {};

  return {
    scores: {
      performance: pct(cats.performance?.score),
      accessibility: pct(cats.accessibility?.score),
      best_practices: pct(cats['best-practices']?.score),
      seo: pct(cats.seo?.score),
    },
    field_data: extractCrux(raw.loadingExperience),
    lab_metrics: {
      lcp: extractMetric(audits['largest-contentful-paint']),
      fcp: extractMetric(audits['first-contentful-paint']),
      cls: extractMetric(audits['cumulative-layout-shift']),
      tbt: extractMetric(audits['total-blocking-time']),
      si: extractMetric(audits['speed-index']),
      tti: extractMetric(audits['interactive']),
      ttfb: extractMetric(audits['server-response-time']),
    },
    opportunities: extractOpportunities(audits),
    diagnostics: {
      total_byte_weight: extractMetric(audits['total-byte-weight']),
      dom_size: extractMetric(audits['dom-size']),
      main_thread_work: extractMetric(audits['mainthread-work-breakdown']),
      bootup_time: extractMetric(audits['bootup-time']),
      network_requests_count: audits['network-requests']?.details?.items?.length ?? null,
    },
    seo_issues: extractSeoIssues(audits),
    a11y_issues: extractA11yIssues(audits),
  };
}

const pct = (s) => (s != null ? Math.round(s * 100) : null);

function extractMetric(audit) {
  if (!audit) return null;
  return {
    value: audit.numericValue ?? null,
    unit: audit.numericUnit ?? null,
    display: audit.displayValue ?? null,
    score: audit.score,
    rating: rateScore(audit.score),
  };
}

function rateScore(score) {
  if (score == null) return null;
  if (score >= 0.9) return 'good';
  if (score >= 0.5) return 'needs_improvement';
  return 'poor';
}

function extractCrux(exp) {
  if (!exp?.metrics) return null;
  const m = exp.metrics;
  const get = (key) => {
    const metric = m[key];
    if (!metric) return null;
    return { p75: metric.percentile, category: metric.category };
  };
  return {
    lcp: get('LARGEST_CONTENTFUL_PAINT_MS'),
    fcp: get('FIRST_CONTENTFUL_PAINT_MS'),
    cls: get('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
    inp: get('INTERACTION_TO_NEXT_PAINT'),
    ttfb: get('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    overall: exp.overall_category ?? null,
  };
}

function extractOpportunities(audits) {
  const ids = [
    'render-blocking-resources',
    'unused-javascript',
    'unused-css-rules',
    'unminified-javascript',
    'unminified-css',
    'modern-image-formats',
    'uses-optimized-images',
    'uses-responsive-images',
    'efficient-animated-content',
    'duplicated-javascript',
    'legacy-javascript',
    'redirects',
    'server-response-time',
    'uses-text-compression',
    'uses-long-cache-ttl',
    'uses-rel-preconnect',
    'font-display',
    'preload-lcp-image',
    'lcp-lazy-loaded',
    'third-party-summary',
  ];

  const opps = [];
  for (const id of ids) {
    const a = audits[id];
    if (!a || a.score == null || a.score >= 0.9) continue;

    const items = (a.details?.items || []).slice(0, 5).map((item) => ({
      url: item.url ?? null,
      total_bytes: item.totalBytes ?? null,
      wasted_bytes: item.wastedBytes ?? null,
      wasted_ms: item.wastedMs ?? null,
      source: item.source ?? null,
      duration: item.duration ?? null,
    }));

    opps.push({
      id,
      title: a.title,
      score: a.score,
      rating: rateScore(a.score),
      savings_ms: a.details?.overallSavingsMs ?? null,
      savings_bytes: a.details?.overallSavingsBytes ?? null,
      display: a.displayValue ?? null,
      affected_resources: items,
      affected_count: a.details?.items?.length ?? 0,
    });
  }

  return opps.sort((a, b) => {
    const ms = (b.savings_ms ?? 0) - (a.savings_ms ?? 0);
    if (ms !== 0) return ms;
    return (b.savings_bytes ?? 0) - (a.savings_bytes ?? 0);
  });
}

function extractSeoIssues(audits) {
  const ids = [
    'meta-description', 'document-title', 'http-status-code', 'link-text',
    'crawlable-anchors', 'is-crawlable', 'robots-txt', 'image-alt',
    'hreflang', 'canonical', 'structured-data', 'viewport',
  ];
  return collectFailedAudits(audits, ids);
}

function extractA11yIssues(audits) {
  const ids = [
    'color-contrast', 'image-alt', 'label', 'link-name', 'button-name',
    'document-title', 'html-has-lang', 'meta-viewport', 'heading-order',
    'landmark-one-main', 'duplicate-id-aria', 'aria-required-attr', 'aria-valid-attr',
  ];
  return collectFailedAudits(audits, ids);
}

function collectFailedAudits(audits, ids) {
  const issues = [];
  for (const id of ids) {
    const a = audits[id];
    if (!a || a.score == null || a.score === 1) continue;
    issues.push({
      id,
      title: a.title,
      score: a.score,
      rating: rateScore(a.score),
      affected_count: a.details?.items?.length ?? 0,
      sample: (a.details?.items || []).slice(0, 3),
    });
  }
  return issues;
}

function buildSummary(mobileRaw, desktopRaw) {
  const m = mobileRaw?.lighthouseResult?.categories || {};
  const d = desktopRaw?.lighthouseResult?.categories || {};

  return {
    scores_diff: {
      performance: { mobile: pct(m.performance?.score), desktop: pct(d.performance?.score) },
      seo: { mobile: pct(m.seo?.score), desktop: pct(d.seo?.score) },
      accessibility: { mobile: pct(m.accessibility?.score), desktop: pct(d.accessibility?.score) },
      best_practices: { mobile: pct(m['best-practices']?.score), desktop: pct(d['best-practices']?.score) },
    },
    cwv_status: {
      mobile: mobileRaw?.loadingExperience?.overall_category ?? null,
      desktop: desktopRaw?.loadingExperience?.overall_category ?? null,
    },
    passes_cwv: {
      mobile: mobileRaw?.loadingExperience?.overall_category === 'FAST',
      desktop: desktopRaw?.loadingExperience?.overall_category === 'FAST',
    },
  };
}

export { filterPagespeed };
