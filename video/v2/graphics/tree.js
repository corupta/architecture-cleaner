// The tree pictures' shared drawing (sprawl.html, glide.html): file trees in the site's monospace, folder
// names bold, a thin guide line down each folder's files; and the glide, immich's files moving from type folders into
// feature folders. The moves are the real run's (data.features: runs/immich-ladder/certificate.json's pathMap, base
// paths on the left, the modules/<feature>/ paths on the right, shown without the modules/ level). Loaded after
// common.js, so `data`, `progress` and `lerp` are in scope. A classic script, not a module: pages opened from file://
// can't import modules.
{
const FEATURES = ['album', 'asset', 'user'];
const ROLES = [['controllers', 'controller'], ['dtos', 'dto'], ['repositories', 'repository'], ['services', 'service']];

const style = `
.tree-heading{white-space:pre;font:700 26px/36px var(--mono);color:var(--ink)}
.tree-file{white-space:pre;font:25px/31px var(--mono);color:var(--ink)}
.tree-guide{width:2px;background:var(--ring)}
.glide{position:absolute;left:0;top:0}
.glide .tree-heading,.glide .tree-file,.glide .tree-guide{position:absolute;left:0;top:0}
.glide .panel-label{position:absolute;top:0;font:600 26px/34px var(--sans);color:var(--ink-2)}
.glide .box{position:absolute;box-sizing:border-box}
.glide .arrow{position:absolute;left:0;top:0;color:var(--muted)}
.glide .mover{position:absolute;left:0;top:0;white-space:pre;font:25px/31px var(--mono);color:var(--ink)}
.glide .mover .lift{position:absolute;inset:-1px -12px;border:2px solid var(--accent);border-radius:8px;background:#fff;box-shadow:0 6px 16px rgba(29,29,27,.14)}
.glide .mover span{position:relative}
.glide .chip{position:absolute;left:0;top:0;white-space:pre;font:25px/34px var(--sans);color:var(--ink-2);padding:0 14px;border:2px solid var(--pass);border-radius:19px;background:#fff}
.glide .chip b{font-weight:600;color:var(--pass)}`;
document.head.insertAdjacentHTML('beforeend', `<style>${style}</style>`);

/** The page clock's offset in seconds, from the URL's ?from= (a second shot from the same page starts later). */
const clockOffset = () => Number(new URLSearchParams(location.search).get('from') ?? 0);

/**
 * Each feature's controller, DTO, repository and service as the real run moved them, in reading order of the left
 * panel (folder by folder, features in order): [{ feature, folder, name, to: { folder, name } }].
 */
function coreFiles() {
  const files = ROLES.flatMap(([folder, role]) => FEATURES.map((feature) => {
    const move = data.features[feature].find((entry) => entry.from === `${folder}/${feature}.${role}.ts`);
    if (!move) throw new Error(`data.features.${feature} has no ${folder}/${feature}.${role}.ts`);
    const [toFolder, ...rest] = move.to.split('/');
    return { feature, folder, name: move.from.slice(folder.length + 1), to: { folder: toFolder, name: rest.join('/') } };
  }));
  for (const file of files) if (!FEATURES.includes(file.to.folder)) throw new Error(`${file.folder}/${file.name} moved to ${file.to.folder}/`);
  return files;
}

const element = (parent, className, html = '') => {
  const node = document.createElement('div');
  node.className = className;
  node.innerHTML = html;
  parent.append(node);
  return node;
};
const place = (node, x, y, opacity = 1) => {
  node.style.transform = `translate(${x}px, ${y}px)`;
  node.style.opacity = opacity;
};

/**
 * The glide's picture: "sliced by type" on the left, "sliced by feature" on the right, the 12 core files moving
 * between them; `chip` ({ folder, html }) is a commit chip that lands under that feature folder's files. Returns
 * { draw, size, files }: draw({ moves, chip }) sets the picture, `moves` each file's progress 0..1 (in `files`'
 * order) and `chip` the chip's 0..1. Positions are in the picture's own CSS px (its natural size is `size`); `geometry` overrides the layout's
 * numbers (widths, gaps, row heights).
 */
function createGlide(container, { chip: chipSpec = null, geometry = {} } = {}) {
  const files = coreFiles();
  const g = { boxTop: 46, padX: 22, padTop: 12, padBottom: 12, heading: 36, row: 31, groupGap: 6, indent: 30, guideX: 9, chip: 44, leftWidth: 370, gap: 150, rightWidth: 480, ...geometry };
  const leftX = 0;
  const rightX = g.leftWidth + g.gap;
  const leftFolders = ROLES.map(([folder]) => folder);
  const rightFolders = FEATURES;
  const contentHeight = (folders, rows) => folders.length * g.heading + rows * g.row + (folders.length - 1) * g.groupGap;
  const boxHeight = g.padTop + Math.max(contentHeight(leftFolders, files.length), contentHeight(rightFolders, files.length) + (chipSpec ? g.chip : 0)) + g.padBottom;
  const size = { width: rightX + g.rightWidth, height: g.boxTop + boxHeight };

  const root = element(container, 'glide');
  root.style.width = `${size.width}px`;
  root.style.height = `${size.height}px`;
  const label = element(root, 'panel-label', 'sliced by type');
  label.style.left = `${leftX}px`;
  const rightLabel = element(root, 'panel-label', 'sliced by feature');
  rightLabel.style.left = `${rightX}px`;
  for (const [x, width] of [[leftX, g.leftWidth], [rightX, g.rightWidth]]) {
    const box = element(root, 'box');
    Object.assign(box.style, { left: `${x}px`, top: `${g.boxTop}px`, width: `${width}px`, height: `${boxHeight}px` });
  }
  const arrowWidth = Math.min(84, g.gap - 28);
  const arrow = element(root, 'arrow', `<svg width="${arrowWidth}" height="40" viewBox="0 0 ${arrowWidth} 40"><path d="M4 20 H${arrowWidth - 8} M${arrowWidth - 24} 6 L${arrowWidth - 6} 20 L${arrowWidth - 24} 34" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  place(arrow, g.leftWidth + (g.gap - arrowWidth) / 2, g.boxTop + boxHeight / 2 - 20);

  const side = (folders, x) => folders.map((folder) => ({
    folder,
    x,
    heading: element(root, 'tree-heading', `${folder}/`),
    guide: element(root, 'tree-guide'),
  }));
  const left = side(leftFolders, leftX + g.padX);
  const right = side(rightFolders, rightX + g.padX);
  const chip = chipSpec ? element(root, 'chip', chipSpec.html) : null;
  const movers = files.map((file) => element(root, 'mover', `<div class="lift"></div><span>${file.to.name}</span>`));

  /** Lays out one side: each folder's heading, its files' slots (height × `open`), and its guide line. */
  const layout = (folders, fileFolder, open, extra = () => 0) => {
    const slots = new Array(files.length);
    let y = g.boxTop + g.padTop;
    for (const [index, entry] of folders.entries()) {
      if (index) y += g.groupGap;
      place(entry.heading, entry.x, y);
      y += g.heading;
      const guideTop = y;
      files.forEach((file, fileIndex) => {
        if (fileFolder(file) !== entry.folder) return;
        slots[fileIndex] = { x: entry.x + g.indent, y };
        y += g.row * open[fileIndex];
      });
      entry.guide.style.height = `${Math.max(0, y - guideTop - 6)}px`;
      place(entry.guide, entry.x + g.guideX, guideTop, y - guideTop > 6 ? 1 : 0);
      y += extra(entry.folder, y);
    }
    return slots;
  };

  const draw = ({ moves, chip: chipProgress = 0 }) => {
    // A move: lift (the row's card fades in), travel (eased), settle. The left slot closes once the row has left it;
    // the right one opens before it arrives.
    const lift = 0.14;
    const leftOpen = moves.map((p) => 1 - progress(p, 0.5, 0.32));
    const rightOpen = moves.map((p) => progress(p, 0.05, 0.4));
    const chipOpen = progress(chipProgress, 0, 0.45);
    let chipY = 0;
    const leftSlots = layout(left, (file) => file.folder, leftOpen);
    const rightSlots = layout(right, (file) => file.to.folder, rightOpen, (folder, y) => {
      if (!chip || folder !== chipSpec.folder) return 0;
      chipY = y;
      return g.chip * chipOpen;
    });
    files.forEach((file, index) => {
      const p = moves[index];
      const travel = progress(p, lift, 1 - 2 * lift);
      const card = Math.min(progress(p, 0, lift), 1 - progress(p, 1 - lift, lift));
      const from = leftSlots[index];
      const to = rightSlots[index];
      const mover = movers[index];
      place(mover, lerp(from.x, to.x, travel), lerp(from.y, to.y, travel) - 4 * card);
      mover.firstChild.style.opacity = card;
      mover.style.zIndex = p > 0 && p < 1 ? 2 : 1;
    });
    if (chip) {
      const landed = progress(chipProgress, 0.35, 0.65);
      place(chip, rightX + g.padX + g.indent, chipY + 5 - 14 * (1 - landed), landed);
    }
  };
  return { draw, size, files };
}

window.tree = { createGlide, clockOffset };
}
