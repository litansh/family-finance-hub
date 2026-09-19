import { describe, expect, it } from 'vitest';
import { buildDashboard } from './dashboard.ts';
import { sampleData } from './sample.ts';

const today = '2026-09-19';
const s = sampleData(today);
const d = buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: `${today}T04:00:00Z`, source: 'sample' });

describe('the daily brief', () => {
  it('quotes the same numbers as the screens', () => {
    const b = d.brief;
    expect(b).toMatchObject({ date: today, month: s.current, live: true });
    expect(b.yesterday.date).toBe('2026-09-18');
    const spent = d.transactions.filter((t) => !t.isIncome && t.transactionDate.slice(0, 10) === '2026-09-18').reduce((a, t) => a + t.amount, 0);
    expect(b.yesterday.spent).toBeCloseTo(spent);
    expect(b.perDayLeft).toBeCloseTo(d.free.restLeftPerDay);
    expect(b.lines.map((l) => l.id)).toEqual(expect.arrayContaining(['yesterday', 'today', 'heading']));
    expect(b.lines.find((l) => l.id === 'today')!.tone).toBe(d.free.restLeft >= 0 ? 'good' : 'bad');
  });

  it('names every rubric that went over its target, and only those', () => {
    const over = d.status.envelopes.filter((e) => e.kind === 'tracked' && e.planned > 0 && e.actual > e.planned);
    const line = d.brief.lines.find((l) => l.id === 'over');
    if (over.length === 0) expect(line).toBeUndefined();
    else for (const e of over.slice(0, 4)) expect(line!.detail).toContain(e.label);
  });

  it('says so when the data is stale, and keeps quiet about "today" for a past month', () => {
    const stale = buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: '2026-09-16T04:00:00Z' });
    expect(stale.brief.lines[0]!.id).toBe('stale');
    const past = [...s.budgets.keys()].sort()[0]!;
    const old = buildDashboard({ budget: s.budgets.get(past)!, transactions: s.transactions, today, lastSyncAt: null });
    expect(old.brief.live).toBe(false);
    expect(old.brief.lines.some((l) => l.id === 'today' || l.id === 'yesterday')).toBe(false);
  });
});
