import { api } from '../api.js';
import { addDays, berlinToday, errorBox, field, h } from '../dom.js';
import { loadMeta, refreshMe } from '../state.js';
import { navigate } from '../router.js';
import { profileFormFields } from './components.js';

export async function loginView(root: HTMLElement) {
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const password = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = errorBox();
  const form = h(
    'form',
    {
      class: 'panel narrow',
      onSubmit: async (e: Event) => {
        e.preventDefault();
        err.hide();
        try {
          await api.post('/api/auth/login', { email: email.value, password: password.value });
          await refreshMe();
          navigate('#/');
        } catch (e) {
          err.show((e as Error).message);
        }
      },
    },
    h('h1', null, 'Вход'),
    err.el,
    field('E-mail', email),
    field('Пароль', password),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Войти'),
    h('p', { class: 'muted' }, 'Нет аккаунта? ', h('a', { href: '#/register' }, 'Зарегистрироваться')),
  );
  root.replaceChildren(form);
}

export async function registerView(root: HTMLElement) {
  const meta = await loadMeta();
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const password = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const maxBirth = addDays(berlinToday(), -365 * 18 - 5);
  const birthDate = h('input', { type: 'date', required: true, max: maxBirth });
  const terms = h('input', { type: 'checkbox', required: true });
  const profile = profileFormFields(meta);
  const err = errorBox();

  const form = h(
    'form',
    {
      class: 'panel',
      onSubmit: async (e: Event) => {
        e.preventDefault();
        err.hide();
        try {
          await api.post('/api/auth/register', {
            email: email.value,
            password: password.value,
            birthDate: birthDate.value,
            acceptTerms: terms.checked,
            ...profile.read(),
          });
          await refreshMe();
          navigate('#/afisha');
        } catch (e) {
          err.show((e as Error).message);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
    },
    h('h1', null, 'Регистрация'),
    h('p', { class: 'muted' }, 'Сервис только для совершеннолетних (18+). Другие пользователи увидят ваш возраст, но не дату рождения и не e-mail.'),
    err.el,
    h(
      'div',
      { class: 'form-grid' },
      field('E-mail', email),
      field('Пароль', password, 'Минимум 8 символов'),
      field('Дата рождения', birthDate),
    ),
    h('h2', null, 'Анкета'),
    profile.el,
    h(
      'label',
      { class: 'check' },
      terms,
      ' Я принимаю ',
      h('a', { href: '#/terms' }, 'пользовательское соглашение'),
      ' и ',
      h('a', { href: '#/privacy' }, 'политику конфиденциальности'),
    ),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Зарегистрироваться'),
  );
  root.replaceChildren(form);
}
