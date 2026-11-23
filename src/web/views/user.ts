import { api, type PublicUser } from '../api.js';
import { errorBox, field, fmtDateTime, h, toast } from '../dom.js';
import { LABELS, loadMeta, state } from '../state.js';
import { rerender } from '../router.js';
import { requireLoginNotice } from './components.js';

interface UserPage {
  user: PublicUser;
  invitations: { id: number; movieTitle: string; startsAt: string; cinemaName: string; format: string }[];
  isMe: boolean;
  iBlocked: boolean;
}

export async function userView(root: HTMLElement, params: Record<string, string>) {
  if (!state.me) {
    root.replaceChildren(requireLoginNotice());
    return;
  }
  const meta = await loadMeta();
  const d = await api.get<UserPage>(`/api/users/${encodeURIComponent(params.id!)}`);
  const u = d.user;

  const facts: [string, string][] = [
    ['Возраст', String(u.age)],
    ['Пол', LABELS.gender[u.gender] ?? ''],
    ['Район', `${u.district}, ${u.city}`],
    ['Язык показа', LABELS.languagePref[u.languagePref] ?? ''],
    ['Формат встречи', LABELS.meetFormat[u.meetFormat] ?? ''],
  ];

  let safety: HTMLElement | null = null;
  if (!d.isMe) {
    const err = errorBox();
    const reason = h('select', null, Object.entries(meta.reportReasons).map(([v, l]) => h('option', { value: v }, l)));
    const comment = h('textarea', { maxlength: 1000, rows: 2, placeholder: 'Что произошло?' });
    const reportForm = h(
      'form',
      {
        class: 'panel-inset',
        hidden: true,
        onSubmit: async (e: Event) => {
          e.preventDefault();
          try {
            await api.post(`/api/users/${u.id}/report`, { reason: reason.value, comment: comment.value });
            reportForm.hidden = true;
            toast('Жалоба отправлена модератору');
          } catch (e) {
            err.show((e as Error).message);
          }
        },
      },
      err.el,
      field('Причина', reason),
      field('Комментарий', comment),
      h('button', { class: 'btn btn-danger btn-small', type: 'submit' }, 'Отправить жалобу'),
    );
    safety = h(
      'div',
      null,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => (reportForm.hidden = !reportForm.hidden) }, 'Пожаловаться'),
        d.iBlocked
          ? h('button', { class: 'btn btn-small', type: 'button', onClick: async () => (await api.del(`/api/users/${u.id}/block`), toast('Пользователь разблокирован'), rerender()) }, 'Разблокировать')
          : h(
              'button',
              {
                class: 'btn btn-small btn-danger',
                type: 'button',
                onClick: async () => {
                  if (!confirm(`Заблокировать ${u.displayName}? Вы перестанете видеть друг друга, общие отклики будут сняты.`)) return;
                  await api.post(`/api/users/${u.id}/block`);
                  toast('Пользователь заблокирован');
                  history.back();
                },
              },
              'Заблокировать',
            ),
      ),
      reportForm,
    );
  }

  root.replaceChildren(
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'profile-head' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, u.displayName.slice(0, 1).toUpperCase()), h('div', null, h('h1', null, u.displayName), u.memberSince ? h('p', { class: 'muted' }, `На KinoBuddy с ${new Date(u.memberSince).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`) : null)),
      d.isMe ? h('a', { class: 'btn btn-small', href: '#/profile' }, 'Редактировать анкету') : null,
      h('dl', { class: 'facts' }, facts.filter(([, v]) => v).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      u.about ? [h('h2', null, 'О себе'), h('p', { class: 'pre' }, u.about)] : null,
      u.genres.length ? [h('h2', null, 'Любимые жанры'), h('div', { class: 'tags' }, u.genres.map((g) => h('span', { class: 'tag' }, g)))] : null,
      u.favoriteFilms ? [h('h2', null, 'Любимые фильмы'), h('p', null, u.favoriteFilms)] : null,
      h('h2', null, 'Зовёт в кино'),
      d.invitations.length
        ? h('ul', { class: 'plain' }, d.invitations.map((i) => h('li', null, h('a', { href: `#/invitations/${i.id}` }, i.movieTitle), ` — ${fmtDateTime(i.startsAt)}, ${i.cinemaName}`)))
        : h('p', { class: 'muted' }, 'Сейчас открытых приглашений нет.'),
      safety,
    ),
  );
}
