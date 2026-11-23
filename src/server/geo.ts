/** Расстояние по прямой между двумя точками (км), формула гаверсинуса. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0088;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface District {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface City {
  id: string;
  name: string;
  districts: District[];
}

/**
 * Районы (Stadtbezirke) Штутгарта с ПРИМЕРНЫМИ координатами центров.
 * Местоположение пользователя берётся из анкеты: храним центр района, а не точный адрес.
 */
export const CITIES: City[] = [
  {
    id: 'stuttgart',
    name: 'Штутгарт',
    districts: [
      { id: 'mitte', name: 'Mitte', lat: 48.776, lng: 9.18 },
      { id: 'nord', name: 'Nord', lat: 48.795, lng: 9.18 },
      { id: 'ost', name: 'Ost', lat: 48.785, lng: 9.21 },
      { id: 'sued', name: 'Süd', lat: 48.762, lng: 9.168 },
      { id: 'west', name: 'West', lat: 48.775, lng: 9.155 },
      { id: 'bad-cannstatt', name: 'Bad Cannstatt', lat: 48.805, lng: 9.215 },
      { id: 'birkach', name: 'Birkach', lat: 48.72, lng: 9.2 },
      { id: 'botnang', name: 'Botnang', lat: 48.78, lng: 9.13 },
      { id: 'degerloch', name: 'Degerloch', lat: 48.745, lng: 9.17 },
      { id: 'feuerbach', name: 'Feuerbach', lat: 48.81, lng: 9.16 },
      { id: 'hedelfingen', name: 'Hedelfingen', lat: 48.763, lng: 9.252 },
      { id: 'moehringen', name: 'Möhringen', lat: 48.725, lng: 9.15 },
      { id: 'muehlhausen', name: 'Mühlhausen', lat: 48.845, lng: 9.23 },
      { id: 'muenster', name: 'Münster', lat: 48.82, lng: 9.215 },
      { id: 'obertuerkheim', name: 'Obertürkheim', lat: 48.76, lng: 9.27 },
      { id: 'plieningen', name: 'Plieningen', lat: 48.7, lng: 9.21 },
      { id: 'sillenbuch', name: 'Sillenbuch', lat: 48.745, lng: 9.21 },
      { id: 'stammheim', name: 'Stammheim', lat: 48.85, lng: 9.15 },
      { id: 'untertuerkheim', name: 'Untertürkheim', lat: 48.78, lng: 9.25 },
      { id: 'vaihingen', name: 'Vaihingen', lat: 48.73, lng: 9.11 },
      { id: 'wangen', name: 'Wangen', lat: 48.775, lng: 9.24 },
      { id: 'weilimdorf', name: 'Weilimdorf', lat: 48.815, lng: 9.11 },
      { id: 'zuffenhausen', name: 'Zuffenhausen', lat: 48.83, lng: 9.17 },
    ],
  },
];

export function findDistrict(cityId: string, districtId: string): District | undefined {
  return CITIES.find((c) => c.id === cityId)?.districts.find((d) => d.id === districtId);
}

export function nearestDistrict(cityId: string, lat: number, lng: number): District | undefined {
  const city = CITIES.find((c) => c.id === cityId);
  if (!city) return undefined;
  let best: District | undefined;
  let bestKm = Infinity;
  for (const d of city.districts) {
    const km = haversineKm(lat, lng, d.lat, d.lng);
    if (km < bestKm) {
      bestKm = km;
      best = d;
    }
  }
  return best;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
