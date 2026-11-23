import { fileURLToPath } from 'node:url';
import type { Db } from '../db.js';
import { all, get, openDb, run } from '../db.js';
import { config } from '../config.js';

/**
 * Дополняет фильмы описанием, постером, жанрами и длительностью из TMDB.
 * На сайте нужна подпись: «This product uses the TMDB API but is not endorsed or certified by TMDB».
 * Запуск: npm run tmdb:enrich (нужен TMDB_API_KEY в .env)
 */
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';

// Жанры TMDB → жанры сайта
const GENRE_MAP: Record<number, string> = {
  28: 'боевик',
  12: 'приключения',
  16: 'анимация',
  35: 'комедия',
  80: 'детектив',
  99: 'документальное',
  18: 'драма',
  10751: 'семейное',
  14: 'фэнтези',
  27: 'ужасы',
  10402: 'мюзикл',
  9648: 'детектив',
  10749: 'мелодрама',
  878: 'фантастика',
  53: 'триллер',
};

async function tmdb<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = config.tmdbApiKey;
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Поддерживаются оба вида ключа: v3 api_key и v4 Read Access Token
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function enrichMovies(db: Db, limit = 50): Promise<number> {
  if (!config.tmdbApiKey) {
    console.warn('[tmdb] TMDB_API_KEY не задан — пропускаю');
    return 0;
  }
  const movies = all<{ id: number; title: string }>(db, 'SELECT id, title FROM movies WHERE tmdb_id IS NULL AND is_demo = 0 LIMIT ?', limit);
  let done = 0;
  for (const m of movies) {
    try {
      const search = await tmdb<{ results: { id: number }[] }>('/search/movie', { query: m.title, language: 'de-DE', region: 'DE' });
      const hit = search.results[0];
      if (!hit) continue;
      if (get(db, 'SELECT 1 FROM movies WHERE tmdb_id = ?', hit.id)) continue;
      const d = await tmdb<{ title: string; original_title: string; overview: string; poster_path: string | null; runtime: number | null; genres: { id: number }[] }>(
        `/movie/${hit.id}`,
        { language: 'de-DE' },
      );
      const genres = [...new Set(d.genres.map((g) => GENRE_MAP[g.id]).filter(Boolean))];
      run(
        db,
        `UPDATE movies SET tmdb_id = ?, original_title = ?, overview = ?, poster_url = ?, runtime_min = ?, genres = ? WHERE id = ?`,
        hit.id,
        d.original_title ?? '',
        d.overview ?? '',
        d.poster_path ? IMG + d.poster_path : '',
        d.runtime ?? null,
        JSON.stringify(genres),
        m.id,
      );
      done++;
      await new Promise((r) => setTimeout(r, 250)); // бережно к API
    } catch (e) {
      console.error(`[tmdb] ${m.title}: ${(e as Error).message}`);
    }
  }
  console.log(`[tmdb] обновлено фильмов: ${done}`);
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(config.dbPath);
  await enrichMovies(db);
  db.close();
}
