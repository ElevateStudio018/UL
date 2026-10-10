import { describe, expect, it } from 'vitest';
import { delayAtStop, GtfsRtCache, tripKey } from '../server/realtime';
import { DemoProvider, demoRealtime } from '../server/providers/demo';

describe('Realtid', () => {
  it('kopplar TripUpdates via tur-id och trafikdag', () => {
    const c = new GtfsRtCache('nyckel');
    c.tripUpdates.set(tripKey('T1', '20261012'), { tripId: 'T1', startDate: '20261012', cancelled: false, updates: [], timestamp: 0, delay: 120 });
    expect(c.tripUpdate('T1', '20261012')?.delay).toBe(120);
    expect(c.tripUpdate('T1', '20261013')).toBeUndefined();
  });
  it('propagerar försening från tidigare hållplats', () => {
    const tu = { tripId: 'T', cancelled: false, timestamp: 0, updates: [{ stopSequence: 2, departureDelay: 180, skipped: false }, { stopSequence: 6, arrivalDelay: 60, skipped: false }] };
    expect(delayAtStop(tu, 4, undefined, 'arrival')).toBe(180);
    expect(delayAtStop(tu, 6, undefined, 'arrival')).toBe(60);
    expect(delayAtStop(tu, 1, undefined, 'arrival')).toBeUndefined();
  });
  it('turer långt fram i tiden saknar realtid och visas enligt tidtabell', () => {
    const now = Date.now();
    expect(demoRealtime({ tripId: 'x', serviceDate: '20261012', start: now + 3 * 3600_000, end: now + 4 * 3600_000 }, now).state).toBe('scheduled');
  });
  it('prognos finns bara när realtidsläget är realtime', async () => {
    const p = new DemoProvider();
    const its = await p.plan({ name: 'A', lat: 59.8505, lng: 17.585, source: 'demo' }, { name: 'B', lat: 59.8783, lng: 17.6748, source: 'demo' }, { mode: 'now', at: Date.now() }, { walkSpeed: 1.33, minTransfer: 3, preference: 'balanced' }, { max: 8 });
    for (const it of its)
      for (const l of it.legs)
        if (l.kind === 'transit') {
          if (l.rt !== 'realtime') expect(l.dep.estimated).toBeUndefined();
        }
  });
  it('simulerade fordon finns bara för turer med realtid och är märkta', async () => {
    const vs = await new DemoProvider().vehicles();
    for (const v of vs) {
      expect(v.source).toBe('simulated');
      expect(v.tripId && v.serviceDate).toBeTruthy();
    }
  });
});
