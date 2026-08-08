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
import { api, type AppState } from './api.js';
import { Setup } from './Setup.js';
import { PlanView } from './Plan.js';
import { SessionSheet } from './SessionSheet.js';

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Session | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    api
      .state()
      .then(setState)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="screen center">Could not reach server. {error}</div>;
  if (!state) return <div className="screen center">Loading…</div>;

  if (!state.configured || showSetup) {
    return (
      <Setup
        initial={state.config}
        onDone={(next) => {
          setState(next);
          setShowSetup(false);
        }}
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
        <button className="ghost" onClick={() => setShowSetup(true)}>
          Settings
        </button>
      </header>
      <PlanView state={state} onOpen={setOpen} onUpdate={setState} />
      <footer className="buildid">build {__BUILD_ID__}</footer>
      {open && (
        <SessionSheet
          session={open}
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
