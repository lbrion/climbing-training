import Database from 'better-sqlite3';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Decoder, Stream } from '@garmin/fitsdk';
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
        'limit-boulder',
        'flash-boulder',
        'volume-boulder',
        'technique',
        'board-power',
        'hangboard-max',
        'hangboard-subhang',
        'strength',
        'power-endurance',
        'aerobic-capacity',
        'mobility-prehab',
        'rest',
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
  z.object({
    kind: z.literal('imported-activity'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    externalId: z.string().min(1).max(200),
    sport: z.string().max(60),
    durationMin: z.number().min(0).max(1440),
    avgHr: z.number().min(20).max(250).nullable(),
    maxHr: z.number().min(20).max(250).nullable(),
    hrSeries: z.array(z.number().min(20).max(250)).max(1440).optional(),
    climbs: z
      .array(z.object({ result: z.enum(['send', 'attempt']), grade: z.number().min(0).max(17).nullable() }))
      .max(300)
      .optional(),
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
    lastHardSessionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
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
  res.json({
    configured: true,
    config: state.config,
    plan: generatePlan(state, t),
    metrics: computeMetrics(state, t),
    events: state.events,
  });
});

app.post('/api/setup', (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(USER);
  db.prepare('INSERT OR REPLACE INTO users (id, config) VALUES (?, ?)').run(USER, JSON.stringify(parsed.data));
  if (!existing || req.query.reset === 'true') db.prepare('DELETE FROM events WHERE user_id = ?').run(USER);
  const state = loadState()!;
  const t = today(req);
  res.json({
    configured: true,
    config: state.config,
    plan: generatePlan(state, t),
    metrics: computeMetrics(state, t),
    events: state.events,
  });
});

// FIT ingestion: parses a watch export (COROS, Garmin, …) into an imported-activity event.
// Only standard FIT fields are decoded; vendor-specific per-climb data (grades, sends) is not in the
// public profile, so the response's `report` echoes message/split structure to aid mapping it later.
type ImportedActivity = Extract<PlanEvent, { kind: 'imported-activity' }>;

function parseFit(buf: Buffer): { event: ImportedActivity; report: Record<string, unknown> } | { error: string } {
  const stream = Stream.fromBuffer(buf);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT() || !decoder.checkIntegrity()) return { error: 'not a valid FIT file' };
  const { messages, errors } = decoder.read();

  const session = messages.sessionMesgs?.[0];
  if (!session) return { error: 'FIT file has no session message' };
  const fileId = messages.fileIdMesgs?.[0];
  // localDateTime fields decode as raw FIT-epoch seconds (only dateTime fields become JS Dates).
  const FIT_EPOCH_MS = 631065600000;
  const toDate = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === 'number' ? new Date(v * 1000 + FIT_EPOCH_MS) : null);
  const local = toDate(messages.activityMesgs?.[0]?.localTimestamp) ?? toDate(session.startTime);
  if (!local) return { error: 'FIT file has no usable timestamp' };
  const date = local.toISOString().slice(0, 10);

  const hrs = (messages.recordMesgs ?? []).map((r) => r.heartRate).filter((h): h is number => typeof h === 'number');
  const avgHr = session.avgHeartRate ?? (hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null);
  const maxHr = session.maxHeartRate ?? (hrs.length ? Math.max(...hrs) : null);

  // Per-minute average HR, minute 0 = session start; gaps carry the previous value.
  const startMs = (toDate(session.startTime) ?? local).getTime();
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const r of messages.recordMesgs ?? []) {
    if (typeof r.heartRate !== 'number' || !(r.timestamp instanceof Date)) continue;
    const minute = Math.floor((r.timestamp.getTime() - startMs) / 60000);
    if (minute < 0 || minute > 1439) continue;
    const b = buckets.get(minute) ?? { sum: 0, n: 0 };
    b.sum += r.heartRate;
    b.n++;
    buckets.set(minute, b);
  }
  let hrSeries: number[] | undefined;
  if (buckets.size >= 2) {
    hrSeries = [];
    let prev = buckets.get(Math.min(...buckets.keys()))!;
    for (let m = 0; m <= Math.max(...buckets.keys()); m++) {
      const b = buckets.get(m) ?? prev;
      hrSeries.push(Math.min(250, Math.max(20, Math.round(b.sum / b.n))));
      prev = b;
    }
  }

  const created = fileId?.timeCreated instanceof Date ? fileId.timeCreated.toISOString() : String(fileId?.timeCreated ?? '');
  const event: ImportedActivity = {
    kind: 'imported-activity',
    date,
    externalId: `${fileId?.manufacturer ?? 'fit'}-${fileId?.serialNumber ?? 0}-${created || date}`,
    sport: [session.sport, session.subSport].filter(Boolean).join('/') || 'unknown',
    durationMin: Math.max(1, Math.round((session.totalTimerTime ?? 0) / 60)),
    avgHr,
    maxHr,
    hrSeries,
  };

  const splits = messages.splitMesgs ?? [];
  const report = {
    date,
    sport: event.sport,
    durationMin: event.durationMin,
    avgHr,
    maxHr,
    messageCounts: Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])),
    splitTypes: splits.map((s) => s.splitType),
    splitSample: splits.slice(0, 3),
    decodeErrors: errors.map(String),
  };
  return { event, report };
}

app.post('/api/import/fit', express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  const state = loadState();
  if (!state) return res.status(409).json({ error: 'not configured' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'empty upload' });

  let parsed: ReturnType<typeof parseFit>;
  try {
    parsed = parseFit(req.body);
  } catch (e) {
    return res.status(400).json({ error: `could not decode FIT file: ${String(e)}` });
  }
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  const valid = eventSchema.safeParse(parsed.event);
  if (!valid.success) return res.status(400).json({ error: valid.error.flatten() });

  const duplicate = state.events.some((e) => e.kind === 'imported-activity' && e.externalId === parsed.event.externalId);
  if (!duplicate) db.prepare('INSERT INTO events (user_id, payload) VALUES (?, ?)').run(USER, JSON.stringify(valid.data));

  const next = loadState()!;
  const t = today(req);
  res.json({
    configured: true,
    config: next.config,
    plan: generatePlan(next, t),
    metrics: computeMetrics(next, t),
    events: next.events,
    import: { skipped: duplicate, ...parsed.report },
  });
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
