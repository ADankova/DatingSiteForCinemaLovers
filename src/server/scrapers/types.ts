/** Один сеанс, найденный парсером. Только факты: фильм, время, язык, ссылка. */
export interface ScrapedShowtime {
  movieTitle: string;
  /** ISO 8601; без смещения считается местным временем Штутгарта */
  startsAt: string;
  language?: 'DE' | 'OV' | 'OmU';
  ticketUrl?: string;
  externalId?: string;
}

/** Настройка источника в config/scrapers.json */
export interface ScraperSource {
  /** slug кинотеатра из таблицы cinemas */
  cinemaSlug: string;
  /** имя адаптера из реестра (см. registry.ts) */
  adapter: string;
  /** страница с расписанием на сайте кинотеатра */
  url: string;
  enabled: boolean;
  note?: string;
}

export interface FetchContext {
  /** Загрузить страницу (с проверкой robots.txt и своим User-Agent) */
  fetchText(url: string): Promise<string>;
}

export type ScraperAdapter = (source: ScraperSource, ctx: FetchContext) => Promise<ScrapedShowtime[]>;
