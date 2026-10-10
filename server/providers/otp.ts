// Riktig drift: OpenTripPlanner 2 (GTFS GraphQL API) byggd på Trafiklabs
// GTFS Regional för UL + OpenStreetMap, med realtid från samma GTFS-källa.

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
} from '../../shared/types';
import { decodePolyline, type Bounds } from '../../shared/geo';
import { tzOffset } from '../../shared/time';
import { delayAtStop, type GtfsRtCache } from '../realtime';
import { finalizeItinerary } from '../../shared/itinerary';
import { selectItineraries } from './demo';
import type { PlanOptions, TransitProvider } from './types';

function isoWithOffset(epoch: number): string {
  const off = tzOffset(epoch);
  const local = new Date(epoch + off).toISOString().slice(0, 19);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off) / 60000;
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const STOP_FIELDS = 'gtfsId name code platformCode lat lon';

const PLAN_QUERY = `
query Plan($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput, $first: Int, $walkSpeed: Speed, $slack: Duration, $window: Duration) {
  planConnection(origin: $origin, destination: $destination, dateTime: $dateTime, first: $first, searchWindow: $window,
    preferences: { street: { walk: { speed: $walkSpeed } }, transit: { transfer: { slack: $slack } } }) {
    edges { node {
      legs {
        mode distance realtimeState serviceDate headsign
        start { scheduledTime estimated { time } }
        end { scheduledTime estimated { time } }
        from { name lat lon stop { ${STOP_FIELDS} } }
        to { name lat lon stop { ${STOP_FIELDS} } }
        route { gtfsId shortName }
        trip { gtfsId tripHeadsign stops { gtfsId } }
        legGeometry { points }
        intermediatePlaces { stop { ${STOP_FIELDS} } arrival { scheduledTime estimated { time } } }
      }
    } }
  }
}`;

interface OtpStop {
  gtfsId: string;
  name: string;
  code?: string;
  platformCode?: string;
  lat: number;
  lon: number;
}
interface OtpTime {
  scheduledTime: string;
  estimated?: { time: string } | null;
}
interface OtpLeg {
  mode: string;
  distance: number;
  realtimeState?: string;
  serviceDate?: string;
  headsign?: string;
  start: OtpTime;
  end: OtpTime;
  from: { name: string; lat: number; lon: number; stop?: OtpStop | null };
  to: { name: string; lat: number; lon: number; stop?: OtpStop | null };
  route?: { gtfsId: string; shortName?: string } | null;
  trip?: { gtfsId: string; tripHeadsign?: string; stops: { gtfsId: string }[] } | null;
  legGeometry?: { points: string } | null;
  intermediatePlaces?: { stop?: OtpStop | null; arrival?: OtpTime | null }[] | null;
}

export class OtpProvider implements TransitProvider {
  readonly demo = false;
  private tripMeta = new Map<string, { line: string; headsign: string; routeId: string }>();

  constructor(
    private url: string,
    private feedId: string,
    private rt?: GtfsRtCache,
  ) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'OTPTimeout': '20000' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`OpenTripPlanner svarade ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`OpenTripPlanner: ${json.errors[0].message}`);
    return json.data as T;
  }

  /** GTFS-RT använder id utan OTP:s feed-prefix. */
  private raw(id: string) {
    return id.startsWith(`${this.feedId}:`) ? id.slice(this.feedId.length + 1) : id;
  }

  private stopRef(s: OtpStop): StopRef {
    return { id: s.gtfsId, name: s.name, lat: s.lat, lng: s.lon, platform: s.platformCode || undefined };
  }

  private alertsFor(routeId: string, stopIds: string[], tripId: string): Alert[] {
    if (!this.rt) return [];
    const r = this.raw(routeId);
    const t = this.raw(tripId);
    const s = new Set(stopIds.map((x) => this.raw(x)));
    return this.rt.alerts.filter((a) => a.routeIds.includes(r) || a.tripIds.includes(t) || a.stopIds.some((x) => s.has(x)));
  }

  /** Lägger på prognos från GTFS-RT om OTP saknar egen realtidsuppdatering. */
  private overlay(tripId: string, serviceDate: string, seq: number | undefined, stopId: string, t: CallTime, kind: 'arrival' | 'departure'): { time: CallTime; state: RtState } {
    if (t.estimated != null || !this.rt) return { time: t, state: t.estimated != null ? 'realtime' : 'scheduled' };
    const tu = this.rt.tripUpdate(this.raw(tripId), serviceDate);
    if (!tu) return { time: t, state: 'scheduled' };
    if (tu.cancelled) return { time: t, state: 'cancelled' };
    const d = delayAtStop(tu, seq, this.raw(stopId), kind);
    return d == null ? { time: t, state: 'scheduled' } : { time: { ...t, estimated: t.scheduled + d * 1000 }, state: 'realtime' };
  }

  private convertLeg(l: OtpLeg, speed: number): Leg {
    const ct = (x: OtpTime): CallTime => ({ scheduled: Date.parse(x.scheduledTime), estimated: x.estimated?.time ? Date.parse(x.estimated.time) : undefined });
    const geometry = l.legGeometry?.points ? decodePolyline(l.legGeometry.points) : [
      { lat: l.from.lat, lng: l.from.lon },
      { lat: l.to.lat, lng: l.to.lon },
    ];
    if (l.mode === 'WALK' || !l.trip || !l.from.stop || !l.to.stop) {
      const start = Date.parse(l.start.scheduledTime);
      const end = Date.parse(l.end.scheduledTime);
      return {
        kind: 'walk',
        from: { name: l.from.stop?.name ?? l.from.name, lat: l.from.lat, lng: l.from.lon },
        to: { name: l.to.stop?.name ?? l.to.name, lat: l.to.lat, lng: l.to.lon },
        start,
        end: Math.max(end, start + Math.round(l.distance / speed) * 1000),
        distance: Math.round(l.distance),
        geometry,
        estimated: false,
      };
    }
    const sd = (l.serviceDate ?? '').replace(/-/g, '');
    const stopIds = l.trip.stops.map((s) => s.gtfsId);
    const boardIdx = stopIds.indexOf(l.from.stop.gtfsId);
    const alightIdx = stopIds.indexOf(l.to.stop.gtfsId, boardIdx + 1);
    const boardSeq = boardIdx + 1;
    const alightSeq = alightIdx + 1;
    const dep = this.overlay(l.trip.gtfsId, sd, undefined, l.from.stop.gtfsId, ct(l.start), 'departure');
    const arr = this.overlay(l.trip.gtfsId, sd, undefined, l.to.stop.gtfsId, ct(l.end), 'arrival');
    const state: RtState =
      l.realtimeState === 'CANCELED' || dep.state === 'cancelled'
        ? 'cancelled'
        : dep.state === 'realtime' || arr.state === 'realtime'
          ? 'realtime'
          : 'scheduled';
    const routeId = l.route?.gtfsId ?? '';
    const line = l.route?.shortName ?? '';
    const headsign = l.trip.tripHeadsign ?? l.headsign ?? '';
    this.tripMeta.set(l.trip.gtfsId, { line, headsign, routeId });
    const leg: TransitLeg = {
      kind: 'transit',
      tripId: l.trip.gtfsId,
      serviceDate: sd,
      routeId,
      line,
      mode: l.mode === 'RAIL' ? 'train' : l.mode === 'TRAM' ? 'tram' : 'bus',
      headsign,
      from: this.stopRef(l.from.stop),
      to: this.stopRef(l.to.stop),
      dep: dep.time,
      arr: arr.time,
      boardSeq,
      alightSeq,
      intermediate: (l.intermediatePlaces ?? [])
        .filter((p) => p.stop && p.arrival)
        .map((p) => ({ stop: this.stopRef(p.stop!), time: this.overlay(l.trip!.gtfsId, sd, undefined, p.stop!.gtfsId, ct(p.arrival!), 'arrival').time })),
      geometry,
      rt: state,
      alerts: this.alertsFor(routeId, [l.from.stop.gtfsId, l.to.stop.gtfsId], l.trip.gtfsId),
    };
    return leg;
  }

  async plan(from: Place, to: Place, time: TimeQuery, prefs: Prefs, opts: PlanOptions & { raw?: boolean }): Promise<Itinerary[]> {
    this.rt?.touch();
    const at = time.mode === 'now' ? Date.now() : time.at;
    const loc = (p: Place) => ({ label: p.name, location: { coordinate: { latitude: p.lat, longitude: p.lng } } });
    const first = opts.raw ? 20 : Math.max(opts.max, 5);
    const data = await this.gql<{ planConnection: { edges: { node: { legs: OtpLeg[] } }[] } }>(PLAN_QUERY, {
      origin: loc(from),
      destination: loc(to),
      dateTime: time.mode === 'arrive' ? { latestArrival: isoWithOffset(at) } : { earliestDeparture: isoWithOffset(at) },
      first,
      walkSpeed: prefs.walkSpeed,
      slack: `PT${Math.round(prefs.minTransfer)}M`,
      window: `PT${opts.windowMin ?? 90}M`,
    });
    const its = data.planConnection.edges.map((e) =>
      finalizeItinerary(
        e.node.legs.map((l) => this.convertLeg(l, prefs.walkSpeed)),
        false,
        prefs.minTransfer,
      ),
    );
    return selectItineraries(its, time.mode === 'arrive', prefs, opts.raw ? 60 : opts.max, false);
  }

  async stops(b: Bounds): Promise<StopRef[]> {
    const d = await this.gql<{ stopsByBbox: OtpStop[] }>(`query($a:Float!,$b:Float!,$c:Float!,$d:Float!){ stopsByBbox(minLat:$a,minLon:$b,maxLat:$c,maxLon:$d){ ${STOP_FIELDS} } }`, { a: b.south, b: b.west, c: b.north, d: b.east });
    return d.stopsByBbox.slice(0, 400).map((s) => this.stopRef(s));
  }

  async nearbyStops(p: LatLng, radius: number): Promise<StopRef[]> {
    const d = await this.gql<{ stopsByRadius: { edges: { node: { stop: OtpStop } }[] } }>(
      `query($lat:Float!,$lon:Float!,$r:Int!){ stopsByRadius(lat:$lat,lon:$lon,radius:$r,first:20){ edges { node { stop { ${STOP_FIELDS} } } } } }`,
      { lat: p.lat, lon: p.lng, r: Math.round(radius) },
    );
    return d.stopsByRadius.edges.map((e) => this.stopRef(e.node.stop));
  }

  async searchStops(q: string): Promise<StopRef[]> {
    const d = await this.gql<{ stops: OtpStop[] }>(`query($q:String!){ stops(name:$q){ ${STOP_FIELDS} } }`, { q });
    const seen = new Set<string>();
    return d.stops.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true))).slice(0, 8).map((s) => this.stopRef(s));
  }

  async departures(stopId: string, from: number, limit: number, until?: number): Promise<Departure[]> {
    this.rt?.touch();
    const range = Math.round(((until ?? from + 4 * 3600_000) - from) / 1000);
    const d = await this.gql<{ stop: { gtfsId: string; name: string; lat: number; lon: number; platformCode?: string; stoptimesWithoutPatterns: { scheduledDeparture: number; realtimeDeparture: number; realtime: boolean; realtimeState: string; serviceDay: number; headsign?: string; stopPosition?: number; trip: { gtfsId: string; route: { gtfsId: string; shortName: string } } }[] } | null }>(
      `query($id:String!,$s:Long!,$r:Int!,$n:Int!){ stop(id:$id){ gtfsId name lat lon platformCode stoptimesWithoutPatterns(startTime:$s,timeRange:$r,numberOfDepartures:$n,omitNonPickups:true){ scheduledDeparture realtimeDeparture realtime realtimeState serviceDay headsign stopPosition trip { gtfsId route { gtfsId shortName } } } } }`,
      { id: stopId, s: Math.floor(from / 1000), r: range, n: limit },
    );
    if (!d.stop) return [];
    const stop: StopRef = { id: d.stop.gtfsId, name: d.stop.name, lat: d.stop.lat, lng: d.stop.lon, platform: d.stop.platformCode || undefined };
    return d.stop.stoptimesWithoutPatterns.map((st) => {
      const sdEpoch = st.serviceDay * 1000;
      const sd = new Date(sdEpoch + tzOffset(sdEpoch) + 12 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
      let time: CallTime = { scheduled: sdEpoch + st.scheduledDeparture * 1000, estimated: st.realtime ? sdEpoch + st.realtimeDeparture * 1000 : undefined };
      let state: RtState = st.realtimeState === 'CANCELED' ? 'cancelled' : st.realtime ? 'realtime' : 'scheduled';
      if (state === 'scheduled') {
        const o = this.overlay(st.trip.gtfsId, sd, st.stopPosition, d.stop!.gtfsId, time, 'departure');
        time = o.time;
        state = o.state;
      }
      return { tripId: st.trip.gtfsId, serviceDate: sd, line: st.trip.route.shortName, routeId: st.trip.route.gtfsId, headsign: st.headsign ?? '', stop, time, rt: state };
    });
  }

  async trip(tripId: string, serviceDate: string): Promise<TripDetail | null> {
    const d = await this.gql<{ trip: { gtfsId: string; tripHeadsign?: string; route: { shortName: string; gtfsId: string }; stoptimesForDate: { stop: OtpStop; scheduledArrival: number; realtimeArrival: number; realtime: boolean; realtimeState: string; serviceDay: number; stopPosition?: number }[] } | null }>(
      `query($id:String!,$d:String!){ trip(id:$id){ gtfsId tripHeadsign route { shortName gtfsId } stoptimesForDate(serviceDate:$d){ stop { ${STOP_FIELDS} } scheduledArrival realtimeArrival realtime realtimeState serviceDay stopPosition } } }`,
      { id: tripId, d: serviceDate },
    );
    if (!d.trip) return null;
    let rtState: RtState = 'scheduled';
    const stops = d.trip.stoptimesForDate.map((st, i) => {
      const base = st.serviceDay * 1000;
      let time: CallTime = { scheduled: base + st.scheduledArrival * 1000, estimated: st.realtime ? base + st.realtimeArrival * 1000 : undefined };
      if (st.realtimeState === 'CANCELED') rtState = 'cancelled';
      else if (st.realtime) rtState = 'realtime';
      else {
        const o = this.overlay(tripId, serviceDate, i + 1, st.stop.gtfsId, time, 'arrival');
        time = o.time;
        if (o.state !== 'scheduled') rtState = o.state;
      }
      return { stop: this.stopRef(st.stop), time, seq: i + 1 };
    });
    this.tripMeta.set(tripId, { line: d.trip.route.shortName, headsign: d.trip.tripHeadsign ?? '', routeId: d.trip.route.gtfsId });
    return { tripId, serviceDate, line: d.trip.route.shortName, headsign: d.trip.tripHeadsign ?? '', rt: rtState, stops };
  }

  /** Hämtar linje och destination för turer som saknas i cachen, i omgångar om 50. */
  private async enrich(tripIds: string[]) {
    const missing = [...new Set(tripIds)].filter((id) => !this.tripMeta.has(id)).slice(0, 300);
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const q = `query { ${chunk.map((id, j) => `t${j}: trip(id: ${JSON.stringify(id)}) { gtfsId tripHeadsign route { gtfsId shortName } }`).join('\n')} }`;
      try {
        const d = await this.gql<Record<string, { gtfsId: string; tripHeadsign?: string; route: { gtfsId: string; shortName: string } } | null>>(q);
        for (const t of Object.values(d)) if (t) this.tripMeta.set(t.gtfsId, { line: t.route.shortName, headsign: t.tripHeadsign ?? '', routeId: t.route.gtfsId });
      } catch {
        /* Fordon visas ändå, men utan linjenummer. */
      }
    }
  }

  async vehicles(): Promise<Vehicle[]> {
    if (!this.rt) return [];
    this.rt.touch();
    const raw = this.rt.vehicles;
    const ids = raw.filter((v) => v.tripId).map((v) => `${this.feedId}:${v.tripId}`);
    await this.enrich(ids);
    return raw.map((v) => {
      const tripId = v.tripId ? `${this.feedId}:${v.tripId}` : undefined;
      const meta = tripId ? this.tripMeta.get(tripId) : undefined;
      // Försening kopplas bara via tur-id + trafikdag, aldrig via linjenummer.
      const tu = v.tripId && v.startDate ? this.rt!.tripUpdate(v.tripId, v.startDate) : undefined;
      const delay = tu ? delayAtStop(tu, v.currentStopSequence, v.stopId, 'arrival') : undefined;
      return {
        id: v.id,
        lat: v.lat,
        lng: v.lng,
        bearing: v.bearing,
        timestamp: v.timestamp,
        tripId,
        serviceDate: v.startDate,
        routeId: meta?.routeId ?? (v.routeId ? `${this.feedId}:${v.routeId}` : undefined),
        line: meta?.line,
        headsign: meta?.headsign,
        delay,
        source: 'gps' as const,
      };
    });
  }

  async alerts(): Promise<Alert[]> {
    this.rt?.touch();
    return (this.rt?.alerts ?? []).map((a) => ({
      ...a,
      routeIds: a.routeIds.map((r) => `${this.feedId}:${r}`),
      stopIds: a.stopIds.map((s) => `${this.feedId}:${s}`),
      tripIds: a.tripIds.map((t) => `${this.feedId}:${t}`),
    }));
  }
}
