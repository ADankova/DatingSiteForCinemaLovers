import { berlinLocalToUtc } from '../time.js';
import type { ScrapedShowtime, ScraperAdapter } from './types.js';

/**
 * Универсальный парсер разметки schema.org ScreeningEvent (JSON-LD).
 * Многие сайты кинотеатров встраивают её для поисковиков:
 * <script type="application/ld+json">{"@type":"ScreeningEvent", "startDate": ..., "workPresented": {"name": ...}}</script>
 */
export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1]!.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* битый блок — пропускаем */
    }
  }
  return out;
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const x of node) yield* walk(x);
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    yield obj;
    for (const v of Object.values(obj)) if (v && typeof v === 'object') yield* walk(v);
  }
}

function text(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).name === 'string')
    return ((v as Record<string, unknown>).name as string).trim();
  return '';
}

/** Дата без смещения часового пояса трактуется как местное время Штутгарта. */
export function normalizeStart(s: string): string | null {
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s.trim());
  if (local) return berlinLocalToUtc(local[1]!, local[2]!).toISOString();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function detectLanguage(ev: Record<string, unknown>, title: string): 'DE' | 'OV' | 'OmU' {
  const subtitle = text(ev.subtitleLanguage);
  const lang = text(ev.inLanguage).toLowerCase();
  const hay = `${title} ${text(ev.name)} ${text(ev.videoFormat)}`;
  if (/\bOmU\b|\bOmdU\b/i.test(hay) || (subtitle && lang && !lang.startsWith('de'))) return 'OmU';
  if (/\bOV\b|\bOmeU\b|original/i.test(hay) || (lang && !lang.startsWith('de'))) return 'OV';
  return 'DE';
}

/** Убрать из названия пометки вроде "(OV)", "- OmU", "3D" */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–(\[]\s*(OV|OmU|OmdU|OmeU|3D|2D|Original(?:fassung)?)\s*[)\]]?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseScreeningEvents(html: string, baseUrl?: string): ScrapedShowtime[] {
  const out: ScrapedShowtime[] = [];
  const seen = new Set<string>();
  for (const block of extractJsonLdBlocks(html)) {
    for (const node of walk(block)) {
      if (!hasType(node, 'ScreeningEvent') && !(hasType(node, 'Event') && node.workPresented)) continue;
      const rawTitle = text(node.workPresented) || text(node.name);
      const startRaw = typeof node.startDate === 'string' ? node.startDate : '';
      if (!rawTitle || !startRaw) continue;
      const startsAt = normalizeStart(startRaw);
      if (!startsAt) continue;

      const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      let ticketUrl =
        (offers && typeof offers === 'object' && typeof (offers as Record<string, unknown>).url === 'string'
          ? ((offers as Record<string, unknown>).url as string)
          : '') || (typeof node.url === 'string' ? node.url : '');
      if (ticketUrl && baseUrl) {
        try {
          ticketUrl = new URL(ticketUrl, baseUrl).toString();
        } catch {
          ticketUrl = '';
        }
      }

      const item: ScrapedShowtime = {
        movieTitle: cleanTitle(rawTitle),
        startsAt,
        language: detectLanguage(node, rawTitle),
        ...(ticketUrl ? { ticketUrl } : {}),
        ...(typeof node['@id'] === 'string' ? { externalId: node['@id'] } : {}),
      };
      const key = `${item.movieTitle}|${item.startsAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export const jsonLdAdapter: ScraperAdapter = async (source, ctx) => {
  const html = await ctx.fetchText(source.url);
  return parseScreeningEvents(html, source.url);
};
