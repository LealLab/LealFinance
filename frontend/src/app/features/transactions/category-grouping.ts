import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';

export interface CategoryGroupOptions {
  group: CategoryGroup;
  categories: Category[];
}

/**
 * Groups category picker options by their group. Every category has a group,
 * so unlike account/institution grouping there is no ungrouped bucket.
 */
export function groupCategoriesByGroup(
  categories: readonly Category[],
  groups: readonly CategoryGroup[],
): CategoryGroupOptions[] {
  return [...groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      group,
      categories: categories
        .filter((category) => category.groupId === group.id)
        .sort((a, b) => a.position - b.position),
    }))
    .filter((entry) => entry.categories.length > 0);
}
