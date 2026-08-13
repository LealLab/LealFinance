import { findEntity, removeEntity, reorderEntities, updateEntity } from './entity-list.utils';

interface Item {
  id: string;
  position: number;
}

describe('updateEntity', () => {
  it('merges changes into the matching item without mutating the input list', () => {
    const list: Item[] = [{ id: 'a', position: 0 }, { id: 'b', position: 1 }];

    const result = updateEntity(list, 'a', { position: 5 });

    expect(result).toEqual([{ id: 'a', position: 5 }, { id: 'b', position: 1 }]);
    expect(list[0].position).toBe(0);
  });
});

describe('removeEntity', () => {
  it('filters out the matching item without mutating the input list', () => {
    const list: Item[] = [{ id: 'a', position: 0 }, { id: 'b', position: 1 }];

    const result = removeEntity(list, 'a');

    expect(result).toEqual([{ id: 'b', position: 1 }]);
    expect(list).toHaveLength(2);
  });
});

describe('findEntity', () => {
  it('returns the matching item or undefined', () => {
    const list: Item[] = [{ id: 'a', position: 0 }];

    expect(findEntity(list, 'a')).toEqual({ id: 'a', position: 0 });
    expect(findEntity(list, 'missing')).toBeUndefined();
  });
});

describe('reorderEntities', () => {
  it('reassigns sequential positions to exactly the ids given, in the order given', () => {
    const list: Item[] = [
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 }
    ];

    const result = reorderEntities(list, ['c', 'a', 'b']);

    expect(result.find((i) => i.id === 'c')?.position).toBe(0);
    expect(result.find((i) => i.id === 'a')?.position).toBe(1);
    expect(result.find((i) => i.id === 'b')?.position).toBe(2);
  });

  it('leaves items not present in orderedIds untouched', () => {
    const list: Item[] = [
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'outsider', position: 99 }
    ];

    const result = reorderEntities(list, ['b', 'a']);

    expect(result.find((i) => i.id === 'outsider')?.position).toBe(99);
  });

  it('does not mutate the input list', () => {
    const list: Item[] = [{ id: 'a', position: 0 }, { id: 'b', position: 1 }];

    reorderEntities(list, ['b', 'a']);

    expect(list[0].position).toBe(0);
    expect(list[1].position).toBe(1);
  });
});
