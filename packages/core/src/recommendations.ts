import { businessKey, ils, iso, type Recurring } from './insights.ts';
import type { MonthStatus } from './month.ts';
import type { InstallmentPlan } from './overlay.ts';
import { counts, type StoredTransaction } from './overlay.ts';
import type { MonthTotals } from './trends.ts';

// Rule-based and explainable on purpose: every recommendation states the
// numbers it came from, so it can be checked rather than trusted.

export type RecoTopic = 'price' | 'loans' | 'insurance' | 'subscriptions' | 'telecom' | 'fees' | 'installments' | 'budget' | 'savings';

export interface Recommendation {
  id: string; // stable across months so a status set by the family sticks
  topic: RecoTopic;
  priority: 1 | 2 | 3; // 1 = worth doing this week
  title: string;
  why: string; // the evidence
  steps: string[]; // what to actually do
  yearlySaving?: number; // estimate; undefined when it cannot be estimated honestly
  evidence?: { label: string; amount: number }[];
}

const has = (t: { businessName: string; categoryLabel?: string }, words: string[]) =>
  words.some((w) => t.businessName.includes(w) || (t.categoryLabel ?? '').includes(w));
const recHas = (r: Recurring, words: string[]) => words.some((w) => r.businessName.includes(w) || (r.category ?? '').includes(w));

const LOAN = ['הלוואה', 'הלוואות', 'הלואה', 'החזר הלוו'];
const MORTGAGE = ['משכנתא', 'משכנתה'];
const INSURANCE = ['ביטוח'];
const TELECOM = ['סלקום', 'פרטנר', 'פלאפון', 'הוט', 'HOT', 'בזק', 'גולן', 'רמי לוי תקשורת', '019', '012', 'yes', 'YES', 'אינטרנט', 'סלולר', 'תקשורת'];
const STREAMING = ['Netflix', 'נטפליקס', 'Disney', 'דיסני', 'Spotify', 'ספוטיפיי', 'Apple', 'YouTube', 'יוטיוב', 'Amazon Prime', 'HBO', 'סלקום TV', 'פרטנר TV', 'STING', 'yes+', 'מנויים'];
const FEES = ['עמלה', 'עמלות', 'דמי ניהול', 'דמי כרטיס'];
const INTEREST = ['ריבית', 'חובה', 'משיכת יתר'];

export interface RecoInputs {
  status: MonthStatus;
  recurring: Recurring[];
  installments: InstallmentPlan[];
  months: MonthTotals[]; // closed and current
  history: StoredTransaction[]; // all months up to and including the viewed one
}

export function buildRecommendations(i: RecoInputs): Recommendation[] {
  const out: Recommendation[] = [];
  const month = i.status.month;
  const active = i.recurring.filter((r) => !r.stopped);
  const income = i.status.income.expected;

  // 1. A recurring charge that crept up.
  for (const r of active) {
    const delta = r.lastAmount - r.typicalAmount;
    if (!r.steady || r.monthsSeen < 3 || r.changePct < 0.08 || delta < 5 || recHas(r, MORTGAGE) || recHas(r, LOAN)) continue;
    out.push({
      id: `price:${r.key}`,
      topic: 'price',
      priority: delta * 12 >= 300 ? 1 : 2,
      title: `התשלום ל${iso(r.businessName)} עלה — כדאי להתקשר ולברר`,
      why: `במשך חודשים שילמתם בערך ${ils(r.typicalAmount)} בחודש, ובחיוב האחרון ${ils(r.lastAmount)}. זו עלייה של ${Math.round(r.changePct * 100)}%, כלומר ${ils(delta * 12)} יותר בשנה אם לא עושים כלום.`,
      steps: [
        `להתקשר ל${iso(r.businessName)} ולשאול מה השתנה בחיוב ומתי.`,
        'אם הסתיים מבצע או הטבה — לבקש לחדש אותה, או לבקש לדבר עם מחלקת שימור לקוחות.',
        'לבדוק הצעה מתחרה לפני השיחה. הצעה קונקרטית ביד היא מה שבדרך כלל מחזיר את המחיר הקודם.',
        'אם אין הסבר מניח את הדעת — לשקול מעבר או ביטול.',
      ],
      yearlySaving: delta * 12,
      evidence: [{ label: 'מחיר קודם (חודשי)', amount: r.typicalAmount }, { label: 'מחיר נוכחי (חודשי)', amount: r.lastAmount }],
    });
  }

  // 2. Several loans running in parallel. A loan shows up either as a fixed
  // monthly repayment or, when taken through a card, as an installment plan.
  const loanPlans = i.installments.filter((p) => LOAN.some((w) => p.businessName.includes(w)));
  const loanRows = [
    ...active.filter((r) => recHas(r, LOAN) && !recHas(r, MORTGAGE) && !loanPlans.some((p) => businessKey(p.businessName) === businessKey(r.businessName))).map((r) => ({ label: r.businessName, amount: r.lastAmount, left: undefined as number | undefined })),
    ...loanPlans.map((p) => ({ label: `${p.businessName} (תשלום ${p.paid} מתוך ${p.total})`, amount: p.monthly, left: p.remainingAmount })),
  ];
  if (loanRows.length >= 2) {
    const monthly = loanRows.reduce((s, r) => s + r.amount, 0);
    const left = loanRows.reduce((s, r) => s + (r.left ?? 0), 0);
    out.push({
      id: 'loans:consolidate',
      topic: 'loans',
      priority: 1,
      title: `יש לכם ${loanRows.length} הלוואות במקביל — כדאי לבדוק איחוד להלוואה אחת`,
      why: `אתם מחזירים יחד ${ils(monthly)} בחודש על ${loanRows.length} הלוואות נפרדות${left > 0 ? `, ונותרו לפחות ${ils(left)} לתשלום` : ''}. לכל הלוואה ריבית משלה, ולעיתים קרובות אחת מהן יקרה משמעותית מהאחרות. איחוד להלוואה אחת בריבית נמוכה יותר יכול להקטין את ההחזר החודשי או את סך הריבית.`,
      steps: [
        'לרכז לכל הלוואה: יתרה לסילוק, ריבית שנתית, מספר תשלומים שנותרו, ועמלת פירעון מוקדם. הבנק או חברת האשראי חייבים לתת את הנתונים האלה.',
        'לבקש מהבנק שלכם, ומבנק נוסף אחד לפחות, הצעה להלוואה אחת שתחליף את כולן.',
        'להשוות את סך הריבית שתשלמו עד הסוף, ולא רק את ההחזר החודשי. החזר נמוך יותר על פני תקופה ארוכה יותר יכול לעלות יותר.',
        'לאחד רק אם הריבית החדשה נמוכה מהריבית של ההלוואות היקרות, גם אחרי עמלות הפירעון.',
      ],
      evidence: loanRows.map((r) => ({ label: r.label, amount: r.amount })),
    });
  }

  // 3. Overdraft and interest charges.
  const interest = i.history.filter((t) => counts(t) && !t.isIncome && t.cashflowDate > addM(month, -3) && has(t, INTEREST) && !has(t, MORTGAGE) && !has(t, LOAN));
  const interestSum = interest.reduce((s, t) => s + t.amount, 0);
  if (interestSum >= 30) {
    out.push({
      id: 'fees:overdraft-interest',
      topic: 'fees',
      priority: 1,
      title: 'אתם משלמים ריבית על מינוס — זה הכסף היקר ביותר שלכם',
      why: `בשלושת החודשים האחרונים חויבתם ${ils(interestSum)} בריבית. ריבית על משיכת יתר (מינוס) היא בדרך כלל הגבוהה ביותר שהבנק גובה.`,
      steps: [
        'לבדוק בבנק מה הריבית על המינוס ומה גובה המסגרת.',
        'אם המינוס קבוע — לשקול להמיר אותו להלוואה מסודרת בריבית נמוכה יותר, ולסגור את המסגרת בהדרגה.',
        'לתזמן חיובים קבועים לימים שאחרי כניסת המשכורת.',
      ],
      yearlySaving: interestSum * 4,
    });
  }

  // 4. Bank and card fees.
  const fees = i.history.filter((t) => counts(t) && !t.isIncome && t.cashflowDate > addM(month, -3) && has(t, FEES));
  const feeSum = fees.reduce((s, t) => s + t.amount, 0);
  if (feeSum >= 45) {
    out.push({
      id: 'fees:bank',
      topic: 'fees',
      priority: 2,
      title: 'עמלות בנק וכרטיסי אשראי — כמעט תמיד אפשר להוריד',
      why: `בשלושת החודשים האחרונים שילמתם ${ils(feeSum)} בעמלות ודמי ניהול, כלומר בערך ${ils(feeSum * 4)} בשנה.`,
      steps: [
        'לבקש מהבנק לעבור ל"מסלול עמלות בסיסי" — בנק ישראל מחייב את הבנקים להציע אותו.',
        'לבקש פטור מדמי כרטיס. רוב חברות האשראי נותנות פטור ללקוח שמבקש, במיוחד אם מזכירים מעבר לכרטיס אחר.',
        'אם יש כרטיסים שאתם כמעט לא משתמשים בהם — לבטל אותם.',
      ],
      yearlySaving: feeSum * 4 * 0.6,
      evidence: topBusinesses(fees),
    });
  }

  // 5. Insurance overlap.
  const insurance = active.filter((r) => recHas(r, INSURANCE));
  if (insurance.length >= 3) {
    const monthly = insurance.reduce((s, r) => s + r.lastAmount, 0);
    out.push({
      id: 'insurance:overlap',
      topic: 'insurance',
      priority: 2,
      title: `${insurance.length} תשלומי ביטוח שונים — כדאי לבדוק שאין כפל ביטוח`,
      why: `אתם משלמים ${ils(monthly)} בחודש (${ils(monthly * 12)} בשנה) ל־${insurance.length} גופים שונים. כפל ביטוח — תשלום פעמיים על אותו כיסוי — נפוץ מאוד, בעיקר בביטוחי בריאות ותאונות אישיות.`,
      steps: [
        'להיכנס לאתר "הר הביטוח" של משרד האוצר (חינם, עם הזדהות ממשלתית) — הוא מציג את כל הפוליסות הרשומות על שמכם.',
        'לחפש כיסויים חופפים: למשל ביטוח בריאות פרטי לצד שב"ן של קופת החולים, או שני ביטוחי תאונות אישיות.',
        'לבטל כיסוי כפול, ולבקש מהמבטח הנחת נאמנות על מה שנשאר.',
      ],
      evidence: insurance.map((r) => ({ label: r.businessName, amount: r.lastAmount })),
    });
  }

  // 6. Stacked subscriptions.
  const subs = active.filter((r) => recHas(r, STREAMING) && r.lastAmount < 200);
  if (subs.length >= 3) {
    const monthly = subs.reduce((s, r) => s + r.lastAmount, 0);
    const cheapest = [...subs].sort((a, b) => a.lastAmount - b.lastAmount)[0]!;
    out.push({
      id: 'subscriptions:stack',
      topic: 'subscriptions',
      priority: 3,
      title: `${subs.length} מנויים דיגיטליים פעילים — ${ils(monthly * 12)} בשנה`,
      why: `כל מנוי נראה קטן, אבל יחד הם ${ils(monthly)} בחודש. מנויים הם ההוצאה שהכי קל לשכוח שקיימת.`,
      steps: [
        'לעבור על הרשימה ולשאול על כל מנוי: השתמשנו בו בחודש האחרון?',
        'מנויי סטרימינג אפשר להפעיל לסירוגין — חודש כזה, חודש אחר — במקום להחזיק את כולם במקביל.',
        'לבדוק אם יש מסלול משפחתי שמחליף שני מנויים נפרדים.',
      ],
      yearlySaving: cheapest.lastAmount * 12,
      evidence: subs.map((r) => ({ label: r.businessName, amount: r.lastAmount })),
    });
  }

  // 7. Telecom worth a comparison.
  const telecom = active.filter((r) => recHas(r, TELECOM) && !recHas(r, STREAMING));
  const telecomMonthly = telecom.reduce((s, r) => s + r.lastAmount, 0);
  if (telecom.length > 0 && telecomMonthly >= 250) {
    out.push({
      id: 'telecom:compare',
      topic: 'telecom',
      priority: 3,
      title: 'תקשורת (סלולר, אינטרנט, טלוויזיה) — שווה השוואת מחירים',
      why: `אתם משלמים ${ils(telecomMonthly)} בחודש על תקשורת. בתחום הזה המחירים ללקוחות חדשים נמוכים בהרבה מהמחירים ללקוחות ותיקים, ולכן מי שלא מתקשר פעם בשנה כמעט תמיד משלם יותר מדי.`,
      steps: [
        'לבדוק מה מקבל היום לקוח חדש אצל הספק שלכם ואצל מתחרה אחד.',
        'להתקשר, לבקש "שימור לקוחות", ולבקש את מחיר הלקוח החדש.',
        'לרשום ביומן תזכורת לעוד שנה — המבצע יפוג שוב.',
      ],
      yearlySaving: telecomMonthly * 12 * 0.2,
      evidence: telecom.map((r) => ({ label: r.businessName, amount: r.lastAmount })),
    });
  }

  // 8. Installments eating future income.
  const purchases = i.installments.filter((p) => !loanPlans.includes(p));
  const instMonthly = purchases.reduce((s, p) => s + p.monthly, 0);
  const instRemaining = purchases.reduce((s, p) => s + p.remainingAmount, 0);
  if (income > 0 && instMonthly / income >= 0.1) {
    out.push({
      id: 'installments:load',
      topic: 'installments',
      priority: 2,
      title: `${Math.round((instMonthly / income) * 100)}% מההכנסה כבר "תפוסה" בתשלומים`,
      why: `יש לכם ${purchases.length} עסקאות תשלומים פתוחות (לא כולל הלוואות): ${ils(instMonthly)} בכל חודש, ועוד ${ils(instRemaining)} שנותר לשלם בסך הכול. זה כסף שכבר הוצא, ולכן הוא מקטין את מה שפנוי בחודשים הבאים.`,
      steps: [
        'עד שהעומס יורד — להימנע מעסקאות תשלומים חדשות.',
        'בעסקה גדולה הבאה לבדוק מה המחיר במזומן. "תשלומים ללא ריבית" מגולמים לעיתים במחיר.',
        'ברשימת התשלומים אפשר לראות מתי כל עסקה מסתיימת ומתי מתפנה כסף.',
      ],
      evidence: purchases.slice(0, 6).map((p) => ({ label: `${p.businessName} (${p.paid}/${p.total})`, amount: p.monthly })),
    });
  }

  // 9. A category that overruns month after month: the budget is wrong, or the habit is.
  const closed = i.months.filter((m) => m.month < month).slice(-3).map((m) => m.month);
  if (closed.length === 3) {
    for (const e of i.status.envelopes) {
      if (e.kind !== 'tracked' || e.planned <= 0) continue;
      const spent = closed.map((m) => i.history.filter((t) => counts(t) && !t.isIncome && t.cashflowDate === m && t.categoryLabel === e.label).reduce((s, t) => s + t.amount, 0));
      if (spent.every((v) => v > e.planned * 1.1)) {
        const avg = spent.reduce((s, v) => s + v, 0) / 3;
        out.push({
          id: `budget:${e.label}`,
          topic: 'budget',
          priority: 2,
          title: `${iso(e.label)}: חריגה שלושה חודשים ברצף`,
          why: `התקציב הוא ${ils(e.planned)}, ובשלושת החודשים האחרונים הוצאתם בממוצע ${ils(avg)}. כשחורגים כל חודש, התקציב כבר לא משקף את המציאות ולא עוזר לקבל החלטות.`,
          steps: [
            `להחליט יחד: האם ${ils(avg)} הוא הסכום הנכון לכם? אם כן — לעדכן את התקציב ברייזאפ, ולהוריד את ההפרש מקטגוריה אחרת.`,
            'אם לא — לבחור שינוי אחד קונקרטי (למשל קנייה מרוכזת פעם בשבוע) ולבדוק שוב בעוד חודש.',
          ],
          yearlySaving: undefined,
        });
      }
    }
  }

  // 10. Savings rate.
  const last6 = i.months.filter((m) => m.month < month).slice(-6);
  if (last6.length >= 3) {
    const inc = last6.reduce((s, m) => s + m.income, 0);
    const net = last6.reduce((s, m) => s + m.net, 0);
    const rate = inc > 0 ? net / inc : 0;
    const negative = last6.filter((m) => m.net < 0).length;
    if (rate < 0.1) {
      out.push({
        id: 'savings:rate',
        topic: 'savings',
        priority: negative >= 2 ? 1 : 2,
        title: rate < 0 ? 'בחצי השנה האחרונה הוצאתם יותר ממה שהכנסתם' : `שיעור החיסכון שלכם ${Math.round(rate * 100)}% — מתחת למומלץ`,
        why: `ב־${last6.length} החודשים האחרונים נכנסו ${ils(inc)} ונשארו ${ils(net)}.${negative ? ` ${negative} מהחודשים הסתיימו במינוס.` : ''} כלל אצבע מקובל הוא לשמור לפחות 10%–20% מההכנסה.`,
        steps: [
          'להתחיל מההמלצות האחרות בעמוד — הן מסודרות לפי כמה כסף הן מחזירות.',
          'להגדיר הוראת קבע לחיסכון ביום כניסת המשכורת, כדי שהחיסכון יקרה לפני ההוצאות ולא ממה שנשאר.',
        ],
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority || (b.yearlySaving ?? 0) - (a.yearlySaving ?? 0));
}

function addM(month: string, n: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function topBusinesses(txns: StoredTransaction[]) {
  const by = new Map<string, { label: string; amount: number }>();
  for (const t of txns) {
    const k = businessKey(t.businessName);
    const row = by.get(k) ?? { label: t.businessName, amount: 0 };
    row.amount += t.amount;
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
}
