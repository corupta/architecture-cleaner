// The diagram shots (M2, M4): loop.html, run.html and fault.html. Each page's SCHEDULE holds its timing; a shot plays
// the page's clock for its whole length (each page is still after its last moment), so its length is exact. loop-fail
// starts loop.html's clock at the loop's last picture, 21.75 s (timed to corupta's take).
export const diagramShots = [
  { id: 'loop', card: 'v2/graphics/loop.html', steps: [{ play: 21.75 }] }, // B5, 21.75 s
  { id: 'loop-fail', card: 'v2/graphics/loop.html?from=21.75', steps: [{ play: 4 }] }, // B6's opening, 4 s
  { id: 'fault', card: 'v2/graphics/fault.html', steps: [{ play: 7 }] }, // B6's end, 7 s
  { id: 'run', card: 'v2/graphics/run.html', steps: [{ play: 8.5 }] }, // B7, 8.5 s
];
