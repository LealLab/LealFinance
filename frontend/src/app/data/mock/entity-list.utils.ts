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
