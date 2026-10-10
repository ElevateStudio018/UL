import type {
  Alert,
  Departure,
  Itinerary,
  LatLng,
  Place,
  Prefs,
  StopRef,
  TimeQuery,
  TripDetail,
  Vehicle,
} from '../../shared/types';
import type { Bounds } from '../../shared/geo';

export interface PlanOptions {
  max: number;
  /** Bredare tidsfönster ger fler alternativ för matchning. */
  windowMin?: number;
}

/** Gemensamt gränssnitt för demomotorn och den riktiga integrationen. */
export interface TransitProvider {
  readonly demo: boolean;
  plan(from: Place, to: Place, time: TimeQuery, prefs: Prefs, opts: PlanOptions): Promise<Itinerary[]>;
  stops(bounds: Bounds): Promise<StopRef[]>;
  nearbyStops(p: LatLng, radius: number): Promise<StopRef[]>;
  departures(stopId: string, from: number, limit: number, until?: number): Promise<Departure[]>;
  trip(tripId: string, serviceDate: string): Promise<TripDetail | null>;
  vehicles(): Promise<Vehicle[]>;
  alerts(): Promise<Alert[]>;
  searchStops(q: string): Promise<StopRef[]>;
}
