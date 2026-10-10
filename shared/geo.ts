import type { LatLng } from './types';

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Avkodar Googles "encoded polyline" (används av OpenTripPlanner). */
export function decodePolyline(str: string): LatLng[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out: LatLng[] = [];
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (!points.length) return null;
  const b = { south: 90, west: 180, north: -90, east: -180 };
  for (const p of points) {
    b.south = Math.min(b.south, p.lat);
    b.north = Math.max(b.north, p.lat);
    b.west = Math.min(b.west, p.lng);
    b.east = Math.max(b.east, p.lng);
  }
  return b;
}

export function inBounds(p: LatLng, b: Bounds): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

export const UPPSALA: LatLng = { lat: 59.8586, lng: 17.6389 };

/** Ungefärlig ruta runt Uppsala län, används för att prioritera sökträffar. */
export const UPPLAND_BOUNDS: Bounds = { south: 59.3, west: 16.6, north: 60.75, east: 18.9 };
