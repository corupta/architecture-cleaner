// The diagram shots (M2, M3, M4): loop.html, nemotron.html, run.html and fault.html. Each page's SCHEDULE holds its
// timing; a shot plays the page's clock for its whole length (each page is still after its last moment), so its length
// is exact. loop-fail starts loop.html's clock at 16 s.
export const diagramShots = [
  { id: 'loop', card: 'v2/graphics/loop.html', steps: [{ play: 16 }] }, // B5a, 16 s
  { id: 'loop-fail', card: 'v2/graphics/loop.html?from=16', steps: [{ play: 4 }] }, // B6's opening, 4 s
  { id: 'nemotron', card: 'v2/graphics/nemotron.html', steps: [{ play: 14 }] }, // B5b, 14 s
  { id: 'fault', card: 'v2/graphics/fault.html', steps: [{ play: 7 }] }, // B6's end, 7 s
  { id: 'run', card: 'v2/graphics/run.html', steps: [{ play: 8.5 }] }, // B7, 8.5 s
];
