// Which widget sits on which screen, in what order. Each of us keeps our own
// arrangement; it is saved on this device at once and to the hub in the background.
export const SCREENS = ['home', 'fixed', 'variable', 'txns', 'trends', 'recos'] as const;
export type ScreenId = (typeof SCREENS)[number];

export const SCREEN_LABEL: Record<ScreenId, string> = {
  home: 'בית', fixed: 'קבועות', variable: 'משתנות', txns: 'עסקאות', trends: 'מגמות', recos: 'תכנון',
};

// Fixed and variable are kept apart exactly as RiseUp's budget files them.
export const DEFAULT_LAYOUT: Record<ScreenId, string[]> = {
  home: ['hero', 'free', 'kpis', 'pace', 'alerts', 'topRecos', 'split'],
  fixed: ['fixedKpis', 'income', 'fixed', 'changes', 'recurringAll'],
  variable: ['variableKpis', 'budgets', 'shifts', 'everyday', 'biggest', 'installments'],
  txns: ['compare', 'transactions', 'accounts', 'excluded', 'removed'],
  trends: ['trendKpis', 'net', 'categories'],
  recos: ['nextMonth', 'recoSummary', 'recoList', 'planner'],
};

export interface Layout { screens: Record<ScreenId, string[]>; hidden: string[] }

const ALL = new Set(Object.values(DEFAULT_LAYOUT).flat());

// A saved layout may predate widgets added since, or mention ones that are
// gone. New widgets land on their default screen; nothing is ever lost.
export function normalize(saved: unknown): Layout {
  const s = (saved ?? {}) as Partial<Layout>;
  const screens = Object.fromEntries(SCREENS.map((id) => [id, [] as string[]])) as Record<ScreenId, string[]>;
  const placed = new Set<string>();
  for (const id of SCREENS) {
    for (const w of s.screens?.[id] ?? []) if (ALL.has(w) && !placed.has(w)) { screens[id].push(w); placed.add(w); }
  }
  const hidden = (s.hidden ?? []).filter((w) => ALL.has(w) && !placed.has(w));
  hidden.forEach((w) => placed.add(w));
  for (const id of SCREENS) for (const w of DEFAULT_LAYOUT[id]) if (!placed.has(w)) screens[id].push(w);
  return { screens, hidden };
}

export function move(l: Layout, widget: string, dir: -1 | 1): Layout {
  const screen = SCREENS.find((id) => l.screens[id].includes(widget));
  if (!screen) return l;
  const list = [...l.screens[screen]];
  const i = list.indexOf(widget);
  const j = i + dir;
  if (j < 0 || j >= list.length) return l;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { ...l, screens: { ...l.screens, [screen]: list } };
}

export function sendTo(l: Layout, widget: string, target: ScreenId): Layout {
  const screens = Object.fromEntries(SCREENS.map((id) => [id, l.screens[id].filter((w) => w !== widget)])) as Record<ScreenId, string[]>;
  screens[target] = [...screens[target], widget];
  return { screens, hidden: l.hidden.filter((w) => w !== widget) };
}

export function hide(l: Layout, widget: string): Layout {
  const screens = Object.fromEntries(SCREENS.map((id) => [id, l.screens[id].filter((w) => w !== widget)])) as Record<ScreenId, string[]>;
  return { screens, hidden: [...l.hidden.filter((w) => w !== widget), widget] };
}

export const screenOf = (l: Layout, widget: string) => SCREENS.find((id) => l.screens[id].includes(widget));
