// "₪1,234" with no bidi control characters, so amounts render the same inside
// Hebrew sentences, left-to-right number cells and chart tooltips.
const fmt = (n: number, digits: number) => `${n < 0 ? '−' : ''}₪${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;

export const money = (n: number) => fmt(Math.round(n), 0);
export const moneyExact = (n: number) => fmt(n, 2);
export const signedMoney = (n: number) => `${Math.round(n) > 0 ? '+' : ''}${money(n)}`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 100))}%`;
export const compact = (n: number) => (Math.abs(n) >= 1000 ? `₪${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}K` : `₪${Math.round(n)}`);

export function monthLabel(month: string, style: 'long' | 'short' = 'long') {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('he-IL', { month: style, year: style === 'long' ? 'numeric' : undefined, timeZone: 'UTC' });
}
export const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const fullDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function ago(iso: string | null) {
  if (!iso) return 'אף פעם';
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return 'לפני פחות משעה';
  if (h < 24) return `לפני ${Math.round(h)} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

// ECharts paints to canvas and cannot read CSS variables itself.
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
