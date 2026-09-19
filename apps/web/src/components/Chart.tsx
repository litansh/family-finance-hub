import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { cssVar } from '../lib/format.ts';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

export interface Tokens {
  text: string; text2: string; muted: string; grid: string; axis: string; card: string;
  s1: string; s2: string; s3: string; s4: string; critical: string;
}

const tokens = (): Tokens => ({
  text: cssVar('--text'), text2: cssVar('--text-2'), muted: cssVar('--muted'), grid: cssVar('--grid'),
  axis: cssVar('--axis'), card: cssVar('--card'), s1: cssVar('--series-1'), s2: cssVar('--series-2'),
  s3: cssVar('--series-3'), s4: cssVar('--series-4'), critical: cssVar('--critical'),
});

// Shared chrome: recessive grid and axes, tooltip in text tokens. Time runs left
// to right even in the Hebrew UI, as it does in Israeli financial charts.
export function baseOption(t: Tokens): ChartOption {
  return {
    animationDuration: 300,
    grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
    textStyle: { fontFamily: 'system-ui, -apple-system, sans-serif' },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: t.card,
      borderColor: t.axis,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 13 },
      extraCssText: 'direction: rtl; text-align: right;',
      axisPointer: { type: 'line', lineStyle: { color: t.axis, width: 1 } },
    },
  };
}

export const categoryAxis = (t: Tokens, data: string[], interval: number | 'auto' = 'auto') => ({
  type: 'category' as const,
  data,
  axisLine: { lineStyle: { color: t.axis } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 11, interval, hideOverlap: true },
});

export const valueAxis = (t: Tokens, formatter: (n: number) => string) => ({
  type: 'value' as const,
  splitNumber: 3,
  axisLabel: { color: t.muted, fontSize: 11, formatter },
  splitLine: { lineStyle: { color: t.grid } },
});

interface Props {
  build: (t: Tokens) => ChartOption;
  deps: unknown[];
  theme: string;
  label: string;
}

export function Chart({ build, deps, theme, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => { ro.disconnect(); c.dispose(); };
  }, []);

  // Tokens are read after the theme attribute lands, so a toggle repaints.
  useEffect(() => {
    chart.current?.setOption(build(tokens()), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps]);

  return <div ref={el} className="chart" role="img" aria-label={label} />;
}
