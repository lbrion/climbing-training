import type { CapReason, FingerGapReason } from './learn.js';

/** Collected notice intents — composed once so overlapping recovery themes don't stack. */
export interface NoticeBag {
  painFingerUntil: string | null;
  painUpperUntil: string | null;
  fingerGapReason: FingerGapReason | 'past-injury';
  capDelta: -1 | 0 | 1;
  capReason: CapReason;
  missReschedules: { title: string; date: string; detail?: string }[];
  shortfall: boolean;
  loadSpike: boolean;
  heavyToday: boolean;
  travel: string[];
  weekTrims: string[];
}

export function emptyNoticeBag(): NoticeBag {
  return {
    painFingerUntil: null,
    painUpperUntil: null,
    fingerGapReason: null,
    capDelta: 0,
    capReason: null,
    missReschedules: [],
    shortfall: false,
    loadSpike: false,
    heavyToday: false,
    travel: [],
    weekTrims: [],
  };
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : capped + '.';
}

/**
 * Collapse overlapping recovery intents (pain, finger spacing, misses, readiness) into clear copy.
 * Unrelated operational notices (travel, week trims, load spike) stay as separate lines.
 */
export function composeNotices(bag: NoticeBag): string[] {
  const out: string[] = [];
  const recovery: string[] = [];

  if (bag.painFingerUntil) {
    recovery.push(
      `finger/wrist pain — finger-loading sessions replaced with low-load work until ${bag.painFingerUntil}, and hard finger sessions stay ≥72h apart`,
    );
  } else if (bag.fingerGapReason === 'recent-pain') {
    recovery.push('recent finger/wrist pain — hard finger sessions kept 72h apart while tissues settle');
  } else if (bag.fingerGapReason === 'past-injury') {
    recovery.push('past finger/wrist injury — hard finger sessions kept 72h apart');
  } else if (bag.fingerGapReason === 'high-rpe') {
    recovery.push('recent sessions rate well above your usual effort — hard finger sessions spaced 72h apart');
  } else if (bag.fingerGapReason === 'heavy-days') {
    recovery.push('you have felt heavy on several recent days — hard finger sessions spaced 72h apart');
  }

  if (bag.painUpperUntil) {
    recovery.push(`elbow/shoulder pain — high-intensity and heavy pulling replaced with lighter work until ${bag.painUpperUntil}`);
  }

  if (bag.heavyToday) {
    recovery.push("feeling heavy today — today's intensity is dialed back");
  }

  const missSummary = (() => {
    if (bag.missReschedules.length === 0) return null;
    if (bag.missReschedules.length === 1) {
      const m = bag.missReschedules[0];
      return m.detail ?? `missed ${m.title} was rescheduled to ${m.date}`;
    }
    const sample = bag.missReschedules
      .slice(0, 2)
      .map((m) => `${m.title} → ${m.date}`)
      .join(', ');
    const more = bag.missReschedules.length > 2 ? ', …' : '';
    return `${bag.missReschedules.length} missed hard sessions were rescheduled (${sample}${more})`;
  })();

  if (bag.capDelta === -1 && bag.capReason === 'misses') {
    let line =
      'fewer training days than planned — weekly session count reduced by one. If this is the new normal, update your availability';
    if (missSummary) line += ` (${missSummary})`;
    recovery.push(line);
  } else if (missSummary) {
    recovery.push(missSummary);
  } else if (bag.shortfall) {
    recovery.push('fewer training days than planned over the last couple of weeks — update your availability if this is the new normal');
  }

  if (recovery.length >= 2) {
    out.push(sentence(`your plan is easing off while you recover: ${recovery.join('; ')}`));
  } else if (recovery.length === 1) {
    // Standalone polished forms so single-intent cases stay natural and match existing tests.
    if (bag.painFingerUntil) {
      out.push(
        `Finger/wrist pain reported: finger-loading sessions replaced with low-load work until ${bag.painFingerUntil}. Hard finger sessions stay 72h apart while you recover.`,
      );
    } else if (bag.painUpperUntil) {
      out.push(`Elbow/shoulder pain reported: high-intensity and heavy pulling replaced with lighter work until ${bag.painUpperUntil}.`);
    } else if (bag.fingerGapReason === 'past-injury') {
      out.push('Past finger/wrist injury: hard finger sessions are kept 72h apart.');
    } else if (bag.fingerGapReason === 'recent-pain') {
      out.push('Recent finger/wrist pain: hard finger sessions stay 72h apart while tissues settle.');
    } else if (bag.fingerGapReason === 'high-rpe') {
      out.push('Recent sessions rate well above your usual effort: hard finger sessions spaced 72h apart.');
    } else if (bag.fingerGapReason === 'heavy-days') {
      out.push('You have felt heavy on several recent days: hard finger sessions spaced 72h apart.');
    } else if (bag.heavyToday) {
      out.push("Feeling heavy today: today's intensity is dialed back. Quality over load.");
    } else if (bag.capDelta === -1 && bag.capReason === 'misses') {
      let msg = 'You trained several days fewer than planned over the last 3 weeks: weekly session count reduced by one.';
      if (bag.shortfall) {
        msg += ' If this is the new normal, update your availability so the plan matches real life.';
      }
      if (missSummary) msg += ` ${sentence(missSummary)}`;
      out.push(msg);
    } else if (missSummary) {
      out.push(sentence(missSummary));
    } else if (bag.shortfall) {
      out.push(
        'You trained fewer days than planned over the last couple of weeks — moving or swapping sessions is fine, but if this is the new normal, update your availability so the plan matches real life.',
      );
    } else {
      out.push(sentence(recovery[0]));
    }
  }

  if (bag.capDelta === 1 && bag.capReason === 'clean-block') {
    out.push('You have hit your weekly target at comfortable effort with no shortfall: weekly session count increased by one.');
  }

  if (bag.loadSpike) {
    out.push('Training load rose quickly (acute:chronic > 1.3). High-intensity sessions this week are capped at moderate effort.');
  }

  out.push(...bag.travel);
  out.push(...bag.weekTrims);
  return out;
}
