# Samåk

Samåk är en mobilanpassad reseplanerare för kollektivtrafiken i Uppsala och Uppland.
Den hjälper två personer som startar på olika platser att resa till samma destination.
Appen är **inofficiell** och har ingen koppling till UL eller Region Uppsala.

- **Res själv**: från och till (adress, hållplats, plats, karta, egen position eller Google Maps-länk), Åk nu / Avgå tidigast / Framme senast.
- **Res tillsammans**: tre sätt att matcha resorna.
  - *Samma buss*: båda kliver på **samma tur** (samma `trip_id` och trafikdag). Samma linjenummer räcker inte.
  - *Mötas på vägen*: en gemensam hållplats, med väntetid och gemensam fortsättning.
  - *Framme samtidigt*: separata resor med högst 5, 10 eller 15 minuters skillnad i ankomsttid.
  - Tre rekommendationer: *Bästa matchningen*, *Snabbast tillsammans* och *Minst gång och byten*, var och en med en förklaring.
- **Livekarta**: bussar med linjenummer och färdriktning. Aktuell GPS-position, gammal positionsuppgift och simulerade positioner visas tydligt åtskilda. Där kan man också filtrera på linje, område och vald resa och öppna hållplatsernas avgångstavlor.
- **Resedetaljer**: vertikal tidslinje med gång, hållplatsläge, planerad och prognostiserad tid separat, *Enligt tidtabell* när realtid saknas, mellanliggande hållplatser, varningar för korta byten och knappen *Visa alternativ resa*.
- **Dela och följ**: en svårgissad, tidsbegränsad reselänk delas via mobilens delningsmeny. Person 2 behöver inget konto. Båda kan bekräfta planen och sätta status (*Jag går nu*, *Vid hållplatsen*, *På bussen*, *Framme*). Livedelning av position är frivillig, tidsbegränsad och kan stoppas direkt.
- **Extra**: sparade platser (Hem, Skola, Jobb, Träning och egna), favoritlinjer och favorithållplatser, *Dags att gå*, påminnelser inför byte och avstigning, gångtempo, filter, hemresa, sparad resa offline, mörkt läge och installation som PWA.

## Kom igång

```bash
npm install
npm run dev        # server på :8787 och Vite på :5173
```

Öppna http://localhost:5173. Utan konfiguration startar appen i **demoläge**: ett
förenklat Uppsalanät med realistiska hållplatser och simulerad realtid. Allt sådant
är märkt *Demodata*, *Demoläge* eller *Simulerad*.

Produktion:

```bash
npm run build
npm start          # servern levererar dist/ och API:t på PORT (8787)
```

Tester och typkontroll:

```bash
npm test
npm run typecheck
```

## Konfiguration för riktig drift

Kopiera `.env.example` till `.env`. Under *Inställningar → Konfiguration* i appen
syns vilka tjänster som är konfigurerade.

| Tjänst | Används till | Miljövariabler |
| --- | --- | --- |
| Google Maps JavaScript API | Karta | `GOOGLE_MAPS_BROWSER_KEY`, `GOOGLE_MAP_ID` (valfri) |
| Google Places API (New) + Geocoding | Platssökning, adress för vald punkt | `GOOGLE_MAPS_BROWSER_KEY` |
| OpenTripPlanner 2 | Reseplanering med gångvägar (OSM) | `OTP_URL`, `OTP_FEED_ID` |
| Trafiklab GTFS Regional Static (UL) | Hållplatser, turer, tidtabeller (laddas in i OTP) | `TRAFIKLAB_GTFS_STATIC_KEY` |
| Trafiklab GTFS Regional Realtime (UL) | VehiclePositions, TripUpdates, ServiceAlerts | `TRAFIKLAB_GTFS_RT_KEY` |

Se [otp/README.md](otp/README.md) för hur OTP-grafen byggs.

**Nycklar**: Trafiklab-nycklarna är hemliga och används bara på servern. Google-nyckeln
skickas till webbläsaren och ska därför begränsas i Google Cloud Console, både till
appens domäner (HTTP-referenter) och till Maps JavaScript API, Places API (New) och
Geocoding API.

Realtid slås bara på när planeringen kommer från OTP, som bygger på samma GTFS-källa.
Demodata och riktig data blandas aldrig.

## Arkitektur

```
src/       React + TypeScript (Vite), PWA (public/sw.js, manifest)
server/    Express: API, matchning, delning, GTFS-RT-cache
  providers/demo.ts   demomotor (tidtabeller, planerare, simulerad realtid)
  providers/otp.ts    OpenTripPlanner GraphQL + realtidsöverlägg
  matching.ts         tvåpersonersmatchning och poängsättning
  realtime.ts         gemensam GTFS-RT-hämtning (pausas utan användare)
  share.ts            reselänkar i minnet
shared/    typer, tidszon/trafikdygn, länktolkning, resberäkningar
otp/       konfiguration och skript för OpenTripPlanner
tests/     Vitest
```

- **Matchning**: alternativen poängsätts efter bådas restid, väntetid, antal byten
  och gångtid samt bytesmarginal. Omvägen jämfört med var och ens snabbaste egna resa
  straffas progressivt, så att ett alternativ som sparar en minut för en person inte
  ger den andra en stor omväg. Orimliga alternativ sorteras bort. Finns ingen rimlig
  matchning förklarar appen varför och föreslår annan tid, större tolerans eller
  separata resor.
- **Tid**: GTFS-tider räknas från ”middag minus 12 h” i Europe/Stockholm, så att
  sommartid och trafikdygn över midnatt blir rätt (se `tests/time.test.ts`).
- **Realtid**: koppling sker via tur-id och trafikdag, aldrig via linjenummer.
  Positioner äldre än 90 s visas som *gammal positionsuppgift*, och positioner äldre
  än 10 minuter döljs. Saknas data visas *Realtidsposition saknas*.
- **Integritet**: platsåtkomst begärs först när funktionen används. Ingen
  positionshistorik sparas. Vid livedelning lagras bara den senaste punkten, med
  utgångstid. Reselänkar har ett id på 128 bitar, en egen nyckel per deltagare och
  gäller högst 48 timmar.
- **Google Maps-länkar**: tolkas utan att hämtas. Korta länkar löses upp på servern,
  men omdirigeringar följs bara till Googles kartvärdar. Om platsen inte går att läsa
  ut får användaren söka fram och bekräfta den.

## Begränsningar

- Delade resor lagras i serverns minne. Flera instanser kräver delad lagring, till exempel Redis.
- Påminnelser fungerar medan appen är öppen eller ligger i bakgrunden. På iPhone krävs att appen är installerad på hemskärmen.
- I demoläget räknas gångvägar som fågelvägen × 1,3 och märks *Uppskattad gångväg*. Med OTP beräknas de längs OSM:s gångvägnät.
- Biljettpriser, tillgänglighet och beläggning visas inte, eftersom tillförlitligt underlag saknas.
