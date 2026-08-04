import { useEffect, useState } from 'react';
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
    api.state().then(setState).catch((e) => setError(String(e)));
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
        <h1>Climb Plan</h1>
        <button className="ghost" onClick={() => setShowSetup(true)}>
          Settings
        </button>
      </header>
      <PlanView state={state} onOpen={setOpen} />
      {open && (
        <SessionSheet
          session={open}
          state={state}
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
