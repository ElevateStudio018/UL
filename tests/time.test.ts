import { describe, expect, it } from 'vitest';
import { fmtTime, gtfsTimeToEpoch, serviceDateOf, serviceDayStart, zonedToEpoch } from '../shared/time';

describe('Europe/Stockholm och trafikdygn', () => {
  it('räknar GTFS-tid från middag minus 12 h', () => {
    expect(fmtTime(gtfsTimeToEpoch('20261012', 8 * 3600 + 15 * 60))).toBe('08:15');
  });
  it('hanterar turer efter midnatt (25:10 hör till föregående trafikdag)', () => {
    const t = gtfsTimeToEpoch('20261012', 25 * 3600 + 10 * 60);
    expect(fmtTime(t)).toBe('01:10');
    expect(serviceDateOf(t)).toBe('20261013');
  });
  it('hanterar övergången till vintertid (25 oktober 2026)', () => {
    // Dygnet 25 oktober har 25 timmar: middag minus 12 h = 23:00 kvällen innan.
    expect(fmtTime(serviceDayStart('20261025'))).toBe('01:00');
    expect(fmtTime(gtfsTimeToEpoch('20261025', 12 * 3600))).toBe('12:00');
  });
  it('hanterar övergången till sommartid (29 mars 2026)', () => {
    expect(fmtTime(gtfsTimeToEpoch('20260329', 12 * 3600))).toBe('12:00');
    expect(zonedToEpoch(2026, 3, 29, 3, 30) - zonedToEpoch(2026, 3, 29, 1, 30)).toBe(3600_000);
  });
});
