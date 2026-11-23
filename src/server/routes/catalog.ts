import type { Db } from '../db.js';
import { all, get } from '../db.js';
import { HttpError, type Router } from '../http.js';
import { queryInt } from '../validate.js';
import { defaultRadius, distanceFrom, districtName, resolveCenter } from '../services.js';
import { addDays, berlinDayRange, berlinToday, nowIso } from '../time.js';

export interface CinemaRow {
  id: number;
  slug: string;
  name: string;
  address: string;
  city: string;
  district: string;
  lat: number;
  lng: number;
  website: string;
  has_ov: number;
  approx_coords: number;
}

export function cinemaOut(c: CinemaRow, distanceKm: number | null) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    address: c.address,
    district: c.district ? districtName(c.city, c.district) : '',
    lat: c.lat,
    lng: c.lng,
    website: c.website,
    hasOv: c.has_ov === 1,
    approxCoords: c.approx_coords === 1,
    distanceKm,
  };
}

function parseGenres(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export function registerCatalogRoutes(router: Router, db: Db) {
  /** Кинотеатры: поиск по названию и по радиусу от района из анкеты. */
  router.get('/api/cinemas', (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const center = resolveCenter(db, ctx);
    // radius=all — без ограничения, без параметра — радиус из анкеты
    const radius =
      !center || ctx.query.get('radius') === 'all'
        ? undefined
        : (queryInt(ctx.query, 'radius', 1, 50) ?? defaultRadius(db, ctx));

    let rows = all<CinemaRow>(db, 'SELECT * FROM cinemas ORDER BY name');
    if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q));
    let out = rows.map((c) => cinemaOut(c, distanceFrom(center, c.lat, c.lng)));
    if (center && radius !== undefined) out = out.filter((c) => c.distanceKm! <= radius);
    if (center) out.sort((a, b) => a.distanceKm! - b.distanceKm!);
    return { center: center ? { label: center.label } : null, radiusKm: radius ?? null, cinemas: out };
  });

  router.get('/api/movies', (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim();
    const rows = all<{ id: number; title: string; genres: string; poster_url: string; runtime_min: number | null }>(
      db,
      `SELECT DISTINCT m.id, m.title, m.genres, m.poster_url, m.runtime_min FROM movies m
       JOIN showtimes s ON s.movie_id = m.id AND s.status = 'active' AND s.starts_at > ?
       WHERE m.title LIKE ? ORDER BY m.title LIMIT 50`,
      nowIso(),
      `%${q}%`,
    );
    return { movies: rows.map((m) => ({ id: m.id, title: m.title, genres: parseGenres(m.genres), posterUrl: m.poster_url, runtimeMin: m.runtime_min })) };
  });

  /** Афиша: сеансы на дату с фильтрами по радиусу, кинотеатру, фильму, языку. */
  router.get('/api/showtimes', (ctx) => {
    const today = berlinToday();
    const date = ctx.query.get('date') || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Дата должна быть в формате ГГГГ-ММ-ДД');
    if (date < today || date > addDays(today, 14)) throw new HttpError(400, 'Афиша доступна на 14 дней вперёд');
    const [from, to] = berlinDayRange(date);
    const start = from < nowIso() ? nowIso() : from;

    const center = resolveCenter(db, ctx);
    const radius = center ? (queryInt(ctx.query, 'radius', 1, 50) ?? defaultRadius(db, ctx)) : undefined;
    const cinemaId = queryInt(ctx.query, 'cinema', 1, Number.MAX_SAFE_INTEGER);
    const movieQ = (ctx.query.get('movie') ?? '').trim().toLowerCase();
    const ovOnly = ctx.query.get('ov') === '1';

    const rows = all<
      CinemaRow & {
        st_id: number;
        starts_at: string;
        language: string;
        ticket_url: string;
        movie_id: number;
        title: string;
        overview: string;
        poster_url: string;
        genres: string;
        runtime_min: number | null;
        age_rating: string;
        is_demo: number;
        open_invites: number;
      }
    >(
      db,
      `SELECT c.*, s.id AS st_id, s.starts_at, s.language, s.ticket_url,
              m.id AS movie_id, m.title, m.overview, m.poster_url, m.genres, m.runtime_min, m.age_rating, m.is_demo,
              (SELECT COUNT(*) FROM invitations i WHERE i.showtime_id = s.id AND i.status = 'open') AS open_invites
       FROM showtimes s JOIN cinemas c ON c.id = s.cinema_id JOIN movies m ON m.id = s.movie_id
       WHERE s.status = 'active' AND s.starts_at >= ? AND s.starts_at < ?
       ORDER BY s.starts_at`,
      start,
      to,
    );

    const showtimes = [];
    for (const r of rows) {
      if (cinemaId && r.id !== cinemaId) continue;
      if (movieQ && !r.title.toLowerCase().includes(movieQ)) continue;
      if (ovOnly && r.language === 'DE') continue;
      const dist = distanceFrom(center, r.lat, r.lng);
      if (radius !== undefined && dist !== null && dist > radius) continue;
      showtimes.push({
        id: r.st_id,
        startsAt: r.starts_at,
        language: r.language,
        ticketUrl: r.ticket_url || r.website,
        openInvitations: r.open_invites,
        movie: {
          id: r.movie_id,
          title: r.title,
          overview: r.overview,
          posterUrl: r.poster_url,
          genres: parseGenres(r.genres),
          runtimeMin: r.runtime_min,
          ageRating: r.age_rating,
          isDemo: r.is_demo === 1,
        },
        cinema: cinemaOut(r, dist),
      });
    }
    return { date, center: center ? { label: center.label } : null, radiusKm: radius ?? null, showtimes };
  });

  router.get('/api/showtimes/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const r = get<CinemaRow & { st_id: number; starts_at: string; language: string; ticket_url: string; status: string; movie_id: number; title: string; overview: string; poster_url: string; genres: string; runtime_min: number | null; age_rating: string; is_demo: number }>(
      db,
      `SELECT c.*, s.id AS st_id, s.starts_at, s.language, s.ticket_url, s.status,
              m.id AS movie_id, m.title, m.overview, m.poster_url, m.genres, m.runtime_min, m.age_rating, m.is_demo
       FROM showtimes s JOIN cinemas c ON c.id = s.cinema_id JOIN movies m ON m.id = s.movie_id WHERE s.id = ?`,
      Number.isInteger(id) ? id : -1,
    );
    if (!r || r.status !== 'active') throw new HttpError(404, 'Сеанс не найден');
    const center = resolveCenter(db, ctx);
    return {
      showtime: {
        id: r.st_id,
        startsAt: r.starts_at,
        language: r.language,
        ticketUrl: r.ticket_url || r.website,
        openInvitations: 0,
        movie: { id: r.movie_id, title: r.title, overview: r.overview, posterUrl: r.poster_url, genres: parseGenres(r.genres), runtimeMin: r.runtime_min, ageRating: r.age_rating, isDemo: r.is_demo === 1 },
        cinema: cinemaOut(r, distanceFrom(center, r.lat, r.lng)),
      },
    };
  });
}
