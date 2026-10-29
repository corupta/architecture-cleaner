// The number cards and immich's history (B2–B8). A shot plays its page's clock while something moves and holds the
// last frame once it's still; the cards are still from their first frame, so they only hold. card-agents serves two
// shots: the second (B4) starts its clock at 6 s, where the Ultra column turns opaque.
export const cardShots = [
  // B2 (0:21–0:32): the list scrolls to 6 s, steps back behind the card by 6.9 s, held to 11 s.
  { id: 'history', card: 'v2/graphics/history.html', steps: [{ play: 7 }, { hold: 4 }] },
  // B3's end (0:50–0:56): opencode + Nemotron 3 Super; the Ultra column faint.
  { id: 'card-agents', card: 'v2/graphics/card-agents.html', steps: [{ hold: 6 }] },
  // B4 (0:56–1:10): both columns.
  { id: 'card-agents-ultra', card: 'v2/graphics/card-agents.html?from=6', steps: [{ hold: 14 }] },
  // B7's card: as before.
  { id: 'card-scale', card: 'v2/graphics/card-scale.html', steps: [{ hold: 4 }] },
  // B8's end: Super VL draws better maps, preliminary.
  { id: 'card-supervl', card: 'v2/graphics/card-supervl.html', steps: [{ hold: 6 }] },
];
