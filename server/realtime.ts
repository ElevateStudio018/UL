// Gemensam cache för GTFS-Realtime från Trafiklab (GTFS Regional, operatör UL).
// Flödena hämtas en gång per intervall för alla användare och bara när någon
// faktiskt använder appen, för att hålla nere antalet anrop mot kvoten.

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { Alert } from '../shared/types';

const rt = GtfsRealtimeBindings.transit_realtime;

export interface RawVehicle {
  id: string;
  tripId?: string;
  startDate?: string;
  routeId?: string;
  lat: number;
  lng: number;
  bearing?: number;
  timestamp: number;
  stopId?: string;
  currentStopSequence?: number;
}

export interface StopUpdate {
  stopSequence?: number;
  stopId?: string;
  arrivalDelay?: number;
  departureDelay?: number;
  arrivalTime?: number;
  departureTime?: number;
  skipped: boolean;
}

export interface TripUpdateInfo {
  tripId: string;
  startDate?: string;
  cancelled: boolean;
  delay?: number;
  updates: StopUpdate[];
  timestamp: number;
}

const toNum = (v: unknown): number | undefined => (v == null ? undefined : typeof v === 'number' ? v : Number(v));

export class GtfsRtCache {
  vehicles: RawVehicle[] = [];
  tripUpdates = new Map<string, TripUpdateInfo>();
  alerts: Alert[] = [];
  fetchedAt?: number;
  error?: string;
  private lastDemand = 0;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private key: string,
    private operator = 'ul',
    private intervals = { vehicles: 15_000, trips: 30_000, alerts: 60_000 },
  ) {}

  /** Anropas vid varje klientförfrågan; flödena pausas efter två minuter utan användning. */
  touch() {
    const idle = Date.now() - this.lastDemand > 120_000;
    this.lastDemand = Date.now();
    if (idle || !this.timers.length) this.start();
  }

  private url(feed: string) {
    return `https://opendata.samtrafiken.se/gtfs-rt/${this.operator}/${feed}.pb?key=${encodeURIComponent(this.key)}`;
  }

  private async fetchFeed(feed: string) {
    const res = await fetch(this.url(feed), { headers: { 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${feed}: HTTP ${res.status}`);
    return rt.FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
  }

  private loop(name: string, ms: number, fn: () => Promise<void>) {
    const tick = async () => {
      if (Date.now() - this.lastDemand > 120_000) {
        this.stop();
        return;
      }
      try {
        await fn();
        this.error = undefined;
      } catch (e) {
        this.error = `Kunde inte hämta ${name}: ${(e as Error).message}`;
      }
    };
    void tick();
    this.timers.push(setInterval(tick, ms));
  }

  start() {
    this.stop();
    this.loop('fordonspositioner', this.intervals.vehicles, async () => {
      const msg = await this.fetchFeed('VehiclePositions');
      const out: RawVehicle[] = [];
      for (const e of msg.entity) {
        const v = e.vehicle;
        if (!v?.position) continue;
        out.push({
          id: v.vehicle?.id || e.id,
          tripId: v.trip?.tripId || undefined,
          startDate: v.trip?.startDate || undefined,
          routeId: v.trip?.routeId || undefined,
          lat: v.position.latitude,
          lng: v.position.longitude,
          bearing: v.position.bearing ?? undefined,
          timestamp: (toNum(v.timestamp) ?? toNum(msg.header.timestamp) ?? Date.now() / 1000) * 1000,
          stopId: v.stopId || undefined,
          currentStopSequence: v.currentStopSequence ?? undefined,
        });
      }
      this.vehicles = out;
      this.fetchedAt = Date.now();
    });
    this.loop('turuppdateringar', this.intervals.trips, async () => {
      const msg = await this.fetchFeed('TripUpdates');
      const map = new Map<string, TripUpdateInfo>();
      for (const e of msg.entity) {
        const tu = e.tripUpdate;
        if (!tu?.trip?.tripId) continue;
        const info: TripUpdateInfo = {
          tripId: tu.trip.tripId,
          startDate: tu.trip.startDate || undefined,
          cancelled: tu.trip.scheduleRelationship === rt.TripDescriptor.ScheduleRelationship.CANCELED,
          delay: tu.delay ?? undefined,
          timestamp: (toNum(tu.timestamp) ?? toNum(msg.header.timestamp) ?? 0) * 1000,
          updates: (tu.stopTimeUpdate ?? []).map((u) => ({
            stopSequence: u.stopSequence ?? undefined,
            stopId: u.stopId || undefined,
            arrivalDelay: u.arrival?.delay ?? undefined,
            departureDelay: u.departure?.delay ?? undefined,
            arrivalTime: toNum(u.arrival?.time),
            departureTime: toNum(u.departure?.time),
            skipped: u.scheduleRelationship === rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED,
          })),
        };
        map.set(tripKey(info.tripId, info.startDate), info);
      }
      this.tripUpdates = map;
    });
    this.loop('trafikstörningar', this.intervals.alerts, async () => {
      const msg = await this.fetchFeed('ServiceAlerts');
      const pick = (t?: { translation?: { text?: string | null; language?: string | null }[] | null } | null) =>
        t?.translation?.find((x) => x.language === 'sv')?.text ?? t?.translation?.[0]?.text ?? undefined;
      this.alerts = msg.entity
        .filter((e) => e.alert)
        .map((e) => {
          const a = e.alert!;
          const sev = a.severityLevel;
          return {
            id: e.id,
            header: pick(a.headerText) ?? 'Trafikstörning',
            description: pick(a.descriptionText),
            severity: sev === rt.Alert.SeverityLevel.SEVERE ? 'severe' : sev === rt.Alert.SeverityLevel.INFO ? 'info' : 'warning',
            routeIds: (a.informedEntity ?? []).map((x) => x.routeId).filter(Boolean) as string[],
            stopIds: (a.informedEntity ?? []).map((x) => x.stopId).filter(Boolean) as string[],
            tripIds: (a.informedEntity ?? []).map((x) => x.trip?.tripId).filter(Boolean) as string[],
          } satisfies Alert;
        });
    });
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /**
   * Turuppdatering för exakt tur och trafikdag. Saknas startdatum i flödet godtas
   * uppdateringen bara om tur-id:t är entydigt.
   */
  tripUpdate(tripId: string, serviceDate: string): TripUpdateInfo | undefined {
    const exact = this.tripUpdates.get(tripKey(tripId, serviceDate));
    if (exact) return exact;
    const undated = this.tripUpdates.get(tripKey(tripId, undefined));
    if (undated) {
      const dated = [...this.tripUpdates.values()].filter((t) => t.tripId === tripId && t.startDate);
      if (!dated.length) return undated;
    }
    return undefined;
  }
}

export function tripKey(tripId: string, startDate?: string) {
  return `${tripId}|${startDate ?? ''}`;
}

/** Fördröjning i sekunder vid en hållplats enligt GTFS-RT:s propageringsregler. */
export function delayAtStop(tu: TripUpdateInfo, seq: number | undefined, stopId: string | undefined, kind: 'arrival' | 'departure'): number | undefined {
  let found: number | undefined;
  for (const u of tu.updates) {
    const reached = seq != null && u.stopSequence != null ? u.stopSequence <= seq : u.stopId === stopId;
    if (!reached) continue;
    const exact = seq != null && u.stopSequence != null ? u.stopSequence === seq : u.stopId === stopId;
    const d = exact
      ? kind === 'arrival'
        ? u.arrivalDelay ?? u.departureDelay
        : u.departureDelay ?? u.arrivalDelay
      : u.departureDelay ?? u.arrivalDelay;
    if (d != null) found = d;
    if (exact) break;
  }
  return found ?? tu.delay;
}
