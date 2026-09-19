import { describe, expect, it } from 'vitest';
import { buildDashboard } from './dashboard.ts';
import { installmentPlans, type StoredTransaction } from './overlay.ts';
import { businessDisplayName, businessKey } from './insights.ts';
import { sampleData } from './sample.ts';
import { strategy } from './strategy.ts';

// Every screen is a different cut of the same month. These tests pin the places
// where two screens state the same fact, so they can never drift apart.
const today = '2026-09-19';
for (const variant of ['comfortable', 'tight'] as const) {
  describe(`every tab tells the same story (${variant})`, () => {
    const s = sampleData(today, 11, variant);
    const d = buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: null, source: 'sample' });
    const st = d.status;
    const sumOf = (kind: string) => st.envelopes.filter((e) => e.kind === kind).reduce((t, e) => t + e.actual, 0);

    it('each transaction is counted exactly once, in exactly one envelope', () => {
      const ids = st.envelopes.flatMap((e) => e.items.map((i) => i.transactionId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(d.transactions.length);
      expect(new Set(d.transactions.map((t) => t.transactionId)).size).toBe(d.transactions.length);
    });

    it('home, fixed, variable and trends agree on the month', () => {
      expect(st.income.received).toBeCloseTo(sumOf('income'));
      expect(st.fixed.paid).toBeCloseTo(sumOf('fixed'));
      expect(st.flexible.spent).toBeCloseTo(sumOf('tracked') + sumOf('everyday'));
      const row = d.months.find((m) => m.month === st.month)!;
      expect(row.income).toBeCloseTo(st.income.received);
      expect(row.fixed).toBeCloseTo(st.fixed.paid);
      expect(row.variable).toBeCloseTo(st.flexible.spent);
      const listed = d.transactions.filter((t) => !t.isIncome).reduce((t, x) => t + x.amount, 0);
      expect(listed).toBeCloseTo(st.fixed.paid + st.flexible.spent);
    });

    it('"what is really free" is the same money as "left to spend", cut differently', () => {
      expect(d.free.restSpent).toBeCloseTo(sumOf('everyday'));
      expect(d.free.income - d.free.fixed - d.free.goals).toBeCloseTo(st.flexible.planned);
      expect(d.brief.perDayLeft).toBeCloseTo(d.free.restLeftPerDay);
    });

    it('next month, the what-if planner and the path to balance start from the same figures', () => {
      const runningFixed = d.installments.filter((p) => p.fixed).reduce((t, p) => t + p.monthly, 0);
      const runningVariable = d.installments.filter((p) => !p.fixed).reduce((t, p) => t + p.monthly, 0);
      expect(d.nextMonth.income.total).toBeCloseTo(d.baseline.income);
      expect(d.nextMonth.fixed.total).toBeCloseTo(d.baseline.fixed + runningFixed);
      const t = strategy(d.months, d.baseline, {}, d.history).trend;
      expect(t.incomeNow).toBeCloseTo(d.nextMonth.income.total);
      expect(d.nextMonth.variable.total).toBeCloseTo(d.baseline.variable + runningVariable);
      expect(t.expensesNow).toBeCloseTo(d.nextMonth.fixed.total + d.nextMonth.variable.total);
      expect(d.nextMonth.net).toBeCloseTo(-t.gapNow + d.nextMonth.planned.reduce((x, l) => x + l.amount, 0));
      // what is set aside as ending or doubtful is not also counted
      const shown = d.nextMonth.fixed.lines.reduce((x, l) => x + l.amount, 0);
      expect(shown).toBeCloseTo(d.nextMonth.fixed.total);
    });

    it('no installment plan appears twice', () => {
      const seen = d.installments.map((p) => `${p.businessName}|${p.total}|${p.lastMonth}|${Math.round(p.monthly)}`);
      expect(new Set(seen).size).toBe(seen.length);
    });
  });
}

describe('one loan is one loan', () => {
  const tx = (m: string, n: number, amount: number, name = 'הלוואה מחוץ למסגרת', total = 48): StoredTransaction => ({ transactionId: `${name}-${m}-${amount}`, transactionDate: `${m}-15T00:00:00Z`, cashflowDate: m, businessName: name, isIncome: false, amount, isInstallment: true, installmentNumber: n, totalNumberOfInstallments: total, accountNumberHash: 'a1', envelopeType: 'fixed' });

  it('a payment that drifts by a few shekels does not split it', () => {
    const plans = installmentPlans([tx('2026-06', 1, 1209), tx('2026-07', 2, 1203), tx('2026-08', 3, 1203), tx('2026-09', 4, 1198)], '2026-09');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ monthly: 1198, paid: 4, total: 48, remainingPayments: 44, lastMonth: '2030-05' });
    expect(plans[0]!.remainingAmount).toBeCloseTo(44 * 1198);
  });

  it('a first payment rounded differently is still the same plan', () => {
    expect(installmentPlans([tx('2026-03', 1, 647, 'ISTORE', 10), tx('2026-08', 6, 650, 'ISTORE', 10), tx('2026-09', 7, 650, 'ISTORE', 10)], '2026-09')).toHaveLength(1);
  });

  it('two purchases at one shop in the same month stay two plans, and a renewed plan is a new one', () => {
    expect(installmentPlans([tx('2026-08', 1, 300, 'חנות', 6), tx('2026-08', 1, 120, 'חנות', 6), tx('2026-09', 2, 300, 'חנות', 6), tx('2026-09', 2, 120, 'חנות', 6)], '2026-09')).toHaveLength(2);
    const renewed = installmentPlans([tx('2026-07', 11, 290, 'מועדון', 11), tx('2026-08', 1, 325, 'מועדון', 10), tx('2026-09', 2, 325, 'מועדון', 10)], '2026-09');
    expect(renewed).toHaveLength(1); // the old one is fully paid
    expect(renewed[0]).toMatchObject({ monthly: 325, paid: 2, total: 10 });
  });

  it('a merchant is the same merchant whatever reference it prints', () => {
    expect(businessKey('PAYPAL *SPOTIFY*P4638D')).toBe(businessKey('PAYPAL *SPOTIFY*P45168'));
    expect(businessKey('CANVA* I04938-28433875    ')).toBe(businessKey('CANVA* I04969-34037698'));
    expect(businessKey('שופרסל דיל')).not.toBe(businessKey('רמי לוי'));
    expect(businessDisplayName('CANVA* I04938-28433875    ')).toBe('CANVA*');
    expect(businessDisplayName('מפעל מים כפר סבא')).toBe('מפעל מים כפר סבא');
  });
});
