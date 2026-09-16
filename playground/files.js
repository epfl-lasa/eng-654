/* Portable workspaces and saved operations. Validate the entire import before changing the UI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./graph.js'));
  else root.KinematicsFiles = factory(root.KinematicsGraph);
})(typeof window !== 'undefined' ? window : globalThis, function (G) {
  'use strict';
  const WORKSPACE = 'kinematic-building-blocks';
  const LIBRARY = 'kinematic-building-blocks-library';
  function cleanLibrary(candidate) {
    if (!Array.isArray(candidate) || candidate.length > 60) throw new Error('My blocks can hold at most 60 saved operations.');
    const definitions = candidate.map(item => G.validateDefinition(item));
    if (new Set(definitions.map(item => item.id)).size !== definitions.length) throw new Error('Saved operation IDs must be unique.');
    return definitions;
  }
  function workspaceFile(graph, library, selected) {
    const cleaned = G.validateGraph(graph);
    return { format: WORKSPACE, version: 1, graph: cleaned, library: cleanLibrary(library),
      selected: cleaned.nodes.some(node => node.id === selected) ? selected : cleaned.nodes.at(-1)?.id || null };
  }
  function libraryFile(library) { return { format: LIBRARY, version: 1, library: cleanLibrary(library) }; }
  function mergeLibrary(current, incoming) {
    const result = cleanLibrary(current), used = new Set(result.map(item => item.id));
    for (const definition of cleanLibrary(incoming)) {
      // Uploading the same definition again should not create duplicate buttons.
      if (result.some(item => JSON.stringify(item) === JSON.stringify(definition))) continue;
      let id = definition.id, suffix = 1;
      while (used.has(id)) id = definition.id.slice(0, 48) + '_import_' + suffix++;
      result.push({ ...definition, id }); used.add(id);
    }
    return cleanLibrary(result);
  }
  function readFile(candidate, currentLibrary = []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Choose a playground JSON file.');
    if (candidate.format === undefined) return { graph: G.validateGraph(candidate), library: cleanLibrary(currentLibrary), selected: null };
    if (![WORKSPACE, LIBRARY].includes(candidate.format) || candidate.version !== 1) throw new Error('This saved operations file uses an unsupported format or version.');
    if (candidate.format === LIBRARY) return { graph: null, library: mergeLibrary(currentLibrary, candidate.library), selected: null };
    const restored = workspaceFile(candidate.graph, candidate.library, candidate.selected);
    return { graph: restored.graph, library: mergeLibrary(currentLibrary, restored.library), selected: restored.selected };
  }
  return { workspaceFile, libraryFile, readFile };
});
