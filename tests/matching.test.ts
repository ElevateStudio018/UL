import { describe, expect, it } from 'vitest';
import type { Itinerary, Place, TransitLeg } from '../shared/types';
import { DEFAULT_PREFS } from '../shared/types';
import { finalizeItinerary } from '../shared/itinerary';
import { findSharedRide, planTogether } from '../server/matching';
import { DemoProvider } from '../server/providers/demo';
import { zonedToEpoch } from '../shared/time';

const stop = (id: string) => ({ id, name: id, lat: 59.85, lng: 17.6 });
function leg(p: Partial<TransitLeg>): TransitLeg {
  return {
    kind: 'transit', tripId: 't1', serviceDate: '20261012', routeId: 'r4', line: '4', mode: 'bus', headsign: 'Gränby',
    from: stop('A'), to: stop('D'), dep: { scheduled: 1_000_000 }, arr: { scheduled: 1_600_000 }, boardSeq: 1, alightSeq: 4,
    intermediate: [], geometry: [], rt: 'scheduled', alerts: [], ...p,
  };
}
const it1 = (l: TransitLeg): Itinerary => finalizeItinerary([l], true, 3);

describe('Samma buss', () => {
  it('kräver samma tur-id OCH samma trafikdag', () => {
    const a = it1(leg({}));
    expect(findSharedRide(a, it1(leg({ boardSeq: 2, from: stop('B') })))).not.toBeNull();
    // Samma linje, annan tur
    expect(findSharedRide(a, it1(leg({ tripId: 't2', boardSeq: 2 })))).toBeNull();
    // Samma tur-id men annan trafikdag (samma tidtabell, annan dag)
    expect(findSharedRide(a, it1(leg({ serviceDate: '20261013', boardSeq: 2 })))).toBeNull();
  });

  it('kräver att båda är ombord samtidigt', () => {
    const a = it1(leg({ boardSeq: 1, alightSeq: 3, to: stop('C') }));
    const b = it1(leg({ boardSeq: 3, alightSeq: 5, from: stop('C'), to: stop('E') }));
    expect(findSharedRide(a, b)).toBeNull();
  });

  it('anger den gemensamma delen och var var och en kliver på', () => {
    const s = findSharedRide(it1(leg({ boardSeq: 1, from: stop('A') })), it1(leg({ boardSeq: 3, from: stop('C') })))!;
    expect(s.from.id).toBe('C');
    expect(s.boards.map((b) => b.id)).toEqual(['A', 'C']);
  });

  it('demomotorns förslag delar alltid exakt samma tur', async () => {
    const p = new DemoProvider();
    const A: Place = { name: 'Flogsta', lat: 59.8505, lng: 17.585, source: 'demo' };
    const B: Place = { name: 'Rackarberg', lat: 59.853, lng: 17.612, source: 'demo' };
    const D: Place = { name: 'Gränby', lat: 59.8783, lng: 17.6748, source: 'demo' };
    const at = zonedToEpoch(2026, 10, 12, 8, 0);
    const r = await planTogether(p, { persons: [A, B], names: ['Kim', 'Alex'], destination: D, time: { mode: 'depart', at }, strategy: 'sameBus', tolerance: 10, prefs: DEFAULT_PREFS }, at);
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      const legsA = o.persons[0].itinerary.legs.filter((l): l is TransitLeg => l.kind === 'transit');
      const legsB = o.persons[1].itinerary.legs.filter((l): l is TransitLeg => l.kind === 'transit');
      const shared = legsA.find((x) => legsB.some((y) => y.tripId === x.tripId && y.serviceDate === x.serviceDate));
      expect(shared).toBeTruthy();
      expect(o.shared?.tripId).toBe(shared!.tripId);
      // Gångtid ingår: första delen är promenad som slutar när bussen går.
      expect(o.persons[0].itinerary.legs[0].kind).toBe('walk');
      expect(o.persons[0].leaveAt).toBeLessThanOrEqual(shared!.dep.scheduled);
    }
    expect(r.options[0].labels).toContain('best');
  });

  it('Framme samtidigt respekterar vald tolerans', async () => {
    const p = new DemoProvider();
    const at = zonedToEpoch(2026, 10, 12, 8, 0);
    const r = await planTogether(
      p,
      {
        persons: [{ name: 'Sunnersta', lat: 59.7962, lng: 17.6448, source: 'demo' }, { name: 'Stenhagen', lat: 59.8573, lng: 17.5745, source: 'demo' }],
        names: ['A', 'B'],
        destination: { name: 'Domkyrkan', lat: 59.8581, lng: 17.6337, source: 'demo' },
        time: { mode: 'depart', at },
        strategy: 'arriveTogether',
        tolerance: 5,
        prefs: DEFAULT_PREFS,
      },
      at,
    );
    for (const o of r.options) expect(o.arrivalDiff).toBeLessThanOrEqual(5);
    if (!r.options.length) expect(r.noMatchReason).toBeTruthy();
  });
});

describe('Bytesmarginal', () => {
  it('varnar för kort byte och missat byte', () => {
    const l1 = leg({ arr: { scheduled: 1_600_000, estimated: 1_600_000 + 240_000 }, rt: 'realtime', alightSeq: 4 });
    const l2 = leg({ tripId: 't9', line: '12', from: stop('D'), dep: { scheduled: 1_600_000 + 180_000 }, arr: { scheduled: 2_000_000 } });
    const it = finalizeItinerary([l1, l2], true, 3);
    expect(it.warnings.some((w) => w.kind === 'missedTransfer')).toBe(true);
    const ok = finalizeItinerary([leg({}), leg({ tripId: 't9', dep: { scheduled: 1_600_000 + 60_000 }, arr: { scheduled: 2_000_000 } })], true, 3);
    expect(ok.warnings.some((w) => w.kind === 'shortTransfer')).toBe(true);
  });
});
