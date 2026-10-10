import { type ReactNode, useEffect, useState } from 'react';
import type { CallTime, RtState } from '../../shared/types';
import { fmtTime } from '../../shared/time';

const paths: Record<string, string> = {
  plan: 'M4 6h11M4 12h7M4 18h11M17 9l4 3-4 3',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  walk: 'M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM10 21l2-6 2 2v4m-4-9 1-4 3 2 2 3M9 13l-2 3',
  bus: 'M6 17V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11M6 17h12M6 17v2m12-2v2M6 11h12M8.5 14.5h.01M15.5 14.5h.01',
  pin: 'M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  gps: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  swap: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  share: 'M12 3v12m0-12-4 4m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  back: 'M15 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 16v-4m0-4h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  check: 'M5 12.5 10 17l9-10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z',
  school: 'M3 9l9-5 9 5-9 5-9-5Zm4 2.5V16c2.5 2 7.5 2 10 0v-4.5',
  work: 'M4 8h16v11H4zM9 8V5h6v3',
  training: 'M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M12 20h.01M19 13a10 10 0 0 0-3-2M2 9a15 15 0 0 1 4.5-2.8M22 9a15 15 0 0 0-10-4',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a6 6 0 0 0-3-5.2',
  person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  target: 'M12 3v4m0 10v4M3 12h4m10 0h4M12 12h.01',
};

export function Icon({ name, size = 20, className, label }: { name: keyof typeof paths | string; size?: number; className?: string; label?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}

export function LineBadge({ line, mode = 'bus', size = 'md', cancelled }: { line: string; mode?: string; size?: 'sm' | 'md' | 'lg'; cancelled?: boolean }) {
  const regional = Number(line) >= 100;
  return (
    <span className={`line-badge line-${size} ${regional ? 'line-regional' : ''} ${cancelled ? 'line-cancelled' : ''}`} aria-label={`${mode === 'train' ? 'Tåg' : 'Linje'} ${line}${cancelled ? ', inställd' : ''}`}>
      {line || '?'}
    </span>
  );
}

/** Tid med realtidsstatus. Prognos och planerad tid visas separat vid avvikelse. */
export function RtTime({ time, rt, compact, strong }: { time: CallTime; rt: RtState; compact?: boolean; strong?: boolean }) {
  const delayMin = time.estimated != null ? Math.round((time.estimated - time.scheduled) / 60000) : 0;
  if (rt === 'cancelled') {
    return (
      <span className="rt-time">
        <s className="time-main">{fmtTime(time.scheduled)}</s>
        <span className="rt-tag rt-cancelled">Inställd</span>
      </span>
    );
  }
  if (time.estimated != null && rt === 'realtime') {
    return (
      <span className="rt-time">
        <span className={`time-main ${strong ? 'strong' : ''} ${delayMin >= 1 ? 'late' : ''}`}>{fmtTime(time.estimated)}</span>
        {delayMin !== 0 ? (
          <>
            <s className="time-planned" aria-label={`planerad ${fmtTime(time.scheduled)}`}>{fmtTime(time.scheduled)}</s>
            {!compact && <span className="rt-tag rt-late">{delayMin > 0 ? `+${delayMin} min` : `${delayMin} min`}</span>}
          </>
        ) : (
          !compact && <span className="rt-tag rt-live">I tid</span>
        )}
      </span>
    );
  }
  return (
    <span className="rt-time">
      <span className={`time-main ${strong ? 'strong' : ''}`}>{fmtTime(time.scheduled)}</span>
      {!compact && <span className="rt-tag rt-sched">Enligt tidtabell</span>}
    </span>
  );
}

export function Notice({ kind = 'info', title, children, action }: { kind?: 'info' | 'warn' | 'error' | 'demo' | 'ok'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const icon = kind === 'error' || kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div className="notice-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
        {action && <div className="notice-action">{action}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented-sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={18} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Laddar' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span />
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-card" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}

export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} s sedan`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min sedan`;
  return `${Math.round(m / 60)} h sedan`;
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function DemoBadge({ text = 'Demodata' }: { text?: string }) {
  return <span className="demo-badge">{text}</span>;
}
