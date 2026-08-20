import type { Exercise, Intensity, Phase, SessionType } from './types.js';

export interface Template {
  type: SessionType;
  title: string;
  intensity: Intensity;
  baseDurationMin: number;
  focus: string;
  /** A few sentences on what this session is for and how to run it — shown behind the info toggle in the session sheet. */
  overview: string;
  needs: { gym?: boolean; hangboard?: boolean; board?: boolean; weights?: boolean; pullupBar?: boolean };
  minGrade: number;
  minExperienceYears: number;
  fingerLoad: boolean;
  exercises: (phase: Phase, grade: number) => Exercise[];
}

const g = (grade: number, offset: number) => `V${Math.max(0, grade + offset)}`;

export const TEMPLATES: Record<SessionType, Template> = {
  'limit-boulder': {
    type: 'limit-boulder',
    title: 'Limit bouldering',
    intensity: 'high',
    baseDurationMin: 90,
    focus: 'Maximal strength and recruitment on hard boulders',
    overview:
      'The hardest climbing of your week: short, maximal problems at or above your limit, attempted fresh. The goal is recruitment, not volume — every attempt should be a genuine maximal effort with full recovery behind it. Quality collapses long before you feel wrecked, so stop when attempts stop improving. Resting long enough between tries is what makes this session work.',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up pyramid', detail: `15 min easy climbing up to ${g(grade, -2)}`, sets: '10–15 problems', rest: 'as needed' },
      {
        name: 'Limit attempts',
        detail: `Projects at ${g(grade, 0)}–${g(grade, 1)}, every attempt from full recovery`,
        sets: '4–6 problems, 3–5 tries each',
        rest: '3–5 min between attempts',
      },
      { name: 'Cool-down', detail: 'Easy mileage and shoulder care', sets: '10 min' },
    ],
  },
  'flash-boulder': {
    type: 'flash-boulder',
    title: 'Flash bouldering',
    intensity: 'medium',
    baseDurationMin: 75,
    focus: 'Onsight reading and first-try execution near your flash grade',
    overview:
      'Trains reading and first-try execution: pick problems you have never tried, read them fully from the ground, then give one honest maximal attempt each. The skill being trained is the read-then-execute loop, so a failed flash followed by a quick redo teaches more than three casual tries. Treat each attempt like it counts, because that is the point.',
    needs: { gym: true },
    minGrade: 1,
    minExperienceYears: 0,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Progressive problems, rehearse reading sequences from the ground', sets: '15 min', rest: 'as needed' },
      {
        name: 'Flash attempts',
        detail: `Fresh problems at ${g(grade, -2)}–${g(grade, -1)}, one genuine attempt each`,
        sets: '8–12 problems',
        rest: '2–3 min between problems',
      },
      { name: 'Review', detail: 'Repeat two failed flashes to extract the lesson', sets: '2 problems', rest: '2 min' },
    ],
  },
  'volume-boulder': {
    type: 'volume-boulder',
    title: 'Volume bouldering',
    intensity: 'medium',
    baseDurationMin: 75,
    focus: 'Movement mileage and base capacity',
    overview:
      'Mileage day: lots of problems well below your limit, climbed as cleanly as you can. Volume builds work capacity, skin, and movement vocabulary without digging a recovery hole, so keep the effort honest but comfortable — you should finish tired, not destroyed. Short rests keep the density up; footwork quality is the metric that matters.',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Mobility and easy traversing', sets: '10 min' },
      {
        name: 'Flash-level circuit',
        detail: `20–30 problems at ${g(grade, -3)}–${g(grade, -2)}, focus on clean footwork`,
        sets: '60 min',
        rest: '~1 min between problems',
      },
    ],
  },
  technique: {
    type: 'technique',
    title: 'Technique session',
    intensity: 'low',
    baseDurationMin: 60,
    focus: 'Deliberate movement practice',
    overview:
      'Deliberate practice on easy terrain: the grades are far below your limit on purpose, because the target is movement quality, not effort. Slow down, exaggerate the drills, and repeat problems until they feel effortless. This is also the session that fills in when finger or intensity limits push harder work out — low load, high value.',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase, grade) => [
      { name: 'Silent feet', detail: `Easy problems (${g(grade, -4)}–${g(grade, -3)}) with zero foot noise`, sets: '15 min' },
      { name: 'Repeat perfection', detail: 'Climb each problem 3x, improving efficiency each lap', sets: '6 problems', rest: '1–2 min' },
      { name: 'Style drills', detail: 'Hover hands, one-touch feet, straight-arm rests', sets: '20 min' },
    ],
  },
  'board-power': {
    type: 'board-power',
    title: 'Board power',
    intensity: 'high',
    baseDurationMin: 75,
    focus: 'Contact strength and power on steep board',
    overview:
      'Steep-board session for contact strength and hip-driven power: short problems with big moves between bad holds. Like limit bouldering, this only works fresh — full rest between problems, stop when the snap goes. Fingers take a beating on a board, so this counts as a hard finger session and gets spaced accordingly.',
    needs: { board: true },
    minGrade: 3,
    minExperienceYears: 1,
    fingerLoad: true,
    exercises: () => [
      { name: 'Warm-up', detail: 'Progressive board problems', sets: '15 min', rest: 'as needed' },
      {
        name: 'Power problems',
        detail: 'Short, hard board problems with big moves',
        sets: '8–10 problems',
        rest: '3–4 min between problems',
      },
      { name: 'Optional campus touches', detail: 'Only if fully warm and pain-free', sets: '3 sets', rest: '2–3 min' },
    ],
  },
  'hangboard-max': {
    type: 'hangboard-max',
    title: 'Max hangs',
    intensity: 'high',
    baseDurationMin: 40,
    focus: 'Maximal finger strength (20mm half crimp)',
    overview:
      'Pure finger strength: brief maximal hangs on a 20mm edge in half crimp, heavy enough that 7 seconds is genuinely hard. The long rests are not optional — incomplete recovery turns a strength stimulus into junk fatigue and tendon risk. This is the most finger-intensive session in the plan; it is gated on experience and always spaced at least 48h from other hard finger work.',
    needs: { hangboard: true },
    minGrade: 3,
    minExperienceYears: 1.5,
    fingerLoad: true,
    exercises: () => [
      { name: 'Warm-up hangs', detail: 'Progressive loading over 15 min, large edge to 20mm', sets: '6–8 hangs', rest: '1–2 min' },
      { name: 'Max hangs', detail: '7s hang at ~85–90% max load, 20mm edge, half crimp', sets: '5–6 sets', rest: '3 min between sets' },
      { name: 'Antagonist work', detail: 'Wrist extensions, push-ups', sets: '2×15', rest: '1 min' },
    ],
  },
  'hangboard-subhang': {
    type: 'hangboard-subhang',
    title: 'Sub-max hangs',
    intensity: 'medium',
    baseDurationMin: 30,
    focus: 'Tendon conditioning with low-intensity long hangs',
    overview:
      'Tendon conditioning, not strength work: long easy hangs at half effort that stimulate tissue adaptation with minimal fatigue. It should feel almost too easy — that is correct, and turning it into a workout defeats the purpose. Useful year-round and safe close to other sessions because the load stays low.',
    needs: { hangboard: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: true,
    exercises: () => [
      { name: 'Density hangs', detail: '20–30s hangs at ~50–60% effort, comfortable edge', sets: '6 sets', rest: '2 min between sets' },
      { name: 'Wrist and forearm care', detail: 'Extensions, pronation/supination', sets: '2×15', rest: '1 min' },
    ],
  },
  strength: {
    type: 'strength',
    title: 'Strength training',
    intensity: 'high',
    baseDurationMin: 60,
    focus: 'Pulling strength and posterior chain',
    overview:
      'General pulling strength to support climbing: the front lever comes first because high-tension skill work falls apart on tired lats, then the heavy pulling, then accessories. Rest fully on the lever and pull-ups — they are the point of the session; the accessory work can run tighter. Leave a rep or two in reserve outside peak weeks.',
    needs: { pullupBar: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase) => [
      { name: 'Warm-up', detail: 'Band shoulders, scap pull-ups, easy rows', sets: '8–10 min' },
      {
        name: 'Front lever progression',
        detail: 'While fresh, before any pulling: 5–8s holds at your current progression, stop while crisp',
        sets: '3–4 sets',
        rest: '2–3 min between sets',
      },
      {
        name: 'Weighted pull-ups',
        detail: phase === 'peak' ? 'Heavy triples' : '5 reps, hard but 1–2 in reserve',
        sets: '4–5 sets',
        rest: '3 min between sets',
      },
      { name: 'Rows or ring work', detail: 'Horizontal pulling for shoulder balance', sets: '3×8', rest: '90 s' },
      { name: 'Push', detail: 'Overhead press or push-ups', sets: '3×8', rest: '90 s' },
      { name: 'Optional core', detail: 'Hanging leg raises — only if anything is left in the tank', sets: '2–3 sets', rest: '1 min' },
    ],
  },
  'power-endurance': {
    type: 'power-endurance',
    title: 'Power endurance',
    intensity: 'high',
    baseDurationMin: 60,
    focus: 'Sustained hard climbing, lactate tolerance',
    overview:
      'Teaches you to keep climbing hard while pumped: blocks of back-to-back problems with incomplete rest, repeated for several rounds. The discomfort is the stimulus — the rests are deliberately too short to recover, so pick grades you can finish even when deep in the pump. Painful, effective, and best kept to one dose a week.',
    needs: { gym: true },
    minGrade: 2,
    minExperienceYears: 0.5,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Progressive problems', sets: '15 min', rest: 'as needed' },
      {
        name: '4x4s',
        detail: `4 problems at ${g(grade, -2)} back to back, no rest within a round`,
        sets: '4 rounds',
        rest: '4 min between rounds',
      },
    ],
  },
  'aerobic-capacity': {
    type: 'aerobic-capacity',
    title: 'Aerobic capacity',
    intensity: 'low',
    baseDurationMin: 45,
    focus: 'Easy continuous climbing, forearm recovery and capillarity',
    overview:
      'Continuous easy movement to build the forearm aerobic base that everything else recovers on. The rule is simple: never pumped. If you feel the pump arriving, step down or shake out — going harder makes this session worse, not better. Doubles as active recovery between hard days.',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase, grade) => [
      {
        name: 'Continuous easy climbing',
        detail: `Traverse or up-down-climb at ${g(grade, -4)} or easier, never pumped`,
        sets: '3×10 min',
        rest: '5 min between blocks',
      },
    ],
  },
  'mobility-prehab': {
    type: 'mobility-prehab',
    title: 'Mobility & prehab',
    intensity: 'low',
    baseDurationMin: 30,
    focus: 'Injury resilience: shoulders, fingers, hips',
    overview:
      'The insurance session: shoulders, fingers, and hips get the maintenance work that prevents the injuries climbers actually get. Nothing here should be hard — smooth reps, full ranges, no straining. It earns its place by being done consistently, and it substitutes in whenever pain reports pull harder sessions out of the plan.',
    needs: {},
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: () => [
      { name: 'Shoulder circuit', detail: 'Band external rotations, YTWs, scap pull-ups', sets: '2 rounds', rest: '1 min between rounds' },
      { name: 'Finger care', detail: 'Finger extensions with band, gentle stretching', sets: '2×15' },
      { name: 'Hip mobility', detail: 'Deep squat holds, hip flexor and hamstring work', sets: '10 min' },
    ],
  },
  run: {
    // Never auto-scheduled — a run only ever enters the plan through a user-logged `run` event, which overrides
    // this template's title/intensity/duration with the actual run. This entry exists so run sessions render and
    // so the info panel can explain the training science. minGrade/needs are permissive by design.
    type: 'run',
    title: 'Run',
    intensity: 'medium',
    baseDurationMin: 40,
    focus: 'Aerobic cross-training',
    overview:
      'A run logged as cross-training. Running builds central aerobic fitness and can aid recovery, but it also adds systemic training load: hard or long runs within a day of hard climbing or strength work blunt those adaptations (the concurrent-training interference effect), so the plan spaces them and counts the run toward your acute:chronic load. Easy runs are low-cost and sit happily on rest days. Running places no load on the fingers, so it is exempt from the 48/72h finger-spacing rule. Effort is scored by session-RPE (your RPE × minutes); if you sync heart rate, intensity is read from your %HRmax instead of the label.',
    needs: {},
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: () => [{ name: 'Run', detail: 'Logged as cross-training.' }],
  },
  rest: {
    type: 'rest',
    title: 'Rest day',
    intensity: 'low',
    baseDurationMin: 0,
    focus: 'Recovery',
    overview: 'Adaptation happens here, not in the gym. Sleep, food, and easy movement are the training today — protect it like a session.',
    needs: {},
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: () => [{ name: 'Rest', detail: 'Optional walk or light stretching' }],
  },
};
