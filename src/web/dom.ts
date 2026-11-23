/**
 * Мини-конструктор DOM. Весь пользовательский текст вставляется через textContent,
 * поэтому HTML из анкет и сообщений не исполняется (защита от XSS).
 */
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'value' && 'value' in el) {
        (el as HTMLInputElement).value = String(v);
      } else if (k === 'checked' && 'checked' in el) {
        (el as HTMLInputElement).checked = Boolean(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'short' });

export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso));

/** Сегодня по Штутгарту, YYYY-MM-DD */
export function berlinToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function km(x: number | null | undefined): string {
  return x === null || x === undefined ? '' : `${x.toLocaleString('ru-RU')} км`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function errorBox(): { el: HTMLElement; show(msg: string): void; hide(): void } {
  const el = h('div', { class: 'alert alert-error', role: 'alert', hidden: true });
  return {
    el,
    show(msg) {
      el.textContent = msg;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

export function toast(msg: string) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
