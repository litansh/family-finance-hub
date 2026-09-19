import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | null; // null follows the OS
export const TEXT_SIZES = [{ id: 'm', label: 'רגיל', scale: 1 }, { id: 'l', label: 'גדול', scale: 1.15 }, { id: 'xl', label: 'גדול מאוד', scale: 1.3 }] as const;
export type TextSize = (typeof TEXT_SIZES)[number]['id'];

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string | null) => { try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* private mode */ } };

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => { const v = read('hub:theme'); return v === 'light' || v === 'dark' ? v : null; });
  const [osDark, setOsDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [size, setSize] = useState<TextSize>(() => (TEXT_SIZES.find((s) => s.id === read('hub:text'))?.id ?? 'm'));

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setOsDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
    write('hub:theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(TEXT_SIZES.find((s) => s.id === size)!.scale));
    write('hub:text', size);
  }, [size]);

  const resolved: 'light' | 'dark' = theme ?? (osDark ? 'dark' : 'light');
  return { resolved, toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark'), size, setSize };
}
