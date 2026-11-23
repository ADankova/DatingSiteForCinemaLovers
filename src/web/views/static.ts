import { api } from '../api.js';
import { h, fmtDateTime, toast } from '../dom.js';
import { state } from '../state.js';
import { rerender } from '../router.js';
import { emptyState } from './components.js';

export function safetyView(root: HTMLElement) {
  const tips = [
    'Встречайтесь у входа в кинотеатр — это людное место. Не соглашайтесь, чтобы вас забирали из дома.',
    'Добирайтесь и уезжайте самостоятельно. Расскажите близким, с кем и куда идёте.',
    'Не переводите деньги незнакомцам. Лучше, если каждый покупает билет себе сам.',
    'Не сообщайте домашний адрес, место работы и данные документов в чате.',
    'Если человек ведёт себя неуместно — уйдите, заблокируйте его и пожалуйтесь через страницу профиля.',
    'При угрозе жизни или здоровью звоните 110 (полиция) или 112.',
  ];
  root.replaceChildren(
    h('div', { class: 'panel narrow' }, h('h1', null, 'Безопасность на встрече'), h('ol', null, tips.map((t) => h('li', null, t)))),
  );
}

export function legalView(kind: 'terms' | 'privacy' | 'impressum') {
  const titles = { terms: 'Пользовательское соглашение', privacy: 'Политика конфиденциальности', impressum: 'Impressum' };
  return (root: HTMLElement) =>
    root.replaceChildren(
      h(
        'div',
        { class: 'panel narrow' },
        h('h1', null, titles[kind]),
        h('div', { class: 'alert alert-info' }, 'Черновик. Текст нужно подготовить с юристом до публичного запуска (DSGVO, TMG/DDG).'),
        kind === 'privacy'
          ? h(
              'ul',
              null,
              h('li', null, 'Мы храним e-mail, хеш пароля, анкету и район (центр района, не точный адрес).'),
              h('li', null, 'Геолокацию браузера мы не запрашиваем.'),
              h('li', null, 'Другие пользователи видят имя, возраст, район и анкету; e-mail и дату рождения — нет.'),
              h('li', null, 'Вы можете удалить аккаунт со всеми данными на странице анкеты.'),
            )
          : null,
      ),
    );
}

interface AdminReport {
  id: number;
  reasonText: string;
  comment: string;
  status: 'new' | 'in_progress' | 'closed';
  createdAt: string;
  reporter: { id: number; displayName: string | null };
  target: { id: number; displayName: string | null; email: string; status: string; totalReports: number };
}

export async function adminView(root: HTMLElement) {
  if (state.me?.role !== 'admin') {
    root.replaceChildren(emptyState('Раздел только для администратора.'));
    return;
  }
  const r = await api.get<{ reports: AdminReport[] }>('/api/admin/reports');
  const statusLabel = { new: 'новая', in_progress: 'в работе', closed: 'закрыта' };
  root.replaceChildren(
    h('h1', null, 'Жалобы'),
    r.reports.length
      ? h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, ['Дата', 'На кого', 'Причина', 'От кого', 'Статус', ''].map((t) => h('th', null, t)))),
          h(
            'tbody',
            null,
            r.reports.map((rep) =>
              h(
                'tr',
                null,
                h('td', null, fmtDateTime(rep.createdAt)),
                h('td', null, h('a', { href: `#/u/${rep.target.id}` }, rep.target.displayName ?? '—'), h('div', { class: 'muted small' }, `${rep.target.email} · жалоб: ${rep.target.totalReports}${rep.target.status === 'banned' ? ' · ЗАБЛОКИРОВАН' : ''}`)),
                h('td', null, rep.reasonText, rep.comment ? h('div', { class: 'muted small' }, rep.comment) : null),
                h('td', null, rep.reporter.displayName ?? '—'),
                h(
                  'td',
                  null,
                  h(
                    'select',
                    {
                      onChange: async (e: Event) => {
                        await api.patch(`/api/admin/reports/${rep.id}`, { status: (e.target as HTMLSelectElement).value });
                        toast('Статус обновлён');
                      },
                    },
                    (Object.keys(statusLabel) as (keyof typeof statusLabel)[]).map((s) => h('option', { value: s, selected: s === rep.status }, statusLabel[s])),
                  ),
                ),
                h(
                  'td',
                  null,
                  h(
                    'button',
                    {
                      class: 'btn btn-small ' + (rep.target.status === 'banned' ? '' : 'btn-danger'),
                      onClick: async () => {
                        const ban = rep.target.status !== 'banned';
                        if (ban && !confirm('Заблокировать аккаунт? Его приглашения будут отменены.')) return;
                        await api.post(`/api/admin/users/${rep.target.id}/ban`, { banned: ban });
                        toast(ban ? 'Аккаунт заблокирован' : 'Аккаунт разблокирован');
                        rerender();
                      },
                    },
                    rep.target.status === 'banned' ? 'Разбанить' : 'Забанить',
                  ),
                ),
              ),
            ),
          ),
        )
      : emptyState('Жалоб нет.'),
  );
}
