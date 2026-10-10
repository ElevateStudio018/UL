import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../../shared/types';
import type { Bounds } from '../../shared/geo';
import { createGoogle, createLeaflet, type MapEngine, type MapLine, type MapMarker } from '../lib/mapEngine';
import { useStore } from '../lib/store';
import { Notice } from './ui';

export function useDark(): boolean {
  const theme = useStore((s) => s.settings.theme);
  const [sys, setSys] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSys(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && sys);
}

export function MapView({ lines, markers, onClick, onIdle, mobileSheetPx }: { lines: MapLine[]; markers: MapMarker[]; onClick: (p: LatLng) => void; onIdle: (b: Bounds, zoom: number) => void; mobileSheetPx: number }) {
  const el = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const config = useStore((s) => s.config);
  const focusPoints = useStore((s) => s.focusPoints);
  const focusSeq = useStore((s) => s.focusSeq);
  const dark = useDark();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const handlers = useRef({ onClick, onIdle });
  handlers.current = { onClick, onIdle };

  useEffect(() => {
    if (!el.current || !config) return;
    let cancelled = false;
    const h = { onClick: (p: LatLng) => handlers.current.onClick(p), onIdle: (b: Bounds, z: number) => handlers.current.onIdle(b, z) };
    const start = async () => {
      try {
        const eng = config.googleMapsKey ? await createGoogle(el.current!, h, config.googleMapsKey, config.googleMapId, dark) : createLeaflet(el.current!, h);
        if (cancelled) return eng.destroy();
        eng.setDark(dark);
        engine.current = eng;
        setError(null);
        setReady((n) => n + 1);
      } catch (e) {
        setError(`${(e as Error).message} Visar enkel karta i stället.`);
        const eng = createLeaflet(el.current!, h);
        if (cancelled) return eng.destroy();
        engine.current = eng;
        setReady((n) => n + 1);
      }
    };
    void start();
    return () => {
      cancelled = true;
      engine.current?.destroy();
      engine.current = null;
    };
    // Google-kartan måste skapas om för att byta färgschema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.googleMapsKey, config?.googleMapId, config ? 1 : 0, config?.googleMapsKey ? dark : false]);

  useEffect(() => {
    engine.current?.setDark(dark);
  }, [dark, ready]);

  useEffect(() => {
    engine.current?.setLines(lines);
  }, [lines, ready]);

  useEffect(() => {
    engine.current?.setMarkers(markers);
  }, [markers, ready]);

  useEffect(() => {
    if (!focusPoints?.length || !engine.current) return;
    const mobile = window.innerWidth < 900;
    engine.current.fit(focusPoints, mobile ? { top: 70, right: 40, bottom: mobileSheetPx + 30, left: 40 } : { top: 60, right: 60, bottom: 60, left: 60 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq, ready]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" aria-label="Karta" role="application" />
      {error && (
        <div className="map-error">
          <Notice kind="warn">{error}</Notice>
        </div>
      )}
    </div>
  );
}
