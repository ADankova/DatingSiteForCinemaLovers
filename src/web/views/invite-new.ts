import { api, type Cinema, type Invitation, type Showtime } from '../api.js';
import { berlinToday, errorBox, field, fmtDateTime, h } from '../dom.js';
import { state, LABELS } from '../state.js';
import { navigate } from '../router.js';
import { requireLoginNotice } from './components.js';

/** Создание приглашения: из афиши (?showtime=ID) или вручную. */
export async function inviteNewView(root: HTMLElement, _p: Record<string, string>, query: URLSearchParams) {
  if (!state.me) {
    root.replaceChildren(requireLoginNotice());
    return;
  }
  const showtimeId = query.get('showtime');
  let showtime: Showtime | undefined;
  if (showtimeId) {
    try {
      showtime = (await api.get<{ showtime: Showtime }>(`/api/showtimes/${encodeURIComponent(showtimeId)}`)).showtime;
    } catch {
      showtime = undefined; // перейдём в ручной режим
    }
  }

  const err = errorBox();
  const format = h('select', null, h('option', { value: 'pair' }, 'вдвоём'), h('option', { value: 'group' }, 'компанией'));
  const seats = h('input', { type: 'number', min: 1, max: 5, value: 2 });
  const seatsField = field('Сколько человек позвать', seats);
  seatsField.hidden = true;
  format.addEventListener('change', () => (seatsField.hidden = format.value !== 'group'));
  const tickets = h('select', null, Object.entries(LABELS.tickets).map(([v, l]) => h('option', { value: v }, l)));
  const message = h('textarea', { maxlength: 300, rows: 3, placeholder: 'Например: «Иду после работы, потом можно на чай»' });

  // Ручной режим
  const manual = !showtime;
  let cinemaSel: HTMLSelectElement | null = null;
  let movieTitle: HTMLInputElement | null = null;
  let date: HTMLInputElement | null = null;
  let time: HTMLInputElement | null = null;
  let target: HTMLElement;
  if (showtime) {
    target = h(
      'div',
      { class: 'panel-inset' },
      h('div', { class: 'card-title' }, showtime.movie.title),
      h('div', null, `${fmtDateTime(showtime.startsAt)} · ${showtime.cinema.name}`),
      h('div', { class: 'muted' }, LABELS.language[showtime.language] ?? showtime.language),
    );
  } else {
    const cinemas = await api.get<{ cinemas: Cinema[] }>('/api/cinemas?radius=all');
    cinemaSel = h('select', { required: true }, cinemas.cinemas.map((c) => h('option', { value: c.id }, c.name)));
    movieTitle = h('input', { required: true, maxlength: 150 });
    date = h('input', { type: 'date', required: true, min: berlinToday(), value: berlinToday() });
    time = h('input', { type: 'time', required: true, value: '20:00' });
    target = h(
      'div',
      null,
      showtimeId ? h('div', { class: 'alert alert-info' }, 'Сеанс не найден в афише — укажите его вручную.') : null,
      h('p', { class: 'muted' }, 'Сеанса нет в афише? Укажите его вручную.'),
      h('div', { class: 'form-grid' }, field('Кинотеатр', cinemaSel), field('Фильм', movieTitle), field('Дата', date), field('Начало', time)),
    );
  }

  const form = h(
    'form',
    {
      class: 'panel',
      onSubmit: async (e: Event) => {
        e.preventDefault();
        err.hide();
        const body: Record<string, unknown> = {
          format: format.value,
          seats: Number(seats.value),
          tickets: tickets.value,
          message: message.value,
        };
        if (manual) Object.assign(body, { cinemaId: Number(cinemaSel!.value), movieTitle: movieTitle!.value, date: date!.value, time: time!.value });
        else body.showtimeId = showtime!.id;
        try {
          const r = await api.post<{ invitation: Invitation }>('/api/invitations', body);
          navigate(`#/invitations/${r.invitation.id}`);
        } catch (e) {
          err.show((e as Error).message);
        }
      },
    },
    h('h1', null, 'Позвать в кино'),
    err.el,
    target,
    h('div', { class: 'form-grid' }, field('Формат', format), seatsField, field('Билеты', tickets)),
    field('Сообщение', message),
    h('p', { class: 'muted small' }, 'Совет: встречайтесь у входа в кинотеатр и добирайтесь самостоятельно. ', h('a', { href: '#/safety' }, 'Правила безопасности')),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Опубликовать приглашение'),
  );
  root.replaceChildren(form);
}
