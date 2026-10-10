import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig, Place, PlanRequest, Prefs, ServiceStatus, TimeQuery, TogetherRequest } from '../shared/types';
import { DEFAULT_PREFS } from '../shared/types';
import { haversine, type Bounds } from '../shared/geo';
import { isAllowedMapsHost, parseMapsLink, type MapsLinkResult } from '../shared/mapsLink';
import { DemoProvider } from './providers/demo';
import { DEMO_PLACES } from './providers/demoNetwork';
import { OtpProvider } from './providers/otp';
import type { TransitProvider } from './providers/types';
import { GtfsRtCache } from './realtime';
import { planTogether } from './matching';
import { ShareError, ShareStore } from './share';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const env = (k: string) => process.env[k]?.trim() || undefined;
const OTP_URL = env('OTP_URL');
const OTP_FEED_ID = env('OTP_FEED_ID') ?? 'ul';
const RT_KEY = env('TRAFIKLAB_GTFS_RT_KEY');
const GOOGLE_KEY = env('GOOGLE_MAPS_BROWSER_KEY');
const GOOGLE_MAP_ID = env('GOOGLE_MAP_ID');
const PORT = Number(env('PORT') ?? 8787);

// Realtid kopplas bara på när reseplaneringen bygger på samma GTFS-källa, så att
// tur-id och trafikdagar är kompatibla. Demo och riktig data blandas aldrig.
const rtCache = OTP_URL && RT_KEY ? new GtfsRtCache(RT_KEY, 'ul') : undefined;
const provider: TransitProvider = OTP_URL ? new OtpProvider(OTP_URL, OTP_FEED_ID, rtCache) : new DemoProvider();
const shares = new ShareStore();

function services(): ServiceStatus[] {
  return [
    { id: 'maps', name: 'Google Maps JavaScript API', configured: !!GOOGLE_KEY, required: 'Karta', env: ['GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID (valfri)'], description: 'Webbläsarnyckel begränsad till appens domäner (HTTP-referenter) och till Maps JavaScript API, Places API (New) och Geocoding API. Utan nyckel används en enkel OpenStreetMap-karta i demoläget.' },
    { id: 'places', name: 'Google Places API (New)', configured: !!GOOGLE_KEY, required: 'Platssökning', env: ['GOOGLE_MAPS_BROWSER_KEY'], description: 'Sökförslag för adresser och besöksmål, med prioritering av Uppsala län. Utan nyckel söker appen bland demoplatser och hållplatser.' },
    { id: 'otp', name: 'OpenTripPlanner 2', configured: !!OTP_URL, required: 'Reseplanering och gångvägar', env: ['OTP_URL', 'OTP_FEED_ID'], description: 'Routingmotor byggd på GTFS Regional (UL) och OpenStreetMap. Se otp/README.md för hur grafen byggs. Utan den används demomotorn.' },
    { id: 'gtfs-static', name: 'Trafiklab GTFS Regional – statisk (UL)', configured: !!OTP_URL, required: 'Hållplatser, turer och tidtabeller', env: ['TRAFIKLAB_GTFS_STATIC_KEY (används när OTP-grafen byggs)'], description: 'Statisk GTFS för UL. Laddas in i OpenTripPlanner, så att samma tur-id används i planering och realtid.' },
    { id: 'gtfs-rt', name: 'Trafiklab GTFS Regional Realtime (UL)', configured: !!rtCache, required: 'Fordonspositioner, prognoser och störningar', env: ['TRAFIKLAB_GTFS_RT_KEY'], description: 'VehiclePositions, TripUpdates och ServiceAlerts. Hämtas gemensamt på servern med cache. Kräver OTP_URL så att id:n matchar.' },
    { id: 'share', name: 'Lagring av reselänkar', configured: true, required: 'Dela resa', env: [], description: 'I minnet på servern (försvinner vid omstart). För flera serverinstanser behövs delad lagring, t.ex. Redis.' },
  ];
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  next();
});

// Enkel hastighetsbegränsning per IP.
const buckets = new Map<string, { n: number; reset: number }>();
function limit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) buckets.set(key, { n: 1, reset: now + windowMs });
    else if (++b.n > max) {
      res.status(429).json({ error: 'För många förfrågningar. Vänta en stund och försök igen.' });
      return;
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function parsePlace(p: unknown): Place {
  const x = p as Place;
  if (!x || !num(x.lat, -90, 90) || !num(x.lng, -180, 180)) throw new ShareError(400, 'Ogiltig plats.');
  return { name: String(x.name ?? 'Vald plats').slice(0, 120), lat: x.lat, lng: x.lng, source: x.source ?? 'map', stopId: x.stopId ? String(x.stopId).slice(0, 80) : undefined, address: x.address ? String(x.address).slice(0, 160) : undefined };
}
function parseTime(t: unknown): TimeQuery {
  const x = t as TimeQuery;
  if (!x || !['now', 'depart', 'arrive'].includes(x.mode)) return { mode: 'now', at: Date.now() };
  return { mode: x.mode, at: num(x.at, 0, 4e12) ? x.at : Date.now() };
}
function parsePrefs(p: unknown): Prefs {
  const x = (p ?? {}) as Partial<Prefs>;
  return {
    walkSpeed: num(x.walkSpeed, 0.5, 2.5) ? x.walkSpeed! : DEFAULT_PREFS.walkSpeed,
    minTransfer: num(x.minTransfer, 0, 15) ? x.minTransfer! : DEFAULT_PREFS.minTransfer,
    preference: ['balanced', 'fewTransfers', 'lessWalking'].includes(x.preference as string) ? x.preference! : 'balanced',
  };
}

app.get('/api/config', (_req, res) => {
  const cfg: AppConfig = {
    demo: provider.demo,
    planner: OTP_URL ? 'otp' : 'demo',
    realtime: provider.demo ? 'demo' : rtCache ? 'gtfs-rt' : 'none',
    googleMapsKey: GOOGLE_KEY,
    googleMapId: GOOGLE_MAP_ID,
    services: services(),
    realtimeFetchedAt: rtCache?.fetchedAt,
    realtimeError: rtCache?.error,
  };
  res.json(cfg);
});

app.post('/api/plan', limit('plan', 120, 60_000), async (req, res) => {
  const body = req.body as PlanRequest;
  const itineraries = await provider.plan(parsePlace(body.from), parsePlace(body.to), parseTime(body.time), parsePrefs(body.prefs), { max: Math.min(8, Number(body.max) || 6) });
  res.json({ itineraries, demo: provider.demo });
});

app.post('/api/plan/together', limit('plan', 120, 60_000), async (req, res) => {
  const b = req.body as TogetherRequest;
  if (!Array.isArray(b.persons) || b.persons.length !== 2) throw new ShareError(400, 'Två startplatser krävs.');
  const request: TogetherRequest = {
    persons: [parsePlace(b.persons[0]), parsePlace(b.persons[1])],
    names: [String(b.names?.[0] ?? 'Person 1').slice(0, 40), String(b.names?.[1] ?? 'Person 2').slice(0, 40)],
    destination: parsePlace(b.destination),
    time: parseTime(b.time),
    strategy: ['sameBus', 'meet', 'arriveTogether'].includes(b.strategy) ? b.strategy : 'sameBus',
    tolerance: num(b.tolerance, 1, 60) ? b.tolerance : 10,
    prefs: parsePrefs(b.prefs),
  };
  res.json(await planTogether(provider, request));
});

const parseBounds = (q: Request['query']): Bounds | null => {
  const [south, west, north, east] = String(q.bbox ?? '').split(',').map(Number);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (north - south > 1.5 || east - west > 3) return null;
  return { south, west, north, east };
};

app.get('/api/stops', async (req, res) => {
  const b = parseBounds(req.query);
  res.json({ stops: b ? await provider.stops(b) : [] });
});

app.get('/api/stops/:id/departures', async (req, res) => {
  const from = Number(req.query.from) || Date.now();
  const until = Number(req.query.until) || undefined;
  const limitN = Math.min(200, Number(req.query.limit) || 12);
  res.json({ departures: await provider.departures(String(req.params.id), from, limitN, until), demo: provider.demo });
});

app.get('/api/trips/:id', async (req, res) => {
  const trip = await provider.trip(String(req.params.id), String(req.query.serviceDate ?? ''));
  if (!trip) {
    res.status(404).json({ error: 'Turen hittades inte.' });
    return;
  }
  res.json({ trip, demo: provider.demo });
});

app.get('/api/vehicles', async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=5');
  res.json({ vehicles: await provider.vehicles(), demo: provider.demo, available: provider.demo || !!rtCache, fetchedAt: rtCache?.fetchedAt ?? Date.now(), error: rtCache?.error });
});

app.get('/api/alerts', async (_req, res) => {
  res.json({ alerts: await provider.alerts(), demo: provider.demo, available: provider.demo || !!rtCache });
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const stops = (await provider.searchStops(q)).slice(0, 5).map<Place>((s) => ({ name: s.name, lat: s.lat, lng: s.lng, stopId: s.id, source: 'stop', address: 'Hållplats' }));
  const needle = q.toLowerCase();
  const places = provider.demo
    ? DEMO_PLACES.filter((p) => `${p.name} ${p.address} ${p.tags}`.toLowerCase().includes(needle))
        .slice(0, 6)
        .map<Place>((p) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng, source: 'demo' }))
    : [];
  res.json({ results: [...places, ...stops], demo: provider.demo });
});

app.get('/api/reverse', async (req, res) => {
  const p = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) throw new ShareError(400, 'Ogiltig position.');
  const stops = await provider.nearbyStops(p, 400).catch(() => []);
  const near = provider.demo ? DEMO_PLACES.map((d) => ({ d, dist: haversine(p, d) })).sort((a, b) => a.dist - b.dist)[0] : undefined;
  let name = 'Vald punkt';
  if (near && near.dist < 150) name = `Vid ${near.d.name}`;
  else if (stops[0]) name = `Nära ${stops[0].name}`;
  res.json({ name });
});

/** Löser upp korta Google Maps-länkar. Följer bara omdirigeringar till Googles kartvärdar. */
async function resolveShortLink(url: string): Promise<MapsLinkResult> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Samak/0.1' } });
    const loc = res.headers.get('location');
    await res.body?.cancel();
    if (!loc) break;
    const next = new URL(loc, current);
    if (next.protocol !== 'https:' || !isAllowedMapsHost(next.hostname)) return { kind: 'invalid', reason: 'Länken leder till en sida som inte är Google Maps.' };
    current = next.toString();
    const parsed = parseMapsLink(current);
    if (parsed.kind !== 'short') return parsed;
  }
  return { kind: 'invalid', reason: 'Kortlänken gick inte att lösa upp.' };
}

app.post('/api/maps/resolve', limit('resolve', 30, 60_000), async (req, res) => {
  const url = String(req.body?.url ?? '');
  const parsed = parseMapsLink(url);
  if (parsed.kind !== 'short') {
    res.json(parsed);
    return;
  }
  try {
    res.json(await resolveShortLink(parsed.url));
  } catch {
    res.json({ kind: 'invalid', reason: 'Kunde inte öppna kortlänken just nu.' } satisfies MapsLinkResult);
  }
});

// Delade resor
const tokenOf = (req: Request) => req.get('x-share-token') ?? undefined;

app.post('/api/share', limit('share', 30, 3600_000), (req, res) => {
  const b = req.body;
  const created = shares.create({
    destination: parsePlace(b.destination),
    time: parseTime(b.time),
    strategy: ['sameBus', 'meet', 'arriveTogether'].includes(b.strategy) ? b.strategy : 'sameBus',
    tolerance: num(b.tolerance, 1, 60) ? b.tolerance : 10,
    option: b.option ?? undefined,
    names: [String(b.names?.[0] ?? 'Person 1'), String(b.names?.[1] ?? 'Person 2')],
    origin: b.origin ? parsePlace(b.origin) : undefined,
    demo: provider.demo,
  });
  res.json({ ...created, share: shares.get(created.id) });
});

app.get('/api/share/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = String(req.params.id);
  res.json({ share: shares.get(id), you: shares.who(id, tokenOf(req)) });
});

app.post('/api/share/:id/join', limit('join', 30, 3600_000), (req, res) => {
  const id = String(req.params.id);
  const origin = req.body?.origin ? parsePlace(req.body.origin) : undefined;
  const joined = shares.join(id, String(req.body?.name ?? ''), origin);
  res.json({ ...joined, share: shares.get(id) });
});

app.post('/api/share/:id/update', (req, res) => {
  const b = req.body ?? {};
  const patch: Parameters<ShareStore['update']>[2] = {};
  if (typeof b.confirmed === 'boolean') patch.confirmed = b.confirmed;
  if (['none', 'leaving', 'atStop', 'onBus', 'arrived'].includes(b.status)) patch.status = b.status;
  if (b.origin) patch.origin = parsePlace(b.origin);
  if (typeof b.name === 'string') patch.name = b.name;
  if (b.option !== undefined) patch.option = b.option;
  res.json({ share: shares.update(String(req.params.id), tokenOf(req), patch) });
});

app.post('/api/share/:id/live', (req, res) => {
  const b = req.body ?? {};
  if (!num(b.lat, -90, 90) || !num(b.lng, -180, 180)) throw new ShareError(400, 'Ogiltig position.');
  res.json({ share: shares.setLive(String(req.params.id), tokenOf(req), { lat: b.lat, lng: b.lng }, Number(b.minutes) || 0) });
});

app.delete('/api/share/:id/live', (req, res) => {
  res.json({ share: shares.stopLive(String(req.params.id), tokenOf(req)) });
});

app.delete('/api/share/:id', (req, res) => {
  shares.remove(String(req.params.id), tokenOf(req));
  res.json({ ok: true });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Okänd adress.' });
});

// Produktionsläge: servera den byggda klienten.
const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => file.endsWith('sw.js') && res.setHeader('Cache-Control', 'no-cache') }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ShareError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(502).json({ error: 'Tjänsten svarar inte just nu. Försök igen om en stund.' });
});

app.listen(PORT, () => {
  console.log(`Samåk-servern lyssnar på http://localhost:${PORT} (${provider.demo ? 'DEMOLÄGE' : 'riktig drift'})`);
});
