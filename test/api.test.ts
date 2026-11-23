import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, run, type Db } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
import { seedCinemas, seedDemoCatalog } from '../src/server/seed.js';
import { importShowtimes } from '../src/server/scrapers/importer.js';
import { importOsmElements } from '../src/server/integrations/osm-import.js';
import { addDays, berlinToday } from '../src/server/time.js';

let db: Db;
let server: Server;
let base = '';

before(async () => {
  db = openDb(':memory:');
  seedCinemas(db);
  seedDemoCatalog(db);
  server = createApp(db, { publicDir: 'public' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  db.close();
});

/** Клиент с собственной cookie-сессией. */
function client() {
  let cookie = '';
  return async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return { status: res.status, data: (await res.json()) as T };
  };
}

const profile = (name: string, district: string) => ({
  displayName: name,
  districtId: district,
  cityId: 'stuttgart',
  genres: ['драма', 'несуществующий'],
  acceptTerms: true,
  birthDate: '1995-05-05',
  password: 'secret-password',
});

let anna: ReturnType<typeof client>;
let boris: ReturnType<typeof client>;
let vera: ReturnType<typeof client>;
let annaId = 0;
let borisId = 0;
let veraId = 0;

test('регистрация: 18+, валидация, приватность', async () => {
  const c = client();
  const minor = await c('POST', '/api/auth/register', { ...profile('Тест', 'mitte'), email: 'kid@x.de', birthDate: addDays(berlinToday(), -365 * 17) });
  assert.equal(minor.status, 400);
  assert.match(minor.data.error, /18/);

  const noTerms = await c('POST', '/api/auth/register', { ...profile('Тест', 'mitte'), email: 't@x.de', acceptTerms: false });
  assert.equal(noTerms.status, 400);

  anna = client();
  boris = client();
  vera = client();
  annaId = (await anna('POST', '/api/auth/register', { ...profile('Анна', 'west'), email: 'anna@x.de' })).data.id;
  borisId = (await boris('POST', '/api/auth/register', { ...profile('Борис', 'mitte'), email: 'boris@x.de' })).data.id;
  veraId = (await vera('POST', '/api/auth/register', { ...profile('Вера', 'vaihingen'), email: 'vera@x.de' })).data.id;
  assert.ok(annaId && borisId && veraId);

  const dup = await client()('POST', '/api/auth/register', { ...profile('Анна2', 'west'), email: 'ANNA@x.de' });
  assert.equal(dup.status, 409);

  const me = await anna('GET', '/api/me');
  assert.deepEqual(me.data.user.profile.genres, ['драма']); // неизвестный жанр отброшен

  const pub = await boris('GET', `/api/users/${annaId}`);
  assert.equal(pub.status, 200);
  const json = JSON.stringify(pub.data);
  assert.ok(!json.includes('anna@x.de'), 'e-mail не должен попадать в публичный профиль');
  assert.ok(!json.includes('1995-05-05'), 'дата рождения не должна попадать в публичный профиль');
  assert.ok(!('lat' in pub.data.user) && !('lng' in pub.data.user), 'координаты не должны отдаваться');
  assert.equal(pub.data.user.district, 'West');
});

test('вход и CSRF-защита', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { email: 'anna@x.de', password: 'wrong-password' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: 'anna@x.de', password: 'secret-password' })).status, 200);
  // Изменяющий запрос без JSON отклоняется
  const res = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(res.status, 415);
});

test('кинотеатры: радиус от района из анкеты, сортировка по расстоянию', async () => {
  const r = await vera('GET', '/api/cinemas?radius=3'); // Вера в Vaihingen
  assert.equal(r.status, 200);
  assert.ok(r.data.cinemas.length >= 1);
  assert.equal(r.data.cinemas[0].slug, 'corso-vaihingen');
  for (const c of r.data.cinemas) assert.ok(c.distanceKm <= 3);

  const all = await vera('GET', '/api/cinemas?radius=all');
  const d = all.data.cinemas.map((c: { distanceKm: number }) => c.distanceKm);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
  assert.ok(all.data.cinemas.length > r.data.cinemas.length);

  const guest = await client()('GET', '/api/cinemas?district=mitte&radius=2&q=cinemaxx');
  assert.deepEqual(guest.data.cinemas.map((c: { slug: string }) => c.slug), ['cinemaxx-liederhalle']);
});

let showtimeId = 0;
let invitationId = 0;

test('афиша и создание приглашения', async () => {
  const tomorrow = addDays(berlinToday(), 1);
  const r = await anna('GET', `/api/showtimes?date=${tomorrow}&radius=50`);
  assert.equal(r.status, 200);
  assert.ok(r.data.showtimes.length > 0);
  showtimeId = r.data.showtimes[0].id;

  const one = await anna('GET', `/api/showtimes/${showtimeId}`);
  assert.equal(one.data.showtime.id, showtimeId);

  const bad = await anna('GET', `/api/showtimes?date=${addDays(berlinToday(), 30)}`);
  assert.equal(bad.status, 400);

  const created = await anna('POST', '/api/invitations', { showtimeId, format: 'pair', message: 'Кто со мной?' });
  assert.equal(created.status, 201);
  invitationId = created.data.invitation.id;

  const again = await anna('POST', '/api/invitations', { showtimeId, format: 'pair' });
  assert.equal(again.status, 409);

  const past = await anna('POST', '/api/invitations', { cinemaId: 1, movieTitle: 'Старый фильм', date: '2020-01-01', time: '20:00' });
  assert.equal(past.status, 400);

  const manual = await anna('POST', '/api/invitations', { cinemaId: 1, movieTitle: 'Фильм не из афиши', date: addDays(berlinToday(), 3), time: '19:00', format: 'group', seats: 3 });
  assert.equal(manual.status, 201);
  assert.equal(manual.data.invitation.seats, 3);

  const guest = await client()('POST', '/api/invitations', { showtimeId });
  assert.equal(guest.status, 401);
});

test('лента, отклик, принятие, чат', async () => {
  const feed = await boris('GET', '/api/invitations?radius=50');
  assert.ok(feed.data.invitations.some((i: { id: number }) => i.id === invitationId));
  const own = await anna('GET', '/api/invitations?radius=50');
  assert.ok(!own.data.invitations.some((i: { id: number }) => i.id === invitationId), 'своё приглашение не показывается в ленте');

  // Чат до принятия недоступен
  assert.equal((await boris('GET', `/api/invitations/${invitationId}/messages`)).status, 403);

  const resp = await boris('POST', `/api/invitations/${invitationId}/responses`, { message: 'Я!' });
  assert.equal(resp.status, 201);
  assert.equal((await boris('POST', `/api/invitations/${invitationId}/responses`, {})).status, 409);
  const veraResp = await vera('POST', `/api/invitations/${invitationId}/responses`, {});
  assert.equal(veraResp.status, 201);

  // Принять может только автор
  assert.equal((await boris('PATCH', `/api/responses/${resp.data.response.id}`, { action: 'accept' })).status, 403);
  const detail = await anna('GET', `/api/invitations/${invitationId}`);
  assert.equal(detail.data.responses.length, 2);
  assert.equal((await anna('PATCH', `/api/responses/${resp.data.response.id}`, { action: 'accept' })).status, 200);

  // Формат «вдвоём»: мест больше нет
  assert.equal((await anna('PATCH', `/api/responses/${veraResp.data.response.id}`, { action: 'accept' })).status, 409);
  const afterAccept = await anna('GET', `/api/invitations/${invitationId}`);
  assert.equal(afterAccept.data.invitation.status, 'full');

  // Чат: автор и принятый участник — да, Вера — нет
  assert.equal((await anna('POST', `/api/invitations/${invitationId}/messages`, { text: 'Встречаемся у входа в 19:45' })).status, 201);
  assert.equal((await boris('POST', `/api/invitations/${invitationId}/messages`, { text: 'Договорились' })).status, 201);
  assert.equal((await vera('GET', `/api/invitations/${invitationId}/messages`)).status, 403);
  const msgs = await boris('GET', `/api/invitations/${invitationId}/messages`);
  assert.equal(msgs.data.messages.length, 2);
  assert.equal(msgs.data.messages[1].mine, true);
  const after1 = await boris('GET', `/api/invitations/${invitationId}/messages?after=${msgs.data.messages[0].id}`);
  assert.equal(after1.data.messages.length, 1);

  // Отзыв принятого отклика снова открывает места
  assert.equal((await boris('PATCH', `/api/responses/${resp.data.response.id}`, { action: 'withdraw' })).status, 200);
  assert.equal((await anna('GET', `/api/invitations/${invitationId}`)).data.invitation.status, 'open');
  assert.equal((await boris('GET', `/api/invitations/${invitationId}/messages`)).status, 403);

  const my = await vera('GET', '/api/my/invitations');
  assert.equal(my.data.responded[0].response.status, 'pending');
});

test('блокировка скрывает приглашения, профиль и запрещает чат', async () => {
  // Вера снова откликается, Анна принимает
  const detail = await anna('GET', `/api/invitations/${invitationId}`);
  const veraResponse = detail.data.responses.find((r: { user: { id: number } }) => r.user.id === veraId);
  assert.equal((await anna('PATCH', `/api/responses/${veraResponse.id}`, { action: 'accept' })).status, 200);
  assert.equal((await vera('GET', `/api/invitations/${invitationId}/messages`)).status, 200);

  assert.equal((await vera('POST', `/api/users/${annaId}/block`)).status, 200);
  const feed = await vera('GET', '/api/invitations?radius=50');
  assert.ok(!feed.data.invitations.some((i: { author: { id: number } }) => i.author.id === annaId));
  assert.equal((await anna('GET', `/api/users/${veraId}`)).status, 404);
  assert.equal((await vera('GET', `/api/invitations/${invitationId}`)).status, 404);
  assert.equal((await vera('POST', `/api/invitations/${invitationId}/messages`, { text: 'hi' })).status, 403);
  assert.equal((await anna('GET', `/api/invitations/${invitationId}`)).data.invitation.status, 'open');

  assert.equal((await vera('DELETE', `/api/users/${annaId}/block`)).status, 200);
  assert.equal((await anna('GET', `/api/users/${veraId}`)).status, 200);
});

test('жалоба видна администратору, бан отключает вход', async () => {
  assert.equal((await boris('POST', `/api/users/${veraId}/report`, { reason: 'spam', comment: 'реклама' })).status, 201);
  assert.equal((await boris('POST', `/api/users/${veraId}/report`, { reason: 'spam' })).status, 409);
  assert.equal((await boris('POST', `/api/users/${veraId}/report`, { reason: 'unknown' })).status, 400);
  assert.equal((await boris('GET', '/api/admin/reports')).status, 403);

  run(db, `UPDATE users SET role = 'admin' WHERE id = ?`, annaId);
  const reports = await anna('GET', '/api/admin/reports');
  assert.equal(reports.status, 200);
  assert.equal(reports.data.reports[0].target.id, veraId);

  assert.equal((await anna('POST', `/api/admin/users/${veraId}/ban`, { banned: true })).status, 200);
  assert.equal((await vera('GET', '/api/me')).data.user, null);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'vera@x.de', password: 'secret-password' })).status, 403);

  const added = await anna('POST', '/api/admin/showtimes', { cinemaId: 2, movieTitle: 'Ручной сеанс', date: addDays(berlinToday(), 2), time: '21:00', language: 'OV' });
  assert.equal(added.status, 201);
});

test('удаление аккаунта', async () => {
  assert.equal((await boris('DELETE', '/api/me', { password: 'wrong' })).status, 401);
  assert.equal((await boris('DELETE', '/api/me', { password: 'secret-password' })).status, 200);
  assert.equal((await boris('GET', '/api/me')).data.user, null);
  assert.equal((await anna('GET', `/api/users/${borisId}`)).status, 404);
});

test('импорт сеансов парсером: добавление, обновление, отмена пропавших', () => {
  const t1 = new Date(Date.now() + 2 * 86400_000).toISOString();
  const t2 = new Date(Date.now() + 3 * 86400_000).toISOString();
  const r1 = importShowtimes(db, 1, 'scrape:test', [
    { movieTitle: 'Парсер-фильм', startsAt: t1 },
    { movieTitle: 'Парсер-фильм', startsAt: t2, language: 'OV' },
  ]);
  assert.deepEqual(r1, { added: 2, updated: 0, cancelled: 0 });
  const r2 = importShowtimes(db, 1, 'scrape:test', [{ movieTitle: 'Парсер-фильм', startsAt: t1 }]);
  assert.deepEqual(r2, { added: 0, updated: 1, cancelled: 1 });
  const r3 = importShowtimes(db, 1, 'scrape:test', []);
  assert.deepEqual(r3, { added: 0, updated: 0, cancelled: 0 }, 'пустой ответ не должен отменять сеансы');
});

test('импорт OSM: обновление совпавшего кинотеатра и добавление нового', () => {
  const r = importOsmElements(db, [
    { type: 'node', id: 1, lat: 48.7291, lon: 9.1081, tags: { name: 'Corso Kino', 'addr:street': 'Hauptstraße', 'addr:housenumber': '6' } },
    { type: 'way', id: 2, center: { lat: 48.8, lon: 9.2 }, tags: { name: 'Neues Kino' } },
    { type: 'node', id: 3, lat: 48.8, lon: 9.2, tags: {} },
  ]);
  assert.deepEqual(r, { added: 1, updated: 1 });
});

test('статика и SPA-фолбэк, заголовки безопасности', async () => {
  const res = await fetch(base + '/some/spa/route');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal((await fetch(base + '/missing.js')).status, 404);
  const trav = await fetch(base + '/..%2fpackage.json');
  assert.notEqual(await trav.text().then((t) => t.includes('"kinobuddy"')), true);
});
