// The site shots of the demo video (video/shots.md names them by id). A step is one of:
//   { hold: seconds }                       the picture stands still
//   { scrollTo: locator | px, seconds, margin }  an eased scroll that puts the target `margin` px below the top
//   { jumpTo: locator | px, margin }        a cut to that position
//   { open: locator }                       opens the <details> around the target
//   { highlight: locator } / { clear: true }  an orange outline on the target, or none
// Locators are Playwright's (CSS, or text with :has-text()). A shot with `card` opens video/<card> instead of a site page.
export const siteShots = [
  { id: 'card-misses', card: 'cards/misses.html', steps: [{ hold: 6 }] },
  { id: 'card-mutation', card: 'cards/mutation.html', steps: [{ hold: 5 }] },
  { id: 'card-super-vl', card: 'cards/super-vl.html', steps: [{ hold: 2 }, { highlight: 'tr:has-text("immich")' }, { hold: 4 }] },
  { id: 'card-close', card: 'cards/close.html', steps: [{ hold: 8 }] },
  {
    id: 'site-landing',
    page: 'index.html',
    steps: [
      { hold: 1.5 },
      { highlight: '.card:has-text("immich-ladder") .status' },
      { hold: 2.5 },
    ],
  },
  {
    id: 'site-ab',
    page: 'ab/index.html',
    steps: [
      { jumpTo: 'p:has-text("A green test count is not proof")', margin: 80 },
      { highlight: 'p:has-text("A green test count is not proof")' },
      { hold: 3 },
      { clear: true },
      { scrollTo: 'tr:has-text("tsc errors (base: 0)")', seconds: 1.5, margin: 120 },
      { highlight: 'tr:has-text("tsc errors (base: 0)")' },
      { hold: 2 },
      { highlight: 'tr:has-text("Unit suite (base: 105 files")' },
      { hold: 2.5 },
      { clear: true },
      { scrollTo: 'tr:has-text("ac certify verdict")', seconds: 1.5, margin: 200 },
      { highlight: 'tr:has-text("ac certify verdict")' },
      { hold: 2.5 },
    ],
  },
  {
    id: 'site-plan',
    page: 'runs/immich-ladder/index.html',
    steps: [
      { jumpTo: '#plan' },
      { hold: 1 },
      { highlight: 'p:has-text("The critic\'s review")' },
      { hold: 3 },
      { clear: true },
      { open: 'tr:has-text("src/repositories/app.repository.ts")' },
      { scrollTo: 'tr:has-text("src/repositories/app.repository.ts")', seconds: 1.5, margin: 260 },
      { highlight: 'tr:has-text("src/repositories/app.repository.ts")' },
      { hold: 3 },
    ],
  },
  {
    id: 'site-ladder',
    page: 'runs/immich-ladder/index.html',
    steps: [
      { jumpTo: '#ladder' },
      { hold: 1 },
      { highlight: '#ladder table' },
      { hold: 2.5 },
      { clear: true },
      { scrollTo: 'h3:has-text("Every step")', seconds: 1.5 },
      { hold: 1 },
      { scrollTo: 'h3:has-text("Rung certificates")', seconds: 6, margin: 400 },
      { hold: 1 },
    ],
  },
  {
    id: 'site-fault',
    page: 'runs/immich-fault/index.html',
    steps: [
      { jumpTo: 'h3:has-text("Failed attempts and rollbacks")' },
      { hold: 1 },
      { highlight: 'p:has-text("certificate FAIL (K3a, K3b, K3c)")' },
      { hold: 3 },
      { clear: true },
      { highlight: 'p:has-text("Pinned by this failure")' },
      { hold: 2 },
      { highlight: 'p:has-text("attempt 2 passed")' },
      { hold: 2.5 },
    ],
  },
  {
    id: 'site-graph',
    page: 'runs/immich-ladder/index.html',
    // The files flow first (367 of 563 files moved), then back to the tiles while the cycle sentence is spoken.
    steps: [
      { jumpTo: 'figure:has-text("Files flow")' },
      { hold: 1.5 },
      { scrollTo: 'figure:has-text("Files flow") >> text=Left: the folders at the base commit', seconds: 4, margin: 600 },
      { hold: 0.5 },
      { scrollTo: '#graph', seconds: 1.5 },
      { highlight: '#graph .tile:has-text("Largest import cycle")' },
      { hold: 5 },
    ],
  },
  {
    id: 'site-findings',
    page: 'runs/immich-ladder/index.html',
    steps: [
      { jumpTo: '#kind-god-injection' },
      { hold: 1 },
      { highlight: '#kind-god-injection + div' },
      { hold: 4 },
    ],
  },
  {
    id: 'site-bench',
    page: 'bench/index.html',
    steps: [
      { jumpTo: 'p:has-text("In these results the planner beats")', margin: 40 },
      { hold: 1.5 },
      { highlight: 'tr:has-text("kaneo")' },
      { hold: 2 },
      { highlight: 'tr:has-text("ghostfolio")' },
      { hold: 2.5 },
    ],
  },
];
