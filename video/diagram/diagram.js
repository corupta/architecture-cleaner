// The before/after diagram of what ac does, shared by the README image (diagram/restructure.html) and the video's
// close card (cards/close.html, whose last frame is the thumbnail): immich's server/src before and after ac, each
// file marked by the feature it belongs to, so the change reads at a glance: scattered, then grouped. The moves are
// immich's real ones (runs/immich-ladder/certificate.json, pathMap): a feature's controller, DTO, repository and
// service move into modules/<feature>/ (shown without the modules/ level).
{
const features = ['album', 'asset', 'user'];
const roles = [['controllers', 'controller'], ['dtos', 'dto'], ['repositories', 'repository'], ['services', 'service']];

const style = `
.restructure{--album:#87a9d6;--asset:#e3a183;--user:#88b89e;display:flex;flex-direction:column;align-items:center}
.restructure .stage{display:flex;align-items:stretch;gap:var(--gap,28px)}
.restructure .tree{background:#fff;border:1px solid #dcdad3;border-radius:10px;padding:var(--pad,16px 22px 18px)}
.restructure h2{margin:0 0 8px;font:700 var(--title,20px)/1.3 "DejaVu Sans",sans-serif;color:#1d1d1b}
.restructure h2 small{display:block;font-weight:400;color:#76746c;font-size:var(--note,14px)}
.restructure .row{font:var(--mono,16px)/1.7 "DejaVu Sans Mono",monospace;white-space:pre;color:#1d1d1b;display:flex;align-items:center}
.restructure .dir{font-weight:700}
.restructure .dot{display:inline-block;width:var(--dot,8px);height:var(--dot,8px);border-radius:50%;margin-right:8px;flex:none}
.restructure .arrow{width:var(--arrow,72px);color:#76746c;align-self:center}
.restructure .legend{display:flex;gap:16px;margin-top:12px;font:var(--note,14px) "DejaVu Sans",sans-serif;color:#76746c}
.restructure .legend span{display:flex;align-items:center}`;

const file = (name, feature) => `<div class="row">  <span class="dot" style="background:var(--${feature})"></span>${name}</div>`;
const tree = (title, note, folders) => `<div class="tree"><h2>${title}<small>${note}</small></h2>${folders.map(([folder, files]) => `<div class="row dir">${folder}/</div>${files.join('')}`).join('')}</div>`;

/**
  * Renders the diagram into `container`; `sizes` overrides the CSS variables (--mono, --title, --gap, ...); `arrow` is
 * 'curve' or 'triangle' (a filled one, for the thumbnail). A classic script's global, not an ES module: pages opened
 * from file:// can't import modules.
 */
function renderRestructure(container, sizes = {}, { arrow: arrowShape = 'curve' } = {}) {
  if (!document.getElementById('restructure-style')) document.head.insertAdjacentHTML('beforeend', `<style id="restructure-style">${style}</style>`);
  const before = tree('Sliced by type', 'immich server/src, before', roles.map(([folder, role]) => [folder, features.map((feature) => file(`${feature}.${role}.ts`, feature))]));
  const after = tree('Sliced by feature', 'after ac: 63 certified commits', features.map((feature) => [feature, roles.map(([, role]) => file(`${feature}.${role}.ts`, feature))]));
  const arrow = arrowShape === 'triangle' ? '<svg class="arrow" viewBox="0 0 84 80"><polygon points="44,0 84,40 44,80 44,55 4,55 4,25 44,25" fill="#45443f"/></svg>' : '<svg class="arrow" viewBox="0 0 110 70"><path d="M8 40 C 30 6, 80 6, 98 34" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M84 30 L 100 38 L 102 20" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const legend = `<div class="legend">${features.map((feature) => `<span><span class="dot" style="background:var(--${feature})"></span>${feature}</span>`).join('')}</div>`;
  container.classList.add('restructure');
  for (const [name, value] of Object.entries(sizes)) container.style.setProperty(`--${name}`, value);
  container.innerHTML = `<div class="stage">${before}${arrow}${after}</div>${legend}`;
}
window.renderRestructure = renderRestructure;
}
