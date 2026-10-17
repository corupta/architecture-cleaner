// Inline SVG charts for the report and the site, built as strings (no library, no script needed to draw them). The
// colors are CSS custom properties from html.ts (a validated categorical palette, blue as the sequential hue, status
// colors only for pass/fail), so light and dark mode swap in one place. Marks follow one spec: thin bars with a 4px
// rounded data end, a 2px surface gap between stacked segments, hairline axes, and a data-tip on every mark for the
// shared tooltip; every chart's numbers are also in a table view next to it.
import { escapeHtml } from './html.js';

/** Coordinates rounded to 0.1 px: the output stays byte-stable across platforms. */
const n = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** The shared tooltip's text; a focusable mark also gets keyboard focus and a label (dense grids rely on their table view). */
const tipAttributes = (tip: string, focusable = true) => ` data-tip="${escapeHtml(tip)}"${focusable ? ` tabindex="0" role="img" aria-label="${escapeHtml(tip.replace(/\n/g, '; '))}"` : ''}`;

/** A step of 1, 2 or 5 × 10^k that cuts [0, max] into about `target` intervals. */
export function niceStep(max: number, target = 4): number {
  if (max <= 0) return 1;
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

/** A bar's path with its data end (top, or right for horizontal bars) rounded and its baseline end square. */
function barPath(x: number, y: number, width: number, height: number, end: 'top' | 'right'): string {
  const radius = Math.min(4, (end === 'top' ? width : height) / 2, end === 'top' ? height : width);
  if (radius <= 0.5) return `M${n(x)} ${n(y)}h${n(width)}v${n(height)}h${n(-width)}z`;
  if (end === 'top') {
    return `M${n(x)} ${n(y + height)}V${n(y + radius)}Q${n(x)} ${n(y)} ${n(x + radius)} ${n(y)}H${n(x + width - radius)}Q${n(x + width)} ${n(y)} ${n(x + width)} ${n(y + radius)}V${n(y + height)}z`;
  }
  return `M${n(x)} ${n(y)}H${n(x + width - radius)}Q${n(x + width)} ${n(y)} ${n(x + width)} ${n(y + radius)}V${n(y + height - radius)}Q${n(x + width)} ${n(y + height)} ${n(x + width - radius)} ${n(y + height)}H${n(x)}z`;
}

export interface Series {
  id: string;
  label: string;
  /** A CSS color, normally a palette variable: `var(--s1)`. */
  color: string;
}

export const legend = (series: readonly Series[]) =>
  `<div class="legend">${series.map((entry) => `<span><span class="swatch" style="background:${entry.color}"></span>${escapeHtml(entry.label)}</span>`).join('')}</div>`;

export interface StackedColumn {
  /** Short x label (shown every few columns). */
  label: string;
  values: Record<string, number>;
  tip: string;
  /** Columns with the same band are grouped under one label (a rung). */
  band?: string;
}

/** Stacked columns over one y axis (seconds, files, ...), bottom-up in series order. */
export function stackedColumns(columns: readonly StackedColumn[], series: readonly Series[], options: { height?: number; unit: string; labelEvery?: number }): string {
  const height = options.height ?? 220;
  const left = 52;
  const top = 22;
  const bottom = 30;
  const slot = Math.max(11, Math.min(36, 760 / Math.max(1, columns.length)));
  const barWidth = Math.min(24, Math.max(6, slot - 4));
  const width = left + slot * columns.length + 12;
  const totals = columns.map((column) => series.reduce((sum, entry) => sum + (column.values[entry.id] ?? 0), 0));
  const step = niceStep(Math.max(...totals, 0));
  const max = Math.ceil(Math.max(...totals, step) / step) * step;
  const plot = height - top - bottom;
  const y = (value: number) => top + plot - (value / max) * plot;
  const parts: string[] = [];
  for (let tick = 0; tick <= max + step / 2; tick += step) {
    parts.push(`<line class="${tick === 0 ? 'axis' : 'grid'}" x1="${left}" x2="${n(width - 8)}" y1="${n(y(tick))}" y2="${n(y(tick))}"/>`);
    parts.push(`<text x="${left - 6}" y="${n(y(tick) + 4)}" text-anchor="end">${escapeHtml(`${Number(tick.toFixed(6))}${tick === 0 ? '' : ` ${options.unit}`}`)}</text>`);
  }
  let bandStart = 0;
  columns.forEach((column, index) => {
    const x = left + slot * index;
    const next = columns[index + 1];
    if (column.band !== undefined && next?.band !== column.band) {
      const middle = left + slot * (bandStart + index + 1) / 2;
      parts.push(`<text x="${n(middle)}" y="12" text-anchor="middle" class="label-strong">${escapeHtml(column.band)}</text>`);
      if (next) parts.push(`<line class="grid" x1="${n(x + slot)}" x2="${n(x + slot)}" y1="${top - 6}" y2="${n(top + plot)}"/>`);
      bandStart = index + 1;
    }
    let base = 0;
    const visible = series.filter((entry) => (column.values[entry.id] ?? 0) > 0);
    visible.forEach((entry, position) => {
      const value = column.values[entry.id]!;
      const y0 = y(base);
      const y1 = y(base + value);
      base += value;
      const gap = position > 0 && y0 - y1 > 3 ? 2 : 0;
      const segmentHeight = Math.max(0.5, y0 - y1 - gap);
      const barX = x + (slot - barWidth) / 2;
      parts.push(position === visible.length - 1
        ? `<path d="${barPath(barX, y1, barWidth, segmentHeight, 'top')}" fill="${entry.color}"/>`
        : `<rect x="${n(barX)}" y="${n(y1)}" width="${n(barWidth)}" height="${n(segmentHeight)}" fill="${entry.color}"/>`);
    });
    if (index % (options.labelEvery ?? 5) === 0 || index === columns.length - 1) {
      parts.push(`<text x="${n(x + slot / 2)}" y="${n(height - bottom + 16)}" text-anchor="middle">${escapeHtml(column.label)}</text>`);
    }
    parts.push(`<rect x="${n(x)}" y="${top}" width="${n(slot)}" height="${n(plot)}" fill="transparent"${tipAttributes(column.tip)}/>`);
  });
  return `${legend(series)}<div class="chart-scroll"><svg width="${n(width)}" height="${height}" viewBox="0 0 ${n(width)} ${height}">${parts.join('')}</svg></div>`;
}

export interface Bar {
  label: string;
  value: number;
  /** Text at the bar's end. */
  valueLabel: string;
  tip: string;
  color?: string;
}

/** Horizontal bars from one baseline, labels on the left, values at the tips. */
export function horizontalBars(bars: readonly Bar[], options: { labelWidth?: number; width?: number; max?: number } = {}): string {
  const labelWidth = options.labelWidth ?? 170;
  const width = options.width ?? 720;
  const valueRoom = 150;
  const row = 22;
  const barHeight = 14;
  const height = bars.length * row + 8;
  const max = options.max ?? Math.max(...bars.map((bar) => bar.value), 0);
  const scale = (value: number) => (max > 0 ? (value / max) * (width - labelWidth - valueRoom) : 0);
  const parts: string[] = [`<line class="axis" x1="${labelWidth}" x2="${labelWidth}" y1="0" y2="${height}"/>`];
  bars.forEach((bar, index) => {
    const y = 4 + index * row;
    const barWidth = scale(bar.value);
    parts.push(`<text x="${labelWidth - 8}" y="${n(y + barHeight / 2 + 4)}" text-anchor="end">${escapeHtml(bar.label)}</text>`);
    if (barWidth > 0) parts.push(`<path d="${barPath(labelWidth, y, Math.max(1, barWidth), barHeight, 'right')}" fill="${bar.color ?? 'var(--s1)'}"/>`);
    parts.push(`<text x="${n(labelWidth + barWidth + 6)}" y="${n(y + barHeight / 2 + 4)}">${escapeHtml(bar.valueLabel)}</text>`);
    parts.push(`<rect x="0" y="${n(y - 3)}" width="${width}" height="${row}" fill="transparent"${tipAttributes(bar.tip)}/>`);
  });
  return `<div class="chart-scroll"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg></div>`;
}

export interface Segment {
  series: Series;
  value: number;
  tip: string;
}

/** One horizontal bar split into parts of a whole; a segment's label shows inside only when it fits. */
export function partsBar(segments: readonly Segment[], options: { width?: number; format: (value: number) => string }): string {
  const width = options.width ?? 720;
  const height = 30;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const parts: string[] = [];
  let x = 0;
  segments.forEach((segment, index) => {
    const segmentWidth = total > 0 ? (segment.value / total) * width : 0;
    if (segmentWidth <= 0) return;
    const drawn = Math.max(0.5, segmentWidth - (index < segments.length - 1 ? 2 : 0));
    parts.push(index === segments.length - 1 ? `<path d="${barPath(x, 0, drawn, height, 'right')}" fill="${segment.series.color}"/>` : `<rect x="${n(x)}" y="0" width="${n(drawn)}" height="${height}" fill="${segment.series.color}"/>`);
    const text = options.format(segment.value);
    if (drawn > text.length * 7 + 12) parts.push(`<text x="${n(x + 6)}" y="19" style="fill:#fff;font-weight:600">${escapeHtml(text)}</text>`);
    parts.push(`<rect x="${n(x)}" y="0" width="${n(segmentWidth)}" height="${height}" fill="transparent"${tipAttributes(segment.tip)}/>`);
    x += segmentWidth;
  });
  return `${legend(segments.map((segment) => segment.series))}<div class="chart-scroll"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg></div>`;
}

export interface FlowNode {
  key: string;
  label: string;
  /** Total files through the node. */
  value: number;
  color: string;
  tip: string;
}

export interface FlowLink {
  from: string;
  to: string;
  value: number;
  color: string;
  tip: string;
}

/**
 * Two columns of nodes joined by bands (a two-level Sankey). Nodes are at least `minimum` px tall so every label fits;
 * a band's thickness is its share of its node, so small nodes stay readable and big ones stay proportional.
 */
export function flowChart(leftNodes: readonly FlowNode[], rightNodes: readonly FlowNode[], links: readonly FlowLink[], options: { unit?: number; minimum?: number; width?: number } = {}): string {
  const unit = options.unit ?? 1;
  const minimum = options.minimum ?? 12;
  const width = options.width ?? 860;
  const labelRoom = 170;
  const nodeWidth = 10;
  const gap = 3;
  const xLeft = labelRoom;
  const xRight = width - labelRoom - nodeWidth;
  const layout = (nodes: readonly FlowNode[]) => {
    const placed = new Map<string, { y: number; height: number; node: FlowNode }>();
    let y = 4;
    for (const node of nodes) {
      const height = Math.max(minimum, node.value * unit);
      placed.set(node.key, { y, height, node });
      y += height + gap;
    }
    return { placed, height: y };
  };
  const leftLayout = layout(leftNodes);
  const rightLayout = layout(rightNodes);
  const height = Math.max(leftLayout.height, rightLayout.height) + 4;
  const rightIndex = new Map(rightNodes.map((node, index) => [node.key, index]));
  const leftIndex = new Map(leftNodes.map((node, index) => [node.key, index]));
  const leftCursor = new Map<string, number>();
  const rightCursor = new Map<string, number>();
  const parts: string[] = [];
  const ordered = [...links].sort((a, b) => leftIndex.get(a.from)! - leftIndex.get(b.from)! || rightIndex.get(a.to)! - rightIndex.get(b.to)!);
  const bands = new Map<FlowLink, { y0: number; y1: number }>();
  for (const link of ordered) {
    const source = leftLayout.placed.get(link.from)!;
    const offset = leftCursor.get(link.from) ?? 0;
    const thickness = (source.height * link.value) / source.node.value;
    bands.set(link, { y0: source.y + offset, y1: 0 });
    leftCursor.set(link.from, offset + thickness);
  }
  const byTarget = [...links].sort((a, b) => rightIndex.get(a.to)! - rightIndex.get(b.to)! || leftIndex.get(a.from)! - leftIndex.get(b.from)!);
  for (const link of byTarget) {
    const target = rightLayout.placed.get(link.to)!;
    const offset = rightCursor.get(link.to) ?? 0;
    bands.get(link)!.y1 = target.y + offset;
    rightCursor.set(link.to, offset + (target.height * link.value) / target.node.value);
  }
  for (const link of ordered) {
    const source = leftLayout.placed.get(link.from)!;
    const target = rightLayout.placed.get(link.to)!;
    const { y0, y1 } = bands.get(link)!;
    const left = (source.height * link.value) / source.node.value;
    const right = (target.height * link.value) / target.node.value;
    const x0 = xLeft + nodeWidth;
    const x1 = xRight;
    const middle = (x0 + x1) / 2;
    parts.push(`<path d="M${n(x0)} ${n(y0)}C${n(middle)} ${n(y0)} ${n(middle)} ${n(y1)} ${n(x1)} ${n(y1)}V${n(y1 + right)}C${n(middle)} ${n(y1 + right)} ${n(middle)} ${n(y0 + left)} ${n(x0)} ${n(y0 + left)}z" fill="${link.color}" fill-opacity="0.32"${tipAttributes(link.tip, false)}/>`);
  }
  for (const [side, nodeLayout] of [['left', leftLayout], ['right', rightLayout]] as const) {
    for (const { y, height: nodeHeight, node } of nodeLayout.placed.values()) {
      const x = side === 'left' ? xLeft : xRight;
      parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${nodeWidth}" height="${n(nodeHeight)}" rx="2" fill="${node.color}"${tipAttributes(node.tip)}/>`);
      const labelX = side === 'left' ? x - 6 : x + nodeWidth + 6;
      parts.push(`<text x="${n(labelX)}" y="${n(y + nodeHeight / 2 + 4)}" text-anchor="${side === 'left' ? 'end' : 'start'}">${escapeHtml(`${node.label} ${node.value}`)}</text>`);
    }
  }
  return `<div class="chart-scroll"><svg width="${width}" height="${n(height)}" viewBox="0 0 ${width} ${n(height)}">${parts.join('')}</svg></div>`;
}

export interface MatrixCell {
  row: string;
  column: string;
  value: number;
  color: string;
  tip: string;
  /** Fill opacity; default: stepped by value. */
  opacity?: number;
}

/**
 * A square or rectangular grid: rows down the left, columns rotated along the top. A cell's opacity grows with its
 * value in steps (1, 2–3, 4–9, 10–29, 30+), so one hue reads light to dark.
 */
export function matrix(rows: readonly { key: string; label: string }[], columns: readonly { key: string; label: string }[], cells: readonly MatrixCell[], options: { cell?: number; labelWidth?: number; steps?: readonly number[] } = {}): string {
  const size = options.cell ?? 14;
  const labelWidth = options.labelWidth ?? 150;
  const longest = Math.max(...columns.map((column) => column.label.length), 4);
  const top = Math.min(160, longest * 6.2 + 10);
  const width = labelWidth + columns.length * size + 8;
  const height = top + rows.length * size + 8;
  const rowIndex = new Map(rows.map((row, index) => [row.key, index]));
  const columnIndex = new Map(columns.map((column, index) => [column.key, index]));
  const steps = options.steps ?? [1, 2, 4, 10, 30];
  const opacity = (value: number) => {
    let level = 0;
    steps.forEach((step, index) => {
      if (value >= step) level = index;
    });
    return (0.3 + (0.7 * level) / Math.max(1, steps.length - 1)).toFixed(2);
  };
  const parts: string[] = [];
  rows.forEach((row, index) => {
    const y = top + index * size;
    if (index % 2 === 0) parts.push(`<rect x="${labelWidth}" y="${n(y)}" width="${n(columns.length * size)}" height="${size}" fill="var(--grid)" fill-opacity="0.35"/>`);
    parts.push(`<text x="${labelWidth - 6}" y="${n(y + size / 2 + 4)}" text-anchor="end">${escapeHtml(row.label)}</text>`);
  });
  columns.forEach((column, index) => {
    const x = labelWidth + index * size + size / 2 + 4;
    parts.push(`<text transform="translate(${n(x)} ${n(top - 6)}) rotate(-90)">${escapeHtml(column.label)}</text>`);
  });
  for (const cell of cells) {
    const row = rowIndex.get(cell.row);
    const column = columnIndex.get(cell.column);
    if (row === undefined || column === undefined) continue;
    parts.push(`<rect x="${n(labelWidth + column * size + 1)}" y="${n(top + row * size + 1)}" width="${size - 2}" height="${size - 2}" rx="2" fill="${cell.color}" fill-opacity="${cell.opacity === undefined ? opacity(cell.value) : cell.opacity.toFixed(2)}"${tipAttributes(cell.tip, false)}/>`);
  }
  parts.push(`<rect x="${labelWidth}" y="${n(top)}" width="${n(columns.length * size)}" height="${n(rows.length * size)}" fill="none" class="axis"/>`);
  return `<div class="chart-scroll"><svg width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">${parts.join('')}</svg></div>`;
}
