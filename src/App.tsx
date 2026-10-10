import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LatLng, StopRef } from '../shared/types';
import type { Bounds } from '../shared/geo';
import { api } from './lib/api';
import { itineraryLines, pairLayers, cssVar } from './lib/layers';
import type { MapLine, MapMarker } from './lib/mapEngine';
import { destHtml, freshness, originHtml, personHtml, pickHtml, stopHtml, vehicleHtml } from './lib/markers';
import { navigate, useRoute, type Route } from './lib/router';
import { useStore } from './lib/store';
import { reverseGeocode } from './lib/google';
import { MapView, useDark } from './components/MapView';
import { PlaceSearch } from './components/place';
import { Sheet, sheetHeightPx, useIsMobile } from './components/Sheet';
import { DemoBadge, Icon, Notice, useNow } from './components/ui';
import { PlanView } from './views/PlanView';
import { DepartureBoard, LiveView, selectedTripKeys } from './views/LiveView';
import { SavedView } from './views/SavedView';
import { SettingsView } from './views/SettingsView';
import { SharedTripView } from './views/SharedTripView';

const NAV: { name: Route['name']; label: string; icon: string }[] = [
  { name: 'planera', label: 'Planera', icon: 'plan' },
  { name: 'karta', label: 'Livekarta', icon: 'map' },
  { name: 'sparat', label: 'Sparat', icon: 'star' },
  { name: 'installningar', label: 'Inställningar', icon: 'settings' },
];

const FIELD_TITLES: Record<string, string> = { from: 'Från', to: 'Till', p1: 'Person 1 – från', p2: 'Person 2 – från', dest: 'Gemensam destination' };

function Nav({ route, className }: { route: Route; className: string }) {
  const current = route.name === 'delad' ? 'planera' : route.name;
  return (
    <nav className={className} aria-label="Huvudmeny">
      {NAV.map((n) => (
        <a key={n.name} href={`#/${n.name}`} className={current === n.name ? 'active' : ''} aria-current={current === n.name ? 'page' : undefined}>
          <Icon name={n.icon} size={22} />
          <span>{n.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function App() {
  const route = useRoute();
  const s = useStore();
  const mobile = useIsMobile();
  const dark = useDark();
  const now = useNow(5000);
  const [online, setOnline] = useState(navigator.onLine);
  const [stops, setStops] = useState<StopRef[]>([]);
  const view = useRef<{ b: Bounds; z: number } | null>(null);

  useEffect(() => {
    api
      .config()
      .then((config) => useStore.setState({ config }))
      .catch((e) => useStore.setState({ configError: (e as Error).message }));
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  useEffect(() => {
    const t = s.settings.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, [s.settings.theme]);

  // Fordonspositioner hämtas från serverns gemensamma cache, bara när de behövs.
  const needVehicles = route.name === 'karta' || !!s.selection || route.name === 'delad';
  useEffect(() => {
    if (!needVehicles || !s.config) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await api.vehicles();
        if (alive) useStore.setState({ vehicles: r.vehicles, vehiclesMeta: { available: r.available, fetchedAt: r.fetchedAt, error: r.error } });
      } catch {
        if (alive) useStore.setState((st) => ({ vehiclesMeta: { available: st.vehiclesMeta?.available ?? false, fetchedAt: st.vehiclesMeta?.fetchedAt ?? 0, error: 'Kunde inte uppdatera bussarnas positioner.' } }));
      }
    };
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [needVehicles, s.config]);

  const loadStops = useCallback(async () => {
    const v = view.current;
    if (!v || v.z < 14 || !useStore.getState().liveFilter.showStops) {
      setStops([]);
      return;
    }
    const b = v.b;
    try {
      const r = await api.stops([b.south, b.west, b.north, b.east].map((x) => x.toFixed(5)).join(','));
      setStops(r.stops);
    } catch {
      /* hållplatser visas inte */
    }
  }, []);

  useEffect(() => {
    void loadStops();
  }, [s.liveFilter.showStops, loadStops]);

  const onIdle = useCallback(
    (b: Bounds, z: number) => {
      view.current = { b, z };
      void loadStops();
    },
    [loadStops],
  );

  const onMapClick = useCallback(async (p: LatLng) => {
    const st = useStore.getState();
    if (!st.pick) return;
    useStore.setState({ pick: { ...st.pick, point: p, name: undefined } });
    const key = st.config?.googleMapsKey;
    const name = (key && (await reverseGeocode(key, p))) || (await api.reverse(p).catch(() => ({ name: 'Vald punkt' }))).name;
    const cur = useStore.getState().pick;
    if (cur?.point === p) useStore.setState({ pick: { ...cur, name } });
  }, []);

  const { lines, markers } = useMemo(() => {
    const lines: MapLine[] = [];
    const markers: MapMarker[] = [];
    const sel = s.selection;
    const onPlan = route.name === 'planera';
    const onLive = route.name === 'karta';
    const relevant = selectedTripKeys();

    if (route.name === 'delad' && s.overlay) {
      lines.push(...s.overlay.lines);
      markers.push(...s.overlay.markers);
    } else if ((onPlan || (onLive && s.liveFilter.onlyTrip)) && sel) {
      if (sel.kind === 'pair') {
        const l = pairLayers(sel.option, s.names, s.fields.dest);
        lines.push(...l.lines);
        markers.push(...l.markers);
      } else {
        lines.push(...itineraryLines(sel.itinerary, cssVar('--accent'), 'solo'));
        const first = sel.itinerary.legs[0];
        const start = first.kind === 'transit' ? first.from : first.kind === 'walk' ? first.from : first.at;
        markers.push({ id: 'origin', pos: start, html: originHtml(), title: 'Start', z: 20 });
        if (s.fields.to) markers.push({ id: 'dest', pos: s.fields.to, html: destHtml(), title: s.fields.to.name, z: 22 });
      }
    } else if (onPlan) {
      const f = s.fields;
      if (s.mode === 'solo') {
        if (f.from) markers.push({ id: 'origin', pos: f.from, html: originHtml(), title: `Från: ${f.from.name}` });
        if (f.to) markers.push({ id: 'dest', pos: f.to, html: destHtml(), title: `Till: ${f.to.name}` });
      } else {
        if (f.p1) markers.push({ id: 'origin-0', pos: f.p1, html: personHtml(0, s.names[0]), title: `${s.names[0]}: ${f.p1.name}` });
        if (f.p2) markers.push({ id: 'origin-1', pos: f.p2, html: personHtml(1, s.names[1]), title: `${s.names[1]}: ${f.p2.name}` });
        if (f.dest) markers.push({ id: 'dest', pos: f.dest, html: destHtml(), title: `Destination: ${f.dest.name}` });
      }
    }

    if (s.previewPlace) markers.push({ id: 'preview', pos: s.previewPlace, html: pickHtml(), title: s.previewPlace.name, z: 50 });
    if (s.pick?.point) markers.push({ id: 'pick', pos: s.pick.point, html: pickHtml(), title: 'Vald punkt', z: 50 });

    // Bussar: på livekartan alla (filtrerade), annars bara de som hör till vald resa.
    const showAll = onLive && !s.liveFilter.onlyTrip;
    for (const v of s.vehicles) {
      if (freshness(v, now) === 'old') continue;
      const key = `${v.tripId}|${v.serviceDate}`;
      const isRel = relevant.has(key);
      if (!showAll && !isRel) continue;
      if (onLive && s.liveFilter.lines.length && !s.liveFilter.lines.includes(v.line ?? '')) continue;
      markers.push({ id: `veh-${v.id}`, pos: v, html: vehicleHtml(v, now, isRel), title: `Linje ${v.line ?? 'okänd'} mot ${v.headsign ?? 'okänd destination'}`, z: isRel ? 30 : 10, onClick: () => useStore.setState({ openVehicle: v, openStop: null }) });
    }
    if (s.liveFilter.showStops && route.name !== 'delad') {
      const favNames = new Set(s.favStops.map((f) => f.name));
      for (const st of stops) markers.push({ id: `stop-${st.id}`, pos: st, html: stopHtml(favNames.has(st.name)), title: `Hållplats ${st.name}${st.platform ? `, läge ${st.platform}` : ''}`, z: 1, onClick: () => useStore.setState({ openStop: st, openVehicle: null, sheetSnap: 'half' }) });
    }
    return { lines, markers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, s.selection, s.fields, s.mode, s.names, s.vehicles, s.liveFilter, s.previewPlace, s.pick, stops, s.overlay, s.favStops, now, dark]);

  const pickPanel = s.pick && (
    <div className="pick-bar" role="region" aria-label="Välj plats på kartan">
      <div>
        <strong>{s.pick.point ? s.pick.name ?? 'Hämtar adress…' : 'Tryck på kartan för att välja plats'}</strong>
        <div className="muted small">{FIELD_TITLES[s.pick.target] ?? 'Plats'}</div>
      </div>
      <div className="row gap">
        <button className="btn btn-secondary btn-sm" onClick={() => s.set({ pick: null, sheetSnap: 'half' })}>
          Avbryt
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!s.pick.point}
          onClick={() => {
            const p = s.pick!;
            const place = { name: p.name ?? 'Vald punkt', lat: p.point!.lat, lng: p.point!.lng, source: 'map' as const };
            s.setField(p.target, place);
            s.addRecent(place);
            s.set({ pick: null, sheetSnap: 'half' });
          }}
        >
          Använd punkten
        </button>
      </div>
    </div>
  );

  let content: JSX.Element;
  if (s.openStop && (route.name === 'karta' || route.name === 'planera')) content = <DepartureBoard stop={s.openStop} onClose={() => s.set({ openStop: null })} />;
  else if (route.name === 'karta') content = <LiveView />;
  else if (route.name === 'sparat') content = <SavedView />;
  else if (route.name === 'installningar') content = <SettingsView />;
  else if (route.name === 'delad') content = <SharedTripView id={route.id} />;
  else content = <PlanView />;

  if (s.openVehicle && route.name === 'planera') content = <LiveView />;

  const header = (
    <header className="app-header">
      <a className="brand" href="#/planera" aria-label="Samåk, till reseplaneraren">
        <span className="brand-mark" aria-hidden>
          <Icon name="people" size={18} />
        </span>
        Samåk
      </a>
      {s.config?.demo && (
        <button className="demo-chip" onClick={() => navigate('installningar')} title="Visa vilka tjänster som behövs för riktig drift">
          <DemoBadge text="Demoläge" />
        </button>
      )}
      <span className="muted small header-note">Inofficiell reseplanerare</span>
    </header>
  );

  const banners = (
    <>
      {!online && (
        <div className="offline-banner" role="status">
          <Icon name="wifiOff" size={16} /> Du är offline. Sparad resa kan visas, men tider uppdateras inte.
        </div>
      )}
      {s.configError && !s.config && (
        <Notice kind="error" title="Servern svarar inte">
          {s.configError}
        </Notice>
      )}
    </>
  );

  const fullPage = mobile && (route.name === 'sparat' || route.name === 'installningar');
  const target = s.searchTarget;

  return (
    <div className={`app ${mobile ? 'is-mobile' : 'is-desktop'}`}>
      {!fullPage && <MapView lines={lines} markers={markers} onClick={onMapClick} onIdle={onIdle} mobileSheetPx={sheetHeightPx(s.sheetSnap)} />}
      {pickPanel}
      {fullPage ? (
        <main className="page">
          {header}
          {banners}
          <div className="page-body">{content}</div>
        </main>
      ) : (
        !s.pick && (
          <Sheet
            header={
              <>
                {header}
                {!mobile && <Nav route={route} className="top-nav" />}
                {banners}
              </>
            }
          >
            {content}
          </Sheet>
        )
      )}
      {mobile && <Nav route={route} className="bottom-nav" />}
      {target && target !== 'share-origin' && (
        <PlaceSearch
          target={target}
          title={target.startsWith('saved:') ? `Ange ${s.saved.find((x) => `saved:${x.id}` === target)?.label ?? 'plats'}` : target === 'p1' ? `${s.names[0]} – från` : target === 'p2' ? `${s.names[1]} – från` : FIELD_TITLES[target]}
          onClose={() => s.set({ searchTarget: null })}
          onSelect={(p) => {
            s.setField(target, p);
            s.addRecent(p);
            s.set({ searchTarget: null, previewPlace: null });
            s.focus([p]);
          }}
        />
      )}
    </div>
  );
}
