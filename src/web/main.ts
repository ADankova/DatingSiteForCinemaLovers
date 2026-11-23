import { api } from './api.js';
import { clear, h } from './dom.js';
import { refreshMe, state } from './state.js';
import { navigate, route, setupRouter } from './router.js';
import { homeView } from './views/home.js';
import { loginView, registerView } from './views/auth.js';
import { cinemasView } from './views/cinemas.js';
import { afishaView, showtimeInvitationsView } from './views/afisha.js';
import { inviteNewView } from './views/invite-new.js';
import { invitationView } from './views/invitation.js';
import { myView } from './views/my.js';
import { userView } from './views/user.js';
import { profileView } from './views/profile.js';
import { adminView, legalView, safetyView } from './views/static.js';

route('/', homeView);
route('/login', loginView);
route('/register', registerView);
route('/cinemas', cinemasView);
route('/afisha', afishaView);
route('/showtime/:id', showtimeInvitationsView);
route('/invite/new', inviteNewView);
route('/invitations/:id', invitationView);
route('/my', myView);
route('/u/:id', userView);
route('/profile', profileView);
route('/safety', safetyView);
route('/terms', legalView('terms'));
route('/privacy', legalView('privacy'));
route('/impressum', legalView('impressum'));
route('/admin', adminView);

const nav = document.getElementById('nav')!;

function renderNav() {
  const me = state.me;
  const current = location.hash.split('?')[0] || '#/';
  const link = (href: string, label: string) => h('a', { href, class: current === href ? 'active' : '' }, label);
  clear(
    nav,
    link('#/', 'Приглашения'),
    link('#/afisha', 'Афиша'),
    link('#/cinemas', 'Кинотеатры'),
    me ? link('#/my', 'Мои встречи') : null,
    me?.role === 'admin' ? link('#/admin', 'Жалобы') : null,
    me
      ? h(
          'span',
          { class: 'nav-user' },
          link(`#/u/${me.id}`, me.profile.displayName),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-small',
              type: 'button',
              onClick: async () => {
                await api.post('/api/auth/logout');
                state.me = null;
                navigate('#/');
              },
            },
            'Выйти',
          ),
        )
      : h('span', { class: 'nav-user' }, link('#/login', 'Войти'), h('a', { class: 'btn btn-primary btn-small', href: '#/register' }, 'Регистрация')),
  );
}

async function start() {
  try {
    await refreshMe();
  } catch {
    state.me = null;
  }
  setupRouter(document.getElementById('app')!, {
    afterRender: renderNav,
    notFound: (root) => root.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'Страница не найдена.'), h('a', { href: '#/' }, 'На главную'))),
  });
}

void start();
