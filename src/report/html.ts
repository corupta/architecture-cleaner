// The HTML layer shared by `ac report` and `ac site`: one self-contained page (inline CSS and a small inline script for
// tooltips, no fetch, no CDN), escaping, and the components the pages are built from. Every function is a pure
// string builder, so the same inputs give the same bytes.
export { formatDuration } from '../orchestrator/report.js';

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Whole numbers with thousands separators (en-US, independent of the machine's locale). */
export const count = (value: number) => Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const usd = (value: number, digits = 4) => `$${value.toFixed(digits)}`;

export const shortSha = (sha: string | undefined | null) => (sha ? sha.slice(0, 10) : '–');

export const plural = (value: number, word: string, many = `${word}s`) => `${count(value)} ${value === 1 ? word : many}`;

export type Status = 'pass' | 'fail' | 'skip' | 'error' | 'none';

const statusText: Record<Status, { icon: string; label: string }> = {
  pass: { icon: '✓', label: 'PASS' },
  fail: { icon: '✕', label: 'FAIL' },
  skip: { icon: '–', label: 'skip' },
  error: { icon: '!', label: 'ERROR' },
  none: { icon: '·', label: 'not run' },
};

/** A status mark: icon and label, never color alone. */
export function statusMark(status: Status, label?: string): string {
  const { icon, label: fallback } = statusText[status];
  return `<span class="status status-${status}"><span class="status-icon" aria-hidden="true">${icon}</span>${escapeHtml(label ?? fallback)}</span>`;
}

export interface Tile {
  label: string;
  value: string;
  /** One short line under the value. */
  note?: string;
}

export function tiles(items: Tile[]): string {
  return `<div class="tiles">${items.map((item) => `<div class="tile"><div class="tile-label">${escapeHtml(item.label)}</div><div class="tile-value">${escapeHtml(item.value)}</div>${item.note ? `<div class="tile-note">${escapeHtml(item.note)}</div>` : ''}</div>`).join('')}</div>`;
}

export interface Column {
  label: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
}

/** A table; cells are HTML (escape text before passing it). */
export function table(columns: Column[], rows: string[][], options: { caption?: string; className?: string } = {}): string {
  const head = columns.map((column) => `<th${column.numeric ? ' class="num"' : ''} scope="col">${escapeHtml(column.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell, index) => `<td${columns[index]?.numeric ? ' class="num"' : ''}>${cell}</td>`).join('')}</tr>`).join('\n');
  return `<div class="table-wrap"><table${options.className ? ` class="${options.className}"` : ''}>${options.caption ? `<caption>${escapeHtml(options.caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

/** A collapsible block; `summary` is HTML. */
export const details = (summary: string, content: string, options: { open?: boolean; className?: string } = {}) =>
  `<details${options.className ? ` class="${options.className}"` : ''}${options.open ? ' open' : ''}><summary>${summary}</summary>${content}</details>`;

export const pre = (text: string) => `<pre>${escapeHtml(text)}</pre>`;

export const code = (text: string) => `<code>${escapeHtml(text)}</code>`;

export const link = (href: string, text: string) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

/** A figure: title, the chart, a caption, and its table view (the accessible twin of every chart). */
export function figure(title: string, chart: string, options: { caption?: string; tableView?: string } = {}): string {
  return `<figure class="chart"><figcaption class="chart-title">${escapeHtml(title)}</figcaption>${chart}${options.caption ? `<p class="chart-caption">${options.caption}</p>` : ''}${options.tableView ? details('Table view', options.tableView, { className: 'table-view' }) : ''}</figure>`;
}

export interface Section {
  id: string;
  title: string;
  body: string;
}

export const section = (part: Section) => `<section id="${part.id}"><h2>${escapeHtml(part.title)}</h2>\n${part.body}\n</section>`;

export interface PageOptions {
  title: string;
  /** Links above the header: [href, text], relative to the page. */
  breadcrumbs?: [string, string][];
  /** HTML under the title. */
  lead?: string;
  /** In-page navigation: section ids and titles. */
  nav?: [string, string][];
  body: string;
}

const styles = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--good:#0ca30c;--good-text:#006300;--critical:#d03b3b;--serious:#ec835a;--warning:#fab219;--neutral:#a8a69e;--code:#f0efec}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#ffffff;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--ring:rgba(255,255,255,.10);
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--good-text:#0ca30c;--neutral:#5f5e59;--code:#262624}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:24px 20px 64px}
a{color:var(--s1)}
h1{font-size:28px;line-height:1.25;margin:4px 0 8px}
h2{font-size:21px;margin:40px 0 12px;padding-top:8px;border-top:1px solid var(--grid)}
h3{font-size:16px;margin:24px 0 8px}
p{margin:8px 0;max-width:80ch}
.lead{color:var(--ink-2);max-width:90ch}
.breadcrumbs{font-size:13px;color:var(--muted)}
.breadcrumbs a{color:var(--ink-2)}
nav.toc{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14px;margin:12px 0 4px}
nav.toc a{color:var(--ink-2);text-decoration:none;border-bottom:1px solid var(--axis)}
code,pre{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{background:var(--code);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--surface);border:1px solid var(--ring);border-radius:6px;padding:10px 12px;overflow:auto;max-height:560px;white-space:pre}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:14px 0}
.tile{background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:10px 12px}
.tile-label{font-size:13px;color:var(--ink-2)}
.tile-value{font-size:22px;font-weight:600;margin-top:2px;overflow-wrap:anywhere}
.tile-note{font-size:12.5px;color:var(--muted);margin-top:2px}
.table-wrap{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;font-size:13.5px;background:var(--surface);border:1px solid var(--ring)}
caption{text-align:left;font-weight:600;padding:6px 0}
th,td{padding:5px 9px;border-bottom:1px solid var(--grid);vertical-align:top;text-align:left}
th{font-weight:600;color:var(--ink-2);background:var(--surface);position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table.ab td:first-child{min-width:150px}
table.ab td{min-width:120px}
.certificate-count{margin-top:4px;padding-top:3px;border-top:1px dashed var(--axis);color:var(--ink-2)}
details{margin:6px 0}
details>summary{cursor:pointer}
details.table-view>summary,details.more>summary{font-size:13px;color:var(--ink-2)}
.status{display:inline-flex;align-items:center;gap:4px;font-weight:600;white-space:nowrap}
.status-icon{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;font-size:11px;color:#fff}
.status-pass .status-icon{background:var(--good)}.status-pass{color:var(--good-text)}
.status-fail .status-icon{background:var(--critical)}.status-fail{color:var(--critical)}
.status-error .status-icon{background:var(--serious)}
.status-skip .status-icon,.status-none .status-icon{background:var(--neutral)}.status-skip,.status-none{color:var(--ink-2);font-weight:400}
.verdict{display:inline-flex;gap:8px;align-items:center;font-size:18px;margin:4px 0}
.muted{color:var(--muted)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.small{font-size:13px}
.pill{display:inline-block;font-size:12px;padding:0 7px;border-radius:10px;border:1px solid var(--axis);color:var(--ink-2);white-space:nowrap}
.pill-warn{border-color:var(--serious)}
figure.chart{margin:16px 0;background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:12px 14px}
.chart-title{font-weight:600;margin-bottom:6px}
.chart-caption{font-size:13px;color:var(--ink-2)}
.chart-scroll{overflow-x:auto}
svg text{fill:var(--ink-2);font:11px system-ui,-apple-system,"Segoe UI",sans-serif}
svg .label-strong{fill:var(--ink);font-weight:600}
svg .axis{stroke:var(--axis);stroke-width:1}
svg .grid{stroke:var(--grid);stroke-width:1}
svg [data-tip]:hover,svg [data-tip]:focus{opacity:.8;outline:none}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--ink-2);margin:4px 0 8px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.swatch{display:inline-block;width:12px;height:12px;border-radius:3px}
.finding{background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:8px 12px;margin:8px 0}
.finding h4{margin:0 0 4px;font-size:14.5px}
.finding .narration{margin:4px 0;color:var(--ink)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin:14px 0}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:12px 14px}
.card h3{margin-top:0}
.pitch{font-size:22px;line-height:1.35;font-weight:600;max-width:40ch;margin:12px 0}
#tip{position:fixed;pointer-events:none;z-index:10;background:var(--surface);color:var(--ink);border:1px solid var(--ring);border-radius:6px;padding:6px 8px;font-size:12.5px;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.15);max-width:360px;white-space:pre-line;display:none}
`.trim();

// One tooltip for every mark that carries data-tip: text only (textContent), on pointer and keyboard focus alike.
const script = `
(function(){var tip=document.createElement('div');tip.id='tip';document.body.appendChild(tip);
function show(target,x,y){tip.textContent=target.getAttribute('data-tip');tip.style.display='block';
var w=tip.offsetWidth,h=tip.offsetHeight;tip.style.left=Math.min(x+14,window.innerWidth-w-8)+'px';tip.style.top=Math.max(8,Math.min(y+14,window.innerHeight-h-8))+'px';}
document.addEventListener('pointermove',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t)show(t,e.clientX,e.clientY);else tip.style.display='none';});
document.addEventListener('focusin',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t){var r=t.getBoundingClientRect();show(t,r.right,r.top);}});
document.addEventListener('focusout',function(){tip.style.display='none';});})();
`.trim();

export function page(options: PageOptions): string {
  const breadcrumbs = options.breadcrumbs?.length ? `<div class="breadcrumbs">${options.breadcrumbs.map(([href, text]) => link(href, text)).join(' / ')}</div>` : '';
  const nav = options.nav?.length ? `<nav class="toc" aria-label="Sections">${options.nav.map(([id, text]) => `<a href="#${id}">${escapeHtml(text)}</a>`).join('')}</nav>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>
${styles}
</style>
</head>
<body>
<main>
${breadcrumbs}
<h1>${escapeHtml(options.title)}</h1>
${options.lead ?? ''}
${nav}
${options.body}
</main>
<script>
${script}
</script>
</body>
</html>
`;
}
