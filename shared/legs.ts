import type { CallTime, Leg, TransitLeg } from './types';

export const effTime = (c: CallTime) => c.estimated ?? c.scheduled;

export function legStart(l: Leg): number {
  return l.kind === 'transit' ? effTime(l.dep) : l.start;
}

export function legEnd(l: Leg): number {
  return l.kind === 'transit' ? effTime(l.arr) : l.end;
}

export function transitLegs(legs: Leg[]): TransitLeg[] {
  return legs.filter((l): l is TransitLeg => l.kind === 'transit');
}

/** Två resdelar avser samma fordonstur endast om tur-id OCH trafikdag stämmer. */
export function sameTrip(a: Pick<TransitLeg, 'tripId' | 'serviceDate'>, b: Pick<TransitLeg, 'tripId' | 'serviceDate'>): boolean {
  return a.tripId === b.tripId && a.serviceDate === b.serviceDate;
}
