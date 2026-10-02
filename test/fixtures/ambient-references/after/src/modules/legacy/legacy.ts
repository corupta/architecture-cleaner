/// <reference path="../../legacy/legacy-globals.d.ts" />

function registerLegacy(key: string, value: string): void {
  legacyRegistry[key] = value;
}
