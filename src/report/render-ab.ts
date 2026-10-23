// The A/B table as HTML, shared by the run report (the table about the run's own target) and the site's A/B page:
// the measured rows from runs/g3/ab.json with their sources, then rows read from each arm's certificate.
import { certificateCount, checkNote, type AbTableView } from './ab.js';
import { code, count, details, escapeHtml, link, pre, shortSha, statusMark, table } from './html.js';

export interface AbLinks {
  /** Href of a certificate JSON (package-relative path in), or null when the page has no copy of it. */
  certificate(file: string): string | null;
  /** Href of a committed run's report, or null. */
  run(name: string): string | null;
}

/**
 * The table's lead claim, read from a certificate: a generic agent's branch on which every base test case still
 * passes while spec files don't load and tsc fails. Empty when no arm's certificate shows that.
 */
export function greenTestsLine(view: AbTableView): string {
  for (const arm of view.table.arms.filter((candidate) => !candidate.ours)) {
    const checks = view.certificates[arm.id]?.view.checks ?? [];
    const metrics = (id: string) => checks.find((check) => check.id === id)?.metrics;
    const number = (id: string, key: string) => (typeof metrics(id)?.[key] === 'number' ? (metrics(id)![key] as number) : null);
    const cases = number('K8', 'unit.base.cases');
    const equal = number('K8', 'unit.casesEqual');
    const diagnostics = number('K8', 'tsc.head.diagnostics');
    const unloadable = number('K6', 'headUnloadable');
    const files = number('K6', 'headFiles');
    const quarantined = number('K8', 'unit.quarantined');
    if (!cases || equal !== cases || !diagnostics || !unloadable || files === null) continue;
    const setAside = quarantined ? ` outside the ${count(quarantined)} network test ${quarantined === 1 ? 'file' : 'files'} K8 sets aside` : '';
    return `<p><strong>A green test count is not proof.</strong> On ${escapeHtml(view.table.target.name)}, the branch ${code(arm.branch)} (${escapeHtml(arm.label)}) still passes all ${count(cases)} of the base's test cases${setAside}, while ${count(unloadable)} of its ${count(files)} test files fail to load and tsc reports ${count(diagnostics)} errors (its certificate: K6, K8).</p>`;
  }
  return '';
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
    ...ab.rows.map((row) => [`<strong>${escapeHtml(row.metric)}</strong>`, ...arms.map((arm) => {
      const view = certificates[arm.id]?.view;
      const counted = row.certificate && view ? certificateCount(view, row.certificate) : null;
      return `${escapeHtml(row.values[arm.id] ?? '–')}${counted ? `<div class="small certificate-count">certificate ${escapeHtml(counted)}</div>` : ''}`;
    }), `<span class="muted small">${escapeHtml(row.source)}${row.certificate ? `<br>certificate line: each arm's certificate, ${escapeHtml(row.certificate)}` : ''}</span>`]),
    ['<strong><code>ac certify</code> verdict</strong>', ...arms.map((arm) => {
      const certificate = certificates[arm.id];
      if (!certificate) return '<span class="muted">no certificate</span>';
      const failing = certificate.view.failing.length ? `<br><span class="small">failing: ${escapeHtml(certificate.view.failing.join(', '))}</span>` : '';
      return `${statusMark(certificate.view.verdict, `${certificate.view.verdict.toUpperCase()} (${certificate.view.scope === 'full' ? 'with oracles' : 'static'})`)}${failing}`;
    }), '<span class="muted small">the certificate files; one row per check below</span>'],
    ...checkRows.map((row) => [`${escapeHtml(row.id)} <span class="muted small">${escapeHtml(row.title)}</span>`, ...arms.map((arm) => {
      const status = row.statuses[arm.id];
      const view = certificates[arm.id]?.view;
      const note = status && view ? checkNote(view, row.id) : null;
      if (status) return `${statusMark(status)}${note ? `<div class="small">${escapeHtml(note)}</div>` : ''}`;
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
  const differences = ab.rows.filter((row) => row.differs);
  const differ = differences.length
    ? `<h4>Where the gate's numbers and the certificates' differ</h4>\n<ul>${differences.map((row) => `<li><strong>${escapeHtml(row.metric)}</strong>: ${escapeHtml(row.differs!)}</li>`).join('')}</ul>`
    : '';
  return `<h3>${escapeHtml(ab.title)}</h3>
<p class="small">Target: ${target}. ${escapeHtml(ab.baseline)}</p>
${greenTestsLine(view)}
${table(header, rows, { className: 'ab' })}
${differ}
${notes}
<h4>The certificates</h4>
${summaries}`;
}
