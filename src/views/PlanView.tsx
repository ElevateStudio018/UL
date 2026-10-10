import { useEffect, useState } from 'react';
import type { Itinerary, PairOption } from '../../shared/types';
import { fmtTime, minutes } from '../../shared/time';
import { transitLegs } from '../../shared/legs';
import { api, ApiError } from '../lib/api';
import { refreshItinerary } from '../lib/refresh';
import { cancel, ensurePermission, isScheduled, schedule } from '../lib/reminders';
import { useStore } from '../lib/store';
import { freshness } from '../lib/markers';
import { PlaceField, TimePicker } from '../components/place';
import { ItineraryCard, ItineraryWarnings, PairCard, PairSummary, STRATEGY_NAMES, Timeline } from '../components/trip';
import { DemoBadge, Icon, Notice, Segmented, Skeleton, Spinner, ago, useNow } from '../components/ui';
import { ShareDialog } from './ShareDialog';

export function PrefsEditor() {
  const prefs = useStore((s) => s.settings.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  return (
    <div className="prefs">
      <div className="pref-row">
        <span className="pref-label">Prioritera</span>
        <Segmented
          label="Prioritera"
          size="sm"
          value={prefs.preference}
          onChange={(preference) => setPrefs({ preference })}
          options={[
            { value: 'balanced', label: 'Balans' },
            { value: 'fewTransfers', label: 'Färre byten' },
            { value: 'lessWalking', label: 'Kortare gång' },
          ]}
        />
      </div>
      <div className="pref-row">
        <span className="pref-label">Gångtempo</span>
        <Segmented
          label="Gångtempo"
          size="sm"
          value={String(prefs.walkSpeed)}
          onChange={(v) => setPrefs({ walkSpeed: Number(v) })}
          options={[
            { value: '1', label: 'Lugnt' },
            { value: '1.33', label: 'Normalt' },
            { value: '1.7', label: 'Raskt' },
          ]}
        />
      </div>
      <div className="pref-row">
        <span className="pref-label">Bytesmarginal</span>
        <Segmented
          label="Minsta bytesmarginal"
          size="sm"
          value={String(prefs.minTransfer)}
          onChange={(v) => setPrefs({ minTransfer: Number(v) })}
          options={[
            { value: '2', label: '2 min' },
            { value: '3', label: '3 min' },
            { value: '5', label: '5 min' },
            { value: '8', label: '8 min' },
          ]}
        />
      </div>
    </div>
  );
}

function NameInput({ index }: { index: 0 | 1 }) {
  const names = useStore((s) => s.names);
  const set = useStore((s) => s.set);
  return (
    <label className={`name-input p${index + 1}`}>
      <span className="sr-only">Namn på person {index + 1}</span>
      <Icon name="edit" size={14} />
      <input
        value={names[index]}
        maxLength={40}
        onChange={(e) => {
          const n = [...names] as [string, string];
          n[index] = e.target.value;
          set({ names: n });
        }}
        onBlur={(e) => {
          if (!e.target.value.trim()) {
            const n = [...names] as [string, string];
            n[index] = `Person ${index + 1}`;
            set({ names: n });
          }
        }}
      />
    </label>
  );
}

export function LeaveCountdown({ leaveAt }: { leaveAt: number }) {
  const margin = useStore((s) => s.settings.leaveMargin);
  const now = useNow(10_000);
  const left = Math.round((leaveAt - margin * 60_000 - now) / 60000);
  if (leaveAt - now > 3 * 3600_000) return null;
  let text: string;
  let kind = 'ok';
  if (left > 1) text = `Gå om ${left} min`;
  else if (left >= -1) {
    text = 'Dags att gå nu';
    kind = 'now';
  } else if (leaveAt - now > -60_000) {
    text = 'Gå direkt – du har ingen marginal kvar';
    kind = 'late';
  } else {
    text = 'Avresetiden har passerat';
    kind = 'late';
  }
  return (
    <div className={`countdown countdown-${kind}`} role="timer" aria-live="polite">
      <Icon name="clock" size={18} />
      <strong>{text}</strong>
      <span className="muted small">
        Gå hemifrån {fmtTime(leaveAt)}
        {margin ? ` · ${margin} min marginal` : ''}
      </span>
    </div>
  );
}

function VehicleStatus({ it }: { it: Itinerary }) {
  const vehicles = useStore((s) => s.vehicles);
  const meta = useStore((s) => s.vehiclesMeta);
  const now = useNow(5000);
  const legs = transitLegs(it.legs).filter((l) => l.rt !== 'cancelled');
  if (!legs.length) return null;
  const leg = legs.find((l) => l.arr.scheduled > now) ?? legs[0];
  const v = vehicles.find((x) => x.tripId === leg.tripId && x.serviceDate === leg.serviceDate);
  const f = v ? freshness(v, now) : null;
  return (
    <div className="veh-status">
      <Icon name="bus" size={18} />
      <span>
        Linje {leg.line} {fmtTime(leg.dep.scheduled)}:{' '}
        {!meta?.available ? (
          'Realtidsposition saknas – realtidsdata är inte konfigurerad.'
        ) : !v || f === 'old' ? (
          'Realtidsposition saknas för den här turen.'
        ) : (
          <>
            {v.source === 'simulated' ? 'Simulerad position (demo)' : f === 'fresh' ? 'Aktuell GPS-position' : 'Gammal positionsuppgift'}, uppdaterad {ago(v.timestamp, now)}.
            {v.nextStop && ` Nästa hållplats: ${v.nextStop}.`}
          </>
        )}
      </span>
    </div>
  );
}

function useLiveRefresh(it: Itinerary | undefined, onUpdate: (it: Itinerary) => void) {
  const minTransfer = useStore((s) => s.settings.prefs.minTransfer);
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  useEffect(() => {
    if (!it || !navigator.onLine) return;
    const id = setInterval(async () => {
      const fresh = await refreshItinerary(it, minTransfer).catch(() => null);
      if (fresh) {
        onUpdate(fresh);
        setUpdatedAt(Date.now());
      }
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it?.id, minTransfer]);
  return updatedAt;
}

function reminderItems(it: Itinerary, margin: number, who?: string) {
  const prefix = who ? `${who}: ` : '';
  const items = [{ at: it.start - margin * 60_000, title: 'Dags att gå', body: `${prefix}Gå nu för att hinna till ${transitLegs(it.legs)[0]?.from.name ?? 'resan'}.` }];
  transitLegs(it.legs).forEach((l, i, all) => {
    const arr = l.arr.estimated ?? l.arr.scheduled;
    items.push({ at: arr - 2 * 60_000, title: i < all.length - 1 ? 'Byte snart' : 'Snart framme', body: `${prefix}Kliv av vid ${l.to.name} om ca 2 min${i < all.length - 1 ? ` och byt till linje ${all[i + 1].line}` : ''}.` });
  });
  return items;
}

function ReminderButton({ group, items }: { group: string; items: { at: number; title: string; body: string }[] }) {
  const [on, setOn] = useState(isScheduled(group));
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async () => {
    if (on) {
      cancel(group);
      setOn(false);
      setMsg(null);
      return;
    }
    const perm = await ensurePermission();
    if (perm === 'unsupported') return setMsg('Din webbläsare stöder inte påminnelser. På iPhone krävs att appen är tillagd på hemskärmen.');
    if (perm === 'denied') return setMsg('Notiser är blockerade. Tillåt notiser för sidan i webbläsarens inställningar.');
    const n = schedule(group, items);
    setOn(n > 0);
    setMsg(n > 0 ? `${n} påminnelser inför avresa, byten och avstigning. De fungerar medan appen är öppen eller ligger i bakgrunden.` : 'Det finns inga kommande tider att påminna om.');
  };
  return (
    <>
      <button type="button" className={`btn btn-secondary ${on ? 'active' : ''}`} onClick={toggle} aria-pressed={on}>
        <Icon name="bell" size={18} /> {on ? 'Påminnelser på' : 'Påminn mig'}
      </button>
      {msg && <p className="muted small full-row">{msg}</p>}
    </>
  );
}

function ItineraryDetail({ it, destination, onBack }: { it: Itinerary; destination: string; onBack: () => void }) {
  const set = useStore((s) => s.set);
  const fields = useStore((s) => s.fields);
  const margin = useStore((s) => s.settings.leaveMargin);
  const updatedAt = useLiveRefresh(it, (fresh) => set({ selection: { kind: 'itinerary', itinerary: fresh } }));
  const [saved, setSaved] = useState(false);

  const alternative = () => {
    set({ selection: null, time: { mode: 'now', at: Date.now() } });
    window.dispatchEvent(new CustomEvent('samak:search'));
  };
  const planReturn = () => {
    const { from, to } = fields;
    set({ fields: { ...fields, from: to, to: from }, time: { mode: 'depart', at: it.end + 2 * 3600_000 }, selection: null, soloResults: null });
  };
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="Tillbaka till resultat">
          <Icon name="back" />
        </button>
        <div>
          <h2 className="h-title">
            {fmtTime(it.start)} – {fmtTime(it.end)}
          </h2>
          <div className="muted small">
            {minutes(it.end - it.start)} min · {it.transfers === 0 ? 'inga byten' : `${it.transfers} byten`} · {minutes(it.walkDuration)} min gång
          </div>
        </div>
        {it.demo && <DemoBadge />}
      </div>
      <LeaveCountdown leaveAt={it.start} />
      <ItineraryWarnings it={it} onAlternative={alternative} />
      <VehicleStatus it={it} />
      <Timeline it={it} destination={destination} />
      <p className="muted small">Realtid kontrolleras var 30:e sekund. Senast {fmtTime(updatedAt)}.</p>
      <div className="actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            set({ savedTrip: { kind: 'solo', itinerary: it, destination, savedAt: Date.now() } });
            setSaved(true);
          }}
        >
          <Icon name="check" size={18} /> {saved ? 'Sparad för offline' : 'Spara för offline'}
        </button>
        <ReminderButton group={`solo-${it.id}`} items={reminderItems(it, margin)} />
        <button type="button" className="btn btn-secondary" onClick={planReturn}>
          <Icon name="swap" size={18} /> Planera hemresan
        </button>
        <button type="button" className="btn btn-secondary mobile-only" onClick={() => set({ sheetSnap: 'peek' })}>
          <Icon name="map" size={18} /> Visa på kartan
        </button>
      </div>
    </div>
  );
}

function PairDetail({ option, onBack }: { option: PairOption; onBack: () => void }) {
  const names = useStore((s) => s.names);
  const dest = useStore((s) => s.fields.dest);
  const set = useStore((s) => s.set);
  const margin = useStore((s) => s.settings.leaveMargin);
  const [tab, setTab] = useState<'both' | '0' | '1'>('both');
  const [share, setShare] = useState(false);
  const [saved, setSaved] = useState(false);
  const destName = dest?.name ?? 'Destinationen';
  const demo = option.persons[0].itinerary.demo;

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="Tillbaka till förslagen">
          <Icon name="back" />
        </button>
        <div>
          <h2 className="h-title">{STRATEGY_NAMES[option.strategy]}</h2>
          <div className="muted small">Till {destName}</div>
        </div>
        {demo && <DemoBadge />}
      </div>
      <PairSummary option={option} names={names} />
      <p className="explain">{option.explanation}</p>
      <div className="person-times">
        {option.persons.map((p, i) => (
          <div key={i} className={`person-time p${i + 1}`}>
            <span className="person-dot" aria-hidden />
            <div>
              <strong>{names[i]}</strong>
              <div className="small">
                Gå {fmtTime(p.leaveAt)} · framme {fmtTime(p.arriveAt)} · {p.total} min
              </div>
            </div>
          </div>
        ))}
      </div>
      {option.persons.map((p, i) => (p.itinerary.warnings.length ? <ItineraryWarnings key={i} it={p.itinerary} /> : null))}
      <Segmented
        label="Visa resa för"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'both', label: 'Båda' },
          { value: '0', label: names[0] },
          { value: '1', label: names[1] },
        ]}
      />
      {option.persons.map((p, i) =>
        tab === 'both' || tab === String(i) ? (
          <section key={i} className={`person-section p${i + 1}`}>
            <h3 className="person-heading">
              <span className="person-dot" aria-hidden /> {names[i]}
            </h3>
            <LeaveCountdown leaveAt={p.leaveAt} />
            <VehicleStatus it={p.itinerary} />
            <Timeline it={p.itinerary} destination={destName} color={i === 0 ? 'var(--p1)' : 'var(--p2)'} />
          </section>
        ) : null,
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => setShare(true)}>
          <Icon name="share" size={18} /> Dela resan
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            set({ savedTrip: { kind: 'pair', pair: option, names, destination: destName, savedAt: Date.now() } });
            setSaved(true);
          }}
        >
          <Icon name="check" size={18} /> {saved ? 'Sparad för offline' : 'Spara för offline'}
        </button>
        <ReminderButton group={`pair-${option.id}`} items={reminderItems(option.persons[0].itinerary, margin, names[0])} />
        <button type="button" className="btn btn-secondary mobile-only" onClick={() => set({ sheetSnap: 'peek' })}>
          <Icon name="map" size={18} /> Visa på kartan
        </button>
      </div>
      {share && <ShareDialog option={option} onClose={() => setShare(false)} />}
    </div>
  );
}

const STRATEGIES = [
  { value: 'sameBus', label: 'Samma buss', desc: 'Kliv på samma tur, vid samma eller olika hållplatser.' },
  { value: 'meet', label: 'Mötas på vägen', desc: 'Träffas vid en hållplats och fortsätt tillsammans.' },
  { value: 'arriveTogether', label: 'Framme samtidigt', desc: 'Separata resor med liten skillnad i ankomsttid.' },
] as const;

export function PlanView() {
  const s = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { fields, mode, names } = s;

  const search = async () => {
    setFormError(null);
    setError(null);
    const pts = mode === 'solo' ? [fields.from, fields.to] : [fields.p1, fields.p2, fields.dest];
    if (pts.some((p) => !p)) {
      setFormError(mode === 'solo' ? 'Välj både Från och Till.' : `Välj startplats för ${names[0]} och ${names[1]} samt gemensam destination.`);
      return;
    }
    setLoading(true);
    s.set({ soloResults: null, togetherResult: null, selection: null });
    try {
      const time = s.time.mode === 'now' ? { mode: 'now' as const, at: Date.now() } : s.time;
      if (mode === 'solo') {
        const r = await api.plan({ from: fields.from!, to: fields.to!, time, prefs: s.settings.prefs });
        s.set({ soloResults: r.itineraries });
        s.focus([fields.from!, fields.to!]);
      } else {
        const r = await api.together({ persons: [fields.p1!, fields.p2!], names, destination: fields.dest!, time, strategy: s.strategy, tolerance: s.tolerance, prefs: s.settings.prefs });
        s.set({ togetherResult: r });
        s.focus([fields.p1!, fields.p2!, fields.dest!]);
      }
      if (window.innerWidth < 900) s.set({ sheetSnap: 'full' });
      requestAnimationFrame(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message, 0));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const on = () => void search();
    window.addEventListener('samak:search', on);
    return () => window.removeEventListener('samak:search', on);
  });

  const open = (sel: NonNullable<typeof s.selection>) => {
    s.set({ selection: sel, sheetSnap: 'half' });
    const its = sel.kind === 'itinerary' ? [sel.itinerary] : sel.option.persons.map((p) => p.itinerary);
    const pts = its.flatMap((it) => it.legs.flatMap((l) => (l.kind === 'transit' ? [l.from, l.to] : l.kind === 'walk' ? [l.from, l.to] : [l.at])));
    s.focus(pts);
  };

  if (s.selection?.kind === 'itinerary') return <ItineraryDetail it={s.selection.itinerary} destination={fields.to?.name ?? 'Destinationen'} onBack={() => s.set({ selection: null })} />;
  if (s.selection?.kind === 'pair') return <PairDetail option={s.selection.option} onBack={() => s.set({ selection: null })} />;

  const swap = () => s.set({ fields: { ...fields, from: fields.to, to: fields.from }, soloResults: null });
  const r = s.togetherResult;

  return (
    <div className="plan">
      <Segmented
        label="Läge"
        value={mode}
        onChange={(m) => s.set({ mode: m, soloResults: null, togetherResult: null })}
        options={[
          { value: 'solo', label: 'Res själv', icon: 'person' },
          { value: 'together', label: 'Res tillsammans', icon: 'people' },
        ]}
      />

      <form
        className="plan-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        {mode === 'solo' ? (
          <div className="fields-box">
            <PlaceField label="Från" value={fields.from} target="from" color="var(--accent)" placeholder="Min position, adress eller hållplats" onClear={() => s.setField('from', undefined)} />
            <button type="button" className="icon-btn swap-btn" onClick={swap} aria-label="Byt plats på Från och Till">
              <Icon name="swap" size={18} />
            </button>
            <PlaceField label="Till" value={fields.to} target="to" color="var(--text)" onClear={() => s.setField('to', undefined)} />
          </div>
        ) : (
          <>
            <div className="fields-box">
              <div className="person-field">
                <NameInput index={0} />
                <PlaceField label={`${names[0]} – från`} value={fields.p1} target="p1" color="var(--p1)" placeholder="Min position, adress eller hållplats" onClear={() => s.setField('p1', undefined)} />
              </div>
              <div className="person-field">
                <NameInput index={1} />
                <PlaceField label={`${names[1]} – från`} value={fields.p2} target="p2" color="var(--p2)" onClear={() => s.setField('p2', undefined)} />
              </div>
              <PlaceField label="Gemensam destination" value={fields.dest} target="dest" color="var(--text)" onClear={() => s.setField('dest', undefined)} />
            </div>
            {!fields.p2 && fields.dest && (
              <button type="button" className="link-btn" onClick={() => setInviteOpen(true)}>
                <Icon name="link" size={16} /> Vet du inte var {names[1]} startar? Skicka en länk så fyller hen i själv.
              </button>
            )}
          </>
        )}

        <TimePicker />

        {mode === 'together' && (
          <fieldset className="strategy">
            <legend>Hur vill ni resa?</legend>
            {STRATEGIES.map((st) => (
              <label key={st.value} className={`strategy-opt ${s.strategy === st.value ? 'active' : ''}`}>
                <input type="radio" name="strategy" value={st.value} checked={s.strategy === st.value} onChange={() => s.set({ strategy: st.value, togetherResult: null })} />
                <span>
                  <strong>{st.label}</strong>
                  <span className="muted small">{st.desc}</span>
                </span>
              </label>
            ))}
            {s.strategy === 'arriveTogether' && (
              <div className="pref-row">
                <span className="pref-label">Högst skillnad</span>
                <Segmented
                  label="Högsta skillnad i ankomsttid"
                  size="sm"
                  value={String(s.tolerance)}
                  onChange={(v) => s.set({ tolerance: Number(v), togetherResult: null })}
                  options={[
                    { value: '5', label: '5 min' },
                    { value: '10', label: '10 min' },
                    { value: '15', label: '15 min' },
                  ]}
                />
              </div>
            )}
          </fieldset>
        )}

        <details className="more">
          <summary>Fler alternativ</summary>
          <PrefsEditor />
        </details>

        {formError && <Notice kind="warn">{formError}</Notice>}
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? <Spinner label="Söker resor" /> : <Icon name="search" size={18} />}
          {mode === 'solo' ? 'Hitta resa' : 'Hitta gemensam resa'}
        </button>
      </form>

      {loading && (
        <div className="results" aria-busy>
          <Skeleton />
          <Skeleton />
          <Skeleton lines={2} />
        </div>
      )}

      {error && (
        <Notice kind="error" title={error.network ? 'Nätverksfel' : 'Kunde inte hämta resor'} action={<button className="btn btn-secondary btn-sm" onClick={() => void search()}>Försök igen</button>}>
          {error.message}
        </Notice>
      )}

      {s.soloResults && (
        <section id="results" className="results" aria-label="Resealternativ">
          <h2 className="section-title">
            Resealternativ {s.soloResults[0]?.demo && <DemoBadge />}
          </h2>
          {!s.soloResults.length && (
            <Notice kind="info" title="Ingen resa hittades">
              Prova en annan tid, en närliggande hållplats eller tillåt längre gångväg under ”Fler alternativ”.
            </Notice>
          )}
          {s.soloResults.map((it) => (
            <ItineraryCard key={it.id} it={it} onOpen={() => open({ kind: 'itinerary', itinerary: it })} />
          ))}
        </section>
      )}

      {r && (
        <section id="results" className="results" aria-label="Gemensamma förslag">
          <h2 className="section-title">
            {STRATEGY_NAMES[s.strategy]} {r.demo && <DemoBadge />}
          </h2>
          {r.noMatchReason && (
            <Notice kind="info" title="Ingen rimlig matchning">
              <p>{r.noMatchReason}</p>
              <ul className="suggestions">
                {r.suggestions?.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </Notice>
          )}
          {r.options.map((o) => (
            <PairCard key={o.id} option={o} names={names} onOpen={() => open({ kind: 'pair', option: o })} />
          ))}
          {!r.options.length && (
            <>
              <h3 className="list-heading">Separata resor</h3>
              {r.solo.map((it, i) =>
                it ? (
                  <div key={i} className={`solo-wrap p${i + 1}`}>
                    <div className="person-heading">
                      <span className="person-dot" aria-hidden /> {names[i]}
                    </div>
                    <ItineraryCard it={it} onOpen={() => open({ kind: 'itinerary', itinerary: it })} />
                  </div>
                ) : null,
              )}
            </>
          )}
        </section>
      )}

      {!loading && !s.soloResults && !r && <OfflineTrip />}
      {inviteOpen && <ShareDialog onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function OfflineTrip() {
  const saved = useStore((s) => s.savedTrip);
  const set = useStore((s) => s.set);
  if (!saved) return null;
  const it = saved.itinerary ?? saved.pair?.persons[0].itinerary;
  if (!it || it.end < Date.now() - 3600_000) return null;
  return (
    <button
      type="button"
      className="card saved-trip"
      onClick={() => {
        if (saved.kind === 'solo' && saved.itinerary) set({ selection: { kind: 'itinerary', itinerary: saved.itinerary } });
        else if (saved.pair) set({ selection: { kind: 'pair', option: saved.pair }, names: saved.names ?? ['Person 1', 'Person 2'] });
      }}
    >
      <span className="muted small">Sparad resa · uppdaterad {fmtTime(saved.savedAt)}</span>
      <strong>
        {fmtTime(it.start)} → {saved.destination}
      </strong>
      <span className="small">Öppna – tiderna kan ha ändrats sedan dess.</span>
    </button>
  );
}
