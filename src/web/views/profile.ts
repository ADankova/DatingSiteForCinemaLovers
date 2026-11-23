import { api, type OwnProfile } from '../api.js';
import { errorBox, field, h, toast } from '../dom.js';
import { loadMeta, refreshMe, state } from '../state.js';
import { navigate } from '../router.js';
import { profileFormFields, requireLoginNotice } from './components.js';

/** Редактирование анкеты и удаление аккаунта. */
export async function profileView(root: HTMLElement) {
  if (!state.me) {
    root.replaceChildren(requireLoginNotice());
    return;
  }
  const meta = await loadMeta();
  const p = state.me.profile;
  const fields = profileFormFields(meta, p);
  const err = errorBox();

  const form = h(
    'form',
    {
      class: 'panel',
      onSubmit: async (e: Event) => {
        e.preventDefault();
        err.hide();
        try {
          await api.put<{ profile: OwnProfile }>('/api/me/profile', fields.read());
          await refreshMe();
          toast('Анкета сохранена');
        } catch (e) {
          err.show((e as Error).message);
        }
      },
    },
    h('h1', null, 'Моя анкета'),
    h('p', { class: 'muted' }, `E-mail: ${state.me.email} (виден только вам) · Дата рождения: ${p.birthDate.split('-').reverse().join('.')} (другие видят только возраст)`),
    err.el,
    fields.el,
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Сохранить'), h('a', { class: 'btn btn-ghost', href: `#/u/${state.me.id}` }, 'Как видят другие')),
  );

  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const delErr = errorBox();
  const del = h(
    'details',
    { class: 'panel danger-zone' },
    h('summary', null, 'Удалить аккаунт'),
    h('p', null, 'Анкета, приглашения, отклики и сообщения будут удалены безвозвратно.'),
    delErr.el,
    field('Пароль для подтверждения', pw),
    h(
      'button',
      {
        class: 'btn btn-danger',
        type: 'button',
        onClick: async () => {
          if (!confirm('Точно удалить аккаунт? Это нельзя отменить.')) return;
          try {
            await api.del('/api/me', { password: pw.value });
            state.me = null;
            navigate('#/');
          } catch (e) {
            delErr.show((e as Error).message);
          }
        },
      },
      'Удалить навсегда',
    ),
  );
  root.replaceChildren(form, del);
}
