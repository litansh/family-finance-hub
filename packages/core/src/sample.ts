import { annotateWithBudget, type StoredTransaction } from './overlay.ts';
import type { RiseupActual, RiseupBudget, RiseupEnvelope, RiseupTransaction } from './riseup.ts';

// Deterministic household data in RiseUp's wire shape, so the UI and analytics
// can be built and tested before a real token exists. Nothing here is real.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARD_A = { accountNickname: 'Alex · Max', accountNumberHash: 'a1f3c9', sourceType: 'creditCard', source: 'max' };
const CARD_B = { accountNickname: 'Noa · Cal', accountNumberHash: 'b7d2e4', sourceType: 'creditCard', source: 'cal' };
const BANK = { accountNickname: 'Joint account', accountNumberHash: 'c0a8b1', sourceType: 'checkingAccount', source: 'leumi' };

interface Fixed { name: string; cat: string; amount: number; day: number; acct: typeof BANK; from?: string; raise?: [string, number] }

// Two demo households share every expense. One lives within its means; the
// other lost a salary and spends more than it earns, which is what the path to
// balance, the purchase check and the brief are for.
export type SampleVariant = 'comfortable' | 'tight';
const INCOMES: Record<SampleVariant, { name: string; amount: number; day: number }[]> = {
  comfortable: [
    { name: 'משכורת · Alex', amount: 27400, day: 9 },
    { name: 'משכורת · Noa', amount: 18900, day: 10 },
    { name: 'קצבת ילדים', amount: 336, day: 20 },
  ],
  tight: [
    { name: 'משכורת · Alex', amount: 24800, day: 9 },
    { name: 'קצבת ילדים', amount: 336, day: 20 },
  ],
};
let INCOME = INCOMES.comfortable;

const FIXED: Fixed[] = [
  { name: 'משכנתא · בנק לאומי', cat: 'משכנתא', amount: 7850, day: 10, acct: BANK },
  { name: 'גן ילדים', cat: 'חינוך', amount: 3900, day: 5, acct: BANK },
  { name: 'ארנונה', cat: 'דיור', amount: 980, day: 15, acct: BANK },
  { name: 'ועד בית', cat: 'דיור', amount: 420, day: 1, acct: BANK },
  { name: 'חברת החשמל', cat: 'חשבונות', amount: 640, day: 18, acct: BANK },
  { name: 'ביטוח רכב · הראל', cat: 'ביטוח', amount: 410, day: 12, acct: CARD_A },
  { name: 'ביטוח בריאות · מכבי', cat: 'ביטוח', amount: 385, day: 12, acct: BANK },
  { name: 'סלקום', cat: 'תקשורת', amount: 139, day: 8, acct: CARD_A },
  { name: 'HOT אינטרנט', cat: 'תקשורת', amount: 119, day: 8, acct: CARD_A, raise: ['2026-08', 149] },
  { name: 'Netflix', cat: 'מנויים', amount: 69.9, day: 14, acct: CARD_B },
  { name: 'Spotify', cat: 'מנויים', amount: 33.9, day: 3, acct: CARD_A },
  { name: 'iCloud+', cat: 'מנויים', amount: 39.9, day: 22, acct: CARD_A },
  { name: 'חוג שחייה', cat: 'חינוך', amount: 360, day: 2, acct: CARD_B },
  { name: 'Disney+', cat: 'מנויים', amount: 49.9, day: 16, acct: CARD_B, from: '2026-09' },
  { name: 'החזר הלוואה · בנק לאומי', cat: 'הלוואות', amount: 1450, day: 10, acct: BANK },
  { name: 'החזר הלוואה · מימון ישיר', cat: 'הלוואות', amount: 890, day: 15, acct: BANK },
  { name: 'ביטוח חיים · מגדל', cat: 'ביטוח', amount: 212, day: 12, acct: BANK },
  { name: 'ביטוח דירה · כלל', cat: 'ביטוח', amount: 96, day: 12, acct: CARD_A },
  { name: 'עמלות ודמי ניהול חשבון', cat: 'עמלות', amount: 38, day: 1, acct: BANK },
];

interface Tracked { cat: string; goal: number; perMonth: [number, number]; ticket: [number, number]; shops: string[] }

const TRACKED: Tracked[] = [
  { cat: 'סופר', goal: 4200, perMonth: [11, 15], ticket: [120, 520], shops: ['שופרסל דיל', 'רמי לוי', 'ויקטורי', 'AM:PM'] },
  { cat: 'מסעדות', goal: 1400, perMonth: [6, 11], ticket: [60, 320], shops: ['וולט', 'קפה גרג', 'ארומה', 'מסעדת הדייגים', 'ג׳פניקה'] },
  { cat: 'רכב ותחבורה', goal: 1300, perMonth: [4, 7], ticket: [90, 420], shops: ['פז', 'דלק', 'פנגו', 'רב-קו'] },
  { cat: 'ילדים', goal: 900, perMonth: [2, 5], ticket: [80, 380], shops: ['שילב', 'טויס אר אס', 'H&M Kids'] },
];

const OTHER = { planned: 5200, perMonth: [8, 14] as [number, number], ticket: [40, 600] as [number, number],
  shops: ['סופר-פארם', 'Amazon', 'AliExpress', 'IKEA', 'KSP', 'זארה', 'בית מרקחת', 'סינמה סיטי'] };

const pad = (n: number) => String(n).padStart(2, '0');
const dim = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function monthTransactions(month: string, upToDay: number): RiseupTransaction[] {
  const r = rng(Number(month.replace('-', '')));
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  const days = dim(month);
  const out: RiseupTransaction[] = [];
  let n = 0;

  const push = (t: Omit<RiseupTransaction, 'transactionId' | 'cashflowDate' | 'transactionDate'> & { day: number }) => {
    const { day, ...rest } = t;
    if (day > upToDay) return;
    out.push({
      transactionId: `${month}-${pad(++n)}`,
      cashflowDate: month,
      transactionDate: `${month}-${pad(Math.min(day, days))}T00:00:00.000Z`,
      ...rest,
    });
  };

  for (const inc of INCOME) {
    push({ day: inc.day, businessName: inc.name, isIncome: true, amount: inc.amount, actualType: 'fixed',
      commitmentId: `inc-${inc.name}`, categoryLabel: 'הכנסה', categoryType: 'default', ...BANK });
  }
  for (const f of FIXED) {
    if (f.from && month < f.from) continue;
    const amount = f.raise && month >= f.raise[0] ? f.raise[1] : f.name === 'חברת החשמל' ? Math.round(f.amount * between(0.8, 1.35)) : f.amount;
    push({ day: f.day, businessName: f.name, isIncome: false, amount, actualType: 'fixed',
      commitmentId: `fix-${f.name}`, categoryLabel: f.cat, categoryType: 'default', ...f.acct });
  }
  // Summer pushes discretionary spend up, which gives the trend charts a shape.
  const season = ['07', '08'].includes(month.slice(5)) ? 1.18 : 1;
  for (const t of TRACKED) {
    for (let k = int(...t.perMonth); k > 0; k--) {
      push({ day: int(1, days), businessName: t.shops[int(0, t.shops.length - 1)]!, isIncome: false,
        amount: Math.round(between(...t.ticket) * season * 10) / 10, actualType: 'variable', commitmentId: null,
        categoryLabel: t.cat, categoryType: 'default', ...(r() < 0.55 ? CARD_A : CARD_B) });
    }
  }
  for (let k = int(...OTHER.perMonth); k > 0; k--) {
    push({ day: int(1, days), businessName: OTHER.shops[int(0, OTHER.shops.length - 1)]!, isIncome: false,
      amount: Math.round(between(...OTHER.ticket) * season * 10) / 10, actualType: 'variable', commitmentId: null,
      categoryLabel: 'אחר', categoryType: 'other', ...(r() < 0.5 ? CARD_A : CARD_B) });
  }

  // Card installments that run across months.
  const plans = [
    { name: 'מחסני חשמל', amount: 412, total: 12, start: '2026-04', acct: CARD_A, cat: 'אחר' },
    { name: 'איקאה · מטבח', amount: 1150, total: 10, start: '2026-06', acct: CARD_B, cat: 'אחר' },
    { name: 'iDigital', amount: 389, total: 18, start: '2025-12', acct: CARD_A, cat: 'אחר' },
  ];
  for (const p of plans) {
    const n = (Number(month.slice(0, 4)) - Number(p.start.slice(0, 4))) * 12 + Number(month.slice(5)) - Number(p.start.slice(5)) + 1;
    if (n < 1 || n > p.total) continue;
    push({ day: 10, businessName: p.name, isIncome: false, amount: p.amount, actualType: 'variable', commitmentId: null,
      categoryLabel: p.cat, categoryType: 'other', isInstallment: true, installmentNumber: n, totalNumberOfInstallments: p.total, ...p.acct });
  }

  // Seeded incidents so every alert type has something to show.
  if (month === '2026-09') {
    push({ day: 11, businessName: 'וולט', isIncome: false, amount: 186, actualType: 'variable', commitmentId: null, categoryLabel: 'מסעדות', categoryType: 'default', ...CARD_B });
    push({ day: 12, businessName: 'וולט', isIncome: false, amount: 186, actualType: 'variable', commitmentId: null, categoryLabel: 'מסעדות', categoryType: 'default', ...CARD_B });
    push({ day: 7, businessName: 'IKEA', isIncome: false, amount: 3480, actualType: 'variable', commitmentId: null, categoryLabel: 'אחר', categoryType: 'other', ...CARD_A });
    push({ day: 14, businessName: 'מוסך השרון', isIncome: false, amount: 1240, actualType: 'variable', commitmentId: null, categoryLabel: 'רכב ותחבורה', categoryType: 'default', ...CARD_A });
  }
  return out;
}

function toActual(t: RiseupTransaction): RiseupActual {
  return {
    transactionId: t.transactionId,
    transactionDate: t.transactionDate.slice(0, 10),
    businessName: t.businessName,
    isIncome: t.isIncome,
    billingAmount: t.isIncome ? null : t.amount,
    incomeAmount: t.isIncome ? t.amount : null,
    originalAmount: t.amount,
    accountNickname: t.accountNickname,
    accountNumberHash: t.accountNumberHash,
    expense: t.categoryLabel,
    sourceType: t.sourceType,
    source: t.source,
    monthsInterval: t.actualType === 'fixed' ? 1 : undefined,
  };
}

// What RiseUp returns in the transaction feed but keeps out of the cashflow:
// the card bill as the bank sees it, and a transfer between our own accounts.
function excludedFor(month: string, upToDay: number): RiseupTransaction[] {
  const mk = (n: number, day: number, businessName: string, amount: number, isIncome: boolean): RiseupTransaction => ({
    transactionId: `${month}-x${n}`, cashflowDate: month, transactionDate: `${month}-${pad(day)}T00:00:00.000Z`, businessName, isIncome, amount, actualType: 'variable', commitmentId: null, ...BANK,
  });
  return [mk(1, 2, 'חיוב כרטיס אשראי · מקס', 14200, false), mk(2, 2, 'חיוב כרטיס אשראי · כאל', 9800, false), mk(3, 4, 'העברה לחיסכון', 5000, false), mk(4, 4, 'העברה מחשבון אחר', 5000, true)]
    .filter((t) => Number(t.transactionDate.slice(8, 10)) <= upToDay);
}

// Built in the shape real accounts return, which is not the documented one:
// fixed envelopes are one per commitment with expenses POSITIVE and incomes
// negative and no name of their own; tracked categories keep the plan in
// originalAmount (balancedAmount 0) and groceries are split by week; the
// everyday envelope has no amounts at all.
function budgetFor(month: string, txns: RiseupTransaction[], excluded: RiseupTransaction[]): RiseupBudget {
  const envelopes: RiseupEnvelope[] = [];
  const mine = (f: (t: RiseupTransaction) => boolean) => txns.filter(f).map(toActual);
  const fixedEnv = (seq: string, planned: number, isIncome: boolean, actuals: RiseupActual[]): RiseupEnvelope =>
    ({ id: `${month}#fixed#${seq}`, type: 'fixed', balancedAmount: isIncome ? -planned : planned, originalAmount: isIncome ? -planned : planned, balanceDate: `${month}-28`, actuals });

  INCOME.forEach((inc, n) => envelopes.push(fixedEnv(`inc-${n}`, inc.amount, true, mine((t) => t.commitmentId === `inc-${inc.name}`))));
  FIXED.forEach((f, n) => {
    if (f.from && month < f.from) return;
    envelopes.push(fixedEnv(`fix-${n}`, f.raise && month >= f.raise[0] ? f.raise[1] : f.amount, false, mine((t) => t.commitmentId === `fix-${f.name}`)));
  });

  TRACKED.forEach((t, n) => {
    const acts = mine((x) => !x.isIncome && x.actualType === 'variable' && x.categoryLabel === t.cat);
    if (n === 0) {
      // Weekly, as RiseUp does for groceries.
      for (let w = 0; w < 4; w++) {
        const lo = w * 7 + 1, hi = w === 3 ? 31 : (w + 1) * 7;
        envelopes.push({ id: `${month}#trackingCategory#cat-${n}#${w}`, type: 'trackingCategory', balancedAmount: 0, originalAmount: t.goal / 4, balanceDate: `${month}-${pad(Math.min(hi, 28))}`, isCustomPrediction: false,
          actuals: acts.filter((a) => { const d = Number(a.transactionDate.slice(8, 10)); return d >= lo && d <= hi; }) });
      }
    } else {
      envelopes.push({ id: `${month}#trackingCategory#cat-${n}`, type: 'trackingCategory', balancedAmount: 0, originalAmount: t.goal, isCustomPrediction: true, actuals: acts });
    }
  });
  envelopes.push({ id: `${month}#variable`, type: 'variable', balancedAmount: null, originalAmount: null, actuals: mine((x) => !x.isIncome && x.actualType === 'variable' && x.categoryLabel === 'אחר') });
  envelopes.push({ id: `${month}#variableIncome`, type: 'variableIncome', balancedAmount: null, originalAmount: null, actuals: [] });
  envelopes.push({ id: `${month}#riseupGoal`, type: 'riseupGoal', balancedAmount: 0, originalAmount: 0, actuals: [] });

  return { budgetDate: month, lastUpdatedAt: new Date().toISOString(), envelopes, excluded: excluded.map(toActual) };
}

export function sampleData(today: string, monthsBack = 11, variant: SampleVariant = 'comfortable') {
  INCOME = INCOMES[variant];
  const current = today.slice(0, 7);
  const transactions: StoredTransaction[] = [];
  const budgets = new Map<string, RiseupBudget>();
  for (let i = monthsBack; i >= 0; i--) {
    const month = addMonths(current, -i);
    const upToDay = i === 0 ? Number(today.slice(8, 10)) : 31;
    const counted = monthTransactions(month, upToDay);
    const excluded = excludedFor(month, upToDay);
    const budget = budgetFor(month, counted, excluded);
    budgets.set(month, budget);
    transactions.push(...annotateWithBudget([...counted, ...excluded], budget));
  }
  return { transactions, budgets, current };
}
