import type { Itinerary, Leg, TransitLeg } from '../../shared/types';
import { finalizeItinerary } from '../../shared/itinerary';
import { api } from './api';

/** Hämtar aktuell realtid för resans turer och räknar om varningar (inställt, missat byte). */
export async function refreshItinerary(it: Itinerary, minTransfer: number): Promise<Itinerary> {
  const legs: Leg[] = await Promise.all(
    it.legs.map(async (l) => {
      if (l.kind !== 'transit') return l;
      try {
        const { trip } = await api.trip(l.tripId, l.serviceDate);
        const bySeq = new Map(trip.stops.map((s) => [s.seq, s]));
        const byId = new Map(trip.stops.map((s) => [s.stop.id, s]));
        const pick = (seq: number, id: string) => bySeq.get(seq)?.stop.id === id ? bySeq.get(seq) : byId.get(id);
        const from = pick(l.boardSeq, l.from.id);
        const to = pick(l.alightSeq, l.to.id);
        const next: TransitLeg = {
          ...l,
          rt: trip.rt,
          dep: from ? { scheduled: l.dep.scheduled, estimated: trip.rt === 'realtime' ? from.time.estimated : undefined } : l.dep,
          arr: to ? { scheduled: l.arr.scheduled, estimated: trip.rt === 'realtime' ? to.time.estimated : undefined } : l.arr,
          intermediate: l.intermediate.map((s) => {
            const x = byId.get(s.stop.id);
            return x ? { stop: s.stop, time: { scheduled: s.time.scheduled, estimated: trip.rt === 'realtime' ? x.time.estimated : undefined } } : s;
          }),
        };
        return next;
      } catch {
        return l;
      }
    }),
  );
  const fresh = finalizeItinerary(legs, it.demo, minTransfer);
  return { ...fresh, id: it.id };
}
