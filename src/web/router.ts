import { runCleanups } from './state.js';

type View = (root: HTMLElement, params: Record<string, string>, query: URLSearchParams) => void | Promise<void>;
interface Route {
  parts: string[];
  view: View;
}

const routes: Route[] = [];
let rootEl: HTMLElement;
let notFound: View = (root) => root.replaceChildren(document.createTextNode('Страница не найдена'));
let afterRender: () => void = () => {};

export function route(path: string, view: View) {
  routes.push({ parts: path.split('/').filter(Boolean), view });
}

export function setupRouter(root: HTMLElement, opts: { notFound?: View; afterRender?: () => void } = {}) {
  rootEl = root;
  if (opts.notFound) notFound = opts.notFound;
  if (opts.afterRender) afterRender = opts.afterRender;
  window.addEventListener('hashchange', () => void render());
  void render();
}

export function navigate(hash: string) {
  if (location.hash === hash) void render();
  else location.hash = hash;
}

export function rerender() {
  void render();
}

async function render() {
  runCleanups();
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const parts = (pathPart ?? '/').split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart ?? '');

  let view = notFound;
  let params: Record<string, string> = {};
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const p: Record<string, string> = {};
    if (r.parts.every((rp, i) => (rp.startsWith(':') ? ((p[rp.slice(1)] = decodeURIComponent(parts[i]!)), true) : rp === parts[i]))) {
      view = r.view;
      params = p;
      break;
    }
  }
  afterRender();
  try {
    await view(rootEl, params, query);
  } catch (e) {
    const msg = document.createElement('div');
    msg.className = 'alert alert-error';
    msg.textContent = (e as Error).message || 'Что-то пошло не так';
    rootEl.replaceChildren(msg);
  }
  rootEl.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
