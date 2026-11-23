import { fileURLToPath } from 'node:url';
import type { Db } from '../db.js';
import { all, get, openDb, run } from '../db.js';
import { config } from '../config.js';
import { haversineKm, nearestDistrict } from '../geo.js';

/**
 * Импорт кинотеатров Штутгарта из OpenStreetMap (amenity=cinema) через Overpass API.
 * Данные © участники OpenStreetMap, лицензия ODbL — на сайте нужна подпись об источнике.
 * Запуск: npm run import:osm
 */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// Прямоугольник вокруг Штутгарта: юг, запад, север, восток
const BBOX = '48.69,9.03,48.87,9.32';

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const norm = (s: string) => slugify(s).replace(/-?(kino|filmtheater|stuttgart)-?/g, '');

export function importOsmElements(db: Db, elements: OsmElement[]): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  const existing = all<{ id: number; name: string; lat: number; lng: number; osm_id: string | null }>(
    db,
    'SELECT id, name, lat, lng, osm_id FROM cinemas',
  );
  for (const el of elements) {
    const name = el.tags?.name;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || lat === undefined || lng === undefined) continue;
    const osmId = `${el.type}/${el.id}`;
    const t = el.tags ?? {};
    const address = [t['addr:street'] && `${t['addr:street']} ${t['addr:housenumber'] ?? ''}`.trim(), t['addr:postcode'], t['addr:city']]
      .filter(Boolean)
      .join(', ');
    const website = t.website ?? t['contact:website'] ?? '';
    const district = nearestDistrict('stuttgart', lat, lng)?.id ?? '';

    // Совпадение: тот же osm_id или похожее название в пределах 400 м
    const match =
      existing.find((c) => c.osm_id === osmId) ??
      existing.find((c) => norm(c.name) === norm(name) && haversineKm(c.lat, c.lng, lat, lng) < 0.4) ??
      existing.find((c) => !c.osm_id && (norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name))) && haversineKm(c.lat, c.lng, lat, lng) < 0.6);

    if (match) {
      run(
        db,
        `UPDATE cinemas SET lat = ?, lng = ?, osm_id = ?, approx_coords = 0, district = ?,
           address = CASE WHEN ? != '' THEN ? ELSE address END,
           website = CASE WHEN website = '' THEN ? ELSE website END WHERE id = ?`,
        lat,
        lng,
        osmId,
        district,
        address,
        address,
        website,
        match.id,
      );
      updated++;
    } else {
      let slug = slugify(name) || `cinema-${el.id}`;
      if (get(db, 'SELECT 1 FROM cinemas WHERE slug = ?', slug)) slug = `${slug}-${el.id}`;
      run(
        db,
        `INSERT INTO cinemas (slug, name, address, district, lat, lng, website, source, osm_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'osm', ?)`,
        slug,
        name,
        address,
        district,
        lat,
        lng,
        website,
        osmId,
      );
      added++;
    }
  }
  return { added, updated };
}

export async function fetchOsmCinemas(): Promise<OsmElement[]> {
  const query = `[out:json][timeout:60];nwr["amenity"="cinema"](${BBOX});out center tags;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': `KinoBuddy/0.1 (${config.scraperContact})` },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass API: HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: OsmElement[] };
  return json.elements ?? [];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(config.dbPath);
  const elements = await fetchOsmCinemas();
  const r = importOsmElements(db, elements);
  console.log(`[osm] найдено ${elements.length}, добавлено ${r.added}, обновлено ${r.updated}`);
  db.close();
}
