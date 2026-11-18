import React from 'react';
import katex from 'katex';
import { Markdown } from '../lib/markdown';
import type { BlockValue } from './catalog';

type Series = { name: string; values: Array<number | null> };

const W = 640;
const PAD = { left: 52, right: 16, top: 16, bottom: 44 };
const seriesColor = (i: number) => `var(--series-${(i % 6) + 1})`;
const fmt = (n: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n);
const withUnit = (n: number, unit?: string) => (unit ? `${fmt(n)} ${unit}` : fmt(n));

function ticks(low: number, high: number): number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  const span = high - low || Math.abs(high) || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const share = raw / mag;
  const step = (share <= 1 ? 1 : share <= 2 ? 2 : share <= 5 ? 5 : 10) * mag;
  const start = Math.floor(low / step) * step;
  const end = Math.max(Math.ceil(high / step) * step, start + step);
  const out: number[] = [];
  for (let v = start; v <= end + step / 2 && out.length < 12; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const seriesOf = (value: unknown): Series[] => (Array.isArray(value) ? value : [])
  .filter((item): item is Series => Boolean(item) && typeof item === 'object' && typeof (item as Series).name === 'string' && Array.isArray((item as Series).values));

const pointsOf = (list: Series[]) => list.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'));

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="block">
      {title ? <h3 className="block-title">{title}</h3> : null}
      {children}
    </section>
  );
}

function Axes({ low, high, height }: { low: number; high: number; height: number }) {
  return (
    <>
      {ticks(low, high).map((tick) => {
        const y = PAD.top + (height - PAD.top - PAD.bottom) * (1 - (tick - low) / (high - low || 1));
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className="grid" />
            <text x={PAD.left - 8} y={y + 3.5} textAnchor="end" className="axis-label">{fmt(tick)}</text>
          </g>
        );
      })}
    </>
  );
}

function ColumnChart({ value }: { value: Record<string, any> }) {
  const labels: string[] = value.labels ?? [];
  const list = seriesOf(value.series).map((s) => ({ ...s, values: s.values.slice(0, labels.length) }));
  if (!labels.length || !list.length) return null;
  const stacked = value.stacked === true && list.length > 1;
  const totals = labels.map((_, i) => (stacked
    ? list.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
    : Math.max(...list.map((s) => s.values[i] ?? 0))));
  const t = ticks(Math.min(0, ...totals), Math.max(0, ...totals));
  const low = t[0];
  const high = t[t.length - 1];
  const height = 250;
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const yOf = (v: number) => PAD.top + plotH * (1 - (v - low) / (high - low || 1));
  const group = plotW / labels.length;
  const barW = Math.max(6, (group * 0.6) / list.length);
  const arrow = React.useId().replace(/:/g, '');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      <defs>
        <marker id={`a${arrow}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      <Axes low={low} high={high} height={height} />
      <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={height - PAD.bottom} className="axis" markerEnd={`url(#a${arrow})`} />
      <line x1={PAD.left} x2={W - PAD.right} y1={height - PAD.bottom} y2={height - PAD.bottom} className="axis" markerEnd={`url(#a${arrow})`} />
      {value.yLabel ? <text transform={`rotate(-90 14 ${PAD.top + plotH / 2})`} x={14} y={PAD.top + plotH / 2} textAnchor="middle" className="axis-title">{value.yLabel}</text> : null}
      {value.xLabel ? <text x={PAD.left + plotW / 2} y={height - 8} textAnchor="middle" className="axis-title">{value.xLabel}</text> : null}
      {value.unit ? <text x={PAD.left - 8} y={PAD.top - 4} textAnchor="end" className="axis-label">{value.unit}</text> : null}
      {labels.map((label, i) => {
        const center = PAD.left + group * i + group / 2;
        let raised = 0;
        return (
          <g key={`${label}-${i}`}>
            {list.map((s, si) => {
              const point = s.values[i];
              if (typeof point !== 'number') return null;
              const from = stacked ? raised : Math.min(0, low);
              const to = stacked ? raised + point : Math.max(point, Math.min(0, low));
              if (stacked) raised += point;
              const x = stacked ? center - barW / 2 : center - (barW * list.length) / 2 + barW * si;
              const y = Math.min(yOf(to), yOf(from));
              const h = Math.max(2, Math.abs(yOf(to) - yOf(from)));
              return (
                <g key={si}>
                  <rect x={x} y={y} width={stacked ? barW : Math.max(5, barW - 3)} height={h} rx={3} fill={seriesColor(si)} />
                  {labels.length * list.length <= 14 && !stacked ? <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="axis-label">{fmt(point)}</text> : null}
                </g>
              );
            })}
            <text x={center} y={height - PAD.bottom + 16} textAnchor="middle" className="axis-label">{label.length > 12 ? `${label.slice(0, 11)}…` : label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Scatter({ value }: { value: Record<string, any> }) {
  const xs: number[] = value.x ?? [];
  const list = seriesOf(value.series);
  const points = pointsOf(list);
  if (!xs.length || !points.length) return null;
  const t = ticks(Math.min(0, ...points), Math.max(...points));
  const low = t[0];
  const high = t[t.length - 1];
  const height = 220;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xOf = (v: number) => PAD.left + (W - PAD.left - PAD.right) * ((v - xMin) / (xMax - xMin || 1));
  const yOf = (v: number) => PAD.top + (height - PAD.top - PAD.bottom) * (1 - (v - low) / (high - low || 1));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      <Axes low={low} high={high} height={height} />
      {list.map((s, si) => s.values.map((point, i) => (typeof point === 'number' && xs[i] !== undefined
        ? <circle key={`${si}-${i}`} cx={xOf(xs[i])} cy={yOf(point)} r={3.5} fill={seriesColor(si)} />
        : null)))}
      <text x={PAD.left} y={height - 8} className="axis-label">{withUnit(xMin, value.xUnit)}</text>
      <text x={W - PAD.right} y={height - 8} textAnchor="end" className="axis-label">{withUnit(xMax, value.xUnit)}</text>
    </svg>
  );
}

function Area({ value }: { value: Record<string, any> }) {
  const labels: string[] = value.labels ?? [];
  const list = seriesOf(value.series).map((s) => ({ ...s, values: s.values.slice(0, labels.length) }));
  if (!labels.length || !list.length) return null;
  const stacked = value.stacked === true && list.length > 1;
  const base = labels.map(() => 0);
  const bands = list.map((s) => {
    const bottom = stacked ? [...base] : labels.map(() => 0);
    const top = s.values.map((point, i) => {
      const v = (stacked ? bottom[i] : 0) + (point ?? 0);
      if (stacked) base[i] = v;
      return v;
    });
    return { s, bottom, top };
  });
  const t = ticks(Math.min(0, ...bands.flatMap((b) => b.bottom)), Math.max(...bands.flatMap((b) => b.top)));
  const low = t[0];
  const high = t[t.length - 1];
  const height = 220;
  const xOf = (i: number) => PAD.left + (labels.length === 1 ? 0 : (i / (labels.length - 1)) * (W - PAD.left - PAD.right));
  const yOf = (v: number) => PAD.top + (height - PAD.top - PAD.bottom) * (1 - (v - low) / (high - low || 1));
  const path = (top: number[], bottom?: number[]) => {
    const up = top.map((v, i) => `${i ? 'L' : 'M'}${xOf(i)},${yOf(v)}`).join(' ');
    if (!bottom) return up;
    const back = [...bottom].reverse().map((v, i) => `L${xOf(labels.length - 1 - i)},${yOf(v)}`).join(' ');
    return `${up} ${back} Z`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      <Axes low={low} high={high} height={height} />
      {bands.map((band, i) => (
        <path key={i} d={path(band.top, stacked ? band.bottom : undefined)} fill={seriesColor(i)} fillOpacity={stacked ? 0.45 : 0.18} stroke={seriesColor(i)} strokeWidth={1.5} />
      ))}
      <text x={PAD.left} y={height - 8} className="axis-label">{labels[0]}</text>
      <text x={W - PAD.right} y={height - 8} textAnchor="end" className="axis-label">{labels[labels.length - 1]}</text>
    </svg>
  );
}

function Diagram({ value }: { value: Record<string, any> }) {
  const nodes: any[] = value.nodes ?? [];
  const edges: any[] = value.edges ?? [];
  if (!nodes.length) return null;
  const height = value.height ?? 260;
  const box = (n: any) => ({
    cx: (n.x / 100) * W,
    cy: (n.y / 100) * height,
    w: ((n.width ?? 24) / 100) * W,
    h: ((n.height ?? 12) / 100) * height,
  });
  const rects = new Map(nodes.map((n) => [n.id, box(n)]));
  const clip = (r: any, toward: any) => {
    const dx = toward.cx - r.cx;
    const dy = toward.cy - r.cy;
    const scale = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
    const t = Number.isFinite(scale) ? scale : 0;
    return { x: r.cx + dx * t, y: r.cy + dy * t };
  };
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map((edge, i) => {
        const from = rects.get(edge.from);
        const to = rects.get(edge.to);
        if (!from || !to) return null;
        const a = clip(from, to);
        const b = clip(to, from);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge" markerEnd="url(#arrow)" />
            {edge.label ? (
              <g>
                <rect x={mx - (edge.label.length * 5.4 + 12) / 2} y={my - 16} width={edge.label.length * 5.4 + 12} height={16} rx={8} className="edge-label-bg" />
                <text x={mx} y={my - 5} textAnchor="middle" className="axis-label">{edge.label}</text>
              </g>
            ) : null}
          </g>
        );
      })}
      {nodes.map((n) => {
        const r = rects.get(n.id);
        if (!r) return null;
        const tone = n.tone ? `var(--tone-${n.tone})` : null;
        return (
          <g key={n.id}>
            <rect
              x={r.cx - r.w / 2}
              y={r.cy - r.h / 2}
              width={r.w}
              height={r.h}
              rx={10}
              fill={tone ? `color-mix(in srgb, ${tone} 16%, transparent)` : 'var(--tile)'}
              stroke={tone ?? 'var(--border)'}
            />
            <text x={r.cx} y={r.cy + 4} textAnchor="middle" className="node-label">{n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Heatmap({ value }: { value: Record<string, any> }) {
  const rows: string[] = value.rows ?? [];
  const columns: string[] = value.columns ?? [];
  const values: number[][] = value.values ?? [];
  const flat = values.flat();
  if (!flat.length) return null;
  const low = Math.min(...flat);
  const high = Math.max(...flat);
  const mix = (v: number) => (high === low ? 55 : 10 + (85 * (v - low)) / (high - low));
  return (
    <div className="heatmap-wrap">
      <div className="heatmap" style={{ gridTemplateColumns: `minmax(3.5rem,auto) repeat(${columns.length}, minmax(1.6rem,1fr))` }}>
        <span />
        {columns.map((c) => <span key={c} className="axis-label center">{c}</span>)}
        {rows.map((row, ri) => (
          <React.Fragment key={row}>
            <span className="axis-label">{row}</span>
            {columns.map((c, ci) => {
              const v = values[ri]?.[ci];
              return (
                <span
                  key={c}
                  className="heat-cell"
                  title={typeof v === 'number' ? `${row} · ${c}: ${withUnit(v, value.unit)}` : undefined}
                  style={typeof v === 'number' ? { background: `color-mix(in srgb, ${seriesColor(0)} ${mix(v)}%, transparent)` } : undefined}
                >
                  {typeof v === 'number' && flat.length <= 60 ? fmt(v) : ''}
                </span>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="heat-legend axis-label">
        <span>{withUnit(low, value.unit)}</span>
        <span className="heat-ramp" style={{ background: `linear-gradient(to right, color-mix(in srgb, ${seriesColor(0)} 10%, transparent), ${seriesColor(0)})` }} />
        <span>{withUnit(high, value.unit)}</span>
      </div>
    </div>
  );
}

function Timeline({ value }: { value: Record<string, any> }) {
  const items: any[] = value.items ?? [];
  if (!items.length) return null;
  const start = Math.min(...items.map((i) => i.start));
  const end = Math.max(...items.map((i) => i.end));
  const span = end - start || 1;
  return (
    <div className="timeline">
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`} className="timeline-row">
          <span className="timeline-label" title={item.label}>{item.label}</span>
          <span className="timeline-track">
            <span
              className="timeline-bar"
              style={{
                left: `${((item.start - start) / span) * 100}%`,
                width: `${Math.max(((item.end - item.start) / span) * 100, 1.5)}%`,
                background: item.tone ? `var(--tone-${item.tone})` : seriesColor(i),
              }}
            />
          </span>
          <span className="timeline-value">{withUnit(item.end - item.start, value.unit)}</span>
        </div>
      ))}
      <div className="timeline-axis axis-label"><span>{withUnit(start, value.unit)}</span><span>{withUnit(end, value.unit)}</span></div>
    </div>
  );
}

function MathBlock({ value }: { value: Record<string, any> }) {
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(String(value.latex ?? ''), { displayMode: value.block !== false, throwOnError: false, trust: false, strict: 'ignore' });
    } catch {
      return null;
    }
  }, [value.latex, value.block]);
  return <div className="math">{html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <code>{String(value.latex ?? '')}</code>}</div>;
}

function Sparkline({ value }: { value: Record<string, any> }) {
  const values: Array<number | null> = value.values ?? [];
  const points = values.filter((v): v is number => typeof v === 'number');
  if (points.length < 2) return null;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const width = 140;
  const height = 32;
  const at = (v: number, i: number) => `${(i / (values.length - 1)) * width},${height - 3 - ((v - low) / (high - low || 1)) * (height - 6)}`;
  const d = values
    .map((v, i) => (typeof v === 'number' ? `${i === 0 || typeof values[i - 1] !== 'number' ? 'M' : 'L'}${at(v, i)}` : ''))
    .join(' ');
  return (
    <div className="sparkline">
      {value.label ? <span className="axis-label">{value.label}</span> : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="sparkline-svg"><path d={d} fill="none" stroke={seriesColor(0)} strokeWidth={1.75} strokeLinecap="round" /></svg>
      <span className="spark-value">{withUnit(points[points.length - 1], value.unit)}</span>
    </div>
  );
}

function Steps({ value }: { value: Record<string, any> }) {
  const items: any[] = value.items ?? [];
  return (
    <ol className={value.direction === 'row' ? 'steps steps-row' : 'steps'}>
      {items.map((item, i) => (
        <li key={i} className={`step step-${item.status ?? 'todo'}`}>
          <span className="step-mark" />
          <div>
            <div className="step-title">{item.title}</div>
            {item.markdown ? <Markdown text={item.markdown} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Table({ value }: { value: Record<string, any> }) {
  const columns: string[] = value.columns ?? [];
  const rows: Array<Array<string | number>> = value.rows ?? [];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Node({ value }: { value: any }) {
  if (!value || typeof value !== 'object') return null;
  const p = value.props ?? {};
  switch (value.typeName) {
    case 'Stack': return <div className="stack">{p.children?.map((child: any, i: number) => <Node key={i} value={child} />)}</div>;
    case 'Row': return <div className="row">{p.children?.map((child: any, i: number) => <Node key={i} value={child} />)}</div>;
    case 'Card': return <Frame title={p.title?.trim() || undefined}>{p.children?.map((child: any, i: number) => <Node key={i} value={child} />)}</Frame>;
    case 'Text': return <Markdown text={p.markdown ?? ''} />;
    case 'Badge': return <span className={`badge tone-${p.tone ?? 'neutral'}`}>{p.label}</span>;
    case 'Callout': return <div className={`callout tone-${p.tone ?? 'info'}`}>{p.title ? <strong>{p.title}</strong> : null}<Markdown text={p.markdown ?? ''} /></div>;
    case 'KeyValue': return <dl className="keyvalue">{p.items?.map((item: any, i: number) => <React.Fragment key={i}><dt>{item.label}</dt><dd>{String(item.value)}</dd></React.Fragment>)}</dl>;
    case 'Table': return <Table value={p} />;
    case 'Steps': return <Steps value={p} />;
    case 'ColumnChart': return <ColumnChart value={p} />;
    case 'Scatter': return <Scatter value={p} />;
    case 'Area': return <Area value={p} />;
    case 'Heatmap': return <Heatmap value={p} />;
    case 'Timeline': return <Timeline value={p} />;
    case 'Diagram': return <Diagram value={p} />;
    case 'Math': return <MathBlock value={p} />;
    case 'Sparkline': return <Sparkline value={p} />;
    default: return null;
  }
}
