// Builds the planner/baseline view from an analyzer graph: entities only (no tests, barrels, excluded files),
// keyed by scrambled path when a scramble is given, else by the real path. Edges through barrels are already
// symbol-level in the analyzer, so dropping barrel nodes loses nothing.
export function buildView(graph, entities) {
  const keyOf = new Map(entities.map((entity) => [entity.id, entity.scrambledPath ?? entity.id]));
  const fileById = new Map(graph.files.map((file) => [file.id, file]));
  const nodes = entities.map((entity) => {
    const file = fileById.get(entity.id);
    return {
      key: keyOf.get(entity.id),
      type: entity.type ?? file.role,
      loc: file.loc,
      exports: file.exports,
      primaryExport: file.primaryExport,
      decorators: file.decorators,
      tables: file.tables,
      locationSensitive: file.locationSensitive,
    };
  });
  const edges = [];
  for (const edge of graph.edges) {
    const from = keyOf.get(edge.from);
    const to = keyOf.get(edge.to);
    if (!from || !to || from === to) continue;
    edges.push({ from, to, weight: edge.typeOnly ? 0.5 : 1, typeOnly: edge.typeOnly, kinds: edge.kinds, symbols: edge.symbols });
  }
  return { nodes, edges };
}

// Real-target entities (no ground truth): movable source files under the module root.
export function realEntities(graph, { moduleRoot, exclude = [] }) {
  return graph.files
    .filter((file) => file.id.startsWith(`${moduleRoot}/`) && !file.isTest && !file.isBarrel && !exclude.some((pattern) => pattern.test(file.id)))
    .map((file) => ({ id: file.id, type: file.role }));
}
