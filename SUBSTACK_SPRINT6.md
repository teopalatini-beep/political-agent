# Sprint 6 - Substack Writer Pipeline

Este sprint crea un flujo para pasar de idea a borrador publicable en Substack con un comando.

## Que se implemento

- `substack.config.json`
  - Define identidad editorial, tono, CTA y pilares de contenido.
  - Sentido: mantener consistencia de voz y no empezar de cero cada vez.

- `templates/substack-draft-template.md`
  - Estructura base de post para Substack.
  - Sentido: asegurar que cada pieza tenga apertura, tesis, analisis, fuentes y cierre.

- `scripts/substack-draft.js`
  - Genera borrador `.md` + metadata `.meta.json` en `drafts/substack/`.
  - Toma tema, angulo y formato por argumentos CLI.
  - Reutiliza `seen_links.json` para sugerir fuentes recientes.
  - Sentido: acelerar escritura y mejorar calidad base del primer draft.

- Scripts npm:
  - `npm run substack:draft`
  - `npm run substack:draft:weekly`
  - `npm run substack:draft:deep`

## Como usarlo

### 1) Draft rapido
`npm run substack:draft -- --topic="Que cambia en Medio Oriente esta semana" --angle="geopolitica"`

### 2) Weekly por defecto
`npm run substack:draft:weekly`

### 3) Deep dive
`npm run substack:draft:deep -- --topic="Dolar, riesgo pais y energia en Argentina"`

## Flujo recomendado

1. Generar draft con `npm run substack:draft ...`
2. Editar archivo en `drafts/substack/*.md`
3. Copiar al editor de Substack
4. Programar/publicar
5. Guardar URL final en tu bitacora editorial

## Por que este enfoque

- Substack no ofrece una API publica oficial estable de escritura.
- Este pipeline evita dependencia de hacks frágiles.
- Te da velocidad, consistencia editorial y control humano antes de publicar.
