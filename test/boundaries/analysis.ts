// Hand-made analyses for the boundary tests: no repo, no resolver, just the resolved sites R4 reads.
import type { Analysis, AnalyzedFile, ResolvedSite, SiteKind } from '../../src/analyzer/types.js';

type SiteSpec = string | { to?: string; specifier?: string; kind?: SiteKind; typeOnly?: boolean };

/** An analysis of repo-relative files; each site names the repo-relative file it resolves to (or a bare specifier). */
export function analysisOf(files: Record<string, SiteSpec[]>): Analysis {
  const analysis: Analysis = { files: new Map() };
  for (const [file, sites] of Object.entries(files)) {
    const resolved: ResolvedSite[] = sites.map((spec) => {
      const site = typeof spec === 'string' ? { to: spec } : spec;
      return {
        kind: site.kind ?? 'import', specifier: site.specifier ?? site.to ?? '', start: 0, end: 0, typeOnly: site.typeOnly ?? false,
        resolution: site.to ? { type: 'file', path: site.to, via: 'typescript' } : { type: 'unresolved' },
      };
    });
    const analyzed: AnalyzedFile = { path: file, format: 'esm', config: null, sites: resolved, hazards: [] };
    analysis.files.set(file, analyzed);
  }
  return analysis;
}
