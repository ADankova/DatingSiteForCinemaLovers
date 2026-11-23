import type { Db } from '../db.js';
import { all, get, run, tx } from '../db.js';
import { nowIso } from '../time.js';
import type { ScrapedShowtime } from './types.js';

export function findOrCreateMovie(db: Db, title: string): number {
  const clean = title.trim();
  const existing = get<{ id: number }>(db, 'SELECT id FROM movies WHERE title = ? COLLATE NOCASE', clean);
  if (existing) return existing.id;
  return run(db, 'INSERT INTO movies (title) VALUES (?)', clean).lastId;
}

export interface ImportResult {
  added: number;
  updated: number;
  cancelled: number;
}

/**
 * Записать сеансы одного кинотеатра из одного источника.
 * Будущие сеансы этого источника, пропавшие из выдачи, помечаются как отменённые
 * (не удаляются: на них могут ссылаться приглашения).
 */
export function importShowtimes(db: Db, cinemaId: number, source: string, items: ScrapedShowtime[]): ImportResult {
  const result: ImportResult = { added: 0, updated: 0, cancelled: 0 };
  const now = nowIso();
  return tx(db, () => {
    const seen = new Set<number>();
    for (const it of items) {
      if (!it.movieTitle.trim() || Number.isNaN(Date.parse(it.startsAt))) continue;
      const startsAt = new Date(it.startsAt).toISOString();
      if (startsAt <= now) continue;
      const movieId = findOrCreateMovie(db, it.movieTitle);
      const existing = get<{ id: number }>(
        db,
        'SELECT id FROM showtimes WHERE cinema_id = ? AND movie_id = ? AND starts_at = ?',
        cinemaId,
        movieId,
        startsAt,
      );
      if (existing) {
        run(
          db,
          `UPDATE showtimes SET language = ?, ticket_url = ?, external_id = ?, source = ?, status = 'active' WHERE id = ?`,
          it.language ?? 'DE',
          it.ticketUrl ?? '',
          it.externalId ?? null,
          source,
          existing.id,
        );
        seen.add(existing.id);
        result.updated++;
      } else {
        const { lastId } = run(
          db,
          `INSERT INTO showtimes (movie_id, cinema_id, starts_at, language, ticket_url, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          movieId,
          cinemaId,
          startsAt,
          it.language ?? 'DE',
          it.ticketUrl ?? '',
          source,
          it.externalId ?? null,
        );
        seen.add(lastId);
        result.added++;
      }
    }
    // Если источник вернул пусто — скорее всего сломался парсер, ничего не отменяем
    if (items.length > 0) {
      const future = all<{ id: number }>(
        db,
        `SELECT id FROM showtimes WHERE cinema_id = ? AND source = ? AND status = 'active' AND starts_at > ?`,
        cinemaId,
        source,
        now,
      );
      for (const f of future) {
        if (!seen.has(f.id)) {
          run(db, `UPDATE showtimes SET status = 'cancelled' WHERE id = ?`, f.id);
          result.cancelled++;
        }
      }
    }
    return result;
  });
}
