// Laddar Google Maps JavaScript API med webbläsarnyckeln från servern.
// Nyckeln ska vara begränsad till appens domäner och till Maps JS, Places (New)
// och Geocoding i Google Cloud Console.

import type { LatLng, Place } from '../../shared/types';
import { UPPSALA } from '../../shared/geo';

let loading: Promise<typeof google> | null = null;

export function loadGoogle(key: string): Promise<typeof google> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = '__samakGoogleReady';
    (window as unknown as Record<string, unknown>)[cb] = () => resolve(window.google);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places,geometry&language=sv&region=SE&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Google Maps kunde inte laddas. Kontrollera nätverket och API-nyckeln.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  resolve: () => Promise<Place>;
}

let session: unknown = null;

/** Sökförslag från Places API (New), viktade mot Uppsala län men inte låsta dit. */
export async function placeSuggestions(key: string, input: string, near?: LatLng): Promise<Suggestion[]> {
  const g = await loadGoogle(key);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const places = (await g.maps.importLibrary('places')) as any;
  if (!session) session = new places.AutocompleteSessionToken();
  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: session,
    language: 'sv',
    region: 'se',
    locationBias: { center: near ?? UPPSALA, radius: 50000 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (suggestions as any[])
    .filter((s) => s.placePrediction)
    .slice(0, 6)
    .map((s) => {
      const p = s.placePrediction;
      return {
        id: p.placeId,
        main: p.mainText?.text ?? p.text.text,
        secondary: p.secondaryText?.text ?? '',
        resolve: async () => {
          const place = p.toPlace();
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
          session = null;
          return {
            name: place.displayName ?? p.mainText?.text ?? p.text.text,
            address: place.formattedAddress ?? undefined,
            lat: place.location.lat(),
            lng: place.location.lng(),
            placeId: p.placeId,
            source: 'search',
          } satisfies Place;
        },
      };
    });
}

export async function placeFromQuery(key: string, query: string): Promise<Suggestion[]> {
  return placeSuggestions(key, query);
}

export async function reverseGeocode(key: string, p: LatLng): Promise<string | null> {
  try {
    const g = await loadGoogle(key);
    const geocoder = new g.maps.Geocoder();
    const { results } = await geocoder.geocode({ location: p, language: 'sv' });
    const r = results[0];
    if (!r) return null;
    const street = r.address_components.find((c) => c.types.includes('route'))?.long_name;
    const no = r.address_components.find((c) => c.types.includes('street_number'))?.long_name;
    return street ? `${street}${no ? ` ${no}` : ''}` : r.formatted_address;
  } catch {
    return null;
  }
}
