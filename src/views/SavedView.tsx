import { useState } from 'react';
import { fmtDay, fmtTime } from '../../shared/time';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { Icon, LineBadge, Notice } from '../components/ui';

const ICONS: Record<string, string> = { home: 'home', school: 'school', work: 'work', training: 'training', custom: 'heart' };

export function SavedView() {
  const s = useStore();
  const [newLabel, setNewLabel] = useState('');
  const [lineInput, setLineInput] = useState('');

  const travelTo = (id: string) => {
    const sp = s.saved.find((x) => x.id === id);
    if (!sp?.place) return;
    if (s.mode === 'together') s.setField('dest', { ...sp.place, source: 'saved' });
    else s.setField('to', { ...sp.place, source: 'saved' });
    navigate('planera');
  };

  const trip = s.savedTrip;
  const tripIt = trip?.itinerary ?? trip?.pair?.persons[0].itinerary;

  return (
    <div className="saved">
      <h2 className="section-title">Mina platser</h2>
      <ul className="saved-list">
        {s.saved.map((sp) => (
          <li key={sp.id} className="saved-item">
            <Icon name={ICONS[sp.kind]} />
            <div className="saved-text">
              <strong>{sp.label}</strong>
              <span className="muted small">{sp.place?.name ?? 'Inte angiven'}</span>
            </div>
            {sp.place && (
              <button className="btn btn-secondary btn-sm" onClick={() => travelTo(sp.id)}>
                Res hit
              </button>
            )}
            <button className="icon-btn" onClick={() => s.set({ searchTarget: `saved:${sp.id}` })} aria-label={`${sp.place ? 'Ändra' : 'Ange'} ${sp.label}`}>
              <Icon name="edit" size={18} />
            </button>
            {sp.kind === 'custom' && (
              <button className="icon-btn" onClick={() => s.set({ saved: s.saved.filter((x) => x.id !== sp.id) })} aria-label={`Ta bort ${sp.label}`}>
                <Icon name="trash" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newLabel.trim()) return;
          const id = `c${Date.now().toString(36)}`;
          s.set({ saved: [...s.saved, { id, label: newLabel.trim().slice(0, 30), kind: 'custom' }], searchTarget: `saved:${id}` });
          setNewLabel('');
        }}
      >
        <input className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ny favoritplats, t.ex. Mormor" aria-label="Namn på ny favoritplats" />
        <button className="btn btn-secondary" type="submit">
          <Icon name="plus" size={18} /> Lägg till
        </button>
      </form>

      <h2 className="section-title">Favoritlinjer</h2>
      <div className="row gap wrap">
        {s.favLines.map((l) => (
          <span key={l} className="fav-line">
            <button
              className="fav-line-btn"
              onClick={() => {
                s.set({ liveFilter: { ...s.liveFilter, lines: [l] } });
                navigate('karta');
              }}
              aria-label={`Visa linje ${l} på livekartan`}
            >
              <LineBadge line={l} />
            </button>
            <button className="icon-btn" onClick={() => s.set({ favLines: s.favLines.filter((x) => x !== l) })} aria-label={`Ta bort linje ${l}`}>
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
        {!s.favLines.length && <p className="muted small">Inga favoritlinjer ännu.</p>}
      </div>
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          const l = lineInput.trim();
          if (l && !s.favLines.includes(l)) s.set({ favLines: [...s.favLines, l.slice(0, 6)] });
          setLineInput('');
        }}
      >
        <input className="input" value={lineInput} onChange={(e) => setLineInput(e.target.value)} placeholder="Linjenummer" inputMode="numeric" aria-label="Lägg till favoritlinje" />
        <button className="btn btn-secondary" type="submit">
          <Icon name="plus" size={18} /> Lägg till
        </button>
      </form>

      <h2 className="section-title">Favorithållplatser</h2>
      {!s.favStops.length && <p className="muted small">Tryck på stjärnan i en avgångstavla för att spara hållplatsen.</p>}
      <ul className="saved-list">
        {s.favStops.map((st) => (
          <li key={st.id} className="saved-item">
            <Icon name="bus" />
            <div className="saved-text">
              <strong>{st.name}</strong>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                s.set({ openStop: st });
                s.focus([st]);
                navigate('karta');
              }}
            >
              Avgångar
            </button>
            <button className="icon-btn" onClick={() => s.set({ favStops: s.favStops.filter((x) => x.id !== st.id) })} aria-label={`Ta bort ${st.name}`}>
              <Icon name="trash" size={18} />
            </button>
          </li>
        ))}
      </ul>

      <h2 className="section-title">Sparad resa</h2>
      {trip && tripIt ? (
        <div className="card">
          <strong>
            {fmtDay(tripIt.start)} {fmtTime(tripIt.start)} → {trip.destination}
          </strong>
          <p className="muted small">
            Senast uppdaterad {fmtDay(trip.savedAt)} {fmtTime(trip.savedAt)}. Kan visas utan internet, men tiderna kan ha ändrats.
          </p>
          <div className="row gap">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (trip.itinerary) s.set({ selection: { kind: 'itinerary', itinerary: trip.itinerary } });
                else if (trip.pair) s.set({ selection: { kind: 'pair', option: trip.pair }, names: trip.names ?? s.names });
                navigate('planera');
              }}
            >
              Öppna
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => s.set({ savedTrip: null })}>
              Ta bort
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small">Öppna en resa och välj ”Spara för offline”.</p>
      )}

      <h2 className="section-title">Senaste sökningar</h2>
      {s.recents.length ? (
        <>
          <ul className="saved-list">
            {s.recents.map((r, i) => (
              <li key={i} className="saved-item">
                <Icon name="clock" />
                <div className="saved-text">
                  <strong>{r.name}</strong>
                  {r.address && <span className="muted small">{r.address}</span>}
                </div>
              </li>
            ))}
          </ul>
          <button className="link-btn" onClick={() => s.set({ recents: [] })}>
            Rensa sökhistorik
          </button>
        </>
      ) : (
        <p className="muted small">Inga sparade sökningar.</p>
      )}
      <Notice kind="info">Allt här sparas bara på den här enheten. Din aktuella position sparas aldrig i historiken.</Notice>
    </div>
  );
}
