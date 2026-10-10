import { useEffect, useRef, useState } from 'react';
import type { PairOption } from '../../shared/types';
import { fmtDay, fmtTime } from '../../shared/time';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { Icon, Notice, Spinner } from '../components/ui';

export function ShareDialog({ option, onClose }: { option?: PairOption; onClose: () => void }) {
  const s = useStore();
  const [state, setState] = useState<{ url: string; id: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dest = s.fields.dest;

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const create = async () => {
    if (!dest) return setError('Välj en gemensam destination först.');
    setBusy(true);
    setError(null);
    try {
      const time = s.time.mode === 'now' ? { mode: 'now' as const, at: Date.now() } : s.time;
      const r = await api.share.create({ destination: dest, time, strategy: s.strategy, tolerance: s.tolerance, option, names: s.names, origin: s.fields.p1 });
      s.set({ shareTokens: { ...s.shareTokens, [r.id]: r.token } });
      setState({ id: r.id, url: `${location.origin}/#/delad/${r.id}`, expiresAt: r.share.expiresAt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shareNative = async () => {
    if (!state) return;
    const text = option ? `Här är vår resa till ${dest?.name}. Öppna länken och bekräfta.` : `Ska vi åka tillsammans till ${dest?.name}? Öppna länken och fyll i var du startar.`;
    try {
      if (navigator.share) await navigator.share({ title: 'Samåk – gemensam resa', text, url: state.url });
      else await copy();
    } catch {
      /* användaren avbröt */
    }
  };
  const copy = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      setError('Kunde inte kopiera automatiskt. Markera länken och kopiera den.');
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="overlay-panel dialog">
        <div className="detail-head">
          <h2 id="share-title" className="h-title">
            {option ? 'Dela resan' : `Bjud in ${s.names[1]}`}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Stäng">
            <Icon name="close" />
          </button>
        </div>
        {!state ? (
          <>
            <p>{option ? `${s.names[1]} får se den valda planen, kan bekräfta den och visa sin status under resan.` : `${s.names[1]} öppnar länken, anger sin startplats och ser förslagen – inget konto behövs.`}</p>
            <Notice kind="info" title="Integritet">
              Länken är svårgissad, ger bara åtkomst till den här resan och slutar gälla automatiskt. {s.fields.p1 ? `Din startplats (${s.fields.p1.name}) visas för den du delar med.` : ''} Din liveposition delas aldrig utan att du själv slår på det.
            </Notice>
            {error && <Notice kind="error">{error}</Notice>}
            <button className="btn btn-primary btn-block" onClick={create} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="link" size={18} />} Skapa reselänk
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>Reselänk</span>
              <input readOnly value={state.url} onFocus={(e) => e.target.select()} />
            </label>
            <p className="muted small">
              Gäller till {fmtDay(state.expiresAt)} {fmtTime(state.expiresAt)}.
            </p>
            {error && <Notice kind="warn">{error}</Notice>}
            <div className="actions">
              <button className="btn btn-primary" onClick={shareNative}>
                <Icon name="share" size={18} /> Dela
              </button>
              <button className="btn btn-secondary" onClick={copy}>
                <Icon name="copy" size={18} /> {copied ? 'Kopierad' : 'Kopiera länk'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  navigate(`delad/${state.id}`);
                }}
              >
                <Icon name="chevron" size={18} /> Följ resan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
