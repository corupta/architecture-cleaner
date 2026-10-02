/// <reference path="legacy-globals.d.ts" />
/// <reference path="legacy.ts" />

function runLegacy(): string {
  registerLegacy('mode', 'classic');
  return legacyRegistry['mode'];
}
