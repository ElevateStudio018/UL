import type { Place } from '../../shared/types';

export class GeoError extends Error {
  constructor(public code: 'denied' | 'unavailable' | 'timeout' | 'unsupported', message: string) {
    super(message);
  }
}

/** Begär position först när användaren själv väljer funktionen. Inget sparas. */
export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('unsupported', 'Din webbläsare kan inte dela position. Sök fram platsen i stället.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      if (err.code === err.PERMISSION_DENIED)
        reject(new GeoError('denied', 'Platsåtkomst är nekad. Tillåt plats för den här sidan i webbläsarens inställningar, eller sök fram platsen.'));
      else if (err.code === err.TIMEOUT) reject(new GeoError('timeout', 'Det tog för lång tid att hitta din position. Försök igen eller sök fram platsen.'));
      else reject(new GeoError('unavailable', 'Din position kunde inte bestämmas just nu. Sök fram platsen i stället.'));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}

export async function currentPlace(): Promise<Place> {
  const pos = await currentPosition();
  return { name: 'Min position', lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' };
}
