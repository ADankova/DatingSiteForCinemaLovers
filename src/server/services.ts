import type { Db } from './db.js';
import { all, get } from './db.js';
import { CITIES, findDistrict, haversineKm, round1 } from './geo.js';
import { HttpError, type Ctx, type SessionUser } from './http.js';
import { ageFromBirthDate } from './time.js';

export interface ProfileRow {
  user_id: number;
  display_name: string;
  birth_date: string;
  gender: string;
  city: string;
  district: string;
  lat: number;
  lng: number;
  about: string;
  genres: string;
  favorite_films: string;
  language_pref: string;
  meet_format: string;
  search_radius_km: number;
  visible: number;
}

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw new HttpError(401, 'Нужно войти');
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): SessionUser {
  const u = requireUser(ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'Только для администратора');
  return u;
}

export function getProfile(db: Db, userId: number): ProfileRow | undefined {
  return get<ProfileRow>(db, 'SELECT * FROM profiles WHERE user_id = ?', userId);
}

export function districtName(city: string, district: string): string {
  return findDistrict(city, district)?.name ?? district;
}

export function cityName(city: string): string {
  return CITIES.find((c) => c.id === city)?.name ?? city;
}

function parseJsonArray(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Публичное представление пользователя: без e-mail, даты рождения и координат. */
export function publicProfile(p: ProfileRow, memberSince?: string) {
  return {
    id: p.user_id,
    displayName: p.display_name,
    age: ageFromBirthDate(p.birth_date),
    gender: p.gender,
    city: cityName(p.city),
    district: districtName(p.city, p.district),
    about: p.about,
    genres: parseJsonArray(p.genres),
    favoriteFilms: p.favorite_films,
    languagePref: p.language_pref,
    meetFormat: p.meet_format,
    ...(memberSince ? { memberSince } : {}),
  };
}

/** Полная анкета для владельца. */
export function ownProfile(p: ProfileRow) {
  return {
    ...publicProfile(p),
    birthDate: p.birth_date,
    cityId: p.city,
    districtId: p.district,
    searchRadiusKm: p.search_radius_km,
    visible: p.visible === 1,
  };
}

/** Все пользователи, с которыми у userId есть блокировка в любую сторону. */
export function blockedSet(db: Db, userId: number | undefined): Set<number> {
  if (!userId) return new Set();
  const rows = all<{ other: number }>(
    db,
    `SELECT blocked_id AS other FROM blocks WHERE blocker_id = ?
     UNION SELECT blocker_id AS other FROM blocks WHERE blocked_id = ?`,
    userId,
    userId,
  );
  return new Set(rows.map((r) => r.other));
}

export function isBlockedBetween(db: Db, a: number, b: number): boolean {
  return !!get(
    db,
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    a,
    b,
    b,
    a,
  );
}

export interface Center {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Центр поиска по радиусу: район из параметра запроса (?city=&district=),
 * иначе район из анкеты пользователя. Геолокация браузера не используется.
 */
export function resolveCenter(db: Db, ctx: Ctx): Center | null {
  const district = ctx.query.get('district');
  const city = ctx.query.get('city') ?? 'stuttgart';
  if (district) {
    const d = findDistrict(city, district);
    if (!d) throw new HttpError(400, 'Неизвестный район');
    return { lat: d.lat, lng: d.lng, label: d.name };
  }
  if (ctx.user) {
    const p = getProfile(db, ctx.user.id);
    if (p) return { lat: p.lat, lng: p.lng, label: districtName(p.city, p.district) };
  }
  return null;
}

export function defaultRadius(db: Db, ctx: Ctx): number {
  if (ctx.user) {
    const p = getProfile(db, ctx.user.id);
    if (p) return p.search_radius_km;
  }
  return 10;
}

export function distanceFrom(center: Center | null, lat: number, lng: number): number | null {
  return center ? round1(haversineKm(center.lat, center.lng, lat, lng)) : null;
}

/** Связаны ли пользователи через приглашение (один откликался на приглашение другого). */
export function areConnected(db: Db, a: number, b: number): boolean {
  return !!get(
    db,
    `SELECT 1 FROM responses r JOIN invitations i ON i.id = r.invitation_id
     WHERE (i.author_id = ? AND r.user_id = ?) OR (i.author_id = ? AND r.user_id = ?) LIMIT 1`,
    a,
    b,
    b,
    a,
  );
}
