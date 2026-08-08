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
import { api, type AppState, type ImportedActivity } from './api.js';
import { Setup } from './Setup.js';
import { Settings } from './Settings.js';
import { PlanView } from './Plan.js';
import { SessionSheet } from './SessionSheet.js';

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Session | null>(null);
  const [overlay, setOverlay] = useState<'none' | 'settings' | 'assessment'>('none');

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

  return (
    <div className="screen">
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
        <button className="ghost" onClick={() => setOverlay('settings')}>
          Settings
        </button>
      </header>
      <PlanView state={state} onOpen={setOpen} onUpdate={setState} />
      <footer className="buildid">build {__BUILD_ID__}</footer>
      {open && (
        <SessionSheet
          session={open}
          imported={
            (state.events ?? [])
              .filter((e): e is ImportedActivity => e.kind === 'imported-activity' && e.date === open.date)
              .sort((a, b) => b.durationMin - a.durationMin)[0]
          }
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
