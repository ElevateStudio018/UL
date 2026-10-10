// Kartabstraktion: Google Maps när en webbläsarnyckel finns, annars Leaflet med
// OpenStreetMap-kartbilder (demoläge). Samma markörer och linjer i båda.

import L from 'leaflet';
import type { LatLng } from '../../shared/types';
import type { Bounds } from '../../shared/geo';
import { loadGoogle } from './google';

export interface MapMarker {
  id: string;
  pos: LatLng;
  html: string;
  title: string;
  z?: number;
  onClick?: () => void;
}

export interface MapLine {
  id: string;
  points: LatLng[];
  color: string;
  width: number;
  dashed?: boolean;
  opacity?: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapEngine {
  kind: 'google' | 'leaflet';
  setLines(lines: MapLine[]): void;
  setMarkers(markers: MapMarker[]): void;
  fit(points: LatLng[], pad: Padding): void;
  getBounds(): Bounds | null;
  getZoom(): number;
  setDark(dark: boolean): void;
  destroy(): void;
}

export interface MapHandlers {
  onClick: (p: LatLng) => void;
  onIdle: (b: Bounds, zoom: number) => void;
}

const CENTER: LatLng = { lat: 59.8586, lng: 17.6389 };

/** En enskild punkt visas som en liten ruta, så att panelens utfyllnad respekteras. */
const around = (p: LatLng): LatLng[] => [
  { lat: p.lat - 0.004, lng: p.lng - 0.008 },
  { lat: p.lat + 0.004, lng: p.lng + 0.008 },
];

function markerEl(m: MapMarker): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-marker';
  el.innerHTML = m.html;
  el.title = m.title;
  el.setAttribute('aria-label', m.title);
  if (m.onClick) {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      m.onClick?.();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        m.onClick?.();
      }
    });
  }
  return el;
}

export function createLeaflet(el: HTMLElement, h: MapHandlers): MapEngine {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([CENTER.lat, CENTER.lng], 13);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const lines = new Map<string, L.Polyline>();
  const markers = new Map<string, { m: L.Marker; html: string }>();
  map.on('click', (e: L.LeafletMouseEvent) => h.onClick({ lat: e.latlng.lat, lng: e.latlng.lng }));
  const idle = () => {
    const b = map.getBounds();
    h.onIdle({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, map.getZoom());
  };
  map.on('moveend', idle);
  setTimeout(idle, 0);
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);

  return {
    kind: 'leaflet',
    setLines(next) {
      const ids = new Set(next.map((l) => l.id));
      for (const [id, pl] of lines) if (!ids.has(id)) (pl.remove(), lines.delete(id));
      for (const l of next) {
        const style = { color: l.color, weight: l.width, opacity: l.opacity ?? 1, dashArray: l.dashed ? '2 8' : undefined, lineCap: 'round' as const };
        const pts = l.points.map((p) => [p.lat, p.lng] as [number, number]);
        const ex = lines.get(l.id);
        if (ex) ex.setLatLngs(pts).setStyle(style);
        else lines.set(l.id, L.polyline(pts, { ...style, interactive: false }).addTo(map));
      }
    },
    setMarkers(next) {
      const ids = new Set(next.map((m) => m.id));
      for (const [id, x] of markers) if (!ids.has(id)) (x.m.remove(), markers.delete(id));
      for (const m of next) {
        const ex = markers.get(m.id);
        if (ex && ex.html === m.html) {
          ex.m.setLatLng([m.pos.lat, m.pos.lng]);
          continue;
        }
        ex?.m.remove();
        const icon = L.divIcon({ html: markerEl(m), className: 'leaflet-html-marker', iconSize: undefined });
        const mk = L.marker([m.pos.lat, m.pos.lng], { icon, zIndexOffset: m.z ?? 0, keyboard: false, title: m.title }).addTo(map);
        markers.set(m.id, { m: mk, html: m.html });
      }
    },
    fit(points, pad) {
      if (!points.length) return;
      if (points.length === 1) points = around(points[0]);
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], maxZoom: 16 });
    },
    getBounds() {
      const b = map.getBounds();
      return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    },
    getZoom: () => map.getZoom(),
    setDark(dark) {
      el.classList.toggle('map-dark', dark);
    },
    destroy() {
      ro.disconnect();
      map.remove();
    },
  };
}

export async function createGoogle(el: HTMLElement, h: MapHandlers, key: string, mapId: string | undefined, dark: boolean): Promise<MapEngine> {
  const g = await loadGoogle(key);
  const map = new g.maps.Map(el, {
    center: CENTER,
    zoom: 13,
    mapId,
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
    colorScheme: dark ? 'DARK' : 'LIGHT',
  } as google.maps.MapOptions);

  class HtmlMarker extends g.maps.OverlayView {
    el: HTMLElement;
    constructor(public pos: LatLng, public spec: MapMarker) {
      super();
      this.el = markerEl(spec);
      this.el.style.position = 'absolute';
      this.el.style.zIndex = String(1000 + (spec.z ?? 0));
    }
    onAdd() {
      this.getPanes()!.overlayMouseTarget.appendChild(this.el);
    }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new g.maps.LatLng(this.pos.lat, this.pos.lng));
      if (p) this.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    onRemove() {
      this.el.remove();
    }
  }

  const lines = new Map<string, google.maps.Polyline>();
  const markers = new Map<string, HtmlMarker>();
  map.addListener('click', (e: google.maps.MapMouseEvent) => e.latLng && h.onClick({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
  map.addListener('idle', () => {
    const b = map.getBounds();
    if (!b) return;
    h.onIdle({ south: b.getSouthWest().lat(), west: b.getSouthWest().lng(), north: b.getNorthEast().lat(), east: b.getNorthEast().lng() }, map.getZoom() ?? 13);
  });

  return {
    kind: 'google',
    setLines(next) {
      const ids = new Set(next.map((l) => l.id));
      for (const [id, pl] of lines) if (!ids.has(id)) (pl.setMap(null), lines.delete(id));
      for (const l of next) {
        const opts: google.maps.PolylineOptions = l.dashed
          ? { path: l.points, strokeOpacity: 0, icons: [{ icon: { path: g.maps.SymbolPath.CIRCLE, scale: l.width / 2, fillOpacity: 1, fillColor: l.color, strokeOpacity: 0 }, offset: '0', repeat: `${l.width * 3}px` }] }
          : { path: l.points, strokeColor: l.color, strokeWeight: l.width, strokeOpacity: l.opacity ?? 1, icons: [] };
        const ex = lines.get(l.id);
        if (ex) ex.setOptions(opts);
        else lines.set(l.id, new g.maps.Polyline({ ...opts, map, clickable: false }));
      }
    },
    setMarkers(next) {
      const ids = new Set(next.map((m) => m.id));
      for (const [id, mk] of markers) if (!ids.has(id)) (mk.setMap(null), markers.delete(id));
      for (const m of next) {
        const ex = markers.get(m.id);
        if (ex && ex.spec.html === m.html) {
          ex.pos = m.pos;
          ex.draw();
          continue;
        }
        ex?.setMap(null);
        const mk = new HtmlMarker(m.pos, m);
        mk.setMap(map);
        markers.set(m.id, mk);
      }
    },
    fit(points, pad) {
      if (!points.length) return;
      if (points.length === 1) points = around(points[0]);
      const b = new g.maps.LatLngBounds();
      points.forEach((p) => b.extend(p));
      map.fitBounds(b, pad);
    },
    getBounds() {
      const b = map.getBounds();
      return b ? { south: b.getSouthWest().lat(), west: b.getSouthWest().lng(), north: b.getNorthEast().lat(), east: b.getNorthEast().lng() } : null;
    },
    getZoom: () => map.getZoom() ?? 13,
    setDark() {
      /* colorScheme kan bara sättas när kartan skapas; ny karta skapas vid byte. */
    },
    destroy() {
      markers.forEach((m) => m.setMap(null));
      lines.forEach((l) => l.setMap(null));
      el.innerHTML = '';
    },
  };
}
