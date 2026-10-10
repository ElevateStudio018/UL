import type { Itinerary, LatLng, PairOption, Place } from '../../shared/types';
import type { MapLine, MapMarker } from './mapEngine';
import { destHtml, meetHtml, personHtml } from './markers';

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0a7a3d';
}

export function itineraryLines(it: Itinerary, color: string, prefix: string): MapLine[] {
  const out: MapLine[] = [];
  it.legs.forEach((l, i) => {
    if (l.kind === 'walk' && l.distance > 5) out.push({ id: `${prefix}-w${i}`, points: l.geometry, color, width: 5, dashed: true });
    if (l.kind === 'transit') out.push({ id: `${prefix}-t${i}`, points: l.geometry, color, width: 6, opacity: l.rt === 'cancelled' ? 0.35 : 0.95 });
  });
  return out;
}

/** Båda personernas resvägar, den gemensamma delen och mötespunkten. */
export function pairLayers(option: PairOption, names: [string, string], dest?: Place): { lines: MapLine[]; markers: MapMarker[]; points: LatLng[] } {
  const colors = [cssVar('--p1'), cssVar('--p2')];
  const lines: MapLine[] = [];
  const markers: MapMarker[] = [];
  const points: LatLng[] = [];
  const s = option.shared;
  if (s && !s.walkTogether && s.tripId) {
    for (const p of option.persons) {
      const leg = p.itinerary.legs.find((l) => l.kind === 'transit' && l.tripId === s.tripId && l.serviceDate === s.serviceDate);
      if (leg && leg.kind === 'transit') {
        const pts = leg.geometry;
        // Gemensamma delen ritas bredare i grönt under personernas linjer.
        const fromIdx = pts.findIndex((x) => Math.abs(x.lat - s.from.lat) < 1e-4 && Math.abs(x.lng - s.from.lng) < 1e-4);
        const toIdx = pts.findIndex((x) => Math.abs(x.lat - s.to.lat) < 1e-4 && Math.abs(x.lng - s.to.lng) < 1e-4);
        const seg = fromIdx >= 0 && toIdx > fromIdx ? pts.slice(fromIdx, toIdx + 1) : pts;
        lines.push({ id: 'shared', points: seg, color: cssVar('--accent'), width: 14, opacity: 0.35 });
        break;
      }
    }
  }
  option.persons.forEach((p, i) => {
    lines.push(...itineraryLines(p.itinerary, colors[i], `p${i}`));
    const first = p.itinerary.legs[0];
    const start = first.kind === 'transit' ? first.from : first.kind === 'walk' ? first.from : first.at;
    markers.push({ id: `origin-${i}`, pos: start, html: personHtml(i as 0 | 1, names[i]), title: `${names[i]} startar här`, z: 20 });
    points.push(start);
  });
  if (option.meeting) {
    markers.push({ id: 'meet', pos: option.meeting, html: meetHtml(), title: `Mötesplats: ${option.meeting.name}`, z: 25 });
    points.push(option.meeting);
  }
  if (dest) {
    markers.push({ id: 'dest', pos: dest, html: destHtml(), title: `Destination: ${dest.name}`, z: 22 });
    points.push(dest);
  }
  return { lines, markers, points };
}
