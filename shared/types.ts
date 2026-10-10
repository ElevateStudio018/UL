// Gemensamma typer för klient och server.

export interface LatLng {
  lat: number;
  lng: number;
}

export type PlaceSource = 'gps' | 'search' | 'stop' | 'map' | 'link' | 'saved' | 'demo';

export interface Place extends LatLng {
  name: string;
  address?: string;
  source: PlaceSource;
  /** Hållplats-id om platsen är en hållplats. */
  stopId?: string;
  placeId?: string;
}

export type TimeMode = 'now' | 'depart' | 'arrive';

export interface TimeQuery {
  mode: TimeMode;
  /** Epoch ms. Ignoreras för "now". */
  at: number;
}

export interface Prefs {
  /** Gångtempo i meter per sekund. */
  walkSpeed: number;
  /** Minsta bytesmarginal i minuter. */
  minTransfer: number;
  /** Viktning av resealternativ. */
  preference: 'balanced' | 'fewTransfers' | 'lessWalking';
}

export const DEFAULT_PREFS: Prefs = { walkSpeed: 1.33, minTransfer: 3, preference: 'balanced' };

export interface StopRef extends LatLng {
  id: string;
  name: string;
  /** Hållplatsläge, t.ex. "A". */
  platform?: string;
}

export interface CallTime {
  /** Planerad tid, epoch ms. */
  scheduled: number;
  /** Prognostiserad tid, finns bara med realtidsunderlag. */
  estimated?: number;
}

/** realtime = prognos finns, scheduled = enligt tidtabell, cancelled = inställd. */
export type RtState = 'realtime' | 'scheduled' | 'cancelled';

export interface Alert {
  id: string;
  header: string;
  description?: string;
  severity: 'info' | 'warning' | 'severe';
  routeIds: string[];
  stopIds: string[];
  tripIds: string[];
  demo?: boolean;
}

export interface WalkLeg {
  kind: 'walk';
  from: { name: string } & LatLng;
  to: { name: string } & LatLng;
  start: number;
  end: number;
  distance: number;
  geometry: LatLng[];
  /** true om gångvägen är uppskattad (inte beräknad längs gångvägnätet). */
  estimated: boolean;
}

export interface WaitLeg {
  kind: 'wait';
  at: { name: string } & LatLng;
  start: number;
  end: number;
  reason: string;
}

export interface TransitLeg {
  kind: 'transit';
  tripId: string;
  /** Trafikdag, YYYYMMDD. Turer efter midnatt hör till föregående trafikdag. */
  serviceDate: string;
  routeId: string;
  line: string;
  mode: 'bus' | 'train' | 'tram';
  headsign: string;
  from: StopRef;
  to: StopRef;
  dep: CallTime;
  arr: CallTime;
  boardSeq: number;
  alightSeq: number;
  intermediate: { stop: StopRef; time: CallTime }[];
  geometry: LatLng[];
  rt: RtState;
  alerts: Alert[];
}

export type Leg = WalkLeg | WaitLeg | TransitLeg;

export type WarningKind = 'shortTransfer' | 'missedTransfer' | 'cancelled' | 'alert';

export interface TripWarning {
  kind: WarningKind;
  text: string;
}

export interface Itinerary {
  id: string;
  legs: Leg[];
  start: number;
  end: number;
  walkDistance: number;
  walkDuration: number;
  transfers: number;
  /** Kortaste bytesmarginal i minuter, om byte finns. */
  minTransferMargin?: number;
  warnings: TripWarning[];
  demo: boolean;
}

export type MatchStrategy = 'sameBus' | 'meet' | 'arriveTogether';
export type MatchLabel = 'best' | 'fastest' | 'leastEffort';

export interface PersonPlan {
  itinerary: Itinerary;
  leaveAt: number;
  arriveAt: number;
  /** Total restid i minuter. */
  total: number;
  /** Minuter längre än personens snabbaste egna resa. */
  detour: number;
  /** Väntetid vid mötesplats eller destination, minuter. */
  wait: number;
}

export interface SharedPart {
  tripId: string;
  serviceDate: string;
  line: string;
  headsign: string;
  /** Där den gemensamma delen börjar och slutar. */
  from: StopRef;
  to: StopRef;
  start: number;
  end: number;
  /** Var respektive person kliver på samma tur. */
  boards: [StopRef, StopRef];
  walkTogether?: boolean;
}

export interface PairOption {
  id: string;
  strategy: MatchStrategy;
  labels: MatchLabel[];
  persons: [PersonPlan, PersonPlan];
  meeting?: { name: string; time: number; stop?: StopRef } & LatLng;
  shared?: SharedPart;
  arrivalDiff: number;
  explanation: string;
  score: number;
}

export interface TogetherRequest {
  persons: [Place, Place];
  names: [string, string];
  destination: Place;
  time: TimeQuery;
  strategy: MatchStrategy;
  /** Högsta tillåtna skillnad i ankomsttid i minuter (Framme samtidigt). */
  tolerance: number;
  prefs: Prefs;
}

export interface TogetherResponse {
  options: PairOption[];
  solo: [Itinerary | null, Itinerary | null];
  noMatchReason?: string;
  suggestions?: string[];
  demo: boolean;
}

export interface PlanRequest {
  from: Place;
  to: Place;
  time: TimeQuery;
  prefs: Prefs;
  max?: number;
}

export interface PlanResponse {
  itineraries: Itinerary[];
  demo: boolean;
}

export interface Vehicle extends LatLng {
  id: string;
  tripId?: string;
  serviceDate?: string;
  routeId?: string;
  line?: string;
  headsign?: string;
  bearing?: number;
  /** Tidpunkt för senaste positionsuppdatering, epoch ms. */
  timestamp: number;
  nextStop?: string;
  /** Försening i sekunder enligt TripUpdate för samma tur och trafikdag. */
  delay?: number;
  /** gps = verklig position, simulated = demoläge. */
  source: 'gps' | 'simulated';
}

export interface Departure {
  tripId: string;
  serviceDate: string;
  line: string;
  routeId: string;
  headsign: string;
  stop: StopRef;
  time: CallTime;
  rt: RtState;
}

export interface TripDetail {
  tripId: string;
  serviceDate: string;
  line: string;
  headsign: string;
  rt: RtState;
  stops: { stop: StopRef; time: CallTime; seq: number }[];
}

export interface ServiceStatus {
  id: string;
  name: string;
  configured: boolean;
  required: string;
  description: string;
  env: string[];
}

export interface AppConfig {
  demo: boolean;
  planner: 'otp' | 'demo';
  realtime: 'gtfs-rt' | 'demo' | 'none';
  googleMapsKey?: string;
  googleMapId?: string;
  services: ServiceStatus[];
  realtimeFetchedAt?: number;
  realtimeError?: string;
}

export type ShareStatus = 'none' | 'leaving' | 'atStop' | 'onBus' | 'arrived';

export interface ShareParticipant {
  name: string;
  joined: boolean;
  confirmed: boolean;
  status: ShareStatus;
  statusAt?: number;
  origin?: Place;
  /** Frivillig, tidsbegränsad liveposition. Endast senaste punkt sparas. */
  live?: LatLng & { at: number; until: number };
}

export interface ShareState {
  id: string;
  createdAt: number;
  expiresAt: number;
  destination: Place;
  time: TimeQuery;
  strategy: MatchStrategy;
  tolerance: number;
  option?: PairOption;
  participants: [ShareParticipant, ShareParticipant];
  demo: boolean;
}
