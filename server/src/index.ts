import Database from 'better-sqlite3';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { computeMetrics, generatePlan, type PlanEvent, type UserState } from '@climb/engine';

const dbPath = process.env.DB_PATH ?? './data/climb.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, config TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`);

const USER = 'me';

function loadState(): UserState | null {
  const row = db.prepare('SELECT config FROM users WHERE id = ?').get(USER) as { config: string } | undefined;
  if (!row) return null;
  const events = (db.prepare('SELECT payload FROM events WHERE user_id = ? ORDER BY seq').all(USER) as { payload: string }[]).map(
    (r) => JSON.parse(r.payload) as PlanEvent,
  );
  return { config: JSON.parse(row.config), events };
}

const painSchema = z.object({
  site: z.enum(['finger', 'elbow', 'shoulder', 'wrist', 'back', 'knee']),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const eventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('feedback'),
    sessionId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    completed: z.boolean(),
    rpe: z.number().min(1).max(10).nullable(),
    pain: painSchema.nullable(),
    actualType: z
      .enum([
        'limit-boulder', 'flash-boulder', 'volume-boulder', 'technique', 'board-power', 'hangboard-max',
        'hangboard-subhang', 'strength', 'power-endurance', 'aerobic-capacity', 'mobility-prehab', 'rest',
      ])
      .nullable()
      .optional(),
    topGrade: z.number().min(0).max(17).nullable().optional(),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('readiness'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    kind: z.literal('move'),
    sessionId: z.string(),
    fromDate: z.string(),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    kind: z.literal('availability'),
    date: z.string(),
    availability: z.object({ minutesByWeekday: z.array(z.number().min(0).max(600)).length(7) }),
  }),
  z.object({
    kind: z.literal('goal'),
    date: z.string(),
    goal: z.union([
      z.object({ type: z.literal('grade'), targetGrade: z.number().min(0).max(17) }),
      z.object({ type: z.literal('skill'), skill: z.enum(['overhang', 'slab', 'dynamic', 'crimps', 'compression', 'endurance']) }),
    ]),
  }),
]);

const configSchema = z.object({
  assessment: z.object({
    date: z.string(),
    maxBoulderGrade: z.number().min(0).max(17),
    flashGrade: z.number().min(0).max(17),
    fingerStrengthPctBw: z.number().min(50).max(300).nullable(),
    maxPullupsAdded: z.number().min(-50).max(150).nullable(),
    experienceYears: z.number().min(0).max(60),
    weeklySessionsHistorical: z.number().min(0).max(14),
    injuryHistory: z.array(z.enum(['finger', 'elbow', 'shoulder', 'wrist', 'back', 'knee'])),
    lastHardSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    selfRated: z.object({
      technique: z.number().min(1).max(5),
      power: z.number().min(1).max(5),
      endurance: z.number().min(1).max(5),
    }),
  }),
  goal: eventSchema.options[4].shape.goal,
  availability: z.object({ minutesByWeekday: z.array(z.number().min(0).max(600)).length(7) }),
  equipment: z.object({
    climbingGym: z.boolean(),
    hangboard: z.boolean(),
    boardWall: z.boolean(),
    weights: z.boolean(),
    pullupBar: z.boolean(),
  }),
  planStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const app = express();
app.use(express.json());

function today(req: express.Request): string {
  const q = req.query.today;
  if (typeof q === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  return new Date().toISOString().slice(0, 10);
}

app.get('/api/state', (req, res) => {
  const state = loadState();
  if (!state) return res.json({ configured: false });
  const t = today(req);
  res.json({ configured: true, config: state.config, plan: generatePlan(state, t), metrics: computeMetrics(state, t), events: state.events });
});

app.post('/api/setup', (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(USER);
  db.prepare('INSERT OR REPLACE INTO users (id, config) VALUES (?, ?)').run(USER, JSON.stringify(parsed.data));
  if (!existing || req.query.reset === 'true') db.prepare('DELETE FROM events WHERE user_id = ?').run(USER);
  const state = loadState()!;
  const t = today(req);
  res.json({ configured: true, config: state.config, plan: generatePlan(state, t), metrics: computeMetrics(state, t), events: state.events });
});

app.post('/api/events', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const state = loadState();
  if (!state) return res.status(409).json({ error: 'not configured' });
  db.prepare('INSERT INTO events (user_id, payload) VALUES (?, ?)').run(USER, JSON.stringify(parsed.data));
  const next = loadState()!;
  const t = today(req);
  res.json({ configured: true, config: next.config, plan: generatePlan(next, t), metrics: computeMetrics(next, t), events: next.events });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`listening on :${port}`));
