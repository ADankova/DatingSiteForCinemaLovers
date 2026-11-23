export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Ошибка ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- Типы ответов API ----
export interface District {
  id: string;
  name: string;
}
export interface Meta {
  cities: { id: string; name: string; districts: District[] }[];
  genres: string[];
  reportReasons: Record<string, string>;
  showLanguages: string[];
  ticketModes: string[];
}
export interface PublicUser {
  id: number;
  displayName: string;
  age: number;
  gender: string;
  city: string;
  district: string;
  about: string;
  genres: string[];
  favoriteFilms: string;
  languagePref: string;
  meetFormat: string;
  memberSince?: string;
}
export interface OwnProfile extends PublicUser {
  birthDate: string;
  cityId: string;
  districtId: string;
  searchRadiusKm: number;
  visible: boolean;
}
export interface Me {
  id: number;
  email: string;
  role: 'user' | 'admin';
  memberSince: string;
  profile: OwnProfile;
}
export interface Cinema {
  id: number;
  slug: string;
  name: string;
  address: string;
  district: string;
  lat: number;
  lng: number;
  website: string;
  hasOv: boolean;
  approxCoords: boolean;
  distanceKm: number | null;
}
export interface Showtime {
  id: number;
  startsAt: string;
  language: string;
  ticketUrl: string;
  openInvitations: number;
  movie: { id: number; title: string; overview: string; posterUrl: string; genres: string[]; runtimeMin: number | null; ageRating: string; isDemo: boolean };
  cinema: Cinema;
}
export interface Invitation {
  id: number;
  author: { id: number; displayName: string; age: number; gender: string; district: string };
  showtimeId: number | null;
  movieId: number | null;
  movieTitle: string;
  posterUrl: string;
  startsAt: string;
  language: string;
  ticketUrl: string;
  cinema: { id: number; name: string; address: string; distanceKm: number | null };
  format: 'pair' | 'group';
  seats: number;
  acceptedCount: number;
  pendingCount: number;
  message: string;
  tickets: 'self' | 'host' | 'discuss';
  status: 'open' | 'full' | 'cancelled';
  isPast: boolean;
}
export interface ResponseItem {
  id: number;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  message: string;
  createdAt: string;
  user: { id: number; displayName: string; age: number; gender: string; district: string };
}
export interface ChatMessage {
  id: number;
  sender: { id: number; displayName: string };
  text: string;
  createdAt: string;
  mine: boolean;
}
