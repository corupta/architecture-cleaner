/// <reference path="legacy-globals.d.ts" />
/// <reference path="../modules/legacy/legacy.ts" />

function runLegacy(): string {
  registerLegacy('mode', 'classic');
  return legacyRegistry['mode'];
}
