// DEMODATA. Hållplatsnamnen och lägena finns i Uppsala, men linjesträckningar,
// linjenummer och tider är förenklade exempel och ska inte användas för riktiga resor.

export interface DemoStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  platform?: string;
}

export interface DemoLine {
  line: string;
  routeId: string;
  mode: 'bus';
  /** Hållplats-id i ordning för riktning 0. Riktning 1 är omvänd. */
  stops: string[];
  /** Turintervall i minuter: [dag, kväll, natt]. */
  headway: [number, number, number];
  /** Förskjutning i minuter så att linjer inte avgår samtidigt. */
  offset: number;
  speedKmh: number;
}

const s = (id: string, name: string, lat: number, lng: number, platform?: string): DemoStop => ({ id, name, lat, lng, platform });

export const DEMO_STOPS: DemoStop[] = [
  s('demo:central-a', 'Uppsala Centralstation', 59.8584, 17.6462, 'A'),
  s('demo:central-b', 'Uppsala Centralstation', 59.8590, 17.6448, 'B'),
  s('demo:stora-torget', 'Stora torget', 59.8587, 17.6385, 'C'),
  s('demo:akademiska', 'Akademiska sjukhuset', 59.8497, 17.6395),
  s('demo:rosendal', 'Rosendal', 59.8405, 17.6290),
  s('demo:gottsunda', 'Gottsunda centrum', 59.8075, 17.6203),
  s('demo:valsatra', 'Valsätra', 59.8173, 17.6290),
  s('demo:svartbacken', 'Svartbäcken', 59.8722, 17.6431),
  s('demo:gamla-uppsala', 'Gamla Uppsala', 59.8978, 17.6330),
  s('demo:stenhagen', 'Stenhagen centrum', 59.8573, 17.5745),
  s('demo:flogsta', 'Flogsta centrum', 59.8508, 17.5890),
  s('demo:ekonomikum', 'Ekonomikum', 59.8580, 17.6175),
  s('demo:vaksala-torg', 'Vaksala torg', 59.8603, 17.6547),
  s('demo:granby', 'Gränby centrum', 59.8778, 17.6740),
  s('demo:eriksberg', 'Eriksberg', 59.8455, 17.5975),
  s('demo:rackarberg', 'Rackarbergsgatan', 59.8532, 17.6115),
  s('demo:bolanderna', 'Boländerna', 59.8540, 17.6830),
  s('demo:fyrislund', 'Fyrislund', 59.8480, 17.7005),
  s('demo:sunnersta', 'Sunnersta', 59.7962, 17.6448),
  s('demo:ultuna', 'Ultuna', 59.8160, 17.6555),
  s('demo:polacksbacken', 'Polacksbacken', 59.8398, 17.6468),
  s('demo:studenternas', 'Studenternas', 59.8510, 17.6462),
  s('demo:luthagen', 'Luthagen', 59.8652, 17.6255),
  s('demo:loten', 'Löten', 59.8790, 17.6215),
  s('demo:savja', 'Sävja', 59.8235, 17.7045),
  s('demo:kungsgardet', 'Kungsgärdet', 59.8652, 17.6100),
  s('demo:nyby', 'Nyby', 59.8735, 17.6600),
  s('demo:storvreta', 'Storvreta centrum', 59.9580, 17.7060),
  s('demo:fyrishov', 'Fyrishov', 59.8690, 17.6225),
  s('demo:science-park', 'Uppsala Science Park', 59.8430, 17.6380),
];

export const DEMO_LINES: DemoLine[] = [
  { line: '3', routeId: 'demo:r3', mode: 'bus', stops: ['demo:gottsunda', 'demo:valsatra', 'demo:rosendal', 'demo:akademiska', 'demo:stora-torget', 'demo:central-b', 'demo:svartbacken', 'demo:gamla-uppsala'], headway: [10, 15, 30], offset: 0, speedKmh: 21 },
  { line: '4', routeId: 'demo:r4', mode: 'bus', stops: ['demo:stenhagen', 'demo:flogsta', 'demo:ekonomikum', 'demo:stora-torget', 'demo:central-a', 'demo:vaksala-torg', 'demo:granby'], headway: [10, 15, 30], offset: 3, speedKmh: 21 },
  { line: '5', routeId: 'demo:r5', mode: 'bus', stops: ['demo:eriksberg', 'demo:rackarberg', 'demo:akademiska', 'demo:stora-torget', 'demo:central-a', 'demo:bolanderna', 'demo:fyrislund'], headway: [12, 20, 30], offset: 6, speedKmh: 21 },
  { line: '7', routeId: 'demo:r7', mode: 'bus', stops: ['demo:sunnersta', 'demo:ultuna', 'demo:polacksbacken', 'demo:science-park', 'demo:studenternas', 'demo:central-b', 'demo:stora-torget', 'demo:luthagen', 'demo:loten'], headway: [10, 15, 30], offset: 5, speedKmh: 22 },
  { line: '11', routeId: 'demo:r11', mode: 'bus', stops: ['demo:savja', 'demo:fyrislund', 'demo:vaksala-torg', 'demo:central-a', 'demo:stora-torget', 'demo:kungsgardet', 'demo:fyrishov'], headway: [15, 20, 30], offset: 8, speedKmh: 22 },
  { line: '12', routeId: 'demo:r12', mode: 'bus', stops: ['demo:granby', 'demo:nyby', 'demo:svartbacken', 'demo:central-b', 'demo:studenternas', 'demo:polacksbacken', 'demo:ultuna'], headway: [15, 20, 30], offset: 2, speedKmh: 22 },
  { line: '801', routeId: 'demo:r801', mode: 'bus', stops: ['demo:central-a', 'demo:svartbacken', 'demo:gamla-uppsala', 'demo:storvreta'], headway: [30, 30, 60], offset: 10, speedKmh: 40 },
];

export interface DemoPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  tags: string;
}

/** Exempel på besöksmål för platssökning i demoläge. */
export const DEMO_PLACES: DemoPlace[] = [
  { name: 'Uppsala domkyrka', address: 'Domkyrkoplan, Uppsala', lat: 59.8581, lng: 17.6337, tags: 'kyrka sevärdhet' },
  { name: 'Uppsala slott', address: 'Slottet, Uppsala', lat: 59.8540, lng: 17.6343, tags: 'sevärdhet' },
  { name: 'Ångströmlaboratoriet', address: 'Lägerhyddsvägen 1, Uppsala', lat: 59.8392, lng: 17.6465, tags: 'universitet skola' },
  { name: 'Ekonomikum', address: 'Kyrkogårdsgatan 10, Uppsala', lat: 59.8575, lng: 17.6182, tags: 'universitet skola' },
  { name: 'Studenternas IP', address: 'Sankt Johannesgatan, Uppsala', lat: 59.8514, lng: 17.6475, tags: 'idrott arena fotboll' },
  { name: 'Fyrishov', address: 'Idrottsgatan 2, Uppsala', lat: 59.8695, lng: 17.6215, tags: 'bad idrott simhall' },
  { name: 'Gränby centrum', address: 'Marknadsgatan, Uppsala', lat: 59.8783, lng: 17.6748, tags: 'butik köpcentrum' },
  { name: 'Gränbystaden IKEA', address: 'Gränbystaden, Uppsala', lat: 59.8800, lng: 17.6820, tags: 'butik möbler' },
  { name: 'Uppsala Konsert & Kongress', address: 'Vaksala torg 1, Uppsala', lat: 59.8597, lng: 17.6496, tags: 'konsert evenemang' },
  { name: 'Akademiska sjukhuset', address: 'Sjukhusvägen, Uppsala', lat: 59.8491, lng: 17.6387, tags: 'sjukhus vård' },
  { name: 'Katedralskolan', address: 'Skolgatan 2, Uppsala', lat: 59.8596, lng: 17.6290, tags: 'skola gymnasium' },
  { name: 'Rosendalsgymnasiet', address: 'Lillsjövägen, Uppsala', lat: 59.8418, lng: 17.6255, tags: 'skola gymnasium' },
  { name: 'Botaniska trädgården', address: 'Villavägen 8, Uppsala', lat: 59.8510, lng: 17.6290, tags: 'park sevärdhet' },
  { name: 'Stadsträdgården', address: 'Svandammen, Uppsala', lat: 59.8530, lng: 17.6420, tags: 'park' },
  { name: 'Hemköp Stora torget', address: 'Stora torget, Uppsala', lat: 59.8590, lng: 17.6380, tags: 'butik mat' },
  { name: 'Pressbyrån Centralstationen', address: 'Kungsgatan 52, Uppsala', lat: 59.8587, lng: 17.6460, tags: 'butik kiosk' },
  { name: 'Hambergs Fisk', address: 'Fyristorg 8, Uppsala', lat: 59.8575, lng: 17.6365, tags: 'restaurang' },
  { name: 'Güntherska Hovkonditori', address: 'Östra Ågatan 31, Uppsala', lat: 59.8573, lng: 17.6400, tags: 'kafé restaurang' },
  { name: 'Ofvandahls', address: 'Sysslomansgatan 3, Uppsala', lat: 59.8597, lng: 17.6315, tags: 'kafé' },
  { name: 'Gamla Uppsala museum', address: 'Disavägen, Uppsala', lat: 59.8990, lng: 17.6290, tags: 'museum sevärdhet' },
  { name: 'Sunnersta strandbad', address: 'Sunnersta, Uppsala', lat: 59.7930, lng: 17.6520, tags: 'bad' },
  { name: 'SLU Ultuna', address: 'Ulls väg, Uppsala', lat: 59.8155, lng: 17.6590, tags: 'universitet skola' },
  { name: 'Gottsunda centrum', address: 'Valthornsvägen, Uppsala', lat: 59.8080, lng: 17.6195, tags: 'butik köpcentrum' },
  { name: 'Uppsala Science Park', address: 'Dag Hammarskjölds väg 52, Uppsala', lat: 59.8432, lng: 17.6372, tags: 'kontor jobb' },
  { name: 'Storvreta IP', address: 'Storvreta', lat: 59.9605, lng: 17.7020, tags: 'idrott' },
  { name: 'Flogsta studentkorridorer', address: 'Flogstavägen, Uppsala', lat: 59.8505, lng: 17.5850, tags: 'bostad' },
  { name: 'Kvarnen Fyrislund', address: 'Fyrislundsgatan, Uppsala', lat: 59.8485, lng: 17.6990, tags: 'jobb industri' },
  { name: 'Eriksbergs skola', address: 'Eriksberg, Uppsala', lat: 59.8460, lng: 17.6010, tags: 'skola' },
  { name: 'Luthagens bibliotek', address: 'Luthagen, Uppsala', lat: 59.8645, lng: 17.6270, tags: 'bibliotek' },
  { name: 'Sävja centrum', address: 'Sävja, Uppsala', lat: 59.8240, lng: 17.7060, tags: 'butik' },
];
