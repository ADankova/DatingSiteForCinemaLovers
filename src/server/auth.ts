import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.js';
import { get, run } from './db.js';
import { config } from './config.js';
import type { SessionUser } from './http.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const SESSION_COOKIE = 'kb_sid';

export function createSession(db: Db, userId: number): { token: string; cookie: string } {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires.toISOString());
  return { token, cookie: sessionCookie(token, config.sessionDays * 86400) };
}

export function sessionCookie(value: string, maxAgeSec: number): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.production) parts.push('Secure');
  return parts.join('; ');
}

export function userFromToken(db: Db, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = get<{ id: number; role: 'user' | 'admin'; status: string; expires_at: string }>(
    db,
    `SELECT u.id, u.role, u.status, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (row.status !== 'active' || row.expires_at < new Date().toISOString()) {
    run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return null;
  }
  return { id: row.id, role: row.role };
}

export function destroySession(db: Db, token: string | undefined): void {
  if (token) run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function destroyAllSessions(db: Db, userId: number): void {
  run(db, 'DELETE FROM sessions WHERE user_id = ?', userId);
}

export function purgeExpiredSessions(db: Db): void {
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
}
