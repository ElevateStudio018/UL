import { useEffect, useMemo, useState } from 'react';
import type { Alert, Departure, StopRef, TripDetail, Vehicle } from '../../shared/types';
import { epochToLocalInputs, fmtTime, localInputToEpoch } from '../../shared/time';
import { transitLegs } from '../../shared/legs';
import { api, ApiError } from '../lib/api';
import { freshness } from '../lib/markers';
import { useStore } from '../lib/store';
import { DemoBadge, Icon, LineBadge, Notice, RtTime, Skeleton, ago, useNow } from '../components/ui';

export const AREAS = {
  uppsala: { label: 'Uppsala stad', points: [{ lat: 59.79, lng: 17.55 }, { lat: 59.9, lng: 17.73 }] },
  uppland: { label: 'Hela Uppland', points: [{ lat: 59.45, lng: 16.8 }, { lat: 60.6, lng: 18.7 }] },
};

/** Turer (tur-id + trafikdag) i den valda resan. */
export function selectedTripKeys(): Set<string> {
  const sel = useStore.getState().selection;
  const its = !sel ? [] : sel.kind === 'itinerary' ? [sel.itinerary] : sel.option.persons.map((p) => p.itinerary);
  return new Set(its.flatMap((it) => transitLegs(it.legs).map((l) => `${l.tripId}|${l.serviceDate}`)));
}

export function DepartureBoard({ stop, onClose }: { stop: StopRef; onClose: () => void }) {
  const favStops = useStore((s) => s.favStops);
  const set = useStore((s) => s.set);
  const config = useStore((s) => s.config);
  const [deps, setDeps] = useState<Departure[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const fav = favStops.some((f) => f.name === stop.name);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const from = date ? localInputToEpoch(date, '00:00') : Date.now();
        const until = date ? localInputToEpoch(date, '23:59') + 4 * 3600_000 : undefined;
        const r = await api.departures(stop.id, from, date ? 200 : 15, until);
        if (alive) {
          setDeps(r.departures);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e as ApiError);
      }
    };
    setDeps(null);
    void load();
    const t = date ? undefined : setInterval(load, 30_000);
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [stop.id, date]);

  const toggleFav = () => set({ favStops: fav ? favStops.filter((f) => f.name !== stop.name) : [...favStops, stop] });

  if (trip)
    return (
      <div className="detail">
        <div className="detail-head">
          <button className="icon-btn" onClick={() => setTrip(null)} aria-label="Tillbaka till avgångar">
            <Icon name="back" />
          </button>
          <div>
            <h2 className="h-title">
              <LineBadge line={trip.line} /> mot {trip.headsign}
            </h2>
            <div className="muted small">{trip.rt === 'realtime' ? 'Med realtidsprognos' : trip.rt === 'cancelled' ? 'Inställd' : 'Enligt tidtabell – realtid saknas'}</div>
          </div>
        </div>
        <ol className="trip-stops">
          {trip.stops.map((s) => (
            <li key={s.seq} className={s.stop.name === stop.name ? 'current' : ''}>
              <RtTime time={s.time} rt={trip.rt} compact />
              <span>{s.stop.name}</span>
            </li>
          ))}
        </ol>
      </div>
    );

  const inputs = epochToLocalInputs(Date.now());
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={onClose} aria-label="Stäng avgångstavlan">
          <Icon name="back" />
        </button>
        <div>
          <h2 className="h-title">{stop.name}</h2>
          <div className="muted small">{date ? `Tidtabell ${date}` : 'Nästa avgångar'}</div>
        </div>
        {config?.demo && <DemoBadge />}
        <button className="icon-btn" onClick={toggleFav} aria-pressed={fav} aria-label={fav ? 'Ta bort favorithållplats' : 'Spara som favorithållplats'}>
          <Icon name="star" className={fav ? 'fav-on' : ''} />
        </button>
      </div>
      <div className="row gap wrap">
        <button className={`chip ${!date ? 'active' : ''}`} onClick={() => setDate(null)} aria-pressed={!date}>
          Nästa avgångar
        </button>
        <label className="chip chip-date">
          <Icon name="clock" size={16} /> Tidtabell för datum
          <input type="date" value={date ?? inputs.date} onChange={(e) => setDate(e.target.value || null)} aria-label="Välj datum för tidtabell" />
        </label>
      </div>
      {error && <Notice kind="error" title="Kunde inte hämta avgångar">{error.message}</Notice>}
      {!deps && !error && <Skeleton lines={5} />}
      {deps && !deps.length && <Notice kind="info">Inga avgångar under den valda perioden.</Notice>}
      {deps && (
        <ul className="dep-list">
          {deps.map((d) => (
            <li key={`${d.tripId}|${d.serviceDate}|${d.stop.id}`}>
              <button className="dep" onClick={async () => setTrip((await api.trip(d.tripId, d.serviceDate).catch(() => null))?.trip ?? null)}>
                <LineBadge line={d.line} cancelled={d.rt === 'cancelled'} />
                <span className="dep-dest">
                  {d.headsign}
                  {d.stop.platform && <span className="platform">Läge {d.stop.platform}</span>}
                </span>
                <RtTime time={d.time} rt={d.rt} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VehiclePanel({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const vehicles = useStore((s) => s.vehicles);
  const now = useNow(3000);
  const v = vehicles.find((x) => x.id === vehicle.id) ?? vehicle;
  const f = freshness(v, now);
  const delayMin = v.delay != null ? Math.round(v.delay / 60) : null;
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={onClose} aria-label="Stäng">
          <Icon name="back" />
        </button>
        <div>
          <h2 className="h-title">
            <LineBadge line={v.line ?? '?'} size="lg" /> {v.headsign ? `mot ${v.headsign}` : 'Okänd destination'}
          </h2>
        </div>
        {v.source === 'simulated' && <DemoBadge text="Simulerad" />}
      </div>
      <dl className="facts">
        <dt>Position</dt>
        <dd>
          {v.source === 'simulated' ? `Simulerad position i demoläge${f === 'stale' ? ' – gammal uppgift' : ''}` : f === 'fresh' ? 'Aktuell GPS-position' : f === 'stale' ? 'Gammal positionsuppgift – bussen kan ha flyttat sig' : 'För gammal positionsuppgift'}
        </dd>
        <dt>Senast uppdaterad</dt>
        <dd>
          {fmtTime(v.timestamp)} ({ago(v.timestamp, now)})
        </dd>
        <dt>Nästa hållplats</dt>
        <dd>{v.nextStop ?? 'Uppgift saknas'}</dd>
        <dt>Försening</dt>
        <dd>
          {delayMin == null ? 'Ingen förseningsuppgift i realtidsdatan' : delayMin === 0 ? 'I tid enligt realtid' : delayMin > 0 ? `${delayMin} min sen enligt realtid` : `${-delayMin} min tidig enligt realtid`}
          {delayMin != null && v.source === 'simulated' ? ' (simulerad)' : ''}
        </dd>
      </dl>
      {!v.tripId && <Notice kind="info">Fordonet är inte kopplat till någon tur i realtidsdatan.</Notice>}
    </div>
  );
}

export function LiveView() {
  const s = useStore();
  const now = useNow(5000);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [lineInput, setLineInput] = useState('');
  const meta = s.vehiclesMeta;
  const hasTrip = !!s.selection;

  useEffect(() => {
    api.alerts().then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]));
  }, []);

  const counts = useMemo(() => {
    let fresh = 0;
    let stale = 0;
    let old = 0;
    for (const v of s.vehicles) {
      const f = freshness(v, now);
      if (f === 'fresh') fresh++;
      else if (f === 'stale') stale++;
      else old++;
    }
    return { fresh, stale, old };
  }, [s.vehicles, now]);

  const addLine = () => {
    const l = lineInput.trim();
    if (l && !s.liveFilter.lines.includes(l)) s.set({ liveFilter: { ...s.liveFilter, lines: [...s.liveFilter.lines, l] } });
    setLineInput('');
  };

  if (s.openVehicle) return <VehiclePanel vehicle={s.openVehicle} onClose={() => s.set({ openVehicle: null })} />;

  return (
    <div className="live">
      <h2 className="section-title">
        Livekarta {s.config?.demo && <DemoBadge text="Simulerade bussar" />}
      </h2>
      {meta && !meta.available && (
        <Notice kind="warn" title="Realtidsposition saknas">
          Fordonspositioner är inte konfigurerade på servern. Se Inställningar → Konfiguration.
        </Notice>
      )}
      {meta?.error && <Notice kind="warn" title="Realtidsdata kan vara inaktuell">{meta.error}</Notice>}
      {meta?.available && (
        <p className="small">
          <span className="legend legend-fresh" /> {counts.fresh} aktuella positioner · <span className="legend legend-stale" /> {counts.stale} äldre än 90 s
          {counts.old > 0 && ` · ${counts.old} döljs (äldre än 10 min)`}
        </p>
      )}

      <div className="filter-block">
        <span className="pref-label">Område</span>
        <div className="row gap wrap">
          {Object.entries(AREAS).map(([k, a]) => (
            <button key={k} className="chip" onClick={() => s.focus(a.points)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <span className="pref-label">Linjer</span>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            addLine();
          }}
        >
          <input className="input" value={lineInput} onChange={(e) => setLineInput(e.target.value)} placeholder="Linjenummer, t.ex. 4" inputMode="numeric" aria-label="Filtrera på linje" />
          <button className="btn btn-secondary" type="submit">
            Filtrera
          </button>
        </form>
        <div className="row gap wrap">
          {s.liveFilter.lines.map((l) => (
            <button key={l} className="chip active" onClick={() => s.set({ liveFilter: { ...s.liveFilter, lines: s.liveFilter.lines.filter((x) => x !== l) } })} aria-label={`Ta bort filter linje ${l}`}>
              Linje {l} <Icon name="close" size={14} />
            </button>
          ))}
          {s.favLines
            .filter((l) => !s.liveFilter.lines.includes(l))
            .map((l) => (
              <button key={l} className="chip" onClick={() => s.set({ liveFilter: { ...s.liveFilter, lines: [...s.liveFilter.lines, l] } })}>
                <Icon name="star" size={14} /> {l}
              </button>
            ))}
        </div>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={s.liveFilter.onlyTrip} disabled={!hasTrip} onChange={(e) => s.set({ liveFilter: { ...s.liveFilter, onlyTrip: e.target.checked } })} />
        <span>
          Visa bara bussar i vald resa
          {!hasTrip && <span className="muted small"> – välj först en resa under Planera</span>}
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.liveFilter.showStops} onChange={(e) => s.set({ liveFilter: { ...s.liveFilter, showStops: e.target.checked } })} />
        <span>Visa hållplatser (zooma in)</span>
      </label>

      <h3 className="list-heading">Trafikstörningar</h3>
      {!alerts && <Skeleton lines={2} />}
      {alerts && !alerts.length && <p className="muted small">Inga aktuella trafikstörningar rapporterade.</p>}
      {alerts?.map((a) => (
        <Notice key={a.id} kind={a.severity === 'severe' ? 'error' : 'warn'} title={a.header}>
          {a.description}
        </Notice>
      ))}
      <p className="muted small">Tryck på en buss för detaljer eller på en hållplats för avgångstavlan.</p>
    </div>
  );
}

export type { StopRef };
