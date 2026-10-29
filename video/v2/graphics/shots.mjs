// The v2 graphics' shots, for capture/site.mjs --shots (each list is owned by the file that draws its pages).
import { treeShots } from './shots-tree.mjs';
import { cardShots } from './shots-cards.mjs';
import { diagramShots } from './shots-diagrams.mjs';

export const siteShots = [...treeShots, ...cardShots, ...diagramShots];
