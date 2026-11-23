import { api, qs, type Cinema } from '../api.js';
import { clear, field, h, km, plural } from '../dom.js';
import { loadMeta, state } from '../state.js';
import { districtSelect, emptyState, loading, radiusSlider } from './components.js';

/** Кинотеатры: поиск по названию и по радиусу от района из анкеты. */
export async function cinemasView(root: HTMLElement) {
  const meta = await loadMeta();
  const me = state.me;
  const f = { q: '', radius: me?.profile.searchRadiusKm ?? 10, district: me?.profile.districtId ?? 'mitte', all: false };

  const list = h('div', { class: 'list' });
  const summary = h('p', { class: 'muted' });

  async function load() {
    clear(list, loading());
    const r = await api.get<{ center: { label: string } | null; cinemas: Cinema[] }>(
      '/api/cinemas' + qs({ q: f.q, district: f.district, radius: f.all ? 'all' : f.radius }),
    );
    summary.textContent = `${r.cinemas.length} ${plural(r.cinemas.length, 'кинотеатр', 'кинотеатра', 'кинотеатров')}` +
      (f.all ? '' : ` в радиусе ${f.radius} км`) + (r.center ? ` от района ${r.center.label}` : '');
    if (!r.cinemas.length) {
      clear(list, emptyState('В этом радиусе кинотеатров нет. Увеличьте радиус.'));
      return;
    }
    clear(
      list,
      r.cinemas.map((c) =>
        h(
          'div',
          { class: 'card cinema-card' },
          h(
            'div',
            { class: 'card-body' },
            h('div', { class: 'card-title' }, c.name),
            h('div', { class: 'muted' }, c.address),
            h('div', { class: 'tags' }, c.district ? h('span', { class: 'tag' }, c.district) : null, c.hasOv ? h('span', { class: 'tag tag-accent' }, 'OV') : null),
          ),
          h(
            'div',
            { class: 'cinema-side' },
            c.distanceKm !== null ? h('div', { class: 'distance', title: c.approxCoords ? 'Координаты примерные' : '' }, (c.approxCoords ? '≈ ' : '') + km(c.distanceKm)) : null,
            h('a', { class: 'btn btn-small', href: `#/afisha?cinema=${c.id}` }, 'Сеансы'),
            c.website ? h('a', { class: 'btn btn-small btn-ghost', href: c.website, target: '_blank', rel: 'noopener noreferrer' }, 'Сайт') : null,
          ),
        ),
      ),
    );
  }

  let t: number | undefined;
  const q = h('input', {
    type: 'search',
    placeholder: 'Название или адрес',
    onInput: () => {
      clearTimeout(t);
      t = window.setTimeout(() => ((f.q = q.value), load()), 250);
    },
  });
  const district = districtSelect(meta, f.district, { name: 'district' });
  district.addEventListener('change', () => ((f.district = district.value), load()));
  const allBox = h('input', { type: 'checkbox', onChange: () => ((f.all = allBox.checked), load()) });

  root.replaceChildren(
    h('h1', null, 'Кинотеатры'),
    h(
      'div',
      { class: 'filters' },
      field('Поиск', q),
      field('От района', district, me ? 'По умолчанию — район из анкеты' : undefined),
      field('Радиус', radiusSlider(f.radius, (v) => ((f.radius = v), (f.all = false), (allBox.checked = false), load()))),
      h('label', { class: 'check' }, allBox, ' весь город'),
    ),
    summary,
    list,
    h('p', { class: 'muted small' }, 'Расстояние по прямой от центра района. Данные о кинотеатрах: © участники OpenStreetMap.'),
  );
  await load();
}
