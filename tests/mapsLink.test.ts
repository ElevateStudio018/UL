import { describe, expect, it } from 'vitest';
import { parseMapsLink } from '../shared/mapsLink';

describe('Google Maps-länkar', () => {
  it('föredrar platsens koordinater framför kartvyn', () => {
    const r = parseMapsLink('https://www.google.com/maps/place/Uppsala+domkyrka/@59.85,17.62,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d59.8581!4d17.6337');
    expect(r).toMatchObject({ kind: 'coords', lat: 59.8581, lng: 17.6337, precision: 'place', name: 'Uppsala domkyrka' });
  });
  it('tolkar q-koordinater och sökningar', () => {
    expect(parseMapsLink('https://maps.google.com/?q=59.86,17.64')).toMatchObject({ kind: 'coords', precision: 'pin' });
    expect(parseMapsLink('https://www.google.com/maps/search/?api=1&query=Fyrishov')).toMatchObject({ kind: 'query', query: 'Fyrishov' });
  });
  it('markerar kartvyns mittpunkt som osäker', () => {
    expect(parseMapsLink('https://www.google.se/maps/@59.8586,17.6389,14z')).toMatchObject({ kind: 'coords', precision: 'viewport' });
  });
  it('skickar kortlänkar till servern och avvisar andra värdar', () => {
    expect(parseMapsLink('https://maps.app.goo.gl/abc123').kind).toBe('short');
    expect(parseMapsLink('https://evil.example/maps?q=59,17').kind).toBe('invalid');
    expect(parseMapsLink('https://google.com.evil.example/maps').kind).toBe('invalid');
    expect(parseMapsLink('javascript:alert(1)').kind).toBe('invalid');
    expect(parseMapsLink('https://www.google.com/maps').kind).toBe('invalid');
  });
});
