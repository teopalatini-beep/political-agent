# Political Agent

Agente 24/7 que monitorea política internacional, te avisa por Telegram cuando hay algo urgente, y cada mañana te manda un newsletter con el panorama (política + economía + mercados).

---

## Qué estoy haciendo

Estoy construyendo un **radar geopolítico personal** automatizado:

1. **Lee** feeds RSS de regiones clave (EE.UU., Europa, China, Rusia, Medio Oriente, Brasil, Argentina)
2. **Puntúa** urgencia por palabras clave
3. **Avisa** por Telegram digests y alertas
4. **Arma** un newsletter HTML diario (política, economía, mercados) y lo manda por email
5. **Opcional:** borradores de Substack y contenido de afiliados para revisar a mano (no publica solo)

No es un medio ni un analista humano: es un monitor que filtra ruido y te deja el resumen listo.

---

## Por qué lo estoy haciendo

Seguir política internacional a mano es imposible: demasiadas fuentes, demasiadas alertas falsas, y el “importante” se pierde entre el ruido.

Quería algo que:

- corra **solo**, todo el día
- me avise **solo cuando importa**
- me deje un **brief matutino** sin abrir 15 tabs
- separe “leer el mundo” de “escribir contenido” (borradores aparte, con revisión humana)

---

## Beneficios

| Beneficio | En la práctica |
|---|---|
| **Cobertura continua** | RSS + cron; no dependés de estar online |
| **Señal vs ruido** | Scoring de urgencia antes de molestarte |
| **Brief diario** | Newsletter con política + mercados |
| **Canal inmediato** | Telegram para alertas |
| **Humano al final** | Substack/afiliados = borradores, no auto-publish |

---

## Qué hace (y qué no)

**Sí hace**
- Monitorear feeds y armar digests
- Alertas por Telegram
- Newsletter diario por email
- Healthchecks / smoke tests
- Borradores opcionales (Substack / afiliados)

**No hace**
- Publicar en Substack o redes sin tu revisión
- Reemplazar análisis editorial humano
- Garantizar cobertura de *todas* las fuentes del mundo

---

## Cómo funciona

```
RSS feeds
  → scoring de urgencia
  → Telegram (alertas / digests)
  → newsletter HTML matutino → email
  → (opcional) borradores Substack / afiliados
```

Stack: Node.js, Telegraf, node-cron, nodemailer. Mercados vía APIs configurables. Deploy opcional en Fly.io / LaunchDaemons en macOS.

---

## Setup rápido

```bash
git clone https://github.com/teopalatini-beep/political-agent.git
cd political-agent
npm install
cp .env.example .env
# Completá TELEGRAM_*, EMAIL_*, y keys de mercados si las usás
npm start
```

Scripts útiles:

| Comando | Qué hace |
|---|---|
| `npm start` | Corre el bot |
| `npm run smoke` | Smoke check |
| `npm run weekly:health` | Healthcheck |
| `npm run install:daemon` | Instala daemons 24/7 en macOS |

El `.env` **nunca** se sube a git. No compartas tokens, chat IDs ni listas de destinatarios.

---

## Docs

- [`OPERATIONS.md`](OPERATIONS.md) — instalación 24/7 y recovery
- [`SUBSTACK_SPRINT6.md`](SUBSTACK_SPRINT6.md) — pipeline de borradores Substack

---

## Estado del proyecto

En uso personal. El core es monitoreo + Telegram + newsletter; Substack y afiliados son extensiones opcionales con revisión humana.
