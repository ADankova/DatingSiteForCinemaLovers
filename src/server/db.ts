import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name     TEXT NOT NULL,
  birth_date       TEXT NOT NULL,
  gender           TEXT NOT NULL DEFAULT 'unspecified',
  city             TEXT NOT NULL DEFAULT 'stuttgart',
  district         TEXT NOT NULL DEFAULT 'mitte',
  lat              REAL NOT NULL,
  lng              REAL NOT NULL,
  about            TEXT NOT NULL DEFAULT '',
  genres           TEXT NOT NULL DEFAULT '[]',
  favorite_films   TEXT NOT NULL DEFAULT '',
  language_pref    TEXT NOT NULL DEFAULT 'any',
  meet_format      TEXT NOT NULL DEFAULT 'any',
  search_radius_km INTEGER NOT NULL DEFAULT 10,
  visible          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cinemas (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT 'stuttgart',
  district      TEXT NOT NULL DEFAULT '',
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  website       TEXT NOT NULL DEFAULT '',
  has_ov        INTEGER NOT NULL DEFAULT 0,
  approx_coords INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'seed',
  osm_id        TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS movies (
  id             INTEGER PRIMARY KEY,
  title          TEXT NOT NULL,
  original_title TEXT NOT NULL DEFAULT '',
  overview       TEXT NOT NULL DEFAULT '',
  poster_url     TEXT NOT NULL DEFAULT '',
  genres         TEXT NOT NULL DEFAULT '[]',
  runtime_min    INTEGER,
  age_rating     TEXT NOT NULL DEFAULT '',
  tmdb_id        INTEGER UNIQUE,
  is_demo        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS movies_title ON movies(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS showtimes (
  id          INTEGER PRIMARY KEY,
  movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  cinema_id   INTEGER NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
  starts_at   TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'DE',
  ticket_url  TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  UNIQUE (cinema_id, movie_id, starts_at)
);
CREATE INDEX IF NOT EXISTS showtimes_start ON showtimes(starts_at);

CREATE TABLE IF NOT EXISTS invitations (
  id          INTEGER PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  showtime_id INTEGER REFERENCES showtimes(id) ON DELETE SET NULL,
  cinema_id   INTEGER NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
  movie_id    INTEGER REFERENCES movies(id) ON DELETE SET NULL,
  movie_title TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  format      TEXT NOT NULL CHECK (format IN ('pair','group')),
  seats       INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 5),
  message     TEXT NOT NULL DEFAULT '',
  tickets     TEXT NOT NULL DEFAULT 'self',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','cancelled')),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invitations_start ON invitations(starts_at);
CREATE INDEX IF NOT EXISTS invitations_author ON invitations(author_id);

CREATE TABLE IF NOT EXISTS responses (
  id            INTEGER PRIMARY KEY,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_at    TEXT NOT NULL,
  UNIQUE (invitation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_inv ON messages(invitation_id, id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  comment     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  created_at  TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Небольшие типизированные обёртки над node:sqlite
export function all<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]): { changes: number; lastId: number } {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
