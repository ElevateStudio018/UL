import { useEffect, useRef, useState } from 'react';
import type { Place } from '../../shared/types';
import { looksLikeMapsLink, parseMapsLink, type MapsLinkResult } from '../../shared/mapsLink';
import { epochToLocalInputs, fmtDay, fmtTime, localInputToEpoch } from '../../shared/time';
import { api } from '../lib/api';
import { currentPlace, GeoError } from '../lib/geolocate';
import { placeSuggestions, type Suggestion } from '../lib/google';
import { useStore, type FieldKey } from '../lib/store';
import { Icon, Notice, Segmented, Spinner } from './ui';

const SAVED_ICONS: Record<string, string> = { home: 'home', school: 'school', work: 'work', training: 'training', custom: 'heart' };

export function PlaceField({ label, value, target, color, placeholder, onClear }: { label: string; value?: Place; target: FieldKey; color?: string; placeholder?: string; onClear?: () => void }) {
  const set = useStore((s) => s.set);
  return (
    <div className="place-field">
      <span className="place-dot" style={{ background: color ?? 'var(--muted)' }} aria-hidden />
      <button type="button" className="place-btn" onClick={() => set({ searchTarget: target })} aria-label={`${label}: ${value ? value.name : 'ej vald'}. Ändra`}>
        <span className="place-label">{label}</span>
        <span className={`place-value ${value ? '' : 'placeholder'}`}>
          {value ? (
            <>
              {value.source === 'gps' && <Icon name="gps" size={16} />} {value.name}
            </>
          ) : (
            placeholder ?? 'Sök adress, hållplats eller plats'
          )}
        </span>
      </button>
      {value && onClear && (
        <button type="button" className="icon-btn" onClick={onClear} aria-label={`Rensa ${label.toLowerCase()}`}>
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  );
}

type Result = { key: string; main: string; secondary: string; kind: 'stop' | 'place' | 'demo'; place?: Place; resolve?: () => Promise<Place> };

export function PlaceSearch({ target, title, onSelect, onClose }: { target: FieldKey; title: string; onSelect: (p: Place) => void; onClose: () => void }) {
  const config = useStore((s) => s.config);
  const saved = useStore((s) => s.saved);
  const recents = useStore((s) => s.recents);
  const set = useStore((s) => s.set);
  const focus = useStore((s) => s.focus);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ result: MapsLinkResult; place?: Place } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (useStore.getState().previewPlace) useStore.setState({ previewPlace: null });
    };
  }, []);

  const runSearch = async (text: string) => {
    const my = ++seq.current;
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [server, google] = await Promise.all([
        api.search(text).catch(() => ({ results: [] as Place[] })),
        config?.googleMapsKey ? placeSuggestions(config.googleMapsKey, text).catch(() => null) : Promise.resolve([] as Suggestion[]),
      ]);
      if (my !== seq.current) return;
      const out: Result[] = [];
      for (const g of google ?? []) out.push({ key: g.id, main: g.main, secondary: g.secondary, kind: 'place', resolve: g.resolve });
      for (const p of server.results) out.push({ key: `${p.source}:${p.name}:${p.lat}`, main: p.name, secondary: p.source === 'stop' ? 'Hållplats' : `${p.address ?? ''}${p.source === 'demo' ? ' · demoplats' : ''}`, kind: p.source === 'stop' ? 'stop' : 'demo', place: p });
      setResults(out);
      if (google === null) setError('Platssökningen hos Google svarar inte. Visar hållplatser.');
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (looksLikeMapsLink(q)) return;
    const t = setTimeout(() => void runSearch(q), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const choose = async (r: Result) => {
    try {
      const p = r.place ?? (await r.resolve!());
      onSelect(p);
    } catch {
      setError('Platsen kunde inte hämtas. Försök igen.');
    }
  };

  const handleLink = async (text: string) => {
    setLoading(true);
    setError(null);
    setLink(null);
    try {
      const local = parseMapsLink(text);
      const result = local.kind === 'short' ? await api.resolveLink(text) : local;
      if (result.kind === 'coords') {
        let name = result.name;
        if (!name) name = (await api.reverse(result).catch(() => ({ name: 'Plats från länk' }))).name;
        const place: Place = { name: name ?? 'Plats från länk', lat: result.lat, lng: result.lng, source: 'link' };
        setLink({ result, place });
        set({ previewPlace: place });
        focus([place]);
      } else if (result.kind === 'query') {
        setLink({ result });
        setQ(result.query);
        void runSearch(result.query);
      } else {
        setLink({ result });
      }
    } catch (e) {
      setLink({ result: { kind: 'invalid', reason: (e as Error).message } });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (looksLikeMapsLink(q)) void handleLink(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const useGps = async () => {
    setLoading(true);
    setError(null);
    try {
      onSelect(await currentPlace());
    } catch (e) {
      setError(e instanceof GeoError ? e.message : 'Positionen kunde inte hämtas.');
    } finally {
      setLoading(false);
    }
  };

  const pasteLink = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setQ(text.trim());
    } catch {
      setError('Klistra in länken i sökfältet (långtryck eller Ctrl+V).');
      inputRef.current?.focus();
    }
  };

  const savedWithPlace = saved.filter((s) => s.place && !target.startsWith('saved:'));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="overlay-panel search-panel">
        <div className="search-head">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Stäng">
            <Icon name="back" />
          </button>
          <div className="search-input-wrap">
            <Icon name="search" size={18} className="muted" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Adress, hållplats, plats eller Google Maps-länk"
              aria-label={title}
              autoComplete="off"
              enterKeyHint="search"
            />
            {loading && <Spinner />}
          </div>
        </div>
        <div className="search-title">{title}</div>

        {link?.result.kind === 'coords' && link.place && (
          <div className="card link-confirm">
            <strong>Plats från länken</strong>
            <div>{link.place.name}</div>
            <div className="muted small">
              {link.place.lat.toFixed(5)}, {link.place.lng.toFixed(5)}
            </div>
            {link.result.precision === 'viewport' && (
              <Notice kind="warn">Länken anger bara var kartan var centrerad, inte en exakt plats. Kontrollera markören på kartan eller sök fram platsen.</Notice>
            )}
            <div className="row gap">
              <button className="btn btn-primary" onClick={() => onSelect(link.place!)}>
                Använd platsen
              </button>
              <button className="btn btn-secondary" onClick={() => (setLink(null), setQ(''), set({ previewPlace: null }))}>
                Sök i stället
              </button>
            </div>
          </div>
        )}
        {link?.result.kind === 'query' && <Notice kind="info">Länken innehöll sökningen ”{link.result.query}”. Välj rätt plats i listan nedan.</Notice>}
        {link?.result.kind === 'invalid' && (
          <Notice kind="warn" title="Platsen kunde inte läsas ut ur länken">
            {link.result.reason} Sök fram platsen med namn eller adress i stället.
          </Notice>
        )}
        {error && <Notice kind="warn">{error}</Notice>}

        {!q && (
          <div className="quick-actions">
            <button type="button" className="quick" onClick={useGps}>
              <Icon name="gps" /> Min position
            </button>
            <button type="button" className="quick" onClick={() => set({ searchTarget: null, pick: { target }, sheetSnap: 'peek' })}>
              <Icon name="map" /> Välj på kartan
            </button>
            <button type="button" className="quick" onClick={pasteLink}>
              <Icon name="link" /> Klistra in kartlänk
            </button>
          </div>
        )}

        <ul className="result-list">
          {results.map((r) => (
            <li key={r.key}>
              <button type="button" className="result" onClick={() => void choose(r)}>
                <Icon name={r.kind === 'stop' ? 'bus' : 'pin'} className="muted" />
                <span>
                  <span className="result-main">{r.main}</span>
                  <span className="result-sec">{r.secondary}</span>
                </span>
              </button>
            </li>
          ))}
          {q.length >= 2 && !loading && !results.length && !link && <li className="empty">Inga träffar. Prova en annan stavning, en adress eller välj på kartan.</li>}
        </ul>

        {!q && savedWithPlace.length > 0 && (
          <>
            <h3 className="list-heading">Sparade platser</h3>
            <ul className="result-list">
              {savedWithPlace.map((s) => (
                <li key={s.id}>
                  <button type="button" className="result" onClick={() => onSelect({ ...s.place!, source: 'saved' })}>
                    <Icon name={SAVED_ICONS[s.kind]} className="muted" />
                    <span>
                      <span className="result-main">{s.label}</span>
                      <span className="result-sec">{s.place!.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!q && recents.length > 0 && (
          <>
            <h3 className="list-heading">Senaste sökningar</h3>
            <ul className="result-list">
              {recents.map((r, i) => (
                <li key={i}>
                  <button type="button" className="result" onClick={() => onSelect(r)}>
                    <Icon name="clock" className="muted" />
                    <span>
                      <span className="result-main">{r.name}</span>
                      {r.address && <span className="result-sec">{r.address}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {config?.demo && <p className="muted small pad">Demoläge: sökningen omfattar exempelplatser och demohållplatser i Uppsala.</p>}
      </div>
    </div>
  );
}

export function TimePicker() {
  const time = useStore((s) => s.time);
  const set = useStore((s) => s.set);
  const clear = useStore((s) => s.clearResults);
  const inputs = epochToLocalInputs(time.mode === 'now' ? Date.now() : time.at);
  const update = (patch: Partial<typeof time>) => {
    clear();
    set({ time: { ...time, ...patch } });
  };
  return (
    <div className="time-picker">
      <Segmented
        label="Tid"
        size="sm"
        value={time.mode}
        onChange={(mode) => update({ mode, at: time.mode === 'now' ? Date.now() + 15 * 60000 : time.at })}
        options={[
          { value: 'now', label: 'Åk nu' },
          { value: 'depart', label: 'Avgå tidigast' },
          { value: 'arrive', label: 'Framme senast' },
        ]}
      />
      {time.mode !== 'now' && (
        <div className="row gap time-inputs">
          <label className="field">
            <span>Datum</span>
            <input type="date" value={inputs.date} onChange={(e) => e.target.value && update({ at: localInputToEpoch(e.target.value, inputs.time) })} />
          </label>
          <label className="field">
            <span>Tid</span>
            <input type="time" value={inputs.time} onChange={(e) => e.target.value && update({ at: localInputToEpoch(inputs.date, e.target.value) })} />
          </label>
          <span className="muted small time-summary">
            {time.mode === 'arrive' ? 'Framme senast' : 'Avgång tidigast'} {fmtDay(time.at)} {fmtTime(time.at)}
          </span>
        </div>
      )}
    </div>
  );
}
