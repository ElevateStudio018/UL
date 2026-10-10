// Tidshantering i Europe/Stockholm, inklusive sommartid och trafikdygn över midnatt.

export const TZ = 'Europe/Stockholm';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(epoch: number): ZonedParts {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(new Date(epoch))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
}

/** Skillnad mellan lokal tid i Stockholm och UTC, i ms, vid en viss tidpunkt. */
export function tzOffset(epoch: number): number {
  const z = zonedParts(epoch);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/** Lokal väggklocketid i Stockholm → epoch ms. */
export function zonedToEpoch(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = naive - tzOffset(naive);
  guess = naive - tzOffset(guess);
  return guess;
}

export function serviceDateOf(epoch: number): string {
  const z = zonedParts(epoch);
  return `${z.year}${String(z.month).padStart(2, '0')}${String(z.day).padStart(2, '0')}`;
}

export function parseServiceDate(sd: string): { year: number; month: number; day: number } {
  return { year: Number(sd.slice(0, 4)), month: Number(sd.slice(4, 6)), day: Number(sd.slice(6, 8)) };
}

export function addDays(sd: string, n: number): string {
  const { year, month, day } = parseServiceDate(sd);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * GTFS-tider räknas från "middag minus 12 timmar" på trafikdagen. Det är midnatt
 * utom de dygn då sommartid börjar eller slutar, och tider som 25:10:00 hör till
 * föregående trafikdag.
 */
export function serviceDayStart(sd: string): number {
  const { year, month, day } = parseServiceDate(sd);
  return zonedToEpoch(year, month, day, 12, 0, 0) - 12 * 3600_000;
}

export function gtfsTimeToEpoch(sd: string, secondsSinceStart: number): number {
  return serviceDayStart(sd) + secondsSinceStart * 1000;
}

const hmFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });

export function fmtTime(epoch: number): string {
  return hmFmt.format(new Date(epoch));
}

export function fmtDay(epoch: number): string {
  return dayFmt.format(new Date(epoch));
}

export function fmtDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function minutes(ms: number): number {
  return Math.round(ms / 60000);
}

/** "YYYY-MM-DD" och "HH:MM" tolkade som Stockholmstid. */
export function localInputToEpoch(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToEpoch(y, mo, d, h, mi);
}

export function epochToLocalInputs(epoch: number): { date: string; time: string } {
  const z = zonedParts(epoch);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${z.year}-${pad(z.month)}-${pad(z.day)}`, time: `${pad(z.hour)}:${pad(z.minute)}` };
}
