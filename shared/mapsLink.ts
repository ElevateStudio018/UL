// Säker tolkning av delade Google Maps-länkar. Ingen länk följs här; korta länkar
// (maps.app.goo.gl) löses upp av servern mot en strikt lista med tillåtna värdar.

export type MapsLinkResult =
  | { kind: 'coords'; lat: number; lng: number; name?: string; precision: 'place' | 'pin' | 'viewport' }
  | { kind: 'query'; query: string; placeId?: string }
  | { kind: 'short'; url: string }
  | { kind: 'invalid'; reason: string };

const GOOGLE_HOST = /^(www\.|maps\.)?google\.(com|se|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

export function isAllowedMapsHost(host: string): boolean {
  return GOOGLE_HOST.test(host) || SHORT_HOSTS.has(host.toLowerCase());
}

function validCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

const COORD_PAIR = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export function looksLikeMapsLink(text: string): boolean {
  const t = text.trim();
  return /^geo:/i.test(t) || /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.|maps\.)?google\.[a-z.]+\/(maps|\?))/i.test(t);
}

export function parseMapsLink(input: string): MapsLinkResult {
  const text = input.trim();
  if (text.length > 2048) return { kind: 'invalid', reason: 'Länken är för lång.' };

  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text);
  if (geo) {
    const lat = Number(geo[1]);
    const lng = Number(geo[2]);
    return validCoords(lat, lng) ? { kind: 'coords', lat, lng, precision: 'pin' } : { kind: 'invalid', reason: 'Ogiltiga koordinater.' };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: 'invalid', reason: 'Det här ser inte ut som en länk.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'invalid', reason: 'Endast webblänkar stöds.' };
  if (url.username || url.password) return { kind: 'invalid', reason: 'Länken innehåller inloggningsuppgifter.' };
  const host = url.hostname.toLowerCase();
  if (!isAllowedMapsHost(host)) return { kind: 'invalid', reason: 'Endast länkar från Google Maps stöds.' };

  if (SHORT_HOSTS.has(host)) {
    if (host === 'goo.gl' && !url.pathname.startsWith('/maps')) return { kind: 'invalid', reason: 'Okänd kortlänk.' };
    return { kind: 'short', url: url.toString() };
  }

  const path = decode(url.pathname);
  const full = decode(url.pathname + url.search);

  // Platsnamn från /maps/place/<namn>/...
  const placeName = /\/maps\/place\/([^/@]+)/.exec(path)?.[1]?.trim();

  // !3d<lat>!4d<lng> pekar på själva platsen (bättre än kartvyns mitt).
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(full);
  if (pin) {
    const lat = Number(pin[1]);
    const lng = Number(pin[2]);
    if (validCoords(lat, lng)) return { kind: 'coords', lat, lng, name: placeName, precision: 'place' };
  }

  for (const key of ['q', 'query', 'll', 'destination', 'daddr']) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const m = COORD_PAIR.exec(v);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (validCoords(lat, lng)) return { kind: 'coords', lat, lng, precision: 'pin' };
    } else if (key !== 'll') {
      const placeId = url.searchParams.get('query_place_id') ?? undefined;
      return { kind: 'query', query: v.slice(0, 200), placeId };
    }
  }

  const searchPath = /\/maps\/search\/([^/@]+)/.exec(path)?.[1];
  if (searchPath) {
    const m = COORD_PAIR.exec(searchPath);
    if (m && validCoords(Number(m[1]), Number(m[2]))) return { kind: 'coords', lat: Number(m[1]), lng: Number(m[2]), precision: 'pin' };
    return { kind: 'query', query: searchPath.slice(0, 200) };
  }

  if (placeName) return { kind: 'query', query: placeName.slice(0, 200) };

  // @lat,lng,zoom är bara kartvyns mittpunkt – osäkert, måste bekräftas.
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (validCoords(lat, lng)) return { kind: 'coords', lat, lng, precision: 'viewport' };
  }

  return { kind: 'invalid', reason: 'Platsen gick inte att läsa ut ur länken.' };
}
