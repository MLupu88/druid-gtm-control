// Shared helper for building deduplicated, deterministically ordered
// MissingInputEntry lists — used by every rule module and by evaluate.ts
// when merging missing-field reports across dimensions.

import type { Dimension, MissingInputEntry } from "./types.js";

export function buildMissingInputs(
  map: Map<string, Set<Dimension>>,
): MissingInputEntry[] {
  return Array.from(map.keys())
    .sort()
    .map((field) => ({ field, affects: Array.from(map.get(field)!).sort() }));
}

export function mergeMissingInputs(
  groups: MissingInputEntry[][],
): MissingInputEntry[] {
  const map = new Map<string, Set<Dimension>>();
  for (const group of groups) {
    for (const entry of group) {
      const set = map.get(entry.field) ?? new Set<Dimension>();
      for (const dimension of entry.affects) set.add(dimension);
      map.set(entry.field, set);
    }
  }
  return buildMissingInputs(map);
}
