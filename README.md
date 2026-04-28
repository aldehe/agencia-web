# Agencia — Proyecto Web Completo

## Estructura

```
/
├── index.html          → Web principal (pública, indexada)
├── analyzer/
│   └── index.html      → Calculadora SEO/AEO/GEO (noindex)
├── api/
│   └── analyze.js      → Edge Function backend (análisis completo)
├── robots.txt          → Control de indexación
├── llms.txt            → Orientación para crawlers de IA
├── vercel.json         → Configuración Vercel
└── README.md           → Este archivo
```

## Deploy en Vercel (5 minutos)

### 1. Crear repositorio GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create agencia-web --public
git push origin main
```

### 2. Conectar a Vercel

1. Ve a [vercel.com](https://vercel.com) y crea cuenta gratuita
2. "Add New Project" → Import tu repo de GitHub
3. Vercel detecta automáticamente la configuración
4. Click "Deploy"
5. En ~30 segundos tienes la web online

### 3. Conectar dominio

1. En Vercel → Settings → Domains
2. Añade tu dominio (ej: nuvex.ai)
3. Vercel te da los registros DNS a configurar en Cloudflare
4. En 5 minutos el dominio apunta a tu web

## Edge Function

`/api/analyze.js` corre en Vercel Edge Runtime (gratis, 100k req/mes).

Analiza:
- Google PageSpeed API (mobile + desktop)
- HTML completo: title, meta, H1-H6, canonical, OG, Twitter Card, hreflang
- Schema markup JSON-LD (todos los tipos)
- robots.txt
- sitemap.xml
- llms.txt

## Personalizar

Busca y reemplaza en todos los archivos:
- `Agencia` → tu nombre (ej: Nuvex)
- `agencia.ai` → tu dominio
- `hola@agencia.ai` → tu email

## Stack

- HTML/CSS/JS puro — sin frameworks, sin dependencias
- Vercel Edge Functions — backend serverless
- Google PageSpeed API — datos reales de velocidad
- Google Fonts — General Sans + JetBrains Mono
- Coste total: ~12€/año (solo dominio)
