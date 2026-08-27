import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { groupCategoriesByGroup } from './category-grouping';

describe('groupCategoriesByGroup', () => {
  it('orders groups and categories and omits empty groups', () => {
    const groups: CategoryGroup[] = [
      { id: 'food', name: 'Food', kind: 'expense', color: '#000', icon: 'tag', position: 1 },
      { id: 'home', name: 'Home', kind: 'expense', color: '#000', icon: 'home', position: 0 },
      { id: 'empty', name: 'Empty', kind: 'expense', color: '#000', icon: 'archive', position: 2 },
    ];
    const categories: Category[] = [
      { id: 'restaurant', name: 'Restaurant', kind: 'expense', groupId: 'food', color: '#000', icon: 'tag', position: 1 },
      { id: 'groceries', name: 'Groceries', kind: 'expense', groupId: 'food', color: '#000', icon: 'tag', position: 0 },
      { id: 'rent', name: 'Rent', kind: 'expense', groupId: 'home', color: '#000', icon: 'home', position: 0 },
    ];

    expect(groupCategoriesByGroup(categories, groups).map((entry) => [
      entry.group.id,
      entry.categories.map((category) => category.id),
    ])).toEqual([
      ['home', ['rent']],
      ['food', ['groceries', 'restaurant']],
    ]);
  });
});
