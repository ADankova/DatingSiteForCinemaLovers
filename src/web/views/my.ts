import { api, type Invitation } from '../api.js';
import { h } from '../dom.js';
import { LABELS, state } from '../state.js';
import { emptyState, invitationCard, requireLoginNotice } from './components.js';

export async function myView(root: HTMLElement) {
  if (!state.me) {
    root.replaceChildren(requireLoginNotice());
    return;
  }
  const r = await api.get<{ authored: Invitation[]; responded: { response: { id: number; status: string }; invitation: Invitation }[] }>('/api/my/invitations');

  const authored = r.authored.length
    ? h(
        'div',
        { class: 'grid' },
        r.authored.map((inv) => {
          const card = invitationCard(inv);
          if (inv.pendingCount > 0) card.appendChild(h('span', { class: 'badge' }, `новых откликов: ${inv.pendingCount}`));
          return card;
        }),
      )
    : emptyState('Вы ещё никого не позвали в кино.', h('a', { class: 'btn btn-primary', href: '#/afisha' }, 'Выбрать сеанс'));

  const responded = r.responded.length
    ? h(
        'div',
        { class: 'grid' },
        r.responded.map(({ response, invitation }) => {
          const card = invitationCard(invitation);
          card.appendChild(h('span', { class: `badge status-${response.status}` }, LABELS.responseStatus[response.status]));
          return card;
        }),
      )
    : emptyState('Вы пока ни на что не откликались.', h('a', { class: 'btn', href: '#/' }, 'Смотреть приглашения'));

  root.replaceChildren(h('h1', null, 'Мои встречи'), h('h2', null, 'Я зову'), authored, h('h2', null, 'Я откликнулся(-ась)'), responded);
}
