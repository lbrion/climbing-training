import Database from 'better-sqlite3';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Decoder, Stream } from '@garmin/fitsdk';
import { computeMetrics, generatePlan, recommendSessionFor, type PlanEvent, type UserState } from '@climb/engine';

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
  CREATE TABLE IF NOT EXISTS fit_files (
    external_id TEXT PRIMARY KEY,
    bytes BLOB NOT NULL,
    imported_at TEXT NOT NULL
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
    exercisesDone: z.array(z.number().int().min(0).max(50)).max(50).optional(),
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
    calories: z.number().min(0).max(20000).optional(),
    ascentM: z.number().min(0).max(10000).optional(),
    blocks: z
      .array(
        z.object({
          kind: z.enum(['climb', 'rest']),
          startSec: z.number().min(0).max(86400),
          durationSec: z.number().min(0).max(86400),
          ascentM: z.number().min(0).max(10000).optional(),
          result: z.enum(['send', 'attempt']).optional(),
          avgHr: z.number().min(20).max(250).optional(),
          maxHr: z.number().min(20).max(250).optional(),
        }),
      )
      .max(400)
      .optional(),
    climbTimeMin: z.number().min(0).max(1440).optional(),
    restTimeMin: z.number().min(0).max(1440).optional(),
    avgHrClimb: z.number().min(20).max(250).nullable().optional(),
    avgHrRest: z.number().min(20).max(250).nullable().optional(),
  }),
  z.object({
    kind: z.literal('adhoc-session'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum([
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
    ]),
    durationMin: z.number().min(5).max(600).optional(),
  }),
]);

const equipmentSchema = z.object({
  climbingGym: z.boolean(),
  hangboard: z.boolean(),
  boardWall: z.boolean(),
  weights: z.boolean(),
  pullupBar: z.boolean(),
});

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
  equipment: equipmentSchema,
  planStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travel: z
    .array(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        equipment: equipmentSchema,
        availability: z.object({ minutesByWeekday: z.array(z.number().min(0).max(600)).length(7) }).optional(),
        label: z.string().max(60).optional(),
      }),
    )
    .max(50)
    .optional(),
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

// Recommend the best session to slot onto a given (empty) day; the engine picks by weakness + safety rules.
app.get('/api/recommend', (req, res) => {
  const state = loadState();
  if (!state) return res.status(409).json({ error: 'not configured' });
  const date = req.query.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
  res.json({ type: recommendSessionFor(state, today(req), date) });
});

// Dry-run: compute the full AppState as if `event` were appended, WITHOUT persisting it. Powers preview-before-keep.
app.post('/api/preview', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const state = loadState();
  if (!state) return res.status(409).json({ error: 'not configured' });
  const next: UserState = { config: state.config, events: [...state.events, parsed.data as PlanEvent] };
  const t = today(req);
  res.json({ configured: true, config: next.config, plan: generatePlan(next, t), metrics: computeMetrics(next, t), events: next.events });
});

// FIT ingestion: parses a watch export (COROS, Garmin, …) into an imported-activity event.
// Only standard FIT fields are decoded; vendor-specific per-climb data (grades, sends) is not in the
// public profile, so the response's `report` echoes message/split structure to aid mapping it later.
type ImportedActivity = Extract<PlanEvent, { kind: 'imported-activity' }>;

function parseFit(buf: Buffer): { event: ImportedActivity; report: Record<string, unknown> } | { error: string } {
  const stream = Stream.fromBuffer(buf);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT() || !decoder.checkIntegrity()) return { error: 'not a valid FIT file' };
  const { messages, errors } = decoder.read({ includeUnknownData: true });

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

  // Climb/rest structure from split messages (COROS bouldering mode: climbActive/climbRest segments).
  const sessionStart = toDate(session.startTime) ?? local;
  type Block = NonNullable<ImportedActivity['blocks']>[number];
  const blocks = (messages.splitMesgs ?? [])
    .filter((s) => s.splitType === 'climbActive' || s.splitType === 'climbRest')
    .map((s) => {
      const bStart = toDate(s.startTime);
      const kind: 'climb' | 'rest' = s.splitType === 'climbActive' ? 'climb' : 'rest';
      const block: Block = {
        kind,
        startSec: bStart ? Math.max(0, Math.round((bStart.getTime() - sessionStart.getTime()) / 1000)) : 0,
        durationSec: Math.round(s.totalTimerTime ?? 0),
      };
      if (kind === 'climb') {
        if (typeof s.totalAscent === 'number') block.ascentM = s.totalAscent;
        // COROS vendor fields on climb splits (verified against the COROS app's own per-climb chart):
        // 71 = outcome (3 send, 2 attempt), 15/16 = avg/max HR for the climb.
        const raw = s as unknown as Record<string, unknown>;
        if (raw['71'] === 3) block.result = 'send';
        else if (raw['71'] === 2) block.result = 'attempt';
        if (typeof raw['15'] === 'number') block.avgHr = raw['15'] as number;
        if (typeof raw['16'] === 'number') block.maxHr = raw['16'] as number;
      }
      return block;
    })
    .slice(0, 400);
  const resolved = blocks.filter((b) => b.kind === 'climb' && b.result != null);
  const climbSummary = (messages.splitSummaryMesgs ?? []).find((s) => s.splitType === 'climbActive');
  const restSummary = (messages.splitSummaryMesgs ?? []).find((s) => s.splitType === 'climbRest');

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
  if (typeof session.totalCalories === 'number') event.calories = session.totalCalories;
  if (typeof session.totalAscent === 'number') event.ascentM = session.totalAscent;
  if (blocks.length > 0) event.blocks = blocks;
  if (resolved.length > 0) event.climbs = resolved.map((b) => ({ result: b.result!, grade: null }));
  if (climbSummary?.totalTimerTime != null) event.climbTimeMin = Math.round(climbSummary.totalTimerTime / 60);
  if (restSummary?.totalTimerTime != null) event.restTimeMin = Math.round(restSummary.totalTimerTime / 60);
  if (climbSummary?.avgHeartRate != null) event.avgHrClimb = climbSummary.avgHeartRate;
  if (restSummary?.avgHeartRate != null) event.avgHrRest = restSummary.avgHeartRate;

  const report = {
    date,
    sport: event.sport,
    durationMin: event.durationMin,
    avgHr,
    maxHr,
    messageCounts: Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])),
    splitTypes: (messages.splitMesgs ?? []).map((s) => s.splitType),
    // First few messages of every type except the bulky record stream — this is where vendor-specific
    // climb fields (grades, sends/attempts) will show up when present.
    mesgSamples: Object.fromEntries(
      Object.entries(messages)
        .filter(([k, v]) => Array.isArray(v) && v.length > 0 && k !== 'recordMesgs')
        .map(([k, v]) => [k, (v as unknown[]).slice(0, 3)]),
    ),
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

  // Keep the original file so activities can be re-parsed as decoding improves (vendor climb fields etc.).
  db.prepare('INSERT OR REPLACE INTO fit_files (external_id, bytes, imported_at) VALUES (?, ?, ?)').run(
    parsed.event.externalId,
    req.body,
    new Date().toISOString(),
  );
  // Skip only when the latest event for this file is byte-identical; a re-upload after a parser
  // upgrade appends a superseding event (the engine takes the last event per externalId).
  const prior = [...state.events].reverse().find((e) => e.kind === 'imported-activity' && e.externalId === parsed.event.externalId);
  const duplicate = prior != null && JSON.stringify(prior) === JSON.stringify(valid.data);
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

// Re-parse stored FIT files with the current parser; when the result differs from the latest event for that
// externalId, append a superseding event (the engine takes the last event per externalId). Run after parser upgrades.
app.post('/api/import/reprocess', (req, res) => {
  const state = loadState();
  if (!state) return res.status(409).json({ error: 'not configured' });
  const latest = new Map<string, PlanEvent>();
  for (const e of state.events) {
    if (e.kind === 'imported-activity') latest.set(e.externalId, e);
  }
  const rows = db.prepare('SELECT external_id, bytes FROM fit_files').all() as { external_id: string; bytes: Buffer }[];
  let updated = 0;
  const failures: string[] = [];
  for (const row of rows) {
    try {
      const parsed = parseFit(row.bytes);
      if ('error' in parsed) {
        failures.push(`${row.external_id}: ${parsed.error}`);
        continue;
      }
      const valid = eventSchema.safeParse(parsed.event);
      if (!valid.success) {
        failures.push(`${row.external_id}: schema mismatch`);
        continue;
      }
      const prev = latest.get(parsed.event.externalId);
      if (prev && JSON.stringify(prev) === JSON.stringify(valid.data)) continue;
      db.prepare('INSERT INTO events (user_id, payload) VALUES (?, ?)').run(USER, JSON.stringify(valid.data));
      updated++;
    } catch (e) {
      failures.push(`${row.external_id}: ${String(e)}`);
    }
  }
  const next = loadState()!;
  const t = today(req);
  res.json({
    configured: true,
    config: next.config,
    plan: generatePlan(next, t),
    metrics: computeMetrics(next, t),
    events: next.events,
    reprocess: { files: rows.length, updated, failures },
  });
});

// Diagnostic: re-parse every stored FIT file with the current parser and return the reports.
// Used to map vendor-specific fields (COROS/Garmin per-climb data) from real files.
app.get('/api/import/reports', (_req, res) => {
  const rows = db.prepare('SELECT external_id, bytes, imported_at FROM fit_files ORDER BY imported_at').all() as {
    external_id: string;
    bytes: Buffer;
    imported_at: string;
  }[];
  const reports = rows.map((r) => {
    try {
      const parsed = parseFit(r.bytes);
      return { externalId: r.external_id, importedAt: r.imported_at, ...('error' in parsed ? parsed : parsed.report) };
    } catch (e) {
      return { externalId: r.external_id, importedAt: r.imported_at, error: String(e) };
    }
  });
  res.json({ count: reports.length, reports });
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
