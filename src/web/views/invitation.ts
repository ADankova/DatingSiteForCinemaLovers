import { api, type ChatMessage, type Invitation, type ResponseItem } from '../api.js';
import { clear, errorBox, fmtDateTime, fmtTime, h, km, toast } from '../dom.js';
import { LABELS, onLeave, state } from '../state.js';
import { navigate, rerender } from '../router.js';
import { poster, requireLoginNotice } from './components.js';

interface Detail {
  invitation: Invitation;
  isAuthor: boolean;
  myResponse: { id: number; status: string; message: string } | null;
  responses: ResponseItem[] | null;
  participants: { id: number; displayName: string }[];
  canChat: boolean;
}

export async function invitationView(root: HTMLElement, params: Record<string, string>) {
  if (!state.me) {
    root.replaceChildren(requireLoginNotice());
    return;
  }
  const d = await api.get<Detail>(`/api/invitations/${encodeURIComponent(params.id!)}`);
  const inv = d.invitation;
  const err = errorBox();

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    err.hide();
    try {
      await fn();
      toast(okMsg);
      rerender();
    } catch (e) {
      err.show((e as Error).message);
    }
  };

  // --- Блок действий ---
  let actions: HTMLElement;
  if (d.isAuthor) {
    actions = h(
      'div',
      null,
      h('h2', null, 'Отклики'),
      !d.responses?.length
        ? h('p', { class: 'muted' }, 'Пока никто не откликнулся.')
        : h(
            'div',
            { class: 'list' },
            d.responses.map((r) =>
              h(
                'div',
                { class: 'card response' },
                h(
                  'div',
                  { class: 'card-body' },
                  h('div', null, h('a', { href: `#/u/${r.user.id}` }, h('strong', null, r.user.displayName)), `, ${r.user.age} · ${r.user.district}`),
                  r.message ? h('p', null, `«${r.message}»`) : null,
                  h('span', { class: `tag status-${r.status}` }, LABELS.responseStatus[r.status]),
                ),
                h(
                  'div',
                  { class: 'row' },
                  r.status === 'pending'
                    ? h('button', { class: 'btn btn-primary btn-small', onClick: () => act(() => api.patch(`/api/responses/${r.id}`, { action: 'accept' }), 'Отклик принят') }, 'Принять')
                    : null,
                  r.status === 'pending' || r.status === 'accepted'
                    ? h('button', { class: 'btn btn-small', onClick: () => act(() => api.patch(`/api/responses/${r.id}`, { action: 'decline' }), 'Отклик отклонён') }, 'Отклонить')
                    : null,
                ),
              ),
            ),
          ),
      inv.status !== 'cancelled' && !inv.isPast
        ? h(
            'button',
            {
              class: 'btn btn-danger btn-small',
              onClick: () => {
                if (confirm('Отменить приглашение?')) act(() => api.del(`/api/invitations/${inv.id}`), 'Приглашение отменено');
              },
            },
            'Отменить приглашение',
          )
        : null,
    );
  } else if (d.myResponse && d.myResponse.status !== 'withdrawn') {
    actions = h(
      'div',
      { class: 'panel-inset' },
      h('p', null, 'Ваш отклик: ', h('span', { class: `tag status-${d.myResponse.status}` }, LABELS.responseStatus[d.myResponse.status])),
      d.myResponse.status === 'pending' ? h('p', { class: 'muted' }, 'Когда автор примет отклик, здесь откроется чат.') : null,
      d.myResponse.status === 'pending' || d.myResponse.status === 'accepted'
        ? h('button', { class: 'btn btn-small', onClick: () => act(() => api.patch(`/api/responses/${d.myResponse!.id}`, { action: 'withdraw' }), 'Отклик отозван') }, 'Отозвать отклик')
        : null,
    );
  } else if (inv.status === 'open' && !inv.isPast) {
    const msg = h('textarea', { maxlength: 300, rows: 2, placeholder: 'Пара слов о себе (необязательно)' });
    actions = h(
      'form',
      {
        class: 'panel-inset',
        onSubmit: (e: Event) => {
          e.preventDefault();
          act(() => api.post(`/api/invitations/${inv.id}/responses`, { message: msg.value }), 'Отклик отправлен');
        },
      },
      msg,
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Хочу пойти'),
    );
  } else {
    actions = h('p', { class: 'muted' }, 'Приглашение закрыто.');
  }

  clear(
    root,
    h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'inv-head' },
        poster(inv.posterUrl, inv.movieTitle),
        h(
          'div',
          null,
          h('h1', null, inv.movieTitle),
          h('p', { class: 'big' }, fmtDateTime(inv.startsAt)),
          h('p', null, h('strong', null, inv.cinema.name), ` · ${inv.cinema.address}`, inv.cinema.distanceKm !== null ? ` · ${km(inv.cinema.distanceKm)}` : ''),
          h(
            'div',
            { class: 'tags' },
            h('span', { class: 'tag' }, LABELS.invFormat[inv.format]),
            inv.format === 'group' ? h('span', { class: 'tag' }, `мест: ${inv.acceptedCount}/${inv.seats}`) : null,
            h('span', { class: 'tag' }, `билеты: ${LABELS.tickets[inv.tickets]}`),
            inv.language ? h('span', { class: 'tag tag-accent' }, LABELS.language[inv.language] ?? inv.language) : null,
            h('span', { class: 'tag tag-muted' }, LABELS.invStatus[inv.status]),
          ),
          h('p', null, 'Зовёт: ', h('a', { href: `#/u/${inv.author.id}` }, inv.author.displayName), `, ${inv.author.age} · ${inv.author.district}`),
          inv.message ? h('blockquote', null, inv.message) : null,
          inv.ticketUrl ? h('a', { class: 'btn btn-ghost btn-small', href: inv.ticketUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Купить билет на сайте кинотеатра') : null,
        ),
      ),
      err.el,
      actions,
      d.participants.length ? h('p', { class: 'muted' }, 'Идут: ', d.participants.map((p, i) => [i ? ', ' : '', h('a', { href: `#/u/${p.id}` }, p.displayName)])) : null,
    ),
    d.canChat ? chat(inv.id) : null,
  );
  if (!d.isAuthor && inv.status === 'cancelled') toast('Автор отменил это приглашение');
}

/** Чат приглашения: опрос сервера раз в 4 секунды. */
function chat(invitationId: number): HTMLElement {
  const box = h('div', { class: 'chat-messages', 'aria-live': 'polite' });
  let lastId = 0;
  let stopped = false;

  const render = (msgs: ChatMessage[]) => {
    if (!msgs.length) return;
    if (lastId === 0) box.replaceChildren();
    for (const m of msgs) {
      box.appendChild(
        h(
          'div',
          { class: 'msg' + (m.mine ? ' mine' : '') },
          !m.mine ? h('div', { class: 'msg-author' }, m.sender.displayName) : null,
          h('div', { class: 'msg-text' }, m.text),
          h('div', { class: 'msg-time' }, fmtTime(m.createdAt)),
        ),
      );
      lastId = Math.max(lastId, m.id);
    }
    box.scrollTop = box.scrollHeight;
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const r = await api.get<{ messages: ChatMessage[] }>(`/api/invitations/${invitationId}/messages?after=${lastId}`);
      render(r.messages);
    } catch (e) {
      if ((e as { status?: number }).status === 403) {
        stopped = true;
        navigate(location.hash);
      }
    }
  };

  clear(box, h('p', { class: 'muted' }, 'Сообщений пока нет. Договоритесь, где встретиться: например, у входа за 15 минут до начала.'));
  void poll();
  const timer = window.setInterval(poll, 4000);
  onLeave(() => {
    stopped = true;
    clearInterval(timer);
  });

  const input = h('input', { maxlength: 1000, placeholder: 'Сообщение…', 'aria-label': 'Сообщение', autocomplete: 'off' });
  const form = h(
    'form',
    {
      class: 'chat-form',
      onSubmit: async (e: Event) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        try {
          await api.post(`/api/invitations/${invitationId}/messages`, { text });
          input.value = '';
          await poll();
        } catch (e) {
          toast((e as Error).message);
        }
      },
    },
    input,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Отправить'),
  );
  return h('section', { class: 'panel chat' }, h('h2', null, 'Чат'), box, form);
}
