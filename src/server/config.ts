import { existsSync } from 'node:fs';

// Подхватываем .env, если он есть (встроено в Node.js ≥ 21.7)
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* файл не прочитался — работаем с переменными окружения как есть */
  }
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  dbPath: env.DB_PATH ?? 'data/kinobuddy.db',
  production: env.NODE_ENV === 'production',
  seedDemo: (env.SEED_DEMO ?? '1') === '1',
  adminEmail: (env.ADMIN_EMAIL ?? '').trim().toLowerCase(),
  tmdbApiKey: env.TMDB_API_KEY ?? '',
  scrapeEnabled: env.SCRAPE_ENABLED === '1',
  scrapeIntervalHours: Number(env.SCRAPE_INTERVAL_HOURS ?? 6),
  scraperContact: env.SCRAPER_CONTACT ?? 'admin@example.com',
  sessionDays: 30,
};
