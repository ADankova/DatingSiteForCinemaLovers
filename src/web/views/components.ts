import type { Invitation, Meta, OwnProfile } from '../api.js';
import { h, field, fmtDateTime, km } from '../dom.js';
import { LABELS, state } from '../state.js';

export function districtSelect(meta: Meta, selected: string | undefined, opts: { name?: string; allowEmpty?: string } = {}): HTMLSelectElement {
  const city = meta.cities[0]!;
  return h(
    'select',
    { name: opts.name ?? 'districtId' },
    opts.allowEmpty !== undefined ? h('option', { value: '' }, opts.allowEmpty) : null,
    city.districts.map((d) => h('option', { value: d.id, selected: d.id === selected }, d.name)),
  );
}

/** Ползунок радиуса с подписью «N км». */
export function radiusSlider(value: number, onChange: (v: number) => void): HTMLElement {
  const out = h('output', null, `${value} км`);
  const input = h('input', {
    type: 'range',
    min: 1,
    max: 50,
    step: 1,
    value,
    'aria-label': 'Радиус поиска, км',
    onInput: () => (out.textContent = `${input.value} км`),
    onChange: () => onChange(Number(input.value)),
  });
  return h('div', { class: 'radius' }, input, out);
}

export function poster(url: string, title: string): HTMLElement {
  if (url) return h('img', { class: 'poster', src: url, alt: `Постер: ${title}`, loading: 'lazy' });
  return h('div', { class: 'poster poster-empty', 'aria-hidden': 'true' }, title.slice(0, 1).toUpperCase());
}

export function invitationCard(inv: Invitation): HTMLElement {
  const free = inv.seats - inv.acceptedCount;
  return h(
    'a',
    { class: 'card inv-card', href: `#/invitations/${inv.id}` },
    poster(inv.posterUrl, inv.movieTitle),
    h(
      'div',
      { class: 'card-body' },
      h('div', { class: 'card-title' }, inv.movieTitle),
      h('div', { class: 'muted' }, `${fmtDateTime(inv.startsAt)} · ${inv.cinema.name}`, inv.cinema.distanceKm !== null ? ` · ${km(inv.cinema.distanceKm)}` : ''),
      h(
        'div',
        { class: 'inv-author' },
        h('strong', null, inv.author.displayName),
        `, ${inv.author.age} · ${inv.author.district}`,
      ),
      inv.message ? h('p', { class: 'inv-message' }, `«${inv.message}»`) : null,
      h(
        'div',
        { class: 'tags' },
        h('span', { class: 'tag' }, LABELS.invFormat[inv.format]),
        inv.format === 'group' ? h('span', { class: 'tag' }, `свободно мест: ${Math.max(0, free)}`) : null,
        inv.language && inv.language !== 'DE' ? h('span', { class: 'tag tag-accent' }, inv.language) : null,
        inv.status !== 'open' ? h('span', { class: 'tag tag-muted' }, LABELS.invStatus[inv.status]) : null,
      ),
    ),
  );
}

export function emptyState(text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty' }, h('p', null, text), action ?? null);
}

export function loading(): HTMLElement {
  return h('p', { class: 'muted loading' }, 'Загрузка…');
}

/** Поля анкеты: общие для регистрации и редактирования. */
export function profileFormFields(meta: Meta, p?: OwnProfile) {
  const displayName = h('input', { name: 'displayName', required: true, minlength: 2, maxlength: 40, value: p?.displayName ?? '', autocomplete: 'nickname' });
  const gender = h(
    'select',
    { name: 'gender' },
    Object.entries(LABELS.gender).map(([v, l]) => h('option', { value: v, selected: (p?.gender ?? 'unspecified') === v }, l)),
  );
  const district = districtSelect(meta, p?.districtId ?? 'mitte');
  const about = h('textarea', { name: 'about', maxlength: 500, rows: 3 }, p?.about ?? '');
  const genreBoxes = meta.genres.map((g) =>
    h('label', { class: 'chip' }, h('input', { type: 'checkbox', value: g, checked: p?.genres.includes(g) }), h('span', null, g)),
  );
  const favoriteFilms = h('input', { name: 'favoriteFilms', maxlength: 300, value: p?.favoriteFilms ?? '' });
  const languagePref = h(
    'select',
    { name: 'languagePref' },
    Object.entries(LABELS.languagePref).map(([v, l]) => h('option', { value: v, selected: (p?.languagePref ?? 'any') === v }, l)),
  );
  const meetFormat = h(
    'select',
    { name: 'meetFormat' },
    Object.entries(LABELS.meetFormat).map(([v, l]) => h('option', { value: v, selected: (p?.meetFormat ?? 'any') === v }, l)),
  );
  const radius = h('input', { type: 'number', name: 'searchRadiusKm', min: 1, max: 50, value: p?.searchRadiusKm ?? 10 });
  const visible = h('input', { type: 'checkbox', name: 'visible', checked: p ? p.visible : true });

  const el = h(
    'div',
    { class: 'form-grid' },
    field('Имя для показа', displayName),
    field('Пол', gender),
    field('Город', h('select', { disabled: true }, h('option', null, meta.cities[0]!.name)), 'Пока работаем только в Штутгарте'),
    field('Район', district, 'По району считается расстояние до кинотеатров. Точный адрес не нужен.'),
    field('Радиус поиска, км', radius),
    field('Язык показа', languagePref),
    field('Формат встречи', meetFormat),
    h('div', { class: 'field field-wide' }, h('span', { class: 'field-label' }, 'Любимые жанры'), h('div', { class: 'chips' }, genreBoxes)),
    h('div', { class: 'field-wide' }, field('Любимые фильмы', favoriteFilms)),
    h('div', { class: 'field-wide' }, field('О себе', about)),
    h('label', { class: 'check field-wide' }, visible, ' Показывать мой профиль другим пользователям'),
  );

  const read = () => ({
    displayName: displayName.value,
    gender: gender.value,
    cityId: meta.cities[0]!.id,
    districtId: district.value,
    about: about.value,
    genres: genreBoxes.map((l) => l.querySelector('input')!).filter((i) => i.checked).map((i) => i.value),
    favoriteFilms: favoriteFilms.value,
    languagePref: languagePref.value,
    meetFormat: meetFormat.value,
    searchRadiusKm: Number(radius.value),
    visible: visible.checked,
  });
  return { el, read };
}

export function requireLoginNotice(): HTMLElement {
  return emptyState(
    'Чтобы продолжить, войдите или зарегистрируйтесь.',
    h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/login' }, 'Войти'), h('a', { class: 'btn btn-primary', href: '#/register' }, 'Регистрация')),
  );
}

export function isLoggedIn(): boolean {
  return state.me !== null;
}
