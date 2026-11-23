import { api, qs, type Invitation } from '../api.js';
import { berlinToday, addDays, clear, field, h, plural } from '../dom.js';
import { loadMeta, state } from '../state.js';
import { districtSelect, emptyState, invitationCard, loading, radiusSlider } from './components.js';

/** Главная: лента приглашений рядом. */
export async function homeView(root: HTMLElement) {
  const meta = await loadMeta();
  const me = state.me;
  const filters = {
    radius: me?.profile.searchRadiusKm ?? 10,
    district: me ? '' : 'mitte',
    date: '',
    movie: '',
    format: '',
  };

  const list = h('div', { class: 'grid' });
  const summary = h('p', { class: 'muted' });

  async function load() {
    clear(list, loading());
    try {
      const r = await api.get<{ center: { label: string } | null; invitations: Invitation[] }>(
        '/api/invitations' + qs({ radius: filters.radius, district: filters.district, date: filters.date, movie: filters.movie, format: filters.format }),
      );
      summary.textContent = r.center
        ? `${r.invitations.length} ${plural(r.invitations.length, 'приглашение', 'приглашения', 'приглашений')} в радиусе ${filters.radius} км от района ${r.center.label}`
        : '';
      if (!r.invitations.length) {
        clear(list, emptyState('Пока никто не зовёт в кино рядом. Станьте первым!', h('a', { class: 'btn btn-primary', href: '#/afisha' }, 'Выбрать сеанс')));
      } else {
        clear(list, r.invitations.map(invitationCard));
      }
    } catch (e) {
      clear(list, emptyState((e as Error).message));
    }
  }

  const dateSelect = h(
    'select',
    { onChange: () => ((filters.date = dateSelect.value), load()) },
    h('option', { value: '' }, 'любая дата'),
    Array.from({ length: 14 }, (_, i) => {
      const d = addDays(berlinToday(), i);
      return h('option', { value: d }, i === 0 ? 'сегодня' : i === 1 ? 'завтра' : d.split('-').reverse().slice(0, 2).join('.'));
    }),
  );
  const formatSelect = h(
    'select',
    { onChange: () => ((filters.format = formatSelect.value), load()) },
    h('option', { value: '' }, 'любой формат'),
    h('option', { value: 'pair' }, 'вдвоём'),
    h('option', { value: 'group' }, 'компанией'),
  );
  let t: number | undefined;
  const movieInput = h('input', {
    type: 'search',
    placeholder: 'Фильм…',
    onInput: () => {
      clearTimeout(t);
      t = window.setTimeout(() => ((filters.movie = movieInput.value), load()), 300);
    },
  });
  const districtEl = me
    ? null
    : field('Ваш район', districtSelect(meta, 'mitte', { name: 'district' }));
  if (districtEl) districtEl.querySelector('select')!.addEventListener('change', (e) => ((filters.district = (e.target as HTMLSelectElement).value), load()));

  root.replaceChildren(
    h(
      'section',
      { class: 'hero' },
      h('h1', null, 'Найдите компанию, чтобы сходить в кино'),
      h('p', null, 'Выберите сеанс в афише и позовите кого-нибудь с собой — или откликнитесь на чужое приглашение.'),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/afisha' }, 'Найти сеанс'), !me ? h('a', { class: 'btn', href: '#/register' }, 'Регистрация') : null),
    ),
    h('h2', null, 'Приглашения рядом'),
    h(
      'div',
      { class: 'filters' },
      districtEl,
      field('Радиус', radiusSlider(filters.radius, (v) => ((filters.radius = v), load()))),
      field('Дата', dateSelect),
      field('Формат', formatSelect),
      field('Фильм', movieInput),
    ),
    summary,
    list,
  );
  await load();
}
