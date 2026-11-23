import type { Db } from './db.js';
import { all, get, run, tx } from './db.js';
import { findDistrict } from './geo.js';
import { hashPassword } from './auth.js';
import { addDays, berlinLocalToUtc, berlinToday, nowIso } from './time.js';

/**
 * Кинотеатры Штутгарта (названия и адреса по kino.de / filmstarts.de, ноябрь 2026).
 * Координаты ПРИМЕРНЫЕ (approx_coords = 1) — уточните командой `npm run import:osm`.
 */
export const SEED_CINEMAS = [
  { slug: 'gloria', name: 'Gloria', address: 'Königstraße 20, 70173 Stuttgart', district: 'mitte', lat: 48.7775, lng: 9.1775 },
  { slug: 'cinemaxx-liederhalle', name: 'CinemaxX Liederhalle', address: 'Robert-Bosch-Platz 1, 70174 Stuttgart', district: 'mitte', lat: 48.779, lng: 9.1705 },
  { slug: 'em-kino', name: 'EM-Kino', address: 'Bolzstraße 4, 70173 Stuttgart', district: 'mitte', lat: 48.78, lng: 9.1785 },
  { slug: 'metropol', name: 'Metropol', address: 'Bolzstraße 10, 70173 Stuttgart', district: 'mitte', lat: 48.7803, lng: 9.1795 },
  { slug: 'atelier-am-bollwerk', name: 'Atelier am Bollwerk', address: 'Hohe Straße 26, 70176 Stuttgart', district: 'mitte', lat: 48.781, lng: 9.172 },
  { slug: 'delphi-arthaus', name: 'Delphi Arthaus', address: 'Tübinger Straße 6, 70178 Stuttgart', district: 'sued', lat: 48.7735, lng: 9.1725 },
  { slug: 'corso-vaihingen', name: 'Corso', address: 'Hauptstraße 6, 70563 Stuttgart-Vaihingen', district: 'vaihingen', lat: 48.729, lng: 9.108 },
  { slug: 'cinemaxx-si-centrum', name: 'CinemaxX SI-Centrum', address: 'Plieninger Straße 111, 70567 Stuttgart-Möhringen', district: 'moehringen', lat: 48.727, lng: 9.153 },
  { slug: 'kinothek-obertuerkheim', name: 'Kinothek', address: 'Asangstraße 15, 70329 Stuttgart-Obertürkheim', district: 'obertuerkheim', lat: 48.762, lng: 9.269 },
];

export function seedCinemas(db: Db): number {
  let n = 0;
  for (const c of SEED_CINEMAS) {
    const r = run(
      db,
      `INSERT OR IGNORE INTO cinemas (slug, name, address, district, lat, lng, approx_coords, source) VALUES (?, ?, ?, ?, ?, ?, 1, 'seed')`,
      c.slug,
      c.name,
      c.address,
      c.district,
      c.lat,
      c.lng,
    );
    n += r.changes;
  }
  return n;
}

/** Вымышленные фильмы для демо-афиши — помечены is_demo, чтобы их не путали с реальным расписанием. */
const DEMO_MOVIES = [
  { title: 'Тихий берег Неккара', genres: ['драма'], runtime: 112, age: 'FSK 12', overview: 'Демо-фильм. Двое незнакомцев каждое утро встречаются на одной и той же скамейке у реки.' },
  { title: 'Космический курьер', genres: ['фантастика', 'приключения'], runtime: 128, age: 'FSK 12', overview: 'Демо-фильм. Курьер доставляет посылку на край галактики и попадает в переплёт.' },
  { title: 'Свадьба в Каннштатте', genres: ['комедия', 'мелодрама'], runtime: 98, age: 'FSK 6', overview: 'Демо-фильм. Свадьба во время народного праздника идёт совсем не по плану.' },
  { title: 'Ночной трамвай', genres: ['триллер', 'детектив'], runtime: 105, age: 'FSK 16', overview: 'Демо-фильм. Последний трамвай, семь пассажиров и одна пропавшая сумка.' },
  { title: 'Лис и барсук', genres: ['анимация', 'семейное'], runtime: 85, age: 'FSK 0', overview: 'Демо-фильм. Два соседа по лесу затевают грандиозный ремонт норы.' },
  { title: 'Дом на холме', genres: ['ужасы'], runtime: 94, age: 'FSK 16', overview: 'Демо-фильм. Риелтор показывает дом, в котором никто не задерживается дольше ночи.' },
];

const TIMES = ['14:30', '17:00', '18:15', '19:30', '20:15', '21:45'];

/** Идемпотентно: при каждом запуске продлевает демо-афишу на 14 дней вперёд. */
export function seedDemoCatalog(db: Db): void {
  tx(db, () => {
    const existing = all<{ id: number }>(db, 'SELECT id FROM movies WHERE is_demo = 1 ORDER BY id');
    const movieIds = existing.length ? existing.map((m) => m.id) : DEMO_MOVIES.map(
      (m) =>
        run(
          db,
          'INSERT INTO movies (title, overview, genres, runtime_min, age_rating, is_demo) VALUES (?, ?, ?, ?, ?, 1)',
          m.title + ' (демо)',
          m.overview,
          JSON.stringify(m.genres),
          m.runtime,
          m.age,
        ).lastId,
    );
    const cinemas = all<{ id: number }>(db, 'SELECT id FROM cinemas ORDER BY id');
    const today = berlinToday();
    for (let day = 0; day <= 14; day++) {
      const date = addDays(today, day);
      cinemas.forEach((c, ci) => {
        for (let k = 0; k < 4; k++) {
          const time = TIMES[(ci + day + k * 2) % TIMES.length]!;
          const movieId = movieIds[(ci * 3 + day + k) % movieIds.length]!;
          const n = ci + day + k;
          const language = n % 5 === 0 ? 'OmU' : n % 3 === 0 ? 'OV' : 'DE';
          run(
            db,
            `INSERT OR IGNORE INTO showtimes (movie_id, cinema_id, starts_at, language, source) VALUES (?, ?, ?, ?, 'demo')`,
            movieId,
            c.id,
            berlinLocalToUtc(date, time).toISOString(),
            language,
          );
        }
      });
    }
  });
}

const DEMO_USERS = [
  { email: 'anna@demo.kinobuddy', name: 'Анна', birth: '1994-03-12', gender: 'female', district: 'west', about: 'Люблю авторское кино и долгие разговоры после сеанса.', genres: ['драма', 'артхаус'], lang: 'ov', format: 'any' },
  { email: 'max@demo.kinobuddy', name: 'Макс', birth: '1990-07-02', gender: 'male', district: 'bad-cannstatt', about: 'Фантастика, попкорн и последние ряды.', genres: ['фантастика', 'боевик'], lang: 'dub', format: 'group' },
  { email: 'lena@demo.kinobuddy', name: 'Лена', birth: '1998-11-20', gender: 'female', district: 'vaihingen', about: 'Студентка, хожу в Corso почти каждую неделю.', genres: ['комедия', 'мелодрама', 'анимация'], lang: 'any', format: 'pair' },
  { email: 'oleg@demo.kinobuddy', name: 'Олег', birth: '1986-01-30', gender: 'male', district: 'sued', about: 'Триллеры и детективы. Обсуждать финал обязательно.', genres: ['триллер', 'детектив'], lang: 'ov', format: 'any' },
];
export const DEMO_PASSWORD = 'demo-pass-123';

export async function seedDemoUsers(db: Db): Promise<void> {
  if (get(db, 'SELECT 1 FROM users WHERE is_demo = 1')) return;
  const hash = await hashPassword(DEMO_PASSWORD);
  const showtimes = all<{ id: number; cinema_id: number; movie_id: number; starts_at: string; title: string }>(
    db,
    `SELECT s.id, s.cinema_id, s.movie_id, s.starts_at, m.title FROM showtimes s JOIN movies m ON m.id = s.movie_id
     WHERE s.starts_at > ? AND s.status = 'active' ORDER BY s.starts_at LIMIT 400`,
    nowIso(),
  );
  const messages = [
    'Давно хочу на этот фильм, ищу компанию. После сеанса можно на чай.',
    'Кто со мной? Билеты беру каждый себе.',
    'Иду после работы, буду рад(а) компании.',
    'Ищу компанию, которая любит обсуждать кино.',
  ];
  tx(db, () => {
    DEMO_USERS.forEach((u, i) => {
      const d = findDistrict('stuttgart', u.district)!;
      const userId = run(db, 'INSERT INTO users (email, password_hash, is_demo, created_at) VALUES (?, ?, 1, ?)', u.email, hash, nowIso()).lastId;
      run(
        db,
        `INSERT INTO profiles (user_id, display_name, birth_date, gender, city, district, lat, lng, about, genres, language_pref, meet_format)
         VALUES (?, ?, ?, ?, 'stuttgart', ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        u.name,
        u.birth,
        u.gender,
        d.id,
        d.lat,
        d.lng,
        u.about,
        JSON.stringify(u.genres),
        u.lang,
        u.format,
      );
      // По два приглашения на пользователя на разные дни
      for (let k = 0; k < 2; k++) {
        const st = showtimes[(i * 37 + k * 90 + 20) % Math.max(1, showtimes.length)];
        if (!st) continue;
        const group = u.format === 'group' || (u.format === 'any' && k === 1);
        run(
          db,
          `INSERT INTO invitations (author_id, showtime_id, cinema_id, movie_id, movie_title, starts_at, format, seats, message, tickets, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'self', ?)`,
          userId,
          st.id,
          st.cinema_id,
          st.movie_id,
          st.title,
          st.starts_at,
          group ? 'group' : 'pair',
          group ? 3 : 1,
          messages[(i + k) % messages.length]!,
          nowIso(),
        );
      }
    });
  });
}
