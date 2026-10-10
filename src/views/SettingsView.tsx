import { useState } from 'react';
import { fmtTime } from '../../shared/time';
import { ensurePermission, notificationsSupported } from '../lib/reminders';
import { useStore } from '../lib/store';
import { PrefsEditor } from './PlanView';
import { Icon, Notice, Segmented } from '../components/ui';

export function SettingsView() {
  const s = useStore();
  const cfg = s.config;
  const [notifMsg, setNotifMsg] = useState<string | null>(null);

  return (
    <div className="settings">
      <h2 className="section-title">Resinställningar</h2>
      <PrefsEditor />
      <div className="pref-row">
        <span className="pref-label">”Dags att gå”-marginal</span>
        <Segmented
          label="Marginal för Dags att gå"
          size="sm"
          value={String(s.settings.leaveMargin)}
          onChange={(v) => s.setSettings({ leaveMargin: Number(v) })}
          options={[
            { value: '0', label: 'Ingen' },
            { value: '2', label: '2 min' },
            { value: '5', label: '5 min' },
          ]}
        />
      </div>

      <h2 className="section-title">Utseende</h2>
      <Segmented
        label="Tema"
        size="sm"
        value={s.settings.theme}
        onChange={(theme) => s.setSettings({ theme })}
        options={[
          { value: 'system', label: 'Som enheten' },
          { value: 'light', label: 'Ljust' },
          { value: 'dark', label: 'Mörkt' },
        ]}
      />

      <h2 className="section-title">Påminnelser</h2>
      <p className="small">Notiser inför avresa, byte och avstigning. Fungerar medan appen är öppen eller ligger i bakgrunden. På iPhone krävs att appen är tillagd på hemskärmen.</p>
      <button
        className="btn btn-secondary"
        onClick={async () => {
          const r = await ensurePermission();
          setNotifMsg(r === 'granted' ? 'Notiser är tillåtna. Slå på påminnelser i en resa.' : r === 'denied' ? 'Notiser är blockerade. Ändra i webbläsarens inställningar.' : 'Din webbläsare stöder inte notiser.');
        }}
        disabled={!notificationsSupported()}
      >
        <Icon name="bell" size={18} /> Tillåt notiser
      </button>
      {notifMsg && <p className="muted small">{notifMsg}</p>}

      <h2 className="section-title">Integritet</h2>
      <ul className="plain small">
        <li>Platsåtkomst begärs bara när du väljer ”Min position” eller delar position.</li>
        <li>Ingen positionshistorik sparas. Vid livedelning lagras bara senaste punkten, och den raderas när delningen slutar.</li>
        <li>Reselänkar är svårgissade, tidsbegränsade och ger bara åtkomst till en resa.</li>
      </ul>
      <button
        className="btn btn-secondary"
        onClick={() => {
          if (!confirm('Radera sparade platser, favoriter, sökhistorik och sparad resa på den här enheten?')) return;
          try {
            localStorage.removeItem('samak');
          } catch {
            /* ignoreras */
          }
          location.reload();
        }}
      >
        <Icon name="trash" size={18} /> Radera mina data på enheten
      </button>

      <h2 className="section-title">Konfiguration</h2>
      {!cfg && <Notice kind="warn">Konfigurationen kunde inte hämtas från servern. {s.configError}</Notice>}
      {cfg && (
        <>
          {cfg.demo ? (
            <Notice kind="demo" title="Demoläge">
              Reseplanering, tidtabeller och bussar är realistiska exempel från Uppsala – inte riktig trafikinformation. Konfigurera tjänsterna nedan för riktig drift.
            </Notice>
          ) : (
            <Notice kind="ok" title="Riktig drift">
              Planering via OpenTripPlanner{cfg.realtime === 'gtfs-rt' ? ' med realtid från Trafiklab' : ', utan realtid'}.
              {cfg.realtimeFetchedAt && ` Realtid hämtad ${fmtTime(cfg.realtimeFetchedAt)}.`}
            </Notice>
          )}
          <ul className="config-list">
            {cfg.services.map((sv) => (
              <li key={sv.id} className="config-item">
                <span className={`status-pill ${sv.configured ? 'ok' : 'missing'}`}>
                  <Icon name={sv.configured ? 'check' : 'close'} size={14} /> {sv.configured ? 'Konfigurerad' : 'Saknas'}
                </span>
                <div>
                  <strong>{sv.name}</strong>
                  <div className="small">För: {sv.required}</div>
                  <div className="muted small">{sv.description}</div>
                  {sv.env.length > 0 && (
                    <div className="small">
                      Miljövariabler: <code>{sv.env.join(', ')}</code>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="section-title">Om Samåk</h2>
      <p className="small">
        Samåk är en inofficiell reseplanerare för kollektivtrafiken i Uppsala och Uppland och har ingen koppling till UL eller Region Uppsala. Kontrollera alltid viktig information hos trafikföretaget. Biljettpriser, tillgänglighet och beläggning visas inte eftersom tillförlitligt underlag saknas.
      </p>
      <p className="muted small">Trafikdata: Trafiklab (GTFS Regional). Karta: Google Maps eller © OpenStreetMap-bidragsgivare.</p>
    </div>
  );
}
