// Demomotor: genererar tidtabeller och simulerad realtid för ett förenklat
// Uppsalanät. Allt som returneras härifrån är märkt som demodata.

import type {
  Alert,
  CallTime,
  Departure,
  Itinerary,
  LatLng,
  Leg,
  Place,
  Prefs,
  RtState,
  StopRef,
  TimeQuery,
  TransitLeg,
  TripDetail,
  Vehicle,
  WalkLeg,
} from '../../shared/types';
import { bearing, haversine, inBounds, lerp, type Bounds } from '../../shared/geo';
import { addDays, gtfsTimeToEpoch, serviceDateOf } from '../../shared/time';
import { DEMO_LINES, DEMO_STOPS, type DemoLine, type DemoStop } from './demoNetwork';
import type { PlanOptions, TransitProvider } from './types';
import { finalizeItinerary, hashString } from '../../shared/itinerary';

/** Faktor för uppskattad gångväg jämfört med fågelvägen (demoläge saknar gångvägnät). */
export const WALK_DETOUR = 1.3;

interface DemoCall {
  stopId: string;
  t: number;
  seq: number;
}

interface DemoTrip {
  tripId: string;
  serviceDate: string;
  line: DemoLine;
  dir: 0 | 1;
  calls: DemoCall[];
  headsign: string;
}

interface StopEvent {
  trip: DemoTrip;
  idx: number;
  t: number;
}

const stopById = new Map(DEMO_STOPS.map((st) => [st.id, st]));

function toRef(st: DemoStop): StopRef {
  return { id: st.id, name: st.name, lat: st.lat, lng: st.lng, platform: st.platform };
}

function headwayAt(line: DemoLine, sec: number): number {
  const h = sec / 3600;
  if (h >= 6 && h < 19) return line.headway[0];
  if (h >= 19 && h < 22) return line.headway[1];
  return line.headway[2];
}

function segmentSeconds(a: DemoStop, b: DemoStop, speedKmh: number): number {
  const d = haversine(a, b) * 1.35;
  const sec = d / ((speedKmh * 1000) / 3600) + 40;
  return Math.max(60, Math.round(sec / 60) * 60);
}

/** Simulerad realtid. Deterministisk per tur och trafikdag. */
export function demoRealtime(trip: { tripId: string; serviceDate: string; start: number; end: number }, now: number): { state: RtState; delay: number } {
  const h = hashString(`${trip.tripId}|${trip.serviceDate}`);
  if (h % 41 === 0 && trip.start > now - 3600_000 && trip.start < now + 2 * 3600_000) return { state: 'cancelled', delay: 0 };
  const near = trip.start - now < 40 * 60_000 && trip.end > now - 5 * 60_000;
  if (!near || h % 9 === 0) return { state: 'scheduled', delay: 0 };
  let delay = ((h >>> 4) % 5) * 60;
  if (h % 7 === 0) delay += 4 * 60;
  return { state: 'realtime', delay };
}

export class DemoProvider implements TransitProvider {
  readonly demo = true;
  private tripCache = new Map<string, DemoTrip[]>();
  private eventCache = new Map<string, Map<string, StopEvent[]>>();

  private tripsFor(sd: string): DemoTrip[] {
    let trips = this.tripCache.get(sd);
    if (trips) return trips;
    trips = [];
    for (const line of DEMO_LINES) {
      for (const dir of [0, 1] as const) {
        const ids = dir === 0 ? line.stops : [...line.stops].reverse();
        const stops = ids.map((id) => stopById.get(id)!);
        const offsets = [0];
        for (let i = 1; i < stops.length; i++) offsets.push(offsets[i - 1] + segmentSeconds(stops[i - 1], stops[i], line.speedKmh));
        // Första tur 05:30, sista tur 24:30 (trafikdygnet går över midnatt).
        let sec = 5.5 * 3600 + line.offset * 60 + dir * 120;
        while (sec <= 24.5 * 3600) {
          const hhmm = `${String(Math.floor(sec / 3600)).padStart(2, '0')}${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
          trips.push({
            tripId: `demo:${line.line}:${dir}:${hhmm}`,
            serviceDate: sd,
            line,
            dir,
            headsign: stops[stops.length - 1].name,
            calls: stops.map((st, i) => ({ stopId: st.id, t: gtfsTimeToEpoch(sd, sec + offsets[i]), seq: i + 1 })),
          });
          sec += headwayAt(line, sec) * 60;
        }
      }
    }
    if (this.tripCache.size > 6) this.tripCache.clear();
    this.tripCache.set(sd, trips);
    return trips;
  }

  private eventsFor(sd: string): Map<string, StopEvent[]> {
    let m = this.eventCache.get(sd);
    if (m) return m;
    m = new Map();
    for (const trip of this.tripsFor(sd)) {
      trip.calls.forEach((c, idx) => {
        let arr = m!.get(c.stopId);
        if (!arr) m!.set(c.stopId, (arr = []));
        arr.push({ trip, idx, t: c.t });
      });
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    if (this.eventCache.size > 6) this.eventCache.clear();
    this.eventCache.set(sd, m);
    return m;
  }

  /** Händelser vid en hållplats inom [from, to], över flera trafikdygn. */
  private eventsAt(stopId: string, from: number, to: number): StopEvent[] {
    const out: StopEvent[] = [];
    const sd0 = serviceDateOf(from);
    for (const sd of [addDays(sd0, -1), sd0, addDays(sd0, 1)]) {
      for (const e of this.eventsFor(sd).get(stopId) ?? []) if (e.t >= from && e.t <= to) out.push(e);
    }
    return out.sort((a, b) => a.t - b.t);
  }

  private rt(trip: DemoTrip, now = Date.now()) {
    return demoRealtime({ tripId: trip.tripId, serviceDate: trip.serviceDate, start: trip.calls[0].t, end: trip.calls[trip.calls.length - 1].t }, now);
  }

  private callTime(trip: DemoTrip, idx: number, rt: { state: RtState; delay: number }): CallTime {
    const scheduled = trip.calls[idx].t;
    return rt.state === 'realtime' ? { scheduled, estimated: scheduled + rt.delay * 1000 } : { scheduled };
  }

  private routeAlerts(routeId: string): Alert[] {
    return DEMO_ALERTS.filter((a) => a.routeIds.includes(routeId));
  }

  private transitLeg(trip: DemoTrip, from: number, to: number): TransitLeg {
    const rt = this.rt(trip);
    const stops = trip.calls.map((c) => toRef(stopById.get(c.stopId)!));
    return {
      kind: 'transit',
      tripId: trip.tripId,
      serviceDate: trip.serviceDate,
      routeId: trip.line.routeId,
      line: trip.line.line,
      mode: 'bus',
      headsign: trip.headsign,
      from: stops[from],
      to: stops[to],
      dep: this.callTime(trip, from, rt),
      arr: this.callTime(trip, to, rt),
      boardSeq: trip.calls[from].seq,
      alightSeq: trip.calls[to].seq,
      intermediate: stops.slice(from + 1, to).map((stop, i) => ({ stop, time: this.callTime(trip, from + 1 + i, rt) })),
      geometry: stops.slice(from, to + 1).map((st) => ({ lat: st.lat, lng: st.lng })),
      rt: rt.state,
      alerts: this.routeAlerts(trip.line.routeId),
    };
  }

  private walk(from: { name: string } & LatLng, to: { name: string } & LatLng, start: number, speed: number): WalkLeg {
    const distance = Math.round(haversine(from, to) * WALK_DETOUR);
    const dur = Math.round(distance / speed) * 1000;
    return { kind: 'walk', from, to, start, end: start + dur, distance, geometry: [from, to], estimated: true };
  }

  private accessStops(p: Place, speed: number): { stop: DemoStop; walkMs: number; dist: number }[] {
    const all = DEMO_STOPS.map((stop) => {
      const dist = p.stopId === stop.id ? 0 : haversine(p, stop) * WALK_DETOUR;
      return { stop, dist, walkMs: Math.round(dist / speed) * 1000 };
    }).sort((a, b) => a.dist - b.dist);
    const near = all.filter((a) => a.dist <= 1300).slice(0, 6);
    return near.length >= 2 ? near : all.filter((a) => a.dist <= 4000).slice(0, 3);
  }

  async plan(from: Place, to: Place, time: TimeQuery, prefs: Prefs, opts: PlanOptions & { raw?: boolean }): Promise<Itinerary[]> {
    const speed = prefs.walkSpeed;
    const margin = prefs.minTransfer * 60_000;
    const window = (opts.windowMin ?? 90) * 60_000;
    const arriveBy = time.mode === 'arrive';
    const t = time.mode === 'now' ? Date.now() : time.at;
    const lo = arriveBy ? t - window - 60 * 60_000 : t;
    const hi = arriveBy ? t : t + window;

    const access = this.accessStops(from, speed);
    const egress = new Map(this.accessStops(to, speed).map((e) => [e.stop.id, e]));
    const fromPt = { name: from.name, lat: from.lat, lng: from.lng };
    const toPt = { name: to.name, lat: to.lat, lng: to.lng };
    const results: Itinerary[] = [];

    const finish = (legs: Leg[]) => {
      const it = finalizeItinerary(legs, true, prefs.minTransfer);
      if (arriveBy ? it.end <= t && it.start >= lo : it.start >= t - 30_000 && it.start <= hi) results.push(it);
    };

    const egressWalk = (trip: DemoTrip, k: number, arrival: number): WalkLeg => {
      const st = stopById.get(trip.calls[k].stopId)!;
      return this.walk({ name: st.name, lat: st.lat, lng: st.lng }, toPt, arrival, speed);
    };

    // Promenad hela vägen när det är nära.
    const direct = haversine(from, to);
    if (direct <= 2200) {
      const dur = Math.round((direct * WALK_DETOUR) / speed) * 1000;
      const start = arriveBy ? t - dur : t;
      finish([this.walk(fromPt, toPt, start, speed)]);
    }

    for (const a of access) {
      const events = this.eventsAt(a.stop.id, lo + a.walkMs, hi);
      for (const e of events) {
        const trip = e.trip;
        if (e.idx >= trip.calls.length - 1) continue;
        const accessWalk = (dep: number) => this.walk(fromPt, { name: a.stop.name, lat: a.stop.lat, lng: a.stop.lng }, dep - a.walkMs, speed);
        // Direktresa.
        for (let k = e.idx + 1; k < trip.calls.length; k++) {
          if (egress.has(trip.calls[k].stopId)) {
            const leg = this.transitLeg(trip, e.idx, k);
            finish([accessWalk(leg.dep.scheduled), leg, egressWalk(trip, k, leg.arr.scheduled)]);
          }
        }
        // Ett byte.
        for (let k = e.idx + 1; k < trip.calls.length; k++) {
          const x = stopById.get(trip.calls[k].stopId)!;
          if (egress.has(x.id) && egress.get(x.id)!.dist < 400) continue;
          for (const y of DEMO_STOPS) {
            const d = y.id === x.id ? 0 : haversine(x, y) * WALK_DETOUR;
            if (d > 350) continue;
            const walkMs = Math.round(d / speed) * 1000;
            const earliest = trip.calls[k].t + walkMs + margin;
            const seenLines = new Set<string>();
            for (const e2 of this.eventsAt(y.id, earliest, Math.min(earliest + 30 * 60_000, hi))) {
              const t2 = e2.trip;
              if (t2.line.routeId === trip.line.routeId || seenLines.has(t2.line.routeId)) continue;
              if (e2.idx >= t2.calls.length - 1) continue;
              let used = false;
              for (let m = e2.idx + 1; m < t2.calls.length; m++) {
                if (!egress.has(t2.calls[m].stopId)) continue;
                used = true;
                const l1 = this.transitLeg(trip, e.idx, k);
                const l2 = this.transitLeg(t2, e2.idx, m);
                const legs: Leg[] = [accessWalk(l1.dep.scheduled), l1];
                if (walkMs > 0) legs.push(this.walk({ name: x.name, lat: x.lat, lng: x.lng }, { name: y.name, lat: y.lat, lng: y.lng }, l1.arr.scheduled, speed));
                legs.push(l2, egressWalk(t2, m, l2.arr.scheduled));
                finish(legs);
              }
              if (used) seenLines.add(t2.line.routeId);
            }
          }
        }
      }
    }

    return selectItineraries(results, arriveBy, prefs, opts.raw ? 400 : opts.max, !opts.raw);
  }

  async stops(bounds: Bounds): Promise<StopRef[]> {
    return DEMO_STOPS.filter((st) => inBounds(st, bounds)).map(toRef);
  }

  async nearbyStops(p: LatLng, radius: number): Promise<StopRef[]> {
    return DEMO_STOPS.filter((st) => haversine(p, st) <= radius)
      .sort((a, b) => haversine(p, a) - haversine(p, b))
      .map(toRef);
  }

  async searchStops(q: string): Promise<StopRef[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const seen = new Set<string>();
    return DEMO_STOPS.filter((st) => st.name.toLowerCase().includes(needle))
      .filter((st) => (seen.has(st.name) ? false : (seen.add(st.name), true)))
      .map(toRef);
  }

  async departures(stopId: string, from: number, limit: number, until?: number): Promise<Departure[]> {
    // Centralstationens lägen visas tillsammans.
    const st = stopById.get(stopId);
    const ids = st ? DEMO_STOPS.filter((o) => o.name === st.name).map((o) => o.id) : [stopId];
    const out: Departure[] = [];
    for (const id of ids) {
      for (const e of this.eventsAt(id, from - 15 * 60_000, until ?? from + 4 * 3600_000)) {
        if (e.idx >= e.trip.calls.length - 1) continue;
        const rt = this.rt(e.trip);
        const time = this.callTime(e.trip, e.idx, rt);
        if ((time.estimated ?? time.scheduled) < from) continue;
        out.push({
          tripId: e.trip.tripId,
          serviceDate: e.trip.serviceDate,
          line: e.trip.line.line,
          routeId: e.trip.line.routeId,
          headsign: e.trip.headsign,
          stop: toRef(stopById.get(id)!),
          time,
          rt: rt.state,
        });
      }
    }
    return out.sort((a, b) => (a.time.estimated ?? a.time.scheduled) - (b.time.estimated ?? b.time.scheduled)).slice(0, limit);
  }

  async trip(tripId: string, serviceDate: string): Promise<TripDetail | null> {
    const trip = this.tripsFor(serviceDate).find((tr) => tr.tripId === tripId);
    if (!trip) return null;
    const rt = this.rt(trip);
    return {
      tripId,
      serviceDate,
      line: trip.line.line,
      headsign: trip.headsign,
      rt: rt.state,
      stops: trip.calls.map((c, i) => ({ stop: toRef(stopById.get(c.stopId)!), time: this.callTime(trip, i, rt), seq: c.seq })),
    };
  }

  async vehicles(): Promise<Vehicle[]> {
    const now = Math.floor(Date.now() / 5000) * 5000;
    const out: Vehicle[] = [];
    const sd = serviceDateOf(now);
    for (const day of [addDays(sd, -1), sd]) {
      for (const trip of this.tripsFor(day)) {
        const rt = this.rt(trip, now);
        if (rt.state !== 'realtime') continue; // Ingen realtid → ingen position.
        const h = hashString(trip.tripId + trip.serviceDate);
        const stale = h % 11 === 0;
        const ts = stale ? now - (150 + (h % 200)) * 1000 : now - (h % 20) * 1000;
        const at = ts - rt.delay * 1000;
        const calls = trip.calls;
        if (at < calls[0].t || at > calls[calls.length - 1].t) continue;
        let i = 0;
        while (i < calls.length - 2 && calls[i + 1].t <= at) i++;
        const a = stopById.get(calls[i].stopId)!;
        const b = stopById.get(calls[i + 1].stopId)!;
        const frac = Math.min(1, Math.max(0, (at - calls[i].t) / (calls[i + 1].t - calls[i].t)));
        const pos = lerp(a, b, frac);
        out.push({
          id: `demo-veh-${h % 9000}`,
          ...pos,
          tripId: trip.tripId,
          serviceDate: trip.serviceDate,
          routeId: trip.line.routeId,
          line: trip.line.line,
          headsign: trip.headsign,
          bearing: bearing(a, b),
          timestamp: ts,
          nextStop: b.name,
          delay: rt.delay,
          source: 'simulated',
        });
      }
    }
    return out;
  }

  async alerts(): Promise<Alert[]> {
    return DEMO_ALERTS;
  }
}

const DEMO_ALERTS: Alert[] = [
  {
    id: 'demo-alert-1',
    header: 'Demo: Linje 5 – omledning vid Boländerna',
    description: 'Exempel på trafikstörning. Bussarna stannar vid tillfällig hållplats på Bolandsgatan på grund av vägarbete.',
    severity: 'warning',
    routeIds: ['demo:r5'],
    stopIds: ['demo:bolanderna'],
    tripIds: [],
    demo: true,
  },
];

/** Tar bort dubbletter och dominerade resor, sorterar efter relevans. */
export function selectItineraries(all: Itinerary[], arriveBy: boolean, prefs: Prefs, max: number, pareto: boolean): Itinerary[] {
  const byKey = new Map<string, Itinerary>();
  for (const it of all) if (!byKey.has(it.id)) byKey.set(it.id, it);
  let list = [...byKey.values()];
  const walkW = prefs.preference === 'lessWalking' ? 2.5 : 1.2;
  const xferW = prefs.preference === 'fewTransfers' ? 12 : 5;
  const cost = (it: Itinerary) => (it.end - it.start) / 60000 + it.transfers * xferW + (it.walkDuration / 60000) * (walkW - 1) + (it.warnings.some((w) => w.kind === 'cancelled') ? 60 : 0);
  if (pareto) {
    list = list.filter(
      (a) =>
        !list.some(
          (b) =>
            b !== a &&
            b.start >= a.start &&
            b.end <= a.end &&
            b.transfers <= a.transfers &&
            b.walkDistance <= a.walkDistance + 80 &&
            (b.start > a.start || b.end < a.end || b.transfers < a.transfers || b.walkDistance < a.walkDistance) &&
            !b.warnings.some((w) => w.kind === 'cancelled'),
        ),
    );
    // Bland resor med samma avresetid behålls den med lägst kostnad.
    const best = new Map<number, Itinerary>();
    for (const it of list) {
      const k = it.legs.find((l) => l.kind === 'transit') ? it.start : -1;
      const cur = best.get(k);
      if (!cur || cost(it) < cost(cur)) best.set(k, it);
    }
    list = [...best.values()];
  }
  list.sort((a, b) => (arriveBy ? b.start - a.start || cost(a) - cost(b) : a.end - b.end || cost(a) - cost(b)));
  return list.slice(0, max);
}
