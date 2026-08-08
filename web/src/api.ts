import type { Config, Plan, PlanEvent, PlanMetrics } from '@climb/engine';

export interface AppState {
  configured: boolean;
  config?: Config;
  plan?: Plan;
  metrics?: PlanMetrics;
  events?: PlanEvent[];
}

export function localToday(): string {
  return new Date().toLocaleDateString('en-CA');
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

const q = () => `?today=${localToday()}`;

export const api = {
  state: () => fetch(`/api/state${q()}`).then((r) => json<AppState>(r)),
  setup: (config: Config) =>
    fetch(`/api/setup${q()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).then((r) =>
      json<AppState>(r),
    ),
  event: (event: PlanEvent) =>
    fetch(`/api/events${q()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }).then((r) =>
      json<AppState>(r),
    ),
};
