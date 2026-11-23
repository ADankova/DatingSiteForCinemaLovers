import type { Db } from '../db.js';
import { get, run, tx } from '../db.js';
import { HttpError, RateLimiter, type Router } from '../http.js';
import {
  createSession,
  destroyAllSessions,
  destroySession,
  hashPassword,
  sessionCookie,
  verifyPassword,
  SESSION_COOKIE,
} from '../auth.js';
import { parseCookies } from '../http.js';
import { int, isoDate, oneOf, str } from '../validate.js';
import { CITIES, findDistrict } from '../geo.js';
import {
  GENDERS,
  GENRES,
  LANGUAGE_PREFS,
  MEET_FORMATS,
  REPORT_REASONS,
  SHOW_LANGUAGES,
  TICKET_MODES,
} from '../meta.js';
import { config } from '../config.js';
import { ageFromBirthDate, nowIso } from '../time.js';
import { getProfile, ownProfile, requireUser } from '../services.js';

const authLimiter = new RateLimiter(10, 15 * 60_000);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function profileFields(body: Record<string, unknown>) {
  const cityId = oneOf(body, 'cityId', CITIES.map((c) => c.id), 'stuttgart', 'Город');
  const districtId = str(body, 'districtId', { max: 40, required: true, label: 'Район' });
  const district = findDistrict(cityId, districtId);
  if (!district) throw new HttpError(400, 'Выберите район из списка');

  const genresRaw = body.genres ?? [];
  if (!Array.isArray(genresRaw)) throw new HttpError(400, 'Жанры должны быть списком');
  const genres = [...new Set(genresRaw)].filter((g): g is string => (GENRES as readonly string[]).includes(g as string));

  return {
    displayName: str(body, 'displayName', { min: 2, max: 40, required: true, label: 'Имя' }),
    gender: oneOf(body, 'gender', GENDERS, 'unspecified', 'Пол'),
    cityId,
    district,
    about: str(body, 'about', { max: 500, label: 'О себе' }),
    genres,
    favoriteFilms: str(body, 'favoriteFilms', { max: 300, label: 'Любимые фильмы' }),
    languagePref: oneOf(body, 'languagePref', LANGUAGE_PREFS, 'any', 'Язык показа'),
    meetFormat: oneOf(body, 'meetFormat', MEET_FORMATS, 'any', 'Формат встречи'),
    searchRadiusKm: int(body, 'searchRadiusKm', { min: 1, max: 50, def: 10, label: 'Радиус поиска' }),
    visible: body.visible === undefined ? true : body.visible === true,
  };
}

export function registerAuthRoutes(router: Router, db: Db) {
  router.get('/api/meta', () => ({
    cities: CITIES.map((c) => ({ id: c.id, name: c.name, districts: c.districts.map((d) => ({ id: d.id, name: d.name })) })),
    genres: GENRES,
    reportReasons: REPORT_REASONS,
    showLanguages: SHOW_LANGUAGES,
    ticketModes: TICKET_MODES,
  }));

  router.post('/api/auth/register', async (ctx) => {
    authLimiter.check('reg:' + ctx.ip);
    const b = ctx.body;
    const email = str(b, 'email', { max: 200, required: true, label: 'E-mail' }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Неверный e-mail');
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Пароль: от 8 до 200 символов');
    const birthDate = isoDate(b, 'birthDate', 'Дата рождения');
    const age = ageFromBirthDate(birthDate);
    if (age < 18) throw new HttpError(400, 'Сервис доступен только с 18 лет');
    if (age > 120) throw new HttpError(400, 'Проверьте дату рождения');
    if (b.acceptTerms !== true) throw new HttpError(400, 'Нужно принять пользовательское соглашение и политику конфиденциальности');
    const p = profileFields(b);

    if (get(db, 'SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Этот e-mail уже зарегистрирован');
    const passwordHash = await hashPassword(password);
    const role = config.adminEmail && email === config.adminEmail ? 'admin' : 'user';

    const userId = tx(db, () => {
      const { lastId } = run(db, 'INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)', email, passwordHash, role, nowIso());
      run(
        db,
        `INSERT INTO profiles (user_id, display_name, birth_date, gender, city, district, lat, lng, about, genres,
           favorite_films, language_pref, meet_format, search_radius_km, visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        lastId,
        p.displayName,
        birthDate,
        p.gender,
        p.cityId,
        p.district.id,
        p.district.lat,
        p.district.lng,
        p.about,
        JSON.stringify(p.genres),
        p.favoriteFilms,
        p.languagePref,
        p.meetFormat,
        p.searchRadiusKm,
        p.visible ? 1 : 0,
      );
      return lastId;
    });

    const { cookie } = createSession(db, userId);
    ctx.setCookie(cookie);
    ctx.status = 201;
    return { id: userId };
  });

  router.post('/api/auth/login', async (ctx) => {
    authLimiter.check('login:' + ctx.ip);
    const email = str(ctx.body, 'email', { max: 200, required: true, label: 'E-mail' }).toLowerCase();
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const user = get<{ id: number; password_hash: string; status: string }>(
      db,
      'SELECT id, password_hash, status FROM users WHERE email = ?',
      email,
    );
    // Хешируем даже при неизвестном e-mail, чтобы время ответа не выдавало существование аккаунта
    const ok = await verifyPassword(password, user?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    if (!user || !ok) throw new HttpError(401, 'Неверный e-mail или пароль');
    if (user.status !== 'active') throw new HttpError(403, 'Аккаунт заблокирован администратором');
    const { cookie } = createSession(db, user.id);
    ctx.setCookie(cookie);
    return { id: user.id };
  });

  router.post('/api/auth/logout', (ctx) => {
    destroySession(db, parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE]);
    ctx.setCookie(sessionCookie('', 0));
    return { ok: true };
  });

  router.get('/api/me', (ctx) => {
    if (!ctx.user) return { user: null };
    const u = get<{ email: string; role: string; created_at: string }>(db, 'SELECT email, role, created_at FROM users WHERE id = ?', ctx.user.id);
    const p = getProfile(db, ctx.user.id);
    if (!u || !p) return { user: null };
    return { user: { id: ctx.user.id, email: u.email, role: u.role, memberSince: u.created_at, profile: ownProfile(p) } };
  });

  router.put('/api/me/profile', (ctx) => {
    const user = requireUser(ctx);
    const p = profileFields(ctx.body);
    run(
      db,
      `UPDATE profiles SET display_name = ?, gender = ?, city = ?, district = ?, lat = ?, lng = ?, about = ?, genres = ?,
         favorite_films = ?, language_pref = ?, meet_format = ?, search_radius_km = ?, visible = ? WHERE user_id = ?`,
      p.displayName,
      p.gender,
      p.cityId,
      p.district.id,
      p.district.lat,
      p.district.lng,
      p.about,
      JSON.stringify(p.genres),
      p.favoriteFilms,
      p.languagePref,
      p.meetFormat,
      p.searchRadiusKm,
      p.visible ? 1 : 0,
      user.id,
    );
    return { profile: ownProfile(getProfile(db, user.id)!) };
  });

  router.delete('/api/me', async (ctx) => {
    const user = requireUser(ctx);
    const row = get<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', user.id);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(401, 'Неверный пароль');
    destroyAllSessions(db, user.id);
    run(db, 'DELETE FROM users WHERE id = ?', user.id);
    ctx.setCookie(sessionCookie('', 0));
    return { ok: true };
  });
}
