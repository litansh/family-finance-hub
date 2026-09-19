import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { buildDashboard, sampleData, type Dashboard } from '@hub/core';
import { z } from 'zod';
import { checkPurchase, nextMonthView, overview, recommendations, runForecast, searchTransactions } from './assistant-tools.ts';
import { loadDashboard } from './api.ts';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { keys, S3Store, type Store } from './store.ts';
import { BadRequest, saveShift } from './userdata.ts';

export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface AskJob { id: string; email: string; question: string; history: ChatTurn[]; month?: string; status: 'pending' | 'done' | 'error'; answer?: string; error?: string; askedAt: string; answeredAt?: string }

// Frozen, so it caches. Today's date and the data arrive in the conversation.
const SYSTEM = `אתה העוזר הפיננסי של המשפחה בתוך "הכספים שלנו", מרכז הכספים המשפחתי שלהם. הנתונים מגיעים מרייזאפ, שמחובר לחשבון הבנק ולכרטיסי האשראי שלהם.

מי מולך: שני אנשים שרוצים להיות בשליטה על הכסף שלהם, ולא בהכרח מכירים מונחים פיננסיים. ענה בעברית פשוטה וחמה, בגובה העיניים. כשאתה משתמש במונח מקצועי (תזרים, ריבית אפקטיבית, לוח שפיצר, פירעון מוקדם), הסבר אותו במשפט אחד בפעם הראשונה.

איך לעבוד:
- כל מספר בתשובה חייב להגיע מהכלים. אל תעריך ואל תשלים מהזיכרון. אם הנתון לא קיים — אמור זאת, והסבר מה כן אפשר לבדוק.
- get_overview נותן את תמונת החודש ו־12 החודשים האחרונים. search_transactions מחפש בכל העסקאות ויודע לסכם לפי חודש, בית עסק או קטגוריה. run_forecast מריץ תחזית "מה אם" עם אותה חשבונאות של מסך התכנון. get_recommendations מחזיר את ההמלצות שהמערכת כבר זיהתה.
- רייזאפ מחלק הוצאות ל"קבועות" (מה שהוא מסווג כקבוע: משכנתא, ביטוחים, מנויים, החזרי הלוואות) ול"משתנות" (כל השאר). היצמד לחלוקה הזו ואל תסווג מחדש בעצמך.
- הסכומים שהכלים מחזירים כבר לא כוללים העברות בין חשבונות ואת החיוב המרוכז של כרטיס האשראי כפי שהוא נראה בבנק, כך שאין ספירה כפולה.
- רייזאפ לא מוסר יתרות בחשבון. לשאלות על העתיד, אם לא נאמר לך כמה יש בחשבון, הרץ את התחזית מאפס, אמור זאת במפורש, והצע להם לומר לך את היתרה.
- בשאלות "מה כדאי": הרץ תחזית לכל חלופה, והשווה ביניהן במספרים — הנקודה הנמוכה ביותר של היתרה, היתרה בסוף התקופה, סך הריבית, וכמה אפשר להוציא ביום. אמור מה נראה עדיף ולמה, ומה צריך לברר כדי להיות בטוחים (למשל הצעת ריבית אמיתית מהבנק, עמלת פירעון מוקדם).
- get_next_month מחזיר את התחזית לחודש הבא: הכנסות צפויות, חיובים קבועים (ומה מסתיים החודש), הוצאות משתנות צפויות לפי קטגוריה, ומה צפוי להישאר.
- שאלות "אפשר לקנות / להוציא על X?": (1) החלט לאיזו קטגוריה במעקב ההוצאה שייכת, לפי שמות הקטגוריות שב־get_overview (למשל פנאי, אוכל בחוץ, ביגוד). אם אף קטגוריה לא מתאימה, ההוצאה יוצאת מ"הוצאות שוטפות" — אל תעביר category. אם לא ברור — שאל שאלה קצרה אחת. אם לא נאמר סכום — בקש אותו. (2) קרא ל־check_purchase. (3) ענה לפי ה־verdict:
  · fits — אפשר. אמור מאיזה תקציב זה יוצא וכמה יישאר בו אחרי הקנייה.
  · fits-with-shift — בתקציב הזה חסר, אבל יש קטגוריות שנמצאות מתחת לתקציב החודש (budgets_with_room_to_give). הצע העברה מדויקת לפי suggested_shifts ("להעביר 300 ₪ מביגוד לפנאי"), הסבר שזה אפשרי כי בקטגוריה ההיא הוצאתם פחות מהמתוכנן, ושאל אם לאשר.
  · over-budget — אין תקציב שיש בו מקום לזה. אמור זאת בפשטות ובלי להטיף: כמה חסר, וההמלצה היא לא להוציא אלא אם זה באמת דחוף או חשוב. אם זה בכל זאת חשוב — הצע את הדרך שפוגעת הכי פחות: סכום קטן יותר, או לדחות לחודש הבא (ואמור מה צפוי להישאר בו לפי next_month_expected_left).
  בנפרד מה־verdict: כש־month_as_a_whole_is_short הוא true, החודש כולו כבר בחריגה (או ייכנס אליה). גם אם הקנייה נכנסת בתקציב של הקטגוריה, אמור במשפט אחד שהחודש בכללותו במינוס ושכדאי להוציא כמה שפחות עד סופו. אל תהפוך בגלל זה "אפשר" ל"אסור".
- shift_budget מעביר תקציב בין קטגוריות לחודש הנוכחי בלבד. קרא לו אך ורק אחרי שהמשתמש אישר במפורש בהודעה האחרונה שלו ("כן", "מאשר", "תעביר"). לעולם לא באותה תשובה שבה הצעת את ההעברה. ההעברה נרשמת במרכז הכספים בלבד — התקציב ברייזאפ עצמו לא משתנה — ואפשר לבטל אותה בהעברה הפוכה. אחרי העברה, אמור מה התקציב החדש של שתי הקטגוריות.
- אתה לא יועץ פיננסי מורשה. לפני החלטה גדולה כמו הלוואה, ציין זאת במשפט אחד ולא יותר.

איך לכתוב: פתח בתשובה עצמה. מספרים בשקלים עם ₪ ופסיקים. תשובות קצרות לשאלות פשוטות; לשאלות מורכבות — כמה פסקאות קצרות או רשימה ממוספרת של צעדים. בלי טבלאות Markdown ובלי כותרות, כי התשובה מוצגת בצ'אט בטלפון.`;

export interface ToolContext { store?: Store; email: string; now: string; liveMonth: string }

function tools(d: Dashboard, ctx: ToolContext) {
  const json = (v: unknown) => JSON.stringify(v);
  return [
    betaZodTool({ name: 'get_overview', description: 'This month in full (income, fixed and variable expenses, tracked category budgets, what is left, alerts), the last 12 months of totals, open installment plans and the baseline the forecast uses. Call this first for almost any question.', inputSchema: z.object({}), run: async () => json(overview(d)) }),
    betaZodTool({
      name: 'search_transactions',
      description: 'Search all counted transactions the hub holds, up to about 13 months back. Every filter is optional and they combine with AND. Use group_by to get totals per month, per business or per category instead of a list — that is the right way to answer "how much did we spend on X" or "how has X changed".',
      inputSchema: z.object({
        text: z.string().optional().describe('Substring of the business name, e.g. "וולט" or "שופרסל"'),
        category: z.string().optional().describe('Exact category label as it appears in the data, e.g. "אוכל בחוץ"'),
        kind: z.enum(['fixed', 'variable', 'income']).optional(),
        month_from: z.string().optional().describe('YYYY-MM, inclusive'), month_to: z.string().optional().describe('YYYY-MM, inclusive'),
        min_amount: z.number().optional(), group_by: z.enum(['month', 'business', 'category']).optional(), limit: z.number().optional().describe('Rows to return when not grouping; default 25, max 60'),
      }),
      run: async (i) => json(searchTransactions(d, i)),
    }),
    betaZodTool({
      name: 'run_forecast',
      description: 'Project the account balance month by month under assumptions, and compute the highest safe daily variable spend. Same arithmetic as the planner screen. Run it once per alternative when comparing options. Loans use equal monthly payments; the proceeds arrive in the loan month, anything it closes is paid off that month, and repayments start the month after.',
      inputSchema: z.object({
        start_balance: z.number().optional().describe('Money in the account today, ILS. 0 when unknown.'),
        floor: z.number().optional().describe('Lowest balance the family accepts, e.g. -10000 for an overdraft line. Default 0.'),
        horizon_months: z.number().optional(), daily_spend: z.number().optional().describe('Override variable spending per day; omit to use their historical average'),
        events: z.array(z.object({
          kind: z.enum(['income-once', 'income-monthly', 'expense-once', 'expense-monthly', 'loan']), label: z.string().optional(),
          month: z.string().describe('YYYY-MM it happens or starts; must be after the current month'), amount: z.number().describe('ILS; for a loan, the principal'),
          until: z.string().optional().describe('Monthly events: last month inclusive'),
          annual_rate_pct: z.number().optional(), months: z.number().optional(),
          closes_installments: z.array(z.string()).optional().describe('Loans: names (substrings) of open installment plans from get_overview that this loan pays off in full'),
          also_covers: z.number().optional().describe('Loans: anything else paid off at once, e.g. an overdraft'),
        })).optional(),
      }),
      run: async (i) => json(runForecast(d, i)),
    }),
    betaZodTool({ name: 'get_next_month', description: 'Prediction for the month after the viewed one: expected income, fixed charges (and which installment plans end), predicted variable spending per category against its budget, anything the family already planned, and what is expected to be left.', inputSchema: z.object({}), run: async () => json(nextMonthView(d)) }),
    betaZodTool({
      name: 'check_purchase',
      description: 'Check a purchase or expense the family is considering against this month: which budget it comes out of, what is left there and in the whole month before and after, which under-spent categories could fund it, and a verdict. Call this for every "can I buy / spend / afford" question.',
      inputSchema: z.object({
        amount: z.number().positive().describe('ILS'),
        category: z.string().optional().describe('Exact label of the tracked category it belongs to, from get_overview tracked_categories. Omit when none fits: it then comes out of everyday spending.'),
      }),
      run: async (i) => json(checkPurchase(d, i)),
    }),
    betaZodTool({
      name: 'shift_budget',
      description: 'Move budget between two categories for the current month, in the hub only (RiseUp itself is not changed). Only after the user explicitly approved this exact shift in their latest message. Use "everyday" for everyday spending.',
      inputSchema: z.object({
        from: z.string().describe('Exact tracked category label, or "everyday"'), to: z.string().describe('Exact tracked category label, or "everyday"'),
        amount: z.number().positive(), reason: z.string().optional().describe('Short, e.g. what the purchase is'),
        user_approved_in_last_message: z.boolean(),
      }),
      run: async (i) => {
        if (!i.user_approved_in_last_message) return json({ error: 'Not applied. Ask the user to approve first.' });
        if (!ctx.store) return json({ error: 'Not available here.' });
        if (d.status.month !== ctx.liveMonth) return json({ error: `Budgets can only be shifted in the current month (${ctx.liveMonth}); the user is viewing ${d.status.month}.` });
        const labels = new Set(d.status.envelopes.filter((e) => e.kind === 'tracked').map((e) => e.label));
        for (const side of [i.from, i.to]) if (side !== 'everyday' && !labels.has(side)) return json({ error: `Unknown category "${side}". Use one of: ${[...labels].join(', ')}, or "everyday".` });
        try {
          const shift = await saveShift(ctx.store, ctx.email, { month: d.status.month, from: i.from, to: i.to, amount: i.amount, reason: i.reason }, ctx.now);
          const planned = (l: string) => d.status.envelopes.find((e) => e.kind === 'tracked' && e.label === l)?.planned;
          return json({ applied: shift, new_budgets: { [i.from]: i.from === 'everyday' ? 'follows automatically' : Math.round((planned(i.from) ?? 0) - shift.amount), [i.to]: i.to === 'everyday' ? 'follows automatically' : Math.round((planned(i.to) ?? 0) + shift.amount) }, note: 'Recorded in the hub. RiseUp itself is unchanged. The screen shows it after a refresh.' });
        } catch (e) {
          if (e instanceof BadRequest) return json({ error: e.message });
          throw e;
        }
      },
    }),
    betaZodTool({ name: 'get_recommendations', description: 'The recommendations the hub already derived from the data, each with its evidence, steps and estimated yearly saving.', inputSchema: z.object({}), run: async () => json(recommendations(d)) }),
  ];
}

export type Model = (args: { system: string; messages: Anthropic.Beta.BetaMessageParam[]; tools: ReturnType<typeof tools> }) => Promise<string>;

// The key already lives in this AWS account for another family project. It is
// read at runtime and never copied into this repo, GitHub or Terraform state.
let cachedKey: string | undefined;
async function apiKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  cachedKey ??= (await new SSMClient({ region: process.env.ANTHROPIC_KEY_REGION }).send(new GetParameterCommand({ Name: process.env.ANTHROPIC_KEY_PARAM!, WithDecryption: true }))).Parameter?.Value;
  if (!cachedKey) throw new NotConfigured();
  return cachedKey;
}
export class NotConfigured extends Error {}

const claude: Model = async ({ system, messages, tools }) => {
  const client = new Anthropic({ apiKey: await apiKey(), timeout: 150_000, maxRetries: 1 });
  const final = await client.beta.messages.toolRunner({
    model: 'claude-opus-5',
    max_tokens: 16000,
    // Adaptive thinking is the default on this model. Medium effort keeps an
    // answer inside the time a person will wait in a chat.
    output_config: { effort: 'medium' },
    // If a request is declined, the API reruns it on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools,
    messages,
    max_iterations: 8,
  } as Parameters<typeof client.beta.messages.toolRunner>[0]);
  if (final.stop_reason === 'refusal') return 'לא אוכל לענות על השאלה הזו. אפשר לנסח אותה אחרת?';
  const text = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  return text || (final.stop_reason === 'max_tokens' ? 'התשובה יצאה ארוכה מדי. אפשר לשאול שאלה ממוקדת יותר?' : 'לא הצלחתי לנסח תשובה. אפשר לנסות שוב?');
};

export async function answer(job: AskJob, d: Dashboard, model: Model = claude, today = new Date().toISOString().slice(0, 10), store?: Store): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...job.history.slice(-8).map((t) => ({ role: t.role, content: t.text })),
    { role: 'user' as const, content: `[היום ${today}. החודש המוצג: ${d.status.month}. שואל/ת: ${job.email}]\n\n${job.question}` },
  ];
  return model({ system: SYSTEM, messages, tools: tools(d, { store, email: job.email, now: new Date().toISOString(), liveMonth: today.slice(0, 7) }) });
}

// Invoked asynchronously by the API Lambda. The answer lands in the job file,
// which the page polls: API Gateway gives a request 30 seconds, a good answer
// with several lookups can take longer.
export async function handler(event: { jobId?: string; selfTest?: boolean }, deps: { store?: Store; model?: Model; now?: () => Date } = {}) {
  // Run from CI: proves the key is readable and the model and tools work end to
  // end, on generated sample data so no real figure leaves the account.
  if (event.selfTest) {
    const today = new Date().toISOString().slice(0, 10);
    const s = sampleData(today);
    const d = buildDashboard({ budget: s.budgets.get(s.current)!, transactions: s.transactions, today, lastSyncAt: null, source: 'sample' });
    const job: AskJob = { id: 'selftest', email: 'selftest', question: 'כמה הוצאנו על וולט בשלושת החודשים האחרונים? ענה במשפט אחד.', history: [], status: 'pending', askedAt: today };
    try {
      return { ok: true, answer: await answer(job, d, deps.model, today) };
    } catch (e) {
      // Says what kind of credential is stored, never the credential.
      const k = await apiKey().catch(() => '');
      const kind = k.startsWith('sk-ant-api') ? 'api-key' : k.startsWith('sk-ant-oat') ? 'claude-code-oauth-token' : k.startsWith('sk-ant-admin') ? 'admin-key' : k ? 'unrecognized' : 'missing';
      throw new Error(`self-test failed: ${e instanceof Anthropic.APIError ? `Anthropic ${e.status} ${String(e.message).replace(/sk-ant-[\w-]+/g, '[key]').slice(0, 300)}` : (e as Error).name}; stored credential kind: ${kind}, length ${k.length}, has whitespace: ${/\s/.test(k)}`);
    }
  }
  if (!event.jobId) return;
  const store = deps.store ?? new S3Store(process.env.DATA_BUCKET!);
  const jobId = event.jobId;
  const job = await store.get<AskJob>(keys.chat(jobId));
  if (!job) return;
  try {
    const now = deps.now?.() ?? new Date();
    const d = await loadDashboard(store, job.email, job.month, now);
    if (!d) throw new Error('no data synced yet');
    job.answer = await answer(job, d, deps.model, now.toISOString().slice(0, 10), store);
    job.status = 'done';
  } catch (e) {
    // The error text stays in our own bucket; the family sees a plain sentence.
    console.error((e as Error).name);
    job.status = 'error';
    const missing = e instanceof NotConfigured || ['ParameterNotFound', 'AccessDeniedException'].includes((e as Error).name);
    job.error = missing ? 'העוזר עוד לא הופעל: לא נמצא מפתח API בחשבון ה־AWS.' : e instanceof Anthropic.AuthenticationError ? 'מפתח ה־API של העוזר לא תקין.' : e instanceof Anthropic.RateLimitError ? 'העוזר עמוס כרגע. נסו שוב בעוד דקה.' : 'משהו השתבש בדרך. נסו שוב.';
  }
  job.answeredAt = new Date().toISOString();
  await store.put(keys.chat(jobId), job);
}
