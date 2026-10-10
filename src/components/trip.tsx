import { useState } from 'react';
import type { Itinerary, Leg, PairOption, TransitLeg } from '../../shared/types';
import { fmtDuration, fmtTime, minutes } from '../../shared/time';
import { effTime, legEnd, transitLegs } from '../../shared/legs';
import { Icon, LineBadge, Notice, RtTime, fmtDistance } from './ui';

export function rtSummary(it: Itinerary): { text: string; kind: 'live' | 'sched' | 'cancelled' | 'none' } {
  const t = transitLegs(it.legs);
  if (!t.length) return { text: 'Promenad', kind: 'none' };
  if (t.some((l) => l.rt === 'cancelled')) return { text: 'Inställd avgång', kind: 'cancelled' };
  if (t.every((l) => l.rt === 'realtime')) return { text: 'Realtid', kind: 'live' };
  if (t.some((l) => l.rt === 'realtime')) return { text: 'Delvis realtid', kind: 'live' };
  return { text: 'Enligt tidtabell', kind: 'sched' };
}

export function LegChips({ it }: { it: Itinerary }) {
  const out: JSX.Element[] = [];
  it.legs.forEach((l, i) => {
    if (l.kind === 'transit') out.push(<LineBadge key={i} line={l.line} mode={l.mode} cancelled={l.rt === 'cancelled'} />);
    else if (l.kind === 'walk' && l.distance >= 30 && (it.legs.length === 1 || (i > 0 && i < it.legs.length - 1)))
      out.push(
        <span key={i} className="chip-walk" aria-label={`Gå ${minutes(l.end - l.start)} minuter`}>
          <Icon name="walk" size={16} />
          {minutes(l.end - l.start)}
        </span>,
      );
  });
  return (
    <span className="leg-chips">
      {out.map((el, i) => (
        <span key={i} className="leg-chip-wrap">
          {i > 0 && <Icon name="chevron" size={14} className="muted" />}
          {el}
        </span>
      ))}
    </span>
  );
}

function firstTransit(it: Itinerary): TransitLeg | undefined {
  return transitLegs(it.legs)[0];
}

export function ItineraryCard({ it, onOpen, selected }: { it: Itinerary; onOpen: () => void; selected?: boolean }) {
  const ft = firstTransit(it);
  const rts = rtSummary(it);
  const firstWalk = it.legs[0].kind === 'walk' ? it.legs[0] : null;
  return (
    <button type="button" className={`card itin-card ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <div className="itin-top">
        <span className="itin-times">
          <span className="big-time">{fmtTime(it.start)}</span>
          <span className="muted">–</span>
          <span className="big-time">{fmtTime(it.end)}</span>
        </span>
        <span className="itin-dur">{fmtDuration(it.end - it.start)}</span>
      </div>
      <LegChips it={it} />
      <div className="itin-meta">
        {ft && (
          <span>
            Från <strong>{ft.from.name}</strong>
            {ft.from.platform ? `, läge ${ft.from.platform}` : ''} <RtTime time={ft.dep} rt={ft.rt} compact />
          </span>
        )}
      </div>
      <div className="itin-meta small">
        <span>{it.transfers === 0 ? 'Inga byten' : it.transfers === 1 ? '1 byte' : `${it.transfers} byten`}</span>
        <span aria-hidden>·</span>
        <span>
          <Icon name="walk" size={14} /> {minutes(it.walkDuration)} min gång
          {firstWalk && firstWalk.distance > 20 ? ` (${minutes(firstWalk.end - firstWalk.start)} min till hållplatsen)` : ''}
        </span>
        <span aria-hidden>·</span>
        <span className={`rt-dot rt-dot-${rts.kind}`}>{rts.text}</span>
      </div>
      {it.warnings.filter((w) => w.kind !== 'alert').map((w, i) => (
        <div key={i} className={`inline-warn ${w.kind === 'cancelled' || w.kind === 'missedTransfer' ? 'danger' : ''}`}>
          <Icon name="alert" size={16} /> {w.text}
        </div>
      ))}
      {it.warnings.some((w) => w.kind === 'alert') && (
        <div className="inline-warn">
          <Icon name="info" size={16} /> Trafikstörning berör resan
        </div>
      )}
    </button>
  );
}

function TransitBlock({ leg, color }: { leg: TransitLeg; color?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="tl-item tl-transit" style={color ? ({ '--tl-color': color } as React.CSSProperties) : undefined}>
      <div className="tl-rail" aria-hidden />
      <div className="tl-body">
        <div className="tl-row">
          <RtTime time={leg.dep} rt={leg.rt} strong />
          <div className="tl-place">
            <strong>{leg.from.name}</strong>
            {leg.from.platform && <span className="platform">Läge {leg.from.platform}</span>}
          </div>
        </div>
        <div className="tl-vehicle">
          <LineBadge line={leg.line} mode={leg.mode} size="lg" cancelled={leg.rt === 'cancelled'} />
          <div>
            <div>
              {leg.mode === 'train' ? 'Tåg' : 'Buss'} mot <strong>{leg.headsign}</strong>
            </div>
            <div className="muted small">
              {fmtDuration(effTime(leg.arr) - effTime(leg.dep))} · {leg.rt === 'realtime' ? 'Prognos från realtid' : leg.rt === 'cancelled' ? 'Inställd' : 'Enligt tidtabell – realtid saknas'}
            </div>
          </div>
        </div>
        {leg.alerts.map((a) => (
          <div key={a.id} className="inline-warn">
            <Icon name="info" size={16} />
            <span>
              <strong>{a.header}</strong>
              {a.description ? ` – ${a.description}` : ''}
            </span>
          </div>
        ))}
        {leg.intermediate.length > 0 && (
          <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'down' : 'chevron'} size={16} />
            {leg.intermediate.length} {leg.intermediate.length === 1 ? 'hållplats' : 'hållplatser'} emellan
          </button>
        )}
        {open && (
          <ol className="tl-stops">
            {leg.intermediate.map((s, i) => (
              <li key={i}>
                <RtTime time={s.time} rt={leg.rt} compact />
                <span>{s.stop.name}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="tl-row">
          <RtTime time={leg.arr} rt={leg.rt} strong />
          <div className="tl-place">
            Kliv av vid <strong>{leg.to.name}</strong>
            {leg.to.platform && <span className="platform">Läge {leg.to.platform}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Vertikal tidslinje: gå → hållplats → buss → byte → gå → destination. */
export function Timeline({ it, destination, color }: { it: Itinerary; destination: string; color?: string }) {
  const items: JSX.Element[] = [];
  const legs = it.legs;
  legs.forEach((l: Leg, i) => {
    const next = legs[i + 1];
    if (l.kind === 'walk') {
      if (l.distance < 20 && legs.length > 1) return;
      const toName = next?.kind === 'transit' ? next.from.name : i === legs.length - 1 ? destination : l.to.name;
      items.push(
        <li key={i} className="tl-item tl-walk">
          <div className="tl-rail" aria-hidden />
          <div className="tl-body">
            <div className="tl-row">
              <span className="time-main">{fmtTime(l.start)}</span>
              <div className="tl-place">{i === 0 ? <strong>{l.from.name}</strong> : <span className="muted">Från {l.from.name}</span>}</div>
            </div>
            <div className="tl-walkinfo">
              <Icon name="walk" size={18} />
              Gå {fmtDistance(l.distance)} · {fmtDuration(l.end - l.start)} till {toName}
              {l.estimated && <span className="rt-tag rt-sched">Uppskattad gångväg</span>}
            </div>
          </div>
        </li>,
      );
    } else if (l.kind === 'wait') {
      items.push(
        <li key={i} className="tl-item tl-wait">
          <div className="tl-rail" aria-hidden />
          <div className="tl-body">
            <div className="tl-walkinfo">
              <Icon name="clock" size={18} />
              Vänta {fmtDuration(l.end - l.start)} vid {l.at.name} – {l.reason.toLowerCase()}
            </div>
          </div>
        </li>,
      );
    } else {
      const prevTransit = [...legs.slice(0, i)].reverse().find((x): x is TransitLeg => x.kind === 'transit');
      if (prevTransit) {
        const walkBetween = legs.slice(legs.indexOf(prevTransit) + 1, i).reduce((s, x) => s + (x.kind === 'walk' ? x.end - x.start : 0), 0);
        const margin = Math.round((effTime(l.dep) - effTime(prevTransit.arr) - walkBetween) / 60000);
        items.push(
          <li key={`x${i}`} className={`tl-transfer ${margin < 2 ? 'warn' : ''}`}>
            <Icon name={margin < 2 ? 'alert' : 'swap'} size={16} />
            {margin < 0 ? `Bytet riskerar att missas (${margin} min)` : `Byte · ${margin} min marginal${margin < 2 ? ' – kort!' : ''}`}
          </li>,
        );
      }
      items.push(<TransitBlock key={i} leg={l} color={color} />);
    }
  });
  items.push(
    <li key="end" className="tl-item tl-end">
      <div className="tl-rail" aria-hidden />
      <div className="tl-body">
        <div className="tl-row">
          <span className="time-main strong">{fmtTime(legEnd(legs[legs.length - 1]))}</span>
          <div className="tl-place">
            <Icon name="pin" size={18} /> <strong>{destination}</strong>
          </div>
        </div>
      </div>
    </li>,
  );
  return <ol className="timeline">{items}</ol>;
}

export function ItineraryWarnings({ it, onAlternative }: { it: Itinerary; onAlternative?: () => void }) {
  const severe = it.warnings.filter((w) => w.kind === 'cancelled' || w.kind === 'missedTransfer');
  const other = it.warnings.filter((w) => w.kind === 'shortTransfer');
  return (
    <>
      {severe.map((w, i) => (
        <Notice key={i} kind="error" title={w.kind === 'cancelled' ? 'Inställd avgång' : 'Risk att missa bytet'} action={onAlternative && <button className="btn btn-secondary btn-sm" onClick={onAlternative}>Visa alternativ resa</button>}>
          {w.text}
        </Notice>
      ))}
      {other.map((w, i) => (
        <Notice key={`o${i}`} kind="warn" title="Kort bytesmarginal">
          {w.text}
        </Notice>
      ))}
    </>
  );
}

const LABELS: Record<string, string> = { best: 'Bästa matchningen', fastest: 'Snabbast tillsammans', leastEffort: 'Minst gång och byten' };
export const STRATEGY_NAMES = { sameBus: 'Samma buss', meet: 'Mötas på vägen', arriveTogether: 'Framme samtidigt' } as const;

export function PairCard({ option, names, onOpen }: { option: PairOption; names: [string, string]; onOpen: () => void }) {
  return (
    <button type="button" className="card pair-card" onClick={onOpen}>
      <div className="pair-labels">
        {option.labels.length ? option.labels.map((l) => <span key={l} className={`label label-${l}`}>{LABELS[l]}</span>) : <span className="label label-alt">Alternativ</span>}
      </div>
      {option.persons.map((p, i) => {
        const ft = firstTransit(p.itinerary);
        return (
          <div key={i} className={`pair-person p${i + 1}`}>
            <span className="person-dot" aria-hidden />
            <div className="pair-person-main">
              <div className="pair-person-head">
                <strong>{names[i]}</strong>
                <span className="muted small">
                  {fmtDuration(p.total * 60000)}
                  {p.detour > 3 ? ` · +${p.detour} min omväg` : ''}
                </span>
              </div>
              <div className="pair-person-row">
                <span>
                  Gå <strong className="big-time-sm">{fmtTime(p.leaveAt)}</strong>
                </span>
                <LegChips it={p.itinerary} />
                <span>
                  Framme <strong className="big-time-sm">{fmtTime(p.arriveAt)}</strong>
                </span>
              </div>
              {ft && (
                <div className="muted small">
                  {ft.from.name}
                  {ft.from.platform ? `, läge ${ft.from.platform}` : ''} · <RtTime time={ft.dep} rt={ft.rt} compact />
                  {ft.rt !== 'realtime' && ' enligt tidtabell'}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <PairSummary option={option} names={names} />
      <p className="explain">{option.explanation}</p>
    </button>
  );
}

export function PairSummary({ option, names }: { option: PairOption; names: [string, string] }) {
  const s = option.shared;
  const waits = option.persons.map((p) => p.wait);
  return (
    <div className="pair-summary">
      {option.strategy === 'meet' && option.meeting && (
        <div>
          <Icon name="people" size={16} /> Möts vid <strong>{option.meeting.name}</strong> {fmtTime(option.meeting.time)}
          {Math.max(...waits) >= 1 && (
            <span className="muted">
              {' '}
              · {waits[0] >= waits[1] ? names[0] : names[1]} väntar {Math.round(Math.max(...waits))} min
            </span>
          )}
        </div>
      )}
      {s && !s.walkTogether && s.tripId && (
        <div>
          <Icon name="bus" size={16} /> Tillsammans på linje <strong>{s.line}</strong> {fmtTime(s.start)}–{fmtTime(s.end)}, {s.from.name} → {s.to.name}
        </div>
      )}
      {s?.walkTogether && (
        <div>
          <Icon name="walk" size={16} /> Går tillsammans sista biten från {s.from.name}
        </div>
      )}
      {option.strategy !== 'meet' && (
        <div>
          <Icon name="clock" size={16} />{' '}
          {option.arrivalDiff === 0 ? 'Framme samtidigt' : `${option.persons[0].arriveAt < option.persons[1].arriveAt ? names[0] : names[1]} är framme ${option.arrivalDiff} min före och väntar`}
        </div>
      )}
    </div>
  );
}

