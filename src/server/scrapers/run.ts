import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db.js';
import { get, openDb } from '../db.js';
import { config } from '../config.js';
import { importShowtimes } from './importer.js';
import { jsonLdAdapter } from './jsonld.js';
import { isAllowedByRobots } from './robots.js';
import type { FetchContext, ScraperAdapter, ScraperSource } from './types.js';

/** Реестр адаптеров. Новый парсер под конкретный сайт добавляется сюда. */
export const ADAPTERS: Record<string, ScraperAdapter> = {
  jsonld: jsonLdAdapter,
};

const CONFIG_PATH = 'config/scrapers.json';

export function loadSources(path = CONFIG_PATH): ScraperSource[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sources?: ScraperSource[] };
  return parsed.sources ?? [];
}

function makeFetchContext(): FetchContext {
  const userAgent = `KinoBuddyBot/0.1 (+${config.scraperContact})`;
  const robotsCache = new Map<string, string>();
  return {
    async fetchText(url: string) {
      const u = new URL(url);
      let robots = robotsCache.get(u.origin);
      if (robots === undefined) {
        try {
          const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': userAgent } });
          robots = r.ok ? await r.text() : '';
        } catch {
          robots = '';
        }
        robotsCache.set(u.origin, robots);
      }
      if (!isAllowedByRobots(robots, 'KinoBuddyBot', u.pathname + u.search)) {
        throw new Error(`robots.txt запрещает ${u.pathname}`);
      }
      const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'text/html,application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
      return res.text();
    },
  };
}

export async function runAllScrapers(db: Db, sources = loadSources()): Promise<void> {
  const ctx = makeFetchContext();
  const active = sources.filter((s) => s.enabled && s.url);
  if (!active.length) {
    console.log('[scrape] Нет включённых источников (config/scrapers.json)');
    return;
  }
  for (const s of active) {
    const adapter = ADAPTERS[s.adapter];
    const cinema = get<{ id: number }>(db, 'SELECT id FROM cinemas WHERE slug = ?', s.cinemaSlug);
    if (!adapter || !cinema) {
      console.warn(`[scrape] ${s.cinemaSlug}: неизвестный адаптер или кинотеатр`);
      continue;
    }
    try {
      const items = await adapter(s, ctx);
      if (items.length === 0) console.warn(`[scrape] ВНИМАНИЕ: ${s.cinemaSlug} — 0 сеансов, проверьте парсер`);
      const r = importShowtimes(db, cinema.id, `scrape:${s.adapter}`, items);
      console.log(`[scrape] ${s.cinemaSlug}: +${r.added} новых, ${r.updated} обновлено, ${r.cancelled} отменено`);
    } catch (e) {
      console.error(`[scrape] ${s.cinemaSlug}: ошибка — ${(e as Error).message}`);
    }
  }
}

// Запуск из командной строки: npm run scrape
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(config.dbPath);
  await runAllScrapers(db);
  db.close();
}
