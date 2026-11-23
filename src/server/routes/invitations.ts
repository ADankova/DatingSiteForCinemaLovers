import type { Db } from '../db.js';
import { all, get, run, tx } from '../db.js';
import { HttpError, RateLimiter, type Ctx, type Router } from '../http.js';
import { hhmm, idParam, int, isoDate, oneOf, queryInt, str } from '../validate.js';
import { INVITATION_FORMATS, TICKET_MODES } from '../meta.js';
import {
  blockedSet,
  defaultRadius,
  distanceFrom,
  districtName,
  isBlockedBetween,
  requireUser,
  resolveCenter,
  type Center,
} from '../services.js';
import { ageFromBirthDate, berlinDayRange, berlinLocalToUtc, nowIso } from '../time.js';

const MAX_OPEN_INVITATIONS = 10;
const messageLimiter = new RateLimiter(30, 60_000);

interface InvitationRow {
  id: number;
  author_id: number;
  showtime_id: number | null;
  cinema_id: number;
  movie_id: number | null;
  movie_title: string;
  starts_at: string;
  format: 'pair' | 'group';
  seats: number;
  message: string;
  tickets: string;
  status: 'open' | 'full' | 'cancelled';
  created_at: string;
  cinema_name: string;
  cinema_address: string;
  lat: number;
  lng: number;
  website: string;
  language: string | null;
  ticket_url: string | null;
  poster_url: string | null;
  display_name: string;
  birth_date: string;
  gender: string;
  pcity: string;
  pdistrict: string;
  accepted_count: number;
  pending_count: number;
}

const BASE_SELECT = `
  SELECT i.*, c.name AS cinema_name, c.address AS cinema_address, c.lat, c.lng, c.website,
         s.language, s.ticket_url, m.poster_url,
         p.display_name, p.birth_date, p.gender, p.city AS pcity, p.district AS pdistrict,
         (SELECT COUNT(*) FROM responses r WHERE r.invitation_id = i.id AND r.status = 'accepted') AS accepted_count,
         (SELECT COUNT(*) FROM responses r WHERE r.invitation_id = i.id AND r.status = 'pending') AS pending_count
  FROM invitations i
  JOIN cinemas c ON c.id = i.cinema_id
  LEFT JOIN showtimes s ON s.id = i.showtime_id
  LEFT JOIN movies m ON m.id = i.movie_id
  JOIN profiles p ON p.user_id = i.author_id
  JOIN users u ON u.id = i.author_id`;

function invitationOut(r: InvitationRow, center: Center | null) {
  return {
    id: r.id,
    author: {
      id: r.author_id,
      displayName: r.display_name,
      age: ageFromBirthDate(r.birth_date),
      gender: r.gender,
      district: districtName(r.pcity, r.pdistrict),
    },
    showtimeId: r.showtime_id,
    movieId: r.movie_id,
    movieTitle: r.movie_title,
    posterUrl: r.poster_url ?? '',
    startsAt: r.starts_at,
    language: r.language ?? '',
    ticketUrl: r.ticket_url || r.website,
    cinema: { id: r.cinema_id, name: r.cinema_name, address: r.cinema_address, distanceKm: distanceFrom(center, r.lat, r.lng) },
    format: r.format,
    seats: r.seats,
    acceptedCount: r.accepted_count,
    pendingCount: r.pending_count,
    message: r.message,
    tickets: r.tickets,
    status: r.status,
    isPast: r.starts_at <= nowIso(),
    createdAt: r.created_at,
  };
}

function loadInvitation(db: Db, id: number): InvitationRow {
  const row = get<InvitationRow>(db, `${BASE_SELECT} WHERE i.id = ?`, id);
  if (!row) throw new HttpError(404, 'Приглашение не найдено');
  return row;
}

/** Пересчитать статус open/full после изменения откликов. */
function syncFullStatus(db: Db, invitationId: number) {
  const inv = get<{ seats: number; status: string }>(db, 'SELECT seats, status FROM invitations WHERE id = ?', invitationId);
  if (!inv || inv.status === 'cancelled') return;
  const accepted = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM responses WHERE invitation_id = ? AND status = 'accepted'`, invitationId)!.n;
  const next = accepted >= inv.seats ? 'full' : 'open';
  if (next !== inv.status) run(db, 'UPDATE invitations SET status = ? WHERE id = ?', next, invitationId);
}

/** Может ли пользователь читать и писать в чат приглашения. */
export function canChat(db: Db, invitationId: number, userId: number): boolean {
  const inv = get<{ author_id: number }>(db, 'SELECT author_id FROM invitations WHERE id = ?', invitationId);
  if (!inv) return false;
  if (inv.author_id === userId) return true;
  return !!get(db, `SELECT 1 FROM responses WHERE invitation_id = ? AND user_id = ? AND status = 'accepted'`, invitationId, userId);
}

/** При блокировке: снять отклики между двумя пользователями в обе стороны. */
export function detachResponsesBetween(db: Db, a: number, b: number) {
  const rows = all<{ id: number; invitation_id: number }>(
    db,
    `SELECT r.id, r.invitation_id FROM responses r JOIN invitations i ON i.id = r.invitation_id
     WHERE r.status IN ('pending','accepted') AND ((i.author_id = ? AND r.user_id = ?) OR (i.author_id = ? AND r.user_id = ?))`,
    a,
    b,
    b,
    a,
  );
  for (const r of rows) {
    run(db, `UPDATE responses SET status = 'declined' WHERE id = ?`, r.id);
    syncFullStatus(db, r.invitation_id);
  }
}

function resolveTarget(db: Db, body: Record<string, unknown>) {
  if (body.showtimeId !== undefined && body.showtimeId !== null && body.showtimeId !== '') {
    const showtimeId = int(body, 'showtimeId', { min: 1, max: Number.MAX_SAFE_INTEGER, label: 'Сеанс' });
    const st = get<{ id: number; cinema_id: number; movie_id: number; starts_at: string; title: string; status: string }>(
      db,
      `SELECT s.id, s.cinema_id, s.movie_id, s.starts_at, s.status, m.title FROM showtimes s JOIN movies m ON m.id = s.movie_id WHERE s.id = ?`,
      showtimeId,
    );
    if (!st || st.status !== 'active') throw new HttpError(400, 'Сеанс не найден');
    return { showtimeId: st.id, cinemaId: st.cinema_id, movieId: st.movie_id as number | null, movieTitle: st.title, startsAt: st.starts_at };
  }
  // Ручной ввод: сеанса нет в афише
  const cinemaId = int(body, 'cinemaId', { min: 1, max: Number.MAX_SAFE_INTEGER, label: 'Кинотеатр' });
  if (!get(db, 'SELECT 1 FROM cinemas WHERE id = ?', cinemaId)) throw new HttpError(400, 'Кинотеатр не найден');
  const movieTitle = str(body, 'movieTitle', { min: 1, max: 150, required: true, label: 'Фильм' });
  const startsAt = berlinLocalToUtc(isoDate(body, 'date', 'Дата'), hhmm(body, 'time', 'Время')).toISOString();
  const movie = get<{ id: number }>(db, 'SELECT id FROM movies WHERE title = ? COLLATE NOCASE', movieTitle);
  return { showtimeId: null as number | null, cinemaId, movieId: movie?.id ?? null, movieTitle, startsAt };
}

export function registerInvitationRoutes(router: Router, db: Db) {
  /** Лента приглашений. */
  router.get('/api/invitations', (ctx) => {
    const me = ctx.user?.id;
    const blocked = blockedSet(db, me);
    const center = resolveCenter(db, ctx);
    const radius = center ? (queryInt(ctx.query, 'radius', 1, 50) ?? defaultRadius(db, ctx)) : undefined;
    const date = ctx.query.get('date');
    const range = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? berlinDayRange(date) : null;
    const movieQ = (ctx.query.get('movie') ?? '').trim().toLowerCase();
    const format = ctx.query.get('format');
    const showtime = queryInt(ctx.query, 'showtime', 1, Number.MAX_SAFE_INTEGER);
    const ageMin = queryInt(ctx.query, 'ageMin', 18, 120);
    const ageMax = queryInt(ctx.query, 'ageMax', 18, 120);

    const rows = all<InvitationRow>(
      db,
      `${BASE_SELECT} WHERE u.status = 'active' AND i.status = 'open' AND i.starts_at > ? ORDER BY i.starts_at LIMIT 500`,
      nowIso(),
    );
    const out = [];
    for (const r of rows) {
      if (r.author_id === me || blocked.has(r.author_id)) continue;
      if (showtime && r.showtime_id !== showtime) continue;
      if (range && (r.starts_at < range[0] || r.starts_at >= range[1])) continue;
      if (movieQ && !r.movie_title.toLowerCase().includes(movieQ)) continue;
      if ((format === 'pair' || format === 'group') && r.format !== format) continue;
      const age = ageFromBirthDate(r.birth_date);
      if (ageMin && age < ageMin) continue;
      if (ageMax && age > ageMax) continue;
      const item = invitationOut(r, center);
      if (radius !== undefined && item.cinema.distanceKm !== null && item.cinema.distanceKm > radius) continue;
      out.push(item);
      if (out.length >= 100) break;
    }
    return { center: center ? { label: center.label } : null, radiusKm: radius ?? null, invitations: out };
  });

  router.post('/api/invitations', (ctx) => {
    const user = requireUser(ctx);
    const b = ctx.body;
    const t = resolveTarget(db, b);
    if (t.startsAt <= nowIso()) throw new HttpError(400, 'Нельзя пригласить на сеанс, который уже начался');
    const format = oneOf(b, 'format', INVITATION_FORMATS, 'pair', 'Формат');
    const seats = format === 'pair' ? 1 : int(b, 'seats', { min: 1, max: 5, def: 2, label: 'Мест' });
    const message = str(b, 'message', { max: 300, label: 'Сообщение' });
    const tickets = oneOf(b, 'tickets', TICKET_MODES, 'self', 'Билеты');

    const openCount = get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM invitations WHERE author_id = ? AND status IN ('open','full') AND starts_at > ?`,
      user.id,
      nowIso(),
    )!.n;
    if (openCount >= MAX_OPEN_INVITATIONS) throw new HttpError(409, `Можно иметь не больше ${MAX_OPEN_INVITATIONS} активных приглашений`);
    if (
      t.showtimeId &&
      get(db, `SELECT 1 FROM invitations WHERE author_id = ? AND showtime_id = ? AND status IN ('open','full')`, user.id, t.showtimeId)
    )
      throw new HttpError(409, 'У вас уже есть приглашение на этот сеанс');

    const { lastId } = run(
      db,
      `INSERT INTO invitations (author_id, showtime_id, cinema_id, movie_id, movie_title, starts_at, format, seats, message, tickets, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id,
      t.showtimeId,
      t.cinemaId,
      t.movieId,
      t.movieTitle,
      t.startsAt,
      format,
      seats,
      message,
      tickets,
      nowIso(),
    );
    ctx.status = 201;
    return { invitation: invitationOut(loadInvitation(db, lastId), resolveCenter(db, ctx)) };
  });

  router.get('/api/invitations/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = loadInvitation(db, idParam(ctx.params.id));
    if (row.author_id !== user.id && isBlockedBetween(db, user.id, row.author_id)) throw new HttpError(404, 'Приглашение не найдено');
    const isAuthor = row.author_id === user.id;
    const out = invitationOut(row, resolveCenter(db, ctx));

    const myResponse = isAuthor
      ? null
      : (get<{ id: number; status: string; message: string }>(
          db,
          'SELECT id, status, message FROM responses WHERE invitation_id = ? AND user_id = ?',
          row.id,
          user.id,
        ) ?? null);

    let responses: unknown[] | null = null;
    if (isAuthor) {
      const blocked = blockedSet(db, user.id);
      responses = all<{ id: number; user_id: number; message: string; status: string; created_at: string; display_name: string; birth_date: string; city: string; district: string; gender: string }>(
        db,
        `SELECT r.id, r.user_id, r.message, r.status, r.created_at, p.display_name, p.birth_date, p.city, p.district, p.gender
         FROM responses r JOIN profiles p ON p.user_id = r.user_id JOIN users u ON u.id = r.user_id
         WHERE r.invitation_id = ? AND r.status != 'withdrawn' AND u.status = 'active' ORDER BY r.created_at`,
        row.id,
      )
        .filter((r) => !blocked.has(r.user_id))
        .map((r) => ({
          id: r.id,
          status: r.status,
          message: r.message,
          createdAt: r.created_at,
          user: { id: r.user_id, displayName: r.display_name, age: ageFromBirthDate(r.birth_date), gender: r.gender, district: districtName(r.city, r.district) },
        }));
    }

    const participants = all<{ user_id: number; display_name: string }>(
      db,
      `SELECT r.user_id, p.display_name FROM responses r JOIN profiles p ON p.user_id = r.user_id
       WHERE r.invitation_id = ? AND r.status = 'accepted'`,
      row.id,
    ).map((p) => ({ id: p.user_id, displayName: p.display_name }));

    // Автору чат показываем, когда есть хотя бы один принятый участник
    const chatOpen = isAuthor ? participants.length > 0 : canChat(db, row.id, user.id);
    return { invitation: out, isAuthor, myResponse, responses, participants, canChat: chatOpen };
  });

  router.delete('/api/invitations/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = loadInvitation(db, idParam(ctx.params.id));
    if (row.author_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Отменить может только автор');
    run(db, `UPDATE invitations SET status = 'cancelled' WHERE id = ?`, row.id);
    return { ok: true };
  });

  router.post('/api/invitations/:id/responses', (ctx) => {
    const user = requireUser(ctx);
    const row = loadInvitation(db, idParam(ctx.params.id));
    if (row.author_id === user.id) throw new HttpError(400, 'Нельзя откликнуться на своё приглашение');
    if (isBlockedBetween(db, user.id, row.author_id)) throw new HttpError(404, 'Приглашение не найдено');
    if (row.status !== 'open' || row.starts_at <= nowIso()) throw new HttpError(409, 'Приглашение уже закрыто');
    const message = str(ctx.body, 'message', { max: 300, label: 'Сообщение' });

    const existing = get<{ id: number; status: string }>(db, 'SELECT id, status FROM responses WHERE invitation_id = ? AND user_id = ?', row.id, user.id);
    if (existing) {
      if (existing.status !== 'withdrawn') throw new HttpError(409, 'Вы уже откликнулись на это приглашение');
      run(db, `UPDATE responses SET status = 'pending', message = ?, created_at = ? WHERE id = ?`, message, nowIso(), existing.id);
      ctx.status = 201;
      return { response: { id: existing.id, status: 'pending' } };
    }
    const { lastId } = run(
      db,
      'INSERT INTO responses (invitation_id, user_id, message, created_at) VALUES (?, ?, ?, ?)',
      row.id,
      user.id,
      message,
      nowIso(),
    );
    ctx.status = 201;
    return { response: { id: lastId, status: 'pending' } };
  });

  /** accept / decline — автор; withdraw — откликнувшийся. */
  router.patch('/api/responses/:id', (ctx) => {
    const user = requireUser(ctx);
    const action = oneOf(ctx.body, 'action', ['accept', 'decline', 'withdraw'] as const);
    const r = get<{ id: number; invitation_id: number; user_id: number; status: string; author_id: number; inv_status: string; starts_at: string; seats: number }>(
      db,
      `SELECT r.id, r.invitation_id, r.user_id, r.status, i.author_id, i.status AS inv_status, i.starts_at, i.seats
       FROM responses r JOIN invitations i ON i.id = r.invitation_id WHERE r.id = ?`,
      idParam(ctx.params.id),
    );
    if (!r) throw new HttpError(404, 'Отклик не найден');

    return tx(db, () => {
      if (action === 'withdraw') {
        if (r.user_id !== user.id) throw new HttpError(403, 'Отозвать может только автор отклика');
        if (r.status !== 'pending' && r.status !== 'accepted') throw new HttpError(409, 'Отклик уже неактивен');
        run(db, `UPDATE responses SET status = 'withdrawn' WHERE id = ?`, r.id);
      } else {
        if (r.author_id !== user.id) throw new HttpError(403, 'Принимать отклики может только автор приглашения');
        if (action === 'accept') {
          if (r.status !== 'pending') throw new HttpError(409, 'Этот отклик нельзя принять');
          if (r.inv_status === 'cancelled' || r.starts_at <= nowIso()) throw new HttpError(409, 'Приглашение уже неактуально');
          if (isBlockedBetween(db, r.author_id, r.user_id)) throw new HttpError(409, 'Пользователь недоступен');
          const accepted = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM responses WHERE invitation_id = ? AND status = 'accepted'`, r.invitation_id)!.n;
          if (accepted >= r.seats) throw new HttpError(409, 'Все места уже заняты');
          run(db, `UPDATE responses SET status = 'accepted' WHERE id = ?`, r.id);
        } else {
          if (r.status !== 'pending' && r.status !== 'accepted') throw new HttpError(409, 'Этот отклик нельзя отклонить');
          run(db, `UPDATE responses SET status = 'declined' WHERE id = ?`, r.id);
        }
      }
      syncFullStatus(db, r.invitation_id);
      const updated = get<{ status: string }>(db, 'SELECT status FROM responses WHERE id = ?', r.id)!;
      return { response: { id: r.id, status: updated.status } };
    });
  });

  /** Мои приглашения и мои отклики (предстоящие и за последние 7 дней). */
  router.get('/api/my/invitations', (ctx) => {
    const user = requireUser(ctx);
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const center = resolveCenter(db, ctx);
    const authored = all<InvitationRow>(db, `${BASE_SELECT} WHERE i.author_id = ? AND i.starts_at > ? ORDER BY i.starts_at`, user.id, since).map(
      (r) => invitationOut(r, center),
    );
    const responded = all<InvitationRow & { response_id: number; response_status: string }>(
      db,
      `${BASE_SELECT.replace('SELECT i.*', 'SELECT i.*, rr.id AS response_id, rr.status AS response_status')}
       JOIN responses rr ON rr.invitation_id = i.id AND rr.user_id = ?
       WHERE i.starts_at > ? AND rr.status != 'withdrawn' ORDER BY i.starts_at`,
      user.id,
      since,
    ).map((r) => ({ response: { id: r.response_id, status: r.response_status }, invitation: invitationOut(r, center) }));
    return { authored, responded };
  });

  // ---- Чат ----
  function chatGuard(ctx: Ctx) {
    const user = requireUser(ctx);
    const invitationId = idParam(ctx.params.id);
    if (!canChat(db, invitationId, user.id)) throw new HttpError(403, 'Чат доступен автору и принятым участникам');
    return { user, invitationId };
  }

  router.get('/api/invitations/:id/messages', (ctx) => {
    const { user, invitationId } = chatGuard(ctx);
    const after = queryInt(ctx.query, 'after', 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const blocked = blockedSet(db, user.id);
    const rows = all<{ id: number; sender_id: number; text: string; created_at: string; display_name: string | null }>(
      db,
      `SELECT m.id, m.sender_id, m.text, m.created_at, p.display_name FROM messages m
       LEFT JOIN profiles p ON p.user_id = m.sender_id
       WHERE m.invitation_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`,
      invitationId,
      after,
    );
    return {
      messages: rows
        .filter((m) => !blocked.has(m.sender_id))
        .map((m) => ({
          id: m.id,
          sender: { id: m.sender_id, displayName: m.display_name ?? 'Удалённый пользователь' },
          text: m.text,
          createdAt: m.created_at,
          mine: m.sender_id === user.id,
        })),
    };
  });

  router.post('/api/invitations/:id/messages', (ctx) => {
    const { user, invitationId } = chatGuard(ctx);
    messageLimiter.check('msg:' + user.id);
    const text = str(ctx.body, 'text', { min: 1, max: 1000, required: true, label: 'Сообщение' });
    const { lastId } = run(db, 'INSERT INTO messages (invitation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)', invitationId, user.id, text, nowIso());
    ctx.status = 201;
    return { message: { id: lastId } };
  });
}
