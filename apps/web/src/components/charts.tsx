import type { Dashboard } from '@hub/core';
import { useState, type ReactNode } from 'react';
import { compact, money, monthLabel } from '../lib/format.ts';
import { baseOption, categoryAxis, Chart, valueAxis } from './Chart.tsx';

type P = { d: Dashboard; theme: string };

const tip = (title: string, rows: [string, string, string][]) =>
  `<b>${title}</b>` +
  rows.map(([c, k, v]) => `<div style="display:flex;gap:12px;justify-content:space-between"><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-left:6px"></i>${k}</span><b dir="ltr">${v}</b></div>`).join('');

// Every chart can be read as a table instead: for screen readers, for exact
// numbers, and for anyone who simply prefers rows to pictures.
function WithTable({ chart, head, rows }: { chart: ReactNode; head: string[]; rows: (string | number)[][] }) {
  const [table, setTable] = useState(false);
  return (
    <>
      <div className="chart-tools">
        <button className="link-btn" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'הצגה כגרף' : 'הצגה כטבלה'}</button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{head.map((h, i) => <th key={h} className={i ? 'n' : ''} scope="col">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={String(r[0])}>{r.map((c, i) => (i ? <td key={i} className="n">{typeof c === 'number' ? money(c) : c}</td> : <th key={i} scope="row">{c}</th>))}</tr>)}</tbody>
          </table>
        </div>
      ) : chart}
    </>
  );
}

// Variable spending this month, two ways in one widget: what went out each day
// against the daily budget, or the running total against an even pace. They
// share a widget but not an axis — daily amounts and a month's total differ
// by two orders of magnitude.
export function BurnChart({ d, theme }: P) {
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily');
  const { burn, status } = d;
  const upTo = status.dayOfMonth || burn.length;
  const perDay = Math.max(status.flexible.planned, 0) / status.daysInMonth;
  const over = burn.filter((b) => b.day <= upTo && b.spent > perDay).length;

  return (
    <>
      <div className="chips" role="group" aria-label="סוג התצוגה" style={{ marginBottom: '0.5rem' }}>
        <button className="chip" aria-pressed={mode === 'daily'} onClick={() => setMode('daily')}>יומי: תקציב מול בפועל</button>
        <button className="chip" aria-pressed={mode === 'cumulative'} onClick={() => setMode('cumulative')}>מצטבר</button>
      </div>
      {mode === 'daily' ? (
        <WithTable
          head={['יום בחודש', 'הוצאתם', 'תקציב יומי', 'הפרש']}
          rows={burn.filter((b) => b.day <= upTo).map((b) => [b.day, b.spent, perDay, b.spent - perDay])}
          chart={
            <>
              <p className="note">התקציב היומי הוא <b className="num">{money(perDay)}</b>: מה שפנוי להוצאות משתנות החודש, מחולק ב־{status.daysInMonth} ימים. חרגתם ממנו ב־{over} מתוך {upTo} ימים.</p>
              <div className="legend">
                <span><i style={{ background: 'var(--series-1)' }} />יום בתוך התקציב</span>
                <span><i style={{ background: 'var(--critical)' }} />יום מעל התקציב</span>
                <span><i className="dash" />התקציב היומי</span>
              </div>
              <Chart theme={theme} deps={[d, mode]} label="גרף: ההוצאה המשתנה בכל יום בחודש, לעומת התקציב היומי"
                build={(t) => ({
                  ...baseOption(t),
                  tooltip: { ...(baseOption(t).tooltip as object), axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } },
                    formatter: (ps: { dataIndex: number }[]) => {
                      const b = burn[ps[0]!.dataIndex]!;
                      if (b.day > upTo) return tip(`יום ${b.day} בחודש`, [[t.muted, 'תקציב יומי', money(perDay)]]);
                      return tip(`יום ${b.day} בחודש`, [[b.spent > perDay ? t.critical : t.s1, 'הוצאתם', money(b.spent)], [t.muted, 'תקציב יומי', money(perDay)], [t.muted, b.spent > perDay ? 'מעל התקציב' : 'מתחת לתקציב', money(Math.abs(b.spent - perDay))]]);
                    } },
                  xAxis: categoryAxis(t, burn.map((b) => String(b.day)), 4),
                  yAxis: valueAxis(t, compact),
                  series: [{
                    type: 'bar', barMaxWidth: 14,
                    data: burn.map((b) => (b.day <= upTo ? { value: Math.round(b.spent), itemStyle: { color: b.spent > perDay ? t.critical : t.s1, borderRadius: [3, 3, 0, 0] } } : null)),
                    markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: t.muted, width: 2, type: 'dashed' }, data: [{ yAxis: Math.round(perDay) }] },
                  }],
                })} />
            </>
          }
        />
      ) : (
        <WithTable
          head={['יום בחודש', 'הוצאתם באותו יום', 'מצטבר', 'קצב אחיד']}
          rows={burn.filter((b) => b.day <= upTo).map((b) => [b.day, b.spent, b.cumulative, b.ideal])}
          chart={
            <>
              <div className="legend">
                <span><i style={{ background: 'var(--series-1)' }} />מה שהוצאתם עד כה</span>
                <span><i className="dash" />קצב אחיד עד הסכום הפנוי</span>
              </div>
              <Chart theme={theme} deps={[d, mode]} label="גרף: הוצאות משתנות מצטברות החודש, לעומת קצב אחיד"
                build={(t) => ({
                  ...baseOption(t),
                  tooltip: { ...(baseOption(t).tooltip as object), formatter: (ps: { dataIndex: number }[]) => {
                    const b = burn[ps[0]!.dataIndex]!;
                    const rows: [string, string, string][] = [[t.muted, 'קצב אחיד', money(b.ideal)]];
                    if (b.day <= upTo) rows.unshift([t.s1, 'הוצאתם עד היום הזה', money(b.cumulative)]);
                    return tip(`יום ${b.day} בחודש`, rows);
                  } },
                  xAxis: categoryAxis(t, burn.map((b) => String(b.day)), 4),
                  yAxis: valueAxis(t, compact),
                  series: [
                    { type: 'line', data: burn.map((b) => Math.round(b.ideal)), symbol: 'none', lineStyle: { color: t.muted, width: 2, type: 'dashed' }, z: 1 },
                    { type: 'line', data: burn.map((b) => (b.day <= upTo ? Math.round(b.cumulative) : null)), symbol: 'none', lineStyle: { color: t.s1, width: 2 }, areaStyle: { color: t.s1, opacity: 0.12 }, z: 2 },
                  ],
                })} />
            </>
          }
        />
      )}
    </>
  );
}

export function NetChart({ d, theme }: P) {
  const ms = d.months;
  return (
    <WithTable
      head={['חודש', 'הכנסות', 'הוצאות', 'נשאר']}
      rows={[...ms].reverse().map((m) => [monthLabel(m.month), m.income, m.expenses, m.net])}
      chart={
        <Chart theme={theme} deps={[d]} label="גרף: כמה כסף נשאר בכל חודש בשנה האחרונה"
          build={(t) => ({
            ...baseOption(t),
            tooltip: { ...(baseOption(t).tooltip as object), axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } },
              formatter: (ps: { dataIndex: number }[]) => {
                const m = ms[ps[0]!.dataIndex]!;
                return tip(monthLabel(m.month), [[m.net >= 0 ? t.s3 : t.critical, 'נשאר', money(m.net)], [t.muted, 'הכנסות', money(m.income)], [t.muted, 'הוצאות', money(m.expenses)]]);
              } },
            xAxis: categoryAxis(t, ms.map((m) => monthLabel(m.month, 'short'))),
            yAxis: valueAxis(t, compact),
            series: [{
              type: 'bar', barMaxWidth: 22,
              data: ms.map((m) => ({ value: Math.round(m.net), itemStyle: { color: m.net >= 0 ? t.s3 : t.critical, borderRadius: m.net >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })),
              markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: t.axis, type: 'solid' }, data: [{ yAxis: 0 }] },
            }],
          })} />
      }
    />
  );
}

export function SplitChart({ d, theme }: P) {
  const ms = d.months;
  return (
    <WithTable
      head={['חודש', 'קבועות', 'משתנות', 'הכנסות']}
      rows={[...ms].reverse().map((m) => [monthLabel(m.month), m.fixed, m.variable, m.income])}
      chart={
        <>
          <div className="legend">
            <span><i style={{ background: 'var(--series-1)' }} />הוצאות קבועות</span>
            <span><i style={{ background: 'var(--series-2)' }} />הוצאות משתנות</span>
            <span><i className="dash" />הכנסות</span>
          </div>
          <Chart theme={theme} deps={[d]} label="גרף: הוצאות קבועות ומשתנות בכל חודש, לעומת ההכנסות"
            build={(t) => ({
              ...baseOption(t),
              tooltip: { ...(baseOption(t).tooltip as object), axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } },
                formatter: (ps: { dataIndex: number }[]) => {
                  const m = ms[ps[0]!.dataIndex]!;
                  return tip(monthLabel(m.month), [[t.s2, 'משתנות', money(m.variable)], [t.s1, 'קבועות', money(m.fixed)], [t.muted, 'הכנסות', money(m.income)]]);
                } },
              xAxis: categoryAxis(t, ms.map((m) => monthLabel(m.month, 'short'))),
              yAxis: valueAxis(t, compact),
              series: [
                // The card-coloured border is the gap between stacked segments.
                { type: 'bar', stack: 's', barMaxWidth: 22, data: ms.map((m) => Math.round(m.fixed)), itemStyle: { color: t.s1, borderColor: t.card, borderWidth: 1 } },
                { type: 'bar', stack: 's', barMaxWidth: 22, data: ms.map((m) => Math.round(m.variable)), itemStyle: { color: t.s2, borderColor: t.card, borderWidth: 1, borderRadius: [4, 4, 0, 0] } },
                { type: 'line', data: ms.map((m) => Math.round(m.income)), symbol: 'none', lineStyle: { color: t.muted, width: 2, type: 'dashed' } },
              ],
            })} />
        </>
      }
    />
  );
}
