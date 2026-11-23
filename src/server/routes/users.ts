import type { Db } from '../db.js';
import { all, get, run, tx } from '../db.js';
import { HttpError, type Router } from '../http.js';
import { hhmm, httpUrl, idParam, int, isoDate, oneOf, str } from '../validate.js';
import { REPORT_REASONS, SHOW_LANGUAGES, type ReportReason } from '../meta.js';
import { areConnected, getProfile, isBlockedBetween, publicProfile, requireAdmin, requireUser } from '../services.js';
import { destroyAllSessions } from '../auth.js';
import { detachResponsesBetween } from './invitations.js';
import { berlinLocalToUtc, nowIso } from '../time.js';
import { findOrCreateMovie } from '../scrapers/importer.js';

export function registerUserRoutes(router: Router, db: Db) {
  /** Публичная страница пользователя. */
  router.get('/api/users/:id', (ctx) => {
    const me = requireUser(ctx);
    const id = idParam(ctx.params.id);
    const u = get<{ status: string; created_at: string }>(db, 'SELECT status, created_at FROM users WHERE id = ?', id);
    const p = getProfile(db, id);
    if (!u || !p || u.status !== 'active') throw new HttpError(404, 'Пользователь не найден');
    if (id !== me.id) {
      if (isBlockedBetween(db, me.id, id)) throw new HttpError(404, 'Пользователь не найден');
      // Скрытый профиль видят только те, с кем было общее приглашение
      if (p.visible !== 1 && !areConnected(db, me.id, id)) throw new HttpError(404, 'Пользователь не найден');
    }
    const invitations = all<{ id: number; movie_title: string; starts_at: string; cinema_name: string; format: string }>(
      db,
      `SELECT i.id, i.movie_title, i.starts_at, c.name AS cinema_name, i.format FROM invitations i JOIN cinemas c ON c.id = i.cinema_id
       WHERE i.author_id = ? AND i.status = 'open' AND i.starts_at > ? ORDER BY i.starts_at LIMIT 20`,
      id,
      nowIso(),
    ).map((i) => ({ id: i.id, movieTitle: i.movie_title, startsAt: i.starts_at, cinemaName: i.cinema_name, format: i.format }));
    const iBlocked = !!get(db, 'SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', me.id, id);
    return { user: publicProfile(p, u.created_at), invitations, isMe: id === me.id, iBlocked };
  });

  router.post('/api/users/:id/block', (ctx) => {
    const me = requireUser(ctx);
    const id = idParam(ctx.params.id);
    if (id === me.id) throw new HttpError(400, 'Нельзя заблокировать себя');
    if (!get(db, 'SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(404, 'Пользователь не найден');
    tx(db, () => {
      run(db, 'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', me.id, id, nowIso());
      detachResponsesBetween(db, me.id, id);
    });
    return { ok: true };
  });

  router.delete('/api/users/:id/block', (ctx) => {
    const me = requireUser(ctx);
    run(db, 'DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', me.id, idParam(ctx.params.id));
    return { ok: true };
  });

  router.post('/api/users/:id/report', (ctx) => {
    const me = requireUser(ctx);
    const id = idParam(ctx.params.id);
    if (id === me.id) throw new HttpError(400, 'Нельзя пожаловаться на себя');
    if (!get(db, 'SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(404, 'Пользователь не найден');
    const reason = oneOf(ctx.body, 'reason', Object.keys(REPORT_REASONS) as ReportReason[], undefined, 'Причина');
    const comment = str(ctx.body, 'comment', { max: 1000, label: 'Комментарий' });
    const recent = get(db, `SELECT 1 FROM reports WHERE reporter_id = ? AND target_id = ? AND status != 'closed'`, me.id, id);
    if (recent) throw new HttpError(409, 'Ваша жалоба на этого пользователя уже рассматривается');
    run(db, 'INSERT INTO reports (reporter_id, target_id, reason, comment, created_at) VALUES (?, ?, ?, ?, ?)', me.id, id, reason, comment, nowIso());
    ctx.status = 201;
    return { ok: true };
  });

  // ---- Администрирование ----
  router.get('/api/admin/reports', (ctx) => {
    requireAdmin(ctx);
    const status = ctx.query.get('status');
    const rows = all<{
      id: number;
      reason: string;
      comment: string;
      status: string;
      created_at: string;
      reporter_id: number;
      reporter_name: string | null;
      target_id: number;
      target_name: string | null;
      target_email: string;
      target_status: string;
      target_reports: number;
    }>(
      db,
      `SELECT r.id, r.reason, r.comment, r.status, r.created_at,
              r.reporter_id, rp.display_name AS reporter_name,
              r.target_id, tp.display_name AS target_name, tu.email AS target_email, tu.status AS target_status,
              (SELECT COUNT(*) FROM reports x WHERE x.target_id = r.target_id) AS target_reports
       FROM reports r
       LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
       LEFT JOIN profiles tp ON tp.user_id = r.target_id
       JOIN users tu ON tu.id = r.target_id
       ${status ? 'WHERE r.status = ?' : ''}
       ORDER BY r.status = 'closed', r.created_at DESC LIMIT 200`,
      ...(status ? [status] : []),
    );
    return {
      reports: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        reasonText: REPORT_REASONS[r.reason as ReportReason] ?? r.reason,
        comment: r.comment,
        status: r.status,
        createdAt: r.created_at,
        reporter: { id: r.reporter_id, displayName: r.reporter_name },
        target: { id: r.target_id, displayName: r.target_name, email: r.target_email, status: r.target_status, totalReports: r.target_reports },
      })),
    };
  });

  router.patch('/api/admin/reports/:id', (ctx) => {
    requireAdmin(ctx);
    const status = oneOf(ctx.body, 'status', ['new', 'in_progress', 'closed'] as const);
    const { changes } = run(db, 'UPDATE reports SET status = ? WHERE id = ?', status, idParam(ctx.params.id));
    if (!changes) throw new HttpError(404, 'Жалоба не найдена');
    return { ok: true };
  });

  router.post('/api/admin/users/:id/ban', (ctx) => {
    const admin = requireAdmin(ctx);
    const id = idParam(ctx.params.id);
    if (id === admin.id) throw new HttpError(400, 'Нельзя заблокировать себя');
    const banned = ctx.body.banned !== false;
    const { changes } = run(db, 'UPDATE users SET status = ? WHERE id = ?', banned ? 'banned' : 'active', id);
    if (!changes) throw new HttpError(404, 'Пользователь не найден');
    if (banned) {
      destroyAllSessions(db, id);
      run(db, `UPDATE invitations SET status = 'cancelled' WHERE author_id = ? AND status != 'cancelled'`, id);
    }
    return { ok: true };
  });

  /** Ручное добавление сеанса администратором. */
  router.post('/api/admin/showtimes', (ctx) => {
    requireAdmin(ctx);
    const b = ctx.body;
    const cinemaId = int(b, 'cinemaId', { min: 1, max: Number.MAX_SAFE_INTEGER, label: 'Кинотеатр' });
    if (!get(db, 'SELECT 1 FROM cinemas WHERE id = ?', cinemaId)) throw new HttpError(400, 'Кинотеатр не найден');
    const title = str(b, 'movieTitle', { min: 1, max: 150, required: true, label: 'Фильм' });
    const startsAt = berlinLocalToUtc(isoDate(b, 'date', 'Дата'), hhmm(b, 'time', 'Время')).toISOString();
    const language = oneOf(b, 'language', SHOW_LANGUAGES, 'DE', 'Язык');
    const ticketUrl = httpUrl(b, 'ticketUrl', 'Ссылка на билеты');
    const movieId = findOrCreateMovie(db, title);
    run(
      db,
      `INSERT INTO showtimes (movie_id, cinema_id, starts_at, language, ticket_url, source) VALUES (?, ?, ?, ?, ?, 'manual')
       ON CONFLICT (cinema_id, movie_id, starts_at) DO UPDATE SET language = excluded.language, ticket_url = excluded.ticket_url, status = 'active'`,
      movieId,
      cinemaId,
      startsAt,
      language,
      ticketUrl,
    );
    ctx.status = 201;
    return { ok: true };
  });
}
