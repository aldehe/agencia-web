/**
 * AEO Citability Score — análisis de citabilidad por LLMs.
 *
 * Mientras validateSchema.js mira el JSON-LD, este módulo mira el CONTENIDO
 * VISIBLE de la página: las señales que ChatGPT/Perplexity/Claude usan para
 * decidir si citar una página y cómo presentarla.
 *
 * Sin dependencias, sin APIs externas. Heurística basada en best practices
 * empíricas de E-E-A-T de Google y patrones observados en respuestas de LLMs.
 *
 * Score 0-100 ponderado por 8 dimensiones.
 */

export function analyzeCitability(html, parsed) {
  if (!html || typeof html !== 'string') {
    return { score: 0, rating: 'no_data', dimensions: {}, signals: [], gaps: [] };
  }

  // Texto visible (sin scripts, styles, tags)
  const visibleText = extractVisibleText(html);

  // 8 dimensiones, cada una 0-100
  const dimensions = {
    freshness: analyzeFreshness(html, visibleText, parsed),
    authorship: analyzeAuthorship(html, visibleText, parsed),
    factuality: analyzeFactuality(visibleText),
    structure: analyzeStructure(html, parsed),
    citations: analyzeCitations(html, parsed),
    expertise: analyzeExpertise(html, visibleText, parsed),
    machine_readable: analyzeMachineReadable(html, parsed),
    answer_format: analyzeAnswerFormat(html, visibleText, parsed),
  };

  // Pesos por dimensión (deben sumar 100)
  const weights = {
    freshness: 12,        // ¿Es contenido reciente?
    authorship: 18,       // ¿Quién lo firma? E-E-A-T
    factuality: 14,       // ¿Datos verificables?
    structure: 12,        // ¿Estructura escaneable?
    citations: 10,        // ¿Cita fuentes?
    expertise: 10,        // ¿Demuestra expertise?
    machine_readable: 14, // ¿Schema, metadata, llms.txt?
    answer_format: 10,    // ¿Formato Q&A, listas, definiciones?
  };

  // Score ponderado
  let totalScore = 0;
  for (const [key, weight] of Object.entries(weights)) {
    totalScore += (dimensions[key].score * weight) / 100;
  }
  const score = Math.round(totalScore);

  // Rating
  let rating;
  if (score >= 75) rating = 'excellent';
  else if (score >= 55) rating = 'good';
  else if (score >= 30) rating = 'needs_improvement';
  else rating = 'poor';

  // Compilar señales positivas y huecos accionables
  const signals = [];
  const gaps = [];
  for (const [dim, result] of Object.entries(dimensions)) {
    signals.push(...(result.signals || []).map((s) => ({ dimension: dim, message: s })));
    gaps.push(...(result.gaps || []).map((g) => ({
      dimension: dim,
      priority: g.priority || 'medium',
      message: g.message,
      fix: g.fix,
    })));
  }

  // Ordenar gaps por prioridad
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    score,
    rating,
    dimensions,
    signals,
    gaps,
    methodology:
      'AEO Citability Score: 8 dimensiones ponderadas (Authorship 18%, Freshness 12%, ' +
      'Factuality 14%, Structure 12%, Citations 10%, Expertise 10%, Machine-readable 14%, ' +
      'Answer-format 10%). Heurística propia basada en E-E-A-T y patrones observados en LLMs.',
  };
}

// ─── Dimensión 1: Freshness ──────────────────────────────────────────────────

function analyzeFreshness(html, text, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  // Buscar fechas en el contenido (no solo schema)
  const dates = findDates(text);
  const recentDates = dates.filter((d) => isRecent(d, 365)); // último año
  const veryRecentDates = dates.filter((d) => isRecent(d, 90)); // últimos 3 meses

  // Fechas en schema
  const schemaHasDate = parsed?.schema?.types?.some((t) =>
    ['Article', 'BlogPosting', 'NewsArticle'].includes(t)
  );

  if (veryRecentDates.length > 0) {
    score += 60;
    signals.push(`Contenido fresco (fecha últimos 3 meses)`);
  } else if (recentDates.length > 0) {
    score += 35;
    signals.push(`Fechas del último año detectadas`);
  } else if (dates.length > 0) {
    score += 15;
    gaps.push({
      priority: 'medium',
      message: 'Fechas detectadas pero >1 año de antigüedad',
      fix: 'Actualizar contenido o publicar contenido nuevo. Los LLMs priorizan contenido reciente.',
    });
  } else {
    gaps.push({
      priority: 'high',
      message: 'No se detectan fechas explícitas en el contenido visible',
      fix: 'Añadir fecha de publicación y actualización visible en cada página de contenido.',
    });
  }

  // Schema con fechas
  if (schemaHasDate) {
    score += 25;
    signals.push('Schema con datePublished/dateModified');
  } else {
    gaps.push({
      priority: 'medium',
      message: 'No hay schema Article/BlogPosting con fechas estructuradas',
      fix: 'Añadir schema con datePublished y dateModified.',
    });
  }

  // Markers de "Updated", "Última actualización"
  if (/última\s+actualizaci[oó]n|last\s+updated|updated\s+on|actualizado\s+el/i.test(text)) {
    score += 15;
    signals.push('Marker de "última actualización" visible');
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 2: Authorship ─────────────────────────────────────────────────

function analyzeAuthorship(html, text, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  // Schema Person/author
  const hasPersonSchema = parsed?.schema?.types?.includes('Person');
  const hasArticleSchema = parsed?.schema?.types?.some((t) =>
    ['Article', 'BlogPosting', 'NewsArticle'].includes(t)
  );

  // Patrones de autoría visible
  const hasByline = /\bby\s+[A-Z][a-záéíóúñ]+(\s+[A-Z][a-záéíóúñ]+)?|\bpor\s+[A-Z][a-záéíóúñ]+(\s+[A-Z][a-záéíóúñ]+)?/i.test(text);
  const hasAuthorSection = /<[^>]+(class|id)=["'][^"']*(author|byline|writer)[^"']*["']/i.test(html);
  const hasRelAuthor = /<a[^>]+rel=["']author["']/i.test(html);

  if (hasPersonSchema) {
    score += 35;
    signals.push('Schema Person presente');
  }

  if (hasArticleSchema) {
    score += 20;
    signals.push('Schema Article con autor estructurado');
  }

  if (hasAuthorSection) {
    score += 20;
    signals.push('Sección de autor con marcas semánticas');
  } else if (hasByline) {
    score += 12;
    signals.push('Byline visible en el contenido');
  } else if (hasRelAuthor) {
    score += 10;
  } else {
    gaps.push({
      priority: 'high',
      message: 'No se detecta autor en el contenido',
      fix: 'Añadir autor visible (byline) + schema Person con jobTitle, sameAs y bio.',
    });
  }

  // Bio del autor
  if (/about\s+the\s+author|sobre\s+el\s+autor|biograf[íi]a/i.test(text)) {
    score += 15;
    signals.push('Bio del autor detectada');
  } else if (hasByline || hasPersonSchema) {
    gaps.push({
      priority: 'medium',
      message: 'Hay autor pero falta bio visible',
      fix: 'Añadir bio breve del autor con experiencia/credenciales.',
    });
  }

  // Linkedin/perfil profesional del autor
  if (/linkedin\.com\/in\/|twitter\.com\/|x\.com\//i.test(html)) {
    score += 10;
    signals.push('Perfil social del autor enlazado');
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 3: Factuality ─────────────────────────────────────────────────

function analyzeFactuality(text) {
  const signals = [];
  const gaps = [];
  let score = 0;

  // Datos numéricos concretos (porcentajes, cifras grandes, mediciones)
  const percentages = (text.match(/\d+(?:\.\d+)?%/g) || []).length;
  const bigNumbers = (text.match(/\d{1,3}(?:[\.,]\d{3})+|\$\d+|\€\d+|\d+\s*(millones|billones|millions|billions)/gi) || []).length;
  const measurements = (text.match(/\d+(?:\.\d+)?\s*(kg|km|mph|km\/h|ms|s|gb|mb|tb)\b/gi) || []).length;

  const dataPoints = percentages + bigNumbers + measurements;

  if (dataPoints >= 5) {
    score += 50;
    signals.push(`${dataPoints} datos numéricos concretos en el contenido`);
  } else if (dataPoints >= 2) {
    score += 30;
    signals.push(`${dataPoints} datos numéricos detectados`);
  } else if (dataPoints === 1) {
    score += 10;
  } else {
    gaps.push({
      priority: 'high',
      message: 'Pocos o ningún dato numérico verificable en el contenido',
      fix: 'Los LLMs citan páginas con datos concretos (porcentajes, cifras, mediciones). Añadir estadísticas o datos cuantificables.',
    });
  }

  // Comparativas y rangos
  if (/\bvs\.?\b|\bversus\b|comparado\s+con|en\s+comparación/i.test(text)) {
    score += 15;
    signals.push('Comparativas detectadas');
  }

  // Citas explícitas a fuentes ("según X", "según un estudio de Y")
  const sourceCites = (text.match(/seg[uú]n\s+[A-Z][a-záéíóúñ]+|according\s+to\s+[A-Z][a-záéíóúñ]+|fuente:|source:/gi) || []).length;
  if (sourceCites >= 2) {
    score += 25;
    signals.push(`${sourceCites} citas a fuentes externas`);
  } else if (sourceCites === 1) {
    score += 12;
  } else {
    gaps.push({
      priority: 'medium',
      message: 'No se detectan citas explícitas a fuentes ("según X")',
      fix: 'Atribuir datos a fuentes con frases tipo "según [organismo/estudio]".',
    });
  }

  // Rangos temporales ("entre 2020 y 2024")
  if (/(?:entre|from|desde)\s+\d{4}\s+(?:y|to|hasta|and)\s+\d{4}/i.test(text)) {
    score += 10;
    signals.push('Rangos temporales detectados');
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 4: Structure ──────────────────────────────────────────────────

function analyzeStructure(html, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  const headings = parsed?.headings || {};

  // Un único H1
  if (headings.h1_count === 1) {
    score += 20;
    signals.push('Un único H1 (correcto)');
  } else if (headings.h1_count === 0) {
    gaps.push({
      priority: 'high',
      message: 'No hay H1 en la página',
      fix: 'Añadir un único H1 que describa la página.',
    });
  } else {
    gaps.push({
      priority: 'high',
      message: `${headings.h1_count} H1 detectados (debe ser 1)`,
      fix: 'Reducir a un único H1.',
    });
  }

  // Jerarquía H2 + H3
  if (headings.h2_count >= 2) {
    score += 20;
    signals.push(`${headings.h2_count} H2 (estructura clara)`);
  } else if (headings.h2_count === 1) {
    score += 10;
  } else {
    gaps.push({
      priority: 'medium',
      message: 'Falta jerarquía con H2',
      fix: 'Estructurar el contenido con H2 para secciones principales.',
    });
  }

  if (headings.h3_count >= 2) {
    score += 15;
    signals.push(`${headings.h3_count} H3 (subdivisión detallada)`);
  }

  // Listas (los LLMs las prefieren)
  const ulCount = (html.match(/<ul\b/gi) || []).length;
  const olCount = (html.match(/<ol\b/gi) || []).length;
  const lists = ulCount + olCount;

  if (lists >= 3) {
    score += 20;
    signals.push(`${lists} listas (UL/OL) — formato escaneable`);
  } else if (lists >= 1) {
    score += 12;
    signals.push(`${lists} listas`);
  } else {
    gaps.push({
      priority: 'medium',
      message: 'Sin listas en el contenido',
      fix: 'Los LLMs extraen mejor información de listas. Convertir párrafos enumerativos en listas.',
    });
  }

  // Tablas
  const tables = (html.match(/<table\b/gi) || []).length;
  if (tables >= 1) {
    score += 15;
    signals.push(`${tables} tablas (excelente para datos comparativos)`);
  }

  // Párrafos no muy largos (legibilidad)
  const paragraphs = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [];
  if (paragraphs.length > 0) {
    const avgLength = paragraphs.reduce((s, p) => s + stripTags(p).length, 0) / paragraphs.length;
    if (avgLength < 300) {
      score += 10;
      signals.push('Párrafos cortos (escaneables)');
    } else if (avgLength > 600) {
      gaps.push({
        priority: 'low',
        message: 'Párrafos muy largos (>600 caracteres promedio)',
        fix: 'Dividir párrafos largos para mejorar escaneabilidad.',
      });
    }
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 5: Citations (fuentes externas) ───────────────────────────────

function analyzeCitations(html, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  const externalLinks = parsed?.links?.external || [];

  // Links externos a dominios de autoridad (heurística simple)
  const authorityDomains = [
    'wikipedia.org', '.gov', '.edu', 'github.com', 'arxiv.org',
    'nih.gov', 'who.int', 'oecd.org', 'imf.org', 'un.org',
    'reuters.com', 'bloomberg.com', 'nytimes.com', 'wsj.com',
    'nature.com', 'science.org', 'sciencedirect.com',
    // Consultoras y research
    'mckinsey.com', 'gartner.com', 'forrester.com', 'deloitte.com',
    'pwc.com', 'kpmg.com', 'ey.com', 'bcg.com', 'accenture.com',
    'statista.com', 'forbes.com', 'hbr.org', 'mit.edu', 'stanford.edu',
    // Tech authority
    'google.com/research', 'developers.google.com', 'mozilla.org', 'w3.org',
    'rfc-editor.org', 'ietf.org',
  ];

  let authorityCount = 0;
  for (const link of externalLinks) {
    if (authorityDomains.some((d) => link.href.includes(d))) {
      authorityCount++;
    }
  }

  if (authorityCount >= 3) {
    score += 60;
    signals.push(`${authorityCount} enlaces a fuentes de autoridad`);
  } else if (authorityCount >= 1) {
    score += 30;
    signals.push(`${authorityCount} enlace a fuente de autoridad`);
  } else if (externalLinks.length >= 3) {
    score += 20;
    signals.push(`${externalLinks.length} enlaces externos (sin dominios de autoridad detectados)`);
  } else if (externalLinks.length >= 1) {
    score += 10;
  } else {
    gaps.push({
      priority: 'medium',
      message: 'Sin enlaces externos a fuentes',
      fix: 'Citar fuentes externas (estudios, medios, instituciones). Mejora E-E-A-T y citabilidad.',
    });
  }

  // Atributos rel en enlaces (nofollow/sponsored declara intención)
  const hasRelNofollow = /<a[^>]+rel=["'][^"']*nofollow/i.test(html);
  if (hasRelNofollow) {
    score += 10;
    signals.push('Uso de rel="nofollow" en enlaces (señal de cuidado editorial)');
  }

  // Footnotes / referencias
  if (/<sup\b[^>]*>\s*\[?\d+\]?\s*<\/sup>|references|referencias|bibliograf[íi]a/i.test(html)) {
    score += 30;
    signals.push('Sistema de citas/referencias detectado');
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 6: Expertise (E-E-A-T) ────────────────────────────────────────

function analyzeExpertise(html, text, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  // Palabras-señal de expertise
  const credentials = /\b(PhD|MD|MBA|CFA|CPA|ingeniero|ingeniera|doctor|doctora|profesor|profesora|expert|certificado|certificada|founder|CEO|CTO|director|directora)\b/i;
  if (credentials.test(text)) {
    score += 25;
    signals.push('Credenciales/cargos profesionales mencionados');
  }

  // Páginas "Sobre nosotros" o equipo enlazadas
  const aboutLinks = parsed?.links?.internal?.filter((l) =>
    /\/about|\/sobre|\/team|\/equipo|\/nosotros/.test(l.href)
  ) || [];
  if (aboutLinks.length > 0) {
    score += 20;
    signals.push('Página "About"/"Equipo" enlazada');
  } else {
    gaps.push({
      priority: 'low',
      message: 'No se enlaza a página About/Equipo',
      fix: 'Enlazar a página de equipo desde footer o autor — refuerza E-E-A-T.',
    });
  }

  // Schema Organization con sameAs
  if (parsed?.schema?.has_organization) {
    score += 20;
    signals.push('Schema Organization presente');
  }

  // Años en el mercado, casos de éxito
  if (/\d+\s+(años|years)\s+(de\s+)?(experiencia|experience|en\s+el\s+mercado|in\s+the\s+industry)/i.test(text)) {
    score += 15;
    signals.push('Años de experiencia mencionados');
  }

  if (/casos\s+de\s+[ée]xito|case\s+stud(?:y|ies)|testimoniales|testimonials/i.test(text)) {
    score += 15;
    signals.push('Casos de éxito o testimoniales referenciados');
  }

  // Logo con marca
  if (parsed?.schema?.types?.includes('Organization')) {
    score += 10;
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 7: Machine readable (schemas, metadata, llms.txt) ────────────

function analyzeMachineReadable(html, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  const schemaCount = parsed?.schema?.count || 0;

  if (schemaCount >= 3) {
    score += 35;
    signals.push(`${schemaCount} bloques JSON-LD`);
  } else if (schemaCount >= 1) {
    score += 20;
    signals.push(`${schemaCount} bloque(s) JSON-LD`);
  } else {
    gaps.push({
      priority: 'high',
      message: 'Sin schema JSON-LD',
      fix: 'Añadir al menos Organization + WebSite + (Article/Product según tipo).',
    });
  }

  // Tipos de schema relevantes para LLMs
  const types = parsed?.schema?.types || [];
  const llmRelevant = ['Organization', 'Article', 'BlogPosting', 'FAQPage', 'HowTo', 'Person', 'Product'];
  const matched = types.filter((t) => llmRelevant.includes(t));
  if (matched.length >= 2) {
    score += 25;
    signals.push(`Tipos relevantes para LLMs: ${matched.join(', ')}`);
  } else if (matched.length === 1) {
    score += 12;
  }

  // Open Graph completo
  if (parsed?.open_graph?.ok) {
    score += 12;
    signals.push('Open Graph completo');
  }

  // Meta description
  if (parsed?.meta?.ok) {
    score += 8;
    signals.push('Meta description en rango óptimo');
  }

  // Canonical
  if (parsed?.canonical?.ok) {
    score += 8;
    signals.push('Canonical declarado');
  }

  // Atributo lang
  if (parsed?.technical?.lang) {
    score += 5;
    signals.push(`Idioma declarado: ${parsed.technical.lang}`);
  }

  // hreflang (si aplica)
  if (parsed?.hreflang?.count >= 2) {
    score += 7;
    signals.push(`hreflang con ${parsed.hreflang.count} variantes`);
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Dimensión 8: Answer format (FAQ, definiciones, listas Q&A) ──────────────

function analyzeAnswerFormat(html, text, parsed) {
  const signals = [];
  const gaps = [];
  let score = 0;

  // FAQ schema
  if (parsed?.schema?.has_faq) {
    score += 50;
    signals.push('Schema FAQPage presente (excelente para LLMs)');
  } else {
    gaps.push({
      priority: 'medium',
      message: 'Sin schema FAQPage',
      fix: 'Si tienes preguntas frecuentes, añadir schema FAQPage. Los LLMs extraen Q&A literalmente.',
    });
  }

  // HowTo schema
  if (parsed?.schema?.has_howto) {
    score += 25;
    signals.push('Schema HowTo presente');
  }

  // Patrones Q&A semánticos
  const questionPatterns = (text.match(/\?/g) || []).length;
  const hasQuestionHeadings = /<h[2-4][^>]*>[^<]*\?[^<]*<\/h[2-4]>/i.test(html);
  if (hasQuestionHeadings) {
    score += 20;
    signals.push('Headings con formato pregunta');
  }

  // Definiciones (DL/DT/DD)
  if (/<dl\b[\s\S]*?<\/dl>/i.test(html)) {
    score += 15;
    signals.push('Listas de definición (<dl>) — formato perfecto para LLMs');
  }

  // Citas resaltadas (blockquote, callouts)
  if (/<blockquote\b/i.test(html)) {
    score += 10;
    signals.push('Blockquotes presentes');
  }

  // Bullets con respuestas cortas
  const liItems = html.match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || [];
  const shortLis = liItems.filter((li) => stripTags(li).length < 200).length;
  if (shortLis >= 5) {
    score += 10;
    signals.push(`${shortLis} bullets con respuestas concisas`);
  }

  return { score: Math.min(100, score), signals, gaps };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVisibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

/**
 * Extrae fechas en formatos comunes: ISO (2024-03-15), DD/MM/YYYY, "March 15 2024", etc.
 */
function findDates(text) {
  const dates = [];
  // ISO
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/g) || [];
  for (const d of iso) {
    const date = new Date(d);
    if (!isNaN(date)) dates.push(date);
  }
  // DD/MM/YYYY o DD-MM-YYYY
  const ddmm = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g) || [];
  for (const d of ddmm) {
    const parts = d.split(/[\/\-]/);
    const date = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`);
    if (!isNaN(date)) dates.push(date);
  }
  // Solo año (menos preciso, pero útil para detectar contenido viejo)
  const yearOnly = text.match(/\b(20\d{2})\b/g) || [];
  for (const y of yearOnly) {
    const date = new Date(`${y}-01-01`);
    if (!isNaN(date)) dates.push(date);
  }
  return dates;
}

function isRecent(date, days) {
  const now = Date.now();
  const diff = (now - date.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}
