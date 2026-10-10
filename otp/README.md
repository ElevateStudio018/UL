# OpenTripPlanner för Samåk

GTFS-filer och fordonspositioner är inte en reseplanerare. Samåk använder därför
OpenTripPlanner 2 (OTP) som routingmotor, byggd på **samma** GTFS-källa som
realtidsflödena (Trafiklab GTFS Regional, operatör `ul`). Då stämmer tur-id,
hållplats-id och trafikdagar mellan planering och realtid.

## Steg

1. Skaffa nycklar på Trafiklab för **GTFS Regional Static** och **GTFS Regional
   Realtime**. Läs aktuella villkor, kvoter och datatäckning för UL innan drift.
2. Hämta data (kräver `osmium-tool`):
   ```bash
   TRAFIKLAB_GTFS_STATIC_KEY=… ./otp/download.sh
   ```
3. Bygg grafen (tar några minuter, kräver ca 6 GB minne):
   ```bash
   docker compose -f otp/docker-compose.yml run --rm otp-build
   ```
4. Starta OTP med realtid för prognoser och inställda turer:
   ```bash
   TRAFIKLAB_GTFS_RT_KEY=… docker compose -f otp/docker-compose.yml up -d otp
   ```
5. Sätt i `.env`:
   ```
   OTP_URL=http://localhost:8080/otp/gtfs/v1
   OTP_FEED_ID=ul
   ```

Appen använder frågan `planConnection` i GTFS GraphQL API, som finns i OTP 2.6
och senare (2.7 rekommenderas). Kontrollera schemat i OTP:s inbyggda GraphiQL
(`/graphiql`) om du kör en annan version. Äldre versioner exponerar API:t på
`/otp/routers/default/index/graphql`.

## Realtid och kvoter

- OTP läser **TripUpdates** och **ServiceAlerts**, så att planeringen tar hänsyn
  till förseningar och inställda turer.
- Samåk-servern läser **VehiclePositions** (och TripUpdates/ServiceAlerts för
  kartan) i en gemensam cache och pausar hämtningen när ingen använder appen.
  Det ger två konsumenter av TripUpdates – stäm av mot din kvot hos Trafiklab
  och höj intervallen i `server/realtime.ts` vid behov.
- Fordon kopplas till turer via `trip_id` + `start_date`, aldrig via linjenummer.
- Uppdatera GTFS-filen och bygg om grafen regelbundet (t.ex. varje natt), så att
  tidtabellerna inte blir inaktuella.
