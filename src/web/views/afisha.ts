import { api, qs, type Cinema, type Invitation, type Showtime } from '../api.js';
import { addDays, berlinToday, clear, field, fmtDay, fmtTime, h, km } from '../dom.js';
import { loadMeta, state, LABELS } from '../state.js';
import { districtSelect, emptyState, invitationCard, loading, poster, radiusSlider } from './components.js';

/** Афиша: сеансы на выбранную дату, сгруппированные по фильмам. */
export async function afishaView(root: HTMLElement, _params: Record<string, string>, query: URLSearchParams) {
  const meta = await loadMeta();
  const me = state.me;
  const today = berlinToday();
  const f = {
    date: query.get('date') ?? today,
    radius: me?.profile.searchRadiusKm ?? 10,
    district: me?.profile.districtId ?? 'mitte',
    cinema: query.get('cinema') ?? '',
    movie: '',
    ov: false,
  };

  const list = h('div', { class: 'afisha' });
  const demoNote = h('div', { class: 'alert alert-info', hidden: true }, 'Демо-расписание: фильмы и сеансы вымышленные. Реальная афиша подключается через парсеры (см. README).');

  async function load() {
    clear(list, loading());
    let r: { showtimes: Showtime[] };
    try {
      r = await api.get('/api/showtimes' + qs({ date: f.date, radius: f.cinema ? 50 : f.radius, district: f.district, cinema: f.cinema, movie: f.movie, ov: f.ov }));
    } catch (e) {
      clear(list, emptyState((e as Error).message));
      return;
    }
    demoNote.hidden = !r.showtimes.some((s) => s.movie.isDemo);
    if (!r.showtimes.length) {
      clear(list, emptyState('На эту дату сеансов не найдено. Попробуйте другую дату или увеличьте радиус.'));
      return;
    }
    // Группировка: фильм → кинотеатр → сеансы
    const byMovie = new Map<number, { movie: Showtime['movie']; cinemas: Map<number, { cinema: Cinema; items: Showtime[] }> }>();
    for (const s of r.showtimes) {
      let m = byMovie.get(s.movie.id);
      if (!m) byMovie.set(s.movie.id, (m = { movie: s.movie, cinemas: new Map() }));
      let c = m.cinemas.get(s.cinema.id);
      if (!c) m.cinemas.set(s.cinema.id, (c = { cinema: s.cinema, items: [] }));
      c.items.push(s);
    }
    clear(
      list,
      [...byMovie.values()].map(({ movie, cinemas }) =>
        h(
          'article',
          { class: 'card movie-card' },
          poster(movie.posterUrl, movie.title),
          h(
            'div',
            { class: 'card-body' },
            h('h3', { class: 'card-title' }, movie.title),
            h('div', { class: 'muted' }, [movie.genres.join(', '), movie.runtimeMin ? `${movie.runtimeMin} мин` : '', movie.ageRating].filter(Boolean).join(' · ')),
            movie.overview ? h('p', { class: 'overview' }, movie.overview) : null,
            [...cinemas.values()]
              .sort((a, b) => (a.cinema.distanceKm ?? 0) - (b.cinema.distanceKm ?? 0))
              .map(({ cinema, items }) =>
                h(
                  'div',
                  { class: 'cinema-row' },
                  h('div', { class: 'cinema-row-name' }, h('strong', null, cinema.name), cinema.distanceKm !== null ? h('span', { class: 'muted' }, ` · ${km(cinema.distanceKm)}`) : null),
                  h(
                    'div',
                    { class: 'times' },
                    items.map((s) =>
                      h(
                        'div',
                        { class: 'time-slot' },
                        h(
                          'a',
                          { class: 'time', href: `#/invite/new?showtime=${s.id}`, title: `${LABELS.language[s.language] ?? s.language} — позвать с собой` },
                          fmtTime(s.startsAt),
                          s.language !== 'DE' ? h('span', { class: 'lang' }, s.language) : null,
                        ),
                        s.openInvitations > 0
                          ? h('a', { class: 'who', href: `#/showtime/${s.id}` }, `ищут компанию: ${s.openInvitations}`)
                          : null,
                        s.ticketUrl ? h('a', { class: 'ticket', href: s.ticketUrl, target: '_blank', rel: 'noopener noreferrer' }, 'билеты') : null,
                      ),
                    ),
                  ),
                ),
              ),
          ),
        ),
      ),
    );
  }

  const dateTabs = h(
    'div',
    { class: 'date-tabs', role: 'tablist' },
    Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i);
      const label = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : fmtDay(d + 'T12:00:00Z');
      const b = h(
        'button',
        {
          type: 'button',
          class: 'tab' + (d === f.date ? ' active' : ''),
          role: 'tab',
          onClick: () => {
            f.date = d;
            dateTabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            load();
          },
        },
        label,
      );
      return b;
    }),
  );

  const cinemas = await api.get<{ cinemas: Cinema[] }>('/api/cinemas?radius=all');
  const cinemaSelect = h(
    'select',
    { onChange: () => ((f.cinema = cinemaSelect.value), load()) },
    h('option', { value: '' }, 'все в радиусе'),
    cinemas.cinemas.map((c) => h('option', { value: c.id, selected: String(c.id) === f.cinema }, c.name)),
  );
  let t: number | undefined;
  const movie = h('input', {
    type: 'search',
    placeholder: 'Название фильма',
    onInput: () => {
      clearTimeout(t);
      t = window.setTimeout(() => ((f.movie = movie.value), load()), 300);
    },
  });
  const ov = h('input', { type: 'checkbox', onChange: () => ((f.ov = ov.checked), load()) });
  const district = districtSelect(meta, f.district, { name: 'district' });
  district.addEventListener('change', () => ((f.district = district.value), load()));

  root.replaceChildren(
    h('h1', null, 'Афиша'),
    h('p', { class: 'muted' }, 'Нажмите на время сеанса, чтобы позвать кого-нибудь с собой.'),
    dateTabs,
    h(
      'div',
      { class: 'filters' },
      field('От района', district),
      field('Радиус', radiusSlider(f.radius, (v) => ((f.radius = v), load()))),
      field('Кинотеатр', cinemaSelect),
      field('Фильм', movie),
      h('label', { class: 'check' }, ov, ' только в оригинале (OV/OmU)'),
    ),
    demoNote,
    list,
  );
  await load();
}

/** Приглашения на конкретный сеанс. */
export async function showtimeInvitationsView(root: HTMLElement, params: Record<string, string>) {
  root.replaceChildren(loading());
  const r = await api.get<{ invitations: Invitation[] }>(`/api/invitations?showtime=${encodeURIComponent(params.id!)}&radius=50`);
  root.replaceChildren(
    h('h1', null, 'Кто ищет компанию на этот сеанс'),
    h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: `#/invite/new?showtime=${params.id}` }, 'Создать своё приглашение')),
    r.invitations.length ? h('div', { class: 'grid' }, r.invitations.map(invitationCard)) : emptyState('Открытых приглашений нет.'),
  );
}
