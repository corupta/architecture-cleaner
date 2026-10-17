// The A/B table as HTML, shared by the run report (the table about the run's own target) and the site's A/B page:
// the measured rows from runs/g3/ab.json with their sources, then rows read from each arm's certificate.
import type { AbTableView } from './ab.js';
import { code, details, escapeHtml, link, pre, shortSha, statusMark, table } from './html.js';

export interface AbLinks {
  /** Href of a certificate JSON (package-relative path in), or null when the page has no copy of it. */
  certificate(file: string): string | null;
  /** Href of a committed run's report, or null. */
  run(name: string): string | null;
}

export function renderAbTable(view: AbTableView, links: AbLinks): string {
  const { table: ab, certificates, checkRows } = view;
  const arms = ab.arms;
  const target = ab.target.origin ? link(`${ab.target.origin}/tree/${ab.target.base}${ab.target.packageRoot ? `/${ab.target.packageRoot}` : ''}`, `${ab.target.name} @ ${shortSha(ab.target.base)}`) : escapeHtml(`${ab.target.name} @ ${shortSha(ab.target.base)}`);
  const header = [{ label: '' }, ...arms.map((arm) => ({ label: arm.ours ? `${arm.label} (ours)` : arm.label })), { label: 'Source' }];
  const rows: string[][] = [
    ['<strong>Who</strong>', ...arms.map((arm) => `${arm.ours ? '<span class="pill">ac</span> ' : ''}${escapeHtml(arm.who)}`), ''],
    ['<strong>Branch</strong>', ...arms.map((arm) => {
      const report = arm.run ? links.run(arm.run) : null;
      return `${code(arm.branch)} <span class="muted small">(${escapeHtml(arm.session)})</span>${report ? `<br>${link(report, 'run report')}` : ''}`;
    }), ''],
    ...ab.rows.map((row) => [`<strong>${escapeHtml(row.metric)}</strong>`, ...arms.map((arm) => escapeHtml(row.values[arm.id] ?? '–')), `<span class="muted small">${escapeHtml(row.source)}</span>`]),
    ['<strong><code>ac certify</code> verdict</strong>', ...arms.map((arm) => {
      const certificate = certificates[arm.id];
      if (!certificate) return '<span class="muted">no certificate</span>';
      const failing = certificate.view.failing.length ? `<br><span class="small">failing: ${escapeHtml(certificate.view.failing.join(', '))}</span>` : '';
      return `${statusMark(certificate.view.verdict, `${certificate.view.verdict.toUpperCase()} (${certificate.view.scope === 'full' ? 'with oracles' : 'static'})`)}${failing}`;
    }), '<span class="muted small">the certificate files; one row per check below</span>'],
    ...checkRows.map((row) => [`${escapeHtml(row.id)} <span class="muted small">${escapeHtml(row.title)}</span>`, ...arms.map((arm) => {
      const status = row.statuses[arm.id];
      if (status) return statusMark(status);
      const predates = row.id === 'K7' && certificates[arm.id]?.view.format === 'ac-certificate/1';
      return `<span class="muted small">${predates ? 'not checked: K7 came after this certificate (S6)' : 'not in this certificate'}</span>`;
    }), '']),
  ];
  const summaries = arms.map((arm) => {
    const certificate = certificates[arm.id];
    if (!certificate) return '';
    const href = links.certificate(certificate.file);
    const jsonLink = href ? link(href, 'certificate JSON') : `${code(certificate.file)} in the repository`;
    return details(`${escapeHtml(arm.label)}: ${statusMark(certificate.view.verdict)} <span class="muted small">${escapeHtml(certificate.view.digest.slice(0, 19))}…</span>`, `<p class="small">${jsonLink}</p>${pre(certificate.summary)}`);
  }).join('\n');
  const notes = ab.notes.map((note) => `<p>${escapeHtml(note.text)} <span class="muted small">(${escapeHtml(note.source)})</span></p>`).join('\n');
  return `<h3>${escapeHtml(ab.title)}</h3>
<p class="small">Target: ${target}. ${escapeHtml(ab.baseline)}</p>
${table(header, rows, { className: 'ab' })}
${notes}
<h4>The certificates</h4>
${summaries}`;
}
