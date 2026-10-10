// Matchning av två personers resor till en gemensam destination.

import type {
  Itinerary,
  Leg,
  MatchLabel,
  PairOption,
  Place,
  PersonPlan,
  SharedPart,
  StopRef,
  TimeQuery,
  TogetherRequest,
  TogetherResponse,
  TransitLeg,
} from '../shared/types';
import { haversine } from '../shared/geo';
import { fmtTime, minutes } from '../shared/time';
import { effTime, legEnd, sameTrip, transitLegs } from '../shared/legs';
import type { TransitProvider } from './providers/types';
import { finalizeItinerary, hashString } from '../shared/itinerary';

const usable = (it: Itinerary) => !it.warnings.some((w) => w.kind === 'cancelled' || w.kind === 'missedTransfer');
const durMin = (it: Itinerary) => (it.end - it.start) / 60000;

interface Candidate {
  strategy: PairOption['strategy'];
  its: [Itinerary, Itinerary];
  waits: [number, number];
  shared?: SharedPart;
  meeting?: PairOption['meeting'];
}

/** Hitta gemensam del där båda sitter på samma fordonstur samtidigt. */
export function findSharedRide(a: Itinerary, b: Itinerary): SharedPart | null {
  let best: SharedPart | null = null;
  for (const la of transitLegs(a.legs)) {
    for (const lb of transitLegs(b.legs)) {
      // Samma linjenummer räcker inte: tur-id och trafikdag måste vara identiska.
      if (!sameTrip(la, lb)) continue;
      const fromSeq = Math.max(la.boardSeq, lb.boardSeq);
      const toSeq = Math.min(la.alightSeq, lb.alightSeq);
      if (fromSeq >= toSeq) continue; // Samma tur men inte ombord samtidigt.
      const later = la.boardSeq >= lb.boardSeq ? la : lb;
      const earlier = la.alightSeq <= lb.alightSeq ? la : lb;
      const start = effTime(later.dep);
      const end = effTime(earlier.arr);
      if (!best || end - start > best.end - best.start) {
        best = {
          tripId: la.tripId,
          serviceDate: la.serviceDate,
          line: la.line,
          headsign: la.headsign,
          from: later.from,
          to: earlier.to,
          start,
          end,
          boards: [la.from, lb.from],
        };
      }
    }
  }
  return best;
}

function personPlan(it: Itinerary, solo: number, wait: number): PersonPlan {
  const total = durMin(it);
  return { itinerary: it, leaveAt: it.start, arriveAt: it.end, total: Math.round(total), detour: Math.max(0, Math.round(total - solo)), wait: Math.round(wait) };
}

function detourPenalty(d: number): number {
  return d > 4 ? (d - 4) * 1.5 + (d - 4) ** 2 / 8 : 0;
}

export function scoreCandidate(c: Candidate, solo: [number, number], time: TimeQuery, now: number): number {
  const [a, b] = c.its;
  const totals = [durMin(a), durMin(b)];
  const detours = [Math.max(0, totals[0] - solo[0]), Math.max(0, totals[1] - solo[1])];
  const waitAtEnd = c.strategy === 'arriveTogether' ? Math.abs(a.end - b.end) / 60000 : 0;
  const tRef = time.mode === 'now' ? now : time.at;
  const timing = time.mode === 'arrive' ? (tRef - Math.min(a.start, b.start)) / 60000 : (Math.max(a.end, b.end) - tRef) / 60000;
  return (
    totals[0] +
    totals[1] +
    0.5 * waitAtEnd +
    4 * (a.transfers + b.transfers) +
    0.4 * ((a.walkDuration + b.walkDuration) / 60000) +
    detourPenalty(detours[0]) +
    detourPenalty(detours[1]) +
    0.4 * Math.max(0, timing) +
    6 * [...a.warnings, ...b.warnings].filter((w) => w.kind === 'shortTransfer').length
  );
}

function reasonable(c: Candidate, solo: [number, number]): boolean {
  return c.its.every((it, i) => {
    const d = durMin(it) - solo[i];
    return d <= Math.max(25, solo[i] * 0.8);
  });
}

function sameBusCandidates(as: Itinerary[], bs: Itinerary[]): Candidate[] {
  const out: Candidate[] = [];
  for (const a of as) {
    for (const b of bs) {
      const shared = findSharedRide(a, b);
      if (shared) out.push({ strategy: 'sameBus', its: [a, b], waits: [0, 0], shared });
    }
  }
  return out;
}

function arriveTogetherCandidates(as: Itinerary[], bs: Itinerary[], tolerance: number): Candidate[] {
  const out: Candidate[] = [];
  for (const a of as) {
    for (const b of bs) {
      const diff = Math.abs(a.end - b.end) / 60000;
      if (diff > tolerance) continue;
      const shared = findSharedRide(a, b) ?? undefined;
      out.push({ strategy: 'arriveTogether', its: [a, b], waits: [Math.max(0, (b.end - a.end) / 60000), Math.max(0, (a.end - b.end) / 60000)], shared });
    }
  }
  return out;
}

function stopsOf(it: Itinerary): StopRef[] {
  return transitLegs(it.legs).flatMap((l) => [l.from, ...l.intermediate.map((i) => i.stop), l.to]);
}

function joinLegs(first: Itinerary, wait: { at: StopRef; until: number; reason: string } | null, second: Itinerary, demo: boolean, minTransfer: number): Itinerary {
  const legs: Leg[] = [...first.legs];
  const arrive = legEnd(legs[legs.length - 1]);
  if (wait && wait.until - arrive >= 60_000) {
    legs.push({ kind: 'wait', at: { name: wait.at.name, lat: wait.at.lat, lng: wait.at.lng }, start: arrive, end: wait.until, reason: wait.reason });
  }
  // Hoppa över gångsträckor på 0 meter vid mötesplatsen.
  for (const l of second.legs) if (!(l.kind === 'walk' && l.distance < 5 && legs.length)) legs.push(l);
  return finalizeItinerary(legs, demo, minTransfer);
}

async function meetCandidates(p: TransitProvider, req: TogetherRequest, soloA: Itinerary[], soloB: Itinerary[]): Promise<Candidate[]> {
  const [pa, pb] = req.persons;
  const dest = req.destination;
  const countA = new Map<string, StopRef>();
  const countB = new Map<string, StopRef>();
  soloA.slice(0, 12).forEach((it) => stopsOf(it).forEach((s) => countA.set(s.name, s)));
  soloB.slice(0, 12).forEach((it) => stopsOf(it).forEach((s) => countB.set(s.name, s)));
  let cands = [...countA.values()].filter((s) => countB.has(s.name));
  if (cands.length < 2) {
    const mid = { lat: (pa.lat + pb.lat + dest.lat) / 3, lng: (pa.lng + pb.lng + dest.lng) / 3 };
    cands = cands.concat(await p.nearbyStops(mid, 2500));
  }
  const seen = new Set<string>();
  const ranked = cands
    .filter((s) => haversine(s, dest) > 500)
    .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
    .sort((x, y) => haversine(pa, x) + haversine(pb, x) + haversine(x, dest) - (haversine(pa, y) + haversine(pb, y) + haversine(y, dest)))
    .slice(0, 4);

  const out: Candidate[] = [];
  await Promise.all(
    ranked.map(async (m) => {
      const mPlace: Place = { name: m.name, lat: m.lat, lng: m.lng, stopId: m.id, source: 'stop' };
      let onward: Itinerary[];
      if (req.time.mode === 'arrive') {
        onward = (await p.plan(mPlace, dest, req.time, req.prefs, { max: 2 })).filter(usable);
      } else {
        const [toA, toB] = await Promise.all([
          p.plan(pa, mPlace, req.time, req.prefs, { max: 2 }),
          p.plan(pb, mPlace, req.time, req.prefs, { max: 2 }),
        ]);
        const ea = toA.filter(usable)[0];
        const eb = toB.filter(usable)[0];
        if (!ea || !eb) return;
        const t = Math.max(ea.end, eb.end) + 60_000;
        onward = (await p.plan(mPlace, dest, { mode: 'depart', at: t }, req.prefs, { max: 2 })).filter(usable);
      }
      for (const on of onward.slice(0, 2)) {
        const firstTransit = transitLegs(on.legs)[0];
        const meetAt = firstTransit ? effTime(firstTransit.dep) : on.start;
        const deadline = meetAt - 60_000;
        const [ra, rb] = await Promise.all([
          p.plan(pa, mPlace, { mode: 'arrive', at: deadline }, req.prefs, { max: 1 }),
          p.plan(pb, mPlace, { mode: 'arrive', at: deadline }, req.prefs, { max: 1 }),
        ]);
        const a = ra.filter(usable)[0];
        const b = rb.filter(usable)[0];
        if (!a || !b) continue;
        const reason = (other: string) => `Vänta på ${other} och fortsätt tillsammans`;
        const fullA = joinLegs(a, { at: m, until: meetAt, reason: reason(req.names[1]) }, on, p.demo, req.prefs.minTransfer);
        const fullB = joinLegs(b, { at: m, until: meetAt, reason: reason(req.names[0]) }, on, p.demo, req.prefs.minTransfer);
        const shared: SharedPart = firstTransit
          ? { tripId: firstTransit.tripId, serviceDate: firstTransit.serviceDate, line: firstTransit.line, headsign: firstTransit.headsign, from: firstTransit.from, to: firstTransit.to, start: effTime(firstTransit.dep), end: effTime(firstTransit.arr), boards: [firstTransit.from, firstTransit.from] }
          : { tripId: '', serviceDate: '', line: '', headsign: dest.name, from: m, to: { id: 'dest', name: dest.name, lat: dest.lat, lng: dest.lng }, start: on.start, end: on.end, boards: [m, m], walkTogether: true };
        out.push({
          strategy: 'meet',
          its: [fullA, fullB],
          waits: [(meetAt - a.end) / 60000, (meetAt - b.end) / 60000],
          shared,
          meeting: { name: m.name, lat: m.lat, lng: m.lng, time: Math.max(a.end, b.end), stop: m },
        });
      }
    }),
  );
  return out;
}

function explain(c: Candidate, labels: MatchLabel[], names: [string, string], persons: [PersonPlan, PersonPlan]): string {
  const parts: string[] = [];
  const [n1, n2] = names;
  if (c.strategy === 'sameBus' && c.shared) {
    const [b1, b2] = c.shared.boards;
    if (b1.id === b2.id || b1.name === b2.name) parts.push(`Ni kliver på samma tur av linje ${c.shared.line} tillsammans vid ${b1.name}.`);
    else {
      const first = persons[0].itinerary.legs.find((l): l is TransitLeg => l.kind === 'transit' && l.tripId === c.shared!.tripId);
      const second = persons[1].itinerary.legs.find((l): l is TransitLeg => l.kind === 'transit' && l.tripId === c.shared!.tripId);
      const firstOn = first && second && first.boardSeq < second.boardSeq ? [n1, b1.name, n2, b2.name] : [n2, b2.name, n1, b1.name];
      parts.push(`Samma tur av linje ${c.shared.line}: ${firstOn[0]} kliver på vid ${firstOn[1]} och ${firstOn[2]} vid ${firstOn[3]}.`);
    }
  } else if (c.strategy === 'meet' && c.meeting) {
    const w = persons.map((p) => p.wait);
    const waiter = w[0] > w[1] ? n1 : n2;
    parts.push(`Ni möts vid ${c.meeting.name} och fortsätter tillsammans${c.shared?.line ? ` med linje ${c.shared.line}` : ''}.`);
    if (Math.max(...w) >= 2) parts.push(`${waiter} väntar ${Math.round(Math.max(...w))} min.`);
  } else if (c.strategy === 'arriveTogether') {
    const diff = minutes(Math.abs(persons[0].arriveAt - persons[1].arriveAt));
    parts.push(diff === 0 ? 'Ni är framme samtidigt.' : `Ni är framme med ${diff} min mellanrum.`);
    if (c.shared) parts.push(`Ni åker dessutom en bit med samma buss (linje ${c.shared.line}).`);
  }
  if (labels.includes('best')) parts.push('Bäst balans mellan restid, väntan och byten för er båda.');
  if (labels.includes('fastest')) parts.push(`Ni är båda framme senast ${fmtTime(Math.max(persons[0].arriveAt, persons[1].arriveAt))}.`);
  if (labels.includes('leastEffort')) {
    const xfers = persons[0].itinerary.transfers + persons[1].itinerary.transfers;
    const walk = minutes(persons[0].itinerary.walkDuration + persons[1].itinerary.walkDuration);
    parts.push(`Totalt ${xfers === 0 ? 'inga byten' : xfers === 1 ? 'ett byte' : `${xfers} byten`} och ${walk} min gång för er två.`);
  }
  const maxDetour = Math.max(persons[0].detour, persons[1].detour);
  if (maxDetour <= 3) parts.push('Nästan lika snabbt som att resa var för sig.');
  else {
    const who = persons[0].detour >= persons[1].detour ? n1 : n2;
    parts.push(`${who} reser ${maxDetour} min längre än sin snabbaste egna resa.`);
  }
  return parts.join(' ');
}

export async function planTogether(p: TransitProvider, req: TogetherRequest, now = Date.now()): Promise<TogetherResponse> {
  const [pa, pb] = req.persons;
  const dest = req.destination;
  const raw = { max: 40, raw: true, windowMin: 120 } as const;
  const [allA, allB] = await Promise.all([p.plan(pa, dest, req.time, req.prefs, raw), p.plan(pb, dest, req.time, req.prefs, raw)]);
  const as = allA.filter(usable);
  const bs = allB.filter(usable);
  const soloBestA = as.length ? Math.min(...as.map(durMin)) : 0;
  const soloBestB = bs.length ? Math.min(...bs.map(durMin)) : 0;
  const pickSolo = (list: Itinerary[]) =>
    [...list].sort((x, y) => (req.time.mode === 'arrive' ? y.start - x.start : x.end - y.end))[0] ?? null;
  const solo: [Itinerary | null, Itinerary | null] = [pickSolo(as), pickSolo(bs)];

  if (!as.length || !bs.length) {
    const who = !as.length && !bs.length ? 'någon av er' : !as.length ? req.names[0] : req.names[1];
    return {
      options: [],
      solo,
      noMatchReason: `Det finns ingen resa för ${who} vid den valda tiden.`,
      suggestions: ['Välj en annan tid.', 'Kontrollera start och destination.'],
      demo: p.demo,
    };
  }

  let cands: Candidate[];
  if (req.strategy === 'sameBus') cands = sameBusCandidates(as, bs);
  else if (req.strategy === 'arriveTogether') cands = arriveTogetherCandidates(as, bs, req.tolerance);
  else cands = await meetCandidates(p, req, as, bs);

  const soloT: [number, number] = [soloBestA, soloBestB];
  cands = cands.filter((c) => reasonable(c, soloT));
  const scored = cands
    .map((c) => ({ c, score: scoreCandidate(c, soloT, req.time, now), key: `${c.its[0].id}+${c.its[1].id}` }))
    .filter((x, i, arr) => arr.findIndex((y) => y.key === x.key) === i)
    .sort((x, y) => x.score - y.score);

  if (!scored.length) {
    const reasons: Record<typeof req.strategy, string> = {
      sameBus: 'Det finns ingen avgång där ni båda kan åka med samma tur inom en rimlig restid.',
      meet: 'Vi hittade ingen hållplats där ni kan mötas utan stora omvägar.',
      arriveTogether: `Vi hittade inga resor där ni är framme med högst ${req.tolerance} minuters skillnad.`,
    };
    const suggestions = ['Välj en senare avgång eller ett annat tidsfönster.'];
    if (req.strategy !== 'arriveTogether') suggestions.push('Prova ”Framme samtidigt”.');
    if (req.strategy === 'arriveTogether' && req.tolerance < 15) suggestions.push('Tillåt större skillnad i ankomsttid.');
    if (req.strategy === 'sameBus') suggestions.push('Prova ”Mötas på vägen”.');
    suggestions.push('Res separat – era snabbaste egna resor visas nedan.');
    return { options: [], solo, noMatchReason: reasons[req.strategy], suggestions, demo: p.demo };
  }

  const effort = (c: Candidate) => (c.its[0].transfers + c.its[1].transfers) * 10 + (c.its[0].walkDuration + c.its[1].walkDuration) / 60000;
  const fastestVal = (c: Candidate) =>
    req.time.mode === 'arrive' ? Math.max(durMin(c.its[0]), durMin(c.its[1])) : Math.max(c.its[0].end, c.its[1].end) / 60000;

  const best = scored[0];
  const fastest = [...scored].sort((x, y) => fastestVal(x.c) - fastestVal(y.c) || x.score - y.score)[0];
  const least = [...scored].sort((x, y) => effort(x.c) - effort(y.c) || x.score - y.score)[0];

  const chosen: { item: (typeof scored)[number]; labels: MatchLabel[] }[] = [];
  const add = (item: (typeof scored)[number], label?: MatchLabel) => {
    const ex = chosen.find((c) => c.item.key === item.key);
    if (ex) {
      if (label) ex.labels.push(label);
    } else chosen.push({ item, labels: label ? [label] : [] });
  };
  add(best, 'best');
  add(fastest, 'fastest');
  add(least, 'leastEffort');
  for (const s of scored) {
    if (chosen.length >= 3) break;
    add(s);
  }

  const options: PairOption[] = chosen.map(({ item, labels }) => {
    const c = item.c;
    const persons: [PersonPlan, PersonPlan] = [personPlan(c.its[0], soloBestA, c.waits[0]), personPlan(c.its[1], soloBestB, c.waits[1])];
    return {
      id: `pair-${hashString(item.key).toString(36)}`,
      strategy: c.strategy,
      labels,
      persons,
      meeting: c.meeting,
      shared: c.shared,
      arrivalDiff: minutes(Math.abs(c.its[0].end - c.its[1].end)),
      explanation: explain(c, labels, req.names, persons),
      score: Math.round(item.score),
    };
  });

  return { options, solo, demo: p.demo };
}


