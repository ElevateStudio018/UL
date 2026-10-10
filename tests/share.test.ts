import { describe, expect, it } from 'vitest';
import { ShareStore } from '../server/share';

const place = { name: 'X', lat: 59.85, lng: 17.6, source: 'demo' as const };

describe('Reselänkar', () => {
  it('har svårgissade id, egna nycklar och begränsad giltighet', () => {
    const s = new ShareStore();
    const c = s.create({ destination: place, time: { mode: 'now', at: Date.now() }, strategy: 'sameBus', tolerance: 10, names: ['A', 'B'], demo: true });
    expect(c.id.length).toBeGreaterThanOrEqual(21);
    expect(c.expiresAt - Date.now()).toBeLessThanOrEqual(48 * 3600_000);
    expect(() => s.update(c.id, 'fel', { status: 'leaving' })).toThrow();
    const j = s.join(c.id, 'B', place);
    expect(() => s.join(c.id, 'C')).toThrow();
    expect(s.who(c.id, j.token)).toBe(1);
  });
  it('livedelning är tidsbegränsad och kan stoppas direkt', () => {
    const s = new ShareStore();
    const c = s.create({ destination: place, time: { mode: 'now', at: Date.now() }, strategy: 'sameBus', tolerance: 10, names: ['A', 'B'], demo: true });
    const st = s.setLive(c.id, c.token, { lat: 59.8, lng: 17.6 }, 500);
    expect(st.participants[0].live!.until - Date.now()).toBeLessThanOrEqual(120 * 60_000 + 1000);
    expect(s.stopLive(c.id, c.token).participants[0].live).toBeUndefined();
  });
});
