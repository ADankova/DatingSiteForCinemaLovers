import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
import { seedCinemas, seedDemoCatalog, seedDemoUsers } from './seed.js';
import { runAllScrapers } from './scrapers/run.js';

const db = openDb(config.dbPath);
const added = seedCinemas(db);
if (added) console.log(`[seed] добавлено кинотеатров: ${added}`);
if (config.seedDemo) {
  seedDemoCatalog(db);
  await seedDemoUsers(db);
}
purgeExpiredSessions(db);

const server = createApp(db, { publicDir: 'public' });
server.listen(config.port, () => {
  console.log(`KinoBuddy запущен: http://localhost:${config.port}`);
});

const timers: NodeJS.Timeout[] = [];
timers.push(setInterval(() => purgeExpiredSessions(db), 6 * 3600_000));
if (config.seedDemo) timers.push(setInterval(() => seedDemoCatalog(db), 12 * 3600_000));

if (config.scrapeEnabled) {
  const tick = () => runAllScrapers(db).catch((e) => console.error('[scrape]', e));
  void tick();
  timers.push(setInterval(tick, config.scrapeIntervalHours * 3600_000));
}

function shutdown() {
  timers.forEach(clearInterval);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
