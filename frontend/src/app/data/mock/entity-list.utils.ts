/** Small, pure list-update helpers shared by MockStore's per-entity methods. */

export function updateEntity<T extends { id: string }>(
  list: readonly T[],
  id: string,
  changes: Partial<Omit<T, 'id'>>
): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...changes } : item));
}

export function removeEntity<T extends { id: string }>(list: readonly T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

export function findEntity<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  return list.find((item) => item.id === id);
}

/**
 * Reassigns sequential 0-based `position` values, in `orderedIds` order, to
 * exactly the items whose id appears in `orderedIds` — every other item's
 * `position` is left untouched. Ids not present in `list` are ignored.
 */
export function reorderEntities<T extends { id: string; position: number }>(
  list: readonly T[],
  orderedIds: readonly string[]
): T[] {
  const positionById = new Map(orderedIds.map((id, index) => [id, index]));
  return list.map((item) =>
    positionById.has(item.id) ? { ...item, position: positionById.get(item.id)! } : item
  );
}
