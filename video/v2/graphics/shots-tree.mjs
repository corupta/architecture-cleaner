// The tree pictures' shots (sprawl.html, glide.html) and the end card's (end.html). Each page's SCHEDULE says when its events happen;
// a shot plays the page's clock while something moves and holds the last frame once it's still.
export const treeShots = [
  // B0 (0:00–0:07): immich's server/src, sliced by type, scrolling the whole time.
  { id: 'sprawl', card: 'v2/graphics/sprawl.html', steps: [{ play: 7 }] },
  // B1 (0:07–0:21): the title, the glide, the certified chip (lands by 10.1 s), held to 14 s.
  { id: 'glide', card: 'v2/graphics/glide.html', steps: [{ play: 10.5 }, { hold: 3.5 }] },
  // B9's close: the end card, still (v1's before/after diagram beside the tagline, the command and the links).
  { id: 'end', card: 'v2/graphics/end.html', steps: [{ play: 8 }] },
];
