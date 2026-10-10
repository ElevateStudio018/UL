import type {
  Alert,
  AppConfig,
  Departure,
  LatLng,
  PairOption,
  Place,
  PlanRequest,
  PlanResponse,
  ShareState,
  ShareStatus,
  StopRef,
  TogetherRequest,
  TogetherResponse,
  TripDetail,
  Vehicle,
} from '../../shared/types';
import type { MapsLinkResult } from '../../shared/mapsLink';

export class ApiError extends Error {
  constructor(message: string, public status: number, public network = false) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.token ? { 'X-Share-Token': init.token } : {}),
      },
    });
  } catch {
    throw new ApiError(navigator.onLine ? 'Kunde inte nå servern. Kontrollera anslutningen och försök igen.' : 'Du är offline. Anslut till internet och försök igen.', 0, true);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* tomt svar */
  }
  if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? `Något gick fel (${res.status}).`, res.status);
  return body as T;
}

const post = <T>(path: string, data: unknown, token?: string) => request<T>(path, { method: 'POST', body: JSON.stringify(data), token });

export const api = {
  config: () => request<AppConfig>('/api/config'),
  plan: (r: PlanRequest) => post<PlanResponse>('/api/plan', r),
  together: (r: TogetherRequest) => post<TogetherResponse>('/api/plan/together', r),
  stops: (bbox: string) => request<{ stops: StopRef[] }>(`/api/stops?bbox=${bbox}`),
  departures: (stopId: string, from: number, limit = 12, until?: number) =>
    request<{ departures: Departure[]; demo: boolean }>(`/api/stops/${encodeURIComponent(stopId)}/departures?from=${from}&limit=${limit}${until ? `&until=${until}` : ''}`),
  trip: (tripId: string, serviceDate: string) => request<{ trip: TripDetail; demo: boolean }>(`/api/trips/${encodeURIComponent(tripId)}?serviceDate=${serviceDate}`),
  vehicles: () => request<{ vehicles: Vehicle[]; demo: boolean; available: boolean; fetchedAt: number; error?: string }>('/api/vehicles'),
  alerts: () => request<{ alerts: Alert[]; demo: boolean; available: boolean }>('/api/alerts'),
  search: (q: string) => request<{ results: Place[]; demo: boolean }>(`/api/search?q=${encodeURIComponent(q)}`),
  reverse: (p: LatLng) => request<{ name: string }>(`/api/reverse?lat=${p.lat}&lng=${p.lng}`),
  resolveLink: (url: string) => post<MapsLinkResult>('/api/maps/resolve', { url }),
  share: {
    create: (data: { destination: Place; time: TogetherRequest['time']; strategy: TogetherRequest['strategy']; tolerance: number; option?: PairOption; names: [string, string]; origin?: Place }) =>
      post<{ id: string; token: string; participant: 0; share: ShareState }>('/api/share', data),
    get: (id: string, token?: string) => request<{ share: ShareState; you: 0 | 1 | null }>(`/api/share/${encodeURIComponent(id)}`, { token }),
    join: (id: string, name: string, origin?: Place) => post<{ token: string; participant: 1; share: ShareState }>(`/api/share/${encodeURIComponent(id)}/join`, { name, origin }),
    update: (id: string, token: string, patch: { confirmed?: boolean; status?: ShareStatus; origin?: Place; name?: string; option?: PairOption | null }) =>
      post<{ share: ShareState }>(`/api/share/${encodeURIComponent(id)}/update`, patch, token),
    live: (id: string, token: string, pos: LatLng, minutes: number) => post<{ share: ShareState }>(`/api/share/${encodeURIComponent(id)}/live`, { ...pos, minutes }, token),
    stopLive: (id: string, token: string) => request<{ share: ShareState }>(`/api/share/${encodeURIComponent(id)}/live`, { method: 'DELETE', token }),
    remove: (id: string, token: string) => request<{ ok: boolean }>(`/api/share/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
  },
};
