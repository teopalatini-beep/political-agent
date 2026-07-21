# Political Agent

**Agente 24/7 que recopila, clasifica y distribuye noticias de política internacional, economía y mercados — vía Telegram, email y newsletter.**

## El problema que resuelve

Seguir la actualidad política y financiera global implica revisar decenas de fuentes dispersas cada día. Political Agent automatiza ese trabajo: monitorea RSS de medios internacionales, filtra el ruido, prioriza lo relevante y entrega un resumen curado — sin intervención manual — a través de un bot de Telegram y una newsletter diaria por email.

## Funcionalidades clave

- **Agregación multi-región**: RSS de medios como BBC, NPR, Euronews, DW, SCMP, NYT, Al Jazeera, Moscow Times, La Nación y Clarín, cubriendo EE.UU., Europa, China, Rusia, Medio Oriente, Brasil y Argentina — con fuentes de respaldo automáticas vía Google News si una fuente primaria falla.
- **Clasificación automática por categoría**: cada noticia se etiqueta en Política Mundial, Política Argentina, Economía, Finanzas & Mercados, Inversiones o Deporte según coincidencia de palabras clave.
- **Scoring de importancia**: detección de nivel de urgencia (alta/media/baja) por keywords (guerra, sanciones, elecciones, etc.), con generación automática de una línea de "por qué importa" para las noticias críticas.
- **Datos de mercado en tiempo real**: cotizaciones de criptomonedas (CoinGecko), S&P 500 y ADRs argentinos (Twelve Data, con fallback a Yahoo Finance y Stooq) integradas en el newsletter.
- **Bot de Telegram interactivo**: comandos para consultar noticias por región (`/usa`, `/europe`, etc.), cripto, acciones, gestionar destinatarios de email, forzar el envío del newsletter, ver preview HTML y chequear estado del sistema.
- **Newsletter por email**: generación de HTML responsive con secciones por categoría, resumen de mercados y métricas del envío; envío vía Resend/Nodemailer y publicación opcional en Beehiiv.
- **Deduplicación persistente**: normalización de URLs (elimina UTM/tracking) y ventana de 48 h para no repetir noticias ya enviadas.
- **Generación de contenido editorial**: scripts para borradores de Substack y un pipeline de contenido de afiliados (scoring de ofertas, secuencias de email, calendario de videos) como capa de monetización adicional.
- **Operación autónoma**: heartbeat de salud, LaunchDaemons para macOS, healthchecks, logrotate y despliegue continuo a Fly.io vía GitHub Actions.

## Stack técnico

- **Runtime**: Node.js (Telegraf para el bot de Telegram, node-cron para scheduling)
- **Email**: Resend + Nodemailer, integración opcional con Beehiiv
- **Datos**: RSS parsing manual (regex), Twelve Data API, CoinGecko API, Yahoo Finance / Stooq como fallback
- **Infraestructura**: Docker, Fly.io (deploy continuo vía GitHub Actions), soporte para LaunchDaemon en macOS como entorno alternativo
- **Persistencia**: almacenamiento en archivos JSON locales (sin base de datos externa)

## Arquitectura

`server.js` actúa como *launcher*: en modo activo delega a `bot_main.js` (proceso principal con el bot de Telegram, scheduler del newsletter y toda la lógica de fetch/clasificación); en modo standby (`DISABLE_BOT=true`) solo mantiene un heartbeat, permitiendo correr una instancia primaria en Fly.io y una secundaria en reposo en local. Un workflow de GitHub Actions dispara el envío diario del newsletter (`scripts/send-newsletter.js`) de forma independiente al bot interactivo.
