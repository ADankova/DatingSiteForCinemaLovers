/** Все даты в БД хранятся в UTC (ISO 8601), показываются в Europe/Berlin. */
export const TZ = 'Europe/Berlin';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function zoneParts(date: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Смещение Europe/Berlin относительно UTC в минутах для данного момента. */
export function berlinOffsetMinutes(date: Date): number {
  const p = zoneParts(date);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Местное время Штутгарта → момент в UTC. */
export function berlinLocalToUtc(dateStr: string, timeStr = '00:00'): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dm || !tm) throw new Error('Неверный формат даты или времени');
  const guess = Date.UTC(+dm[1]!, +dm[2]! - 1, +dm[3]!, +tm[1]!, +tm[2]!);
  const off1 = berlinOffsetMinutes(new Date(guess));
  let utc = guess - off1 * 60000;
  const off2 = berlinOffsetMinutes(new Date(utc));
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** Сегодняшняя дата в Штутгарте, YYYY-MM-DD. */
export function berlinToday(now = new Date()): string {
  const p = zoneParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Границы суток (местных) в UTC: [начало, конец). */
export function berlinDayRange(dateStr: string): [string, string] {
  const start = berlinLocalToUtc(dateStr, '00:00');
  const next = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10) + 1));
  const nextStr = next.toISOString().slice(0, 10);
  const end = berlinLocalToUtc(nextStr, '00:00');
  return [start.toISOString(), end.toISOString()];
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}
