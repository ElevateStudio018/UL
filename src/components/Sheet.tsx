import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';

const SNAPS = { peek: 0.18, half: 0.52, full: 0.92 } as const;

export function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return m;
}

export function sheetHeightPx(snap: keyof typeof SNAPS): number {
  return Math.round(window.innerHeight * SNAPS[snap]);
}

/** Uppdragbar panel på mobilen. På datorn renderas innehållet som vänsterpanel. */
export function Sheet({ children, header }: { children: ReactNode; header?: ReactNode }) {
  const mobile = useIsMobile();
  const snap = useStore((s) => s.sheetSnap);
  const set = useStore((s) => s.set);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);

  if (!mobile) {
    return (
      <aside className="panel" aria-label="Reseplanering">
        {header}
        <div className="panel-scroll">{children}</div>
      </aside>
    );
  }

  const vh = window.innerHeight;
  const height = drag ?? sheetHeightPx(snap);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, h: height };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const h = Math.min(vh * 0.95, Math.max(vh * 0.12, start.current.h + (start.current.y - e.clientY)));
    setDrag(h);
  };
  const onUp = () => {
    if (!start.current) return;
    const h = drag ?? start.current.h;
    const moved = Math.abs(h - start.current.h) > 6;
    start.current = null;
    setDrag(null);
    if (!moved) {
      set({ sheetSnap: snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half' });
      return;
    }
    const frac = h / vh;
    const best = (Object.keys(SNAPS) as (keyof typeof SNAPS)[]).reduce((a, b) => (Math.abs(SNAPS[b] - frac) < Math.abs(SNAPS[a] - frac) ? b : a));
    set({ sheetSnap: best });
  };

  return (
    <section className={`sheet ${drag != null ? 'dragging' : ''}`} style={{ height }} aria-label="Resepanel">
      <div
        className="sheet-handle"
        role="slider"
        tabIndex={0}
        aria-label="Dra för att ändra panelens storlek"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={snap === 'peek' ? 0 : snap === 'half' ? 1 : 2}
        aria-valuetext={snap === 'peek' ? 'liten' : snap === 'half' ? 'halv' : 'hel'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') set({ sheetSnap: snap === 'peek' ? 'half' : 'full' });
          if (e.key === 'ArrowDown') set({ sheetSnap: snap === 'full' ? 'half' : 'peek' });
        }}
      >
        <span />
      </div>
      {header}
      <div className="panel-scroll">{children}</div>
    </section>
  );
}
