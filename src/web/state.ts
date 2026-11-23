import { api, type Me, type Meta } from './api.js';

export const state: { me: Me | null; meta: Meta | null } = { me: null, meta: null };

export async function loadMeta(): Promise<Meta> {
  if (!state.meta) state.meta = await api.get<Meta>('/api/meta');
  return state.meta;
}

export async function refreshMe(): Promise<Me | null> {
  const r = await api.get<{ user: Me | null }>('/api/me');
  state.me = r.user;
  return state.me;
}

export const LABELS = {
  gender: { female: 'женщина', male: 'мужчина', other: 'другое', unspecified: 'не указан' } as Record<string, string>,
  languagePref: { dub: 'дубляж', ov: 'в оригинале (OV/OmU)', any: 'не важно' } as Record<string, string>,
  meetFormat: { pair: 'вдвоём', group: 'компанией', any: 'не важно' } as Record<string, string>,
  invFormat: { pair: 'вдвоём', group: 'компанией' } as Record<string, string>,
  tickets: { self: 'каждый покупает себе', host: 'автор купит на всех', discuss: 'договоримся' } as Record<string, string>,
  responseStatus: { pending: 'ждёт ответа', accepted: 'принят', declined: 'отклонён', withdrawn: 'отозван' } as Record<string, string>,
  invStatus: { open: 'открыто', full: 'мест нет', cancelled: 'отменено' } as Record<string, string>,
  language: { DE: 'на немецком', OV: 'в оригинале', OmU: 'оригинал с субтитрами' } as Record<string, string>,
};

/** Чтобы при смене страницы останавливать таймеры (например, обновление чата). */
const cleanups: (() => void)[] = [];
export function onLeave(fn: () => void) {
  cleanups.push(fn);
}
export function runCleanups() {
  while (cleanups.length) cleanups.pop()!();
}
