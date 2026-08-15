import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

declare const __BUILD_ID__: string;

registerSW({ immediate: true });
setInterval(
  () => {
    navigator.serviceWorker?.getRegistration().then((r) => r?.update());
  },
  15 * 60 * 1000,
);
import type { Session } from '@climb/engine';
import { latestImports } from '@climb/engine';
import { api, type AppState, type FeedbackEvent } from './api.js';
import { Setup } from './Setup.js';
import { Settings } from './Settings.js';
import { PlanView } from './Plan.js';
import { SessionSheet } from './SessionSheet.js';

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Session | null>(null);
  const [overlay, setOverlay] = useState<'none' | 'settings' | 'assessment'>('none');
  const [showNotices, setShowNotices] = useState(false);

  useEffect(() => {
    api
      .state()
      .then(setState)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="screen center">Could not reach server. {error}</div>;
  if (!state) return <div className="screen center">Loading…</div>;

  if (!state.configured) {
    return <Setup onDone={setState} />;
  }

  if (overlay === 'assessment') {
    return (
      <Setup
        initial={state.config}
        onCancel={() => setOverlay('settings')}
        onDone={(next) => {
          setState(next);
          setOverlay('settings');
        }}
      />
    );
  }

  if (overlay === 'settings') {
    return (
      <Settings
        config={state.config!}
        plan={state.plan!}
        onClose={() => setOverlay('none')}
        onUpdate={setState}
        onRerunAssessment={() => setOverlay('assessment')}
      />
    );
  }

  const notices = state.plan?.notices ?? [];

  return (
    <div className="screen with-nav">
      <header className="topbar">
        <div>
          <h1>Climb Plan</h1>
          {state.config && state.plan && (
            <span className="phase-chip">
              {state.plan.phaseByWeek[
                Math.max(0, Math.floor((Date.parse(state.plan.generatedFor) - Date.parse(state.config.planStart)) / 604800000))
              ]?.toUpperCase() ?? ''}{' '}
              WEEK
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            aria-label={`Notifications${notices.length ? ` (${notices.length})` : ''}`}
            onClick={() => setShowNotices((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            {notices.length > 0 && <span className="badge">{notices.length}</span>}
          </button>
          <button className="ghost" onClick={() => setOverlay('settings')}>
            Settings
          </button>
        </div>
        {showNotices && (
          <div className="notice-panel">
            {notices.length === 0 ? (
              <p className="hint">You're all caught up — no plan notices right now.</p>
            ) : (
              notices.map((n, i) => (
                <div key={i} className="notice">
                  {n}
                </div>
              ))
            )}
          </div>
        )}
      </header>
      <PlanView state={state} onOpen={setOpen} onUpdate={setState} />
      <footer className="buildid">build {__BUILD_ID__}</footer>
      {open && (
        <SessionSheet
          session={open}
          imported={
            latestImports(state.events ?? [])
              .filter((e) => e.date === open.date)
              .sort((a, b) => b.durationMin - a.durationMin)[0]
          }
          feedback={[...(state.events ?? [])].reverse().find((e): e is FeedbackEvent => e.kind === 'feedback' && e.sessionId === open.id)}
          onClose={() => setOpen(null)}
          onUpdate={(next) => {
            setState(next);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
