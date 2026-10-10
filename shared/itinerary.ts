import type { CallTime, Itinerary, Leg, TransitLeg, TripWarning } from './types';
import { fmtTime } from './time';
import { legEnd, legStart } from './legs';

export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const eff = (c: CallTime) => c.estimated ?? c.scheduled;


/**
 * Räknar fram start, slut, gång, byten och varningar för en resa. Gångsträckor
 * tidsätts om efter prognos: hemifrån räknas mot den tidigaste av planerad och
 * prognostiserad avgång (prognoser kan förbättras), framme räknas mot prognosen.
 */
export function finalizeItinerary(input: Leg[], demo: boolean, minTransferMin: number): Itinerary {
  const legs = input.map((l) => ({ ...l })) as Leg[];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.kind !== 'walk') continue;
    const dur = leg.end - leg.start;
    const next = legs[i + 1];
    const prev = legs[i - 1];
    if (prev?.kind === 'transit') {
      leg.start = eff(prev.arr);
      leg.end = leg.start + dur;
    } else if (next?.kind === 'transit') {
      leg.end = Math.min(next.dep.scheduled, eff(next.dep));
      leg.start = leg.end - dur;
    }
  }

  const transit = legs.filter((l): l is TransitLeg => l.kind === 'transit');
  const warnings: TripWarning[] = [];
  let minMargin: number | undefined;

  for (let i = 1; i < transit.length; i++) {
    const a = transit[i - 1];
    const b = transit[i];
    const ia = legs.indexOf(a);
    const ib = legs.indexOf(b);
    const walkMs = legs.slice(ia + 1, ib).reduce((s, l) => s + (l.kind === 'walk' ? l.end - l.start : 0), 0);
    const marginMin = (eff(b.dep) - eff(a.arr) - walkMs) / 60000;
    minMargin = minMargin === undefined ? marginMin : Math.min(minMargin, marginMin);
    if (b.rt !== 'cancelled' && a.rt !== 'cancelled') {
      if (marginMin < 0) {
        warnings.push({ kind: 'missedTransfer', text: `Bytet vid ${b.from.name} riskerar att missas: linje ${a.line} beräknas vara framme ${fmtTime(eff(a.arr))}, linje ${b.line} går ${fmtTime(eff(b.dep))}.` });
      } else if (marginMin < Math.min(2, minTransferMin)) {
        warnings.push({ kind: 'shortTransfer', text: `Kort bytesmarginal vid ${b.from.name}: ${Math.round(marginMin)} min.` });
      }
    }
  }
  for (const t of transit) {
    if (t.rt === 'cancelled') warnings.push({ kind: 'cancelled', text: `Linje ${t.line} ${fmtTime(t.dep.scheduled)} från ${t.from.name} är inställd.` });
    for (const a of t.alerts) if (!warnings.some((w) => w.text === a.header)) warnings.push({ kind: 'alert', text: a.header });
  }

  const walks = legs.filter((l) => l.kind === 'walk');
  const key = transit.length
    ? transit.map((t) => `${t.tripId}|${t.serviceDate}|${t.from.id}|${t.to.id}`).join('>') + `|${legs[0].kind === 'walk' ? Math.round((legs[0] as { distance: number }).distance / 50) : 0}`
    : `walk|${legStart(legs[0])}`;

  return {
    id: `it-${hashString(key).toString(36)}`,
    legs,
    start: legStart(legs[0]),
    end: legEnd(legs[legs.length - 1]),
    walkDistance: walks.reduce((s, l) => s + (l.kind === 'walk' ? l.distance : 0), 0),
    walkDuration: walks.reduce((s, l) => s + (l.end - l.start), 0),
    transfers: Math.max(0, transit.length - 1),
    minTransferMargin: minMargin === undefined ? undefined : Math.round(minMargin),
    warnings,
    demo,
  };
}
