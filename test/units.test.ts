import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, nearestDistrict } from '../src/server/geo.js';
import { ageFromBirthDate, berlinDayRange, berlinLocalToUtc } from '../src/server/time.js';
import { cleanTitle, parseScreeningEvents } from '../src/server/scrapers/jsonld.js';
import { isAllowedByRobots } from '../src/server/scrapers/robots.js';

test('гаверсинус: Штутгарт → Мюнхен ≈ 190 км', () => {
  const d = haversineKm(48.7758, 9.1829, 48.1374, 11.5755);
  assert.ok(d > 185 && d < 195, String(d));
  assert.equal(haversineKm(48.7, 9.1, 48.7, 9.1), 0);
});

test('ближайший район', () => {
  assert.equal(nearestDistrict('stuttgart', 48.729, 9.108)?.id, 'vaihingen');
});

test('местное время Штутгарта → UTC с учётом летнего времени', () => {
  assert.equal(berlinLocalToUtc('2026-01-15', '20:00').toISOString(), '2026-01-15T19:00:00.000Z');
  assert.equal(berlinLocalToUtc('2026-07-15', '20:00').toISOString(), '2026-07-15T18:00:00.000Z');
  const [from, to] = berlinDayRange('2026-03-29'); // день перехода на летнее время — 23 часа
  assert.equal(from, '2026-03-28T23:00:00.000Z');
  assert.equal(to, '2026-03-29T22:00:00.000Z');
});

test('возраст', () => {
  const today = new Date('2026-11-23T12:00:00Z');
  assert.equal(ageFromBirthDate('2008-11-23', today), 18);
  assert.equal(ageFromBirthDate('2008-11-24', today), 17);
});

test('JSON-LD: разбор ScreeningEvent', () => {
  const html = `<html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"ScreeningEvent","@id":"ev-1","name":"Dune (OV)","startDate":"2026-12-01T20:15",
     "workPresented":{"@type":"Movie","name":"Dune (OV)"},"inLanguage":"en",
     "offers":{"@type":"Offer","url":"/tickets/1"}},
    {"@type":"ScreeningEvent","startDate":"2026-12-01T18:00:00+01:00","workPresented":{"name":"Das Lehrerzimmer"}},
    {"@type":"Movie","name":"Не сеанс"}
  ]}
  </script>
  <script type="application/ld+json">{ битый json </script>
  </head></html>`;
  const items = parseScreeningEvents(html, 'https://kino.example/programm');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    movieTitle: 'Dune',
    startsAt: '2026-12-01T19:15:00.000Z',
    language: 'OV',
    ticketUrl: 'https://kino.example/tickets/1',
    externalId: 'ev-1',
  });
  assert.equal(items[1]!.movieTitle, 'Das Lehrerzimmer');
  assert.equal(items[1]!.startsAt, '2026-12-01T17:00:00.000Z');
  assert.equal(items[1]!.language, 'DE');
});

test('очистка названий', () => {
  assert.equal(cleanTitle('Oppenheimer - OmU'), 'Oppenheimer');
  assert.equal(cleanTitle('Wicked [3D]'), 'Wicked');
  assert.equal(cleanTitle('Anora'), 'Anora');
});

test('robots.txt', () => {
  const robots = `User-agent: *\nDisallow: /admin\nDisallow: /programm/print\nAllow: /programm/print/ok\n\nUser-agent: BadBot\nDisallow: /`;
  assert.equal(isAllowedByRobots(robots, 'KinoBuddyBot', '/programm'), true);
  assert.equal(isAllowedByRobots(robots, 'KinoBuddyBot', '/admin/x'), false);
  assert.equal(isAllowedByRobots(robots, 'KinoBuddyBot', '/programm/print/1'), false);
  assert.equal(isAllowedByRobots(robots, 'KinoBuddyBot', '/programm/print/ok'), true);
  assert.equal(isAllowedByRobots(robots, 'BadBot', '/programm'), false);
  assert.equal(isAllowedByRobots('', 'KinoBuddyBot', '/'), true);
});
