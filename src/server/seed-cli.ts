import { openDb } from './db.js';
import { config } from './config.js';
import { seedCinemas, seedDemoCatalog, seedDemoUsers, DEMO_PASSWORD } from './seed.js';

// npm run seed:demo — добавить демо-афишу и демо-пользователей
const db = openDb(config.dbPath);
seedCinemas(db);
seedDemoCatalog(db);
await seedDemoUsers(db);
console.log(`Готово. Демо-пользователи: anna@demo.kinobuddy, max@demo.kinobuddy, lena@demo.kinobuddy, oleg@demo.kinobuddy — пароль ${DEMO_PASSWORD}`);
db.close();
