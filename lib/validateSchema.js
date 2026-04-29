/**
 * Validador de Schema.org JSON-LD.
 *
 * Sin dependencias externas, sin APIs de terceros.
 * Basado en specs públicas de schema.org y best practices de Google Rich Results.
 *
 * Cubre:
 *   1. Validación sintáctica (JSON, @context, @type, @graph)
 *   2. Validación por tipo (campos requeridos + recomendados)
 *   3. AEO/GEO score: schemas relevantes para LLMs + huecos detectados
 *
 * Limitación honesta: las reglas de "rich results" están sincronizadas con
 * la documentación pública de Google a fecha de Q1 2025. Para validación
 * oficial al 100%, complementar manualmente con
 * https://search.google.com/test/rich-results
 *
 * Uso:
 *   import { validateSchemas } from './validateSchema.js';
 *   const result = validateSchemas(schemaBlocksFromHtml);
 */

// ─── Spec de tipos: campos requeridos y recomendados ─────────────────────────
//
// Estos requisitos siguen lo que Google y schema.org consideran necesario para:
//   - Que el schema sea válido sintácticamente
//   - Que sea elegible para rich snippet (cuando aplica)
//
// Fuente: https://developers.google.com/search/docs/appearance/structured-data
//          https://schema.org/{Type}

const TYPE_SPECS = {
  Organization: {
    required: ['name'],
    recommended: ['url', 'logo', 'sameAs', 'contactPoint', 'description'],
    aeo_critical: ['sameAs', 'logo', 'description'],
  },
  LocalBusiness: {
    required: ['name', 'address'],
    recommended: ['telephone', 'openingHours', 'geo', 'priceRange', 'image', 'url'],
    aeo_critical: ['address', 'telephone', 'openingHours'],
  },
  WebSite: {
    required: ['name', 'url'],
    recommended: ['potentialAction', 'publisher'],
    aeo_critical: ['potentialAction'],
  },
  WebPage: {
    required: ['name'],
    recommended: ['url', 'description', 'breadcrumb', 'datePublished'],
    aeo_critical: ['description'],
  },
  Article: {
    required: ['headline', 'author', 'datePublished'],
    recommended: ['image', 'dateModified', 'publisher', 'mainEntityOfPage', 'description'],
    aeo_critical: ['author', 'datePublished', 'dateModified'],
  },
  BlogPosting: {
    required: ['headline', 'author', 'datePublished'],
    recommended: ['image', 'dateModified', 'publisher', 'mainEntityOfPage', 'description'],
    aeo_critical: ['author', 'datePublished', 'dateModified'],
  },
  NewsArticle: {
    required: ['headline', 'author', 'datePublished', 'image'],
    recommended: ['dateModified', 'publisher', 'description'],
    aeo_critical: ['author', 'datePublished', 'publisher'],
  },
  Product: {
    required: ['name'],
    recommended: ['image', 'description', 'offers', 'aggregateRating', 'review', 'brand', 'sku'],
    aeo_critical: ['description', 'offers', 'aggregateRating'],
  },
  FAQPage: {
    required: ['mainEntity'],
    recommended: [],
    aeo_critical: ['mainEntity'],
    custom_validate: validateFAQPage,
  },
  Question: {
    required: ['name', 'acceptedAnswer'],
    recommended: ['suggestedAnswer'],
    aeo_critical: ['acceptedAnswer'],
  },
  HowTo: {
    required: ['name', 'step'],
    recommended: ['image', 'totalTime', 'estimatedCost', 'tool', 'supply'],
    aeo_critical: ['step', 'totalTime'],
    custom_validate: validateHowTo,
  },
  BreadcrumbList: {
    required: ['itemListElement'],
    recommended: [],
    aeo_critical: ['itemListElement'],
  },
  Person: {
    required: ['name'],
    recommended: ['jobTitle', 'worksFor', 'sameAs', 'url', 'image', 'description'],
    aeo_critical: ['jobTitle', 'worksFor', 'sameAs'],
  },
  Event: {
    required: ['name', 'startDate', 'location'],
    recommended: ['endDate', 'description', 'image', 'offers', 'performer', 'organizer'],
    aeo_critical: ['startDate', 'location', 'description'],
  },
  Recipe: {
    required: ['name', 'recipeIngredient', 'recipeInstructions'],
    recommended: ['image', 'author', 'datePublished', 'cookTime', 'prepTime', 'recipeYield', 'nutrition'],
    aeo_critical: ['recipeIngredient', 'recipeInstructions', 'cookTime'],
  },
  VideoObject: {
    required: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    recommended: ['contentUrl', 'embedUrl', 'duration'],
    aeo_critical: ['description', 'uploadDate', 'duration'],
  },
  ImageObject: {
    required: ['contentUrl'],
    recommended: ['caption', 'creator', 'license', 'width', 'height'],
    aeo_critical: ['caption', 'creator'],
  },
  Course: {
    required: ['name', 'description', 'provider'],
    recommended: ['offers', 'aggregateRating', 'hasCourseInstance'],
    aeo_critical: ['description', 'provider'],
  },
  Review: {
    required: ['reviewRating', 'author'],
    recommended: ['datePublished', 'reviewBody', 'itemReviewed'],
    aeo_critical: ['author', 'reviewRating'],
  },
  AggregateRating: {
    required: ['ratingValue', 'ratingCount'],
    recommended: ['bestRating', 'worstRating'],
    aeo_critical: ['ratingValue', 'ratingCount'],
  },
  Service: {
    required: ['name', 'provider'],
    recommended: ['description', 'areaServed', 'serviceType', 'offers'],
    aeo_critical: ['description', 'areaServed'],
  },
  SoftwareApplication: {
    required: ['name'],
    recommended: ['applicationCategory', 'operatingSystem', 'offers', 'aggregateRating'],
    aeo_critical: ['applicationCategory', 'description'],
  },
};

// Tipos que más impactan para AEO/GEO (citabilidad por LLMs)
// Fuente: análisis empírico + best practices de la industria
const AEO_HIGH_VALUE_TYPES = {
  Organization: { weight: 10, reason: 'LLMs verifican la entidad como real' },
  WebSite: { weight: 8, reason: 'Permite a LLMs sugerir búsquedas internas' },
  Article: { weight: 10, reason: 'LLMs citan con autor y fecha verificables' },
  BlogPosting: { weight: 9, reason: 'Igual que Article para contenido editorial' },
  NewsArticle: { weight: 10, reason: 'Crítico para que aparezca en News + LLMs' },
  FAQPage: { weight: 10, reason: 'LLMs extraen Q&A literalmente' },
  HowTo: { weight: 9, reason: 'LLMs reproducen pasos en respuestas' },
  Person: { weight: 8, reason: 'Credibilidad del autor (E-E-A-T)' },
  BreadcrumbList: { weight: 6, reason: 'Contexto jerárquico para entender la página' },
  Product: { weight: 8, reason: 'LLMs comparan productos con datos estructurados' },
  Review: { weight: 7, reason: 'Citas con valoraciones reales' },
  LocalBusiness: { weight: 9, reason: 'Crítico para queries locales en LLMs' },
  Service: { weight: 7, reason: 'Permite a LLMs entender qué ofreces' },
  SoftwareApplication: { weight: 8, reason: 'Para SaaS, define el producto claramente' },
  Event: { weight: 7, reason: 'LLMs muestran eventos con datos completos' },
  Course: { weight: 7, reason: 'Educación: LLMs derivan a cursos estructurados' },
  Recipe: { weight: 6, reason: 'Citas con ingredientes/pasos exactos' },
  VideoObject: { weight: 6, reason: 'Indexación de contenido audiovisual' },
};

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * @param {Array<Object>} schemaBlocks - Bloques JSON-LD ya parseados (de parsePage.js)
 * @param {Object} [context] - Info de la página: { url, pageType, hasContent }
 * @returns {Object} Validación + AEO score + recomendaciones
 */
export function validateSchemas(schemaBlocks = [], context = {}) {
  // Aplanar @graph y arrays anidados
  const flatBlocks = flattenSchemas(schemaBlocks);

  // Validar cada bloque
  const validations = flatBlocks.map((block, i) => validateBlock(block, i));

  // Tipos detectados (deduplicados)
  const detectedTypes = [...new Set(
    validations
      .filter((v) => v.type)
      .map((v) => v.type)
  )];

  // Calcular AEO score
  const aeoScore = calculateAeoScore(detectedTypes, validations, context);

  // Detectar schemas faltantes según contexto
  const missingRecommended = detectMissingSchemas(detectedTypes, context);

  // Resumen
  const summary = {
    total_blocks: flatBlocks.length,
    valid_blocks: validations.filter((v) => v.valid).length,
    invalid_blocks: validations.filter((v) => !v.valid).length,
    detected_types: detectedTypes,
    types_with_errors: validations.filter((v) => !v.valid).map((v) => v.type).filter(Boolean),
  };

  return {
    summary,
    blocks: validations,
    aeo: aeoScore,
    recommendations: buildRecommendations(validations, missingRecommended, context),
    missing_schemas: missingRecommended,
  };
}

// ─── Validación por bloque ───────────────────────────────────────────────────

function validateBlock(block, index) {
  const errors = [];
  const warnings = [];
  const aeoIssues = [];

  // Validación de marca _invalid (parser detectó JSON roto)
  if (block?._invalid) {
    return {
      index,
      type: null,
      valid: false,
      errors: ['JSON-LD inválido (no se pudo parsear)'],
      warnings: [],
      aeo_issues: [],
      score: 0,
    };
  }

  // 1. @context
  const ctx = block['@context'];
  const ctxStr = typeof ctx === 'string' ? ctx : (Array.isArray(ctx) ? ctx.join(' ') : JSON.stringify(ctx || ''));
  if (!ctx) {
    errors.push('Falta @context');
  } else if (!/schema\.org/i.test(ctxStr)) {
    errors.push(`@context no apunta a schema.org (encontrado: ${ctxStr.slice(0, 50)})`);
  }

  // 2. @type
  let type = block['@type'];
  if (!type) {
    errors.push('Falta @type');
    return { index, type: null, valid: false, errors, warnings, aeo_issues: aeoIssues, score: 0 };
  }
  if (Array.isArray(type)) type = type[0]; // Tomamos el primario

  // 3. Spec del tipo
  const spec = TYPE_SPECS[type];
  if (!spec) {
    warnings.push(`Tipo "${type}" no está en nuestro catálogo (puede ser válido pero no validado en detalle)`);
    return {
      index, type, valid: errors.length === 0,
      errors, warnings, aeo_issues: aeoIssues,
      score: errors.length === 0 ? 0.5 : 0,
      unknown_type: true,
    };
  }

  // 4. Required fields
  for (const field of spec.required) {
    if (!hasField(block, field)) {
      errors.push(`Falta campo requerido "${field}" en ${type}`);
    }
  }

  // 5. Recommended fields
  for (const field of spec.recommended) {
    if (!hasField(block, field)) {
      warnings.push(`Falta campo recomendado "${field}" en ${type}`);
    }
  }

  // 6. AEO-critical fields (impacta citabilidad por LLMs)
  for (const field of spec.aeo_critical || []) {
    if (!hasField(block, field)) {
      aeoIssues.push(`AEO: añadir "${field}" mejora citabilidad de ${type}`);
    }
  }

  // 7. Validación custom por tipo (FAQ, HowTo)
  if (spec.custom_validate) {
    const customResult = spec.custom_validate(block);
    errors.push(...(customResult.errors || []));
    warnings.push(...(customResult.warnings || []));
  }

  // 8. Score del bloque (0-1)
  const requiredOk = spec.required.filter((f) => hasField(block, f)).length / Math.max(spec.required.length, 1);
  const recommendedOk = spec.recommended.length === 0 ? 1
    : spec.recommended.filter((f) => hasField(block, f)).length / spec.recommended.length;
  const score = Math.round((requiredOk * 0.7 + recommendedOk * 0.3) * 100) / 100;

  return {
    index,
    type,
    valid: errors.length === 0,
    errors,
    warnings,
    aeo_issues: aeoIssues,
    score,
  };
}

// ─── Validaciones custom por tipo ────────────────────────────────────────────

function validateFAQPage(block) {
  const errors = [];
  const warnings = [];
  const mainEntity = toArray(block.mainEntity);

  if (mainEntity.length === 0) {
    errors.push('FAQPage: mainEntity vacío (debe contener Questions)');
    return { errors, warnings };
  }

  for (let i = 0; i < mainEntity.length; i++) {
    const q = mainEntity[i];
    if (q['@type'] !== 'Question') {
      errors.push(`FAQPage: mainEntity[${i}] debe ser @type=Question`);
      continue;
    }
    if (!q.name) errors.push(`FAQPage: Question[${i}] sin "name" (la pregunta)`);
    if (!q.acceptedAnswer) {
      errors.push(`FAQPage: Question[${i}] sin "acceptedAnswer"`);
    } else {
      const ans = q.acceptedAnswer;
      if (ans['@type'] !== 'Answer') warnings.push(`FAQPage: Question[${i}].acceptedAnswer debería ser @type=Answer`);
      if (!ans.text) errors.push(`FAQPage: Question[${i}].acceptedAnswer sin "text"`);
    }
  }
  return { errors, warnings };
}

function validateHowTo(block) {
  const errors = [];
  const warnings = [];
  const steps = toArray(block.step);

  if (steps.length === 0) {
    errors.push('HowTo: "step" vacío');
    return { errors, warnings };
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const tipo = s['@type'];
    if (tipo && tipo !== 'HowToStep' && tipo !== 'HowToSection') {
      warnings.push(`HowTo: step[${i}] debería ser @type=HowToStep o HowToSection`);
    }
    if (!s.text && !s.itemListElement) {
      errors.push(`HowTo: step[${i}] sin "text" ni "itemListElement"`);
    }
  }
  return { errors, warnings };
}

// ─── AEO Score ───────────────────────────────────────────────────────────────

function calculateAeoScore(detectedTypes, validations, context) {
  // Suma de pesos de tipos detectados (con bloque válido)
  const validTypes = new Set(
    validations.filter((v) => v.valid && v.type).map((v) => v.type)
  );

  let earned = 0;
  const maxPossible = 50; // Tope arbitrario que un sitio "completo" alcanzaría
  const detected = [];

  for (const type of validTypes) {
    const config = AEO_HIGH_VALUE_TYPES[type];
    if (config) {
      earned += config.weight;
      detected.push({ type, weight: config.weight, reason: config.reason });
    }
  }

  // Penalización por bloques inválidos en tipos AEO-relevantes
  const invalidAeo = validations.filter(
    (v) => !v.valid && v.type && AEO_HIGH_VALUE_TYPES[v.type]
  );
  const penalty = invalidAeo.length * 2;

  const rawScore = Math.max(0, earned - penalty);
  const score = Math.min(100, Math.round((rawScore / maxPossible) * 100));

  let rating;
  if (score >= 70) rating = 'excellent';
  else if (score >= 40) rating = 'good';
  else if (score >= 15) rating = 'needs_improvement';
  else rating = 'poor';

  return {
    score,
    rating,
    detected_types: detected.sort((a, b) => b.weight - a.weight),
    invalid_aeo_blocks: invalidAeo.length,
    methodology: 'Suma ponderada de schemas relevantes para citabilidad por LLMs (peso 1-10) menos penalizaciones por schemas mal formados. Tope normalizado a 100.',
  };
}

// ─── Detección de schemas faltantes según contexto ──────────────────────────

function detectMissingSchemas(detectedTypes, context = {}) {
  const have = new Set(detectedTypes);
  const missing = [];

  // Universales (cualquier sitio debería tenerlos)
  if (!have.has('Organization')) {
    missing.push({
      type: 'Organization',
      priority: 'high',
      reason: 'Identifica la entidad. Sin esto, LLMs no pueden verificar que el sitio represente una empresa real.',
      example_fields: ['name', 'url', 'logo', 'sameAs', 'description'],
    });
  }
  if (!have.has('WebSite')) {
    missing.push({
      type: 'WebSite',
      priority: 'medium',
      reason: 'Permite a buscadores y LLMs entender la estructura del sitio. Habilita búsquedas internas vía SearchAction.',
      example_fields: ['name', 'url', 'potentialAction'],
    });
  }
  if (!have.has('BreadcrumbList')) {
    missing.push({
      type: 'BreadcrumbList',
      priority: 'medium',
      reason: 'Da contexto jerárquico de cada página. Útil para entender de qué trata.',
      example_fields: ['itemListElement'],
    });
  }

  // Por tipo de contenido (si hay contexto)
  const pageType = context.pageType?.toLowerCase() || '';

  if (pageType.includes('blog') || pageType.includes('article') || pageType.includes('news')) {
    if (!have.has('Article') && !have.has('BlogPosting') && !have.has('NewsArticle')) {
      missing.push({
        type: 'Article (o BlogPosting / NewsArticle)',
        priority: 'high',
        reason: 'Página de blog/artículo sin schema. LLMs no pueden citar autor, fecha o entidad publicadora.',
        example_fields: ['headline', 'author', 'datePublished', 'image'],
      });
    }
  }

  if (pageType.includes('product') || pageType.includes('shop')) {
    if (!have.has('Product')) {
      missing.push({
        type: 'Product',
        priority: 'high',
        reason: 'Página de producto sin schema. Pierde rich snippets de precio, rating y disponibilidad.',
        example_fields: ['name', 'image', 'description', 'offers', 'aggregateRating'],
      });
    }
  }

  if (pageType.includes('faq') || pageType.includes('preguntas')) {
    if (!have.has('FAQPage')) {
      missing.push({
        type: 'FAQPage',
        priority: 'high',
        reason: 'Página de FAQ sin schema. LLMs no pueden extraer Q&A para responder con citas literales.',
        example_fields: ['mainEntity (con Questions)'],
      });
    }
  }

  if (pageType.includes('local') || pageType.includes('contact') || pageType.includes('store')) {
    if (!have.has('LocalBusiness')) {
      missing.push({
        type: 'LocalBusiness',
        priority: 'high',
        reason: 'Negocio local sin schema. Pierde aparición en mapas, horarios y queries de "cerca de mí".',
        example_fields: ['name', 'address', 'telephone', 'openingHours', 'geo'],
      });
    }
  }

  return missing;
}

// ─── Recomendaciones priorizadas ─────────────────────────────────────────────

function buildRecommendations(validations, missingSchemas, context) {
  const recs = [];

  // 1. Errores en bloques existentes (prioridad alta — schema roto = no funciona)
  for (const v of validations) {
    if (!v.valid) {
      for (const err of v.errors) {
        recs.push({
          priority: 'high',
          category: 'fix_existing',
          schema_type: v.type,
          message: err,
        });
      }
    }
  }

  // 2. Schemas faltantes high priority
  for (const m of missingSchemas.filter((m) => m.priority === 'high')) {
    recs.push({
      priority: 'high',
      category: 'add_schema',
      schema_type: m.type,
      message: `Añadir schema ${m.type}: ${m.reason}`,
      example_fields: m.example_fields,
    });
  }

  // 3. Warnings (campos recomendados faltantes en bloques válidos)
  for (const v of validations) {
    for (const w of v.warnings) {
      recs.push({
        priority: 'medium',
        category: 'enhance_existing',
        schema_type: v.type,
        message: w,
      });
    }
  }

  // 4. AEO issues
  for (const v of validations) {
    for (const a of v.aeo_issues) {
      recs.push({
        priority: 'medium',
        category: 'aeo_improvement',
        schema_type: v.type,
        message: a,
      });
    }
  }

  // 5. Schemas faltantes medium/low priority
  for (const m of missingSchemas.filter((m) => m.priority !== 'high')) {
    recs.push({
      priority: m.priority,
      category: 'add_schema',
      schema_type: m.type,
      message: `Considerar schema ${m.type}: ${m.reason}`,
      example_fields: m.example_fields,
    });
  }

  return recs;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Aplana @graph y arrays anidados en una lista plana de bloques con @type.
 * Propaga @context del padre a los hijos del @graph (caso muy común).
 */
function flattenSchemas(blocks) {
  const out = [];
  const stack = blocks.map((b) => ({ block: b, inheritedContext: null }));

  while (stack.length > 0) {
    const { block, inheritedContext } = stack.shift();
    if (!block || typeof block !== 'object') continue;

    if (Array.isArray(block)) {
      for (let i = block.length - 1; i >= 0; i--) {
        stack.unshift({ block: block[i], inheritedContext });
      }
      continue;
    }

    const ownContext = block['@context'] || inheritedContext;

    if (block['@graph']) {
      const graph = Array.isArray(block['@graph']) ? block['@graph'] : [block['@graph']];
      for (let i = graph.length - 1; i >= 0; i--) {
        stack.unshift({ block: graph[i], inheritedContext: ownContext });
      }
      // Si tiene @type además del @graph, también lo incluimos
      if (block['@type']) {
        const { '@graph': _, ...rest } = block;
        out.push({ ...rest, '@context': ownContext });
      }
      continue;
    }

    if (block['@type'] || block._invalid) {
      // Si el bloque no tiene @context propio pero sí heredado, lo añadimos
      if (!block['@context'] && inheritedContext) {
        out.push({ ...block, '@context': inheritedContext });
      } else {
        out.push(block);
      }
    }
  }

  return out;
}

/**
 * Verifica que un campo exista y no esté vacío.
 * Acepta strings, arrays, objetos. Trata "" y [] como vacíos.
 */
function hasField(obj, field) {
  if (!obj || typeof obj !== 'object') return false;
  const v = obj[field];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function toArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
