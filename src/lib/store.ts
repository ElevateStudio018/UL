import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type {
  AppConfig,
  Itinerary,
  LatLng,
  MatchStrategy,
  PairOption,
  Place,
  Prefs,
  StopRef,
  TimeQuery,
  TogetherResponse,
  Vehicle,
} from '../../shared/types';
import { DEFAULT_PREFS } from '../../shared/types';
import type { MapLine, MapMarker } from './mapEngine';

const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* lagring ej tillgänglig */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignoreras */
    }
  },
};

export type FieldKey = 'from' | 'to' | 'p1' | 'p2' | 'dest' | `saved:${string}` | 'share-origin';
export type Theme = 'system' | 'light' | 'dark';

export interface SavedPlace {
  id: string;
  label: string;
  kind: 'home' | 'school' | 'work' | 'training' | 'custom';
  place?: Place;
}

export interface SavedTrip {
  kind: 'solo' | 'pair';
  itinerary?: Itinerary;
  pair?: PairOption;
  names?: [string, string];
  destination?: string;
  savedAt: number;
}

export interface Settings {
  prefs: Prefs;
  leaveMargin: number;
  theme: Theme;
  reminders: boolean;
}

export type Selection =
  | { kind: 'itinerary'; itinerary: Itinerary }
  | { kind: 'pair'; option: PairOption }
  | null;

interface State {
  config: AppConfig | null;
  configError?: string;
  settings: Settings;
  saved: SavedPlace[];
  favLines: string[];
  favStops: StopRef[];
  recents: Place[];
  savedTrip: SavedTrip | null;
  shareTokens: Record<string, string>;

  // Planering
  mode: 'solo' | 'together';
  fields: Partial<Record<'from' | 'to' | 'p1' | 'p2' | 'dest', Place>>;
  names: [string, string];
  time: TimeQuery;
  strategy: MatchStrategy;
  tolerance: number;
  soloResults: Itinerary[] | null;
  togetherResult: TogetherResponse | null;
  selection: Selection;

  // Karta
  pick: { target: FieldKey; point?: LatLng; name?: string } | null;
  searchTarget: FieldKey | null;
  focusPoints: LatLng[] | null;
  focusSeq: number;
  previewPlace: Place | null;
  openStop: StopRef | null;
  openVehicle: Vehicle | null;
  liveFilter: { lines: string[]; onlyTrip: boolean; showStops: boolean };
  sheetSnap: 'peek' | 'half' | 'full';
  sharePlace: Place | null;
  vehicles: Vehicle[];
  vehiclesMeta: { available: boolean; fetchedAt: number; error?: string } | null;
  overlay: { markers: MapMarker[]; lines: MapLine[] } | null;

  set: (p: Partial<State>) => void;
  setField: (k: FieldKey, p: Place | undefined) => void;
  addRecent: (p: Place) => void;
  setSettings: (p: Partial<Settings>) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  focus: (pts: LatLng[]) => void;
  clearResults: () => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      config: null,
      settings: { prefs: DEFAULT_PREFS, leaveMargin: 2, theme: 'system', reminders: false },
      saved: [
        { id: 'home', label: 'Hem', kind: 'home' },
        { id: 'school', label: 'Skola', kind: 'school' },
        { id: 'work', label: 'Jobb', kind: 'work' },
        { id: 'training', label: 'Träning', kind: 'training' },
      ],
      favLines: [],
      favStops: [],
      recents: [],
      savedTrip: null,
      shareTokens: {},

      mode: 'together',
      fields: {},
      names: ['Person 1', 'Person 2'],
      time: { mode: 'now', at: Date.now() },
      strategy: 'sameBus',
      tolerance: 10,
      soloResults: null,
      togetherResult: null,
      selection: null,

      pick: null,
      searchTarget: null,
      focusPoints: null,
      focusSeq: 0,
      previewPlace: null,
      openStop: null,
      openVehicle: null,
      liveFilter: { lines: [], onlyTrip: false, showStops: true },
      sheetSnap: 'half',
      sharePlace: null,
      vehicles: [],
      vehiclesMeta: null,
      overlay: null,

      set: (p) => set(p),
      setField: (k, p) => {
        if (k.startsWith('saved:')) {
          const id = k.slice(6);
          set({ saved: get().saved.map((s) => (s.id === id ? { ...s, place: p } : s)) });
          return;
        }
        if (k === 'share-origin') {
          set({ sharePlace: p ?? null });
          return;
        }
        set({ fields: { ...get().fields, [k]: p }, soloResults: null, togetherResult: null, selection: null });
      },
      addRecent: (p) => {
        if (p.source === 'gps') return; // Egen position sparas inte i historiken.
        const key = (x: Place) => `${x.name}|${x.lat.toFixed(4)}|${x.lng.toFixed(4)}`;
        const rest = get().recents.filter((r) => key(r) !== key(p));
        set({ recents: [{ ...p }, ...rest].slice(0, 8) });
      },
      setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
      setPrefs: (p) => set({ settings: { ...get().settings, prefs: { ...get().settings.prefs, ...p } } }),
      focus: (pts) => set({ focusPoints: pts, focusSeq: get().focusSeq + 1 }),
      clearResults: () => set({ soloResults: null, togetherResult: null, selection: null }),
    }),
    {
      name: 'samak',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        settings: s.settings,
        saved: s.saved,
        favLines: s.favLines,
        favStops: s.favStops,
        recents: s.recents,
        savedTrip: s.savedTrip,
        shareTokens: s.shareTokens,
        names: s.names,
        mode: s.mode,
        strategy: s.strategy,
        tolerance: s.tolerance,
      }),
    },
  ),
);

export const PERSON_COLORS = ['var(--p1)', 'var(--p2)'] as const;
