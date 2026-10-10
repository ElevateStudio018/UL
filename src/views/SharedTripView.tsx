import { useCallback, useEffect, useRef, useState } from 'react';
import type { PairOption, ShareState, ShareStatus, TogetherResponse } from '../../shared/types';
import { DEFAULT_PREFS } from '../../shared/types';
import { fmtDay, fmtTime } from '../../shared/time';
import { api, ApiError } from '../lib/api';
import { pairLayers } from '../lib/layers';
import { liveHtml, personHtml, destHtml } from '../lib/markers';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { PlaceField, PlaceSearch } from '../components/place';
import { PairCard, PairSummary, STRATEGY_NAMES, Timeline } from '../components/trip';
import { DemoBadge, Icon, Notice, Segmented, Skeleton, Spinner, ago, useNow } from '../components/ui';

const STATUS: { value: ShareStatus; label: string }[] = [
  { value: 'leaving', label: 'Jag går nu' },
  { value: 'atStop', label: 'Vid hållplatsen' },
  { value: 'onBus', label: 'På bussen' },
  { value: 'arrived', label: 'Framme' },
];
const statusText = (s: ShareStatus) => STATUS.find((x) => x.value === s)?.label ?? 'Ingen status ännu';

export function SharedTripView({ id }: { id: string }) {
  const tokens = useStore((s) => s.shareTokens);
  const set = useStore((s) => s.set);
  const prefs = useStore((s) => s.settings.prefs);
  const sharePlace = useStore((s) => s.sharePlace);
  const searchTarget = useStore((s) => s.searchTarget);
  const setField = useStore((s) => s.setField);
  const addRecent = useStore((s) => s.addRecent);
  const token = tokens[id];
  const [share, setShare] = useState<ShareState | null>(null);
  const [you, setYou] = useState<0 | 1 | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<TogetherResponse | null>(null);
  const [liveMinutes, setLiveMinutes] = useState('30');
  const [liveError, setLiveError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const now = useNow(5000);

  const load = useCallback(async () => {
    try {
      const r = await api.share.get(id, token);
      setShare(r.share);
      setYou(r.you);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Kartan: bådas resor, mötesplats, destination och frivilliga livepositioner.
  useEffect(() => {
    if (!share) return;
    const names: [string, string] = [share.participants[0].name, share.participants[1].name];
    let layers = share.option ? pairLayers(share.option, names, share.destination) : { lines: [], markers: [], points: [] as { lat: number; lng: number }[] };
    if (!share.option) {
      const markers = [{ id: 'dest', pos: share.destination, html: destHtml(), title: share.destination.name, z: 22 }];
      share.participants.forEach((p, i) => p.origin && markers.push({ id: `origin-${i}`, pos: p.origin, html: personHtml(i as 0 | 1, p.name), title: `${p.name} startar här`, z: 20 }));
      layers = { lines: [], markers, points: markers.map((m) => m.pos) };
    }
    share.participants.forEach((p, i) => {
      if (p.live) layers.markers.push({ id: `live-${i}`, pos: p.live, html: liveHtml(i as 0 | 1, p.name), title: `${p.name}s delade position, ${ago(p.live.at)}`, z: 40 });
    });
    set({ overlay: { lines: layers.lines, markers: layers.markers } });
    return () => set({ overlay: null });
  }, [share, set]);

  const focused = useRef(false);
  useEffect(() => {
    if (!share || focused.current) return;
    focused.current = true;
    const pts = [share.destination, ...share.participants.flatMap((p) => (p.origin ? [p.origin] : []))];
    useStore.getState().focus(pts);
  }, [share]);

  // Stoppa livedelning när vyn lämnas.
  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  if (error && !share)
    return (
      <div className="pad-block">
        <Notice kind="error" title={error.status === 404 ? 'Reselänken fungerar inte' : 'Kunde inte hämta resan'} action={<button className="btn btn-secondary btn-sm" onClick={() => navigate('planera')}>Till reseplaneraren</button>}>
          {error.message}
        </Notice>
      </div>
    );
  if (!share) return <Skeleton lines={4} />;

  const names: [string, string] = [share.participants[0].name, share.participants[1].name];
  const me = you != null ? share.participants[you] : null;
  const other = you != null ? share.participants[1 - you] : null;

  const join = async () => {
    setBusy(true);
    try {
      const r = await api.share.join(id, name.trim() || names[1], sharePlace ?? undefined);
      set({ shareTokens: { ...tokens, [id]: r.token }, sharePlace: null });
      setShare(r.share);
      setYou(1);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const update = async (patch: Parameters<typeof api.share.update>[2]) => {
    if (!token) return;
    try {
      setShare((await api.share.update(id, token, patch)).share);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const findOptions = async () => {
    const [a, b] = share.participants;
    if (!a.origin || !b.origin) return;
    setBusy(true);
    try {
      const time = share.time.mode === 'now' ? { mode: 'now' as const, at: Date.now() } : share.time;
      setSuggest(await api.together({ persons: [a.origin, b.origin], names, destination: share.destination, time, strategy: share.strategy, tolerance: share.tolerance, prefs: prefs ?? DEFAULT_PREFS }));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (o: PairOption) => {
    await update({ option: o });
    setSuggest(null);
  };

  const startLive = () => {
    setLiveError(null);
    if (!('geolocation' in navigator) || !token) return setLiveError('Din webbläsare kan inte dela position.');
    const minutes = Number(liveMinutes);
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        if (!first && Date.now() - lastSent.current < 15_000) return;
        lastSent.current = Date.now();
        try {
          const r = await api.share.live(id, token, { lat: pos.coords.latitude, lng: pos.coords.longitude }, first ? minutes : 0);
          first = false;
          setShare(r.share);
          const mine = r.share.participants[you!].live;
          if (!mine || mine.until < Date.now()) stopLive();
        } catch (e) {
          setLiveError((e as Error).message);
        }
      },
      (err) => {
        setLiveError(err.code === err.PERMISSION_DENIED ? 'Platsåtkomst nekad. Du kan fortfarande använda statusknapparna.' : 'Positionen kunde inte bestämmas.');
        stopLive();
      },
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
  };

  const stopLive = async () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (token) {
      try {
        setShare((await api.share.stopLive(id, token)).share);
      } catch {
        /* ignoreras */
      }
    }
  };

  const myLive = me?.live && me.live.until > now ? me.live : null;

  return (
    <div className="detail shared">
      <div className="detail-head">
        <button className="icon-btn" onClick={() => navigate('planera')} aria-label="Till reseplaneraren">
          <Icon name="back" />
        </button>
        <div>
          <h2 className="h-title">Resa till {share.destination.name}</h2>
          <div className="muted small">
            {STRATEGY_NAMES[share.strategy]} · {share.time.mode === 'now' ? 'Åk nu' : `${share.time.mode === 'arrive' ? 'Framme senast' : 'Avgå tidigast'} ${fmtDay(share.time.at)} ${fmtTime(share.time.at)}`}
          </div>
        </div>
        {share.demo && <DemoBadge />}
      </div>

      {myLive && (
        <div className="live-banner" role="status">
          <span className="live-pulse" aria-hidden />
          <span>
            Du delar din position med {other?.name} till {fmtTime(myLive.until)}.
          </span>
          <button className="btn btn-danger btn-sm" onClick={stopLive}>
            Sluta dela
          </button>
        </div>
      )}
      {myLive && watchId.current == null && <Notice kind="warn">Positionen uppdateras inte just nu. Starta om delningen eller stoppa den.</Notice>}

      {you == null && !share.participants[1].joined && (
        <section className="card join">
          <h3>{names[0]} vill resa tillsammans med dig</h3>
          <p className="small">Ange ditt namn och var du startar, så hittar vi en gemensam resa. Inget konto behövs.</p>
          <label className="field">
            <span>Ditt namn</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={names[1]} maxLength={40} />
          </label>
          <PlaceField label="Din startplats" value={sharePlace ?? undefined} target="share-origin" color="var(--p2)" />
          <p className="muted small">Din startplats visas för {names[0]}. Välj gärna en hållplats i närheten om du inte vill dela exakt adress.</p>
          <button className="btn btn-primary btn-block" onClick={join} disabled={busy}>
            {busy && <Spinner />} Gå med i resan
          </button>
        </section>
      )}
      {you == null && share.participants[1].joined && <Notice kind="warn" title="Resan har redan två deltagare">Be den som delade länken att skapa en ny om du ska vara med.</Notice>}

      <section className="participants">
        {share.participants.map((p, i) => (
          <div key={i} className={`participant p${i + 1}`}>
            <span className="person-dot" aria-hidden />
            <div>
              <strong>
                {p.name}
                {you === i ? ' (du)' : ''}
              </strong>
              <div className="small">
                {!p.joined ? 'Har inte öppnat länken än' : statusText(p.status)}
                {p.statusAt ? ` · ${ago(p.statusAt, now)}` : ''}
              </div>
              <div className="small">
                {p.confirmed ? (
                  <span className="ok">
                    <Icon name="check" size={14} /> Har bekräftat planen
                  </span>
                ) : (
                  <span className="muted">Inte bekräftat</span>
                )}
                {p.live && p.live.until > now && <span className="live-tag"> · Delar position ({ago(p.live.at, now)})</span>}
              </div>
            </div>
          </div>
        ))}
      </section>

      {me && !me.origin && (
        <section className="card">
          <PlaceField label="Din startplats" value={sharePlace ?? undefined} target="share-origin" color={you === 0 ? 'var(--p1)' : 'var(--p2)'} />
          <button className="btn btn-primary btn-block" disabled={!sharePlace} onClick={() => sharePlace && update({ origin: sharePlace })}>
            Spara startplats
          </button>
        </section>
      )}

      {share.option ? (
        <section>
          <h3 className="section-title">Vald plan</h3>
          <PairSummary option={share.option} names={names} />
          <p className="explain">{share.option.explanation}</p>
          {share.option.persons.map((p, i) => (
            <details key={i} className={`person-section p${i + 1}`} open={you === i}>
              <summary className="person-heading">
                <span className="person-dot" aria-hidden /> {names[i]}: gå {fmtTime(p.leaveAt)}, framme {fmtTime(p.arriveAt)}
              </summary>
              <Timeline it={p.itinerary} destination={share.destination.name} color={i === 0 ? 'var(--p1)' : 'var(--p2)'} />
            </details>
          ))}
          {me && (
            <button className={`btn btn-block ${me.confirmed ? 'btn-secondary' : 'btn-primary'}`} onClick={() => update({ confirmed: !me.confirmed })} aria-pressed={me.confirmed}>
              <Icon name="check" size={18} /> {me.confirmed ? 'Du har bekräftat – ångra' : 'Bekräfta planen'}
            </button>
          )}
        </section>
      ) : (
        me && <Notice kind="info">Ingen plan är vald ännu.</Notice>
      )}

      {me && share.participants.every((p) => p.origin) && (
        <button className="btn btn-secondary btn-block" onClick={findOptions} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" size={18} />} {share.option ? 'Föreslå en annan plan' : 'Hitta förslag för oss'}
        </button>
      )}
      {suggest && (
        <section className="results">
          {suggest.noMatchReason && <Notice kind="info" title="Ingen rimlig matchning">{suggest.noMatchReason}</Notice>}
          {suggest.options.map((o) => (
            <div key={o.id}>
              <PairCard option={o} names={names} onOpen={() => void choose(o)} />
            </div>
          ))}
          {suggest.options.length > 0 && <p className="muted small">Tryck på ett förslag för att välja det. Den andra personen behöver bekräfta igen.</p>}
        </section>
      )}

      {me && (
        <section className="card">
          <h3>Min status</h3>
          <div className="status-grid">
            {STATUS.map((st) => (
              <button key={st.value} className={`btn btn-secondary ${me.status === st.value ? 'active' : ''}`} aria-pressed={me.status === st.value} onClick={() => update({ status: st.value })}>
                {me.status === st.value && <Icon name="check" size={16} />} {st.label}
              </button>
            ))}
          </div>
          <h3>Dela min position</h3>
          <p className="small muted">Frivilligt och tidsbegränsat. Bara den senaste punkten sparas, och delningen slutar automatiskt. Den fortsätter bara medan sidan är öppen.</p>
          {!myLive ? (
            <div className="row gap wrap">
              <Segmented
                label="Hur länge"
                size="sm"
                value={liveMinutes}
                onChange={setLiveMinutes}
                options={[
                  { value: '15', label: '15 min' },
                  { value: '30', label: '30 min' },
                  { value: '60', label: '1 h' },
                ]}
              />
              <button className="btn btn-secondary" onClick={startLive}>
                <Icon name="gps" size={18} /> Dela position
              </button>
            </div>
          ) : (
            <button className="btn btn-danger btn-block" onClick={stopLive}>
              Sluta dela position nu
            </button>
          )}
          {liveError && <Notice kind="warn">{liveError}</Notice>}
        </section>
      )}

      {you === 0 && (
        <button
          className="link-btn danger"
          onClick={async () => {
            if (!token || !confirm('Avsluta delningen? Länken slutar fungera för båda.')) return;
            await api.share.remove(id, token).catch(() => null);
            navigate('planera');
          }}
        >
          <Icon name="trash" size={16} /> Avsluta delningen
        </button>
      )}
      <p className="muted small">
        Länken gäller till {fmtDay(share.expiresAt)} {fmtTime(share.expiresAt)}.
      </p>

      {searchTarget === 'share-origin' && (
        <PlaceSearch
          target="share-origin"
          title="Din startplats"
          onClose={() => set({ searchTarget: null })}
          onSelect={(p) => {
            setField('share-origin', p);
            addRecent(p);
            set({ searchTarget: null });
          }}
        />
      )}
    </div>
  );
}
