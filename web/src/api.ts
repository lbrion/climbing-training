import type { Config, Plan, PlanEvent } from '@climb/engine';

export interface AppState {
  configured: boolean;
  config?: Config;
  plan?: Plan;
  events?: PlanEvent[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const api = {
  state: () => fetch('/api/state').then((r) => json<AppState>(r)),
  setup: (config: Config) =>
    fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).then(
      (r) => json<AppState>(r),
    ),
  event: (event: PlanEvent) =>
    fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }).then(
      (r) => json<AppState>(r),
    ),
};
