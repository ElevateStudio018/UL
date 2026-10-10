import type { Vehicle } from '../../shared/types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type Freshness = 'fresh' | 'stale' | 'old';

/** Aktuell GPS ≤ 90 s, gammal positionsuppgift ≤ 10 min, därefter visas den inte. */
export function freshness(v: Vehicle, now: number): Freshness {
  const age = now - v.timestamp;
  if (age <= 90_000) return 'fresh';
  if (age <= 10 * 60_000) return 'stale';
  return 'old';
}

export function vehicleHtml(v: Vehicle, now: number, highlight: boolean): string {
  const f = freshness(v, now);
  const arrow = v.bearing != null ? `<span class="veh-arrow" style="transform:rotate(${Math.round(v.bearing)}deg)"></span>` : '';
  return `<div class="veh veh-${f} ${highlight ? 'veh-hl' : ''} ${v.source === 'simulated' ? 'veh-sim' : ''}">${arrow}<span class="veh-num">${esc(v.line ?? '?')}</span>${f === 'stale' ? '<span class="veh-clock" aria-hidden>⏱</span>' : ''}</div>`;
}

export const stopHtml = (fav: boolean) => `<div class="stop-dot ${fav ? 'fav' : ''}"></div>`;
const initial = (i: 0 | 1, name: string) => (/^person\s*\d/i.test(name.trim()) || !name.trim() ? String(i + 1) : name.trim()[0].toUpperCase());
export const personHtml = (i: 0 | 1, name: string) => `<div class="pin-person p${i + 1}"><span>${esc(initial(i, name))}</span></div>`;
export const destHtml = () => `<div class="pin-dest"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 21V4h11l-2 4 2 4H5" fill="currentColor"/></svg></div>`;
export const meetHtml = () => `<div class="pin-meet"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="8" cy="9" r="3" fill="currentColor"/><circle cx="16" cy="9" r="3" fill="currentColor"/><path d="M2 20a6 6 0 0 1 12 0zM10 20a6 6 0 0 1 12 0z" fill="currentColor"/></svg></div>`;
export const originHtml = () => `<div class="pin-origin"></div>`;
export const pickHtml = () => `<div class="pin-pick"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 22s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg></div>`;
export const liveHtml = (i: 0 | 1, name: string) => `<div class="pin-live p${i + 1}"><span>${esc(initial(i, name))}</span></div>`;
